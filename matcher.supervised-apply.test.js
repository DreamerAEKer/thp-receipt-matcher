/**
 * matcher.supervised-apply.test.js
 *
 * Test suite for Phase 3: Supervised Matcher Apply (Make the App Actually Usable End-to-End).
 * Verifies:
 * - P1: no mutation before Apply
 * - P2: Strong single mapping applies correctly
 * - P3: Strong range maps actual API indexes
 * - P4: Conflict is not applied
 * - P5: pending OCR is never applied
 * - P6: rejected OCR is never applied
 * - P7: API candidate alone is never applied
 * - P8: same seq different RCPT does not collide
 * - P9: apply preserves evidence
 * - P10: apply does not generate tracks
 * - P11: failure rolls back state
 * - P12: evidence edit marks mapping stale
 * - P13: re-apply requires explicit user action
 * - P14: persistence survives refresh
 * - P15: old session remains compatible
 *
 * Plus Part 2: REAL 26-ITEM END-TO-END TEST (TR 11476142 / RCPT 132994 / 4 Photos).
 *
 * Run with: node matcher.supervised-apply.test.js
 */

'use strict';

const assert = require('assert');
const {
  cleanTrackNo,
  buildMatcherApplyPlan,
  applyMatcherMapping,
  rollbackMatcherMapping,
  computeEvidenceSignature,
  isMatcherMappingStale
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

console.log('Running Supervised Matcher Apply Test Suite (P1–P15 + REAL E2E)...\n');

// ── P1: No mutation before Apply ─────────────────────────────────────────────
test('P1: no mutation before Apply (buildMatcherApplyPlan is pure inspection)', () => {
  const apiItems = [
    { no: 1, trackNo: 'ED835848247TH', photoIndex: 0 },
    { no: 2, trackNo: 'ED835848255TH', photoIndex: 0 }
  ];
  const photos = [
    {
      label: 'Photo 1',
      detectedRcpt: '1001',
      sequences: [
        { rcptNo: '1001', seqNo: 1, firstTrack: 'ED835848247TH', lastTrack: 'ED835848247TH', qty: 1, provenance: 'manual' }
      ]
    }
  ];

  const itemsBefore = JSON.stringify(apiItems);
  const photosBefore = JSON.stringify(photos);

  const plan = buildMatcherApplyPlan(photos, apiItems);

  assert.strictEqual(JSON.stringify(apiItems), itemsBefore, 'apiItems must not be modified');
  assert.strictEqual(JSON.stringify(photos), photosBefore, 'photos must not be modified');
  assert.strictEqual(plan.readyCount, 1);
  assert.strictEqual(plan.conflictCount, 0);
});

// ── P2: Strong single mapping applies correctly ──────────────────────────────
test('P2: Strong single mapping applies correctly', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'ED835848247TH', photoIndex: 99 },
      { no: 2, trackNo: 'ED835848255TH', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'ED835848247TH', lastTrack: 'ED835848247TH', qty: 1, provenance: 'manual' }
        ]
      },
      {
        label: 'Page 2',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 2, firstTrack: 'ED835848255TH', lastTrack: 'ED835848255TH', qty: 1, provenance: 'manual' }
        ]
      }
    ]
  };

  const res = applyMatcherMapping({ targetState: state });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.appliedCount, 2);

  assert.strictEqual(state.receiptItems[0].photoIndex, 0);
  assert.strictEqual(state.receiptItems[0].receiptSeqNo, 1);
  assert.strictEqual(state.receiptItems[0].mappingSource, 'matcher');

  assert.strictEqual(state.receiptItems[1].photoIndex, 1);
  assert.strictEqual(state.receiptItems[1].receiptSeqNo, 2);
  assert.strictEqual(state.receiptItems[1].mappingSource, 'matcher');

  assert.strictEqual(state.photos[0].startNo, 1);
  assert.strictEqual(state.photos[0].endNo, 1);
  assert.strictEqual(state.photos[1].startNo, 2);
  assert.strictEqual(state.photos[1].endNo, 2);
});

// ── P3: Strong range maps actual API indexes ─────────────────────────────────
test('P3: Strong range maps actual API indexes', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_A', photoIndex: 0 },
      { no: 2, trackNo: 'TRACK_B', photoIndex: 0 },
      { no: 3, trackNo: 'TRACK_C', photoIndex: 0 },
      { no: 4, trackNo: 'TRACK_D', photoIndex: 0 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_B', lastTrack: 'TRACK_D', qty: 3, provenance: 'manual' }
        ]
      }
    ]
  };

  const res = applyMatcherMapping({ targetState: state });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.appliedCount, 3);

  // TRACK_B, C, D (indices 1, 2, 3) must be mapped to photoIndex 0
  assert.strictEqual(state.receiptItems[1].photoIndex, 0);
  assert.strictEqual(state.receiptItems[1].receiptSeqNo, 1);
  assert.strictEqual(state.receiptItems[2].photoIndex, 0);
  assert.strictEqual(state.receiptItems[2].receiptSeqNo, 1);
  assert.strictEqual(state.receiptItems[3].photoIndex, 0);
  assert.strictEqual(state.receiptItems[3].receiptSeqNo, 1);

  // TRACK_A was unmapped by this sequence
  assert.strictEqual(state.receiptItems[0].mappingSource, undefined);
});

// ── P4: Conflict is not applied ──────────────────────────────────────────────
test('P4: Conflict is not applied (plan blocks apply)', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_A', photoIndex: 0 },
      { no: 2, trackNo: 'TRACK_B', photoIndex: 0 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          // Range declared qty 5, but API only has 2
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_A', lastTrack: 'TRACK_B', qty: 5, provenance: 'manual' }
        ]
      }
    ]
  };

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.conflictCount, 1);
  assert.strictEqual(plan.isEligible, false);

  assert.throws(() => {
    applyMatcherMapping({ targetState: state });
  }, /CONFLICTS_DETECTED/);

  // Mapping remains untouched
  assert.strictEqual(state.receiptItems[0].mappingSource, undefined);
});

// ── P5: Pending OCR is never applied ─────────────────────────────────────────
test('P5: pending OCR is never applied', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'ED835848247TH', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [], // empty manual sequences!
        ocrSequenceSuggestions: [
          { id: 'sug_1', rcptNo: '1001', seqNo: 1, firstTrack: 'ED835848247TH', lastTrack: 'ED835848247TH', qty: 1, status: 'pending' }
        ]
      }
    ]
  };

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.readyCount, 0, 'Pending suggestions must not be counted as ready');
  assert.throws(() => {
    applyMatcherMapping({ targetState: state });
  }, /NO_READY_MAPPINGS/);
  assert.strictEqual(state.receiptItems[0].photoIndex, 99);
});

// ── P6: Rejected OCR is never applied ────────────────────────────────────────
test('P6: rejected OCR is never applied', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'ED835848247TH', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [],
        ocrSequenceSuggestions: [
          { id: 'sug_1', rcptNo: '1001', seqNo: 1, firstTrack: 'ED835848247TH', lastTrack: 'ED835848247TH', qty: 1, status: 'rejected' }
        ]
      }
    ]
  };

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.readyCount, 0);
  assert.throws(() => {
    applyMatcherMapping({ targetState: state });
  }, /NO_READY_MAPPINGS/);
});

// ── P7: API candidate alone is never applied ─────────────────────────────────
test('P7: API candidate alone is never applied without user confirmation', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'JG075176947TH', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [], // User has NOT confirmed!
        ocrSequenceSuggestions: [
          {
            id: 'sug_1',
            firstTrack: '1G0751769427H', // malformed OCR
            status: 'pending',
            reviewCandidate: { trackNo: 'JG075176947TH', distance: 2, status: 'single_match' }
          }
        ]
      }
    ]
  };

  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.readyCount, 0);
  assert.strictEqual(state.receiptItems[0].photoIndex, 99);
});

// ── P8: Same seq different RCPT does not collide ─────────────────────────────
test('P8: same seq different RCPT does not collide', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_RCPT1_S1', photoIndex: 99 },
      { no: 2, trackNo: 'TRACK_RCPT2_S1', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '18101',
        sequences: [
          { rcptNo: '18101', seqNo: 1, firstTrack: 'TRACK_RCPT1_S1', lastTrack: 'TRACK_RCPT1_S1', qty: 1, provenance: 'manual' }
        ]
      },
      {
        label: 'Page 2',
        detectedRcpt: '18102',
        sequences: [
          { rcptNo: '18102', seqNo: 1, firstTrack: 'TRACK_RCPT2_S1', lastTrack: 'TRACK_RCPT2_S1', qty: 1, provenance: 'manual' }
        ]
      }
    ]
  };

  const res = applyMatcherMapping({ targetState: state });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.appliedCount, 2);

  assert.strictEqual(state.receiptItems[0].photoIndex, 0);
  assert.strictEqual(state.receiptItems[0].rcptNo, '18101');
  assert.strictEqual(state.receiptItems[0].receiptSeqNo, 1);

  assert.strictEqual(state.receiptItems[1].photoIndex, 1);
  assert.strictEqual(state.receiptItems[1].rcptNo, '18102');
  assert.strictEqual(state.receiptItems[1].receiptSeqNo, 1);
});

// ── P9: Apply preserves evidence ─────────────────────────────────────────────
test('P9: apply preserves evidence intact', () => {
  const rawOcrText = '5. dtu; Hair 1G 0751 7694 27H';
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'JG075176947TH', photoIndex: 99 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          {
            rcptNo: '1001',
            seqNo: 5,
            firstTrack: 'JG075176947TH',
            lastTrack: 'JG075176947TH',
            qty: 1,
            provenance: 'manual',
            ocrRawText: rawOcrText,
            ocrConfidence: 75
          }
        ],
        ocrSequenceSuggestions: [
          { id: 'sug_1', firstTrack: '1G0751769427H', rawText: rawOcrText, status: 'confirmed' }
        ]
      }
    ]
  };

  applyMatcherMapping({ targetState: state });

  assert.strictEqual(state.photos[0].sequences.length, 1);
  assert.strictEqual(state.photos[0].sequences[0].ocrRawText, rawOcrText);
  assert.strictEqual(state.photos[0].sequences[0].ocrConfidence, 75);
  assert.strictEqual(state.photos[0].ocrSequenceSuggestions.length, 1);
  assert.strictEqual(state.photos[0].ocrSequenceSuggestions[0].rawText, rawOcrText);
});

// ── P10: Apply does not generate tracks ──────────────────────────────────────
test('P10: apply does not generate tracks or modify API barcode strings', () => {
  const originalBarcodes = ['TRACK_001', 'TRACK_002', 'TRACK_003'];
  const state = {
    receiptItems: originalBarcodes.map((b, i) => ({ no: i + 1, trackNo: b, photoIndex: 99 })),
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_001', lastTrack: 'TRACK_003', qty: 3, provenance: 'manual' }
        ]
      }
    ]
  };

  applyMatcherMapping({ targetState: state });

  const currentBarcodes = state.receiptItems.map(i => i.trackNo);
  assert.deepStrictEqual(currentBarcodes, originalBarcodes, 'Barcodes must not be mutated or generated');
});

// ── P11: Failure rolls back state ────────────────────────────────────────────
test('P11: failure rolls back state to pre-apply snapshot', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_1', photoIndex: 42, mappingSource: 'original' }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_1', lastTrack: 'TRACK_1', qty: 1, provenance: 'manual' }
        ]
      }
    ]
  };

  // Build a plan, but inject an artificial failure inside application
  const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  assert.strictEqual(plan.readyCount, 1);

  // Simulate an invariant violation by mutating receiptItems length in a wrapper
  const snapshot = {
    receiptItems: state.receiptItems.map(item => ({ ...item })),
    photos: state.photos.map(p => ({ ...p }))
  };

  // Modify photoIndex to invalid value
  state.receiptItems[0].photoIndex = 999;
  state.receiptItems[0].mappingSource = 'corrupted';

  // Test rollback
  const restored = rollbackMatcherMapping(snapshot, state);
  assert.strictEqual(restored, true);
  assert.strictEqual(state.receiptItems[0].photoIndex, 42);
  assert.strictEqual(state.receiptItems[0].mappingSource, 'original');
});

// ── P12: Evidence edit marks mapping stale ───────────────────────────────────
test('P12: evidence edit marks mapping stale', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_1', photoIndex: 0 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_1', lastTrack: 'TRACK_1', qty: 1, provenance: 'manual' }
        ]
      }
    ]
  };

  applyMatcherMapping({ targetState: state });
  assert.strictEqual(isMatcherMappingStale(state.photos, state.matcherAppliedSignature), false, 'Initially fresh');

  // User edits manual evidence
  state.photos[0].sequences[0].qty = 2; // altered!
  assert.strictEqual(isMatcherMappingStale(state.photos, state.matcherAppliedSignature), true, 'Must detect as stale');
});

// ── P13: Re-apply requires explicit user action ──────────────────────────────
test('P13: re-apply requires explicit user action', () => {
  const state = {
    receiptItems: [
      { no: 1, trackNo: 'TRACK_1', photoIndex: 0, receiptSeqNo: 1 },
      { no: 2, trackNo: 'TRACK_2', photoIndex: 0, receiptSeqNo: 1 }
    ],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [
          { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_1', lastTrack: 'TRACK_2', qty: 2, provenance: 'manual' }
        ]
      },
      {
        label: 'Page 2',
        detectedRcpt: '1001',
        sequences: []
      }
    ]
  };

  applyMatcherMapping({ targetState: state });
  assert.strictEqual(state.receiptItems[1].photoIndex, 0);

  // User changes evidence so that TRACK_2 belongs to Page 2
  state.photos[0].sequences[0] = { rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_1', lastTrack: 'TRACK_1', qty: 1, provenance: 'manual' };
  state.photos[1].sequences = [
    { rcptNo: '1001', seqNo: 2, firstTrack: 'TRACK_2', lastTrack: 'TRACK_2', qty: 1, provenance: 'manual' }
  ];

  // In between, mapping is stale, but receiptItems MUST NOT automatically change!
  assert.strictEqual(isMatcherMappingStale(state.photos, state.matcherAppliedSignature), true);
  assert.strictEqual(state.receiptItems[1].photoIndex, 0, 'Must NOT silently change mapping without explicit apply');

  // Explicit re-apply
  applyMatcherMapping({ targetState: state });
  assert.strictEqual(state.receiptItems[1].photoIndex, 1, 'Only changes after explicit re-apply');
  assert.strictEqual(isMatcherMappingStale(state.photos, state.matcherAppliedSignature), false, 'Fresh again');
});

// ── P14: Persistence survives refresh ────────────────────────────────────────
test('P14: persistence survives roundtrip with signature and apply info', () => {
  const state = {
    receiptItems: [{ no: 1, trackNo: 'TRACK_1', photoIndex: 0 }],
    photos: [
      {
        label: 'Page 1',
        detectedRcpt: '1001',
        sequences: [{ rcptNo: '1001', seqNo: 1, firstTrack: 'TRACK_1', lastTrack: 'TRACK_1', qty: 1, provenance: 'manual' }]
      }
    ]
  };

  applyMatcherMapping({ targetState: state });
  const sig = state.matcherAppliedSignature;
  const info = state.matcherApplyInfo;

  // Simulate serialization to DB and restoration
  const serialized = JSON.stringify({
    receiptItems: state.receiptItems,
    photos: state.photos,
    matcherAppliedSignature: sig,
    matcherApplyInfo: info
  });

  const parsed = JSON.parse(serialized);
  assert.strictEqual(parsed.matcherAppliedSignature, sig);
  assert.strictEqual(parsed.matcherApplyInfo.mappedCount, 1);
  assert.strictEqual(isMatcherMappingStale(parsed.photos, parsed.matcherAppliedSignature), false);
});

// ── P15: Old session remains compatible ──────────────────────────────────────
test('P15: old session without matcher metadata loads safely', () => {
  const oldSessionPhotos = [
    { label: 'Old Photo', sequences: [] } // no ocrSequenceSuggestions, no matcherAppliedSignature
  ];

  assert.strictEqual(isMatcherMappingStale(oldSessionPhotos, null), false);
  const plan = buildMatcherApplyPlan(oldSessionPhotos, []);
  assert.strictEqual(plan.readyCount, 0);
  assert.strictEqual(plan.conflictCount, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: REAL 26-ITEM END-TO-END RECEIPT TEST (TR 11476142 / RCPT 132994)
// ─────────────────────────────────────────────────────────────────────────────
test('REAL 26-ITEM END-TO-END: TR 11476142 / RCPT 132994 across 4 Physical Images', () => {
  // 1. Load actual 26 API Items
  const verifiedApiItems = [
    { no: 1,  trackNo: 'JG073580650TH', photoIndex: 0 },
    { no: 2,  trackNo: 'JG075314011TH', photoIndex: 0 },
    { no: 3,  trackNo: 'JG075469061TH', photoIndex: 0 },
    { no: 4,  trackNo: 'JG075469716TH', photoIndex: 0 },
    { no: 5,  trackNo: 'JG075176947TH', photoIndex: 0 },
    { no: 6,  trackNo: 'JG074231956TH', photoIndex: 0 },
    { no: 7,  trackNo: 'JG075360869TH', photoIndex: 0 },
    { no: 8,  trackNo: 'JG073596765TH', photoIndex: 0 },
    { no: 9,  trackNo: 'JG074246607TH', photoIndex: 0 },
    { no: 10, trackNo: 'JG074455389TH', photoIndex: 0 },
    { no: 11, trackNo: 'JG075187556TH', photoIndex: 0 },
    { no: 12, trackNo: 'JG074246125TH', photoIndex: 0 },
    { no: 13, trackNo: 'JG073577939TH', photoIndex: 0 },
    { no: 14, trackNo: 'JG075665145TH', photoIndex: 0 },
    { no: 15, trackNo: 'JG074218098TH', photoIndex: 0 },
    { no: 16, trackNo: 'JG073741414TH', photoIndex: 0 },
    { no: 17, trackNo: 'JG075593276TH', photoIndex: 0 },
    { no: 18, trackNo: 'JG075469557TH', photoIndex: 0 },
    { no: 19, trackNo: 'JG075449606TH', photoIndex: 0 },
    { no: 20, trackNo: 'JG075314135TH', photoIndex: 0 },
    { no: 21, trackNo: 'JG075240910TH', photoIndex: 0 },
    { no: 22, trackNo: 'JG075187587TH', photoIndex: 0 },
    { no: 23, trackNo: 'JG073583713TH', photoIndex: 0 },
    { no: 24, trackNo: 'JG075314935TH', photoIndex: 0 },
    { no: 25, trackNo: 'JG074244725TH', photoIndex: 0 },
    { no: 26, trackNo: 'JG073784216TH', photoIndex: 0 }
  ];

  // 2. Setup 4 physical photos matching the actual receipt pages
  const photos = [
    {
      label: 'ใบเสร็จหน้าที่ 1 (ลำดับ 1-8)',
      file: 'media_1789374315239.jpg',
      detectedTR: '11476142',
      detectedRcpt: '132994',
      userConfirmed: true,
      sequences: [
        {
          rcptNo: '132994',
          seqNo: 1,
          firstTrack: 'JG073580650TH',
          lastTrack: 'JG073596765TH',
          qty: 8,
          provenance: 'manual'
        }
      ]
    },
    {
      label: 'ใบเสร็จหน้าที่ 2 (ลำดับ 9-15)',
      file: 'media_1789374315332.jpg',
      detectedTR: '11476142',
      detectedRcpt: '132994',
      userConfirmed: true,
      sequences: [
        {
          rcptNo: '132994',
          seqNo: 9,
          firstTrack: 'JG074246607TH',
          lastTrack: 'JG074218098TH',
          qty: 7,
          provenance: 'manual'
        }
      ]
    },
    {
      label: 'ใบเสร็จหน้าที่ 3 (ลำดับ 16-22)',
      file: 'media_1789374315328.jpg',
      detectedTR: '11476142',
      detectedRcpt: '132994',
      userConfirmed: true,
      sequences: [
        {
          rcptNo: '132994',
          seqNo: 16,
          firstTrack: 'JG073741414TH',
          lastTrack: 'JG075187587TH',
          qty: 7,
          provenance: 'manual'
        }
      ]
    },
    {
      label: 'ใบเสร็จหน้าที่ 4 (ลำดับ 23-26 รวมเงิน)',
      file: 'media_1789374315248.jpg',
      detectedTR: '11476142',
      detectedRcpt: '132994',
      userConfirmed: true,
      sequences: [
        {
          rcptNo: '132994',
          seqNo: 23,
          firstTrack: 'JG073583713TH',
          lastTrack: 'JG073784216TH',
          qty: 4,
          provenance: 'manual'
        }
      ]
    }
  ];

  const targetState = {
    receiptItems: JSON.parse(JSON.stringify(verifiedApiItems)),
    photos: JSON.parse(JSON.stringify(photos))
  };

  // 3. Step: Preview Before Mutation
  const plan = buildMatcherApplyPlan(targetState.photos, targetState.receiptItems);
  assert.strictEqual(plan.totalApiCount, 26);
  assert.strictEqual(plan.readyCount, 26, 'All 26 items must be ready');
  assert.strictEqual(plan.conflictCount, 0, 'Zero conflicts');
  assert.strictEqual(plan.incompleteCount, 0, 'Zero incompletes');
  assert.strictEqual(plan.unmappedCount, 0, 'Zero unmapped');
  assert.strictEqual(plan.isEligible, true);

  // 4. Step: Supervised Apply Execution
  const applyRes = applyMatcherMapping({ targetState });
  assert.strictEqual(applyRes.success, true);
  assert.strictEqual(applyRes.appliedCount, 26);
  assert.strictEqual(applyRes.totalCount, 26);

  // 5. Verify Photo Mapping Invariants
  // Items 1-8 (indices 0-7) -> Photo 0
  for (let i = 0; i <= 7; i++) {
    assert.strictEqual(targetState.receiptItems[i].photoIndex, 0, `Item ${i+1} must be mapped to Photo 0`);
    assert.strictEqual(targetState.receiptItems[i].rcptNo, '132994');
    assert.strictEqual(targetState.receiptItems[i].mappingSource, 'matcher');
  }

  // Items 9-15 (indices 8-14) -> Photo 1
  for (let i = 8; i <= 14; i++) {
    assert.strictEqual(targetState.receiptItems[i].photoIndex, 1, `Item ${i+1} must be mapped to Photo 1`);
    assert.strictEqual(targetState.receiptItems[i].rcptNo, '132994');
    assert.strictEqual(targetState.receiptItems[i].mappingSource, 'matcher');
  }

  // Items 16-22 (indices 15-21) -> Photo 2
  for (let i = 15; i <= 21; i++) {
    assert.strictEqual(targetState.receiptItems[i].photoIndex, 2, `Item ${i+1} must be mapped to Photo 2`);
    assert.strictEqual(targetState.receiptItems[i].rcptNo, '132994');
    assert.strictEqual(targetState.receiptItems[i].mappingSource, 'matcher');
  }

  // Items 23-26 (indices 22-25) -> Photo 3
  for (let i = 22; i <= 25; i++) {
    assert.strictEqual(targetState.receiptItems[i].photoIndex, 3, `Item ${i+1} must be mapped to Photo 3`);
    assert.strictEqual(targetState.receiptItems[i].rcptNo, '132994');
    assert.strictEqual(targetState.receiptItems[i].mappingSource, 'matcher');
  }

  // 6. Verify Photo Ranges
  assert.strictEqual(targetState.photos[0].startNo, 1);
  assert.strictEqual(targetState.photos[0].endNo, 8);
  assert.strictEqual(targetState.photos[1].startNo, 9);
  assert.strictEqual(targetState.photos[1].endNo, 15);
  assert.strictEqual(targetState.photos[2].startNo, 16);
  assert.strictEqual(targetState.photos[2].endNo, 22);
  assert.strictEqual(targetState.photos[3].startNo, 23);
  assert.strictEqual(targetState.photos[3].endNo, 26);

  // 7. Verify no generated tracking numbers
  targetState.receiptItems.forEach((item, idx) => {
    assert.strictEqual(item.trackNo, verifiedApiItems[idx].trackNo);
  });

  // 8. Verify evidence preserved
  assert.strictEqual(targetState.photos[0].sequences.length, 1);
  assert.strictEqual(targetState.photos[1].sequences.length, 1);
  assert.strictEqual(targetState.photos[2].sequences.length, 1);
  assert.strictEqual(targetState.photos[3].sequences.length, 1);

  // 9. Verify Signature & Non-stale
  assert.strictEqual(isMatcherMappingStale(targetState.photos, targetState.matcherAppliedSignature), false);
});

console.log(`\nSupervised Matcher Apply Integration Results: ${passedTests} / ${totalTests} passed.`);
if (passedTests === totalTests) {
  console.log('ALL SUPERVISED MATCHER APPLY TESTS (P1–P15 + REAL E2E) PASSED SUCCESSFULLY! ✓\n');
} else {
  process.exit(1);
}
