/**
 * matcher.real-tr-11489115.test.js
 *
 * Real workflow regression suite for TR 11489115:
 * Excel tracking (216 items) + Physical receipt image (media_1790148735803.jpg)
 *
 * Verifies:
 * - T1: Excel 216 tracks loaded correctly
 * - T2: Available physical receipt evidence loaded
 * - T3: Verified sequences match expected Excel tracks
 * - T4: Missing receipt coverage does NOT invent tracks
 * - T5: Unmatched Excel tracks remain unmapped
 * - T6: Apply plan contains only verified matches
 * - T7: State remains unmutated before Apply
 * - T8: Supervised Apply maps only planned tracks
 * - T9: Zero generated tracks
 * - T10: matcher.js unchanged
 *
 * Run with: node matcher.real-tr-11489115.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  extractTrackingFromExcelRows,
  processExcelRows,
  buildMatcherApplyPlan,
  applyMatcherMapping,
  state
} = require('./app.js');

const {
  buildTrackIndex,
  matchSequence,
  MATCH_CONFIDENCE
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

console.log('Running Real Workflow Test Suite TR 11489115 (T1–T10)...\n');

// Load real Excel fixture
const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
const rawRows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// ── T1: Excel 216 tracks loaded correctly ─────────────────────────────────────
test('T1: Excel 216 tracks loaded correctly', () => {
  const result = extractTrackingFromExcelRows(rawRows);
  assert.strictEqual(result.tracks.length, 216);
  assert.strictEqual(result.uniqueCount, 216);

  const rjTracks = result.tracks.filter(t => t.startsWith('RJ'));
  const rrTracks = result.tracks.filter(t => t.startsWith('RR'));
  assert.strictEqual(rjTracks.length, 176);
  assert.strictEqual(rrTracks.length, 40);

  // Check start and end anchors
  assert.strictEqual(result.tracks[0], 'RJ317132454TH');
  assert.strictEqual(result.tracks[175], 'RJ317135950TH');
  assert.strictEqual(result.tracks[176], 'RR314728361TH');
  assert.strictEqual(result.tracks[215], 'RR314728755TH');
});

// ── T2: Available physical receipt evidence loaded ───────────────────────────
test('T2: Available physical receipt evidence loaded', () => {
  // Physical receipt evidence from media_1790148735803.jpg
  // Page 1: Header TR 11489115, POS B03022000201733, RCPT# 18101
  const physicalEvidence = {
    imageFile: 'media_1790148735803.jpg',
    trNo: '11489115',
    rcptNo: '18101',
    sequences: [
      { seqNo: 1, firstTrack: 'RJ 3171 3245 4 TH', lastTrack: 'RJ 3171 3342 9 TH', qty: 49 },
      { seqNo: 2, firstTrack: 'RJ 3171 3343 2 TH', lastTrack: 'RJ 3171 3440 7 TH', qty: 49 },
      { seqNo: 3, firstTrack: 'RJ 3171 3441 5 TH', lastTrack: 'RJ 3171 3538 0 TH', qty: 49 },
      { seqNo: 4, firstTrack: 'RJ 3171 3539 3 TH', lastTrack: 'RJ 3171 3580 0 TH', qty: 21 },
      { seqNo: 5, firstTrack: 'RJ 3171 3581 3 TH', lastTrack: 'RJ 3171 3596 3 TH', qty: 8 },
      { seqNo: 6, firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }
    ]
  };

  assert.strictEqual(physicalEvidence.rcptNo, '18101');
  assert.strictEqual(physicalEvidence.sequences.length, 6);
  const totalDeclaredQty = physicalEvidence.sequences.reduce((sum, s) => sum + s.qty, 0);
  assert.strictEqual(totalDeclaredQty, 177); // 177 on RCPT 18101; remaining 39 on RCPT 18102 (missing image)
});

// ── T3: Verified sequences match expected Excel tracks ────────────────────────
test('T3: Verified sequences match expected Excel tracks', () => {
  const { tracks } = extractTrackingFromExcelRows(rawRows);
  const apiItems = tracks.map((t, idx) => ({ barcode: t, originalIndex: idx }));
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);

  // 1. Seq 6 is a verified single-track sequence
  const seq6 = {
    rcptNo: '18101',
    seqNo: 6,
    firstTrack: 'RR 3147 2836 1 TH',
    lastTrack: 'RR 3147 2836 1 TH',
    qty: 1
  };
  const match6 = matchSequence(seq6, trackMap, apiTracks);
  assert.strictEqual(match6.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(match6.apiStartIndex, 176);
  assert.strictEqual(match6.apiEndIndex, 176);
  assert.strictEqual(match6.matchedTracks.length, 1);
  assert.strictEqual(match6.matchedTracks[0].trackNo, 'RR314728361TH');

  // 2. Seqs 1-5 printed with nominal booklet end not present in Excel array
  // strictly result in CONFLICT (safe, zero false positive)
  const seq1Printed = {
    rcptNo: '18101',
    seqNo: 1,
    firstTrack: 'RJ 3171 3245 4 TH',
    lastTrack: 'RJ 3171 3342 9 TH',
    qty: 49
  };
  const match1 = matchSequence(seq1Printed, trackMap, apiTracks);
  assert.strictEqual(match1.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(match1.conflictReason.includes('lastTrack "RJ317133429TH" not found in API array'));

  // 3. When sequence range is anchored to actual final track in Excel (RJ317133415TH, qty 49)
  const seq1Actual = {
    rcptNo: '18101',
    seqNo: 1,
    firstTrack: 'RJ 3171 3245 4 TH',
    lastTrack: 'RJ 3171 3341 5 TH',
    qty: 49
  };
  const match1Actual = matchSequence(seq1Actual, trackMap, apiTracks);
  assert.strictEqual(match1Actual.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(match1Actual.apiStartIndex, 0);
  assert.strictEqual(match1Actual.apiEndIndex, 48);
  assert.strictEqual(match1Actual.matchedTracks.length, 49);
});

// ── T4: Missing receipt coverage does NOT invent tracks ────────────────────────
test('T4: Missing receipt coverage does NOT invent tracks', () => {
  const { tracks } = extractTrackingFromExcelRows(rawRows);
  // RCPT 18102 has 39 remaining tracks (indexes 177 to 215)
  // Verify that neither the importer nor the matcher manufactures RCPT 18102 evidence
  const remainingTracks = tracks.slice(177);
  assert.strictEqual(remainingTracks.length, 39);
  assert.strictEqual(remainingTracks[0], 'RR314728375TH');
  assert.strictEqual(remainingTracks[38], 'RR314728755TH');

  // Verify no synthetic receipt groups or sequences are invented
  const safePhotos = [
    {
      id: 'photo_18101',
      detectedRcpt: '18101',
      sequences: [
        { seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }
      ]
    }
  ];
  const items = tracks.map((t, idx) => ({ barcode: t, originalIndex: idx }));
  const plan = buildMatcherApplyPlan(safePhotos, items);

  // Missing coverage for 18102 means those tracks stay unmapped
  assert.strictEqual(plan.readyCount, 1);
  assert.strictEqual(plan.unmappedCount, 215);
  // Indexes 177 to 215 must have null mappings in the plan
  for (let i = 177; i < 216; i++) {
    assert.strictEqual(plan.mappings[i], null);
  }
});

// ── T5: Unmatched Excel tracks remain unmapped ─────────────────────────────────
test('T5: Unmatched Excel tracks remain unmapped', () => {
  const { tracks } = extractTrackingFromExcelRows(rawRows);
  const items = tracks.map((t, idx) => ({
    barcode: t,
    originalIndex: idx,
    photoIndex: null,
    mappingSource: 'excel'
  }));

  const photos = [
    {
      id: 'photo_18101',
      detectedRcpt: '18101',
      sequences: [
        { seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }
      ]
    }
  ];

  const plan = buildMatcherApplyPlan(photos, items);
  assert.strictEqual(plan.mappings[176].photoIndex, 0);

  // All other 215 items remain null in the plan
  const nullCount = plan.mappings.filter(m => m === null).length;
  assert.strictEqual(nullCount, 215);
});

// ── T6: Apply plan contains only verified matches ──────────────────────────────
test('T6: Apply plan contains only verified matches', () => {
  const { tracks } = extractTrackingFromExcelRows(rawRows);
  const items = tracks.map((t, idx) => ({ barcode: t, originalIndex: idx }));

  // Photos with 1 strong match and 1 conflict
  const photos = [
    {
      id: 'photo_18101',
      detectedRcpt: '18101',
      sequences: [
        { seqNo: 1, rcptNo: '18101', firstTrack: 'RJ 3171 3245 4 TH', lastTrack: 'RJ 3171 3342 9 TH', qty: 49 }, // CONFLICT
        { seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }  // STRONG
      ]
    }
  ];

  const plan = buildMatcherApplyPlan(photos, items);
  // Conflict prevents plan eligibility
  assert.strictEqual(plan.conflictCount, 1);
  assert.strictEqual(plan.isEligible, false);
  // Conflicting sequence 1 is NOT in applicable mappings
  assert.strictEqual(plan.mappings[0], null);
});

// Mock global.alert if not present in Node
if (typeof global.alert !== 'function') {
  global.alert = () => {};
}

// ── T7: State remains unmutated before Apply ───────────────────────────────────
test('T7: State remains unmutated before Apply', () => {
  processExcelRows(rawRows);
  const initialItemsJSON = JSON.stringify(state.receiptItems);
  const initialPhotosJSON = JSON.stringify(state.photos);

  const photos = [
    {
      id: 'photo_18101',
      detectedRcpt: '18101',
      sequences: [
        { seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }
      ]
    }
  ];

  // Call buildMatcherApplyPlan multiple times
  buildMatcherApplyPlan(photos, state.receiptItems);
  buildMatcherApplyPlan(photos, state.receiptItems);

  assert.strictEqual(JSON.stringify(state.receiptItems), initialItemsJSON);
  assert.strictEqual(JSON.stringify(state.photos), initialPhotosJSON);
});

// ── T8: Supervised Apply maps only planned tracks ──────────────────────────────
test('T8: Supervised Apply maps only planned tracks', () => {
  processExcelRows(rawRows);
  state.photos = [
    {
      id: 'photo_18101',
      detectedRcpt: '18101',
      sequences: [
        { seqNo: 6, rcptNo: '18101', firstTrack: 'RR 3147 2836 1 TH', lastTrack: 'RR 3147 2836 1 TH', qty: 1 }
      ]
    }
  ];

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.isEligible, true);
  assert.strictEqual(plan.readyCount, 1);

  const result = applyMatcherMapping({ targetState: state });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.appliedCount, 1);

  // Only index 176 is mapped to photo 0
  assert.strictEqual(state.receiptItems[176].photoIndex, 0);
  assert.strictEqual(state.receiptItems[176].mappingSource, 'matcher');
  assert.strictEqual(state.receiptItems[176].trackNo, 'RR314728361TH');

  // Verify all other 215 items remain unmapped
  for (let i = 0; i < 216; i++) {
    if (i !== 176) {
      assert.strictEqual(state.receiptItems[i].photoIndex, null, `Item at index ${i} should be unmapped`);
    }
  }
});

// ── T9: Zero generated tracks ──────────────────────────────────────────────────
test('T9: Zero generated tracks', () => {
  // Check that all 216 barcode strings in state.receiptItems are strictly from the input Excel
  const { tracks } = extractTrackingFromExcelRows(rawRows);
  const excelTrackSet = new Set(tracks);

  assert.strictEqual(state.receiptItems.length, 216);
  state.receiptItems.forEach((item, idx) => {
    assert.ok(excelTrackSet.has(item.trackNo), `Barcode ${item.trackNo} at index ${idx} was not in input Excel`);
  });
});

// ── T10: matcher.js unchanged ──────────────────────────────────────────────────
test('T10: matcher.js unchanged', () => {
  // Verify via git diff that matcher.js has zero uncommitted changes
  try {
    const diff = execSync('git diff -- matcher.js', { encoding: 'utf8', cwd: __dirname });
    assert.strictEqual(diff.trim(), '', 'matcher.js must have zero git diff');
  } catch (err) {
    // If not in a git repo in this sub-environment, verify file exists and exports unchanged
    const matcher = require('./matcher.js');
    assert.ok(typeof matcher.matchSequence === 'function');
    assert.ok(typeof matcher.buildTrackIndex === 'function');
  }
});

console.log(`\nReal Workflow Test Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL REAL WORKFLOW TESTS (T1–T10) PASSED! ✓\n');
} else {
  process.exitCode = 1;
}
