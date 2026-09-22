/**
 * matcher.js — Receipt / RCPT / Sequence / Track Range Matcher Engine
 *
 * Pure functions only. No DOM, no fetch, no state mutation.
 * Does NOT generate tracking numbers via arithmetic.
 * Track lookups are exclusively via Map index lookup from real API items.
 *
 * ─── DATA CONTRACTS ───────────────────────────────────────────────────────────
 *
 * ApiTrack {
 *   trackNo:   string,   // normalized (uppercase, no spaces)
 *   apiIndex:  number,   // position in original API items array
 *   raw:       object    // original item from API (barcode, recipient, etc.)
 * }
 *
 * FieldSources {                    // per-field provenance
 *   rcptNo?:    'api'|'ocr'|'manual'|'inferred',
 *   seqNo?:     'api'|'ocr'|'manual'|'inferred',
 *   firstTrack?:'api'|'ocr'|'manual'|'inferred',
 *   lastTrack?: 'api'|'ocr'|'manual'|'inferred',
 *   qty?:       'api'|'ocr'|'manual'|'inferred'
 * }
 *
 * ReceiptSequence {
 *   rcptNo:      string|null,        // RCPT# or null if unknown
 *   seqNo:       number|null,        // sequence number on paper or null
 *   firstTrack:  string|null,        // normalized first track in range (or single)
 *   lastTrack:   string|null,        // normalized last track (null = single track)
 *   qty:         number|null,        // declared qty (from OCR/manual) or null
 *   fieldSources: FieldSources,      // per-field provenance
 *   // Output fields (filled by matchSequence):
 *   apiStartIndex:  number|null,
 *   apiEndIndex:    number|null,
 *   trackIndexes:   number[],        // REAL indexes into ApiTrack[], NOT generated
 *   matchedTracks:  ApiTrack[],      // references to real ApiTrack objects
 *   confidence:     'strong'|'medium'|'weak'|'conflict',
 *   conflictReason: string|null
 * }
 *
 * ReceiptGroup {
 *   trNo:      string,
 *   rcptNo:    string|null,
 *   sequences: ReceiptSequence[],
 *   rcptSource:'api'|'ocr'|'manual'|'inferred'|null
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MATCH_CONFIDENCE = Object.freeze({
  STRONG:  'strong',
  MEDIUM:  'medium',
  WEAK:    'weak',
  CONFLICT: 'conflict'
});

const SOURCE = Object.freeze({
  API:      'api',
  OCR:      'ocr',
  MANUAL:   'manual',
  INFERRED: 'inferred'
});

const RCPT_SOURCE_PRIORITY = Object.freeze({
  [SOURCE.API]:      4,
  [SOURCE.MANUAL]:   3,
  [SOURCE.OCR]:      2,
  [SOURCE.INFERRED]: 1
});

// ─── NORMALIZATION ────────────────────────────────────────────────────────────

/**
 * Normalize a tracking number: uppercase, remove all whitespace.
 * "RJ 3171 3245 4 TH" → "RJ317132454TH"
 * Returns empty string for falsy input.
 */
function normalizeTrackNo(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '').toUpperCase();
}

// ─── buildTrackIndex ──────────────────────────────────────────────────────────

/**
 * Build a lookup map from normalized trackNo → ApiTrack.
 *
 * Duplicate protection: if the same normalized trackNo appears more than once,
 * the entry is marked AMBIGUOUS_TRACK (an array of conflicting ApiTrack objects).
 * Matcher will refuse Strong match for ambiguous entries.
 *
 * @param {object[]} apiItems  Raw items from extractReceiptApiItems()
 * @returns {{
 *   trackMap: Map<string, ApiTrack|{AMBIGUOUS: true, entries: ApiTrack[]}>,
 *   apiTracks: ApiTrack[]
 * }}
 */
function buildTrackIndex(apiItems) {
  if (!Array.isArray(apiItems)) {
    return { trackMap: new Map(), apiTracks: [] };
  }

  const trackMap = new Map();
  const apiTracks = [];

  apiItems.forEach((raw, idx) => {
    const rawTrack = raw.barcode || raw.track_no || raw.trackNo || '';
    const normalized = normalizeTrackNo(rawTrack);
    if (!normalized) return;

    const apiTrack = { trackNo: normalized, apiIndex: idx, raw };
    apiTracks.push(apiTrack);

    if (trackMap.has(normalized)) {
      const existing = trackMap.get(normalized);
      if (existing && existing.AMBIGUOUS) {
        existing.entries.push(apiTrack);
      } else {
        // First duplicate: convert to ambiguous entry
        trackMap.set(normalized, { AMBIGUOUS: true, entries: [existing, apiTrack] });
      }
    } else {
      trackMap.set(normalized, apiTrack);
    }
  });

  return { trackMap, apiTracks };
}

// ─── matchSequence ────────────────────────────────────────────────────────────

/**
 * Match one ReceiptSequence against the track index.
 *
 * Rules (per user spec):
 * - Strong: firstTrack + lastTrack both found, startIndex <= endIndex, qty exact
 * - Strong (single): firstTrack === lastTrack AND qty === 1 (or null)
 * - Medium: only firstTrack found (no lastTrack evidence), no contradiction
 * - Weak:  no track anchors at all, only seqNo/page evidence
 * - Conflict: anchor not found | order reversed | qty mismatch | AMBIGUOUS track
 *
 * NEVER generates track numbers between first and last arithmetically.
 * trackIndexes = [startIndex, startIndex+1, ..., endIndex] — these are ARRAY
 * INDEXES, not track numbers. The actual tracks are read back from apiTracks[i].
 *
 * @param {ReceiptSequence} seq
 * @param {Map} trackMap    from buildTrackIndex()
 * @param {ApiTrack[]} apiTracks  ordered array from buildTrackIndex()
 * @returns {ReceiptSequence}  seq with confidence/trackIndexes/matchedTracks filled
 */
function matchSequence(seq, trackMap, apiTracks) {
  const result = Object.assign({}, seq, {
    apiStartIndex:  null,
    apiEndIndex:    null,
    trackIndexes:   [],
    matchedTracks:  [],
    confidence:     MATCH_CONFIDENCE.WEAK,
    conflictReason: null
  });

  const normFirst = normalizeTrackNo(seq.firstTrack);
  const normLast  = normalizeTrackNo(seq.lastTrack);
  const hasFirst  = normFirst.length > 0;
  const hasLast   = normLast.length > 0;

  // ── WEAK: no track evidence ────────────────────────────────────────────────
  if (!hasFirst && !hasLast) {
    result.confidence = MATCH_CONFIDENCE.WEAK;
    result.conflictReason = 'No track anchor provided (seqNo/page evidence only)';
    return result;
  }

  // ── Resolve firstTrack ─────────────────────────────────────────────────────
  let firstEntry = hasFirst ? trackMap.get(normFirst) : null;

  if (hasFirst && !firstEntry) {
    result.confidence = MATCH_CONFIDENCE.CONFLICT;
    result.conflictReason = `firstTrack "${normFirst}" not found in API array`;
    return result;
  }

  if (firstEntry && firstEntry.AMBIGUOUS) {
    result.confidence = MATCH_CONFIDENCE.CONFLICT;
    result.conflictReason = `firstTrack "${normFirst}" is AMBIGUOUS_TRACK (appears at ${firstEntry.entries.map(e => e.apiIndex).join(', ')})`;
    return result;
  }

  // ── Single-track shortcut: firstTrack === lastTrack (both anchors present and equal) ─
  const isSingleByEquality = hasFirst && hasLast && normFirst === normLast;

  if (isSingleByEquality) {
    if (seq.qty !== null && seq.qty !== undefined && seq.qty !== 1) {
      result.confidence = MATCH_CONFIDENCE.CONFLICT;
      result.conflictReason = `single track anchor "${normFirst}" contradicts declared qty ${seq.qty}`;
      return result;
    }
    const idx = firstEntry.apiIndex;
    result.apiStartIndex = idx;
    result.apiEndIndex   = idx;
    result.trackIndexes  = [idx];
    result.matchedTracks = [apiTracks[idx]];
    result.confidence    = MATCH_CONFIDENCE.STRONG;
    return result;
  }

  // ── Incomplete anchors: need both anchors for Strong ──────────────────────
  if (hasFirst && !hasLast) {
    // Only firstTrack, no lastTrack → Medium candidate (incomplete evidence, no contradiction)
    const idx = firstEntry.apiIndex;
    result.apiStartIndex = idx;
    result.apiEndIndex   = idx;
    result.trackIndexes  = [idx];
    result.matchedTracks = [apiTracks[idx]];
    result.confidence    = MATCH_CONFIDENCE.MEDIUM;
    result.conflictReason = 'Only firstTrack anchor; lastTrack not provided (candidate only)';
    return result;
  }

  if (!hasFirst && hasLast) {
    let lastEntry = trackMap.get(normLast);
    if (!lastEntry) {
      result.confidence = MATCH_CONFIDENCE.CONFLICT;
      result.conflictReason = `lastTrack "${normLast}" not found in API array`;
      return result;
    }
    if (lastEntry.AMBIGUOUS) {
      result.confidence = MATCH_CONFIDENCE.CONFLICT;
      result.conflictReason = `lastTrack "${normLast}" is AMBIGUOUS_TRACK (appears at ${lastEntry.entries.map(e => e.apiIndex).join(', ')})`;
      return result;
    }
    const idx = lastEntry.apiIndex;
    result.apiStartIndex = idx;
    result.apiEndIndex   = idx;
    result.trackIndexes  = [idx];
    result.matchedTracks = [apiTracks[idx]];
    result.confidence    = MATCH_CONFIDENCE.MEDIUM;
    result.conflictReason = 'Only lastTrack anchor; firstTrack not provided (candidate only)';
    return result;
  }

  // Both anchors present
  let lastEntry = trackMap.get(normLast);

  if (!lastEntry) {
    result.confidence = MATCH_CONFIDENCE.CONFLICT;
    result.conflictReason = `lastTrack "${normLast}" not found in API array`;
    return result;
  }

  if (lastEntry.AMBIGUOUS) {
    result.confidence = MATCH_CONFIDENCE.CONFLICT;
    result.conflictReason = `lastTrack "${normLast}" is AMBIGUOUS_TRACK (appears at ${lastEntry.entries.map(e => e.apiIndex).join(', ')})`;
    return result;
  }

  const startIdx = firstEntry.apiIndex;
  const endIdx   = lastEntry.apiIndex;

  // ── Order check: firstTrack must come before lastTrack ─────────────────────
  if (startIdx > endIdx) {
    result.confidence = MATCH_CONFIDENCE.CONFLICT;
    result.conflictReason = `firstTrack index (${startIdx}) is AFTER lastTrack index (${endIdx}) — reversed order`;
    return result;
  }

  // ── Build trackIndexes from REAL array positions (no arithmetic on track#) ─
  const trackIndexes  = [];
  const matchedTracks = [];
  for (let i = startIdx; i <= endIdx; i++) {
    trackIndexes.push(i);
    matchedTracks.push(apiTracks[i]);
  }
  const actualQty = trackIndexes.length;

  result.apiStartIndex = startIdx;
  result.apiEndIndex   = endIdx;
  result.trackIndexes  = trackIndexes;
  result.matchedTracks = matchedTracks;

  // ── Qty check ──────────────────────────────────────────────────────────────
  if (seq.qty !== null && seq.qty !== undefined) {
    if (seq.qty !== actualQty) {
      result.confidence = MATCH_CONFIDENCE.CONFLICT;
      result.conflictReason =
        `qty mismatch: declared ${seq.qty} but API slice [${startIdx}–${endIdx}] = ${actualQty} tracks`;
      return result;
    }
  }

  result.confidence = MATCH_CONFIDENCE.STRONG;
  return result;
}

// ─── detectRcptBoundary ───────────────────────────────────────────────────────

/**
 * Infer RCPT boundaries from sequence number resets.
 * Returns an array of group-start indexes (into the sequences array).
 *
 * THIS IS INFERENCE ONLY — caller must mark rcptSource = 'inferred'.
 * A reset alone does NOT confirm a new RCPT.
 *
 * @param {ReceiptSequence[]} sequences  Must have .seqNo (number|null)
 * @returns {number[]} indexes of sequences that appear to start a new RCPT group
 */
function detectRcptBoundary(sequences) {
  const boundaries = [0]; // first always starts a group
  for (let i = 1; i < sequences.length; i++) {
    const prev = sequences[i - 1].seqNo;
    const curr = sequences[i].seqNo;
    if (prev !== null && curr !== null && curr < prev) {
      boundaries.push(i);
    }
  }
  return boundaries;
}

// ─── groupItemsByRcpt ─────────────────────────────────────────────────────────

/**
 * Group ReceiptSequences into ReceiptGroups by rcptNo.
 *
 * Priority (per user spec):
 *   explicit API rcptNo > manual > OCR > inferred (sequence reset)
 *
 * Sequences with rcptNo === null that appear after a boundary inference
 * are placed in an 'inferred' group. They are NOT confirmed.
 *
 * @param {string} trNo
 * @param {ReceiptSequence[]} sequences
 * @returns {ReceiptGroup[]}
 */
function groupItemsByRcpt(trNo, sequences) {
  if (!Array.isArray(sequences) || sequences.length === 0) return [];

  // 1. Partition by explicit rcptNo first
  const byRcpt = new Map(); // rcptNo (string) → { rcptNo, sequences, rcptSource }
  const nullRcptSeqs = [];

  sequences.forEach(seq => {
    if (seq.rcptNo !== null && seq.rcptNo !== undefined && seq.rcptNo !== '') {
      const key = String(seq.rcptNo);
      const source = (seq.fieldSources && seq.fieldSources.rcptNo)
        || seq.rcptSource
        || SOURCE.MANUAL;

      if (!byRcpt.has(key)) {
        byRcpt.set(key, { rcptNo: key, sequences: [], rcptSource: source });
      } else {
        const currentGroup = byRcpt.get(key);
        const currentPrio = RCPT_SOURCE_PRIORITY[currentGroup.rcptSource] || 0;
        const newPrio = RCPT_SOURCE_PRIORITY[source] || 0;
        if (newPrio > currentPrio) {
          currentGroup.rcptSource = source;
        }
      }
      byRcpt.get(key).sequences.push(seq);
    } else {
      nullRcptSeqs.push(seq);
    }
  });

  // 2. If any explicit groups exist, put null-rcptNo seqs in an 'unknown' group
  const groups = [];

  byRcpt.forEach(group => {
    groups.push({ trNo, rcptNo: group.rcptNo, sequences: group.sequences, rcptSource: group.rcptSource });
  });

  // 3. Handle null-rcptNo sequences: try inferred boundary detection
  if (nullRcptSeqs.length > 0) {
    const boundaries = detectRcptBoundary(nullRcptSeqs);

    if (boundaries.length <= 1) {
      // Single inferred group
      groups.push({ trNo, rcptNo: null, sequences: nullRcptSeqs, rcptSource: null });
    } else {
      // Multiple inferred groups — mark as inferred, NOT confirmed
      boundaries.forEach((startIdx, bIdx) => {
        const endIdx = boundaries[bIdx + 1] !== undefined ? boundaries[bIdx + 1] : nullRcptSeqs.length;
        groups.push({
          trNo,
          rcptNo: null,
          sequences: nullRcptSeqs.slice(startIdx, endIdx),
          rcptSource: SOURCE.INFERRED  // inferred only — NOT confirmed
        });
      });
    }
  }

  return groups;
}

// ─── matchReceiptGroup ────────────────────────────────────────────────────────

/**
 * Run matchSequence on every sequence in a ReceiptGroup.
 *
 * @param {ReceiptGroup} group
 * @param {Map} trackMap       from buildTrackIndex()
 * @param {ApiTrack[]} apiTracks from buildTrackIndex()
 * @returns {ReceiptGroup}  immutable clone with sequences matched
 */
function matchReceiptGroup(group, trackMap, apiTracks) {
  return Object.assign({}, group, {
    sequences: group.sequences.map(seq => matchSequence(seq, trackMap, apiTracks))
  });
}

// ─── matchAll ─────────────────────────────────────────────────────────────────

/**
 * Top-level entry point.
 *
 * @param {{
 *   trNo: string,
 *   apiItems: object[],        // raw items from extractReceiptApiItems()
 *   sequences: ReceiptSequence[]  // from OCR/manual — may have rcptNo or null
 * }} input
 * @returns {{
 *   trackMap: Map,
 *   apiTracks: ApiTrack[],
 *   groups: ReceiptGroup[]     // matched
 * }}
 */
function matchAll({ trNo, apiItems, sequences }) {
  const { trackMap, apiTracks } = buildTrackIndex(apiItems);
  const rawGroups = groupItemsByRcpt(trNo, sequences);
  const groups = rawGroups.map(g => matchReceiptGroup(g, trackMap, apiTracks));
  return { trackMap, apiTracks, groups };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
// Works in both Node.js (CommonJS) and browser (globals on window.Matcher)

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
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
  };
} else {
  window.Matcher = {
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
  };
}
