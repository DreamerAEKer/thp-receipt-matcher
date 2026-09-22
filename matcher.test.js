/**
 * matcher.test.js — Test suite for Receipt / RCPT / Sequence / Track Range Matcher
 * Covers TC1 through TC15 plus verification of NO arithmetic track generation.
 * Run with: node matcher.test.js
 */

'use strict';

const assert = require('assert');
const {
  normalizeTrackNo,
  buildTrackIndex,
  matchSequence,
  detectRcptBoundary,
  groupItemsByRcpt,
  matchReceiptGroup,
  matchAll,
  MATCH_CONFIDENCE,
  SOURCE,
  RCPT_SOURCE_PRIORITY
} = require('./matcher.js');

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

console.log('Running Matcher Engine Test Suite (TC1–TC15)...\n');

// ─── TC1: Single RCPT ────────────────────────────────────────────────────────
test('TC1: Single TR + single RCPT (all 26 items matched, strong confidence)', () => {
  // Generate 26 distinct API items
  const apiItems = Array.from({ length: 26 }, (_, i) => ({
    barcode: `TH${String(100000 + i)}TH`,
    recipient_name: `Recipient ${i + 1}`
  }));

  const sequences = apiItems.map((item, idx) => ({
    rcptNo: '18101',
    seqNo: idx + 1,
    firstTrack: item.barcode,
    lastTrack: item.barcode,
    qty: 1,
    fieldSources: { rcptNo: 'manual', seqNo: 'ocr', firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
  }));

  const { trackMap, apiTracks, groups } = matchAll({
    trNo: '11489115',
    apiItems,
    sequences
  });

  assert.strictEqual(groups.length, 1, 'Should have exactly 1 group');
  assert.strictEqual(groups[0].rcptNo, '18101');
  assert.strictEqual(groups[0].sequences.length, 26);
  groups[0].sequences.forEach((seq, idx) => {
    assert.strictEqual(seq.confidence, MATCH_CONFIDENCE.STRONG, `Item ${idx} must be STRONG`);
    assert.strictEqual(seq.apiStartIndex, idx);
    assert.strictEqual(seq.apiEndIndex, idx);
    assert.deepStrictEqual(seq.trackIndexes, [idx]);
  });
});

// ─── TC2: 2 RCPTs both starting at Seq 1 ─────────────────────────────────────
test('TC2: TR single + 2 RCPTs both starting at Seq 1', () => {
  const apiItems = [
    { barcode: 'RC1001TH' },
    { barcode: 'RC1002TH' },
    { barcode: 'RC2001TH' },
    { barcode: 'RC2002TH' }
  ];

  const sequences = [
    { rcptNo: '18101', seqNo: 1, firstTrack: 'RC1001TH', lastTrack: 'RC1001TH', qty: 1, fieldSources: { rcptNo: 'ocr' } },
    { rcptNo: '18101', seqNo: 2, firstTrack: 'RC1002TH', lastTrack: 'RC1002TH', qty: 1, fieldSources: { rcptNo: 'ocr' } },
    { rcptNo: '18102', seqNo: 1, firstTrack: 'RC2001TH', lastTrack: 'RC2001TH', qty: 1, fieldSources: { rcptNo: 'ocr' } },
    { rcptNo: '18102', seqNo: 2, firstTrack: 'RC2002TH', lastTrack: 'RC2002TH', qty: 1, fieldSources: { rcptNo: 'ocr' } }
  ];

  const { groups } = matchAll({ trNo: '11489115', apiItems, sequences });

  assert.strictEqual(groups.length, 2, 'Should create 2 RCPT groups');
  assert.strictEqual(groups[0].rcptNo, '18101');
  assert.strictEqual(groups[1].rcptNo, '18102');

  assert.strictEqual(groups[0].sequences[0].seqNo, 1);
  assert.strictEqual(groups[0].sequences[0].matchedTracks[0].trackNo, 'RC1001TH');
  assert.strictEqual(groups[0].sequences[0].confidence, MATCH_CONFIDENCE.STRONG);

  assert.strictEqual(groups[1].sequences[0].seqNo, 1);
  assert.strictEqual(groups[1].sequences[0].matchedTracks[0].trackNo, 'RC2001TH');
  assert.strictEqual(groups[1].sequences[0].confidence, MATCH_CONFIDENCE.STRONG);
});

// ─── TC3: Single Track ────────────────────────────────────────────────────────
test('TC3: Sequence = single track (firstTrack === lastTrack, qty=1)', () => {
  const apiItems = [{ barcode: 'JG073580650TH' }];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    rcptNo: '18101',
    seqNo: 1,
    firstTrack: 'JG073580650TH',
    lastTrack: 'JG073580650TH',
    qty: 1,
    fieldSources: { firstTrack: 'ocr', lastTrack: 'ocr' }
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.STRONG);
  assert.deepStrictEqual(res.trackIndexes, [0]);
  assert.strictEqual(res.matchedTracks[0].trackNo, 'JG073580650TH');
  assert.strictEqual(res.conflictReason, null);
});

// ─── TC4: Multi-Track Range ──────────────────────────────────────────────────
test('TC4: Sequence = track range (multiple tracks in real API order)', () => {
  const apiItems = [
    { barcode: 'RJ317132454TH' },
    { barcode: 'RJ317132468TH' },
    { barcode: 'RJ317132471TH' },
    { barcode: 'RJ317133429TH' }
  ];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    rcptNo: '18101',
    seqNo: 1,
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133429TH',
    qty: 4,
    fieldSources: { firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(res.apiStartIndex, 0);
  assert.strictEqual(res.apiEndIndex, 3);
  assert.deepStrictEqual(res.trackIndexes, [0, 1, 2, 3]);
  assert.strictEqual(res.matchedTracks.length, 4);
  assert.strictEqual(res.matchedTracks[0].trackNo, 'RJ317132454TH');
  assert.strictEqual(res.matchedTracks[3].trackNo, 'RJ317133429TH');
});

// ─── TC5: Range + qty Matches Exact ──────────────────────────────────────────
test('TC5: Track range + qty matches exact slice', () => {
  const apiItems = [
    { barcode: 'AA001TH' },
    { barcode: 'AA002TH' },
    { barcode: 'AA003TH' }
  ];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'AA001TH',
    lastTrack: 'AA003TH',
    qty: 3
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(res.trackIndexes.length, 3);
  assert.strictEqual(res.conflictReason, null);
});

// ─── TC6: Track range + qty Mismatches → CONFLICT ────────────────────────────
test('TC6: Track range + qty mismatches (declared 49, API slice 48) → CONFLICT', () => {
  // Create 48 items in API
  const apiItems = Array.from({ length: 48 }, (_, i) => ({
    barcode: `RJ3171000${String(i).padStart(2, '0')}TH`
  }));
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: apiItems[0].barcode,
    lastTrack: apiItems[47].barcode,
    qty: 49 // Declared 49 on receipt, but API only has 48
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT, 'Must be CONFLICT when qty mismatches');
  assert.ok(res.conflictReason.includes('qty mismatch'), 'Reason must mention qty mismatch');
});

// ─── TC7: firstTrack Not Found → CONFLICT ────────────────────────────────────
test('TC7: firstTrack not found in API array → CONFLICT', () => {
  const apiItems = [{ barcode: 'AA001TH' }, { barcode: 'AA002TH' }];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'UNKNOWN999TH',
    lastTrack: 'AA002TH',
    qty: 2
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(res.conflictReason.includes('firstTrack "UNKNOWN999TH" not found'));
});

// ─── TC8: lastTrack Not Found → CONFLICT ─────────────────────────────────────
test('TC8: lastTrack not found in API array → CONFLICT', () => {
  const apiItems = [{ barcode: 'AA001TH' }, { barcode: 'AA002TH' }];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'AA001TH',
    lastTrack: 'UNKNOWN999TH',
    qty: 2
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(res.conflictReason.includes('lastTrack "UNKNOWN999TH" not found'));
});

// ─── TC9: Duplicate seqNo in Different RCPTs ─────────────────────────────────
test('TC9: Duplicate seqNo in different RCPTs (distinct, no collision)', () => {
  const sequences = [
    { rcptNo: '18101', seqNo: 1, firstTrack: 'A1TH', lastTrack: 'A1TH', qty: 1 },
    { rcptNo: '18101', seqNo: 2, firstTrack: 'A2TH', lastTrack: 'A2TH', qty: 1 },
    { rcptNo: '18102', seqNo: 1, firstTrack: 'B1TH', lastTrack: 'B1TH', qty: 1 },
    { rcptNo: '18102', seqNo: 2, firstTrack: 'B2TH', lastTrack: 'B2TH', qty: 1 }
  ];

  const groups = groupItemsByRcpt('11489115', sequences);
  assert.strictEqual(groups.length, 2);

  const g1 = groups.find(g => g.rcptNo === '18101');
  const g2 = groups.find(g => g.rcptNo === '18102');

  assert.ok(g1 && g2, 'Both RCPT groups must exist');
  assert.strictEqual(g1.sequences[0].seqNo, 1);
  assert.strictEqual(g1.sequences[0].firstTrack, 'A1TH');
  assert.strictEqual(g2.sequences[0].seqNo, 1);
  assert.strictEqual(g2.sequences[0].firstTrack, 'B1TH');
  assert.notStrictEqual(g1.sequences[0], g2.sequences[0], 'Must be distinct sequence objects');
});

// ─── TC10: Duplicate Normalized Track → AMBIGUOUS / CONFLICT ────────────────
test('TC10: Duplicate normalized Track in API array → AMBIGUOUS / CONFLICT', () => {
  const apiItems = [
    { barcode: 'DUP100TH' },
    { barcode: 'UNIQ200TH' },
    { barcode: 'DUP100TH' } // Duplicate!
  ];

  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  // Check trackMap entry
  const entry = trackMap.get('DUP100TH');
  assert.ok(entry, 'Entry should exist in map');
  assert.strictEqual(entry.AMBIGUOUS, true, 'Entry must be flagged AMBIGUOUS');
  assert.strictEqual(entry.entries.length, 2, 'Entry must contain both duplicate occurrences');

  // Attempt to match sequence using ambiguous track as anchor
  const seq = {
    firstTrack: 'DUP100TH',
    lastTrack: 'UNIQ200TH',
    qty: 2
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT, 'Must not auto-match ambiguous track');
  assert.ok(res.conflictReason.includes('AMBIGUOUS_TRACK'), 'Reason must mention AMBIGUOUS_TRACK');
});

// ─── TC11: firstTrack Index > lastTrack Index → CONFLICT ─────────────────────
test('TC11: firstTrack index > lastTrack index (reversed order) → CONFLICT', () => {
  const apiItems = [
    { barcode: 'START100TH' }, // index 0
    { barcode: 'MID200TH' },   // index 1
    { barcode: 'END300TH' }    // index 2
  ];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'END300TH',   // index 2
    lastTrack: 'START100TH',  // index 0 -> reversed!
    qty: 2
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(res.conflictReason.includes('reversed order'), 'Reason must state reversed order');
});

// ─── TC12: Spacing and Case Normalization ────────────────────────────────────
test('TC12: Normalize spacing and case: "RJ 3171 3245 4 TH" matches "rj317132454th"', () => {
  const apiItems = [{ barcode: 'rj317132454th' }];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'RJ 3171 3245 4 TH',
    lastTrack: 'rj 3171 3245 4 th',
    qty: 1
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(res.matchedTracks[0].trackNo, 'RJ317132454TH');
});

// ─── TC13: firstTrack Only + qty=1 → Candidate (MEDIUM, not Strong) ──────────
test('TC13: OCR/manual has only firstTrack and qty=1 → candidate (MEDIUM, not Strong)', () => {
  const apiItems = [{ barcode: 'RJ317132454TH' }, { barcode: 'RJ317133429TH' }];
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'RJ317132454TH',
    lastTrack: null, // No lastTrack provided
    qty: 1
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.MEDIUM, 'Must be MEDIUM (candidate only, incomplete evidence)');
  assert.ok(res.conflictReason.includes('candidate only') || res.conflictReason.includes('not provided'));
  assert.notStrictEqual(res.confidence, MATCH_CONFIDENCE.STRONG, 'Must NOT be Strong');
});

// ─── TC14: Same seqNo + rcptNo=null → ห้าม merge โดยเดา ─────────────────────
test('TC14: Same seqNo with rcptNo=null → preserve independently, do NOT merge', () => {
  const sequences = [
    { rcptNo: null, seqNo: 1, firstTrack: 'TRK001TH', lastTrack: 'TRK001TH', qty: 1 },
    { rcptNo: null, seqNo: 1, firstTrack: 'TRK002TH', lastTrack: 'TRK002TH', qty: 1 }
  ];

  const groups = groupItemsByRcpt('11489115', sequences);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].sequences.length, 2, 'Both sequences must be retained independently');
  assert.strictEqual(groups[0].sequences[0].firstTrack, 'TRK001TH');
  assert.strictEqual(groups[0].sequences[1].firstTrack, 'TRK002TH');
});

// ─── TC15: Sequence Reset without RCPT Evidence → Inferred Boundary Only ─────
test('TC15: Sequence reset without RCPT evidence → inferred boundary only (not confirmed)', () => {
  const sequences = [
    { rcptNo: null, seqNo: 1, firstTrack: 'A1TH' },
    { rcptNo: null, seqNo: 2, firstTrack: 'A2TH' },
    { rcptNo: null, seqNo: 3, firstTrack: 'A3TH' },
    { rcptNo: null, seqNo: 1, firstTrack: 'B1TH' }, // Sequence reset to 1!
    { rcptNo: null, seqNo: 2, firstTrack: 'B2TH' }
  ];

  const boundaries = detectRcptBoundary(sequences);
  assert.deepStrictEqual(boundaries, [0, 3], 'Boundary should be detected at index 0 and 3');

  const groups = groupItemsByRcpt('11489115', sequences);
  assert.strictEqual(groups.length, 2, 'Should split into 2 inferred groups');

  // Both groups must have rcptNo: null and rcptSource: 'inferred'
  assert.strictEqual(groups[0].rcptNo, null);
  assert.strictEqual(groups[0].rcptSource, SOURCE.INFERRED);
  assert.strictEqual(groups[0].sequences.length, 3);

  assert.strictEqual(groups[1].rcptNo, null);
  assert.strictEqual(groups[1].rcptSource, SOURCE.INFERRED);
  assert.strictEqual(groups[1].sequences.length, 2);
});

// ─── SAFETY AUDIT: Verification of NO Arithmetic Track Generation ─────────────
test('SAFETY AUDIT: Track Range uses API array elements, NO arithmetic track generation', () => {
  // Discontinuous barcodes that cannot be derived by arithmetic (+1)
  const apiItems = [
    { barcode: 'RJ317132454TH' }, // check digit 4
    { barcode: 'XA999999999TH' }, // completely different prefix
    { barcode: 'EM123456789TH' }, // different service
    { barcode: 'RJ317133429TH' }  // end of range
  ];

  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  const seq = {
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133429TH',
    qty: 4
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(res.matchedTracks.length, 4);

  // Verify that the middle items are strictly the ones from the array
  assert.strictEqual(res.matchedTracks[1].trackNo, 'XA999999999TH');
  assert.strictEqual(res.matchedTracks[2].trackNo, 'EM123456789TH');
  assert.strictEqual(res.matchedTracks[0].raw, apiItems[0]);
  assert.strictEqual(res.matchedTracks[1].raw, apiItems[1]);
  assert.strictEqual(res.matchedTracks[2].raw, apiItems[2]);
  assert.strictEqual(res.matchedTracks[3].raw, apiItems[3]);
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error(`FAILED: ${totalTests - passedTests} test(s) failed.\n`);
  process.exit(1);
}
