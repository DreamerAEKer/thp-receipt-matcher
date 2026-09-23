/**
 * matcher.receipt-range-mapping.test.js
 *
 * Regression test suite for Core Receipt Range Mapping:
 * 1. first index 0, last index 48, qty 49 -> map 49 actual items to Seq1
 * 2. next first index 49, last index 97, qty 49 -> map next 49 items to Seq2
 * 3. click item inside Seq1 เช่น item 25 -> opens Seq1 photo/anchor
 * 4. click last item Seq1 -> still Seq1 anchor
 * 5. click first item Seq2 -> Seq2 anchor
 * 6. qty mismatch -> do NOT strong-map
 * 7. missing first anchor -> do NOT map
 * 8. missing last anchor -> do NOT map
 * 9. reversed anchors -> do NOT map
 * 10. duplicate exact tracking number -> ambiguous / do NOT map
 * 11. No tracking arithmetic anywhere
 * 12. Existing matcher-confirmed mapping -> not overwritten
 *
 * Run with: node matcher.receipt-range-mapping.test.js
 */

'use strict';

const assert = require('assert');
const {
  state,
  startNewSession,
  resolveReceiptRanges,
  getSequenceScrollAnchor,
  alignReceiptItemsToPhotos,
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

console.log('Running Core Receipt Range Mapping Test Suite (1–12)...\n');

// Mock browser DOM environment
function setupMockDom() {
  const elements = {};

  function makeEl(id, extra = {}) {
    const el = {
      id,
      className: '',
      classList: {
        add: (...cls) => {
          cls.forEach(c => {
            if (!el.className.includes(c)) el.className = (el.className + ' ' + c).trim();
          });
        },
        remove: (...cls) => {
          cls.forEach(c => {
            el.className = el.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim();
          });
        },
        contains: (c) => el.className.includes(c)
      },
      textContent: '',
      innerHTML: '',
      value: '',
      src: '',
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 0,
      lastScrollCall: null,
      scrollTo: function(opts) {
        el.lastScrollCall = opts;
        el.scrollTop = typeof opts === 'object' ? opts.top : opts;
      },
      children: [],
      appendChild: (c) => el.children.push(c),
      removeAttribute: (attr) => { delete el[attr]; },
      querySelector: () => null,
      querySelectorAll: () => [],
      ...extra
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
  makeEl('trNumberInput');
  makeEl('searchInput');
  makeEl('imageFileInput');
  makeEl('excelFileInput');
  makeEl('zoomLevelIndicator');
  makeEl('countBadge');
  makeEl('sourceBadge');

  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeEl(`mock-${tag}-${Math.random().toString(36).slice(2)}`),
    querySelectorAll: () => []
  };

  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  global.alert = () => {};
  global.confirm = () => true;

  return { elements };
}

/**
 * Generates test items simulating actual imported tracks.
 * Format: RJ31713xxxxTH or arbitrary strings without arithmetic assumptions.
 */
function createMockItems(count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    // Unique formatted track string
    const numStr = String(100000000 + i);
    const track = `RJ${numStr.slice(1)}TH`;
    items.push({
      no: i + 1,
      trackNo: track,
      trackFormatted: track,
      recipient: `Recipient ${i + 1}`,
      photoIndex: null,
      mappingSource: 'excel'
    });
  }
  return items;
}

(async () => {
  const { elements } = setupMockDom();

  // ── 1. first index 0, last index 48, qty 49 -> map 49 actual items to Seq1 ──
  test('1: first index 0, last index 48, qty 49 -> map 49 actual items to Seq1', () => {
    startNewSession();
    state.receiptItems = createMockItems(100);

    const firstTrackSeq1 = state.receiptItems[0].trackNo;
    const lastTrackSeq1 = state.receiptItems[48].trackNo;

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        label: 'Photo 1',
        sequences: [
          { seqNo: 1, firstTrack: firstTrackSeq1, lastTrack: lastTrackSeq1, qty: 49, rcptNo: '18101' }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    // Verify all 49 items are mapped to Seq 1
    const seq1Items = state.receiptItems.filter(i => i.receiptSeqNo === 1);
    assert.strictEqual(seq1Items.length, 49, 'Must map exactly 49 items to Seq 1');
    for (let i = 0; i < 49; i++) {
      assert.strictEqual(state.receiptItems[i].photoIndex, 0, `Item ${i} must have photoIndex 0`);
      assert.strictEqual(state.receiptItems[i].receiptSeqNo, 1, `Item ${i} must have receiptSeqNo 1`);
      assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range', `Item ${i} mappingSource must be receipt-range`);
      assert.strictEqual(typeof state.receiptItems[i].scrollAnchor, 'number', `Item ${i} must have scrollAnchor`);
    }
    // Items past index 48 must NOT be mapped to Seq 1
    assert.notStrictEqual(state.receiptItems[49].receiptSeqNo, 1);
  });

  // ── 2. next first index 49, last index 97, qty 49 -> map next 49 items to Seq2 ──
  test('2: next first index 49, last index 97, qty 49 -> map next 49 items to Seq2', () => {
    startNewSession();
    state.receiptItems = createMockItems(100);

    const firstTrackSeq1 = state.receiptItems[0].trackNo;
    const lastTrackSeq1 = state.receiptItems[48].trackNo;
    const firstTrackSeq2 = state.receiptItems[49].trackNo;
    const lastTrackSeq2 = state.receiptItems[97].trackNo;

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        label: 'Photo 1',
        sequences: [
          { seqNo: 1, firstTrack: firstTrackSeq1, lastTrack: lastTrackSeq1, qty: 49, rcptNo: '18101' },
          { seqNo: 2, firstTrack: firstTrackSeq2, lastTrack: lastTrackSeq2, qty: 49, rcptNo: '18101' }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    const seq2Items = state.receiptItems.filter(i => i.receiptSeqNo === 2);
    assert.strictEqual(seq2Items.length, 49, 'Must map exactly 49 items to Seq 2');
    for (let i = 49; i <= 97; i++) {
      assert.strictEqual(state.receiptItems[i].photoIndex, 0);
      assert.strictEqual(state.receiptItems[i].receiptSeqNo, 2);
      assert.strictEqual(state.receiptItems[i].mappingSource, 'receipt-range');
      assert.strictEqual(typeof state.receiptItems[i].scrollAnchor, 'number');
    }
  });

  // ── 3. click item inside Seq1 เช่น item 25 -> opens Seq1 photo/anchor ──────
  test('3: click item inside Seq1 เช่น item 25 -> opens Seq1 photo/anchor', () => {
    elements.receiptContainer.scrollHeight = 1000;
    elements.receiptContainer.clientHeight = 200;
    elements.receiptContainer.scrollTop = 0;
    elements.receiptContainer.lastScrollCall = null;

    // Item 25 (index 24) is inside Sequence 1
    const item25 = state.receiptItems[24];
    selectItem(item25, true);

    assert.strictEqual(state.activePhotoIndex, 0, 'Must open Seq 1 photo (photo 0)');
    assert(elements.receiptContainer.lastScrollCall !== null, 'Must scroll photo into position');
    const scrollSeq1 = elements.receiptContainer.scrollTop;
    assert(scrollSeq1 > 0, 'Scroll position must be positive');
  });

  // ── 4. click last item Seq1 -> still Seq1 anchor ───────────────────────────
  test('4: click last item Seq1 -> still Seq1 anchor', () => {
    // Record scroll position of item 25
    selectItem(state.receiptItems[24], true);
    const scrollItem25 = elements.receiptContainer.scrollTop;

    // Item 49 (index 48) is the last item of Sequence 1
    const item49 = state.receiptItems[48];
    selectItem(item49, true);

    const scrollItem49 = elements.receiptContainer.scrollTop;
    assert.strictEqual(scrollItem49, scrollItem25, 'Last item of Seq 1 must scroll to EXACT SAME anchor as item 25');
  });

  // ── 5. click first item Seq2 -> Seq2 anchor ────────────────────────────────
  test('5: click first item Seq2 -> Seq2 anchor', () => {
    selectItem(state.receiptItems[24], true);
    const scrollSeq1 = elements.receiptContainer.scrollTop;

    // Item 50 (index 49) is the first item of Sequence 2
    const item50 = state.receiptItems[49];
    selectItem(item50, true);

    const scrollSeq2 = elements.receiptContainer.scrollTop;
    assert.notStrictEqual(scrollSeq2, scrollSeq1, 'Seq 2 anchor must differ from Seq 1 anchor');
    assert(scrollSeq2 > scrollSeq1, 'Seq 2 anchor must be positioned further down the receipt');
  });

  // ── 6. qty mismatch -> do NOT strong-map ───────────────────────────────────
  test('6: qty mismatch -> do NOT strong-map', () => {
    startNewSession();
    state.receiptItems = createMockItems(100);

    const firstTrack = state.receiptItems[0].trackNo;
    const lastTrack = state.receiptItems[48].trackNo; // actual slice = 49 items

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          // Declared qty is 50, but actual slice is 49 -> MISMATCH!
          { seqNo: 1, firstTrack, lastTrack, qty: 50, rcptNo: '18101' }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    // Must NOT strong map
    const mapped = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
    assert.strictEqual(mapped.length, 0, 'Must NOT map items to receipt-range when qty mismatches');
  });

  // ── 7. missing both anchors -> do NOT map ──────────────────────────────────
  test('7: missing both anchors -> do NOT map', () => {
    startNewSession();
    state.receiptItems = createMockItems(50);

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          { seqNo: 1, firstTrack: 'XX999999999TH', lastTrack: 'YY999999999TH', qty: 11 }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    const mapped = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
    assert.strictEqual(mapped.length, 0, 'Must not map when both anchors are absent from items');
  });

  // ── 8. missing qty when last anchor absent -> do NOT map ───────────────────
  test('8: missing qty when last anchor absent -> do NOT map', () => {
    startNewSession();
    state.receiptItems = createMockItems(50);

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          { seqNo: 1, firstTrack: state.receiptItems[0].trackNo, lastTrack: 'XX999999999TH', qty: null }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    const mapped = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
    assert.strictEqual(mapped.length, 0, 'Must not map when qty is missing and lastTrack is absent');
  });

  // ── 9. reversed anchors -> do NOT map ──────────────────────────────────────
  test('9: reversed anchors -> do NOT map', () => {
    startNewSession();
    state.receiptItems = createMockItems(50);

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          // First anchor is index 20, last anchor is index 5 -> REVERSED!
          { seqNo: 1, firstTrack: state.receiptItems[20].trackNo, lastTrack: state.receiptItems[5].trackNo, qty: 16 }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    const mapped = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
    assert.strictEqual(mapped.length, 0, 'Must not map when anchors are in reversed order');
  });

  // ── 10. duplicate exact tracking number -> ambiguous / do NOT map ──────────
  test('10: duplicate exact tracking number -> ambiguous / do NOT map', () => {
    startNewSession();
    state.receiptItems = createMockItems(50);

    // Inject duplicate barcode at index 0 and index 25
    state.receiptItems[25].trackNo = state.receiptItems[0].trackNo;
    state.receiptItems[25].trackFormatted = state.receiptItems[0].trackNo;

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          { seqNo: 1, firstTrack: state.receiptItems[0].trackNo, lastTrack: state.receiptItems[10].trackNo, qty: 11 }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    const mapped = state.receiptItems.filter(i => i.mappingSource === 'receipt-range');
    assert.strictEqual(mapped.length, 0, 'Must not map when anchor is ambiguous due to duplicate tracking numbers');
  });

  // ── 11. No tracking arithmetic anywhere ────────────────────────────────────
  test('11: No tracking arithmetic anywhere', () => {
    startNewSession();
    // Non-linear, non-sequential tracking numbers:
    const customTracks = [
      'RJ999999999TH', // idx 0
      'RJ111111111TH', // idx 1 (lower digit than idx 0!)
      'RR888888888TH', // idx 2
      'RJ555555555TH'  // idx 3
    ];
    state.receiptItems = customTracks.map((tr, idx) => ({
      no: idx + 1,
      trackNo: tr,
      trackFormatted: tr,
      photoIndex: null,
      mappingSource: 'excel'
    }));

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          { seqNo: 1, firstTrack: 'RJ999999999TH', lastTrack: 'RJ555555555TH', qty: 4 }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    // All 4 tracks mapped purely by array position, despite irregular barcode strings
    assert.strictEqual(state.receiptItems[0].receiptSeqNo, 1);
    assert.strictEqual(state.receiptItems[1].receiptSeqNo, 1);
    assert.strictEqual(state.receiptItems[2].receiptSeqNo, 1);
    assert.strictEqual(state.receiptItems[3].receiptSeqNo, 1);
    assert.strictEqual(state.receiptItems[1].trackNo, 'RJ111111111TH', 'Barcode string must not be altered');
  });

  // ── 12. Existing matcher-confirmed mapping -> not overwritten ───────────────
  test('12: Existing matcher-confirmed mapping -> not overwritten', () => {
    startNewSession();
    state.receiptItems = createMockItems(50);

    // Pre-existing user-confirmed matcher mapping on item 0
    state.receiptItems[0].photoIndex = 5;
    state.receiptItems[0].receiptSeqNo = 99;
    state.receiptItems[0].mappingSource = 'matcher';
    state.receiptItems[0].scrollAnchor = 0.99;

    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        sequences: [
          { seqNo: 1, firstTrack: state.receiptItems[0].trackNo, lastTrack: state.receiptItems[10].trackNo, qty: 11 }
        ]
      }
    ];

    alignReceiptItemsToPhotos();

    // Item 0 must retain matcher mapping
    assert.strictEqual(state.receiptItems[0].mappingSource, 'matcher', 'mappingSource must remain matcher');
    assert.strictEqual(state.receiptItems[0].photoIndex, 5, 'photoIndex must not be overwritten');
    assert.strictEqual(state.receiptItems[0].receiptSeqNo, 99, 'receiptSeqNo must not be overwritten');
    assert.strictEqual(state.receiptItems[0].scrollAnchor, 0.99, 'scrollAnchor must not be overwritten');

    // Other items in sequence (1..10) get mapped to receipt-range
    assert.strictEqual(state.receiptItems[1].mappingSource, 'receipt-range');
    assert.strictEqual(state.receiptItems[1].photoIndex, 0);
  });

  console.log(`\nCore Receipt Range Mapping Results: ${passedTests} / ${totalTests} passed.`);
  if (passedTests === totalTests) {
    console.log('ALL CORE RECEIPT RANGE MAPPING TESTS (1–12) PASSED SUCCESSFULLY! ✓\n');
  } else {
    console.error('SOME TESTS FAILED!\n');
    process.exitCode = 1;
  }
})();
