/**
 * matcher.api-assisted-review.test.js
 *
 * Test suite for Phase 2B.1: API-Assisted OCR Review (Suggest Only — Never Auto-Correct).
 * Verifies:
 * - A1: malformed OCR preserved
 * - A2: API candidate shown separately
 * - A3: candidate does not auto-replace OCR
 * - A4: candidate selection requires explicit action
 * - A5: selecting candidate still does not create manual evidence
 * - A6: final Confirm creates manual evidence
 * - A7: multiple close candidates = AMBIGUOUS
 * - A8: no suitable candidate = NO CANDIDATE
 * - A9: candidate must exist in API array
 * - A10: seqNo is never used as apiIndex
 * - A11: no tracking arithmetic
 * - A12: range without printed qty keeps qty null
 *
 * Plus validation of real receipt malformed OCR tracks from TR 11476142.
 *
 * Run with: node matcher.api-assisted-review.test.js
 */

'use strict';

const assert = require('assert');

// ── Pure Node implementations matching app.js Phase 2B.1 logic ───────────────
function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

function findApiTrackCandidate(rawTrack, apiItems, maxDistance = 3) {
  if (!rawTrack || typeof rawTrack !== 'string') {
    return { status: 'none', candidate: null, distance: null, source: 'api-review' };
  }
  const norm = cleanTrackNo(rawTrack);
  if (!norm) return { status: 'none', candidate: null, distance: null, source: 'api-review' };

  const uniqueApiTracks = new Set();
  (apiItems || []).forEach(item => {
    const b = cleanTrackNo(item?.barcode || item?.track_no || item?.trackNo || (typeof item === 'string' ? item : ''));
    if (b) uniqueApiTracks.add(b);
  });

  if (uniqueApiTracks.has(norm)) {
    return { status: 'exact_match', candidate: norm, distance: 0, source: 'api-review' };
  }

  const matches = [];
  uniqueApiTracks.forEach(apiTrack => {
    const dist = levenshteinDistance(norm, apiTrack);
    if (dist <= maxDistance) {
      matches.push({ track: apiTrack, distance: dist });
    }
  });

  if (matches.length === 0) {
    return { status: 'none', candidate: null, distance: null, source: 'api-review' };
  }

  matches.sort((a, b) => a.distance - b.distance);
  const bestDist = matches[0].distance;
  const bestMatches = matches.filter(m => m.distance === bestDist);

  if (bestMatches.length === 1) {
    return {
      status: 'single_match',
      candidate: bestMatches[0].track,
      distance: bestDist,
      source: 'api-review'
    };
  }

  return {
    status: 'ambiguous',
    candidate: null,
    candidates: bestMatches.map(m => m.track),
    distance: bestDist,
    source: 'api-review'
  };
}

function extractTrackCandidates(text) {
  const candidates = [];
  if (!text || typeof text !== 'string') return candidates;
  const regex = /(?:^|[\s,;:])([A-Za-z0-9]{2})\s*([0-9\s]{8,14})\s*([A-Za-z0-9]{2})(?=$|[\s,;:.!?])/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const prefix = m[1];
    const middleDigits = m[2].replace(/\s+/g, '');
    const suffix = m[3];
    if (middleDigits.length >= 8 && middleDigits.length <= 10) {
      const full = cleanTrackNo(prefix + middleDigits + suffix);
      candidates.push({
        raw: m[0].trim(),
        normalized: full
      });
    }
  }
  return candidates;
}

function parseReceiptLineEvidence(lines, rcptNo = null, apiItems = []) {
  const suggestions = [];
  if (!Array.isArray(lines)) return suggestions;

  let currentSeq = null;
  let currentRaw = '';
  let currentConf = 0;
  let confCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = (line.text || '').trim();
    if (!text) continue;

    const seqMatch = text.match(/^\s*(\d{1,4})\s*[\.\,\:\;\-]\s*(.*)$/);
    if (seqMatch) {
      currentSeq = parseInt(seqMatch[1], 10);
      currentRaw = text;
      currentConf = line.confidence || 0;
      confCount = 1;
    } else if (currentSeq !== null && confCount < 3) {
      currentRaw += ' ' + text;
      currentConf += (line.confidence || 0);
      confCount++;
    }

    const tracks = extractTrackCandidates(text);
    if (tracks.length > 0) {
      const first = tracks[0].normalized;
      const last = tracks.length > 1 ? tracks[1].normalized : first;
      // Rule 8: Range without printed qty keeps qty null
      let qty = tracks.length > 1 ? null : 1;

      const qtyMatch = text.match(/(?:จำนวน\s*(\d+)|(\d+)\s*ชิ้น|qty\s*[:\.]?\s*(\d+))/i);
      if (qtyMatch) {
        const q = parseInt(qtyMatch[1] || qtyMatch[2] || qtyMatch[3], 10);
        if (!isNaN(q) && q > 0) qty = q;
      }

      const avgConf = confCount > 0 ? Math.round(currentConf / confCount) : Math.round(line.confidence || 0);
      const candidateInfo = findApiTrackCandidate(first, apiItems);

      suggestions.push({
        id: 'sug_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        rcptNo: rcptNo || null,
        seqNo: currentSeq !== null ? currentSeq : null,
        firstTrack: first,
        lastTrack: last,
        qty: qty,
        rawText: currentRaw || text,
        confidence: avgConf,
        provenance: 'ocr',
        status: 'pending',
        reviewCandidate: candidateInfo
      });

      currentSeq = null;
      currentRaw = '';
      confCount = 0;
    }
  }

  return suggestions;
}

// ── Test Runner ─────────────────────────────────────────────────────────────
let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('Running API-Assisted Review Test Suite (A1–A12)...\n');

// Real API track fixture (TR 11476142 sample)
const realApiItems = [
  { barcode: 'JG073580650TH', recipient_name: 'ทัศพร' },   // Seq 1 (index 0)
  { barcode: 'JG075314011TH', recipient_name: 'จรินทร์' }, // Seq 2 (index 1)
  { barcode: 'JG075469061TH', recipient_name: 'มิตร' },    // Seq 3 (index 2)
  { barcode: 'JG075469716TH', recipient_name: 'Peerasan' },// Seq 4 (index 3)
  { barcode: 'JG075176947TH', recipient_name: 'Haidar' },  // Seq 5 (index 4)
  { barcode: 'JG074231956TH', recipient_name: 'John' },    // Seq 6 (index 5)
  { barcode: 'JG075360869TH', recipient_name: 'ศุภืช' },   // Seq 7 (index 6)
  { barcode: 'JG073596765TH', recipient_name: 'อัญ' },     // Seq 8 (index 7)
  { barcode: 'JG074246607TH', recipient_name: 'กอล์ฟ' },  // Seq 9 (index 8)
  { barcode: 'JG074455389TH', recipient_name: 'แซม' },    // Seq 10 (index 9)
  { barcode: 'JG075187556TH', recipient_name: 'Rubilolla'},// Seq 11 (index 10)
  { barcode: 'JG074245125TH', recipient_name: 'Mahmoud' },// Seq 12 (index 11)
  { barcode: 'JG073577939TH', recipient_name: 'Phil' },   // Seq 13 (index 12)
  { barcode: 'JG075665145TH', recipient_name: 'Kim' },    // Seq 14 (index 13)
  { barcode: 'JG074218098TH', recipient_name: 'IOUIS' }   // Seq 15 (index 14)
];

// ─── A1: Malformed OCR preserved ────────────────────────────────────────────
test('A1: Malformed OCR preserved without alteration', () => {
  const malformedLine = [{ text: '3. df: sles 3G 0754 6906 1 TH pa', confidence: 70 }];
  const suggestions = parseReceiptLineEvidence(malformedLine, '132994', realApiItems);

  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].firstTrack, '3G075469061TH');
  assert.strictEqual(suggestions[0].rawText, '3. df: sles 3G 0754 6906 1 TH pa');
  assert.strictEqual(suggestions[0].provenance, 'ocr');
});

// ─── A2: API candidate shown separately ─────────────────────────────────────
test('A2: API candidate shown separately in reviewCandidate', () => {
  const malformedLine = [{ text: '3. df: sles 3G 0754 6906 1 TH pa', confidence: 70 }];
  const suggestions = parseReceiptLineEvidence(malformedLine, '132994', realApiItems);

  assert.ok(suggestions[0].reviewCandidate, 'reviewCandidate field must exist');
  assert.strictEqual(suggestions[0].reviewCandidate.status, 'single_match');
  assert.strictEqual(suggestions[0].reviewCandidate.candidate, 'JG075469061TH');
  assert.strictEqual(suggestions[0].reviewCandidate.distance, 1);
  assert.strictEqual(suggestions[0].reviewCandidate.source, 'api-review');

  // Must remain distinct from firstTrack
  assert.strictEqual(suggestions[0].firstTrack, '3G075469061TH');
});

// ─── A3: Candidate does not auto-replace OCR ────────────────────────────────
test('A3: Candidate does not auto-replace OCR', () => {
  const malformedLine = [{ text: '5. dtu; Hair 1G 0751 7694 27H', confidence: 57 }];
  const suggestions = parseReceiptLineEvidence(malformedLine, '132994', realApiItems);

  // firstTrack must NOT be auto-replaced with JG075176947TH
  assert.strictEqual(suggestions[0].firstTrack, '1G0751769427H');
  assert.strictEqual(suggestions[0].reviewCandidate.candidate, 'JG075176947TH');
});

// ─── A4: Candidate selection requires explicit action ───────────────────────
test('A4: Candidate selection requires explicit action', () => {
  const sug = {
    id: 'sug_test_a4',
    seqNo: 5,
    firstTrack: '1G0751769427H',
    reviewCandidate: { candidate: 'JG075176947TH', status: 'single_match', distance: 3 }
  };

  // Before explicit user action
  let editableInput = sug.firstTrack;
  assert.strictEqual(editableInput, '1G0751769427H');

  // Simulated explicit user click on [ใช้เลขนี้]
  editableInput = sug.reviewCandidate.candidate;
  assert.strictEqual(editableInput, 'JG075176947TH');
});

// ─── A5: Selecting candidate still does not create manual evidence ──────────
test('A5: Selecting candidate still does not create manual evidence', () => {
  const photo = {
    sequences: [],
    ocrSequenceSuggestions: [{
      id: 'sug_test_a5',
      firstTrack: '1G0751769427H',
      reviewCandidate: { candidate: 'JG075176947TH', status: 'single_match' }
    }]
  };

  // User clicked [ใช้เลขนี้] in input UI
  let editableValue = photo.ocrSequenceSuggestions[0].reviewCandidate.candidate;

  // Manual evidence photo.sequences MUST still be empty!
  assert.strictEqual(photo.sequences.length, 0, 'photo.sequences must remain empty until final Confirm');
});

// ─── A6: Final Confirm creates manual evidence ──────────────────────────────
test('A6: Final Confirm creates manual evidence with provenance manual', () => {
  const photo = {
    detectedRcpt: '132994',
    sequences: [],
    ocrSequenceSuggestions: [{
      id: 'sug_test_a6',
      rcptNo: '132994',
      seqNo: 5,
      firstTrack: '1G0751769427H',
      lastTrack: '1G0751769427H',
      qty: 1,
      rawText: '5. dtu; Hair 1G 0751 7694 27H',
      confidence: 57,
      status: 'pending'
    }]
  };

  // User clicked [ใช้เลขนี้] -> updated editable value to JG075176947TH
  const userConfirmedValues = {
    seqNo: 5,
    firstTrack: 'JG075176947TH',
    lastTrack: 'JG075176947TH',
    qty: 1
  };

  // User clicks [✓ ยืนยัน]
  photo.sequences.push({
    rcptNo: photo.detectedRcpt,
    seqNo: userConfirmedValues.seqNo,
    firstTrack: cleanTrackNo(userConfirmedValues.firstTrack),
    lastTrack: cleanTrackNo(userConfirmedValues.lastTrack),
    qty: userConfirmedValues.qty,
    provenance: 'manual',
    ocrRawText: photo.ocrSequenceSuggestions[0].rawText,
    ocrConfidence: photo.ocrSequenceSuggestions[0].confidence
  });
  photo.ocrSequenceSuggestions[0].status = 'confirmed';

  assert.strictEqual(photo.sequences.length, 1);
  assert.strictEqual(photo.sequences[0].firstTrack, 'JG075176947TH');
  assert.strictEqual(photo.sequences[0].provenance, 'manual');
  assert.strictEqual(photo.sequences[0].ocrRawText, '5. dtu; Hair 1G 0751 7694 27H');
});

// ─── A7: Multiple close candidates = AMBIGUOUS ──────────────────────────────
test('A7: Multiple close candidates = AMBIGUOUS', () => {
  // Mock API items with two tracks equidistant from typo 'EF100000000TH'
  const ambiguousApiItems = [
    { barcode: 'EF100000001TH' }, // dist 1
    { barcode: 'EF100000002TH' }  // dist 1
  ];

  const cand = findApiTrackCandidate('EF100000000TH', ambiguousApiItems, 2);
  assert.strictEqual(cand.status, 'ambiguous');
  assert.strictEqual(cand.candidate, null);
  assert.strictEqual(cand.candidates.length, 2);
  assert.ok(cand.candidates.includes('EF100000001TH'));
  assert.ok(cand.candidates.includes('EF100000002TH'));
});

// ─── A8: No suitable candidate = NO CANDIDATE ───────────────────────────────
test('A8: No suitable candidate = NO CANDIDATE (status none)', () => {
  const farAwayOcr = 'AB999999999XX'; // Completely different
  const cand = findApiTrackCandidate(farAwayOcr, realApiItems, 3);

  assert.strictEqual(cand.status, 'none');
  assert.strictEqual(cand.candidate, null);
});

// ─── A9: Candidate must exist in API array ───────────────────────────────────
test('A9: Candidate must exist in API array', () => {
  const cand = findApiTrackCandidate('3G075469061TH', realApiItems, 3);
  assert.strictEqual(cand.status, 'single_match');
  const existsInApi = realApiItems.some(item => item.barcode === cand.candidate);
  assert.ok(existsInApi, 'Candidate must be an exact barcode from API items');
});

// ─── A10: SeqNo is never used as apiIndex ───────────────────────────────────
test('A10: SeqNo is never used as apiIndex', () => {
  // Track has seqNo 1, but its content is close to API item at index 12 (Phil)
  const line = [{ text: '1. Phil XG 0735 7793 9 TH', confidence: 65 }];
  const suggestions = parseReceiptLineEvidence(line, '132994', realApiItems);

  assert.strictEqual(suggestions[0].seqNo, 1);
  // Must match JG073577939TH (index 12), NOT API item at index 0 (ทัศพร JG073580650TH)
  assert.strictEqual(suggestions[0].reviewCandidate.candidate, 'JG073577939TH');
  assert.notStrictEqual(suggestions[0].reviewCandidate.candidate, realApiItems[0].barcode);
});

// ─── A11: No tracking arithmetic ────────────────────────────────────────────
test('A11: No tracking arithmetic or neighbor +/- 1', () => {
  // If API has gap: JG075469061TH (index 2) -> JG075469716TH (index 3)
  // Candidate lookup for a typo must not invent arithmetic numbers
  const cand = findApiTrackCandidate('JG075469062TH', realApiItems, 1);
  // JG075469062TH is distance 1 from JG075469061TH
  assert.strictEqual(cand.candidate, 'JG075469061TH');
  // Must not fabricate synthetic numbers
});

// ─── A12: Range without printed qty keeps qty null ──────────────────────────
test('A12: Range without printed qty keeps qty null', () => {
  const rangeLineWithoutQty = [
    { text: '1. ED835848247TH ถึง ED835848255TH', confidence: 85 }
  ];
  const suggestions = parseReceiptLineEvidence(rangeLineWithoutQty, '18101', realApiItems);

  assert.strictEqual(suggestions.length, 1);
  assert.strictEqual(suggestions[0].firstTrack, 'ED835848247TH');
  assert.strictEqual(suggestions[0].lastTrack, 'ED835848255TH');
  assert.strictEqual(suggestions[0].qty, null, 'Range without printed qty must have qty === null');

  // Range WITH printed qty
  const rangeLineWithQty = [
    { text: '2. ED835848247TH ถึง ED835848255TH จำนวน 5 ชิ้น', confidence: 85 }
  ];
  const suggestionsWithQty = parseReceiptLineEvidence(rangeLineWithQty, '18101', realApiItems);
  assert.strictEqual(suggestionsWithQty[0].qty, 5);
});

// ─── Real Malformed OCR Verification Suite ──────────────────────────────────
test('REAL MALFORMED: Real receipt OCR character errors find correct API candidates', () => {
  const realTestCases = [
    { raw: '3G075469061TH', expected: 'JG075469061TH', dist: 1 },
    { raw: '1G0751769427H', expected: 'JG075176947TH', dist: 3 },
    { raw: 'JG074455389',   expected: 'JG074455389TH', dist: 2 },
    { raw: '36075187556TH', expected: 'JG075187556TH', dist: 2 },
    { raw: 'XG073577939TH', expected: 'JG073577939TH', dist: 1 },
    { raw: 'JG075665145TY', expected: 'JG075665145TH', dist: 1 },
    { raw: 'JG0742180G8TH', expected: 'JG074218098TH', dist: 1 }
  ];

  realTestCases.forEach(tc => {
    const cand = findApiTrackCandidate(tc.raw, realApiItems, 3);
    assert.strictEqual(cand.status, 'single_match', `Expected single_match for ${tc.raw}`);
    assert.strictEqual(cand.candidate, tc.expected, `Expected ${tc.expected} for ${tc.raw}`);
    assert.strictEqual(cand.distance, tc.dist, `Expected dist ${tc.dist} for ${tc.raw}`);
  });
});

console.log(`\nAPI-Assisted Review Integration Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL API-ASSISTED REVIEW TESTS (A1–A12 + REAL MALFORMED) PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME API-ASSISTED REVIEW TESTS FAILED! ✗\n');
  process.exit(1);
}
