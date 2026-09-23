/**
 * matcher.excel-import.test.js
 *
 * Test suite for Phase 4A: Real Excel Tracking Import for TR 11489115.
 * Verifies:
 * - X1: reads tracking-history Excel rows
 * - X2: extracts valid tracking numbers (S10-style: 2 letters, 9 digits, 2 letters)
 * - X3: normalizes trim/case only (no character mutation / guessing)
 * - X4: deduplicates repeated tracking events
 * - X5: preserves first-seen order
 * - X6: real fixture gives exactly 216 unique tracks
 * - X7: RJ=176 and RR=40
 * - X8: does not generate intermediate tracking numbers
 * - X9: does not assign RCPT/Seq/photo automatically (unmapped)
 * - X10: existing receiptItems schema remains compatible
 *
 * Run with: node matcher.excel-import.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  extractTrackingFromExcelRows,
  processExcelRows,
  state
} = require('./app.js');

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

console.log('Running Excel Tracking Import Test Suite (X1–X10)...\n');

// ── X1: Reads tracking-history Excel rows ────────────────────────────────────
test('X1: reads tracking-history Excel rows correctly from array of rows', () => {
  const rows = [
    ['เลขพัสดุ', 'วันที่', 'สถานะ'],
    ['RJ317132454TH', '23/09/2569 02:27', 'สิ่งของส่งออกจาก ศูนย์คัดแยก'],
    ['RJ317132454TH', '21/09/2569 20:12', 'รับฝากสิ่งของ']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.totalRows, 3);
  assert.strictEqual(res.uniqueCount, 1);
  assert.deepStrictEqual(res.tracks, ['RJ317132454TH']);
});

// ── X2: Extracts valid tracking numbers (S10-style) ──────────────────────────
test('X2: extracts only valid S10-style tracking numbers and ignores non-tracking', () => {
  const rows = [
    ['หัวตาราง', 'คำอธิบาย'],
    ['INV-99999', 'ไม่ใช่ tracking'],
    ['RJ317132454TH', 'นำจ่ายสำเร็จ'],
    ['1234567890123', 'ตัวเลขล้วน 13 หลัก'],
    ['RR314728361TH', 'จดหมายลงทะเบียนต่างประเทศ']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.uniqueCount, 2);
  assert.strictEqual(res.tracks[0], 'RJ317132454TH');
  assert.strictEqual(res.tracks[1], 'RR314728361TH');
});

// ── X3: Normalizes trim/case only (no character mutation / guessing) ──────────
test('X3: normalizes whitespace and uppercase only, never mutates characters', () => {
  const rows = [
    ['  rj317132454th  '],
    ['  RJ 317132471 TH ']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.uniqueCount, 2);
  assert.strictEqual(res.tracks[0], 'RJ317132454TH');
  assert.strictEqual(res.tracks[1], 'RJ317132471TH');
  // Check that digits and letters are preserved strictly
  assert.strictEqual(res.tracks[0].slice(0, 2), 'RJ');
  assert.strictEqual(res.tracks[0].slice(-2), 'TH');
});

// ── X4: Deduplicates repeated tracking events ────────────────────────────────
test('X4: deduplicates repeated tracking events and counts duplicate rows', () => {
  const rows = [
    ['RJ317132454TH', 'Event 1: รับฝาก'],
    ['RJ317132454TH', 'Event 2: ระหว่างทาง'],
    ['RJ317132454TH', 'Event 3: นำจ่ายสำเร็จ'],
    ['RR314728361TH', 'Event 1: รับฝาก']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.uniqueCount, 2);
  assert.strictEqual(res.duplicateRows, 2);
  assert.deepStrictEqual(res.tracks, ['RJ317132454TH', 'RR314728361TH']);
});

// ── X5: Preserves first-seen order ───────────────────────────────────────────
test('X5: preserves first-seen order, never sorts by track number', () => {
  const rows = [
    ['RR314728755TH'],
    ['RJ317132454TH'],
    ['RR314728715TH'],
    ['RJ317132471TH']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.deepStrictEqual(res.tracks, [
    'RR314728755TH',
    'RJ317132454TH',
    'RR314728715TH',
    'RJ317132471TH'
  ]);
});

// ── X6 & X7: Real fixture test (tracking_20260923.xlsx rows) ─────────────────
test('X6: real fixture gives exactly 216 unique tracks (from 1,371 rows)', () => {
  const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
  assert(fs.existsSync(fixturePath), 'Fixture tracking_20260923_fixture.json must exist');
  const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.totalRows, 1371, 'Total rows in fixture must be 1371');
  assert.strictEqual(res.uniqueCount, 216, 'Unique tracking count must be exactly 216');
  assert.strictEqual(res.tracks.length, 216, 'Tracks array must contain 216 items');
  assert.strictEqual(res.tracks[0], 'RJ317132454TH', 'First track must match receipt Seq 1');
  assert.strictEqual(res.tracks[215], 'RR314728755TH', 'Last track must match fixture end');
});

test('X7: real fixture gives exactly RJ=176 and RR=40', () => {
  const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
  const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const res = extractTrackingFromExcelRows(rows);

  assert.strictEqual(res.rjCount, 176, 'RJ count must be exactly 176');
  assert.strictEqual(res.rrCount, 40, 'RR count must be exactly 40');
  assert.strictEqual(res.otherCount, 0, 'Other count must be 0');
  assert.strictEqual(res.rjCount + res.rrCount, 216, 'Sum of RJ and RR must be 216');
});

// ── X8: Does not generate intermediate tracking numbers ──────────────────────
test('X8: does not generate intermediate tracking numbers (only exact rows used)', () => {
  const rows = [
    ['RJ317132454TH'],
    ['RJ317132539TH']
  ];
  const res = extractTrackingFromExcelRows(rows);
  assert.strictEqual(res.uniqueCount, 2, 'Must contain only the 2 explicitly listed tracks');
  assert.strictEqual(res.tracks.length, 2);
  assert(!res.tracks.includes('RJ317132468TH'), 'Must not invent middle tracking numbers');
});

// ── X9: Does not assign RCPT/Seq/photo automatically (unmapped) ──────────────
test('X9: does not assign RCPT/Seq/photo automatically (items remain unmapped)', () => {
  const rows = [
    ['RJ317132454TH'],
    ['RR314728361TH']
  ];

  // Save previous state
  const prevItems = state.receiptItems;
  const prevPhotos = state.photos;
  state.photos = [{ label: 'Photo 1', file: 'p1.jpg' }, { label: 'Photo 2', file: 'p2.jpg' }];

  // Mock alert
  const origAlert = global.alert;
  global.alert = () => {};

  try {
    processExcelRows(rows);
    assert.strictEqual(state.receiptItems.length, 2);
    state.receiptItems.forEach(item => {
      assert.strictEqual(item.photoIndex, null, 'photoIndex must be null (unmapped)');
      assert.strictEqual(item.receiptSeqNo, null, 'receiptSeqNo must be null');
      assert.strictEqual(item.rcptNo, null, 'rcptNo must be null');
      assert.strictEqual(item.mappingSource, 'excel', 'mappingSource must be excel');
    });
  } finally {
    global.alert = origAlert;
    state.receiptItems = prevItems;
    state.photos = prevPhotos;
  }
});

// ── X10: Existing receiptItems schema remains compatible ──────────────────────
test('X10: existing receiptItems schema fields all exist and remain compatible', () => {
  const rows = [['RJ317132454TH']];
  const origAlert = global.alert;
  global.alert = () => {};

  try {
    processExcelRows(rows);
    const item = state.receiptItems[0];
    assert.strictEqual(item.no, 1);
    assert.strictEqual(item.trackNo, 'RJ317132454TH');
    assert.strictEqual(item.trackFormatted, 'RJ317132454TH');
    assert(typeof item.recipient === 'string');
    assert(typeof item.weight === 'string');
    assert(typeof item.service === 'string');
    assert(typeof item.zip === 'string');
    assert(typeof item.destinationName === 'string');
    assert(typeof item.cost === 'number');
    assert.strictEqual(item.photoIndex, null);
    assert.strictEqual(item.mappingSource, 'excel');
  } finally {
    global.alert = origAlert;
  }
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL EXCEL TRACKING IMPORT REGRESSION TESTS (X1–X10) PASSED! ✓\n');
} else {
  process.exitCode = 1;
}
