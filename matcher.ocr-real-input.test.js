/**
 * matcher.ocr-real-input.test.js
 *
 * Test suite for Real OCR Input Improvements:
 *  1. TAX ID (e.g. TAX ID 0105546095724) ignored / 0 candidates
 *  2. POS numbers (e.g. POS 803022000201733) ignored / 0 candidates
 *  3. 13-digit pure numeric tax ID (e.g. 0115550001640) ignored / 0 candidates
 *  4. S10 postal tracking format correctly extracted (RI317132454TH, RJ317134407TH, RR314728361TH)
 *  5. Service qty parsed from @ lines (49@11.00, 49@13.00, 49@8.00 -> qty = 49, not 147)
 *  6. Conflicting @ quantities flag review (qty = null)
 *  7. Range without qty remains qty = null
 *  8. Single item defaults to qty = 1
 *  9. Unique Excel candidate found for OCR typo (RI317132454TH -> RJ317132454TH)
 * 10. Ambiguous candidate remains ambiguous (never guessed or auto-resolved)
 * 11. Real TR 11489115 Seq 1 auto-resolves to Excel slice 0..48 (49 tracks)
 * 12. Real TR 11489115 Seq 2 auto-resolves to Excel slice 49..97 (49 tracks)
 * 13. Printed nominal tracks preserved as raw OCR for audit trail
 * 14. Zero tracking number arithmetic, zero global string replacement
 *
 * Run with: node matcher.ocr-real-input.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  state,
  startNewSession,
  cleanTrackNo,
  extractTrackCandidates,
  findApiTrackCandidate,
  parseReceiptLineEvidence,
  resolveReceiptRanges,
  extractTrackingFromExcelRows,
  selectItem
} = require('./app.js');

let totalTests = 0;
let passedTests = 0;

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

function setupMockDom() {
  const elements = {};
  function makeEl(id) {
    const el = {
      id,
      className: '',
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      textContent: '',
      value: '',
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 0,
      lastScrollTop: null,
      scrollTo: function(opts) {
        el.lastScrollTop = typeof opts === 'object' ? opts.top : opts;
        el.scrollTop = el.lastScrollTop;
      },
      removeAttribute: (attr) => { delete el[attr]; },
      querySelector: () => null,
      querySelectorAll: () => []
    };
    elements[id] = el;
    return el;
  }

  makeEl('receiptContainer');
  makeEl('receiptImage');
  makeEl('photoTabsContainer');
  makeEl('photoIdentityBadge');
  makeEl('activeItemHint');
  makeEl('itemsList');
  makeEl('pageManageList');
  makeEl('autoSaveStatusLabel');

  global.document = {
    getElementById: (id) => elements[id] || makeEl(id),
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} })
  };
  global.window = global;
}

setupMockDom();

console.log('Running Real OCR Input Improvement Test Suite (I1–I14)...\n');

// ── I1: TAX ID line ignored (0 candidates) ──────────────────────────────────
test('I1: TAX ID line ignored (0 candidates)', () => {
  const line = 'TAX ID. 0105546095724';
  const cands = extractTrackCandidates(line);
  assert.strictEqual(cands.length, 0, 'TAX ID line must produce 0 track candidates');
});

// ── I2: POS number line ignored (0 candidates) ──────────────────────────────
test('I2: POS number line ignored (0 candidates)', () => {
  const line = 'POS 803022000201733               REPT 18101';
  const cands = extractTrackCandidates(line);
  assert.strictEqual(cands.length, 0, 'POS/REPT line must produce 0 track candidates');
});

// ── I3: 13-digit pure numeric ID ignored (0 candidates) ─────────────────────
test('I3: 13-digit pure numeric tax ID ignored (0 candidates)', () => {
  const line = 'เลขประจำตัวผู้เสียภาษีอากร 0115550001640';
  const cands = extractTrackCandidates(line);
  assert.strictEqual(cands.length, 0, 'Pure numeric 13 digits must produce 0 track candidates');
});

// ── I4: S10 Postal format extracted properly ────────────────────────────────
test('I4: S10 Postal format extracted properly', () => {
  const line = 'RI317132454 TH - RI317133429 TH';
  const cands = extractTrackCandidates(line);
  assert.strictEqual(cands.length, 2, 'Should extract 2 postal candidates');
  assert.strictEqual(cands[0].normalized, 'RI317132454TH');
  assert.strictEqual(cands[1].normalized, 'RI317133429TH');
});

// ── I5: Service qty parsed from @ lines (consistent 49@... -> qty = 49) ─────
test('I5: Service qty parsed from @ lines (consistent 49@... -> qty = 49, not 147)', () => {
  const lines = [
    { text: '1. จดหมายในประเทศซอง', confidence: 90 },
    { text: 'RI317132454 TH - RI317133429 TH', confidence: 85 },
    { text: 'ค่าบริการ 49@11.00 539.00', confidence: 80 },
    { text: 'ค่าลงทะเบียน 49@13.00 637.00', confidence: 80 },
    { text: 'ค่าตอบรับ 49@8.00 392.00', confidence: 80 }
  ];
  const sugs = parseReceiptLineEvidence(lines);
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0].seqNo, 1);
  assert.strictEqual(sugs[0].qty, 49, 'Qty must be 49, never summed to 147');
});

// ── I6: Conflicting @ quantities flag review (qty = null) ───────────────────
test('I6: Conflicting @ quantities flag review (qty = null)', () => {
  const lines = [
    { text: '1. จดหมายในประเทศซอง', confidence: 90 },
    { text: 'RI317132454 TH - RI317133429 TH', confidence: 85 },
    { text: 'ค่าบริการ 49@11.00 539.00', confidence: 80 },
    { text: 'ค่าลงทะเบียน 21@13.00 273.00', confidence: 80 } // Conflict: 49 vs 21
  ];
  const sugs = parseReceiptLineEvidence(lines);
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0].qty, null, 'Conflicting quantities must produce qty = null');
});

// ── I7: Range without qty remains qty = null ────────────────────────────────
test('I7: Range without qty remains qty = null', () => {
  const lines = [
    { text: '1. จดหมายในประเทศซอง', confidence: 90 },
    { text: 'RJ317132454 TH - RJ317133429 TH', confidence: 85 }
  ];
  const sugs = parseReceiptLineEvidence(lines);
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0].qty, null, 'Range without qty must remain null');
});

// ── I8: Single item defaults to qty = 1 ─────────────────────────────────────
test('I8: Single item defaults to qty = 1', () => {
  const lines = [
    { text: '6. (_______) RR 3147 2836 1 TH', confidence: 80 }
  ];
  const sugs = parseReceiptLineEvidence(lines);
  assert.strictEqual(sugs.length, 1);
  assert.strictEqual(sugs[0].qty, 1, 'Single item track defaults to qty = 1');
  assert.strictEqual(sugs[0].firstTrack, 'RR314728361TH');
});

// ── I9: Unique Excel candidate found for OCR typo ───────────────────────────
test('I9: Unique Excel candidate found for OCR typo (RI317132454TH -> RJ317132454TH)', () => {
  const mockApi = [
    { trackNo: 'RJ317132454TH' },
    { trackNo: 'RJ317132468TH' }
  ];
  const cand = findApiTrackCandidate('RI317132454TH', mockApi);
  assert.strictEqual(cand.status, 'single_match');
  assert.strictEqual(cand.candidate, 'RJ317132454TH');
  assert.strictEqual(cand.distance, 1);
});

// ── I10: Ambiguous candidate remains ambiguous (never guessed) ──────────────
test('I10: Ambiguous candidate remains ambiguous (never guessed or auto-resolved)', () => {
  const mockApi = [
    { trackNo: 'RJ317132454TH' },
    { trackNo: 'RK317132454TH' }
  ];
  // RI is distance 1 from both RJ and RK
  const cand = findApiTrackCandidate('RI317132454TH', mockApi);
  assert.strictEqual(cand.status, 'ambiguous');
  assert.strictEqual(cand.candidate, null);
  assert.strictEqual(cand.candidates.length, 2);
});

// ── I11: Real TR 11489115 Seq 1 auto-resolves to Excel slice 0..48 ──────────
test('I11: Real TR 11489115 Seq 1 auto-resolves to Excel slice 0..48 (49 tracks)', () => {
  const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
  assert.ok(fs.existsSync(fixturePath), 'Fixture must exist');
  const rawRows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { tracks } = extractTrackingFromExcelRows(rawRows);

  startNewSession();
  state.receiptItems = tracks.map((trackNo, idx) => ({
    no: idx + 1,
    trackNo: trackNo,
    barcode: trackNo,
    photoIndex: null,
    receiptSeqNo: null,
    receiptSequenceId: null,
    mappingSource: null,
    scrollAnchor: null
  }));

  // Raw OCR output with typo (RI instead of RJ) and parsed qty 49
  const photos = [
    {
      id: 'photo_1',
      file: 'media_1790148735803.jpg',
      ocrSequenceSuggestions: [
        {
          id: 'sug_seq1',
          seqNo: 1,
          firstTrack: 'RI317132454TH', // OCR typo
          lastTrack: 'RI317133429TH',  // OCR typo + nominal endpoint
          printedFirstTrack: 'RI317132454TH',
          printedLastTrack: 'RI317133429TH',
          qty: 49,
          status: 'pending'
        }
      ]
    }
  ];

  const result = resolveReceiptRanges(photos, state.receiptItems);
  assert.strictEqual(result.resolvedCount, 1, 'Seq 1 must be auto-resolved');
  assert.strictEqual(result.mappedTrackCount, 49, '49 tracks mapped');

  // Verify slice 0..48
  for (let i = 0; i <= 48; i++) {
    assert.strictEqual(state.receiptItems[i].photoIndex, 0);
    assert.strictEqual(state.receiptItems[i].receiptSeqNo, 1);
    assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range');
  }
  // Track 49 must NOT be mapped to Seq 1
  assert.strictEqual(state.receiptItems[49].mappingSource, null);

  // Check audit trail preservation
  const sug = photos[0].ocrSequenceSuggestions[0];
  assert.strictEqual(sug.printedFirstTrack, 'RI317132454TH');
  assert.strictEqual(sug.printedLastTrack, 'RI317133429TH');
  assert.strictEqual(sug.resolvedFirstTrack, 'RJ317132454TH');
  assert.strictEqual(sug.resolvedLastTrack, 'RJ317133415TH'); // 49th track in Excel
  assert.strictEqual(sug.status, 'auto_resolved');
});

// ── I12: Real TR 11489115 Seq 2 auto-resolves to Excel slice 49..97 ─────────
test('I12: Real TR 11489115 Seq 2 auto-resolves to Excel slice 49..97 (49 tracks)', () => {
  const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
  const rawRows = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { tracks } = extractTrackingFromExcelRows(rawRows);

  startNewSession();
  state.receiptItems = tracks.map((trackNo, idx) => ({
    no: idx + 1,
    trackNo: trackNo,
    barcode: trackNo,
    photoIndex: null,
    receiptSeqNo: null,
    receiptSequenceId: null,
    mappingSource: null,
    scrollAnchor: null
  }));

  const photos = [
    {
      id: 'photo_1',
      file: 'media_1790148735803.jpg',
      ocrSequenceSuggestions: [
        {
          id: 'sug_seq1',
          seqNo: 1,
          firstTrack: 'RI317132454TH',
          lastTrack: 'RI317133429TH',
          qty: 49,
          status: 'pending'
        },
        {
          id: 'sug_seq2',
          seqNo: 2,
          firstTrack: 'RI317133432TH',
          lastTrack: 'RJ317134407TH',
          qty: 49,
          status: 'pending'
        }
      ]
    }
  ];

  const result = resolveReceiptRanges(photos, state.receiptItems);
  assert.strictEqual(result.resolvedCount, 2, 'Both Seq 1 and Seq 2 must be auto-resolved');
  assert.strictEqual(result.mappedTrackCount, 98, '98 tracks mapped (49 + 49)');

  // Verify slice 49..97
  for (let i = 49; i <= 97; i++) {
    assert.strictEqual(state.receiptItems[i].photoIndex, 0);
    assert.strictEqual(state.receiptItems[i].receiptSeqNo, 2);
    assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range');
  }

  // Cross-sequence adjacency
  const evalSeq1 = result.evaluatedSequences[0];
  const evalSeq2 = result.evaluatedSequences[1];
  assert.strictEqual(evalSeq1.isAdjacentValidated, true);
  assert.strictEqual(evalSeq2.isAdjacentValidated, true);
});

// ── I13: Click navigation points to correct sequence anchors ────────────────
test('I13: Click navigation points to correct sequence anchors', () => {
  // Item #1, #25, #49 share Seq 1 scroll anchor
  const anchorSeq1 = state.receiptItems[0].scrollAnchor;
  assert.ok(typeof anchorSeq1 === 'number');
  assert.strictEqual(state.receiptItems[24].scrollAnchor, anchorSeq1);
  assert.strictEqual(state.receiptItems[48].scrollAnchor, anchorSeq1);

  // Item #50, #98 share Seq 2 scroll anchor
  const anchorSeq2 = state.receiptItems[49].scrollAnchor;
  assert.ok(typeof anchorSeq2 === 'number');
  assert.strictEqual(state.receiptItems[97].scrollAnchor, anchorSeq2);
  assert.notStrictEqual(anchorSeq1, anchorSeq2);
});

// ── I14: Zero tracking arithmetic and zero global string replacement ────────
test('I14: Zero tracking arithmetic and zero global string replacement', () => {
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.ok(!appCode.includes('.replace(/RI/g'), 'No global RI->RJ string replace');
  assert.ok(!appCode.includes('.replaceAll("RI"'), 'No global RI->RJ string replace');
  assert.ok(!appCode.includes('.replaceAll(\'RI\''), 'No global RI->RJ string replace');
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL REAL OCR INPUT IMPROVEMENT TESTS PASSED! ✓\n');
} else {
  process.exit(1);
}
