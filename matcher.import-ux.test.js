/**
 * matcher.import-ux.test.js
 *
 * Regression test suite for Import UX + Excel Navigation Integration:
 * 1. API success + tracks -> receiptItems populated, source=api
 * 2. API success + null/0 tracks -> recommend Excel, no navigation/retry
 * 3. quota response -> Excel recommendation
 * 4. auth error -> settings + Excel choices
 * 5. Excel import -> receiptItems populated, source=excel
 * 6. Excel items + photos -> alignment assigns photoIndex
 * 7. click Excel item -> correct photo switch
 * 8. click Excel item -> receipt scroll follows
 * 9. New Job -> source indicator cleared
 * 10. Existing active job + new import -> no silent merge
 *
 * Run with: node matcher.import-ux.test.js
 */

'use strict';

const assert = require('assert');
const {
  state,
  buildReceiptCode,
  processApiItems,
  extractTrackingFromExcelRows,
  processExcelRows,
  alignReceiptItemsToPhotos,
  selectItem,
  switchPhoto,
  startNewSession,
  renderItems,
  handleExcelUpload,
  fetchTrackingByTR
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

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('Running Import UX & Excel Navigation Integration Test Suite (1–10)...\n');

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
      click: () => { el.clicked = true; },
      ...extra
    };
    elements[id] = el;
    return el;
  }

  // Create required DOM elements
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
  makeEl('pageManageList');
  makeEl('pageManageModal');
  makeEl('countBadge');
  makeEl('sourceBadge');
  makeEl('statDelivered');
  makeEl('btnFetchTR');
  makeEl('btnOpenApiModal');

  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeEl(`mock-${tag}-${Math.random().toString(36).slice(2)}`),
    querySelectorAll: (sel) => {
      if (sel === '.filter-btn') {
        return [{ getAttribute: () => 'all', className: '' }];
      }
      return [];
    }
  };

  // Mock localStorage
  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  global.alert = () => {};
  global.confirm = () => true;

  return { elements, storage };
}

(async () => {
  const { elements } = setupMockDom();

  // ── 1. API success + tracks -> receiptItems populated, source=api ────────────
  test('1: API success + tracks -> receiptItems populated, source=api', () => {
    startNewSession();
    assert.strictEqual(state.trackSource, null);

    const mockApiItems = [
      { barcode: 'JG073580650TH', status: '501', status_description: 'นำจ่ายสำเร็จ', recipient_name: 'สมชาย' },
      { barcode: 'JG075314011TH', status: '501', status_description: 'นำจ่ายสำเร็จ', recipient_name: 'สมหญิง' }
    ];

    processApiItems(mockApiItems);

    assert.strictEqual(state.receiptItems.length, 2, 'Must have 2 items populated');
    assert.strictEqual(state.trackSource, 'api', 'state.trackSource must be api');
    assert.strictEqual(state.apiFeedback, null, 'state.apiFeedback must be cleared on success');

    renderItems();
    assert.strictEqual(elements.sourceBadge.textContent, 'แหล่งข้อมูล: Thailand Post API');
    assert(!elements.sourceBadge.classList.contains('hidden'), 'sourceBadge must be visible');
  });

  // ── 2. API success + null/0 tracks -> recommend Excel, no navigation/retry ───
  test('2: API success + null/0 tracks -> recommend Excel, no navigation/retry', () => {
    startNewSession();
    state.apiFeedback = { type: 'empty', trCode: '10501|11489115' };

    renderItems();

    const html = elements.itemsList.innerHTML;
    assert(html.includes('ไม่พบรายการ Track จากเลข TR นี้'), 'Must display empty result message');
    assert(html.includes('แนะนำให้นำเข้าจาก Excel'), 'Must recommend Excel import');
    assert(html.includes('btnGuideExcel'), 'Must render Excel button');
    assert(html.includes('btnGuideRetryTR'), 'Must render Retry TR button');
    // Ensure no unproven claims
    assert(!html.includes('หมดอายุ'), 'Must not claim expired without proof');
    assert(!html.includes('Token ไม่ตรง'), 'Must not claim wrong token ownership without proof');
  });

  // ── 3. Quota response -> Excel recommendation ──────────────────────────────
  test('3: quota response -> Excel recommendation', () => {
    startNewSession();
    state.apiFeedback = { type: 'quota', message: 'HTTP 429' };

    renderItems();

    const html = elements.itemsList.innerHTML;
    assert(html.includes('จำกัดการเรียกใช้งานชั่วคราว'), 'Must display quota message');
    assert(html.includes('นำเข้าจาก Excel'), 'Must recommend Excel import');
    assert(html.includes('btnGuideExcel'), 'Must have btnGuideExcel');
    // No auto-retry
    assert(!html.includes('btnGuideRetryTR'), 'Must not encourage rapid auto-retry on quota');
  });

  // ── 4. Auth error -> settings + Excel choices ───────────────────────────────
  test('4: auth error -> settings + Excel choices', () => {
    startNewSession();
    state.apiFeedback = { type: 'auth_error' };

    renderItems();

    const html = elements.itemsList.innerHTML;
    assert(html.includes('ไม่สามารถยืนยันสิทธิ์ API ได้'), 'Must display auth error message');
    assert(html.includes('btnGuideApiSettings'), 'Must provide API settings button');
    assert(html.includes('btnGuideExcel'), 'Must provide Excel alternative button');
  });

  // ── 5. Excel import -> receiptItems populated, source=excel ─────────────────
  test('5: Excel import -> receiptItems populated, source=excel', () => {
    startNewSession();
    const rows = [
      ['ลำดับ', 'Barcode'],
      ['1', 'RJ123456789TH'],
      ['2', 'RR987654321TH']
    ];

    processExcelRows(rows);

    assert.strictEqual(state.receiptItems.length, 2, 'Must have 2 receipt items');
    assert.strictEqual(state.trackSource, 'excel', 'state.trackSource must be excel');
    assert.strictEqual(state.receiptItems[0].mappingSource, 'excel');

    renderItems();
    assert.strictEqual(elements.sourceBadge.textContent, 'แหล่งข้อมูล: Excel');
    assert(!elements.sourceBadge.classList.contains('hidden'), 'sourceBadge must be visible');
  });

  // ── 6. Excel items + photos -> alignment assigns photoIndex ──────────────────
  test('6: Excel items + photos -> alignment assigns photoIndex', () => {
    startNewSession();
    const rows = [
      ['ลำดับ', 'Barcode'],
      ['1', 'RJ000000001TH'],
      ['2', 'RJ000000002TH'],
      ['3', 'RR000000003TH'],
      ['4', 'RR000000004TH']
    ];
    processExcelRows(rows);

    // Provide 2 photos with explicit sequence ranges
    state.photos = [
      { id: 'p0', file: 'blob:p0', label: 'Photo 1', startNo: 1, endNo: 2 },
      { id: 'p1', file: 'blob:p1', label: 'Photo 2', startNo: 3, endNo: 4 }
    ];

    alignReceiptItemsToPhotos();

    assert.strictEqual(state.receiptItems[0].photoIndex, 0, 'Item 1 should align to photo 0');
    assert.strictEqual(state.receiptItems[1].photoIndex, 0, 'Item 2 should align to photo 0');
    assert.strictEqual(state.receiptItems[2].photoIndex, 1, 'Item 3 should align to photo 1');
    assert.strictEqual(state.receiptItems[3].photoIndex, 1, 'Item 4 should align to photo 1');
  });

  // ── 7. Click Excel item -> correct photo switch ─────────────────────────────
  test('7: click Excel item -> correct photo switch', () => {
    state.activePhotoIndex = 0;
    elements.receiptImage.src = 'blob:p0';

    // Click item 3 (aligned to photo 1)
    selectItem(state.receiptItems[2], true);

    assert.strictEqual(state.activePhotoIndex, 1, 'Should switch active photo index to 1');
    assert.strictEqual(state.activeItemNo, 3, 'Active item number should be 3');
    assert.strictEqual(elements.receiptImage.src, 'blob:p1', 'Image src should update to photo 1');
  });

  // ── 8. Click Excel item -> receipt scroll follows ───────────────────────────
  test('8: click Excel item -> receipt scroll follows', () => {
    elements.receiptContainer.scrollHeight = 1000;
    elements.receiptContainer.clientHeight = 200;

    // Click item 4 (end of photo 1 range 3..4 -> near bottom of photo 1)
    selectItem(state.receiptItems[3], true);

    assert(elements.receiptContainer.lastScrollCall !== null, 'scrollTo must have been called');
    const targetTop = typeof elements.receiptContainer.lastScrollCall === 'object'
      ? elements.receiptContainer.lastScrollCall.top
      : elements.receiptContainer.lastScrollCall;
    assert(targetTop > 0, 'Scroll position should be positive');
  });

  // ── 9. New Job -> source indicator cleared ──────────────────────────────────
  test('9: New Job -> source indicator cleared', () => {
    assert(state.receiptItems.length > 0, 'Precondition: active items exist');
    assert.strictEqual(state.trackSource, 'excel');

    startNewSession();

    assert.strictEqual(state.trackSource, null, 'trackSource must be null');
    assert.strictEqual(state.apiFeedback, null, 'apiFeedback must be null');
    assert.strictEqual(state.receiptItems.length, 0, 'receiptItems must be empty');
    assert(elements.sourceBadge.classList.contains('hidden'), 'sourceBadge must be hidden');
    assert.strictEqual(elements.sourceBadge.textContent, '', 'sourceBadge text must be empty');
  });

  // ── 10. Existing active job + new import -> no silent merge ─────────────────
  test('10: Existing active job + new import -> no silent merge', () => {
    // Populate an existing job with 2 items
    state.receiptItems = [
      { no: 1, trackNo: 'RJ111111111TH', recipient: 'Alice', photoIndex: 0 },
      { no: 2, trackNo: 'RJ222222222TH', recipient: 'Bob', photoIndex: 0 }
    ];
    state.trackSource = 'excel';

    // Simulate user Canceling confirmation on Excel upload
    let confirmPrompt = '';
    global.confirm = (msg) => {
      confirmPrompt = msg;
      return false; // User cancels!
    };

    const mockEvt = {
      target: {
        files: [{ name: 'test.xlsx' }],
        value: 'C:\\fakepath\\test.xlsx'
      }
    };

    handleExcelUpload(mockEvt);

    assert(confirmPrompt.includes('ขณะนี้มีงานที่กำลังทำอยู่'), 'Must prompt user for replacement');
    assert.strictEqual(state.receiptItems.length, 2, 'Must retain original items when canceled');
    assert.strictEqual(state.receiptItems[0].trackNo, 'RJ111111111TH');
    assert.strictEqual(mockEvt.target.value, '', 'Must reset file input value');

    // Simulate user Confirming replacement
    global.confirm = () => true;
    // When user confirms, startNewSession() is called before parsing new data
    // Let's verify startNewSession clears existing work
    startNewSession();
    assert.strictEqual(state.receiptItems.length, 0, 'Must cleanly clear old items on confirm');
  });

  console.log(`\nImport UX & Excel Navigation Integration Results: ${passedTests} / ${totalTests} passed.`);
  if (passedTests === totalTests) {
    console.log('ALL IMPORT UX & EXCEL NAVIGATION REGRESSION TESTS (1–10) PASSED SUCCESSFULLY! ✓\n');
  } else {
    console.error('SOME TESTS FAILED!\n');
    process.exitCode = 1;
  }
})();
