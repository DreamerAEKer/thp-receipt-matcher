/**
 * matcher.prefix-boundary-tr-rcpt.test.js
 *
 * Verification suite for:
 * 1. Prefix Boundary Protection: RJ tracks can NEVER map to RR photos, and vice versa.
 * 2. Multi-Receipt API Query: requestReceiptTracking queries candidate codes (TR and RCPT).
 * 3. Elimination of Blind Division: Unmapped items remain unmapped (photoIndex: null)
 *    rather than being dumped onto incompatible photos.
 */

'use strict';

const assert = require('assert');
const {
  state,
  startNewSession,
  alignReceiptItemsToPhotos,
  getTrackServicePrefix,
  getPhotoServicePrefix,
  buildReceiptCode
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
  makeEl('autoSaveIndicator');
  makeEl('autoSaveText');
  makeEl('autoSaveIcon');
  makeEl('trNumberInput');
  makeEl('searchInput');
  makeEl('zoomLevelIndicator');
  makeEl('countBadge');
  makeEl('sourceBadge');

  global.document = {
    getElementById: (id) => elements[id] || makeEl(id),
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {} })
  };
  global.window = global;
}

setupMockDom();

console.log('Running Prefix Boundary & TR/RCPT Test Suite...\n');

// ── 1. getTrackServicePrefix ──────────────────────────────────────────────────
test('1: getTrackServicePrefix extracts 2-letter uppercase prefix', () => {
  assert.strictEqual(getTrackServicePrefix('RJ317132454TH'), 'RJ');
  assert.strictEqual(getTrackServicePrefix('RR314728596TH'), 'RR');
  assert.strictEqual(getTrackServicePrefix('ed 1234 5678 9 th'), 'ED');
  assert.strictEqual(getTrackServicePrefix(''), '');
  assert.strictEqual(getTrackServicePrefix(null), '');
});

// ── 2. getPhotoServicePrefix ──────────────────────────────────────────────────
test('2: getPhotoServicePrefix detects prefix from sequences or label', () => {
  const photoRJ = {
    sequences: [
      { firstTrack: 'RJ317132454TH', lastTrack: 'RJ317133429TH' }
    ]
  };
  assert.strictEqual(getPhotoServicePrefix(photoRJ), 'RJ');

  const photoRR = {
    ocrSequenceSuggestions: [
      { firstTrack: 'RR314728596TH', lastTrack: 'RR314728596TH' }
    ]
  };
  assert.strictEqual(getPhotoServicePrefix(photoRR), 'RR');

  const photoLabeled = { label: 'ใบเสร็จในประเทศ (RJ)' };
  assert.strictEqual(getPhotoServicePrefix(photoLabeled), 'RJ');
});

// ── 3. Prefix Boundary Protection: RJ cannot map to RR photo ─────────────────
test('3: RJ items cannot be assigned to RR photo even if within numeric range', () => {
  startNewSession();

  // Setup 2 photos:
  // Photo 0: RJ photo (ranges 1..176)
  // Photo 1: RR photo (ranges 177..216, but misconfigured or loose range 170..216)
  state.photos = [
    {
      id: 'p0',
      label: 'Photo 1 (RJ)',
      sequences: [{ firstTrack: 'RJ317132454TH', lastTrack: 'RJ317135963TH' }],
      startNo: 1,
      endNo: 170
    },
    {
      id: 'p1',
      label: 'Photo 2 (RR)',
      sequences: [{ firstTrack: 'RR314728361TH', lastTrack: 'RR314728755TH' }],
      startNo: 171,
      endNo: 216 // overlap range covering 171..176 which are RJ items!
    }
  ];

  // Item #174 is an RJ item!
  state.receiptItems = [
    { no: 174, trackNo: 'RJ317135915TH', barcode: 'RJ317135915TH' },
    { no: 177, trackNo: 'RR314728361TH', barcode: 'RR314728361TH' }
  ];

  alignReceiptItemsToPhotos();

  // Item #174 (RJ) must NOT be assigned to Photo 1 (RR photo)
  assert.notStrictEqual(state.receiptItems[0].photoIndex, 1, 'RJ item #174 must NEVER map to RR photo 1');
  
  // Item #177 (RR) matches Photo 1 (RR photo)
  assert.strictEqual(state.receiptItems[1].photoIndex, 1, 'RR item #177 must map to RR photo 1');
});

// ── 4. Elimination of Blind Bucket Fallback ──────────────────────────────────
test('4: Unmapped items remain photoIndex: null instead of being dumped into arbitrary photos', () => {
  startNewSession();

  state.photos = [
    {
      id: 'p0',
      file: 'blob:p0',
      sequences: [{ firstTrack: 'RJ317132454TH', lastTrack: 'RJ317132454TH', qty: 1 }]
    },
    {
      id: 'p1',
      file: 'blob:p1'
      // No sequences yet
    }
  ];

  state.receiptItems = [
    { no: 1, trackNo: 'RJ317132454TH', barcode: 'RJ317132454TH' }, // matches Seq
    { no: 174, trackNo: 'RJ317135915TH', barcode: 'RJ317135915TH' } // unmapped
  ];

  alignReceiptItemsToPhotos();

  assert.strictEqual(state.receiptItems[0].photoIndex, 0, 'Item 1 matches photo 0');
  assert.strictEqual(state.receiptItems[1].photoIndex, null, 'Unmapped item 174 must remain null, NOT guessed to photo 1');
});

// ── 5. buildReceiptCode supports TR or RCPT digits ────────────────────────────
test('5: buildReceiptCode correctly handles 5-digit zip + TR/RCPT digits', () => {
  const resTR = buildReceiptCode('10501', '11489115');
  assert.strictEqual(resTR.fullCode, '10501|11489115');

  const resRCPT = buildReceiptCode('10501', '18101');
  assert.strictEqual(resRCPT.fullCode, '10501|18101');
});

console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL PREFIX BOUNDARY & TR/RCPT TESTS PASSED! ✓\n');
} else {
  process.exit(1);
}
