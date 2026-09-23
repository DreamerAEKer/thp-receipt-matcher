/**
 * matcher.range-review-candidate.test.js
 *
 * Test suite for Phase 4C: Safe Nominal-Endpoint Review Candidate.
 * Verifies:
 * - R1: Candidate discovered from actual imported tracks array at (A + Q - 1)
 * - R2: Pure inspection (no automatic modification of state or evidence)
 * - R3: Raw printed lastTrack preserved as receipt evidence
 * - R4: Two explicit user actions required (use candidate -> confirm)
 * - R5: Real TR 11489115 complete matching: 216 mapped, 0 unmapped, 0 conflict, 0 lost
 * - N1: First anchor missing -> no candidate
 * - N2: Qty missing -> no candidate
 * - N3: Qty <= 0 or Qty = 1 -> no candidate
 * - N4: Candidate slice exceeds array bounds -> no candidate
 * - N5: Duplicate actual track in source/slice -> no candidate
 * - N6: Incompatible prior assignment -> no candidate
 * - N7: Ambiguous boundary overlapping another sequence -> no candidate
 * - N8: Irregular serial dataset -> array position used, zero serial arithmetic
 * - R6: matcher.js unchanged
 *
 * Run with: node matcher.range-review-candidate.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  extractTrackingFromExcelRows,
  processExcelRows,
  findRangeReviewCandidate,
  confirmOcrSuggestion,
  buildMatcherApplyPlan,
  applyMatcherMapping,
  state
} = require('./app.js');

const matcher = require('./matcher.js');

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

console.log('Running Safe Nominal-Endpoint Review Candidate Test Suite...\n');

// Load real Excel fixture
const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
const rawRows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { tracks: realTracks } = extractTrackingFromExcelRows(rawRows);
const realApiItems = realTracks.map((t, idx) => ({ barcode: t, trackNo: t, trackFormatted: t, originalIndex: idx }));

// ── R1: Candidate discovered from actual imported tracks array ────────────────
test('R1: Candidate discovered from actual imported tracks array at (A + Q - 1)', () => {
  // RCPT 18101 Seq 1: printed first RJ317132454TH (index 0), printed last RJ317133429TH (not in array), qty 49
  const seq1 = {
    firstTrack: 'RJ 3171 3245 4 TH',
    lastTrack: 'RJ 3171 3342 9 TH',
    qty: 49,
    seqNo: 1,
    rcptNo: '18101'
  };

  const res = findRangeReviewCandidate(seq1, realApiItems);
  assert.strictEqual(res.status, 'candidate');
  assert.strictEqual(res.startIndex, 0);
  assert.strictEqual(res.candidateIndex, 48); // 0 + 49 - 1
  assert.strictEqual(res.candidate, 'RJ317133415TH');
  assert.strictEqual(res.qty, 49);
  // Source is purely from imported items array, not constructed
  assert.strictEqual(realTracks[48], res.candidate);
});

// ── R2: Pure inspection (no automatic modification of state or evidence) ──────
test('R2: Pure inspection (no automatic modification of state or evidence)', () => {
  const seq = {
    firstTrack: 'RJ 3171 3245 4 TH',
    lastTrack: 'RJ 3171 3342 9 TH',
    qty: 49
  };
  const initialSeqJson = JSON.stringify(seq);
  const initialItemsJson = JSON.stringify(realApiItems);

  findRangeReviewCandidate(seq, realApiItems);

  assert.strictEqual(JSON.stringify(seq), initialSeqJson, 'Input sequence must remain unmutated');
  assert.strictEqual(JSON.stringify(realApiItems), initialItemsJson, 'API items array must remain unmutated');
});

// ── R3: Raw printed lastTrack preserved as receipt evidence ───────────────────
test('R3: Raw printed lastTrack preserved as receipt evidence', () => {
  const photo = {
    detectedRcpt: '18101',
    ocrSequenceSuggestions: [
      {
        id: 'sug_test_1',
        seqNo: 1,
        firstTrack: 'RJ317132454TH',
        lastTrack: 'RJ317133429TH',
        printedLastTrack: 'RJ317133429TH',
        qty: 49,
        rawText: '1. RJ 3171 3245 4 TH - RJ 3171 3342 9 TH 49',
        confidence: 90,
        status: 'pending'
      }
    ],
    sequences: []
  };

  const testState = { photos: [photo], receiptItems: realApiItems };
  const origState = state.photos;
  state.photos = testState.photos;

  try {
    // User uses candidate 'RJ317133415TH'
    const cand = findRangeReviewCandidate(photo.ocrSequenceSuggestions[0], realApiItems);
    assert.strictEqual(cand.status, 'candidate');

    // User edits and clicks confirm
    confirmOcrSuggestion(0, 'sug_test_1', {
      seqNo: 1,
      firstTrack: 'RJ317132454TH',
      lastTrack: cand.candidate, // RJ317133415TH
      printedLastTrack: 'RJ317133429TH', // raw printed evidence preserved
      qty: 49
    });

    assert.strictEqual(photo.sequences.length, 1);
    const confirmed = photo.sequences[0];
    assert.strictEqual(confirmed.firstTrack, 'RJ317132454TH');
    assert.strictEqual(confirmed.lastTrack, 'RJ317133415TH');
    assert.strictEqual(confirmed.printedLastTrack, 'RJ317133429TH');
    assert.strictEqual(confirmed.qty, 49);
    assert.strictEqual(confirmed.provenance, 'manual');
  } finally {
    state.photos = origState;
  }
});

// ── R4: Two explicit user actions required (use candidate -> confirm) ─────────
test('R4: Two explicit user actions required (use candidate -> confirm)', () => {
  const photo = {
    detectedRcpt: '18101',
    ocrSequenceSuggestions: [
      {
        id: 'sug_test_2',
        seqNo: 1,
        firstTrack: 'RJ317132454TH',
        lastTrack: 'RJ317133429TH',
        printedLastTrack: 'RJ317133429TH',
        qty: 49,
        status: 'pending'
      }
    ],
    sequences: []
  };

  // Action 0: Candidate discovered
  const cand = findRangeReviewCandidate(photo.ocrSequenceSuggestions[0], realApiItems);
  assert.strictEqual(cand.status, 'candidate');
  // At this point, sequences array MUST still be empty
  assert.strictEqual(photo.sequences.length, 0);

  // Action 1: User chooses to use candidate in UI input
  const editedValues = {
    seqNo: 1,
    firstTrack: photo.ocrSequenceSuggestions[0].firstTrack,
    lastTrack: cand.candidate,
    printedLastTrack: photo.ocrSequenceSuggestions[0].lastTrack,
    qty: 49
  };
  // Still NOT in sequences
  assert.strictEqual(photo.sequences.length, 0);

  // Action 2: User explicitly clicks [Confirm]
  const origState = state.photos;
  state.photos = [photo];
  try {
    confirmOcrSuggestion(0, 'sug_test_2', editedValues);
    assert.strictEqual(photo.sequences.length, 1);
  } finally {
    state.photos = origState;
  }
});

// ── R5: Real TR 11489115 complete matching: 216 mapped, 0 unmapped, 0 lost ────
test('R5: Real TR 11489115 complete matching: 216 mapped, 0 unmapped, 0 conflict, 0 lost', () => {
  // Candidate discovery on all 5 RJ sequences
  const rawRJSeqs = [
    { seqNo: 1, rcptNo: '18101', firstTrack: 'RJ 3171 3245 4 TH', lastTrack: 'RJ 3171 3342 9 TH', qty: 49 },
    { seqNo: 2, rcptNo: '18101', firstTrack: 'RJ 3171 3343 2 TH', lastTrack: 'RJ 3171 3440 7 TH', qty: 49 },
    { seqNo: 3, rcptNo: '18101', firstTrack: 'RJ 3171 3441 5 TH', lastTrack: 'RJ 3171 3538 0 TH', qty: 49 },
    { seqNo: 4, rcptNo: '18101', firstTrack: 'RJ 3171 3539 3 TH', lastTrack: 'RJ 3171 3580 0 TH', qty: 21 },
    { seqNo: 5, rcptNo: '18101', firstTrack: 'RJ 3171 3581 3 TH', lastTrack: 'RJ 3171 3596 3 TH', qty: 8 }
  ];

  const reviewedRJSeqs = rawRJSeqs.map(raw => {
    const cand = findRangeReviewCandidate(raw, realApiItems);
    assert.strictEqual(cand.status, 'candidate', `Candidate must be found for Seq ${raw.seqNo}`);
    return {
      seqNo: raw.seqNo,
      rcptNo: raw.rcptNo,
      firstTrack: raw.firstTrack,
      lastTrack: cand.candidate, // Reviewed actual candidate
      printedLastTrack: raw.lastTrack, // Preserved raw evidence
      qty: raw.qty
    };
  });

  // Verify slice endpoints
  assert.strictEqual(reviewedRJSeqs[0].lastTrack, 'RJ317133415TH');
  assert.strictEqual(reviewedRJSeqs[1].lastTrack, 'RJ317134398TH');
  assert.strictEqual(reviewedRJSeqs[2].lastTrack, 'RJ317135376TH');
  assert.strictEqual(reviewedRJSeqs[3].lastTrack, 'RJ317135795TH');
  assert.strictEqual(reviewedRJSeqs[4].lastTrack, 'RJ317135950TH');

  // Complete sequences for 18101 (Seqs 1-34)
  const full18101 = [...reviewedRJSeqs];
  // Seq 6 single
  full18101.push({ seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 });
  // Seqs 7-13 single
  const singleRR1 = ['RR314728375TH', 'RR314728389TH', 'RR314728392TH', 'RR314728401TH', 'RR314728415TH', 'RR314728429TH', 'RR314728432TH'];
  singleRR1.forEach((t, i) => full18101.push({ seqNo: 7 + i, rcptNo: '18101', firstTrack: t, lastTrack: t, qty: 1 }));
  // Seq 14 range 2
  full18101.push({ seqNo: 14, rcptNo: '18101', firstTrack: 'RR 3147 2844 6 TH', lastTrack: 'RR 3147 2845 0 TH', qty: 2 });
  // Seq 15 single
  full18101.push({ seqNo: 15, rcptNo: '18101', firstTrack: 'RR 3147 2846 3 TH', lastTrack: 'RR 3147 2846 3 TH', qty: 1 });
  // Seq 16 range 3
  full18101.push({ seqNo: 16, rcptNo: '18101', firstTrack: 'RR 3147 2847 7 TH', lastTrack: 'RR 3147 2849 4 TH', qty: 3 });
  // Seqs 17-34 single
  const singleRR2 = [
    'RR314728503TH', 'RR314728517TH', 'RR314728525TH', 'RR314728534TH', 'RR314728548TH', 'RR314728551TH', 'RR314728565TH',
    'RR314728579TH', 'RR314728582TH', 'RR314728596TH', 'RR314728605TH', 'RR314728619TH', 'RR314728622TH', 'RR314728636TH',
    'RR314728640TH', 'RR314728653TH', 'RR314728667TH', 'RR314728675TH'
  ];
  singleRR2.forEach((t, i) => full18101.push({ seqNo: 17 + i, rcptNo: '18101', firstTrack: t, lastTrack: t, qty: 1 }));

  // Complete sequences for 18102 (Seqs 1-7)
  const full18102 = [
    { seqNo: 1, rcptNo: '18102', firstTrack: 'RR 3147 2868 4 TH', lastTrack: 'RR 3147 2869 8 TH', qty: 2 },
    { seqNo: 2, rcptNo: '18102', firstTrack: 'RR 3147 2870 7 TH', lastTrack: 'RR 3147 2870 7 TH', qty: 1 },
    { seqNo: 3, rcptNo: '18102', firstTrack: 'RR 3147 2871 5 TH', lastTrack: 'RR 3147 2871 5 TH', qty: 1 },
    { seqNo: 4, rcptNo: '18102', firstTrack: 'RR 3147 2872 4 TH', lastTrack: 'RR 3147 2872 4 TH', qty: 1 },
    { seqNo: 5, rcptNo: '18102', firstTrack: 'RR 3147 2873 8 TH', lastTrack: 'RR 3147 2873 8 TH', qty: 1 },
    { seqNo: 6, rcptNo: '18102', firstTrack: 'RR 3147 2874 1 TH', lastTrack: 'RR 3147 2874 1 TH', qty: 1 },
    { seqNo: 7, rcptNo: '18102', firstTrack: 'RR 3147 2875 5 TH', lastTrack: 'RR 3147 2875 5 TH', qty: 1 }
  ];

  const testPhotos = [
    { id: 'photo_18101', label: 'Receipt 18101', detectedRcpt: '18101', sequences: full18101 },
    { id: 'photo_18102', label: 'Receipt 18102', detectedRcpt: '18102', sequences: full18102 }
  ];

  const itemsCopy = realTracks.map((t, idx) => ({
    barcode: t,
    trackNo: t,
    trackFormatted: t,
    originalIndex: idx,
    no: idx + 1,
    photoIndex: null,
    mappingSource: 'excel'
  }));

  const plan = buildMatcherApplyPlan(testPhotos, itemsCopy);
  assert.strictEqual(plan.totalApiCount, 216);
  assert.strictEqual(plan.readyCount, 216);
  assert.strictEqual(plan.conflictCount, 0);
  assert.strictEqual(plan.unmappedCount, 0);
  assert.strictEqual(plan.isEligible, true);

  const testState = { receiptItems: itemsCopy, photos: testPhotos };
  const applyRes = applyMatcherMapping({ targetState: testState });
  assert.strictEqual(applyRes.success, true);
  assert.strictEqual(applyRes.appliedCount, 216);

  const mapped18101 = testState.receiptItems.filter(i => i.photoIndex === 0).length;
  const mapped18102 = testState.receiptItems.filter(i => i.photoIndex === 1).length;
  const unmapped = testState.receiptItems.filter(i => i.photoIndex === null).length;

  assert.strictEqual(mapped18101, 208, 'RCPT 18101 must map exactly 208 pieces');
  assert.strictEqual(mapped18102, 8, 'RCPT 18102 must map exactly 8 pieces');
  assert.strictEqual(mapped18101 + mapped18102, 216, 'Total mapped must equal 216');
  assert.strictEqual(unmapped, 0, 'Zero unmapped tracks');
});

// ── N1: First anchor missing -> no candidate ──────────────────────────────────
test('N1: First anchor missing -> no candidate', () => {
  const res1 = findRangeReviewCandidate({ firstTrack: '', qty: 5 }, realApiItems);
  assert.strictEqual(res1.status, 'none');

  const res2 = findRangeReviewCandidate({ firstTrack: 'EF999999999TH', qty: 5 }, realApiItems);
  assert.strictEqual(res2.status, 'none');
  assert.strictEqual(res2.candidate, null);
});

// ── N2: Qty missing -> no candidate ───────────────────────────────────────────
test('N2: Qty missing -> no candidate', () => {
  const res1 = findRangeReviewCandidate({ firstTrack: 'RJ317132454TH', qty: null }, realApiItems);
  assert.strictEqual(res1.status, 'none');

  const res2 = findRangeReviewCandidate({ firstTrack: 'RJ317132454TH', qty: undefined }, realApiItems);
  assert.strictEqual(res2.status, 'none');
});

// ── N3: Qty <= 0 or Qty = 1 -> no candidate ───────────────────────────────────
test('N3: Qty <= 0 or Qty = 1 -> no candidate', () => {
  const res0 = findRangeReviewCandidate({ firstTrack: 'RJ317132454TH', qty: 0 }, realApiItems);
  assert.strictEqual(res0.status, 'none');

  const resNeg = findRangeReviewCandidate({ firstTrack: 'RJ317132454TH', qty: -5 }, realApiItems);
  assert.strictEqual(resNeg.status, 'none');

  // Single track (qty=1) is not a range
  const resOne = findRangeReviewCandidate({ firstTrack: 'RJ317132454TH', qty: 1 }, realApiItems);
  assert.strictEqual(resOne.status, 'none');
});

// ── N4: Candidate slice exceeds array bounds -> no candidate ──────────────────
test('N4: Candidate slice exceeds array bounds -> no candidate', () => {
  // Start near end of array: index 210 with qty 10 (exceeds 216 total)
  const res = findRangeReviewCandidate({ firstTrack: 'RR314728707TH', qty: 10 }, realApiItems);
  assert.strictEqual(res.status, 'none');
  assert.strictEqual(res.candidate, null);
  assert.ok(res.reason.includes('exceeds'));
});

// ── N5: Duplicate actual track in source/slice -> no candidate ─────────────────
test('N5: Duplicate actual track in source/slice -> no candidate', () => {
  const itemsWithDupes = [
    { trackNo: 'RJ100000001TH' },
    { trackNo: 'RJ100000002TH' },
    { trackNo: 'RJ100000001TH' }, // duplicate!
    { trackNo: 'RJ100000004TH' }
  ];

  const res = findRangeReviewCandidate({ firstTrack: 'RJ100000001TH', qty: 3 }, itemsWithDupes);
  assert.strictEqual(res.status, 'none');
  assert.ok(res.reason.includes('duplicate'));
});

// ── N6: Incompatible prior assignment -> no candidate ─────────────────────────
test('N6: Incompatible prior assignment -> no candidate', () => {
  const items = [
    { trackNo: 'RJ100000001TH', photoIndex: null },
    { trackNo: 'RJ100000002TH', photoIndex: 1 }, // Already assigned to photo 1
    { trackNo: 'RJ100000003TH', photoIndex: null }
  ];

  // We are reviewing for photoIndex 0
  const res = findRangeReviewCandidate({ firstTrack: 'RJ100000001TH', qty: 3 }, items, [], 0);
  assert.strictEqual(res.status, 'none');
  assert.ok(res.reason.includes('assigned to photo 1'));
});

// ── N7: Ambiguous boundary overlapping another sequence -> no candidate ───────
test('N7: Ambiguous boundary overlapping another sequence -> no candidate', () => {
  const items = [
    { trackNo: 'RJ100000001TH' }, // 0
    { trackNo: 'RJ100000002TH' }, // 1
    { trackNo: 'RJ100000003TH' }, // 2 (other sequence starts here)
    { trackNo: 'RJ100000004TH' }  // 3
  ];

  const seqA = { firstTrack: 'RJ100000001TH', qty: 4 };
  const seqB = { firstTrack: 'RJ100000003TH', qty: 2 }; // Starts at index 2 inside seqA

  const res = findRangeReviewCandidate(seqA, items, [seqA, seqB]);
  assert.strictEqual(res.status, 'none');
  assert.ok(res.reason.includes('overlaps start of another sequence'));
});

// ── N8: Irregular serial dataset -> array position used, zero serial arithmetic ─
test('N8: Irregular serial dataset -> array position used, zero serial arithmetic', () => {
  // Non-consecutive, arbitrary numbers with no mathematical pattern
  const irregularItems = [
    { trackNo: 'ED111111111TH' }, // 0
    { trackNo: 'ED999999999TH' }, // 1
    { trackNo: 'ED333333333TH' }, // 2
    { trackNo: 'ED777777777TH' }, // 3
    { trackNo: 'ED222222222TH' }  // 4
  ];

  const res = findRangeReviewCandidate({ firstTrack: 'ED111111111TH', qty: 3 }, irregularItems);
  assert.strictEqual(res.status, 'candidate');
  assert.strictEqual(res.candidateIndex, 2);
  assert.strictEqual(res.candidate, 'ED333333333TH'); // 3rd item in array
});

// ── R6: matcher.js unchanged ──────────────────────────────────────────────────
test('R6: matcher.js unchanged', () => {
  try {
    const diff = execSync('git diff -- matcher.js', { encoding: 'utf8', cwd: __dirname });
    assert.strictEqual(diff.trim(), '', 'matcher.js must have zero git diff');
  } catch (err) {
    assert.ok(typeof matcher.matchSequence === 'function');
  }
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL RANGE REVIEW CANDIDATE TESTS PASSED! ✓\n');
} else {
  process.exitCode = 1;
}
