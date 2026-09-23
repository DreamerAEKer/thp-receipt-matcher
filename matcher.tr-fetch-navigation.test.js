/**
 * matcher.tr-fetch-navigation.test.js
 *
 * Regression test suite for TR Fetch & Navigation safety (F1–F7).
 * Verifies that TR fetch NEVER navigates away from the app or calls window.open
 * under ANY API response condition (Success, Auth fail, 404, Quota exceeded, Error, Empty items).
 *
 * Run with: node matcher.tr-fetch-navigation.test.js
 */

'use strict';

const assert = require('assert');
const {
  buildReceiptCode,
  extractReceiptApiItems,
  processApiItems,
  cleanTrackNo
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

console.log('Running TR Fetch & Navigation Safety Test Suite (F1–F7)...\n');

(async () => {
  // ── F1: Click fetch does NOT navigate away or call window.open ──────────────
  test('F1: fetch handler never calls window.open or alters window.location under any path', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(__dirname + '/app.js', 'utf8');

    // Extract fetchTrackingByTR function body
    const fetchFuncStart = appJs.indexOf('async function fetchTrackingByTR');
    assert(fetchFuncStart > -1, 'fetchTrackingByTR must exist');
    const fetchFuncEnd = appJs.indexOf('// ─────────────────────────────────────────────────────────────────────────────\n// MATCHER ENGINE — SHADOW MODE ADAPTER', fetchFuncStart);
    assert(fetchFuncEnd > fetchFuncStart, 'Must find boundary of fetchTrackingByTR');
    const fetchFuncCode = appJs.slice(fetchFuncStart, fetchFuncEnd);

    // Verify zero occurrences of window.open or location assignment inside fetchTrackingByTR
    assert(!fetchFuncCode.includes('window.open'), 'fetchTrackingByTR must NOT contain window.open');
    assert(!fetchFuncCode.includes('location.href'), 'fetchTrackingByTR must NOT contain location.href');
    assert(!fetchFuncCode.includes('location.replace'), 'fetchTrackingByTR must NOT contain location.replace');
    assert(!fetchFuncCode.includes('location.assign'), 'fetchTrackingByTR must NOT contain location.assign');
    assert(!fetchFuncCode.includes('track.thailandpost.co.th/dashboard'), 'fetchTrackingByTR must NOT reference Thailand Post dashboard');
    assert(!fetchFuncCode.includes('track.thailandpost.co.th/login'), 'fetchTrackingByTR must NOT reference Thailand Post login');
  });

  // ── F2: Receipt code format = 10501|11489115 ───────────────────────────────
  test('F2: receipt code format is strictly zipPrefix|trDigits (e.g. 10501|11489115)', () => {
    const code1 = buildReceiptCode('10501', '11489115');
    assert.strictEqual(code1.zip, '10501');
    assert.strictEqual(code1.trDigits, '11489115');
    assert.strictEqual(code1.fullCode, '10501|11489115');

    // Strips non-digits
    const code2 = buildReceiptCode('10-501', 'TR 11489115');
    assert.strictEqual(code2.zip, '10501');
    assert.strictEqual(code2.trDigits, '11489115');
    assert.strictEqual(code2.fullCode, '10501|11489115');

    // Must NOT concatenate without pipe separator
    assert.notStrictEqual(code1.fullCode, '1050111489115');
  });

  // ── F3: Successful API response populates receiptItems in-app ───────────────
  test('F3: successful API response parses items and populates in-app receiptItems', () => {
    const mockApiResponse = {
      status: true,
      response: {
        receipts: {
          '10501|11489115': {
            'JG073580650TH': [{ barcode: 'JG073580650TH', status: '501', status_description: 'นำจ่ายสำเร็จ' }],
            'JG075314011TH': [{ barcode: 'JG075314011TH', status: '501', status_description: 'นำจ่ายสำเร็จ' }]
          }
        }
      }
    };

    const items = extractReceiptApiItems(mockApiResponse);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(cleanTrackNo(items[0].barcode), 'JG073580650TH');
    assert.strictEqual(cleanTrackNo(items[1].barcode), 'JG075314011TH');
  });

  // ── F4: API status=false remains in app and shows API error alert ───────────
  test('F4: API status=false remains in app and alerts error without navigation', () => {
    // Check that json?.status === false branch alerts error and does NOT redirect
    const fs = require('fs');
    const appJs = fs.readFileSync(__dirname + '/app.js', 'utf8');

    // Confirm that the status === false check uses alert, not confirm/window.open
    const statusFalseBlock = appJs.slice(
      appJs.indexOf('if (json?.status === false) {'),
      appJs.indexOf('const items = extractReceiptApiItems(json);')
    );
    assert(statusFalseBlock.includes('alert('), 'Must alert user in-app');
    assert(!statusFalseBlock.includes('window.open'), 'Must NOT call window.open');
    assert(!statusFalseBlock.includes('confirm('), 'Must NOT ask confirm to leave app');
  });

  // ── F5: Quota response identified correctly ────────────────────────────────
  test('F5: quota response identified correctly, warns in-app, does NOT claim not found', () => {
    const quotaMsg1 = 'blocked, your request over quota!!';
    const quotaMsg2 = 'Daily quota exceeded';
    const nonQuotaMsg = 'Invalid parameters';

    const isQuota1 = /quota|over\s*quota/i.test(quotaMsg1);
    const isQuota2 = /quota|over\s*quota/i.test(quotaMsg2);
    const isQuota3 = /quota|over\s*quota/i.test(nonQuotaMsg);

    assert.strictEqual(isQuota1, true, 'Should detect quota in quotaMsg1');
    assert.strictEqual(isQuota2, true, 'Should detect quota in quotaMsg2');
    assert.strictEqual(isQuota3, false, 'Should not detect quota in nonQuotaMsg');

    // Inspect app.js quota handling
    const fs = require('fs');
    const appJs = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const quotaCheck = appJs.includes('const isQuota = /quota|over\\s*quota/i.test(msg);');
    assert(quotaCheck, 'Must test quota regex');
    assert(appJs.includes('⚠️ API ปณท เกินโควตาการเรียกใช้งาน'), 'Must have distinct quota warning');
  });

  // ── F6: Auth failure does not navigate ─────────────────────────────────────
  test('F6: auth failure does not navigate, keeps user in-app with settings modal option', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync(__dirname + '/app.js', 'utf8');

    const authCatchIndex = appJs.indexOf("if (err.message === 'AUTH_FAILED')");
    assert(authCatchIndex > -1, 'Must handle AUTH_FAILED');
    const authCatchBlock = appJs.slice(authCatchIndex, authCatchIndex + 400);

    assert(authCatchBlock.includes('btnOpenApiModal'), 'Offers opening in-app API modal');
    assert(!authCatchBlock.includes('window.open'), 'Must NOT call window.open on auth fail');
  });

  // ── F7: Empty legitimate response distinguished from API error ─────────────
  test('F7: empty response distinguished from API error and handled purely in-app', () => {
    const mockEmptyApiResponse = {
      status: true,
      response: {
        receipts: {}
      }
    };
    const items = extractReceiptApiItems(mockEmptyApiResponse);
    assert.strictEqual(items.length, 0);

    const fs = require('fs');
    const appJs = fs.readFileSync(__dirname + '/app.js', 'utf8');
    const emptyCheckIndex = appJs.indexOf("alert('API ตอบกลับสำเร็จ แต่ไม่พบรายการสำหรับเลข TR นี้");
    assert(emptyCheckIndex > -1, 'Must have in-app notification for empty items');
  });

  console.log(`\nResults: ${passedTests} / ${totalTests} passed.`);
  if (passedTests === totalTests) {
    console.log('ALL TR FETCH & NAVIGATION REGRESSION TESTS (F1–F7) PASSED! ✓\n');
  } else {
    process.exitCode = 1;
  }
})();
