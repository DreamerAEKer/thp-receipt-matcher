/**
 * matcher.auto-range-resolution.test.js
 *
 * Test suite for Auto-Range Resolution & Simplified Normal User Workflow:
 *  1. exact first + qty -> safe auto resolve (CASE 2)
 *  2. exact last + qty -> safe auto resolve (CASE 3)
 *  3. exact both + matching qty -> safe auto resolve (CASE 1)
 *  4. missing qty -> review
 *  5. duplicate first -> review (ambiguous)
 *  6. duplicate last -> review (ambiguous)
 *  7. out of bounds -> review
 *  8. overlapping ranges -> review
 *  9. reversed / order conflict -> review
 * 10. adjacent next sequence validates boundary
 * 11. printed nominal endpoint retained for audit
 * 12. resolved endpoint comes only from actual Excel/API item
 * 13. no tracking arithmetic
 * 14. existing matcher-confirmed mapping not overwritten
 * 15. Real TR 11489115 fixture integration test (Seq 1 + Seq 2 + click navigation)
 *
 * Run with: node matcher.auto-range-resolution.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  state,
  startNewSession,
  resolveReceiptRanges,
  alignReceiptItemsToPhotos,
  selectItem,
  extractTrackingFromExcelRows
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

function createMockItems(count, prefix = 'EF', suffix = 'TH') {
  const items = [];
  for (let i = 0; i < count; i++) {
    const num = String(10000000 + i * 10).padStart(8, '0');
    // Standard Thailand Post 13-char format: 2 letters + 9 digits + 2 letters
    const trackNo = `${prefix}${num}1${suffix}`;
    items.push({
      no: i + 1,
      trackNo: trackNo,
      barcode: trackNo,
      order: i + 1,
      name: `Recipient ${i + 1}`,
      address: `Address ${i + 1}`,
      photoIndex: null,
      receiptSeqNo: null,
      receiptSequenceId: null,
      mappingSource: null,
      scrollAnchor: null
    });
  }
  return items;
}

// Mock DOM for selectItem
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

  global.document = {
    getElementById: (id) => elements[id] || makeEl(id),
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} })
  };
  global.window = global;
}

setupMockDom();

console.log('Running Auto-Range Resolution & Safety Test Suite (1–15)...\n');

// ── 1. exact first + qty -> safe auto resolve (CASE 2) ──────────────────────────
test('1: exact first + qty -> safe auto resolve', () => {
  startNewSession();
  state.receiptItems = createMockItems(60);

  // Exact first at index 10, nominal printed last missing from items, declared qty = 20
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_case2',
        seqNo: 1,
        firstTrack: state.receiptItems[10].trackNo,
        lastTrack: 'XX999999999TH', // nominal / missing from Excel
        printedFirstTrack: state.receiptItems[10].trackNo,
        printedLastTrack: 'XX999999999TH',
        qty: 20,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 1, 'CASE 2 must auto-resolve');
  assert.strictEqual(res.mappedTrackCount, 20, '20 items must be mapped');

  const evalSeq = res.evaluatedSequences[0];
  assert.strictEqual(evalSeq.confidence, 'strong');
  assert.strictEqual(evalSeq.resolutionCase, 'CASE 2 (Exact First + Qty)');
  assert.strictEqual(evalSeq.startIndex, 10);
  assert.strictEqual(evalSeq.endIndex, 29); // 10 + 20 - 1 = 29
  assert.strictEqual(evalSeq.resolvedLastTrack, state.receiptItems[29].trackNo);

  // Verify actual items mapped
  for (let i = 10; i <= 29; i++) {
    assert.strictEqual(state.receiptItems[i].photoIndex, 0);
    assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range');
  }
  // Unmapped items outside range
  assert.strictEqual(state.receiptItems[9].mappingSource, null);
  assert.strictEqual(state.receiptItems[30].mappingSource, null);
});

// ── 2. exact last + qty -> safe auto resolve (CASE 3) ───────────────────────────
test('2: exact last + qty -> safe auto resolve', () => {
  startNewSession();
  state.receiptItems = createMockItems(60);

  // Nominal printed first missing from items, exact last at index 35, declared qty = 15
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_case3',
        seqNo: 1,
        firstTrack: 'XX888888888TH', // nominal / missing from Excel
        lastTrack: state.receiptItems[35].trackNo,
        printedFirstTrack: 'XX888888888TH',
        printedLastTrack: state.receiptItems[35].trackNo,
        qty: 15,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 1, 'CASE 3 must auto-resolve');
  assert.strictEqual(res.mappedTrackCount, 15, '15 items must be mapped');

  const evalSeq = res.evaluatedSequences[0];
  assert.strictEqual(evalSeq.confidence, 'strong');
  assert.strictEqual(evalSeq.resolutionCase, 'CASE 3 (Exact Last + Qty)');
  assert.strictEqual(evalSeq.startIndex, 21); // 35 - 15 + 1 = 21
  assert.strictEqual(evalSeq.endIndex, 35);
  assert.strictEqual(evalSeq.resolvedFirstTrack, state.receiptItems[21].trackNo);

  for (let i = 21; i <= 35; i++) {
    assert.strictEqual(state.receiptItems[i].photoIndex, 0);
    assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range');
  }
});

// ── 3. exact both + matching qty -> safe auto resolve (CASE 1) ──────────────────
test('3: exact both + matching qty -> safe auto resolve', () => {
  startNewSession();
  state.receiptItems = createMockItems(50);

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_case1',
        seqNo: 1,
        firstTrack: state.receiptItems[5].trackNo,
        lastTrack: state.receiptItems[14].trackNo,
        qty: 10, // 14 - 5 + 1 = 10
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 1);
  assert.strictEqual(res.mappedTrackCount, 10);
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'strong');
  assert.strictEqual(res.evaluatedSequences[0].resolutionCase, 'CASE 1 (Exact First + Last + Qty)');
});

// ── 4. missing qty -> review ────────────────────────────────────────────────────
test('4: missing qty -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(50);

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_noqty',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: 'XX999999999TH',
        qty: null, // missing qty
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Missing qty must NOT auto-resolve');
  assert.strictEqual(res.needsReviewCount, 1, 'Must be flagged for review');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'needs_review');
});

// ── 5. duplicate first -> review ────────────────────────────────────────────────
test('5: duplicate first -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(30);
  // Introduce duplicate tracking number at index 0 and index 15
  state.receiptItems[15].trackNo = state.receiptItems[0].trackNo;
  state.receiptItems[15].barcode = state.receiptItems[0].trackNo;

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_dup_first',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: state.receiptItems[9].trackNo,
        qty: 10,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Duplicate anchor must NOT auto-resolve');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'conflict');
  assert.ok(res.evaluatedSequences[0].conflictReason.includes('duplicate / ambiguous'));
});

// ── 6. duplicate last -> review ─────────────────────────────────────────────────
test('6: duplicate last -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(30);
  // Introduce duplicate last tracking number at index 9 and index 20
  state.receiptItems[20].trackNo = state.receiptItems[9].trackNo;
  state.receiptItems[20].barcode = state.receiptItems[9].trackNo;

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_dup_last',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: state.receiptItems[9].trackNo,
        qty: 10,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Duplicate last anchor must NOT auto-resolve');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'conflict');
  assert.ok(res.evaluatedSequences[0].conflictReason.includes('duplicate / ambiguous'));
});

// ── 7. out of bounds -> review ──────────────────────────────────────────────────
test('7: out of bounds -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(20);

  // startIndex = 15, qty = 10 -> targetEndIndex = 24 (exceeds total 20 items)
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_oob',
        seqNo: 1,
        firstTrack: state.receiptItems[15].trackNo,
        lastTrack: 'XX999999999TH',
        qty: 10,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Out-of-bounds slice must NOT auto-resolve');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'conflict');
  assert.ok(res.evaluatedSequences[0].conflictReason.includes('out of bounds'));
});

// ── 8. overlapping ranges -> review ─────────────────────────────────────────────
test('8: overlapping ranges -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(50);

  // Seq 1: items 0..19 (qty 20)
  // Seq 2: items 15..29 (qty 15) -> Overlaps on items 15..19
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_s1',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: state.receiptItems[19].trackNo,
        qty: 20,
        status: 'pending'
      },
      {
        id: 'sug_s2',
        seqNo: 2,
        firstTrack: state.receiptItems[15].trackNo,
        lastTrack: state.receiptItems[29].trackNo,
        qty: 15,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Overlapping ranges must NOT auto-resolve');
  assert.strictEqual(res.needsReviewCount, 2, 'Both overlapping ranges must be flagged');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'conflict');
  assert.strictEqual(res.evaluatedSequences[1].confidence, 'conflict');
});

// ── 9. reversed / order conflict -> review ──────────────────────────────────────
test('9: reversed / order conflict -> review', () => {
  startNewSession();
  state.receiptItems = createMockItems(50);

  // firstTrack at index 25, lastTrack at index 10 -> REVERSED ORDER
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_rev',
        seqNo: 1,
        firstTrack: state.receiptItems[25].trackNo,
        lastTrack: state.receiptItems[10].trackNo,
        qty: 16,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 0, 'Reversed anchor must NOT auto-resolve');
  assert.strictEqual(res.evaluatedSequences[0].confidence, 'conflict');
  assert.ok(res.evaluatedSequences[0].conflictReason.includes('reversed order'));
});

// ── 10. adjacent next sequence validates boundary ───────────────────────────────
test('10: adjacent next sequence validates boundary', () => {
  startNewSession();
  state.receiptItems = createMockItems(100);

  // Seq 1: items 0..48 (qty 49)
  // Seq 2: items 49..97 (qty 49)
  // 48 + 1 === 49 -> Mutual boundary adjacency confirmed
  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_adj1',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: 'XX999999999TH', // nominal endpoint
        qty: 49,
        status: 'pending'
      },
      {
        id: 'sug_adj2',
        seqNo: 2,
        firstTrack: state.receiptItems[49].trackNo,
        lastTrack: 'YY999999999TH', // nominal endpoint
        qty: 49,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 2);
  assert.strictEqual(res.mappedTrackCount, 98);

  const seq1 = res.evaluatedSequences[0];
  const seq2 = res.evaluatedSequences[1];

  assert.strictEqual(seq1.isAdjacentValidated, true, 'Seq 1 must be adjacency-validated');
  assert.strictEqual(seq2.isAdjacentValidated, true, 'Seq 2 must be adjacency-validated');
  assert.strictEqual(seq1.endIndex + 1, seq2.startIndex, 'Boundaries must be exactly contiguous');
});

// ── 11. printed nominal endpoint retained for audit ─────────────────────────────
test('11: printed nominal endpoint retained for audit', () => {
  startNewSession();
  state.receiptItems = createMockItems(50);

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_audit',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: 'RJ317133429TH', // printed nominal endpoint
        printedFirstTrack: state.receiptItems[0].trackNo,
        printedLastTrack: 'RJ317133429TH',
        qty: 25,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  const evalSeq = res.evaluatedSequences[0];

  assert.strictEqual(evalSeq.printedLastTrack, 'RJ317133429TH', 'Must retain printedLastTrack');
  assert.strictEqual(evalSeq.resolvedLastTrack, state.receiptItems[24].trackNo, 'Must record resolvedLastTrack');
  assert.notStrictEqual(evalSeq.printedLastTrack, evalSeq.resolvedLastTrack, 'Printed and resolved endpoints remain distinct');
});

// ── 12. resolved endpoint comes only from actual Excel/API item ─────────────────
test('12: resolved endpoint comes only from actual Excel/API item', () => {
  startNewSession();
  state.receiptItems = createMockItems(40);

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_verified',
        seqNo: 1,
        firstTrack: state.receiptItems[5].trackNo,
        lastTrack: 'UNKNOWN_OR_OCR_NOISE',
        qty: 12,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  const evalSeq = res.evaluatedSequences[0];

  // targetEndIndex is 5 + 12 - 1 = 16
  const actualTargetItem = state.receiptItems[16];
  assert.strictEqual(evalSeq.resolvedLastTrack, actualTargetItem.trackNo, 'Must come strictly from actual Excel items');
});

// ── 13. no tracking arithmetic ──────────────────────────────────────────────────
test('13: zero tracking number arithmetic', () => {
  // Check that tracking numbers with non-consecutive or alphanumeric codes are sliced strictly by array index
  startNewSession();
  const arbitraryTracks = [
    'EF000000010TH',
    'EF000000025TH', // Non-linear step (+15)
    'EF000000099TH', // Non-linear step (+74)
    'EF000000100TH',
    'EF000000999TH'
  ];
  state.receiptItems = arbitraryTracks.map((tr, idx) => ({
    no: idx + 1,
    trackNo: tr,
    barcode: tr,
    photoIndex: null,
    mappingSource: null
  }));

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_no_arith',
        seqNo: 1,
        firstTrack: 'EF000000010TH',
        lastTrack: 'EF000000099TH',
        qty: 3, // indexes 0..2
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 1);
  assert.strictEqual(res.evaluatedSequences[0].resolvedLastTrack, 'EF000000099TH');
  assert.deepStrictEqual(res.evaluatedSequences[0].trackIndexes, [0, 1, 2]);
});

// ── 14. existing matcher-confirmed mapping not overwritten ──────────────────────
test('14: existing matcher-confirmed mapping not overwritten', () => {
  startNewSession();
  state.receiptItems = createMockItems(20);

  // Pre-confirm item at index 5 with matcher
  state.receiptItems[5].photoIndex = 2;
  state.receiptItems[5].receiptSeqNo = 99;
  state.receiptItems[5].mappingSource = 'matcher';

  const photo = {
    id: 'p0',
    file: 'blob:p0',
    ocrSequenceSuggestions: [
      {
        id: 'sug_keep_matcher',
        seqNo: 1,
        firstTrack: state.receiptItems[0].trackNo,
        lastTrack: state.receiptItems[9].trackNo,
        qty: 10,
        status: 'pending'
      }
    ]
  };
  state.photos = [photo];

  const res = resolveReceiptRanges(state.photos, state.receiptItems);
  assert.strictEqual(res.resolvedCount, 1);

  // Item 5 must retain matcher mapping
  assert.strictEqual(state.receiptItems[5].mappingSource, 'matcher');
  assert.strictEqual(state.receiptItems[5].photoIndex, 2);
  assert.strictEqual(state.receiptItems[5].receiptSeqNo, 99);

  // Other items in range must receive receipt-range mapping
  assert.strictEqual(state.receiptItems[4].mappingSource, 'receipt-range');
  assert.strictEqual(state.receiptItems[4].photoIndex, 0);
  assert.strictEqual(state.receiptItems[6].mappingSource, 'receipt-range');
  assert.strictEqual(state.receiptItems[6].photoIndex, 0);
});

// ── 15. Real TR 11489115 fixture integration test ───────────────────────────────
test('15: Real TR 11489115 fixture integration test (Seq 1 + Seq 2 + click navigation)', () => {
  const fixturePath = path.join(__dirname, 'tracking_20260923_fixture.json');
  assert.ok(fs.existsSync(fixturePath), 'tracking_20260923_fixture.json must exist');

  const rawJson = fs.readFileSync(fixturePath, 'utf8');
  const rawRows = JSON.parse(rawJson);
  const { tracks } = extractTrackingFromExcelRows(rawRows);

  startNewSession();
  state.receiptItems = tracks.map((trackNo, idx) => ({
    no: idx + 1,
    trackNo: trackNo,
    barcode: trackNo,
    order: idx + 1,
    name: `User ${idx + 1}`,
    photoIndex: null,
    receiptSeqNo: null,
    receiptSequenceId: null,
    mappingSource: null,
    scrollAnchor: null
  }));

  assert.strictEqual(state.receiptItems.length, 216, 'TR 11489115 fixture has 216 items');

  // Real receipt data from TR 11489115:
  // Seq 1: RJ317132454TH - RJ317133429TH (qty 49)
  // Seq 2: RJ317133432TH - RJ317134407TH (qty 49)
  state.photos = [
    {
      id: 'photo_page1',
      file: 'blob:page1',
      detectedTR: '11489115',
      detectedRcpt: '10501|11489115',
      ocrSequenceSuggestions: [
        {
          id: 'sug_tr_seq1',
          seqNo: 1,
          firstTrack: 'RJ317132454TH',
          lastTrack: 'RJ317133429TH', // printed nominal endpoint (not in Excel)
          printedFirstTrack: 'RJ317132454TH',
          printedLastTrack: 'RJ317133429TH',
          qty: 49,
          status: 'pending'
        },
        {
          id: 'sug_tr_seq2',
          seqNo: 2,
          firstTrack: 'RJ317133432TH',
          lastTrack: 'RJ317134407TH', // printed nominal endpoint (not in Excel)
          printedFirstTrack: 'RJ317133432TH',
          printedLastTrack: 'RJ317134407TH',
          qty: 49,
          status: 'pending'
        }
      ]
    }
  ];

  // Auto-resolve should occur via alignReceiptItemsToPhotos() without any manual intervention
  alignReceiptItemsToPhotos();

  const sug1 = state.photos[0].ocrSequenceSuggestions[0];
  const sug2 = state.photos[0].ocrSequenceSuggestions[1];

  assert.strictEqual(sug1.autoResolved, true, 'Seq 1 must be autoResolved');
  assert.strictEqual(sug1.status, 'auto_resolved', 'Seq 1 status must be auto_resolved');
  assert.strictEqual(sug1.resolvedLastTrack, 'RJ317133415TH', 'Seq 1 resolvedLastTrack is index 48');
  assert.strictEqual(sug1.printedLastTrack, 'RJ317133429TH', 'Seq 1 printedLastTrack is retained');

  assert.strictEqual(sug2.autoResolved, true, 'Seq 2 must be autoResolved');
  assert.strictEqual(sug2.status, 'auto_resolved', 'Seq 2 status must be auto_resolved');
  assert.strictEqual(sug2.resolvedLastTrack, 'RJ317134398TH', 'Seq 2 resolvedLastTrack is index 97');
  assert.strictEqual(sug2.printedLastTrack, 'RJ317134407TH', 'Seq 2 printedLastTrack is retained');

  // Verify all 98 items mapped
  const mappedItems = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
  assert.strictEqual(mappedItems.length, 98, 'Total 98 tracks mapped across Seq 1 and Seq 2');

  // Verify click navigation for tracks
  const track1 = state.receiptItems[0];   // RJ317132454TH (#1 in Seq 1)
  const track25 = state.receiptItems[24]; // #25 in Seq 1
  const track49 = state.receiptItems[48]; // #49 in Seq 1 (RJ317133415TH)
  const track50 = state.receiptItems[49]; // #50 in Seq 2 (RJ317133432TH)

  assert.strictEqual(track1.receiptSeqNo, 1);
  assert.strictEqual(track25.receiptSeqNo, 1);
  assert.strictEqual(track49.receiptSeqNo, 1);
  assert.strictEqual(track50.receiptSeqNo, 2);

  // Seq 1 members share exact same scrollAnchor
  assert.strictEqual(track1.scrollAnchor, track25.scrollAnchor);
  assert.strictEqual(track1.scrollAnchor, track49.scrollAnchor);

  // Seq 2 member has distinct scrollAnchor
  assert.notStrictEqual(track1.scrollAnchor, track50.scrollAnchor);

  // Test selectItem navigation on track 1
  selectItem(track1, true);
  const container = document.getElementById('receiptContainer');
  const scrollPosSeq1 = container.lastScrollTop;
  assert.ok(typeof scrollPosSeq1 === 'number');

  // Test selectItem navigation on track 50 (Seq 2)
  selectItem(track50, true);
  const scrollPosSeq2 = container.lastScrollTop;
  assert.ok(typeof scrollPosSeq2 === 'number');
  assert.notStrictEqual(scrollPosSeq1, scrollPosSeq2, 'Seq 1 and Seq 2 must scroll to distinct visual anchors');
});

console.log(`\nAuto-Range Resolution Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL AUTO-RANGE RESOLUTION TESTS (1–15) PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME TESTS FAILED!\n');
  process.exit(1);
}
