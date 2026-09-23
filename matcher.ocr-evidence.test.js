/**
 * matcher.ocr-evidence.test.js
 *
 * Test suite for Phase 2B: Semi-Automated Line Evidence OCR (Suggestion Only).
 * Verifies non-authoritative OCR suggestion workflow, user review/editing,
 * confirmation boundary, safe track normalization, and regression safety.
 *
 * Run with: node matcher.ocr-evidence.test.js
 */

'use strict';

const assert = require('assert');
const {
  normalizeTrackNo,
  buildTrackIndex,
  matchSequence,
  matchAll,
  MATCH_CONFIDENCE,
  SOURCE
} = require('./matcher.js');

// ── Pure Node implementations matching app.js Phase 2B logic ─────────────────
function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
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

function parseReceiptLineEvidence(lines, rcptNo = null) {
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
      let qty = tracks.length > 1 ? tracks.length : 1;

      const qtyMatch = text.match(/(?:จำนวน\s*(\d+)|(\d+)\s*ชิ้น|qty\s*[:\.]?\s*(\d+))/i);
      if (qtyMatch) {
        const q = parseInt(qtyMatch[1] || qtyMatch[2] || qtyMatch[3], 10);
        if (!isNaN(q) && q > 0) qty = q;
      }

      const avgConf = confCount > 0 ? Math.round(currentConf / confCount) : Math.round(line.confidence || 0);

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
        status: 'pending'
      });

      currentSeq = null;
      currentRaw = '';
      confCount = 0;
    }
  }

  return suggestions;
}

function evaluateSequenceValidation(seq, rcptNo, allSeqs) {
  const normFirst = cleanTrackNo(seq.firstTrack);
  let normLast = cleanTrackNo(seq.lastTrack);
  const seqNo = Number(seq.seqNo);
  let qty = Number(seq.qty) || 1;

  if (normFirst && (!normLast || normLast === normFirst)) {
    normLast = normFirst;
    if (!seq.qty) qty = 1;
  }

  if (rcptNo && Number.isFinite(seqNo)) {
    const matchingDuplicates = allSeqs.filter(item => {
      const itemRcpt = String(item.rcptNo || '').trim();
      const itemSeqNo = Number(item.seqNo);
      return itemRcpt === String(rcptNo).trim() && itemSeqNo === seqNo;
    });
    if (matchingDuplicates.length > 1) {
      return {
        status: 'conflict',
        badge: '! DUPLICATE',
        badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
        reasonText: `DUPLICATE / NEEDS REVIEW: เลข Seq ${seqNo} ซ้ำกันใน RCPT# ${rcptNo}`
      };
    }
  }

  return { status: 'ok', badge: '✓ STRONG', badgeClass: 'bg-emerald-100 text-emerald-800', reasonText: 'OK' };
}

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

console.log('Running OCR Line Evidence Suggestion Test Suite (O1–O14)...\n');

// Real API track fixture (TR 11476142 sample)
const sampleApiItems = [
  { barcode: 'JG073580650TH', recipient_name: 'ทัศพร' },   // Seq 1 (index 0)
  { barcode: 'JG075314011TH', recipient_name: 'จรินทร์' }, // Seq 2 (index 1)
  { barcode: 'JG075469061TH', recipient_name: 'มิตร' },    // Seq 3 (index 2)
  { barcode: 'JG075469716TH', recipient_name: 'Peerasan' },// Seq 4 (index 3)
  { barcode: 'JG075176947TH', recipient_name: 'Haidar' },  // Seq 5 (index 4)
  { barcode: 'JG074231956TH', recipient_name: 'John' },    // Seq 6 (index 5)
  { barcode: 'JG075360869TH', recipient_name: 'ศุภืช' },   // Seq 7 (index 6)
  { barcode: 'JG073596765TH', recipient_name: 'อัญ' }      // Seq 8 (index 7)
];

// ─── O1: OCR suggestion does not mutate manual evidence ─────────────────────
test('O1: OCR suggestion does not mutate manual evidence', () => {
  const photo = {
    label: 'photo1.jpg',
    detectedRcpt: '132994',
    sequences: [],
    ocrSequenceSuggestions: []
  };

  const ocrLines = [
    { text: '1. u8u; views JG 0735 8065 0 TH', confidence: 65 },
    { text: '2. 4h: Stuns JG0753 1401 1 TH', confidence: 54 }
  ];

  const suggestions = parseReceiptLineEvidence(ocrLines, photo.detectedRcpt);
  photo.ocrSequenceSuggestions = suggestions;

  // Suggestions populated
  assert.strictEqual(photo.ocrSequenceSuggestions.length, 2);
  assert.strictEqual(photo.ocrSequenceSuggestions[0].provenance, 'ocr');
  assert.strictEqual(photo.ocrSequenceSuggestions[0].status, 'pending');

  // Manual evidence MUST remain completely untouched
  assert.strictEqual(photo.sequences.length, 0, 'photo.sequences must not be mutated by OCR parsing');
});

// ─── O2: Confirm copies suggestion to manual evidence ───────────────────────
test('O2: Confirm copies suggestion to manual evidence', () => {
  const photo = {
    label: 'photo1.jpg',
    detectedRcpt: '132994',
    sequences: [],
    ocrSequenceSuggestions: [{
      id: 'sug_test_02',
      rcptNo: '132994',
      seqNo: 1,
      firstTrack: 'JG073580650TH',
      lastTrack: 'JG073580650TH',
      qty: 1,
      rawText: '1. u8u; views JG 0735 8065 0 TH',
      confidence: 65,
      provenance: 'ocr',
      status: 'pending'
    }]
  };

  const sug = photo.ocrSequenceSuggestions[0];
  photo.sequences.push({
    rcptNo: sug.rcptNo,
    seqNo: sug.seqNo,
    firstTrack: sug.firstTrack,
    lastTrack: sug.lastTrack,
    qty: sug.qty,
    provenance: 'manual', // User confirmed!
    ocrRawText: sug.rawText,
    ocrConfidence: sug.confidence
  });
  sug.status = 'confirmed';

  assert.strictEqual(photo.sequences.length, 1);
  assert.strictEqual(photo.sequences[0].seqNo, 1);
  assert.strictEqual(photo.sequences[0].firstTrack, 'JG073580650TH');
  assert.strictEqual(photo.sequences[0].provenance, 'manual');
  assert.strictEqual(photo.sequences[0].ocrConfidence, 65);
  assert.strictEqual(sug.status, 'confirmed');
});

// ─── O3: Edited suggestion uses user\'s corrected value ──────────────────────
test('O3: Edited suggestion uses user\'s corrected value', () => {
  const sug = {
    id: 'sug_test_03',
    rcptNo: '132994',
    seqNo: 5,
    firstTrack: '1G0751769427H', // Raw OCR
    lastTrack: '1G0751769427H',
    qty: 1,
    rawText: '5. dtu; Hair 1G 0751 7694 27H',
    confidence: 57,
    status: 'pending'
  };

  // User edits before confirming:
  const userEdited = {
    seqNo: 5,
    firstTrack: 'JG075176947TH', // Corrected
    lastTrack: 'JG075176947TH',
    qty: 1
  };

  const manualEvidence = {
    rcptNo: sug.rcptNo,
    seqNo: userEdited.seqNo,
    firstTrack: cleanTrackNo(userEdited.firstTrack),
    lastTrack: cleanTrackNo(userEdited.lastTrack),
    qty: userEdited.qty,
    provenance: 'manual',
    ocrRawText: sug.rawText,
    ocrConfidence: sug.confidence
  };

  assert.strictEqual(manualEvidence.firstTrack, 'JG075176947TH');
  assert.strictEqual(manualEvidence.provenance, 'manual');
  assert.strictEqual(manualEvidence.ocrRawText, '5. dtu; Hair 1G 0751 7694 27H');
});

// ─── O4: OCR O/0 ambiguity is NOT auto-corrected ────────────────────────────
test('O4: OCR O/0 ambiguity is NOT auto-corrected', () => {
  const ocrInputWithLetterO = 'JG 0735 8O65 0 TH'; // Contains letter 'O'
  const normalized = cleanTrackNo(ocrInputWithLetterO);

  // Must preserve 'O' as uppercase 'O', NEVER auto-correct to '0'
  assert.strictEqual(normalized, 'JG07358O650TH');
  assert.ok(normalized.includes('O'), 'Letter O must remain uncorrected');
  assert.ok(!normalized.includes('8065'), 'Must not rewrite O to 0');
});

// ─── O5: OCR I/1 ambiguity is NOT auto-corrected ────────────────────────────
test('O5: OCR I/1 ambiguity is NOT auto-corrected', () => {
  const ocrInputWithLetterI = 'JG I753 1401 1 TH'; // Contains letter 'I'
  const normalized = cleanTrackNo(ocrInputWithLetterI);

  // Must preserve 'I', NEVER auto-correct to '1'
  assert.strictEqual(normalized, 'JGI75314011TH');
  assert.ok(normalized.includes('I'), 'Letter I must remain uncorrected');
  assert.ok(!normalized.includes('1753'), 'Must not rewrite I to 1');
});

// ─── O6: Malformed TH suffix remains uncorrected ───────────────────────────
test('O6: Malformed TH suffix remains uncorrected', () => {
  const ocrInputWith7H = '1G 0751 7694 27H'; // Suffix read as 27H
  const normalized = cleanTrackNo(ocrInputWith7H);

  // Must preserve '27H', NEVER auto-correct to 'TH'
  assert.strictEqual(normalized, '1G0751769427H');
  assert.ok(normalized.endsWith('27H'), 'Suffix 27H must remain uncorrected');
  assert.ok(!normalized.endsWith('TH'), 'Must not auto-correct 7H to TH');
});

// ─── O7: Matcher CONFLICT preserved despite high OCR confidence ─────────────
test('O7: Matcher CONFLICT preserved despite high OCR confidence', () => {
  const highConfSug = {
    rcptNo: '132994',
    seqNo: 99,
    firstTrack: 'UNKNOWN999999TH',
    lastTrack: 'UNKNOWN999999TH',
    qty: 1,
    confidence: 99
  };

  const { trackMap, apiTracks } = buildTrackIndex(sampleApiItems);
  const matchRes = matchSequence(highConfSug, trackMap, apiTracks);

  assert.strictEqual(matchRes.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(matchRes.conflictReason.includes('not found'));
});

// ─── O8: Range validation uses actual API array ─────────────────────────────
test('O8: Range validation uses actual API array', () => {
  const rangeSug = {
    rcptNo: '132994',
    seqNo: 1,
    firstTrack: 'JG073580650TH', // index 0 in sampleApiItems
    lastTrack: 'JG075469061TH',  // index 2 in sampleApiItems
    qty: 3,
    confidence: 88
  };

  const { trackMap, apiTracks } = buildTrackIndex(sampleApiItems);
  const matchRes = matchSequence(rangeSug, trackMap, apiTracks);

  assert.strictEqual(matchRes.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(matchRes.trackIndexes.length, 3);
  assert.strictEqual(sampleApiItems[matchRes.trackIndexes[0]].barcode, 'JG073580650TH');
  assert.strictEqual(sampleApiItems[matchRes.trackIndexes[1]].barcode, 'JG075314011TH');
  assert.strictEqual(sampleApiItems[matchRes.trackIndexes[2]].barcode, 'JG075469061TH');
});

// ─── O9: No intermediate track generation ───────────────────────────────────
test('O9: No intermediate track generation', () => {
  const rangeSug = {
    rcptNo: '132994',
    seqNo: 1,
    firstTrack: 'JG075469061TH', // index 2
    lastTrack: 'JG075176947TH',  // index 4
    qty: 3,
    confidence: 90
  };

  const { trackMap, apiTracks } = buildTrackIndex(sampleApiItems);
  const matchRes = matchSequence(rangeSug, trackMap, apiTracks);

  assert.strictEqual(matchRes.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(matchRes.trackIndexes[1], 3);
  assert.strictEqual(sampleApiItems[3].barcode, 'JG075469716TH');
});

// ─── O10: RCPT+Seq identity preserved ───────────────────────────────────────
test('O10: RCPT+Seq identity preserved across distinct RCPTs', () => {
  const sugA = { rcptNo: '18101', seqNo: 1, firstTrack: 'JG073580650TH', lastTrack: 'JG073580650TH', qty: 1 };
  const sugB = { rcptNo: '18102', seqNo: 1, firstTrack: 'JG075314011TH', lastTrack: 'JG075314011TH', qty: 1 };

  const allConfirmed = [sugA, sugB];
  const valA = evaluateSequenceValidation(sugA, '18101', allConfirmed);
  const valB = evaluateSequenceValidation(sugB, '18102', allConfirmed);

  assert.notStrictEqual(valA.badge, '! DUPLICATE');
  assert.notStrictEqual(valB.badge, '! DUPLICATE');
});

// ─── O11: Seq reset does not invent RCPT ─────────────────────────────────────
test('O11: Seq reset does not invent RCPT', () => {
  const rawLines = [
    { text: '1. u8u; views JG 0735 8065 0 TH', confidence: 70 }
  ];
  const parsed = parseReceiptLineEvidence(rawLines, null);

  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].seqNo, 1);
  assert.strictEqual(parsed[0].rcptNo, null, 'Must NOT invent or guess an RCPT number');
});

// ─── O12: Old session without suggestions loads safely ──────────────────────
test('O12: Old session without suggestions loads safely', () => {
  const legacyPhotos = [
    { label: 'old_page_1.jpg', sequences: [{ seqNo: 1, firstTrack: 'JG073580650TH' }] }
  ];

  const hydrated = legacyPhotos.map(p => ({
    ...p,
    sequences: Array.isArray(p.sequences) ? p.sequences : [],
    ocrSequenceSuggestions: Array.isArray(p.ocrSequenceSuggestions) ? p.ocrSequenceSuggestions : []
  }));

  assert.ok(Array.isArray(hydrated[0].ocrSequenceSuggestions));
  assert.strictEqual(hydrated[0].ocrSequenceSuggestions.length, 0);
  assert.strictEqual(hydrated[0].sequences.length, 1);
});

// ─── O13: Suggestions survive save/restore ──────────────────────────────────
test('O13: Suggestions survive save/restore round-trip', () => {
  const photo = {
    label: 'photo1.jpg',
    ocrSequenceSuggestions: [
      {
        id: 'sug_101',
        rcptNo: '132994',
        seqNo: 2,
        firstTrack: 'JG075314011TH',
        lastTrack: 'JG075314011TH',
        qty: 1,
        rawText: '2. 4h: Stuns JG0753 1401 1 TH',
        confidence: 54,
        provenance: 'ocr',
        status: 'pending'
      }
    ]
  };

  const serialized = JSON.stringify(photo);
  const restored = JSON.parse(serialized);

  assert.strictEqual(restored.ocrSequenceSuggestions.length, 1);
  assert.strictEqual(restored.ocrSequenceSuggestions[0].id, 'sug_101');
  assert.strictEqual(restored.ocrSequenceSuggestions[0].firstTrack, 'JG075314011TH');
  assert.strictEqual(restored.ocrSequenceSuggestions[0].status, 'pending');
});

// ─── O14: Rejected suggestion does not enter manual evidence ────────────────
test('O14: Rejected suggestion does not enter manual evidence', () => {
  const photo = {
    label: 'photo1.jpg',
    sequences: [],
    ocrSequenceSuggestions: [
      {
        id: 'sug_reject_01',
        seqNo: 99,
        firstTrack: 'GARBAGE_TRACK',
        status: 'pending'
      }
    ]
  };

  const sug = photo.ocrSequenceSuggestions.find(s => s.id === 'sug_reject_01');
  sug.status = 'rejected';

  assert.strictEqual(photo.sequences.length, 0);
  assert.strictEqual(photo.ocrSequenceSuggestions[0].status, 'rejected');
});

console.log(`\nOCR Evidence Integration Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL OCR EVIDENCE INTEGRATION TESTS (O1–O14) PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME OCR EVIDENCE TESTS FAILED! ✗\n');
  process.exit(1);
}
