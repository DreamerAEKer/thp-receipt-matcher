/**
 * matcher.real-receipt.test.js
 *
 * Real Receipt & Structural Validation for Matcher Engine
 * Uses verified data from physical receipt photos (TR 11476142 / RCPT 132994)
 * and structural validation for multi-RCPT evidence (TR 11489115 / RCPT 18101, 18102).
 *
 * Note: Real API Track Array for TR 11489115 is NOT AVAILABLE (quota was exhausted).
 * NO synthetic 216 items are fabricated. Missing items are reported honestly.
 */

'use strict';

const assert = require('assert');
const {
  normalizeTrackNo,
  buildTrackIndex,
  matchSequence,
  detectRcptBoundary,
  groupItemsByRcpt,
  matchReceiptGroup,
  matchAll,
  MATCH_CONFIDENCE,
  SOURCE,
  RCPT_SOURCE_PRIORITY
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

console.log('Running STRUCTURAL / AVAILABLE REAL RECEIPT VALIDATION Suite...\n');

// ─── PART 1: TR 11476142 = validated against available physical receipt + 26-item data ─
test('REAL-1: TR 11476142 = validated against available physical receipt + 26-item data (RCPT 132994)', () => {
  // Verified from media_1789374315239.jpg..248.jpg and mock-data.js
  const verifiedApiItems = [
    { barcode: 'JG073580650TH' }, // Seq 1: ทัศพร
    { barcode: 'JG075314011TH' }, // Seq 2: จรินทร์
    { barcode: 'JG075469061TH' }, // Seq 3: มิตร
    { barcode: 'JG075469716TH' }, // Seq 4: Peerasan
    { barcode: 'JG075176947TH' }, // Seq 5: Haidar
    { barcode: 'JG074231956TH' }, // Seq 6: John
    { barcode: 'JG075360869TH' }, // Seq 7: ศุภืช
    { barcode: 'JG073596765TH' }, // Seq 8: อัญ
    { barcode: 'JG074246607TH' }, // Seq 9: กอล์ฟ
    { barcode: 'JG074455389TH' }, // Seq 10: แซม
    { barcode: 'JG075187556TH' }, // Seq 11: Rubilolla
    { barcode: 'JG074246125TH' }, // Seq 12: Mahmoud
    { barcode: 'JG073577939TH' }, // Seq 13: Phil
    { barcode: 'JG075665145TH' }, // Seq 14: Kim
    { barcode: 'JG074218098TH' }, // Seq 15: IOUIS
    { barcode: 'JG073741414TH' }, // Seq 16: จำเนียร
    { barcode: 'JG075593276TH' }, // Seq 17: เก๋
    { barcode: 'JG075469557TH' }, // Seq 18: Valerie
    { barcode: 'JG075449606TH' }, // Seq 19: Elad
    { barcode: 'JG075314135TH' }, // Seq 20: andrea
    { barcode: 'JG075240910TH' }, // Seq 21: สุรีย์พร
    { barcode: 'JG075187587TH' }, // Seq 22: Ric
    { barcode: 'JG073583713TH' }, // Seq 23: Bukhla
    { barcode: 'JG075314935TH' }, // Seq 24: MD
    { barcode: 'JG074244725TH' }, // Seq 25: จารุวัฒน์
    { barcode: 'JG073784216TH' }  // Seq 26: Meleshkin
  ];

  const sequences = verifiedApiItems.map((item, idx) => ({
    rcptNo: '132994',
    seqNo: idx + 1,
    firstTrack: item.barcode,
    lastTrack: item.barcode,
    qty: 1,
    fieldSources: { rcptNo: 'ocr', seqNo: 'ocr', firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
  }));

  const { groups } = matchAll({
    trNo: '11476142',
    apiItems: verifiedApiItems,
    sequences
  });

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].trNo, '11476142');
  assert.strictEqual(groups[0].rcptNo, '132994');
  assert.strictEqual(groups[0].sequences.length, 26);
  assert.strictEqual(groups[0].rcptSource, 'ocr');

  // Verify all 26 sequences matched with STRONG confidence without arithmetic
  groups[0].sequences.forEach((seq, idx) => {
    assert.strictEqual(seq.confidence, MATCH_CONFIDENCE.STRONG);
    assert.strictEqual(seq.apiStartIndex, idx);
    assert.strictEqual(seq.apiEndIndex, idx);
    assert.strictEqual(seq.matchedTracks[0].trackNo, verifiedApiItems[idx].barcode);
  });
});

// ─── PART 2: TR 11489115 = STRUCTURE ONLY / LIVE VALIDATION PENDING ──────────
test('REAL-2: TR 11489115 (STRUCTURE ONLY / LIVE VALIDATION PENDING): Multi-RCPT 18101 & 18102 coexistence', () => {
  const sequences = [
    {
      rcptNo: '18101',
      seqNo: 1,
      firstTrack: 'RJ317132454TH',
      lastTrack: 'RJ317133429TH',
      qty: 49,
      fieldSources: { rcptNo: 'ocr', seqNo: 'ocr', firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
    },
    {
      rcptNo: '18101',
      seqNo: 2,
      firstTrack: 'RR314728503TH',
      lastTrack: 'RR314728503TH',
      qty: 1,
      fieldSources: { rcptNo: 'ocr', seqNo: 'ocr', firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
    },
    {
      rcptNo: '18102',
      seqNo: 1, // Sequence reset to 1 in new RCPT!
      firstTrack: 'ED123456789TH',
      lastTrack: 'ED123456789TH',
      qty: 1,
      fieldSources: { rcptNo: 'ocr', seqNo: 'ocr', firstTrack: 'ocr', lastTrack: 'ocr', qty: 'ocr' }
    }
  ];

  const groups = groupItemsByRcpt('11489115', sequences);

  assert.strictEqual(groups.length, 2, 'Must create exactly 2 distinct RCPT groups');

  const g18101 = groups.find(g => g.rcptNo === '18101');
  const g18102 = groups.find(g => g.rcptNo === '18102');

  assert.ok(g18101, 'RCPT 18101 group must exist');
  assert.ok(g18102, 'RCPT 18102 group must exist');

  assert.strictEqual(g18101.sequences.length, 2);
  assert.strictEqual(g18102.sequences.length, 1);

  // Both have seqNo: 1 but belong to different groups and different objects
  assert.strictEqual(g18101.sequences[0].seqNo, 1);
  assert.strictEqual(g18101.sequences[0].firstTrack, 'RJ317132454TH');

  assert.strictEqual(g18102.sequences[0].seqNo, 1);
  assert.strictEqual(g18102.sequences[0].firstTrack, 'ED123456789TH');

  assert.notStrictEqual(g18101.sequences[0], g18102.sequences[0], 'Must be completely separate sequence objects');
});

// ─── PART 3: STRUCTURAL VALIDATION B — Sequence Reset Inference ─────────────
test('REAL-3: Sequence reset without RCPT evidence is marked INFERRED, not confirmed', () => {
  const sequences = [
    { rcptNo: null, seqNo: 33, firstTrack: 'TK033TH' },
    { rcptNo: null, seqNo: 34, firstTrack: 'TK034TH' },
    { rcptNo: null, seqNo: 1,  firstTrack: 'TK101TH' } // Reset from 34 to 1!
  ];

  const boundaries = detectRcptBoundary(sequences);
  assert.deepStrictEqual(boundaries, [0, 2]);

  const groups = groupItemsByRcpt('11489115', sequences);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].rcptNo, null);
  assert.strictEqual(groups[0].rcptSource, SOURCE.INFERRED);
  assert.strictEqual(groups[1].rcptNo, null);
  assert.strictEqual(groups[1].rcptSource, SOURCE.INFERRED);
});

// ─── PART 4: STRUCTURAL VALIDATION C & D — Range & Quantity Conflict ─────────
test('REAL-4: Range slice quantity mismatch produces CONFLICT, cannot auto-match', () => {
  // Mini API slice with 3 items
  const miniApi = [
    { barcode: 'RR314728477TH' },
    { barcode: 'RR314728485TH' },
    { barcode: 'RR314728494TH' }
  ];
  const { trackMap, apiTracks } = buildTrackIndex(miniApi);

  // If printed receipt said qty = 4 (or 2), but API has 3
  const seqMismatch = {
    firstTrack: 'RR314728477TH',
    lastTrack:  'RR314728494TH',
    qty: 4 // Mismatch: API slice has 3!
  };

  const res = matchSequence(seqMismatch, trackMap, apiTracks);
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(res.conflictReason.includes('qty mismatch'));

  // If printed receipt qty matches exactly 3
  const seqMatch = {
    firstTrack: 'RR314728477TH',
    lastTrack:  'RR314728494TH',
    qty: 3 // Exact match
  };
  const resMatch = matchSequence(seqMatch, trackMap, apiTracks);
  assert.strictEqual(resMatch.confidence, MATCH_CONFIDENCE.STRONG);
  assert.deepStrictEqual(resMatch.trackIndexes, [0, 1, 2]);
});

// ─── PART 5: STRUCTURAL VALIDATION E — Missing Real API Data Protection ───────
test('REAL-5: Missing Real API track array returns CONFLICT for unverified anchors (no fake pass)', () => {
  // Only empty/unfetched API items exist for TR 11489115 (since quota exceeded)
  const emptyApi = [];
  const { trackMap, apiTracks } = buildTrackIndex(emptyApi);

  const seq = {
    rcptNo: '18101',
    seqNo: 1,
    firstTrack: 'RJ317132454TH',
    lastTrack: 'RJ317133429TH',
    qty: 49
  };

  const res = matchSequence(seq, trackMap, apiTracks);
  // Must NOT fabricate tracks or return STRONG
  assert.strictEqual(res.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.ok(res.conflictReason.includes('not found in API array'));
  assert.strictEqual(res.matchedTracks.length, 0);
});

// ─── PART 6: OCR SAFETY — Character Preservation ─────────────────────────────
test('REAL-6: OCR Safety: normalizeTrackNo trims whitespace/case only, NO destructive mutation', () => {
  // Spacing and lower-case
  assert.strictEqual(normalizeTrackNo('  rj 3171 3245 4 th  '), 'RJ317132454TH');

  // Must NOT auto-correct I to 1 or 7H to TH
  const rawWithOcrNoise = 'RJ3171324547H'; // 7H instead of TH
  assert.strictEqual(normalizeTrackNo(rawWithOcrNoise), 'RJ3171324547H', 'Must NOT mutate 7H to TH');

  const rawWithLetterI = 'RJI17132454TH'; // I instead of 1
  assert.strictEqual(normalizeTrackNo(rawWithLetterI), 'RJI17132454TH', 'Must NOT mutate letter I to digit 1');

  const rawWithLetterO = 'RJ3O7132454TH'; // O instead of 0
  assert.strictEqual(normalizeTrackNo(rawWithLetterO), 'RJ3O7132454TH', 'Must NOT mutate letter O to digit 0');
});

console.log(`\nReal Receipt Validation Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL REAL RECEIPT VALIDATION TESTS PASSED! ✓\n');
} else {
  console.error(`FAILED: ${totalTests - passedTests} test(s) failed.\n`);
  process.exit(1);
}
