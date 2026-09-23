/**
 * matcher.click-nav-reset.test.js
 *
 * Regression test suite for:
 * 1. Click Track -> Receipt Navigation & Scroll Following (Phase 2: A, B, C, D)
 * 2. Start New Job -> Clean Workspace & Session Isolation (Phase 3: 1, 2, 3, 4, 5, 6)
 *
 * Run with: node matcher.click-nav-reset.test.js
 */

'use strict';

const assert = require('assert');
const {
  state,
  selectItem,
  switchPhoto,
  highlightItemNo,
  startNewSession,
  autoRestoreLatestSession,
  buildMatcherApplyPlan,
  applyMatcherMapping
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

console.log('Running Receipt Navigation & Clean Reset Test Suite...\n');

// Mock a lightweight browser environment for DOM calls
function setupMockDom() {
  const elements = {};

  function makeEl(id, extra = {}) {
    const el = {
      id,
      className: '',
      classList: {
        add: (...cls) => {
          cls.forEach(c => {
            if (!el.className.includes(c)) el.className += ' ' + c;
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
  makeEl('statDelivered');

  // Cards in itemsList
  makeEl('card-item-1');
  makeEl('card-item-5');
  makeEl('card-item-10');
  makeEl('card-item-15');

  global.document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeEl(`mock-${tag}-${Date.now()}`),
    querySelectorAll: (sel) => {
      if (sel === '#itemsList > div') {
        return [elements['card-item-1'], elements['card-item-5'], elements['card-item-10'], elements['card-item-15']].filter(Boolean);
      }
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

  return { elements, storage };
}

(async () => {
  const { elements, storage } = setupMockDom();

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 2: CLICK TRACK -> RECEIPT NAVIGATION & SCROLL
  // ══════════════════════════════════════════════════════════════════════════════

  test('A. item with valid photoIndex switches to that photo', () => {
    // Setup 2 photos
    state.photos = [
      { id: 'p0', file: 'blob:p0', label: 'Photo 1', startNo: 1, endNo: 10 },
      { id: 'p1', file: 'blob:p1', label: 'Photo 2', startNo: 11, endNo: 20 }
    ];
    state.activePhotoIndex = 0;
    state.receiptItems = [
      { no: 5, trackNo: 'RJ111111111TH', recipient: 'Alice', photoIndex: 0 },
      { no: 15, trackNo: 'RR222222222TH', recipient: 'Bob', photoIndex: 1 }
    ];

    // Click item 15 (bound to photoIndex 1)
    selectItem(state.receiptItems[1], true);

    assert.strictEqual(state.activePhotoIndex, 1, 'activePhotoIndex must switch to 1');
    assert.strictEqual(state.activeItemNo, 15, 'activeItemNo must be 15');
    assert.strictEqual(elements.receiptImage.src, 'blob:p1', 'receiptImage src must be photo 1 file');
  });

  test('B. item in middle of page range calculates scroll position proportionally', () => {
    state.photos = [
      { id: 'p0', file: 'blob:p0', label: 'Photo 1', startNo: 1, endNo: 10 }
    ];
    state.activePhotoIndex = 0;
    state.receiptItems = [
      { no: 5, trackNo: 'RJ111111111TH', recipient: 'Alice', photoIndex: 0 }
    ];

    // receiptContainer: scrollHeight 1000, clientHeight 200 -> maxScroll = 800
    // range: startNo=1, endNo=10 (pageCount=10)
    // item.no = 5: indexInPage = 5 - 1 = 4 -> ratio = 4 / 10 = 0.4
    // targetScroll = 800 * 0.4 = 320
    selectItem(state.receiptItems[0], true);

    assert(elements.receiptContainer.lastScrollCall, 'receiptContainer.scrollTo must be called');
    assert.strictEqual(elements.receiptContainer.lastScrollCall.top, 320, 'Scroll top must equal 320 (40% of 800)');
    assert.strictEqual(elements.receiptContainer.lastScrollCall.behavior, 'smooth');
  });

  test('C. item without photoIndex does not crash and does not scroll', () => {
    state.photos = [
      { id: 'p0', file: 'blob:p0', label: 'Photo 1', startNo: 1, endNo: 10 }
    ];
    state.activePhotoIndex = 0;
    elements.receiptContainer.lastScrollCall = null;

    const unmappedItem = { no: 99, trackNo: 'RJ999999999TH', recipient: 'NoPhoto', photoIndex: null };
    
    // Must execute cleanly without error
    assert.doesNotThrow(() => {
      selectItem(unmappedItem, true);
    });

    assert.strictEqual(state.activeItemNo, 99);
    assert.strictEqual(state.activePhotoIndex, 0, 'activePhotoIndex must remain unchanged');
    assert.strictEqual(elements.receiptContainer.lastScrollCall, null, 'Must not scroll photo container');
  });

  test('D. invalid photoIndex (out of bounds or negative) does not crash or corrupt state', () => {
    state.photos = [
      { id: 'p0', file: 'blob:p0', label: 'Photo 1', startNo: 1, endNo: 10 }
    ];
    state.activePhotoIndex = 0;
    elements.receiptContainer.lastScrollCall = null;

    const negItem = { no: 101, trackNo: 'RJ101TH', photoIndex: -1 };
    const overItem = { no: 102, trackNo: 'RJ102TH', photoIndex: 999 };

    assert.doesNotThrow(() => selectItem(negItem, true));
    assert.strictEqual(state.activePhotoIndex, 0);
    assert.strictEqual(elements.receiptContainer.lastScrollCall, null);

    assert.doesNotThrow(() => selectItem(overItem, true));
    assert.strictEqual(state.activePhotoIndex, 0);
    assert.strictEqual(elements.receiptContainer.lastScrollCall, null);
  });

  test('E. existing Matcher Supervised Apply preserves photoIndex and enables click navigation', () => {
    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        label: 'Photo 1',
        detectedRcpt: '18101',
        sequences: [
          { rcptNo: '18101', seqNo: 1, firstTrack: 'RJ317133401TH', lastTrack: 'RJ317133402TH', qty: 2 }
        ]
      }
    ];
    state.receiptItems = [
      { no: 1, trackNo: 'RJ317133401TH', recipient: 'Recipient 1', mappingSource: 'excel', photoIndex: null },
      { no: 2, trackNo: 'RJ317133402TH', recipient: 'Recipient 2', mappingSource: 'excel', photoIndex: null }
    ];

    const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
    assert.strictEqual(plan.readyCount, 2);

    const res = applyMatcherMapping();
    assert.strictEqual(res.success, true);
    assert.strictEqual(state.receiptItems[0].photoIndex, 0);
    assert.strictEqual(state.receiptItems[1].photoIndex, 0);

    // Click item 2 after apply
    elements.receiptContainer.lastScrollCall = null;
    selectItem(state.receiptItems[1], true);
    assert.strictEqual(state.activeItemNo, 2);
    assert(elements.receiptContainer.lastScrollCall !== null, 'Applied item must now trigger scroll navigation');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // PHASE 3: START NEW JOB / CLEAN RESET & SESSION ISOLATION
  // ══════════════════════════════════════════════════════════════════════════════

  test('1-3. startNewSession clears working state, photos, evidence, suggestions, and DOM', () => {
    // Populate working state
    state.photos = [
      {
        id: 'p0',
        file: 'blob:p0',
        detectedTR: '11489115',
        detectedRcpt: '18101',
        sequences: [{ rcptNo: '18101', seqNo: 1, firstTrack: 'RJ1TH' }],
        ocrSequenceSuggestions: [{ seqNo: 1, firstTrack: 'RJ1TH' }]
      }
    ];
    state.receiptItems = [{ no: 1, trackNo: 'RJ1TH' }];
    state.excelMap.set('RJ1TH', { destination: 'BKK' });
    state.activeItemNo = 5;
    state.activePhotoIndex = 3;
    state.currentSessionId = 'session-123';
    state.matcherAppliedSignature = 'sig-abc';
    state.matcherApplyInfo = { mappedCount: 1 };

    elements.trNumberInput.value = '11489115';
    elements.pageManageList.innerHTML = '<div>old review items</div>';
    storage.thp_latest_session_id = 'session-123';
    storage.thp_latest_cropped_receipt = 'data:...';

    // Global settings that should NOT be wiped
    storage.thp_api_token = 'my-secret-token';
    storage.thp_zip_prefix = '10501';

    // Run startNewSession
    startNewSession();

    // Verify working state is completely empty
    assert.strictEqual(state.photos.length, 0, 'photos must be empty');
    assert.strictEqual(state.receiptItems.length, 0, 'receiptItems must be empty');
    assert.strictEqual(state.excelMap.size, 0, 'excelMap must be empty');
    assert.strictEqual(state.currentSessionId, null, 'currentSessionId must be null');
    assert.strictEqual(state.matcherAppliedSignature, null, 'matcherAppliedSignature must be null');
    assert.strictEqual(state.matcherApplyInfo, null, 'matcherApplyInfo must be null');
    assert.strictEqual(state.activeItemNo, 1, 'activeItemNo must reset to 1');
    assert.strictEqual(state.activePhotoIndex, 0, 'activePhotoIndex must reset to 0');

    // Verify DOM inputs cleared
    assert.strictEqual(elements.trNumberInput.value, '', 'trNumberInput must be blank');
    assert.strictEqual(elements.pageManageList.innerHTML, '', 'pageManageList must be cleared');

    // Verify working session storage keys removed
    assert.strictEqual(storage.thp_latest_session_id, undefined, 'thp_latest_session_id must be removed');
    assert.strictEqual(storage.thp_latest_cropped_receipt, undefined, 'thp_latest_cropped_receipt must be removed');

    // Verify global credentials preserved
    assert.strictEqual(storage.thp_api_token, 'my-secret-token', 'API token must be preserved');
    assert.strictEqual(storage.thp_zip_prefix, '10501', 'Zip prefix must be preserved');
  });

  await asyncTest('4-6. simulate reload/restore after startNewSession: old session does NOT return', async () => {
    // Ensure latest session id is not present (as cleared by startNewSession)
    delete storage.thp_latest_session_id;

    // Simulate autoRestoreLatestSession
    await autoRestoreLatestSession();

    // Workspace must remain clean
    assert.strictEqual(state.photos.length, 0, 'Workspace must remain clean on reload');
    assert.strictEqual(state.receiptItems.length, 0, 'No old receipt items resurrected');
    assert.strictEqual(state.currentSessionId, null, 'currentSessionId must remain null');
  });

  console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
  if (passedTests === totalTests) {
    console.log('ALL RECEIPT NAVIGATION & CLEAN RESET TESTS PASSED! ✓');
  } else {
    process.exitCode = 1;
  }
})();
