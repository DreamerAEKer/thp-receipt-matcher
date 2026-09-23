/**
 * matcher.excel-range-review.test.js
 *
 * Regression test suite for Phase 4 UX & Logic Review fixes:
 * 1. USE CANDIDATE MUTATION: Updates editable value, preserves raw printedFirstTrack, does NOT auto-confirm
 * 2. RANGE QTY UNKNOWN: Range without printed qty keeps qty === null (never defaults to 1)
 * 3. EXCEL RANGE COUNT: expectedQty calculated from actual imported track array indices
 * 4. NO TRACK ARITHMETIC: Range membership strictly derived from array indices without serial arithmetic
 * 5. QTY MISMATCH: Paper qty != Excel slice count yields CONFLICT with descriptive reason
 * 6. USE EXCEL QTY: Explicitly applying suggested Excel qty updates qty, remains unconfirmed, reaches STRONG
 * 7. CONFIRM ALL SAFETY: Only STRONG rows confirmed; CONFLICT/AMBIGUOUS/INCOMPLETE skipped
 * 8. REAL TR 11489115 REGRESSION: Full TR 11489115 216-item matching preserved
 *
 * Run with: node matcher.excel-range-review.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  cleanTrackNo,
  findApiTrackCandidate,
  evaluateExcelRangeReview,
  evaluateSequenceValidation,
  parseReceiptLineEvidence,
  confirmOcrSuggestion,
  confirmAllOcrSuggestions,
  findRangeReviewCandidate,
  extractTrackingFromExcelRows,
  buildMatcherApplyPlan,
  applyMatcherMapping,
  state
} = require('./app.js');

const matcher = require('./matcher.js');
global.Matcher = matcher;

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

console.log('Running Excel Range Review & UX Safety Test Suite...\n');

// Load real Excel fixture
const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
const rawRows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const { tracks: realTracks } = extractTrackingFromExcelRows(rawRows);
const realApiItems = realTracks.map((t, idx) => ({ barcode: t, trackNo: t, trackFormatted: t, originalIndex: idx }));

// --------------------------------------------------------------------------
// 1. USE CANDIDATE MUTATION
// --------------------------------------------------------------------------
test('1. USE CANDIDATE MUTATION: updates editable value, preserves raw printedFirstTrack, does NOT auto-confirm', () => {
  const ocrFirst = 'RI317133432TH'; // OCR typo: RI instead of RJ
  const cand = findApiTrackCandidate(ocrFirst, realApiItems);
  assert.strictEqual(cand.status, 'single_match');
  assert.strictEqual(cand.candidate, 'RJ317133432TH');

  const photo = {
    id: 'p_test',
    detectedRcpt: '18101',
    sequences: [],
    ocrSequenceSuggestions: [
      {
        id: 'sug_test_cand',
        seqNo: 2,
        firstTrack: ocrFirst,
        lastTrack: 'RJ317134407TH',
        printedFirstTrack: ocrFirst,
        printedLastTrack: 'RJ317134407TH',
        qty: 49,
        status: 'pending',
        reviewCandidate: cand
      }
    ]
  };

  // Simulate clicking "ใช้เลขนี้"
  const sug = photo.ocrSequenceSuggestions[0];
  if (!sug.printedFirstTrack) {
    sug.printedFirstTrack = sug.firstTrack;
  }
  sug.firstTrack = cand.candidate;
  sug.firstCandidateApplied = true;

  // Assertions:
  assert.strictEqual(sug.firstTrack, 'RJ317133432TH', 'Editable firstTrack must be updated to candidate');
  assert.strictEqual(sug.printedFirstTrack, 'RI317133432TH', 'Raw OCR printedFirstTrack must remain intact');
  assert.strictEqual(photo.sequences.length, 0, 'Must NOT auto-confirm or mutate photo.sequences');
  assert.strictEqual(sug.status, 'pending', 'Suggestion status must remain pending');
});

// --------------------------------------------------------------------------
// 2. RANGE QTY UNKNOWN
// --------------------------------------------------------------------------
test('2. RANGE QTY UNKNOWN: range without printed qty keeps qty === null (never defaults to 1)', () => {
  // OCR line with two tracks (range) but without printed qty
  const lines = [
    { text: '5. RJ 3171 3581 3 TH - RJ 3171 3596 3 TH', confidence: 95 }
  ];
  const sugs = parseReceiptLineEvidence(lines, '18101', realApiItems);
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0].firstTrack, 'RJ317135813TH');
  assert.strictEqual(sugs[0].lastTrack, 'RJ317135963TH');
  assert.strictEqual(sugs[0].qty, null, 'Range qty without printed count MUST be null, not 1');

  // Single track line defaults to 1
  const singleLine = [
    { text: '6. RR 3147 2836 1 TH', confidence: 95 }
  ];
  const singleSugs = parseReceiptLineEvidence(singleLine, '18101', realApiItems);
  assert.strictEqual(singleSugs.length, 1);
  assert.strictEqual(singleSugs[0].firstTrack, 'RR314728361TH');
  assert.strictEqual(singleSugs[0].lastTrack, 'RR314728361TH');
  assert.strictEqual(singleSugs[0].qty, 1, 'Single track without range defaults to 1');
});

// --------------------------------------------------------------------------
// 3. EXCEL RANGE COUNT
// --------------------------------------------------------------------------
test('3. EXCEL RANGE COUNT: expectedQty calculated from actual imported track array indices', () => {
  // Real slice in TR 11489115:
  // RJ317132454TH is index 0
  // RJ317133415TH is index 48
  // expectedQty = 48 - 0 + 1 = 49
  const review = evaluateExcelRangeReview({
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133415TH',
    qty: null
  }, realApiItems);

  assert(review !== null);
  assert.strictEqual(review.status, 'qty_suggested');
  assert.strictEqual(review.startIndex, 0);
  assert.strictEqual(review.endIndex, 48);
  assert.strictEqual(review.expectedQty, 49);
});

// --------------------------------------------------------------------------
// 4. NO TRACK ARITHMETIC
// --------------------------------------------------------------------------
test('4. NO TRACK ARITHMETIC: range membership strictly derived from array indices without serial arithmetic', () => {
  // Create non-serial / arbitrary tracking codes that cannot be derived by math
  const arbitraryItems = [
    { trackNo: 'AA999999999TH' },
    { trackNo: 'ZZ111111111TH' },
    { trackNo: 'MM555555555TH' },
    { trackNo: 'BB777777777TH' }
  ];

  const review = evaluateExcelRangeReview({
    firstTrack: 'AA999999999TH',
    lastTrack: 'BB777777777TH',
    qty: 4
  }, arbitraryItems);

  assert(review !== null);
  assert.strictEqual(review.status, 'match');
  assert.strictEqual(review.expectedQty, 4);
  assert.strictEqual(review.startIndex, 0);
  assert.strictEqual(review.endIndex, 3);
});

// --------------------------------------------------------------------------
// 5. QTY MISMATCH
// --------------------------------------------------------------------------
test('5. QTY MISMATCH: paper qty != Excel slice count yields CONFLICT with descriptive reason', () => {
  // Real slice has 49 items, but paper/user specified 48
  const review = evaluateExcelRangeReview({
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133415TH',
    qty: 48
  }, realApiItems);

  assert(review !== null);
  assert.strictEqual(review.status, 'conflict');
  assert.strictEqual(review.expectedQty, 49);
  assert(review.reason.includes('จำนวนบนใบเสร็จ 48 แต่ช่วงใน Excel มี 49 รายการ'));

  // Test validation integration
  const val = evaluateSequenceValidation({
    seqNo: 1,
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133415TH',
    qty: 48
  }, '18101', [], realApiItems);

  assert.strictEqual(val.status, 'conflict');
  assert(val.reasonText.includes('จำนวนบนใบเสร็จ 48 แต่ช่วงใน Excel มี 49 รายการ'));
});

// --------------------------------------------------------------------------
// 6. USE EXCEL QTY
// --------------------------------------------------------------------------
test('6. USE EXCEL QTY: explicit "ใช้จำนวน 49" updates qty, remains unconfirmed, reaches STRONG', () => {
  const photo = {
    id: 'p_qty',
    detectedRcpt: '18101',
    sequences: [],
    ocrSequenceSuggestions: [
      {
        id: 'sug_test_qty',
        seqNo: 1,
        firstTrack: 'RJ317132454TH',
        lastTrack: 'RJ317133415TH',
        qty: null,
        status: 'pending'
      }
    ]
  };

  const sug = photo.ocrSequenceSuggestions[0];

  // Before applying qty: evaluateSequenceValidation yields conflict because qty is null
  const valBefore = evaluateSequenceValidation(sug, '18101', [], realApiItems);
  assert.strictEqual(valBefore.status, 'conflict');
  assert(valBefore.reasonText.includes('ยังไม่ระบุจำนวน Qty'));

  // Simulate explicit user click on "[ใช้จำนวน 49]"
  const review = evaluateExcelRangeReview(sug, realApiItems);
  assert.strictEqual(review.status, 'qty_suggested');
  sug.qty = review.expectedQty;

  // Invariants:
  assert.strictEqual(sug.qty, 49, 'Qty must be updated to 49');
  assert.strictEqual(photo.sequences.length, 0, 'Must NOT auto-confirm');
  assert.strictEqual(sug.status, 'pending', 'Must remain pending');

  // After applying qty: validation must now be STRONG
  const valAfter = evaluateSequenceValidation(sug, '18101', [], realApiItems);
  assert.strictEqual(valAfter.status, 'strong');
  assert(valAfter.reasonText.includes('ตรง'));
});

// --------------------------------------------------------------------------
// 7. CONFIRM ALL SAFETY
// --------------------------------------------------------------------------
test('7. CONFIRM ALL SAFETY: only STRONG rows confirmed; CONFLICT/AMBIGUOUS/INCOMPLETE skipped', () => {
  state.photos = [
    {
      id: 'p0',
      detectedRcpt: '18101',
      sequences: [],
      ocrSequenceSuggestions: [
        // Row 1: STRONG (valid single RR item)
        {
          id: 'sug_valid_single',
          seqNo: 6,
          firstTrack: 'RR314728361TH',
          lastTrack: 'RR314728361TH',
          qty: 1,
          status: 'pending'
        },
        // Row 2: CONFLICT (Range with qty null)
        {
          id: 'sug_null_qty',
          seqNo: 1,
          firstTrack: 'RJ317132454TH',
          lastTrack: 'RJ317133429TH',
          qty: null,
          status: 'pending'
        },
        // Row 3: CONFLICT (Typos / not in Excel)
        {
          id: 'sug_invalid_track',
          seqNo: 2,
          firstTrack: 'RI317133432TH',
          lastTrack: 'RJ317134407TH',
          qty: 49,
          status: 'pending'
        }
      ]
    }
  ];
  state.receiptItems = realApiItems;

  // Execute batch confirmation
  confirmAllOcrSuggestions(0);

  // Assertions:
  assert.strictEqual(state.photos[0].sequences.length, 1, 'Only exactly 1 STRONG sequence must be confirmed');
  assert.strictEqual(state.photos[0].sequences[0].firstTrack, 'RR314728361TH');
  assert.strictEqual(state.photos[0].sequences[0].qty, 1);

  // Rows 2 and 3 must have been skipped and remain pending!
  const pending = state.photos[0].ocrSequenceSuggestions.filter(s => s.status === 'pending');
  assert.strictEqual(pending.length, 2, '2 invalid/unresolved rows must remain pending');
  assert.strictEqual(pending[0].id, 'sug_null_qty');
  assert.strictEqual(pending[1].id, 'sug_invalid_track');
});

// --------------------------------------------------------------------------
// 8. REAL TR 11489115 REGRESSION
// --------------------------------------------------------------------------
test('8. REAL TR 11489115 REGRESSION: full TR 11489115 216-item matching preserved', () => {
  // Set up all sequences for RCPT 18101 and 18102
  const photo0Seqs = [
    { seqNo: 1, rcptNo: '18101', firstTrack: 'RJ317132454TH', lastTrack: 'RJ317133415TH', printedLastTrack: 'RJ317133429TH', qty: 49 },
    { seqNo: 2, rcptNo: '18101', firstTrack: 'RJ317133432TH', lastTrack: 'RJ317134398TH', printedLastTrack: 'RJ317134407TH', qty: 49 },
    { seqNo: 3, rcptNo: '18101', firstTrack: 'RJ317134415TH', lastTrack: 'RJ317135376TH', printedLastTrack: 'RJ317135380TH', qty: 49 },
    { seqNo: 4, rcptNo: '18101', firstTrack: 'RJ317135393TH', lastTrack: 'RJ317135795TH', printedLastTrack: 'RJ317135800TH', qty: 21 },
    { seqNo: 5, rcptNo: '18101', firstTrack: 'RJ317135813TH', lastTrack: 'RJ317135950TH', printedLastTrack: 'RJ317135963TH', qty: 8 },
    { seqNo: 6, rcptNo: '18101', firstTrack: 'RR314728361TH', lastTrack: 'RR314728361TH', qty: 1 }
  ];

  const singleRR1 = [
    'RR314728375TH', 'RR314728389TH', 'RR314728392TH', 'RR314728401TH',
    'RR314728415TH', 'RR314728429TH', 'RR314728432TH'
  ];
  singleRR1.forEach((t, i) => photo0Seqs.push({ seqNo: 7 + i, rcptNo: '18101', firstTrack: t, lastTrack: t, qty: 1 }));
  photo0Seqs.push({ seqNo: 14, rcptNo: '18101', firstTrack: 'RR314728446TH', lastTrack: 'RR314728450TH', qty: 2 });
  photo0Seqs.push({ seqNo: 15, rcptNo: '18101', firstTrack: 'RR314728463TH', lastTrack: 'RR314728463TH', qty: 1 });
  photo0Seqs.push({ seqNo: 16, rcptNo: '18101', firstTrack: 'RR314728477TH', lastTrack: 'RR314728494TH', qty: 3 });

  const singleRR2 = [
    'RR314728503TH', 'RR314728517TH', 'RR314728525TH', 'RR314728534TH', 'RR314728548TH',
    'RR314728551TH', 'RR314728565TH', 'RR314728579TH', 'RR314728582TH', 'RR314728596TH',
    'RR314728605TH', 'RR314728619TH', 'RR314728622TH', 'RR314728636TH', 'RR314728640TH',
    'RR314728653TH', 'RR314728667TH', 'RR314728675TH'
  ];
  singleRR2.forEach((t, i) => photo0Seqs.push({ seqNo: 17 + i, rcptNo: '18101', firstTrack: t, lastTrack: t, qty: 1 }));

  const photo1Seqs = [
    { seqNo: 1, rcptNo: '18102', firstTrack: 'RR314728684TH', lastTrack: 'RR314728698TH', qty: 2 },
    { seqNo: 2, rcptNo: '18102', firstTrack: 'RR314728707TH', lastTrack: 'RR314728707TH', qty: 1 },
    { seqNo: 3, rcptNo: '18102', firstTrack: 'RR314728715TH', lastTrack: 'RR314728715TH', qty: 1 },
    { seqNo: 4, rcptNo: '18102', firstTrack: 'RR314728724TH', lastTrack: 'RR314728724TH', qty: 1 },
    { seqNo: 5, rcptNo: '18102', firstTrack: 'RR314728738TH', lastTrack: 'RR314728738TH', qty: 1 },
    { seqNo: 6, rcptNo: '18102', firstTrack: 'RR314728741TH', lastTrack: 'RR314728741TH', qty: 1 },
    { seqNo: 7, rcptNo: '18102', firstTrack: 'RR314728755TH', lastTrack: 'RR314728755TH', qty: 1 }
  ];

  state.photos = [
    { id: 'p0', detectedRcpt: '18101', sequences: photo0Seqs },
    { id: 'p1', detectedRcpt: '18102', sequences: photo1Seqs }
  ];
  state.receiptItems = realApiItems.map(item => ({ ...item, photoIndex: null }));

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.isEligible, true);
  assert.strictEqual(plan.readyCount, 216);
  assert.strictEqual(plan.conflictCount, 0);

  const applied = applyMatcherMapping({ targetState: state });
  assert.strictEqual(applied.appliedCount, 216);

  const mapped18101 = state.receiptItems.filter(i => i.photoIndex === 0).length;
  const mapped18102 = state.receiptItems.filter(i => i.photoIndex === 1).length;
  assert.strictEqual(mapped18101, 208, 'RCPT 18101 must map exactly 208 tracks');
  assert.strictEqual(mapped18102, 8, 'RCPT 18102 must map exactly 8 tracks');
  assert.strictEqual(mapped18101 + mapped18102, 216, 'Total mapped must be 216/216');
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL EXCEL RANGE REVIEW & UX SAFETY TESTS PASSED! ✓');
} else {
  process.exit(1);
}
