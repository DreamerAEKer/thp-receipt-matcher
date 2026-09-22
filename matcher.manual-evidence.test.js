/**
 * matcher.manual-evidence.test.js
 * Integration test suite for Phase 2A: Manual Receipt Evidence Capture (M1–M12).
 *
 * Verifies:
 * - Single track normalization and range verification against real API arrays
 * - Conflict detection (qty mismatch, missing anchors, reversed order)
 * - Multi-RCPT coexistence (same seqNo across distinct RCPTs)
 * - Duplicate protection (same seqNo under the same RCPT)
 * - Incomplete evidence handling
 * - Persistence round-trip (IndexedDB serialization/hydration)
 * - Backward compatibility with legacy sessions
 * - Zero mutation of API tracks
 *
 * Run with: node matcher.manual-evidence.test.js
 */

'use strict';

const assert = require('assert');
const {
  normalizeTrackNo,
  buildTrackIndex,
  matchSequence,
  matchAll,
  MATCH_CONFIDENCE,
  SOURCE
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

console.log('Running Manual Evidence Integration Test Suite (M1–M12)...\n');

// Standard fixture of real API tracks (no arithmetic generation)
const sampleApiItems = [
  { barcode: 'EF000000001TH', recipient_name: 'Recipient 1' }, // index 0
  { barcode: 'EF000000002TH', recipient_name: 'Recipient 2' }, // index 1
  { barcode: 'EF000000003TH', recipient_name: 'Recipient 3' }, // index 2
  { barcode: 'EF000000004TH', recipient_name: 'Recipient 4' }, // index 3
  { barcode: 'EF000000005TH', recipient_name: 'Recipient 5' }, // index 4
  { barcode: 'RR111111111TH', recipient_name: 'Recipient 6' }, // index 5
  { barcode: 'RR111111112TH', recipient_name: 'Recipient 7' }, // index 6
  { barcode: 'RR111111113TH', recipient_name: 'Recipient 8' }  // index 7
];

// Adapter simulation for pure node environment matching app.js buildMatcherPaperEvidence logic
function adaptPhotoEvidence(photos) {
  let detectedTR = null;
  const rcptMap = new Map();
  const allSequences = [];
  const seqIdentityCounts = new Map();

  photos.forEach((photo, idx) => {
    if (!photo) return;
    if (!detectedTR && photo.detectedTR) detectedTR = String(photo.detectedTR).trim();

    let photoRcpt = null;
    let photoSource = 'ocr';
    if (photo.detectedRcpt) {
      photoRcpt = String(photo.detectedRcpt).trim();
      photoSource = Boolean(photo.userConfirmed) ? 'manual' : 'ocr';
      if (!rcptMap.has(photoRcpt)) {
        rcptMap.set(photoRcpt, { rcptNo: photoRcpt, source: photoSource, photoIndices: [idx] });
      }
    }

    if (Array.isArray(photo.sequences)) {
      photo.sequences.forEach(s => {
        if (!s) return;
        const sRcpt = s.rcptNo ? String(s.rcptNo).trim() : photoRcpt;
        const sSeqNo = (s.seqNo !== null && s.seqNo !== undefined && s.seqNo !== '') ? Number(s.seqNo) : null;
        let normFirst = normalizeTrackNo(s.firstTrack);
        let normLast = normalizeTrackNo(s.lastTrack);
        let qty = (s.qty !== null && s.qty !== undefined && s.qty !== '') ? Number(s.qty) : null;

        // Single track normalization
        if (normFirst && (!normLast || normLast === normFirst)) {
          normLast = normFirst;
          if (qty === null || qty === undefined || isNaN(qty) || qty <= 0) qty = 1;
        }

        const seqObj = {
          rcptNo: sRcpt,
          seqNo: sSeqNo,
          firstTrack: normFirst || null,
          lastTrack: normLast || null,
          qty: qty,
          fieldSources: {
            rcptNo: s.fieldSources?.rcptNo || (sRcpt === photoRcpt ? photoSource : 'manual'),
            seqNo: s.fieldSources?.seqNo || 'manual',
            firstTrack: s.fieldSources?.firstTrack || 'manual',
            lastTrack: s.fieldSources?.lastTrack || 'manual',
            qty: s.fieldSources?.qty || 'manual'
          }
        };

        if (seqObj.rcptNo && seqObj.seqNo !== null && Number.isFinite(seqObj.seqNo)) {
          const compKey = `${seqObj.rcptNo}:${seqObj.seqNo}`;
          seqIdentityCounts.set(compKey, (seqIdentityCounts.get(compKey) || 0) + 1);
        }

        allSequences.push(seqObj);
      });
    }
  });

  allSequences.forEach(seq => {
    if (seq.rcptNo && seq.seqNo !== null && Number.isFinite(seq.seqNo)) {
      const compKey = `${seq.rcptNo}:${seq.seqNo}`;
      if ((seqIdentityCounts.get(compKey) || 0) > 1) {
        seq.isDuplicate = true;
        seq.duplicateReason = `DUPLICATE / NEEDS REVIEW: Same seqNo (${seq.seqNo}) appears multiple times under RCPT# ${seq.rcptNo}`;
      }
    }
  });

  return {
    trNo: detectedTR,
    rcptList: Array.from(rcptMap.values()),
    sequences: allSequences
  };
}

function runShadowPipeline(apiItems, photos) {
  const evidence = adaptPhotoEvidence(photos);
  const result = matchAll({
    trNo: evidence.trNo,
    apiItems,
    sequences: evidence.sequences
  });

  // Enforce duplicate protection on matched groups
  if (result && Array.isArray(result.groups)) {
    result.groups.forEach(group => {
      if (Array.isArray(group.sequences)) {
        group.sequences.forEach(seq => {
          if (seq.isDuplicate) {
            seq.confidence = MATCH_CONFIDENCE.CONFLICT;
            seq.conflictReason = seq.duplicateReason;
          }
        });
      }
    });
  }

  return { evidence, result };
}

// ─── M1: Single Track ─────────────────────────────────────────────────────────
test('M1 single track: normalizes blank lastTrack to firstTrack, matches Strong at exact index', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 1,
      firstTrack: 'EF000000001TH',
      lastTrack: '', // blank -> single track
      qty: 1
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  assert.strictEqual(result.groups.length, 1);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(matchedSeq.apiStartIndex, 0);
  assert.strictEqual(matchedSeq.apiEndIndex, 0);
  assert.strictEqual(matchedSeq.matchedTracks.length, 1);
  assert.strictEqual(matchedSeq.matchedTracks[0].trackNo, 'EF000000001TH');
});

// ─── M2: Range Qty Exact ──────────────────────────────────────────────────────
test('M2 range qty exact: matches Strong with slice length matching declared qty', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 5,
      firstTrack: 'RR111111111TH',
      lastTrack: 'RR111111113TH',
      qty: 3
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(matchedSeq.apiStartIndex, 5);
  assert.strictEqual(matchedSeq.apiEndIndex, 7);
  assert.strictEqual(matchedSeq.matchedTracks.length, 3);
});

// ─── M3: Range Qty Mismatch ───────────────────────────────────────────────────
test('M3 range qty mismatch: produces CONFLICT when declared qty != API slice length', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 5,
      firstTrack: 'RR111111111TH',
      lastTrack: 'RR111111113TH',
      qty: 4 // declared 4, but slice in API has 3 items
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.match(matchedSeq.conflictReason, /qty mismatch: declared 4/i);
});

// ─── M4: Missing First Track ──────────────────────────────────────────────────
test('M4 missing first track: produces CONFLICT when firstTrack not found in API array', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 1,
      firstTrack: 'NOTFOUND999TH',
      lastTrack: 'EF000000002TH',
      qty: 2
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.match(matchedSeq.conflictReason, /firstTrack "NOTFOUND999TH" not found in API array/);
});

// ─── M5: Missing Last Track ───────────────────────────────────────────────────
test('M5 missing last track: produces CONFLICT when lastTrack not found in API array', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 1,
      firstTrack: 'EF000000001TH',
      lastTrack: 'MISSINGLAST999TH',
      qty: 2
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.match(matchedSeq.conflictReason, /lastTrack "MISSINGLAST999TH" not found in API array/);
});

// ─── M6: Reversed Anchors ─────────────────────────────────────────────────────
test('M6 reversed anchors: produces CONFLICT when firstTrack index > lastTrack index', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 1,
      firstTrack: 'EF000000005TH', // index 4
      lastTrack: 'EF000000002TH',  // index 1
      qty: 4
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.match(matchedSeq.conflictReason, /reversed order/);
});

// ─── M7: Same Seq Across Two RCPT ─────────────────────────────────────────────
test('M7 same seq across two RCPT: distinct RCPTs can have same seqNo without collision', () => {
  const photos = [
    {
      detectedTR: '11489115',
      detectedRcpt: '18101',
      userConfirmed: true,
      sequences: [{
        seqNo: 1,
        firstTrack: 'EF000000001TH',
        lastTrack: 'EF000000001TH',
        qty: 1
      }]
    },
    {
      detectedTR: '11489115',
      detectedRcpt: '18102',
      userConfirmed: true,
      sequences: [{
        seqNo: 1,
        firstTrack: 'RR111111111TH',
        lastTrack: 'RR111111111TH',
        qty: 1
      }]
    }
  ];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  assert.strictEqual(result.groups.length, 2);

  const g1 = result.groups.find(g => g.rcptNo === '18101');
  const g2 = result.groups.find(g => g.rcptNo === '18102');

  assert.strictEqual(g1.sequences[0].seqNo, 1);
  assert.strictEqual(g1.sequences[0].confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(g1.sequences[0].matchedTracks[0].trackNo, 'EF000000001TH');

  assert.strictEqual(g2.sequences[0].seqNo, 1);
  assert.strictEqual(g2.sequences[0].confidence, MATCH_CONFIDENCE.STRONG);
  assert.strictEqual(g2.sequences[0].matchedTracks[0].trackNo, 'RR111111111TH');
});

// ─── M8: Duplicate Same RCPT + Seq ────────────────────────────────────────────
test('M8 duplicate same RCPT+seq: flags DUPLICATE / NEEDS REVIEW (CONFLICT)', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [
      { seqNo: 1, firstTrack: 'EF000000001TH', lastTrack: 'EF000000001TH', qty: 1 },
      { seqNo: 1, firstTrack: 'EF000000002TH', lastTrack: 'EF000000002TH', qty: 1 } // Duplicate Seq 1 in RCPT 132994
    ]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const seqs = result.groups[0].sequences;
  assert.strictEqual(seqs.length, 2);
  assert.strictEqual(seqs[0].confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.strictEqual(seqs[1].confidence, MATCH_CONFIDENCE.CONFLICT);
  assert.match(seqs[0].conflictReason, /DUPLICATE \/ NEEDS REVIEW/);
  assert.match(seqs[1].conflictReason, /DUPLICATE \/ NEEDS REVIEW/);
});

// ─── M9: Blank / Incomplete Evidence ──────────────────────────────────────────
test('M9 blank/incomplete evidence: marks WEAK confidence when track anchors are absent', () => {
  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [{
      seqNo: 1,
      firstTrack: '',
      lastTrack: '',
      qty: 1
    }]
  }];

  const { result } = runShadowPipeline(sampleApiItems, photos);
  const matchedSeq = result.groups[0].sequences[0];
  assert.strictEqual(matchedSeq.confidence, MATCH_CONFIDENCE.WEAK);
  assert.match(matchedSeq.conflictReason, /No track anchor provided/);
});

// ─── M10: Persistence Restore ─────────────────────────────────────────────────
test('M10 persistence restore: serializing and hydrating session preserves manual sequences', () => {
  const photo = {
    label: 'test_page_1.jpg',
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [
      { seqNo: 1, firstTrack: 'EF000000001TH', lastTrack: 'EF000000001TH', qty: 1 },
      { seqNo: 2, firstTrack: 'RR111111111TH', lastTrack: 'RR111111113TH', qty: 3 }
    ]
  };

  // Simulate JSON serialization to IndexedDB
  const storedJson = JSON.stringify(photo);
  const restoredObj = JSON.parse(storedJson);

  // Simulate hydratePhotos
  const hydrated = { ...restoredObj, sequences: Array.isArray(restoredObj.sequences) ? restoredObj.sequences : [] };

  assert.strictEqual(hydrated.sequences.length, 2);
  assert.strictEqual(hydrated.sequences[0].firstTrack, 'EF000000001TH');
  assert.strictEqual(hydrated.sequences[1].qty, 3);
  assert.strictEqual(hydrated.userConfirmed, true);
});

// ─── M11: Old Session Without Evidence ────────────────────────────────────────
test('M11 old session without evidence: safely defaults photo.sequences to empty array []', () => {
  const legacyRecord = {
    id: 'legacy-session-123',
    photos: [
      { label: 'old_page.jpg', detectedTR: '11476142', detectedRcpt: '132994' } // no sequences field
    ]
  };

  // Simulate hydratePhotos
  const hydratedPhotos = legacyRecord.photos.map(p => ({
    ...p,
    sequences: Array.isArray(p.sequences) ? p.sequences : []
  }));

  assert.strictEqual(hydratedPhotos[0].sequences.length, 0);
  assert.deepStrictEqual(hydratedPhotos[0].sequences, []);

  // Ensure adapter handles it without error
  const evidence = adaptPhotoEvidence(hydratedPhotos);
  assert.strictEqual(evidence.sequences.length, 0);
});

// ─── M12: Zero Mutation of API Track Array ────────────────────────────────────
test('M12 zero mutation of API track array: API items remain deeply equal before and after matching', () => {
  const snapshotBefore = JSON.stringify(sampleApiItems);

  const photos = [{
    detectedTR: '11476142',
    detectedRcpt: '132994',
    userConfirmed: true,
    sequences: [
      { seqNo: 1, firstTrack: 'EF000000001TH', lastTrack: 'EF000000001TH', qty: 1 },
      { seqNo: 2, firstTrack: 'RR111111111TH', lastTrack: 'RR111111113TH', qty: 3 }
    ]
  }];

  runShadowPipeline(sampleApiItems, photos);

  const snapshotAfter = JSON.stringify(sampleApiItems);
  assert.strictEqual(snapshotBefore, snapshotAfter, 'API track array must NOT be mutated');
});

console.log(`\nManual Evidence Integration Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL MANUAL EVIDENCE INTEGRATION TESTS (M1–M12) PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME INTEGRATION TESTS FAILED!\n');
  process.exitCode = 1;
}
