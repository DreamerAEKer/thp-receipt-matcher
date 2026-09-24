// App State
const state = {
  receiptItems: [],
  excelMap: new Map(),
  currentFilter: 'all',
  searchQuery: '',
  activeItemNo: 1,
  activePhotoIndex: 0,
  zoom: 1,
  rotation: 0,
  photos: [],
  isSyncEnabled: true,
  isScrollingByProgram: false,
  cameraStream: null,
  cameraFacingMode: 'environment',
  defaultZipPrefix: (typeof localStorage !== 'undefined' ? localStorage.getItem('thp_zip_prefix') : null) || '10501',
  apiToken: (typeof localStorage !== 'undefined' ? localStorage.getItem('thp_api_token') : null) || '',
  apiAccessToken: (typeof localStorage !== 'undefined' ? localStorage.getItem('thp_api_access_token') : null) || '',
  apiAccessTokenExpire: (typeof localStorage !== 'undefined' ? localStorage.getItem('thp_api_access_token_expire') : null) || '',
  currentSessionId: null,
  mobileViewMode: 'split',
  matcherAppliedSignature: null,
  matcherApplyInfo: null,
  lastPreApplySnapshot: null,
  trackSource: null, // 'api' | 'excel' | null
  apiFeedback: null, // { type: 'empty' | 'quota' | 'auth_error', trCode, message } | null
  
  // Crop Editor State (Adobe Scan / Microsoft Lens Style)
  rawCaptureImage: null,
  cropCorners: {
    tl: { x: 0, y: 0 },
    tr: { x: 0, y: 0 },
    br: { x: 0, y: 0 },
    bl: { x: 0, y: 0 }
  },
  editorDisplayRatio: 1
};

// ─────────────────────────────────────────────────────────────────────────────
// [DEBUG] API Structure Inspector — TEMPORARY — Remove after analysis complete
// Does NOT store anything in IndexedDB/History. No PII dumped.
// ─────────────────────────────────────────────────────────────────────────────
let _debugApiReport = null; // in-memory only, cleared on page reload

function _maskTrackNo(raw) {
  // Show only first 2 chars + last 3 chars, mask the middle
  const s = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (s.length <= 5) return s;
  return s.slice(0, 2) + '*'.repeat(s.length - 5) + s.slice(-3);
}

function _schemaOf(obj) {
  if (obj === null) return 'null';
  if (Array.isArray(obj)) return `Array(${obj.length})`;
  if (typeof obj !== 'object') return typeof obj;
  return `Object{${Object.keys(obj).join(', ')}}`;
}

function _inspectItemSample(item, label) {
  if (!item) return `  ${label}: (empty)\n`;
  const fieldNames = Object.keys(item);
  // Detect which field looks like a tracking number (barcode-like: contains letters + digits)
  const trackFieldGuess = fieldNames.find(k => /barcode|track|code/i.test(k));
  const rcptFieldGuess  = fieldNames.find(k => /rcpt|receipt|rec_no|receiptno/i.test(k));
  const seqFieldGuess   = fieldNames.find(k => /seq|no\b|order|line|sort/i.test(k));
  const qtyFieldGuess   = fieldNames.find(k => /qty|quantity|count|amount|weight/i.test(k));
  const svcFieldGuess   = fieldNames.find(k => /service|svc|type/i.test(k));

  let out = `  ${label} — fields (${fieldNames.length}): [${fieldNames.join(', ')}]\n`;
  out += `    → likely tracking field : ${trackFieldGuess || '(none matched)'}\n`;
  out += `    → likely rcpt    field  : ${rcptFieldGuess  || '(none matched)'}\n`;
  out += `    → likely seq/no  field  : ${seqFieldGuess   || '(none matched)'}\n`;
  out += `    → likely qty     field  : ${qtyFieldGuess   || '(none matched)'}\n`;
  out += `    → likely service field  : ${svcFieldGuess   || '(none matched)'}\n`;
  if (trackFieldGuess) {
    const rawVal = item[trackFieldGuess];
    if (rawVal) out += `    → track sample (masked): ${_maskTrackNo(rawVal)}\n`;
  }
  return out;
}

function inspectRawApiResponse(json, httpStatus = 200) {
  const lines = [];

  // ── TOP LEVEL ───────────────────────────────────────────────────────────────
  lines.push('═══════════════════════════════════════════════════');
  lines.push(' [DEBUG] Thailand Post API — Structure Report');
  lines.push(' ' + new Date().toLocaleString('th-TH'));
  lines.push('═══════════════════════════════════════════════════\n');

  // Summary Header
  const apiStatusVal = (json && typeof json === 'object' && 'status' in json) ? String(json.status) : '(absent)';
  const apiMsgVal = (json && typeof json === 'object' && json.message) ? String(json.message) : '';
  const isApiError = (json && typeof json === 'object' && json.status === false);
  const resultLabel = isApiError
    ? (/quota/i.test(apiMsgVal) ? 'API_ERROR / QUOTA_EXCEEDED' : 'API_ERROR')
    : (httpStatus === 200 ? 'SUCCESS' : 'HTTP_ERROR');

  lines.push(`HTTP: ${httpStatus}`);
  lines.push(`API STATUS: ${apiStatusVal}`);
  lines.push(`RESULT: ${resultLabel}`);
  if (apiMsgVal) {
    lines.push(`MESSAGE: ${apiMsgVal}`);
  }
  lines.push('───────────────────────────────────────────────────\n');

  lines.push(`[HTTP STATUS]     ${httpStatus}`);
  const responseType = json === null ? 'null' : Array.isArray(json) ? 'Array' : typeof json;
  lines.push(`[RESPONSE TYPE]   ${responseType}`);

  const topKeys = (json && typeof json === 'object') ? Object.keys(json) : [];
  lines.push(`[TOP-LEVEL KEYS]  ${topKeys.length > 0 ? topKeys.join(', ') : '(none)'}\n`);

  // Safe Top-Level Status / Message / Error extraction
  if (json && typeof json === 'object') {
    if ('status' in json) {
      lines.push(`  status          : ${JSON.stringify(json.status)}`);
    }
    if ('message' in json) {
      lines.push(`  message         : ${JSON.stringify(json.message)}`);
    }
    const errField = topKeys.find(k => /err|code/i.test(k) && k !== 'barcode');
    if (errField && errField !== 'status' && errField !== 'message') {
      lines.push(`  ${errField}           : ${JSON.stringify(json[errField])}`);
    }
    lines.push('');
  }

  const resp = json?.response;
  if (resp === undefined || resp === null) {
    lines.push('⚠ json.response is absent, null, or undefined!');
    lines.push('  → API did not return a response payload for this request.\n');
    lines.push('═══════════════════════════════════════════════════');
    lines.push(' END OF REPORT (EMPTY RESPONSE)');
    lines.push('═══════════════════════════════════════════════════');
    _debugApiReport = lines.join('\n');
    _notifyInspectorReady();
    return;
  }

  const respKeys = typeof resp === 'object' && resp !== null ? Object.keys(resp) : [];
  lines.push(`[response.* keys] ${respKeys.length > 0 ? respKeys.join(', ') : '(none/empty object)'}\n`);

  // ── G1: items vs receipts ────────────────────────────────────────────────
  lines.push('─── G1: items / receipts ───────────────────────────');
  const hasItems    = Array.isArray(resp.items);
  const itemsCount  = hasItems ? resp.items.length : 0;
  const hasReceipts = resp.receipts !== undefined && resp.receipts !== null;
  lines.push(`  response.items    : ${hasItems ? `Array(${itemsCount})` : '(absent or not array)'}`);
  lines.push(`  response.receipts : ${hasReceipts ? _schemaOf(resp.receipts) : '(absent)'}\n`);

  if (!hasItems && !hasReceipts) {
    lines.push('⚠ Neither response.items nor response.receipts found!');
    lines.push(`  Raw typeof response: ${typeof resp}`);
  }

  // ── G2, G3, G4: receipts structure ───────────────────────────────────────
  if (hasReceipts) {
    lines.push('─── G2/G3: receipts structure ──────────────────────');
    const receiptsType = Array.isArray(resp.receipts) ? 'Array' : 'Object';
    lines.push(`  type : ${receiptsType}`);

    if (receiptsType === 'Object') {
      const groupKeys = Object.keys(resp.receipts);
      lines.push(`  keys (receipt groups): [${groupKeys.join(', ')}]`);
      lines.push(`  number of groups: ${groupKeys.length}`);

      // Heuristic: does each key look like a RCPT# (numeric, 4-10 digits)?
      const numericKeys = groupKeys.filter(k => /^\d{4,10}$/.test(k.trim()));
      lines.push(`  keys that look like RCPT# (pure numeric 4-10 digits): ${numericKeys.length}/${groupKeys.length}`);
      lines.push(`  RCPT# pattern match: ${numericKeys.length === groupKeys.length ? 'YES — all keys appear to be RCPT#' : numericKeys.length > 0 ? 'PARTIAL' : 'NO'}\n`);

      // G3: multiple groups?
      lines.push(`  → G3 (multiple RCPT groups?): ${groupKeys.length > 1 ? `YES — ${groupKeys.length} groups` : 'SINGLE group only'}\n`);

      groupKeys.forEach((gKey, gi) => {
        const group = resp.receipts[gKey];
        lines.push(`  ── Group [${gi + 1}] key="${gKey}" ──`);
        lines.push(`     type: ${_schemaOf(group)}`);

        // group can be an Object{barcode: [statuses]} or Array
        if (!Array.isArray(group) && typeof group === 'object' && group !== null) {
          const barcodes = Object.keys(group);
          lines.push(`     tracks in group: ${barcodes.length}`);
          lines.push(`     first track key (masked): ${_maskTrackNo(barcodes[0] || '')}`);
          lines.push(`     last  track key (masked): ${_maskTrackNo(barcodes[barcodes.length - 1] || '')}`);

          // G4: inspect first and last item schema
          const firstKey = barcodes[0];
          const lastKey  = barcodes[barcodes.length - 1];
          const firstStatuses = group[firstKey];
          const firstItem = Array.isArray(firstStatuses) ? firstStatuses.at(-1) : firstStatuses;
          const lastStatuses  = group[lastKey];
          const lastItem  = Array.isArray(lastStatuses)  ? lastStatuses.at(-1)  : lastStatuses;

          lines.push(`     entry type: ${Array.isArray(firstStatuses) ? `Array(${firstStatuses.length}) of statuses` : _schemaOf(firstStatuses)}\n`);
          lines.push(_inspectItemSample(firstItem, 'FIRST item schema'));
          lines.push(_inspectItemSample(lastItem,  'LAST item schema'));

        } else if (Array.isArray(group)) {
          lines.push(`     tracks in group (array): ${group.length}`);
          lines.push(_inspectItemSample(group[0], 'FIRST item schema'));
          lines.push(_inspectItemSample(group[group.length - 1], 'LAST item schema'));
        }
      });
    } else {
      // Array of receipts
      lines.push(`  Array length: ${resp.receipts.length}`);
      lines.push(_inspectItemSample(resp.receipts[0], 'FIRST receipt schema'));
    }
  } else {
    lines.push('─── G2/G3: (no receipts object) ────────────────────\n');
  }

  // ── G5/G6: flat items (if present) ──────────────────────────────────────
  if (hasItems && resp.items.length > 0) {
    lines.push('─── G4/G5/G6: flat items array ─────────────────────');
    lines.push(`  total items: ${resp.items.length}`);
    lines.push(_inspectItemSample(resp.items[0], 'FIRST item schema'));
    lines.push(_inspectItemSample(resp.items[resp.items.length - 1], 'LAST item schema'));

    // G5: sequence field?
    const firstItem = resp.items[0] || {};
    const seqGuess = Object.keys(firstItem).find(k => /seq|no\b|order|line|sort|idx/i.test(k));
    lines.push(`  G5 (sequence field from POS?): ${seqGuess ? `field "${seqGuess}" exists — value type: ${typeof firstItem[seqGuess]}` : 'NO — no obvious sequence field found (frontend must derive)'}\n`);

    // G6: quantity/range field?
    const qtyGuess = Object.keys(firstItem).find(k => /qty|quantity|count|range|from|to\b/i.test(k));
    lines.push(`  G6 (quantity/range field?): ${qtyGuess ? `field "${qtyGuess}" — sample type: ${typeof firstItem[qtyGuess]}` : 'NO — no quantity/range field found'}`);
  }

  // ── G7: RCPT boundary preservable? ──────────────────────────────────────
  lines.push('\n─── G7: RCPT boundary preservable? ─────────────────');
  if (hasReceipts && !Array.isArray(resp.receipts)) {
    const gKeys = Object.keys(resp.receipts);
    lines.push(`  OBSERVED: receipts Object has ${gKeys.length} key(s)`);
    lines.push(`  → If keys are RCPT#: YES — boundary can be preserved from API without OCR`);
    lines.push(`  → Current extractReceiptApiItems() discards this key (Object.values) → must fix`);
  } else if (hasItems && !hasReceipts) {
    lines.push(`  OBSERVED: only flat items array — no receipt grouping`);
    lines.push(`  → RCPT# must come from OCR (header) or manual input`);
  } else {
    lines.push(`  INCONCLUSIVE — both or neither present`);
  }

  // ── Order preservation note ──────────────────────────────────────────────
  lines.push('\n─── JS Object key order note ───────────────────────');
  lines.push('  In modern V8/SpiderMonkey, Object.keys() preserves insertion order');
  lines.push('  for non-integer string keys (e.g. "RJ317132454TH").');
  lines.push('  For RCPT group keys (if numeric strings like "18101"), integer-like');
  lines.push('  keys are sorted numerically first — may or may not match receipt order.\n');

  lines.push('═══════════════════════════════════════════════════');
  lines.push(' END OF REPORT — OBSERVED FROM LIVE API');
  lines.push('═══════════════════════════════════════════════════');

  _debugApiReport = lines.join('\n');
  _notifyInspectorReady();
}

function _notifyInspectorReady() {
  const btn = document.getElementById('btnApiInspector');
  if (btn) {
    btn.classList.remove('hidden');
    btn.classList.add('flex', 'ring-2', 'ring-amber-500');
  }
  console.log('[DEBUG] API Inspector report ready — click the 🔬 button in navbar to view');
}

function _setupApiInspector() {
  const modal      = document.getElementById('apiInspectorModal');
  const body       = document.getElementById('apiInspectorBody');
  const btnOpen    = document.getElementById('btnApiInspector');
  const btnClose   = document.getElementById('btnCloseApiInspector');

  if (!modal || !btnOpen || !btnClose) return;

  btnOpen.onclick = () => {
    body.textContent = _debugApiReport || 'ยังไม่มีข้อมูล — กด "ดึง TR" ก่อน';
    modal.classList.remove('hidden');
  };
  btnClose.onclick = () => modal.classList.add('hidden');
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// END [DEBUG] API Structure Inspector
// ─────────────────────────────────────────────────────────────────────────────


// Initialize
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('labelZipPrefix').textContent = '(' + state.defaultZipPrefix + ')';
    document.getElementById('apiZipPrefixInput').value = state.defaultZipPrefix;
    document.getElementById('apiTokenInput').value = state.apiToken;

    setupPhotoControls();
    setupEventListeners();
    setupSyncScroll();
    setupLensCamera();
    setupCornerCropEditor();
    setupApiModal();
    setupHistory();
    setupPageManager();
    setupMobileTabs();
    _setupApiInspector();
    renderPhotoTabs();
    renderItems();
    updateStats();
    showEmptyPhotoState();

    // Auto-restore latest session if available
    autoRestoreLatestSession();
  });
}

async function autoRestoreLatestSession() {
  try {
    if (typeof localStorage === 'undefined') return;
    const latestId = localStorage.getItem('thp_latest_session_id');
    // If user clicked startNewSession / reset, latestId was removed.
    // Do NOT fall back to old history records; keep the workspace fresh and clean.
    if (!latestId) {
      return;
    }
    const recordToRestore = await getHistoryById(latestId);
    if (recordToRestore) {
      await restoreHistory(recordToRestore.id);
      updateAutoSaveIndicator('saved');
    }
  } catch (err) {
    console.warn('AutoRestore warning:', err);
  }
}

function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
}

const receiptPhotoCollator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

function parseRangeFromFilename(name) {
  if (!name) return null;
  // Look for patterns like "1-7", "1_7", "16-26", "(1-6)"
  const match = name.match(/(\d+)\s*[-_–—toถึง]\s*(\d+)/i);
  if (match) {
    const s = parseInt(match[1], 10);
    const e = parseInt(match[2], 10);
    if (s > 0 && e >= s) {
      return { startNo: s, endNo: e };
    }
  }
  return null;
}

function sortReceiptPhotoBatch(photos) {
  // Try sequence chain first if startNo & endNo exist
  const hasRanges = photos.some(p => {
    const r = parseRangeFromFilename(p.label || p.sortName);
    return !!r || (p.startNo && p.endNo);
  });

  if (hasRanges) {
    photos.forEach(p => {
      if (!p.startNo || !p.endNo) {
        const r = parseRangeFromFilename(p.label || p.sortName);
        if (r) {
          p.startNo = r.startNo;
          p.endNo = r.endNo;
        }
      }
    });
    return chainReceiptPhotosBySequence(photos);
  }

  return [...photos].sort((a, b) => {
    const nameCompare = receiptPhotoCollator.compare(a.sortName || a.label || '', b.sortName || b.label || '');
    if (nameCompare !== 0) return nameCompare;
    return Number(a.lastModified || 0) - Number(b.lastModified || 0);
  });
}

// ----------------------------------------------------
// OCR IDENTITY EXTRACTION (Tesseract.js Client-Side)
// Target: TR#, RCPT#, Sequence Numbers on Header
// ----------------------------------------------------

let tesseractWorkerPromise = null;

async function getOcrWorker() {
  if (tesseractWorkerPromise) return tesseractWorkerPromise;

  tesseractWorkerPromise = (async () => {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js library not loaded');
    }
    // Create lazy-loaded singleton worker for 'eng'
    const worker = await Tesseract.createWorker('eng');
    return worker;
  })();

  return tesseractWorkerPromise;
}

/**
 * Preprocesses an image by cropping the Top Header (top ~25%)
 * downscaling, converting to grayscale, and increasing contrast on canvas.
 */
function preprocessHeaderForOcr(imageSource) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;

        // Crop top 25% of image where THP receipt header (TR#, RCPT#) is located
        const cropH = Math.round(origH * 0.28);
        const cropW = origW;

        // Target max width ~1200px for optimal OCR speed & memory
        const scale = Math.min(1, 1200 / cropW);
        const targetW = Math.round(cropW * scale);
        const targetH = Math.round(cropH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        // Draw cropped region
        ctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, targetW, targetH);

        // Grayscale & Contrast Enhancement
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const d = imgData.data;
        const contrast = 1.35; // boost contrast
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < d.length; i += 4) {
          // luminance formula
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = factor * (gray - 128) + 128;
          const clamped = Math.max(0, Math.min(255, val));
          d[i] = clamped;
          d[i + 1] = clamped;
          d[i + 2] = clamped;
        }
        ctx.putImageData(imgData, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('โหลดภาพเพื่อทำ OCR ไม่สำเร็จ'));
    img.src = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
  });
}

/**
 * Extracts TR# and RCPT# from text using robust patterns
 */
function parseReceiptHeaderIdentity(text) {
  if (!text || typeof text !== 'string') {
    return { tr: null, rcpt: null, rawText: '' };
  }

  // Clean obvious noise
  const clean = text.replace(/[\r\n]+/g, ' ');

  // Look for TR# pattern: e.g. "TR# 11489115", "TR: 11489115", "TR 11489115", "TR#11489115"
  let tr = null;
  const trMatch = clean.match(/(?:TR\s*#?|TR\s*[:\-])\s*([0-9]{7,10})/i);
  if (trMatch) {
    tr = trMatch[1];
  }

  // Look for RCPT# pattern: e.g. "RCPT# 18101", "RCPT: 18101", "REC# 18101", "RCPT 18101"
  let rcpt = null;
  const rcptMatch = clean.match(/(?:RCPT\s*#?|REC(?:EIPT)?\s*#?|RCPT\s*[:\-])\s*([0-9]{4,8})/i);
  if (rcptMatch) {
    rcpt = rcptMatch[1];
  }

  return {
    tr: tr || null,
    rcpt: rcpt || null,
    rawText: clean
  };
}

/**
 * Background non-blocking OCR worker execution on a photo object
 */
async function processPhotoHeaderIdentity(photo) {
  if (!photo || photo.userConfirmed) return;

  photo.ocrStatus = 'processing';
  updatePhotoIdentityBadge();

  try {
    const preprocessedDataUrl = await preprocessHeaderForOcr(photo.file);
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(preprocessedDataUrl);

    const parsed = parseReceiptHeaderIdentity(data.text);
    photo.detectedTR = parsed.tr;
    photo.detectedRcpt = parsed.rcpt;
    photo.ocrConfidence = data.confidence || 0;
    photo.ocrRawText = parsed.rawText;
    photo.ocrStatus = 'done';

    // Validate TR with current TR
    validatePhotoTRIdentity(photo);
  } catch (err) {
    console.warn('OCR Identity extraction notice:', err.message);
    photo.detectedTR = null;
    photo.detectedRcpt = null;
    photo.trMatchStatus = 'not_found';
    photo.ocrStatus = 'done';
  } finally {
    updatePhotoIdentityBadge();
    triggerAutoSave();
  }
}

/**
 * Preprocesses line items region for OCR
 * When hasHeader is true, skips top ~22% header; else starts at ~2%.
 * Ends at ~98%.
 */
function preprocessLinesForOcr(imageSource, hasHeader = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;

        const startYRatio = hasHeader ? 0.22 : 0.02;
        const endYRatio = 0.98;

        const cropY = Math.round(origH * startYRatio);
        const cropH = Math.round(origH * (endYRatio - startYRatio));
        const cropW = origW;

        const scale = Math.min(1.5, 1400 / cropW);
        const targetW = Math.round(cropW * scale);
        const targetH = Math.round(cropH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, cropY, cropW, cropH, 0, 0, targetW, targetH);

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const d = imgData.data;
        const contrast = 1.35;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const val = factor * (gray - 128) + 128;
          const clamped = Math.max(0, Math.min(255, val));
          d[i] = clamped;
          d[i + 1] = clamped;
          d[i + 2] = clamped;
        }
        ctx.putImageData(imgData, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('โหลดภาพเพื่อทำ Line OCR ไม่สำเร็จ'));
    img.src = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
  });
}

/**
 * Extracts tracking number candidates from text.
 * Strictly normalizes whitespace and case ONLY.
 * NO auto-correction of characters (O->0, I->1, 7H->TH etc.).
 */
function extractTrackCandidates(text) {
  const candidates = [];
  if (!text || typeof text !== 'string') return candidates;

  // Filter out TAX ID, POS, RC, TR headers / non-tracking lines
  if (/TAX\s*ID|TAX\s*INVOICE|POS[:\s]|เลขประจำตัวผู้เสียภาษี|REPT|ABB/i.test(text)) {
    return candidates;
  }

  // Universal Postal Union (S10): 2-letter service prefix + 8-10 digits + 2-letter country suffix
  const regex = /(?:^|[\s,;:\(\)\[\]\|\-])([A-Za-z]{2})\s*([0-9\s]{8,14})\s*([A-Za-z]{2})(?=$|[\s,;:.!?\(\)\[\]\|\-])/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const prefix = m[1];
    const middleDigits = m[2].replace(/\s+/g, '');
    const suffix = m[3];
    if (middleDigits.length >= 8 && middleDigits.length <= 10) {
      const full = cleanTrackNo(prefix + middleDigits + suffix);
      if (/^[A-Za-z]{2}\d{8,10}[A-Za-z]{2}$/.test(full)) {
        candidates.push({
          raw: m[0].trim(),
          normalized: full
        });
      }
    }
  }
  return candidates;
}

/**
 * Standard Levenshtein edit distance computation for candidate suggestion.
 */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

/**
 * Searches current API array for reference tracking candidate.
 * Strictly SUGGESTION ONLY — NEVER AUTO-CORRECT OR AUTO-APPLY.
 * Ambiguous matches return status 'ambiguous'.
 */
function findApiTrackCandidate(rawTrack, apiItems, maxDistance = 3) {
  if (!rawTrack || typeof rawTrack !== 'string') {
    return { status: 'none', candidate: null, distance: null, source: 'api-review' };
  }
  const norm = cleanTrackNo(rawTrack);
  if (!norm) return { status: 'none', candidate: null, distance: null, source: 'api-review' };

  const uniqueApiTracks = new Set();
  (apiItems || []).forEach(item => {
    const b = cleanTrackNo(item?.barcode || item?.track_no || item?.trackNo || (typeof item === 'string' ? item : ''));
    if (b) uniqueApiTracks.add(b);
  });

  if (uniqueApiTracks.has(norm)) {
    return { status: 'exact_match', candidate: norm, distance: 0, source: 'api-review' };
  }

  const matches = [];
  uniqueApiTracks.forEach(apiTrack => {
    const dist = levenshteinDistance(norm, apiTrack);
    if (dist <= maxDistance) {
      matches.push({ track: apiTrack, distance: dist });
    }
  });

  if (matches.length === 0) {
    return { status: 'none', candidate: null, distance: null, source: 'api-review' };
  }

  matches.sort((a, b) => a.distance - b.distance);
  const bestDist = matches[0].distance;
  const bestMatches = matches.filter(m => m.distance === bestDist);

  if (bestMatches.length === 1) {
    return {
      status: 'single_match',
      candidate: bestMatches[0].track,
      distance: bestDist,
      source: 'api-review'
    };
  }

  return {
    status: 'ambiguous',
    candidate: null,
    candidates: bestMatches.map(m => m.track),
    distance: bestDist,
    source: 'api-review'
  };
}

/**
 * Searches actual imported track array for a nominal-endpoint range review candidate.
 * Strictly SUGGESTION ONLY — NEVER AUTO-CORRECT OR AUTO-APPLY.
 *
 * Rules:
 * - firstTrack exact match exists at index A in imported tracks
 * - qty is an integer > 1
 * - printed lastTrack does NOT exist in imported tracks
 * - A + qty - 1 is within array bounds
 * - All tracks in slice are real imported tracks
 * - No track in slice is assigned to another photo
 * - No duplicate tracks in slice or in source
 * - Does not overlap another known sequence boundary
 *
 * NEVER uses numeric serial arithmetic, prefixes, or step assumptions.
 */
function findRangeReviewCandidate(seq, apiItems, allSeqs = [], currentPhotoIndex = null) {
  if (!seq || typeof seq !== 'object') {
    return { status: 'none', candidate: null, reason: 'Invalid sequence' };
  }
  const normFirst = cleanTrackNo(seq.firstTrack);
  const normLast = cleanTrackNo(seq.lastTrack);
  const qty = Number(seq.qty);

  if (!normFirst) {
    return { status: 'none', candidate: null, reason: 'firstTrack missing' };
  }
  if (!Number.isInteger(qty) || qty <= 1) {
    return { status: 'none', candidate: null, reason: 'qty missing or not a positive integer > 1' };
  }

  const items = Array.isArray(apiItems) ? apiItems : [];
  if (items.length === 0) {
    return { status: 'none', candidate: null, reason: 'No imported tracks available' };
  }

  const trackIndexMap = new Map();
  items.forEach((item, idx) => {
    const t = cleanTrackNo(item?.barcode || item?.track_no || item?.trackNo || (typeof item === 'string' ? item : ''));
    if (!t) return;
    if (!trackIndexMap.has(t)) {
      trackIndexMap.set(t, [idx]);
    } else {
      trackIndexMap.get(t).push(idx);
    }
  });

  const firstIndexes = trackIndexMap.get(normFirst);
  if (!firstIndexes || firstIndexes.length === 0) {
    return { status: 'none', candidate: null, reason: 'firstTrack not found in actual imported tracks' };
  }
  if (firstIndexes.length > 1) {
    return { status: 'none', candidate: null, reason: 'firstTrack is duplicate in actual imported tracks' };
  }

  const startIdx = firstIndexes[0];

  // If printed lastTrack already exists in imported tracks, no review candidate needed
  if (normLast && trackIndexMap.has(normLast)) {
    return { status: 'none', candidate: null, reason: 'printed lastTrack already exists in actual imported tracks' };
  }

  const targetIdx = startIdx + qty - 1;
  if (targetIdx >= items.length || targetIdx < 0) {
    return { status: 'none', candidate: null, reason: 'Candidate slice exceeds actual imported track array' };
  }

  const sliceTracks = [];
  for (let i = startIdx; i <= targetIdx; i++) {
    const t = cleanTrackNo(items[i]?.barcode || items[i]?.track_no || items[i]?.trackNo || (typeof items[i] === 'string' ? items[i] : ''));
    if (!t) {
      return { status: 'none', candidate: null, reason: 'Invalid or empty track within candidate slice' };
    }
    if (trackIndexMap.get(t)?.length > 1) {
      return { status: 'none', candidate: null, reason: `Slice member "${t}" is duplicate in actual imported tracks` };
    }
    if (currentPhotoIndex !== null && items[i]?.photoIndex !== null && items[i]?.photoIndex !== undefined && items[i]?.photoIndex !== currentPhotoIndex) {
      return { status: 'none', candidate: null, reason: `Track at index ${i} is already assigned to photo ${items[i].photoIndex}` };
    }
    sliceTracks.push(t);
  }

  const uniqueSliceSet = new Set(sliceTracks);
  if (uniqueSliceSet.size !== qty) {
    return { status: 'none', candidate: null, reason: 'Duplicate tracking numbers detected within candidate slice' };
  }

  if (Array.isArray(allSeqs) && allSeqs.length > 0) {
    for (const other of allSeqs) {
      if (other === seq) continue;
      const otherFirst = cleanTrackNo(other.firstTrack);
      if (!otherFirst) continue;
      const otherFirstIndices = trackIndexMap.get(otherFirst);
      if (otherFirstIndices && otherFirstIndices.length === 1) {
        const oIdx = otherFirstIndices[0];
        if (oIdx > startIdx && oIdx <= targetIdx) {
          return { status: 'none', candidate: null, reason: 'Candidate slice overlaps start of another sequence' };
        }
      }
    }
  }

  const candidateTrack = sliceTracks[sliceTracks.length - 1];
  return {
    status: 'candidate',
    candidate: candidateTrack,
    candidateIndex: targetIdx,
    startIndex: startIdx,
    qty,
    printedLastTrack: seq.lastTrack || null,
    reason: `Candidate discovered at index ${targetIdx} (${qty} items from index ${startIdx})`,
    source: 'range-candidate'
  };
}

/**
 * Pure evaluation of sequence range against actual imported Excel tracks array.
 * Calculates expected quantity and boundary relationships from array indices.
 * NEVER uses numeric serial arithmetic, check-digit fabrication, or tracking guessing.
 */
function evaluateExcelRangeReview(seq, apiItems = null) {
  if (!seq || typeof seq !== 'object') return null;
  const normFirst = cleanTrackNo(seq.firstTrack);
  const normLast = cleanTrackNo(seq.lastTrack);
  if (!normFirst || !normLast || normFirst === normLast) {
    return null;
  }

  const items = Array.isArray(apiItems)
    ? apiItems
    : (typeof state !== 'undefined' && Array.isArray(state?.receiptItems) ? state.receiptItems : []);
  if (items.length === 0) return null;

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < items.length; i++) {
    const t = cleanTrackNo(items[i]?.barcode || items[i]?.track_no || items[i]?.trackNo || (typeof items[i] === 'string' ? items[i] : ''));
    if (t === normFirst && startIdx === -1) {
      startIdx = i;
    }
    if (t === normLast && endIdx === -1) {
      endIdx = i;
    }
    if (startIdx !== -1 && endIdx !== -1) break;
  }

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  if (startIdx > endIdx) {
    return {
      status: 'conflict',
      startIndex: startIdx,
      endIndex: endIdx,
      expectedQty: null,
      reason: 'ลำดับเลขพัสดุกลับด้าน (First Track อยู่หลัง Last Track ใน Excel)'
    };
  }

  const expectedQty = endIdx - startIdx + 1;
  const rawQty = seq.qty;
  const hasQty = rawQty !== null && rawQty !== undefined && rawQty !== '' && Number(rawQty) > 0;

  if (hasQty) {
    const declaredQty = Number(rawQty);
    if (declaredQty === expectedQty) {
      return {
        status: 'match',
        startIndex: startIdx,
        endIndex: endIdx,
        expectedQty: expectedQty,
        reason: `ช่วงใน Excel ตรงกับจำนวน ${expectedQty} รายการ`
      };
    } else {
      return {
        status: 'conflict',
        startIndex: startIdx,
        endIndex: endIdx,
        expectedQty: expectedQty,
        reason: `จำนวนบนใบเสร็จ ${declaredQty} แต่ช่วงใน Excel มี ${expectedQty} รายการ`
      };
    }
  }

  return {
    status: 'qty_suggested',
    startIndex: startIdx,
    endIndex: endIdx,
    expectedQty: expectedQty,
    reason: `Excel ช่วงนี้มี ${expectedQty} รายการ`
  };
}

/**
 * Parses line items from OCR lines and returns non-binding suggestion objects.
 * Never modifies photo.sequences directly.
 */
function parseReceiptLineEvidence(lines, rcptNo = null, apiItems = []) {
  const suggestions = [];
  if (!Array.isArray(lines)) return suggestions;

  let currentSeq = null;
  let currentRaw = '';
  let currentConf = 0;
  let confCount = 0;
  let activeSuggestion = null;

  function finalizeActiveSuggestion() {
    if (!activeSuggestion) return;
    if (activeSuggestion.explicitQty) {
      activeSuggestion.qty = activeSuggestion.explicitQty;
    } else if (activeSuggestion.atQuantities && activeSuggestion.atQuantities.length > 0) {
      const allEqual = activeSuggestion.atQuantities.every(q => q === activeSuggestion.atQuantities[0]);
      if (allEqual) {
        activeSuggestion.qty = activeSuggestion.atQuantities[0];
      } else {
        // Conflicting service quantities -> set null to require review
        activeSuggestion.qty = null;
      }
    } else {
      activeSuggestion.qty = activeSuggestion.isRange ? null : 1;
    }
    delete activeSuggestion.atQuantities;
    delete activeSuggestion.explicitQty;
    delete activeSuggestion.isRange;
    activeSuggestion = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = (line.text || '').trim();
    if (!text) continue;

    // Check for sequence number header: e.g. "1.", "1 ", "1 จดหมาย...", "2. ..."
    const seqMatch = text.match(/^\s*(\d{1,4})\s*[\.\,\:\;\-]\s*(.*)$/) ||
                     text.match(/^\s*(\d{1,4})\s+(?:จดหมาย|พัสดุ|ems|ลงทะเบียน|[A-Za-z])/i);

    if (seqMatch && activeSuggestion) {
      finalizeActiveSuggestion();
    }

    if (seqMatch) {
      currentSeq = parseInt(seqMatch[1], 10);
      currentRaw = text;
      currentConf = line.confidence || 0;
      confCount = 1;
    } else if (currentSeq !== null && confCount < 3) {
      currentRaw += ' ' + text;
      currentConf += (line.confidence || 0);
      confCount++;
    }

    const tracks = extractTrackCandidates(text);
    if (tracks.length > 0) {
      if (activeSuggestion) {
        finalizeActiveSuggestion();
      }

      const first = tracks[0].normalized;
      const last = tracks.length > 1 ? tracks[1].normalized : first;
      const isRange = tracks.length > 1 && first !== last;

      const avgConf = confCount > 0 ? Math.round(currentConf / confCount) : Math.round(line.confidence || 0);
      const firstCandidate = findApiTrackCandidate(first, apiItems);
      const lastCandidate = (tracks.length > 1) ? findApiTrackCandidate(last, apiItems) : firstCandidate;

      const sug = {
        id: 'sug_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        rcptNo: rcptNo || null,
        seqNo: currentSeq !== null ? currentSeq : null,
        firstTrack: first,
        lastTrack: last,
        printedFirstTrack: first,
        printedLastTrack: last,
        qty: isRange ? null : 1,
        rawText: currentRaw || text,
        confidence: avgConf,
        provenance: 'ocr',
        status: 'pending',
        reviewCandidate: firstCandidate,
        firstCandidate: firstCandidate,
        lastCandidate: lastCandidate,
        isRange,
        atQuantities: [],
        explicitQty: null
      };

      // Check for explicit qty on the track line itself
      const qtyMatch = text.match(/(?:จำนวน\s*(\d+)|(\d+)\s*ชิ้น|qty\s*[:\.]?\s*(\d+))/i);
      if (qtyMatch) {
        const q = parseInt(qtyMatch[1] || qtyMatch[2] || qtyMatch[3], 10);
        if (!isNaN(q) && q > 0) sug.explicitQty = q;
      }

      // Check for @ quantity on the track line itself
      const atRegex = /(?:^|[\s,;:])(\d{1,4})\s*[@©]\s*[\d\.\,]+/g;
      let atM;
      while ((atM = atRegex.exec(text)) !== null) {
        const q = parseInt(atM[1], 10);
        if (!isNaN(q) && q > 0) sug.atQuantities.push(q);
      }

      suggestions.push(sug);
      activeSuggestion = sug;

      currentSeq = null;
      currentRaw = '';
      confCount = 0;
    } else if (activeSuggestion) {
      // Lines following tracks (fees, service breakdown) before next sequence
      const qtyMatch = text.match(/(?:จำนวน\s*(\d+)|(\d+)\s*ชิ้น|qty\s*[:\.]?\s*(\d+))/i);
      if (qtyMatch) {
        const q = parseInt(qtyMatch[1] || qtyMatch[2] || qtyMatch[3], 10);
        if (!isNaN(q) && q > 0) activeSuggestion.explicitQty = q;
      }

      const atRegex = /(?:^|[\s,;:])(\d{1,4})\s*[@©]\s*[\d\.\,]+/g;
      let atM;
      while ((atM = atRegex.exec(text)) !== null) {
        const q = parseInt(atM[1], 10);
        if (!isNaN(q) && q > 0) activeSuggestion.atQuantities.push(q);
      }
    }
  }

  finalizeActiveSuggestion();

  return suggestions;
}

/**
 * Executes Line OCR on a specific photo in Page Manager.
 * Stores suggestions in photo.ocrSequenceSuggestions without mutating photo.sequences.
 */
async function scanPhotoLineEvidence(photoIndex) {
  const photo = state.photos[photoIndex];
  if (!photo) return;

  photo.ocrLinesStatus = 'processing';
  renderPageManageList();

  try {
    const hasHeader = Boolean(photo.detectedTR || photo.detectedRcpt || photo.isHeaderPage);
    const preprocessedUrl = await preprocessLinesForOcr(photo.file, hasHeader);
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(preprocessedUrl);

    const rcptNo = photo.detectedRcpt || null;
    const lines = (data.lines || []).map(l => ({ text: l.text, confidence: l.confidence }));
    const suggestions = parseReceiptLineEvidence(lines, rcptNo, state?.receiptItems || []);

    photo.ocrSequenceSuggestions = suggestions;
    photo.ocrLinesStatus = 'done';
    photo.ocrLinesConfidence = data.confidence || 0;

    alignReceiptItemsToPhotos();
  } catch (err) {
    console.warn('OCR Line extraction error:', err);
    photo.ocrLinesStatus = 'error';
    photo.ocrLinesError = err.message;
  } finally {
    renderPageManageList();
  }
}

let isBatchScanning = false;
async function autoScanPhotoBatch() {
  if (isBatchScanning || !state.photos || state.photos.length === 0) return;
  isBatchScanning = true;
  try {
    for (let i = 0; i < state.photos.length; i++) {
      const photo = state.photos[i];
      if (!photo) continue;
      if (!photo.ocrSequenceSuggestions || photo.ocrSequenceSuggestions.length === 0) {
        try {
          await scanPhotoLineEvidence(i);
        } catch (err) {
          console.warn('Auto scan photo failed for index ' + i, err);
        }
      }
    }
  } finally {
    isBatchScanning = false;
  }
}

/**
 * Explicit user confirmation of an OCR suggestion.
 * Copies verified/edited values into photo.sequences with provenance: 'manual'.
 */
function confirmOcrSuggestion(photoIndex, suggestionId, editedValues = null) {
  const photo = state.photos[photoIndex];
  if (!photo || !Array.isArray(photo.ocrSequenceSuggestions)) return;

  const sug = photo.ocrSequenceSuggestions.find(s => s.id === suggestionId);
  if (!sug) return;

  if (!Array.isArray(photo.sequences)) {
    photo.sequences = [];
  }

  const finalSeqNo = (editedValues && editedValues.seqNo !== undefined) ? (Number(editedValues.seqNo) || null) : sug.seqNo;
  const finalFirst = (editedValues && editedValues.firstTrack !== undefined) ? cleanTrackNo(editedValues.firstTrack) : sug.firstTrack;
  let finalLast = (editedValues && editedValues.lastTrack !== undefined) ? cleanTrackNo(editedValues.lastTrack) : sug.lastTrack;
  const finalPrintedFirst = (editedValues && editedValues.printedFirstTrack !== undefined)
    ? editedValues.printedFirstTrack
    : (sug.printedFirstTrack || sug.firstTrack || null);
  const finalPrintedLast = (editedValues && editedValues.printedLastTrack !== undefined)
    ? editedValues.printedLastTrack
    : (sug.printedLastTrack || sug.lastTrack || null);

  const isSingle = finalFirst && (!finalLast || finalLast === finalFirst);
  let finalQty = (editedValues && editedValues.qty !== undefined)
    ? (editedValues.qty !== null && Number(editedValues.qty) > 0 ? Number(editedValues.qty) : (isSingle ? 1 : null))
    : (sug.qty !== null && Number(sug.qty) > 0 ? Number(sug.qty) : (isSingle ? 1 : null));

  if (isSingle) {
    finalLast = finalFirst;
    if (!finalQty) finalQty = 1;
  }

  photo.sequences.push({
    rcptNo: (editedValues && editedValues.rcptNo !== undefined) ? editedValues.rcptNo : (sug.rcptNo || photo.detectedRcpt || null),
    seqNo: finalSeqNo,
    firstTrack: finalFirst,
    lastTrack: finalLast,
    printedFirstTrack: finalPrintedFirst,
    printedLastTrack: finalPrintedLast,
    qty: finalQty,
    provenance: 'manual',
    fieldSources: {
      rcptNo: 'manual',
      seqNo: 'manual',
      firstTrack: 'manual',
      lastTrack: 'manual',
      qty: 'manual'
    },
    ocrRawText: sug.rawText,
    ocrConfidence: sug.confidence
  });

  sug.status = 'confirmed';
  if (typeof renderPageManageList === 'function' && typeof document !== 'undefined') {
    renderPageManageList();
  }
}

/**
 * Rejects an OCR suggestion without adding it to photo.sequences.
 */
function rejectOcrSuggestion(photoIndex, suggestionId) {
  const photo = state.photos[photoIndex];
  if (!photo || !Array.isArray(photo.ocrSequenceSuggestions)) return;

  const sug = photo.ocrSequenceSuggestions.find(s => s.id === suggestionId);
  if (sug) {
    sug.status = 'rejected';
  }
  if (typeof renderPageManageList === 'function' && typeof document !== 'undefined') {
    renderPageManageList();
  }
}

/**
 * Batch confirmation of all pending suggestions for a photo.
 * Safe rule: Confirms ONLY rows with validation === 'strong', no ambiguity, and complete fields.
 * Skips rows with conflict or missing/invalid range qty and alerts summary.
 */
function confirmAllOcrSuggestions(photoIndex) {
  const photo = state.photos[photoIndex];
  if (!photo || !Array.isArray(photo.ocrSequenceSuggestions)) return;

  const pending = photo.ocrSequenceSuggestions.filter(s => s.status === 'pending');
  const allSeqs = [];
  (state.photos || []).forEach(p => (p.sequences || []).forEach(s => allSeqs.push(s)));

  let confirmedCount = 0;
  let skippedCount = 0;

  pending.forEach(sug => {
    const isSingle = sug.firstTrack && (!sug.lastTrack || sug.lastTrack === sug.firstTrack);
    const hasQty = isSingle || (sug.qty !== null && sug.qty !== undefined && Number(sug.qty) > 0);
    const val = evaluateSequenceValidation({
      seqNo: sug.seqNo,
      firstTrack: sug.firstTrack,
      lastTrack: sug.lastTrack,
      qty: sug.qty
    }, photo.detectedRcpt, allSeqs);

    const isStrong = val && val.status === 'strong';
    const hasAmbiguity = sug.reviewCandidate?.status === 'ambiguous';
    const hasRequiredFields = Boolean(sug.firstTrack && hasQty);

    if (isStrong && !hasAmbiguity && hasRequiredFields) {
      confirmOcrSuggestion(photoIndex, sug.id);
      confirmedCount++;
    } else {
      skippedCount++;
    }
  });

  if (typeof alert === 'function') {
    if (confirmedCount > 0 && skippedCount > 0) {
      alert(`ยืนยันสำเร็จ ${confirmedCount} รายการ / ข้าม ${skippedCount} รายการที่ต้องตรวจสอบ`);
    } else if (confirmedCount > 0 && skippedCount === 0) {
      alert(`ยืนยันสำเร็จทั้งหมด ${confirmedCount} รายการ`);
    } else {
      alert(`ไม่สามารถยืนยันได้ (ข้ามทั้ง ${skippedCount} รายการเนื่องจากยังติดข้อขัดแย้งหรือต้องตรวจสอบ)`);
    }
  }

  if (typeof renderPageManageList === 'function' && typeof document !== 'undefined') {
    renderPageManageList();
  }
}

/**
 * Validates a photo's detected TR against the current working TR
 */
function validatePhotoTRIdentity(photo) {
  const currentTR = document.getElementById('trNumberInput').value.trim();

  if (!photo.detectedTR) {
    photo.trMatchStatus = 'not_found';
    return;
  }

  if (!currentTR) {
    // Case A: No current TR in system -> prompt user to adopt this TR
    photo.trMatchStatus = 'detected_new';
    promptAdoptDetectedTR(photo.detectedTR, photo.detectedRcpt);
  } else if (photo.detectedTR === currentTR) {
    // Matches current TR
    photo.trMatchStatus = 'matched';
  } else {
    // Case B: Mismatch -> warn user, DO NOT switch automatically
    photo.trMatchStatus = 'mismatched';
    promptTrMismatchWarning(photo, currentTR, photo.detectedTR);
  }
}

/**
 * Modal prompt for Case A: User has no TR set, detected TR in photo
 */
function promptAdoptDetectedTR(detectedTR, detectedRcpt) {
  const modal = document.getElementById('trPromptModal');
  const numSpan = document.getElementById('trPromptDetectedNum');
  const rcptSpan = document.getElementById('trPromptRcptNum');
  const btnConfirm = document.getElementById('btnTrPromptConfirm');
  const btnDismiss = document.getElementById('btnTrPromptDismiss');

  if (!modal || !numSpan || !btnConfirm) return;

  numSpan.textContent = 'TR# ' + detectedTR;
  rcptSpan.textContent = detectedRcpt ? `(RCPT# ${detectedRcpt})` : '';

  modal.classList.remove('hidden');

  btnConfirm.onclick = () => {
    modal.classList.add('hidden');
    document.getElementById('trNumberInput').value = detectedTR;
    // Mark photos with this TR as matched
    state.photos.forEach(p => {
      if (p.detectedTR === detectedTR) p.trMatchStatus = 'matched';
    });
    updatePhotoIdentityBadge();
    triggerAutoSave();
    // Reuse existing Thailand Post API fetch workflow
    fetchTrackingByTR(detectedTR);
  };

  btnDismiss.onclick = () => {
    modal.classList.add('hidden');
  };
}

/**
 * Modal prompt for Case B: Mismatch between photo TR and current TR
 */
function promptTrMismatchWarning(photo, currentTR, detectedTR) {
  const modal = document.getElementById('trMismatchModal');
  const curSpan = document.getElementById('trMismatchCurrentVal');
  const detSpan = document.getElementById('trMismatchDetectedVal');
  const btnExclude = document.getElementById('btnTrMismatchExclude');
  const btnKeep = document.getElementById('btnTrMismatchKeep');
  const btnSwitch = document.getElementById('btnTrMismatchSwitch');

  if (!modal || !curSpan || !detSpan) return;

  curSpan.textContent = `TR ${state.defaultZipPrefix}|${currentTR}`;
  detSpan.textContent = `TR ${detectedTR}`;

  modal.classList.remove('hidden');

  btnExclude.onclick = () => {
    modal.classList.add('hidden');
    // Remove this photo from state
    const pIdx = state.photos.indexOf(photo);
    if (pIdx >= 0) {
      state.photos.splice(pIdx, 1);
      alignReceiptItemsToPhotos();
      renderPhotoTabs();
      if (state.activePhotoIndex >= state.photos.length) {
        state.activePhotoIndex = Math.max(0, state.photos.length - 1);
      }
      if (state.photos.length > 0) switchPhoto(state.activePhotoIndex, false);
      else showEmptyPhotoState();
      triggerAutoSave();
    }
  };

  btnKeep.onclick = () => {
    modal.classList.add('hidden');
    photo.userConfirmed = true; // User acknowledged keeping this photo
    updatePhotoIdentityBadge();
    triggerAutoSave();
  };

  btnSwitch.onclick = () => {
    modal.classList.add('hidden');
    document.getElementById('trNumberInput').value = detectedTR;
    photo.trMatchStatus = 'matched';
    photo.userConfirmed = true;
    updatePhotoIdentityBadge();
    triggerAutoSave();
    // Reuse existing Thailand Post API fetch workflow
    fetchTrackingByTR(detectedTR);
  };
}

/**
 * Updates identity badge display on the left panel bottom bar
 */
function updatePhotoIdentityBadge() {
  const badge = document.getElementById('photoIdentityBadge');
  if (!badge) return;

  const currentPhoto = state.photos[state.activePhotoIndex];
  if (!currentPhoto) {
    badge.className = 'hidden';
    return;
  }

  if (currentPhoto.ocrStatus === 'processing') {
    badge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-700 text-amber-300 animate-pulse';
    badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจใบเสร็จ...';
    return;
  }

  const trText = currentPhoto.detectedTR ? `TR# ${currentPhoto.detectedTR}` : null;
  const rcptText = currentPhoto.detectedRcpt ? `RCPT# ${currentPhoto.detectedRcpt}` : null;
  const identityLabel = [trText, rcptText].filter(Boolean).join(' | ');

  if (currentPhoto.trMatchStatus === 'matched') {
    badge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-emerald-900/80 text-emerald-200 border border-emerald-700/60';
    badge.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(identityLabel || 'TR ตรงกัน')}`;
  } else if (currentPhoto.trMatchStatus === 'mismatched') {
    badge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-amber-900/80 text-amber-200 border border-amber-700/60';
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(identityLabel || 'TR ไม่ตรงกัน')}`;
  } else if (currentPhoto.detectedRcpt && !currentPhoto.detectedTR) {
    badge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-blue-900/80 text-blue-200 border border-blue-700/60';
    badge.innerHTML = `<i class="fa-solid fa-file-invoice"></i> ${escapeHtml(rcptText)}`;
  } else if (currentPhoto.trMatchStatus === 'not_found' || !currentPhoto.detectedTR) {
    badge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-400 border border-slate-700/60';
    badge.innerHTML = '<i class="fa-regular fa-circle-question"></i> ไม่พบ TR ในภาพ';
  } else {
    badge.className = 'hidden';
  }
}

// ----------------------------------------------------
// RECEIPT SEQUENCE MATCHER (TR -> Receipt -> Page -> Sequence -> Track)
// ----------------------------------------------------

/**
 * Builds sequence chains from photo ranges, respecting overlaps and sequence resets (new receipt within same TR).
 * E.g. [16-26], [37-45], [7-16], [26-37], [1-7]
 * Chained to: [1-7] -> [7-16] -> [16-26] -> [26-37] -> [37-45]
 */
function chainReceiptPhotosBySequence(photos) {
  if (!Array.isArray(photos) || photos.length <= 1) return [...(photos || [])];

  const withRanges = [];
  const withoutRanges = [];

  photos.forEach((photo, idx) => {
    const s = Number(photo.startNo);
    const e = Number(photo.endNo);
    if (Number.isFinite(s) && Number.isFinite(e) && s > 0 && e >= s) {
      withRanges.push({ photo, startNo: s, endNo: e, originalIndex: idx });
    } else {
      withoutRanges.push(photo);
    }
  });

  if (withRanges.length === 0) return [...photos];

  // Build receipt blocks by grouping contiguous / overlapping chains
  withRanges.sort((a, b) => a.startNo - b.startNo || a.originalIndex - b.originalIndex);
  const pool = [...withRanges];
  const receiptBlocks = [];

  while (pool.length > 0) {
    // 1. Find the best root (prefer startNo === 1 with lowest originalIndex or lowest startNo)
    let rootIdx = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].startNo === 1) {
        rootIdx = i;
        break;
      }
    }

    const currentBlock = [pool.splice(rootIdx, 1)[0]];

    // 2. Grow this receipt block by chaining contiguous / overlapping pages
    let added = true;
    while (added) {
      added = false;
      const last = currentBlock[currentBlock.length - 1];

      let bestCandIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        // If candidate starts with 1 and last is not at 1, it's a new receipt!
        if (cand.startNo === 1) continue;

        let score = 0;
        if (cand.startNo <= last.endNo && cand.endNo > last.endNo) {
          // Overlap!
          const overlap = last.endNo - cand.startNo + 1;
          score = 1000 - overlap;
        } else if (cand.startNo === last.endNo + 1) {
          // Exactly contiguous
          score = 900;
        } else if (cand.startNo > last.endNo && cand.startNo <= last.endNo + 5) {
          // Small forward gap
          score = 500 - (cand.startNo - last.endNo);
        }

        if (score > 0 && score > bestScore) {
          bestScore = score;
          bestCandIdx = i;
        }
      }

      if (bestCandIdx >= 0) {
        currentBlock.push(pool.splice(bestCandIdx, 1)[0]);
        added = true;
      }
    }

    receiptBlocks.push(currentBlock);
  }

  const orderedResult = [];
  receiptBlocks.forEach(block => {
    orderedResult.push(...block.map(b => b.photo));
  });

  // Append any photos that don't have specified ranges
  orderedResult.push(...withoutRanges);
  return orderedResult;
}

/**
 * Calculates a scroll ratio (0..1) for a sequence within a receipt photo.
 * If precise visual position (bbox / yRatio / positionAnchor) is available, uses it.
 * Otherwise, estimates based on sequence order within the photo:
 * - Single sequence: 0.15 (upper area)
 * - Multiple sequences: distributed from 0.15 (upper) to 0.85 (lower).
 *
 * All items belonging to the same sequence share the exact same anchor.
 */
function getSequenceScrollAnchor(seq, sIdx = 0, totalSeqsInPhoto = 1) {
  if (seq) {
    if (typeof seq.scrollAnchor === 'number' && Number.isFinite(seq.scrollAnchor)) {
      return Math.max(0, Math.min(1, seq.scrollAnchor));
    }
    if (typeof seq.yRatio === 'number' && Number.isFinite(seq.yRatio)) {
      return Math.max(0, Math.min(1, seq.yRatio));
    }
    if (typeof seq.positionAnchor === 'number' && Number.isFinite(seq.positionAnchor)) {
      return Math.max(0, Math.min(1, seq.positionAnchor));
    }
  }

  const total = Math.max(1, Number(totalSeqsInPhoto) || 1);
  const idx = Math.max(0, Number(sIdx) || 0);

  if (total <= 1) {
    return 0.15; // Upper area
  }
  if (total === 2) {
    return idx === 0 ? 0.20 : 0.70;
  }
  return 0.15 + (idx / (total - 1)) * 0.70;
}

/**
 * Resolves confirmed / reliable receipt sequence ranges against the actual imported items list.
 *
 * Rules:
 * 1. Normalize firstTrack and lastTrack (whitespace/case only, zero arithmetic, zero fuzzy replacement).
 * 2. Lookup exact matches in receiptItems.
 * 3. startIndex <= endIndex.
 * 4. actualQty = endIndex - startIndex + 1.
 * 5. If declared qty is present, actualQty must match declared qty.
 * 6. Conflict / Ambiguity protection:
 *    - Anchor missing -> CONFLICT (do not map)
 *    - Order reversed -> CONFLICT (do not map)
 *    - Duplicate exact barcode in actual items -> AMBIGUOUS_TRACK (do not map)
 *    - Overlapping / conflicting sequence ranges -> COLLISION (do not map)
 * 7. When resolved (STRONG):
 *    - Every item in [startIndex..endIndex] mapped to sequence's photoIndex, receiptSeqNo, and position anchor.
 *    - Marked with mappingSource = 'receipt-range'.
 *    - Preserves existing mappingSource === 'matcher' intact (never overwrites).
 *
 * @param {object[]} photos
 * @param {object[]} items
 * @returns {{ resolvedCount: number, mappedTrackCount: number, evaluatedSequences: object[] }}
 */
/**
 * Resolves confirmed / reliable receipt sequence ranges against the actual imported items list.
 *
 * SAFE RANGE RESOLUTION RULES (ACTUAL ARRAY INDEX ONLY):
 * - CASE 1: Exact First + Exact Last + Qty -> AUTO RESOLVE STRONG
 * - CASE 2: Exact First + Qty (printed Last not in Excel or nominal endpoint)
 *           -> startIndex through (startIndex + qty - 1) in Excel -> AUTO RESOLVE STRONG
 * - CASE 3: Exact Last + Qty (First not exact)
 *           -> (endIndex - qty + 1) through endIndex in Excel -> AUTO RESOLVE STRONG
 * - CASE 4: Single item (qty === 1 with unique exact anchor) -> AUTO RESOLVE STRONG
 *
 * CROSS-SEQUENCE & ADJACENCY VALIDATION:
 * - Order & Overlap validation: ranges cannot overlap or violate visual sequence order.
 * - Adjacency validation: consecutive sequences (e.g. Seq 1 ending at 48 and Seq 2 starting at 49)
 *   provide mutual boundary confirmation.
 * - Safety: Duplicate exact anchors, out-of-bounds slices, or missing quantities are marked NEEDS REVIEW.
 * - Audit Trail: Preserves printedFirstTrack & printedLastTrack; records resolvedLastTrack.
 *
 * @param {object[]} photos
 * @param {object[]} items
 * @returns {{ resolvedCount: number, mappedTrackCount: number, needsReviewCount: number, evaluatedSequences: object[] }}
 */
function resolveReceiptRanges(photos = state.photos, items = state.receiptItems) {
  if (!Array.isArray(photos) || photos.length === 0 || !Array.isArray(items) || items.length === 0) {
    return { resolvedCount: 0, mappedTrackCount: 0, needsReviewCount: 0, evaluatedSequences: [] };
  }

  const matcher = (typeof window !== 'undefined' && window.Matcher)
    ? window.Matcher
    : (typeof Matcher !== 'undefined' ? Matcher : (typeof require !== 'undefined' ? require('./matcher.js') : null));

  if (!matcher) {
    return { resolvedCount: 0, mappedTrackCount: 0, needsReviewCount: 0, evaluatedSequences: [] };
  }

  // 1. Build lookup index with duplicate detection (reuses matcher.buildTrackIndex)
  const { trackMap, apiTracks } = matcher.buildTrackIndex(items);

  // 2. Collect candidate sequences per photo (deduplicating between photo.sequences and photo.ocrSequenceSuggestions)
  const photoSeqGroups = [];
  photos.forEach((photo, pIdx) => {
    if (!photo) return;
    const seqs = [];
    const seenKeys = new Set();
    if (Array.isArray(photo.sequences)) {
      photo.sequences.forEach((s, idx) => {
        seqs.push({ ...s, _sIdx: idx, _source: 'photo.sequences', _origSeq: s });
        const key = s.id || `${s.seqNo}_${cleanTrackNo(s.firstTrack)}`;
        seenKeys.add(key);
      });
    }
    if (Array.isArray(photo.ocrSequenceSuggestions)) {
      photo.ocrSequenceSuggestions
        .filter(s => s && s.status !== 'rejected')
        .forEach((s, idx) => {
          const key = s.id || `${s.seqNo}_${cleanTrackNo(s.firstTrack)}`;
          if (!seenKeys.has(key)) {
            seqs.push({ ...s, _sIdx: idx, _source: 'ocrSequenceSuggestions', _origSeq: s });
            seenKeys.add(key);
          }
        });
    }
    if (seqs.length > 0) {
      photoSeqGroups.push({ photoIndex: pIdx, photo, sequences: seqs });
    }
  });

  // 3. Evaluate each candidate sequence under Safe Range Resolution Rules
  const evaluatedSequences = [];
  photoSeqGroups.forEach(({ photoIndex, photo, sequences }) => {
    const totalInPhoto = sequences.length;
    sequences.forEach((seq, sIdx) => {
      const normFirst = cleanTrackNo(seq.firstTrack);
      const normLast = cleanTrackNo(seq.lastTrack);
      const rawQty = seq.qty;
      const qty = (rawQty !== null && rawQty !== undefined && rawQty !== '') ? Number(rawQty) : null;
      const sSeqNo = (seq.seqNo !== null && seq.seqNo !== undefined && seq.seqNo !== '') ? Number(seq.seqNo) : null;
      const sRcpt = seq.rcptNo || photo.detectedRcpt || null;

      const printedFirstTrack = seq.printedFirstTrack || seq.firstTrack || null;
      const printedLastTrack = seq.printedLastTrack || seq.lastTrack || null;

      let confidence = 'needs_review';
      let conflictReason = null;
      let startIndex = null;
      let endIndex = null;
      let trackIndexes = [];
      let resolvedFirstTrack = null;
      let resolvedLastTrack = null;
      let resolutionCase = null;

      const firstEntry = normFirst ? trackMap.get(normFirst) : null;
      const lastEntry = normLast ? trackMap.get(normLast) : null;

      const firstAmbiguous = Boolean(firstEntry && firstEntry.AMBIGUOUS);
      const lastAmbiguous = Boolean(lastEntry && lastEntry.AMBIGUOUS);

      let effectiveFirstEntry = (firstEntry && !firstEntry.AMBIGUOUS) ? firstEntry : null;
      let effectiveLastEntry = (lastEntry && !lastEntry.AMBIGUOUS) ? lastEntry : null;
      let firstFromCandidate = false;
      let lastFromCandidate = false;

      // Excel-assisted candidate resolution for OCR typos (Strictly from actual items array, zero tracking arithmetic)
      if (!effectiveFirstEntry && !firstAmbiguous && normFirst) {
        const cand = seq.firstCandidate || (seq.reviewCandidate?.status ? seq.reviewCandidate : findApiTrackCandidate(normFirst, items));
        if (cand && cand.status === 'single_match' && cand.candidate) {
          const cEntry = trackMap.get(cand.candidate);
          if (cEntry && !cEntry.AMBIGUOUS) {
            effectiveFirstEntry = cEntry;
            firstFromCandidate = true;
          }
        }
      }

      if (!effectiveLastEntry && !lastAmbiguous && normLast) {
        const cand = seq.lastCandidate || findApiTrackCandidate(normLast, items);
        if (cand && cand.status === 'single_match' && cand.candidate) {
          const cEntry = trackMap.get(cand.candidate);
          if (cEntry && !cEntry.AMBIGUOUS) {
            effectiveLastEntry = cEntry;
            lastFromCandidate = true;
          }
        }
      }

      if (firstAmbiguous || lastAmbiguous) {
        confidence = 'conflict';
        conflictReason = 'duplicate / ambiguous tracking anchor in actual tracks';
      } else if (!effectiveFirstEntry && !effectiveLastEntry) {
        confidence = 'weak';
        conflictReason = 'neither firstTrack nor lastTrack found in actual tracks';
      } else {
        const isSingle = (effectiveFirstEntry && effectiveLastEntry && effectiveFirstEntry.trackNo === effectiveLastEntry.trackNo && (qty === 1 || qty === null))
          || (qty === 1 && (effectiveFirstEntry || effectiveLastEntry));

        if (isSingle) {
          // ── CASE 4: Single Item ──
          const idx = effectiveFirstEntry ? effectiveFirstEntry.apiIndex : effectiveLastEntry.apiIndex;
          startIndex = idx;
          endIndex = idx;
          trackIndexes = [idx];
          resolvedFirstTrack = apiTracks[idx].trackNo;
          resolvedLastTrack = apiTracks[idx].trackNo;
          confidence = 'strong';
          resolutionCase = (firstFromCandidate || lastFromCandidate) ? 'CASE 4 (Single Item - Excel Candidate)' : 'CASE 4 (Single Item)';
        } else if (effectiveFirstEntry && effectiveLastEntry && qty !== null && qty > 0) {
          // ── CASE 1: Exact First + Exact Last + Qty ──
          const sIdx = effectiveFirstEntry.apiIndex;
          const eIdx = effectiveLastEntry.apiIndex;
          if (sIdx > eIdx) {
            confidence = 'conflict';
            conflictReason = `reversed order: firstTrack index (${sIdx}) > lastTrack index (${eIdx})`;
          } else {
            const actualLen = eIdx - sIdx + 1;
            if (actualLen !== qty) {
              confidence = 'conflict';
              conflictReason = `qty mismatch: declared ${qty} but Excel slice is ${actualLen}`;
            } else {
              startIndex = sIdx;
              endIndex = eIdx;
              for (let i = sIdx; i <= eIdx; i++) trackIndexes.push(i);
              resolvedFirstTrack = apiTracks[sIdx].trackNo;
              resolvedLastTrack = apiTracks[eIdx].trackNo;
              confidence = 'strong';
              resolutionCase = (firstFromCandidate || lastFromCandidate) ? 'CASE 1 (Excel-assisted First + Last + Qty)' : 'CASE 1 (Exact First + Last + Qty)';
            }
          }
        } else if (effectiveFirstEntry && qty !== null && qty > 0) {
          // ── CASE 2: Exact First + Qty (printed Last not in Excel or nominal endpoint) ──
          const sIdx = effectiveFirstEntry.apiIndex;
          const targetEndIndex = sIdx + qty - 1;
          if (targetEndIndex >= items.length) {
            confidence = 'conflict';
            conflictReason = `out of bounds: startIndex (${sIdx}) + qty (${qty}) exceeds total items (${items.length})`;
          } else {
            startIndex = sIdx;
            endIndex = targetEndIndex;
            for (let i = sIdx; i <= targetEndIndex; i++) trackIndexes.push(i);
            resolvedFirstTrack = apiTracks[sIdx].trackNo;
            resolvedLastTrack = apiTracks[targetEndIndex].trackNo;
            confidence = 'strong';
            resolutionCase = firstFromCandidate ? 'CASE 2 (Excel-assisted First + Qty)' : 'CASE 2 (Exact First + Qty)';
          }
        } else if (effectiveLastEntry && qty !== null && qty > 0) {
          // ── CASE 3: Exact Last + Qty (First not exact) ──
          const eIdx = effectiveLastEntry.apiIndex;
          const targetStartIndex = eIdx - qty + 1;
          if (targetStartIndex < 0) {
            confidence = 'conflict';
            conflictReason = `out of bounds: endIndex (${eIdx}) - qty (${qty}) is negative`;
          } else {
            startIndex = targetStartIndex;
            endIndex = eIdx;
            for (let i = targetStartIndex; i <= eIdx; i++) trackIndexes.push(i);
            resolvedFirstTrack = apiTracks[targetStartIndex].trackNo;
            resolvedLastTrack = apiTracks[eIdx].trackNo;
            confidence = 'strong';
            resolutionCase = lastFromCandidate ? 'CASE 3 (Excel-assisted Last + Qty)' : 'CASE 3 (Exact Last + Qty)';
          }
        } else {
          confidence = 'needs_review';
          conflictReason = qty === null || qty <= 0 ? 'missing or invalid quantity' : 'incomplete track anchors';
        }
      }

      const anchor = getSequenceScrollAnchor(seq, sIdx, totalInPhoto);

      evaluatedSequences.push({
        photoIndex,
        photo,
        seqIndex: sIdx,
        seq,
        confidence,
        conflictReason,
        startIndex,
        endIndex,
        trackIndexes,
        resolvedFirstTrack,
        resolvedLastTrack,
        printedFirstTrack,
        printedLastTrack,
        resolutionCase,
        scrollAnchor: anchor,
        rcptNo: sRcpt,
        seqNo: sSeqNo,
        qty: qty || (trackIndexes.length > 0 ? trackIndexes.length : null)
      });
    });
  });

  // 4. Cross-Sequence Validation: Collision, Overlap & Order Check
  const claimedIndices = new Map();
  const collisionEntries = new Set();

  evaluatedSequences.forEach(entry => {
    if (entry.confidence === 'strong') {
      for (const trackIdx of entry.trackIndexes) {
        if (claimedIndices.has(trackIdx)) {
          const prevEntry = claimedIndices.get(trackIdx);
          collisionEntries.add(entry);
          collisionEntries.add(prevEntry);
          entry.confidence = 'conflict';
          entry.conflictReason = `overlapping range with Seq ${prevEntry.seqNo ?? '-'} at track index ${trackIdx}`;
          prevEntry.confidence = 'conflict';
          prevEntry.conflictReason = `overlapping range with Seq ${entry.seqNo ?? '-'} at track index ${trackIdx}`;
        }
      }
      if (!collisionEntries.has(entry)) {
        entry.trackIndexes.forEach(trackIdx => claimedIndices.set(trackIdx, entry));
      }
    }
  });

  // Check sequence order & adjacency across photos
  const allStrong = evaluatedSequences
    .filter(e => e.confidence === 'strong')
    .sort((a, b) => (a.photoIndex !== b.photoIndex ? a.photoIndex - b.photoIndex : a.seqIndex - b.seqIndex));

  for (let i = 0; i < allStrong.length - 1; i++) {
    const cur = allStrong[i];
    const nxt = allStrong[i + 1];
    if (cur.startIndex > nxt.startIndex) {
      cur.confidence = 'conflict';
      cur.conflictReason = `order conflict: startIndex (${cur.startIndex}) > following sequence startIndex (${nxt.startIndex})`;
      nxt.confidence = 'conflict';
      nxt.conflictReason = `order conflict: startIndex (${nxt.startIndex}) < preceding sequence startIndex (${cur.startIndex})`;
    } else if (cur.endIndex + 1 === nxt.startIndex) {
      cur.isAdjacentValidated = true;
      nxt.isAdjacentValidated = true;
    }
  }

  // 5. Apply STRONG non-conflicting ranges to items
  let resolvedCount = 0;
  let mappedTrackCount = 0;
  let needsReviewCount = 0;

  evaluatedSequences.forEach(entry => {
    if (entry.confidence === 'strong') {
      resolvedCount++;
      entry.trackIndexes.forEach(trackIdx => {
        const item = items[trackIdx];
        if (item) {
          // Rule: Never overwrite user-confirmed matcher mapping
          if (item.mappingSource === 'matcher') {
            return;
          }
          item.photoIndex = entry.photoIndex;
          item.receiptSeqNo = entry.seqNo;
          item.receiptSequenceId = entry.seq.id || (entry.rcptNo ? `${entry.rcptNo}:${entry.seqNo}` : `seq_${entry.photoIndex}_${entry.seqIndex}`);
          item.rcptNo = entry.rcptNo;
          item.mappingSource = 'receipt-range';
          item.scrollAnchor = entry.scrollAnchor;
          mappedTrackCount++;
        }
      });

      // Update sequence properties for audit trail
      const targetSeq = entry.seq?._origSeq || entry.seq;
      if (targetSeq) {
        targetSeq.printedFirstTrack = entry.printedFirstTrack;
        targetSeq.printedLastTrack = entry.printedLastTrack;
        targetSeq.resolvedFirstTrack = entry.resolvedFirstTrack;
        targetSeq.resolvedLastTrack = entry.resolvedLastTrack;
        targetSeq.autoResolved = true;
        targetSeq.mappingConfidence = 'strong';
        if (entry.seq?._source === 'ocrSequenceSuggestions') {
          targetSeq.status = 'auto_resolved';
          targetSeq.firstTrack = entry.resolvedFirstTrack;
          targetSeq.lastTrack = entry.resolvedLastTrack;
        }
      }
    } else {
      needsReviewCount++;
      const targetSeq = entry.seq?._origSeq || entry.seq;
      if (targetSeq) {
        targetSeq.autoResolved = false;
        targetSeq.mappingConfidence = entry.confidence;
        targetSeq.mappingConflictReason = entry.conflictReason;
        if (targetSeq.status === 'auto_resolved') {
          targetSeq.status = 'pending';
        }
      }
    }
  });

  return {
    resolvedCount,
    mappedTrackCount,
    needsReviewCount,
    evaluatedSequences
  };
}

function getTrackServicePrefix(trackNo) {
  if (!trackNo || typeof trackNo !== 'string') return '';
  const clean = cleanTrackNo(trackNo);
  return clean ? clean.slice(0, 2).toUpperCase() : '';
}

function getPhotoServicePrefix(photo) {
  if (!photo) return null;
  const seqs = [
    ...(Array.isArray(photo.sequences) ? photo.sequences : []),
    ...(Array.isArray(photo.ocrSequenceSuggestions) ? photo.ocrSequenceSuggestions : [])
  ];
  for (const s of seqs) {
    const t = s.firstTrack || s.lastTrack;
    if (t) {
      const clean = cleanTrackNo(t);
      if (clean && clean.length >= 2) {
        return clean.slice(0, 2).toUpperCase();
      }
    }
  }
  const label = String(photo.label || photo.name || '');
  if (/RR|inter/i.test(label)) return 'RR';
  if (/RJ|domestic|ในประเทศ/i.test(label)) return 'RJ';
  return null;
}

function alignReceiptItemsToPhotos() {
  // Sort receipt items strictly by their sequence no
  state.receiptItems = state.receiptItems
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => (Number(a.item.no) || a.originalIndex + 1) - (Number(b.item.no) || b.originalIndex + 1))
    .map(entry => entry.item);

  const totalPhotos = state.photos.length;
  if (totalPhotos === 0 || state.receiptItems.length === 0) return;

  // 1. Resolve confirmed / reliable receipt ranges
  resolveReceiptRanges(state.photos, state.receiptItems);

  // 2. Check which items still need fallback mapping
  const unmappedItems = state.receiptItems.filter(item =>
    item.mappingSource !== 'matcher' && item.mappingSource !== 'receipt-range'
  );

  if (unmappedItems.length > 0) {
    const hasConfiguredRanges = state.photos.some(p => Number.isFinite(p.startNo) && Number.isFinite(p.endNo));

    if (hasConfiguredRanges) {
      unmappedItems.forEach(item => {
        const itemSeq = Number(item.no);
        const itemPrefix = getTrackServicePrefix(item.trackNo || item.barcode);
        let matchedIndex = -1;
        let alternateIndex = -1;

        for (let pIdx = 0; pIdx < state.photos.length; pIdx++) {
          const photo = state.photos[pIdx];
          if (Number.isFinite(photo.startNo) && Number.isFinite(photo.endNo)) {
            // Guard: service prefix consistency (do not cross RJ and RR)
            const pPrefix = getPhotoServicePrefix(photo);
            if (pPrefix && itemPrefix && pPrefix !== itemPrefix) {
              continue;
            }
            if (itemSeq >= photo.startNo && itemSeq <= photo.endNo) {
              if (matchedIndex === -1) {
                matchedIndex = pIdx;
              } else {
                alternateIndex = pIdx;
              }
            }
          }
        }

        if (matchedIndex !== -1) {
          item.photoIndex = matchedIndex;
          if (alternateIndex !== -1) {
            item.alternatePhotoIndex = alternateIndex;
          } else {
            delete item.alternatePhotoIndex;
          }
          item.mappingSource = 'estimated';
        } else {
          item.photoIndex = null;
          item.mappingSource = null;
        }
        delete item.scrollAnchor;
      });
    } else {
      const hasVerifiedRanges = state.receiptItems.some(it => it.mappingSource === 'matcher' || it.mappingSource === 'receipt-range');
      if (hasVerifiedRanges) {
        // In a verified receipt workflow, DO NOT blindly allocate unmapped items to arbitrary photos!
        // Unmapped items remain unmapped until their corresponding photo is scanned/configured.
        unmappedItems.forEach(item => {
          item.photoIndex = null;
          item.mappingSource = null;
          delete item.scrollAnchor;
        });
      } else {
        const totalItems = state.receiptItems.length;
        state.receiptItems.forEach((item, index) => {
          if (item.mappingSource === 'matcher' || item.mappingSource === 'receipt-range') {
            return;
          }
          item.photoIndex = totalPhotos > 0
            ? Math.min(totalPhotos - 1, Math.floor(index * totalPhotos / Math.max(1, totalItems)))
            : 0;
          item.mappingSource = 'estimated';
          delete item.scrollAnchor;
        });
      }
    }
  }

  // 3. Auto assign startNo and endNo to photos from items if not configured
  const hasConfiguredRanges = state.photos.some(p => Number.isFinite(p.startNo) && Number.isFinite(p.endNo));
  if (!hasConfiguredRanges) {
    state.photos.forEach(p => { delete p.startNo; delete p.endNo; });
    state.receiptItems.forEach(item => {
      if (typeof item.photoIndex !== 'number') return;
      const photo = state.photos[item.photoIndex];
      if (photo) {
        if (!photo.startNo || item.no < photo.startNo) photo.startNo = item.no;
        if (!photo.endNo || item.no > photo.endNo) photo.endNo = item.no;
      }
    });
  }

  if (state.receiptItems.length > 0 && !state.activeItemNo) {
    state.activeItemNo = state.receiptItems[0].no;
  }
}

const HISTORY_DB_NAME = 'thp_receipt_matcher_history';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE_NAME = 'sessions';
const HISTORY_LIMIT = 30;
let historyDbPromise = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function openHistoryDb() {
  if (historyDbPromise) return historyDbPromise;

  historyDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        const store = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('เปิดฐานข้อมูลประวัติไม่สำเร็จ'));
  });

  return historyDbPromise;
}

async function getAllHistory() {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HISTORY_STORE_NAME, 'readonly')
      .objectStore(HISTORY_STORE_NAME).getAll();
    request.onsuccess = () => {
      const records = request.result || [];
      records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getHistoryById(id) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HISTORY_STORE_NAME, 'readonly')
      .objectStore(HISTORY_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function putHistory(record) {
  const db = await openHistoryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    tx.objectStore(HISTORY_STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('บันทึกประวัติไม่สำเร็จ'));
  });
  await trimHistory();
}

async function deleteHistoryById(id) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    tx.objectStore(HISTORY_STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function trimHistory() {
  const records = await getAllHistory();
  const overflow = records.slice(HISTORY_LIMIT);
  if (overflow.length === 0) return;
  const db = await openHistoryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    overflow.forEach(record => tx.objectStore(HISTORY_STORE_NAME).delete(record.id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function hasCurrentWork() {
  const trInput = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('trNumberInput') : null;
  const hasTr = trInput && typeof trInput.value === 'string' && trInput.value.trim().length > 0;
  return state.receiptItems.length > 0 || state.excelMap.size > 0 || state.photos.length > 0 || Boolean(hasTr);
}

async function serializePhotosForStorage() {
  const photos = [];
  for (const photo of state.photos) {
    let storedFile = photo.file;
    if (typeof storedFile === 'string' && storedFile.startsWith('blob:')) {
      storedFile = await fetch(storedFile).then(response => response.blob());
    }
    photos.push({ ...photo, file: storedFile });
  }
  return photos;
}

function hydratePhotos(photos) {
  return (photos || []).map(photo => {
    const hydrated = { ...photo };
    if (hydrated.file instanceof Blob) {
      hydrated.file = URL.createObjectURL(hydrated.file);
      hydrated.isUserUploaded = true;
    }
    if (!Array.isArray(hydrated.sequences)) {
      hydrated.sequences = [];
    }
    if (!Array.isArray(hydrated.ocrSequenceSuggestions)) {
      hydrated.ocrSequenceSuggestions = [];
    }
    return hydrated;
  });
}

function getSessionStats(receiptItems, excelEntries) {
  const excelMap = new Map(excelEntries || []);
  let matched = 0;
  let delivered = 0;
  (receiptItems || []).forEach(item => {
    const track = cleanTrackNo(item.trackNo);
    const excel = excelMap.get(track);
    if (excel) matched++;
    if (excel?.statusType === 'success') delivered++;
  });
  return { total: (receiptItems || []).length, matched, delivered };
}

let autoSaveTimer = null;
const AUTOSAVE_DELAY_MS = 800;

function updateAutoSaveIndicator(status) {
  const indicator = document.getElementById('autoSaveIndicator');
  const icon = document.getElementById('autoSaveIcon');
  const text = document.getElementById('autoSaveText');
  if (!indicator || !icon || !text) return;

  if (status === 'saving') {
    indicator.classList.remove('hidden');
    icon.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
    text.textContent = 'กำลังบันทึก...';
    text.className = 'text-amber-700 font-medium';
  } else if (status === 'saved') {
    indicator.classList.remove('hidden');
    icon.className = 'w-2 h-2 rounded-full bg-emerald-500';
    text.textContent = 'บันทึกอัตโนมัติแล้ว ✓';
    text.className = 'text-emerald-700 font-medium';
  } else if (status === 'error') {
    indicator.classList.remove('hidden');
    icon.className = 'w-2 h-2 rounded-full bg-rose-500';
    text.textContent = 'บันทึกไม่สำเร็จ';
    text.className = 'text-rose-700 font-medium';
  } else if (status === 'idle') {
    // Keep visible if there is saved work
    if (hasCurrentWork()) {
      indicator.classList.remove('hidden');
      icon.className = 'w-2 h-2 rounded-full bg-slate-400';
      text.textContent = 'บันทึกแล้ว';
      text.className = 'text-slate-500';
    } else {
      indicator.classList.add('hidden');
    }
  }
}

function triggerAutoSave() {
  if (!hasCurrentWork()) return;
  updateAutoSaveIndicator('saving');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      await saveCurrentSession({ silent: true });
      updateAutoSaveIndicator('saved');
    } catch (err) {
      console.error('AutoSave error:', err);
      updateAutoSaveIndicator('error');
    }
  }, AUTOSAVE_DELAY_MS);
}

async function saveCurrentSession({ silent = false } = {}) {
  if (!hasCurrentWork()) {
    if (!silent) alert('ยังไม่มีข้อมูลงานสำหรับบันทึก');
    return false;
  }

  const now = new Date().toISOString();
  const trNumber = document.getElementById('trNumberInput').value.trim();
  const existing = state.currentSessionId ? await getHistoryById(state.currentSessionId) : null;
  const id = state.currentSessionId || crypto.randomUUID();
  const excelEntries = Array.from(state.excelMap.entries());
  const receiptItems = JSON.parse(JSON.stringify(state.receiptItems));
  const firstTrack = receiptItems[0]?.trackNo || '';
  const title = trNumber ? `TR ${state.defaultZipPrefix}|${trNumber}` :
    (firstTrack ? `งาน ${firstTrack}` : `งานวันที่ ${new Date().toLocaleDateString('th-TH')}`);

  const record = {
    id,
    version: 1,
    title,
    trNumber,
    zipPrefix: state.defaultZipPrefix,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    receiptItems,
    excelEntries,
    photos: await serializePhotosForStorage(),
    stats: getSessionStats(receiptItems, excelEntries),
    matcherAppliedSignature: state.matcherAppliedSignature || null,
    matcherApplyInfo: state.matcherApplyInfo || null
  };

  await putHistory(record);
  state.currentSessionId = id;
  localStorage.setItem('thp_latest_session_id', id);
  if (!silent) alert('บันทึกงานลงประวัติในเครื่องเรียบร้อยแล้ว');
  return true;
}

async function restoreHistory(id) {
  const record = await getHistoryById(id);
  if (!record) {
    alert('ไม่พบประวัติงานนี้ อาจถูกลบไปแล้ว');
    return;
  }

  if (hasCurrentWork() && state.currentSessionId !== id) {
    const proceed = confirm('การเรียกคืนจะเปลี่ยนงานที่กำลังแสดง\nต้องการบันทึกงานปัจจุบันก่อนหรือไม่?');
    if (proceed) await saveCurrentSession({ silent: true });
  }

  revokeUserPhotoUrls();
  state.currentSessionId = record.id;
  localStorage.setItem('thp_latest_session_id', record.id);
  state.receiptItems = JSON.parse(JSON.stringify(record.receiptItems || []));
  state.excelMap = new Map(record.excelEntries || []);
  state.photos = hydratePhotos(record.photos || []);
  state.matcherAppliedSignature = record.matcherAppliedSignature || null;
  state.matcherApplyInfo = record.matcherApplyInfo || null;
  state.lastPreApplySnapshot = null;
  state.activeItemNo = state.receiptItems[0]?.no || 1;
  state.activePhotoIndex = 0;
  state.currentFilter = 'all';
  state.searchQuery = '';
  state.zoom = 1;
  state.rotation = 0;

  if (record.zipPrefix) {
    state.defaultZipPrefix = record.zipPrefix;
    document.getElementById('labelZipPrefix').textContent = '(' + record.zipPrefix + ')';
    document.getElementById('apiZipPrefixInput').value = record.zipPrefix;
  }
  document.getElementById('trNumberInput').value = record.trNumber || '';
  document.getElementById('searchInput').value = '';
  document.getElementById('zoomLevelIndicator').textContent = '100%';

  renderPhotoTabs();
  renderItems();
  updateStats();
  if (state.photos.length > 0) {
    state.photos.forEach(p => validatePhotoTRIdentity(p));
    switchPhoto(0, false);
  } else {
    showEmptyPhotoState();
  }
  updatePhotoIdentityBadge();
  document.getElementById('historyModal').classList.add('hidden');
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function historySearchText(record) {
  const itemText = (record.receiptItems || [])
    .map(item => `${item.trackNo || ''} ${item.recipient || ''} ${item.destinationName || ''}`).join(' ');
  return `${record.title || ''} ${record.trNumber || ''} ${itemText}`.toLowerCase();
}

async function renderHistoryList() {
  const container = document.getElementById('historyList');
  const query = document.getElementById('historySearchInput').value.trim().toLowerCase();
  const allRecords = await getAllHistory();
  const records = query ? allRecords.filter(record => historySearchText(record).includes(query)) : allRecords;

  document.getElementById('historyCountLabel').textContent = `${allRecords.length}/${HISTORY_LIMIT} งาน`;
  if (records.length === 0) {
    container.innerHTML = `
      <div class="text-center py-10 text-slate-400 border border-dashed border-slate-300 rounded-xl">
        <i class="fa-solid fa-box-archive text-3xl text-slate-300 mb-2"></i>
        <p class="text-xs font-medium">${allRecords.length === 0 ? 'ยังไม่มีประวัติงาน' : 'ไม่พบประวัติที่ค้นหา'}</p>
      </div>`;
    return;
  }

  container.innerHTML = records.map(record => {
    const stats = record.stats || getSessionStats(record.receiptItems, record.excelEntries);
    const activeClass = state.currentSessionId === record.id ? 'border-violet-400 bg-violet-50/50' : 'border-slate-200 bg-white';
    return `
      <article class="border ${activeClass} rounded-xl p-3 shadow-xs" data-history-id="${escapeHtml(record.id)}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(record.title || 'งานไม่มีชื่อ')}</h4>
            <p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatHistoryDate(record.updatedAt))}</p>
          </div>
          <div class="flex gap-1 shrink-0">
            <button data-history-action="restore" class="px-2.5 py-1.5 text-[11px] font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg">
              <i class="fa-solid fa-rotate-left"></i> เรียกคืน
            </button>
            <button data-history-action="delete" class="px-2 py-1.5 text-[11px] text-red-600 hover:bg-red-50 rounded-lg" title="ลบประวัตินี้">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-2 text-center">
          <div class="bg-slate-50 rounded-lg py-1.5"><strong class="block text-xs text-slate-800">${stats.total || 0}</strong><span class="text-[9px] text-slate-500">รายการ</span></div>
          <div class="bg-blue-50 rounded-lg py-1.5"><strong class="block text-xs text-blue-700">${stats.matched || 0}</strong><span class="text-[9px] text-blue-600">จับคู่</span></div>
          <div class="bg-emerald-50 rounded-lg py-1.5"><strong class="block text-xs text-emerald-700">${stats.delivered || 0}</strong><span class="text-[9px] text-emerald-600">ส่งแล้ว</span></div>
        </div>
      </article>`;
  }).join('');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function updateHistoryStorageInfo() {
  const label = document.getElementById('historyStorageInfo');
  if (!navigator.storage?.estimate) {
    label.textContent = 'ประวัติเก็บอยู่ในเบราว์เซอร์เครื่องนี้';
    return;
  }
  const estimate = await navigator.storage.estimate();
  label.textContent = `ใช้พื้นที่ประมาณ ${formatBytes(estimate.usage)} จาก ${formatBytes(estimate.quota)}`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function exportHistory() {
  const records = await getAllHistory();
  if (records.length === 0) {
    alert('ยังไม่มีประวัติสำหรับส่งออก');
    return;
  }
  const exported = [];
  for (const record of records) {
    const photos = [];
    for (const photo of record.photos || []) {
      photos.push({ ...photo, file: photo.file instanceof Blob ? await blobToDataUrl(photo.file) : photo.file });
    }
    exported.push({ ...record, photos });
  }
  const payload = JSON.stringify({ app: 'thp-receipt-matcher', version: 1, exportedAt: new Date().toISOString(), sessions: exported });
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `thp-receipt-history-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importHistoryFile(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'thp-receipt-matcher' || !Array.isArray(data.sessions)) {
    throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง');
  }
  for (const source of data.sessions.slice(0, HISTORY_LIMIT)) {
    if (!source || !Array.isArray(source.receiptItems) || !Array.isArray(source.excelEntries)) continue;
    const now = new Date().toISOString();
    await putHistory({
      ...source,
      id: source.id || crypto.randomUUID(),
      version: 1,
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || now,
      photos: Array.isArray(source.photos) ? source.photos : [],
      stats: getSessionStats(source.receiptItems, source.excelEntries)
    });
  }
}

function setupHistory() {
  const modal = document.getElementById('historyModal');
  document.getElementById('btnSaveHistory').onclick = async () => {
    try {
      await saveCurrentSession();
    } catch (error) {
      alert('บันทึกประวัติไม่สำเร็จ: ' + error.message);
    }
  };
  document.getElementById('btnOpenHistory').onclick = async () => {
    modal.classList.remove('hidden');
    try {
      await Promise.all([renderHistoryList(), updateHistoryStorageInfo()]);
    } catch (error) {
      alert('เปิดประวัติไม่สำเร็จ: ' + error.message);
    }
  };
  document.getElementById('btnCloseHistory').onclick = () => modal.classList.add('hidden');
  document.getElementById('historySearchInput').oninput = () => renderHistoryList();
  document.getElementById('historyList').onclick = async event => {
    const button = event.target.closest('[data-history-action]');
    const card = event.target.closest('[data-history-id]');
    if (!button || !card) return;
    const id = card.getAttribute('data-history-id');
    try {
      if (button.getAttribute('data-history-action') === 'restore') {
        await restoreHistory(id);
      } else if (confirm('ต้องการลบประวัติงานนี้ถาวรหรือไม่?')) {
        await deleteHistoryById(id);
        if (state.currentSessionId === id) state.currentSessionId = null;
        await renderHistoryList();
        await updateHistoryStorageInfo();
      }
    } catch (error) {
      alert('จัดการประวัติไม่สำเร็จ: ' + error.message);
    }
  };
  document.getElementById('btnExportHistory').onclick = async () => {
    try { await exportHistory(); }
    catch (error) { alert('ส่งออกประวัติไม่สำเร็จ: ' + error.message); }
  };
  document.getElementById('historyImportInput').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importHistoryFile(file);
      await renderHistoryList();
      await updateHistoryStorageInfo();
      alert('นำเข้าประวัติเรียบร้อยแล้ว');
    } catch (error) {
      alert('นำเข้าประวัติไม่สำเร็จ: ' + error.message);
    } finally {
      event.target.value = '';
    }
  };
}

// ----------------------------------------------------
// PAGE SEQUENCE & ORDER MANAGER UI
// ----------------------------------------------------
function setupPageManager() {
  const modal = document.getElementById('pageManageModal');
  const btnManage = document.getElementById('btnManagePages');
  const btnClose = document.getElementById('btnClosePageManage');
  const btnCancel = document.getElementById('btnCancelPageManage');
  const btnSave = document.getElementById('btnSavePageManage');
  const btnAutoChain = document.getElementById('btnAutoChainPages');

  if (!btnManage || !modal) return;

  btnManage.onclick = () => {
    if (state.photos.length === 0) {
      alert('ยังไม่มีรูปภาพใบเสร็จให้จัดการ กรุณาอัปโหลดรูปภาพก่อน');
      return;
    }
    renderPageManageList();
    modal.classList.remove('hidden');
  };

  const closeModal = () => modal.classList.add('hidden');
  btnClose.onclick = closeModal;
  btnCancel.onclick = closeModal;

  btnAutoChain.onclick = () => {
    // Read current inputs from the modal into temp photos
    const cards = document.querySelectorAll('#pageManageList > .page-manage-card');
    cards.forEach(row => {
      const idx = parseInt(row.getAttribute('data-page-index'), 10);
      const startVal = parseInt(row.querySelector('.input-page-start')?.value, 10);
      const endVal = parseInt(row.querySelector('.input-page-end')?.value, 10);
      if (state.photos[idx]) {
        state.photos[idx].startNo = Number.isFinite(startVal) ? startVal : undefined;
        state.photos[idx].endNo = Number.isFinite(endVal) ? endVal : undefined;
      }
    });

    state.photos = chainReceiptPhotosBySequence(state.photos);
    renderPageManageList();
  };

  btnSave.onclick = () => {
    const cards = document.querySelectorAll('#pageManageList > .page-manage-card');
    cards.forEach(row => {
      const idx = parseInt(row.getAttribute('data-page-index'), 10);
      const startVal = parseInt(row.querySelector('.input-page-start')?.value, 10);
      const endVal = parseInt(row.querySelector('.input-page-end')?.value, 10);
      const trVal = row.querySelector('.input-page-tr')?.value.trim();
      const rcptVal = row.querySelector('.input-page-rcpt')?.value.trim();

      if (state.photos[idx]) {
        state.photos[idx].startNo = Number.isFinite(startVal) && startVal > 0 ? startVal : undefined;
        state.photos[idx].endNo = Number.isFinite(endVal) && endVal > 0 ? endVal : undefined;
        if (trVal) {
          state.photos[idx].detectedTR = trVal;
          state.photos[idx].userConfirmed = true;
          validatePhotoTRIdentity(state.photos[idx]);
        }
        if (rcptVal) {
          state.photos[idx].detectedRcpt = rcptVal;
          state.photos[idx].userConfirmed = true;
        }

        // Collect manual sequence rows for this photo (Phase 2A)
        const seqRows = row.querySelectorAll('[data-seq-row]');
        const photoSeqs = [];
        seqRows.forEach(sRow => {
          const sNo = parseInt(sRow.querySelector('.input-seq-no')?.value, 10);
          const fTrack = cleanTrackNo(sRow.querySelector('.input-seq-first')?.value);
          let lTrack = cleanTrackNo(sRow.querySelector('.input-seq-last')?.value);
          let qVal = parseInt(sRow.querySelector('.input-seq-qty')?.value, 10);

          // Support single track normalization (Step 4)
          if (fTrack && (!lTrack || lTrack === fTrack)) {
            lTrack = fTrack;
            if (!qVal) qVal = 1;
          }

          if (Number.isFinite(sNo) || fTrack || lTrack) {
            photoSeqs.push({
              rcptNo: rcptVal || state.photos[idx].detectedRcpt || null,
              seqNo: Number.isFinite(sNo) ? sNo : null,
              firstTrack: fTrack || null,
              lastTrack: lTrack || null,
              qty: Number.isFinite(qVal) ? qVal : null,
              fieldSources: {
                rcptNo: 'manual',
                seqNo: 'manual',
                firstTrack: 'manual',
                lastTrack: 'manual',
                qty: 'manual'
              }
            });
          }
        });
        state.photos[idx].sequences = photoSeqs;
      }
    });

    alignReceiptItemsToPhotos();
    updatePhotoIdentityBadge();
    renderPhotoTabs();
    renderItems();
    triggerAutoSave();

    // Trigger shadow validation with updated evidence
    if (typeof window !== 'undefined' && window.Matcher) {
      try {
        const paperEvidence = buildMatcherPaperEvidence(state.photos);
        runMatcherShadowValidation(state.receiptItems, paperEvidence);
      } catch (err) {
        console.warn('[Matcher Shadow Error]', err);
      }
    }

    closeModal();
    alert('บันทึกการจัดลำดับหน้าและหลักฐานใบเสร็จเรียบร้อยแล้ว');
  };
}

/**
 * Evaluates validation status of a single sequence row against the track index
 * and checks for duplicate identity (rcptNo:seqNo).
 */
function evaluateSequenceValidation(seq, rcptNo, allSeqs, apiItems = null) {
  const normFirst = cleanTrackNo(seq.firstTrack);
  let normLast = cleanTrackNo(seq.lastTrack);
  const seqNo = Number(seq.seqNo);
  const isSingle = normFirst && (!normLast || normLast === normFirst);
  const hasExplicitQty = seq.qty !== null && seq.qty !== undefined && seq.qty !== '' && Number(seq.qty) > 0;
  let qty = hasExplicitQty ? Number(seq.qty) : (isSingle ? 1 : null);

  if (isSingle) {
    normLast = normFirst;
  }

  // 1. Check Duplicate Identity (same rcptNo + same seqNo)
  if (rcptNo && Number.isFinite(seqNo)) {
    const matchingDuplicates = (allSeqs || []).filter(item => {
      const itemRcpt = String(item.rcptNo || '').trim();
      const itemSeqNo = Number(item.seqNo);
      return itemRcpt === String(rcptNo).trim() && itemSeqNo === seqNo;
    });
    if (matchingDuplicates.length > 1) {
      return {
        status: 'conflict',
        badge: '! DUPLICATE',
        badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
        reasonText: `DUPLICATE / NEEDS REVIEW: เลข Seq ${seqNo} ซ้ำกันใน RCPT# ${rcptNo}`
      };
    }
  }

  // 2. Check completeness
  if (!normFirst && !normLast) {
    return {
      status: 'weak',
      badge: '- รอข้อมูล',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
      reasonText: 'ยังไม่ได้ระบุ Track Anchor'
    };
  }

  // 3. Match against API items if available
  const targetItems = Array.isArray(apiItems)
    ? apiItems
    : (typeof state !== 'undefined' && Array.isArray(state?.receiptItems) ? state.receiptItems : []);
  const hasApiItems = targetItems.length > 0;
  if (!hasApiItems) {
    return {
      status: 'pending',
      badge: 'รอ API',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      reasonText: 'ระบุหลักฐานแล้ว — กด "ดึง TR" เพื่อเทียบกับ API'
    };
  }

  // Range-specific validations when normFirst !== normLast
  if (!isSingle && normFirst && normLast) {
    if (qty === null) {
      const rangeReview = evaluateExcelRangeReview(seq, targetItems);
      if (rangeReview && rangeReview.status === 'qty_suggested') {
        return {
          status: 'conflict',
          badge: '✕ CONFLICT',
          badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
          reasonText: `✕ ยังไม่ระบุจำนวน Qty (Excel ช่วงนี้มี ${rangeReview.expectedQty} รายการ)`
        };
      }
      return {
        status: 'conflict',
        badge: '✕ CONFLICT',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        reasonText: '✕ ยังไม่ได้ระบุจำนวน (Qty) สำหรับช่วงพัสดุ'
      };
    }

    const rangeReview = evaluateExcelRangeReview({ ...seq, qty }, targetItems);
    if (rangeReview && rangeReview.status === 'conflict') {
      return {
        status: 'conflict',
        badge: '✕ CONFLICT',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        reasonText: `✕ ${rangeReview.reason}`
      };
    }
  }

  // Pure match evaluation via Matcher engine
  const matcher = (typeof window !== 'undefined' && window.Matcher)
    ? window.Matcher
    : (typeof Matcher !== 'undefined' ? Matcher : (typeof require !== 'undefined' ? require('./matcher.js') : null));

  if (matcher) {
    const { trackMap, apiTracks } = matcher.buildTrackIndex(targetItems);
    const mockSeq = {
      rcptNo: rcptNo || null,
      seqNo: Number.isFinite(seqNo) ? seqNo : null,
      firstTrack: normFirst || null,
      lastTrack: normLast || null,
      qty: qty
    };
    const matched = matcher.matchSequence(mockSeq, trackMap, apiTracks);

    if (matched.confidence === matcher.MATCH_CONFIDENCE.STRONG) {
      const isSingle = normFirst === normLast && qty === 1;
      return {
        status: 'strong',
        badge: '✓ STRONG',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        reasonText: isSingle ? '✓ พบ Track ใน API ตรงกัน 1 รายการ' : `✓ พบ First/Last Track และ Qty ตรง ${matched.matchedTracks.length} รายการ`
      };
    } else if (matched.confidence === matcher.MATCH_CONFIDENCE.MEDIUM) {
      return {
        status: 'medium',
        badge: '⚠ MEDIUM',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        reasonText: matched.conflictReason || '⚠ พบเฉพาะ First Track (ยังไม่ครบช่วง)'
      };
    } else if (matched.confidence === matcher.MATCH_CONFIDENCE.CONFLICT) {
      return {
        status: 'conflict',
        badge: '✕ CONFLICT',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        reasonText: matched.conflictReason || '✕ ข้อมูลขัดแย้งกับรายการ API'
      };
    } else {
      return {
        status: 'weak',
        badge: '- ไม่สมบูรณ์',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
        reasonText: matched.conflictReason || 'ยังระบุข้อมูลไม่ครบถ้วน'
      };
    }
  }

  return {
    status: 'pending',
    badge: 'พร้อมตรวจ',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    reasonText: 'พร้อมส่งเข้า Matcher'
  };
}

function renderPageManageList() {
  const container = document.getElementById('pageManageList');
  if (!container) return;

  // Evaluate Matcher Apply Plan and Stale State
  const applyPlan = buildMatcherApplyPlan(state.photos, state.receiptItems);
  const isStale = isMatcherMappingStale(state.photos, state.matcherAppliedSignature);

  // Flatten all sequences across photos for duplicate detection
  const allSeqs = [];
  state.photos.forEach(p => {
    const rcpt = String(p.detectedRcpt || '').trim();
    (p.sequences || []).forEach(s => {
      allSeqs.push({ ...s, rcptNo: s.rcptNo || rcpt });
    });
  });

  const matcherBannerHtml = `
    <div class="p-3 bg-white border ${applyPlan.conflictCount > 0 ? 'border-rose-300 bg-rose-50/30' : (applyPlan.isEligible ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200')} rounded-xl mb-3 shadow-xs" id="matcherApplyBanner">
      <div class="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <i class="fa-solid fa-wand-magic-sparkles text-sm ${applyPlan.conflictCount > 0 ? 'text-rose-600' : 'text-emerald-600'}"></i>
            <h4 class="text-xs font-bold text-slate-800">จับคู่รูปใบเสร็จกับพัสดุ (Matcher Supervised Apply)</h4>
            ${applyPlan.conflictCount > 0 ? `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                ✕ ขัดแย้ง ${applyPlan.conflictCount} รายการ
              </span>
            ` : (isStale ? `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                ⚠️ หลักฐานเปลี่ยน — กรุณากด Apply ใหม่
              </span>
            ` : (state.matcherAppliedSignature ? `
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                ✓ ใช้งานการจับคู่แล้ว (${state.matcherApplyInfo?.mappedCount || applyPlan.readyCount} รายการ)
              </span>
            ` : ''))}
          </div>
          <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-600 flex-wrap">
            <span>พร้อมจับคู่: <strong class="font-mono text-emerald-700">${applyPlan.readyCount}</strong> / ${applyPlan.totalApiCount} รายการ</span>
            ${applyPlan.conflictCount > 0 ? `<span class="text-rose-600 font-semibold">• ต้องแก้ไขข้อขัดแย้ง: <strong>${applyPlan.conflictCount}</strong></span>` : ''}
            ${applyPlan.incompleteCount > 0 ? `<span class="text-amber-700">• รอข้อมูลเพิ่มเติม: <strong>${applyPlan.incompleteCount}</strong></span>` : ''}
            ${applyPlan.unmappedCount > 0 && applyPlan.conflictCount === 0 ? `<span class="text-slate-400">• ยังไม่ระบุหลักฐาน: <strong>${applyPlan.unmappedCount}</strong></span>` : ''}
          </div>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <button type="button" id="btnApplyMatcherMapping"
                  class="btn-apply-matcher px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-xs ${
                    applyPlan.readyCount > 0 && applyPlan.conflictCount === 0
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed pointer-events-none'
                  }"
                  title="${applyPlan.conflictCount > 0 ? 'มีข้อขัดแย้ง ไม่สามารถใช้ผลการจับคู่ได้' : 'นำผลการจับคู่ของ Matcher ไปผูกรูปภาพกับพัสดุในหน้าจอหลัก'}">
            <i class="fa-solid fa-check"></i> ใช้ผลการจับคู่ (${applyPlan.readyCount}/${applyPlan.totalApiCount})
          </button>
        </div>
      </div>
      ${applyPlan.conflicts.length > 0 ? `
        <div class="mt-2.5 pt-2 border-t border-rose-200/80 text-[11px] text-rose-700 space-y-1">
          <div class="font-bold flex items-center gap-1">
            <i class="fa-solid fa-triangle-exclamation"></i> รายการที่ต้องตรวจสอบและแก้ไขก่อน Apply:
          </div>
          <ul class="list-disc list-inside space-y-0.5 text-[10px] text-rose-800">
            ${applyPlan.conflicts.slice(0, 3).map(c => `
              <li>หน้า ${c.photoIndex + 1} (Seq ${c.seqNo ?? '-'}): ${escapeHtml(c.reason)}</li>
            `).join('')}
            ${applyPlan.conflicts.length > 3 ? `<li>และอีก ${applyPlan.conflicts.length - 3} รายการ...</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  // 1. Evaluate Safe Receipt Range Resolution Summary
  const rangeResult = resolveReceiptRanges(state.photos, state.receiptItems);
  const autoResolvedCount = rangeResult.resolvedCount;
  const autoResolvedTracks = rangeResult.mappedTrackCount;
  const reviewCount = rangeResult.needsReviewCount;

  const rangeSummaryBannerHtml = `
    <div class="p-3 bg-white border ${reviewCount > 0 ? 'border-amber-300 bg-amber-50/20' : (autoResolvedCount > 0 ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200')} rounded-xl mb-3 shadow-xs" id="rangeResolutionSummaryBanner">
      <div class="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <i class="fa-solid ${reviewCount > 0 ? 'fa-triangle-exclamation text-amber-600' : (autoResolvedCount > 0 ? 'fa-circle-check text-emerald-600' : 'fa-list-check text-slate-500')} text-base"></i>
            <h4 class="text-xs font-bold text-slate-800">
              จับคู่อัตโนมัติแล้ว: <span class="text-emerald-700 font-bold">${autoResolvedCount} Sequence / ${autoResolvedTracks} Track</span>
              ${reviewCount > 0 ? ` | <span class="text-amber-700 font-bold">ต้องตรวจสอบ: ${reviewCount} Sequence</span>` : ''}
            </h4>
          </div>
          <div class="text-[11px] text-slate-600 mt-1">
            ${reviewCount === 0 && autoResolvedCount > 0
              ? '<span class="text-emerald-700 font-semibold"><i class="fa-solid fa-check"></i> พร้อมใช้งาน — คลิกรายการ Track เพื่อตรวจใบเสร็จ</span>'
              : (reviewCount > 0
                ? '<span class="text-amber-800 font-medium">⚠️ มีบางรายการต้องการการยืนยันหรือตรวจสอบข้อมูลเพิ่มเติม</span>'
                : '<span class="text-slate-500">กด "🔍 อ่านรายการจากภาพ" บนหน้าใบเสร็จเพื่อตรวจจับและจับคู่พัสดุอัตโนมัติ</span>')}
          </div>
        </div>
        ${reviewCount > 0 ? `
          <div class="shrink-0 flex items-center gap-2">
            <button type="button" id="btnFilterReviewOnly" class="btn-filter-review px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-2xs ${
              state.filterReviewOnly ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
            }">
              <i class="fa-solid fa-filter text-[10px]"></i> ${state.filterReviewOnly ? 'แสดงทั้งหมด' : 'ตรวจเฉพาะรายการที่มีปัญหา'}
            </button>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  container.innerHTML = rangeSummaryBannerHtml + matcherBannerHtml + state.photos.map((photo, idx) => {
    const start = photo.startNo ?? '';
    const end = photo.endNo ?? '';
    const title = photo.label || `หน้า ${idx + 1}`;
    const photoSequences = Array.isArray(photo.sequences) ? photo.sequences : [];
    
    // Check if overlap with previous photo
    let overlapBadge = '';
    if (idx > 0 && photo.startNo && state.photos[idx - 1]?.endNo) {
      const prevEnd = state.photos[idx - 1].endNo;
      if (photo.startNo <= prevEnd) {
        overlapBadge = `<span class="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium ml-1">Overlap ที่เลข ${photo.startNo}-${prevEnd}</span>`;
      } else if (photo.startNo === 1) {
        overlapBadge = `<span class="text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium ml-1">เริ่มใบเสร็จใบใหม่ (Sequence 1)</span>`;
      } else if (photo.startNo > prevEnd + 1) {
        overlapBadge = `<span class="text-[10px] text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded font-medium ml-1">มี Gap ข้ามเลข ${prevEnd + 1}–${photo.startNo - 1}</span>`;
      }
    }

    let seqRowsHtml = '';
    if (photoSequences.length === 0) {
      seqRowsHtml = `
        <div class="text-[11px] text-slate-400 italic py-2.5 text-center bg-slate-50/80 rounded-lg border border-dashed border-slate-200">
          ยังไม่มีการระบุ Sequence สำหรับหน้านี้ — กด "+ เพิ่ม Sequence" เพื่อบันทึกหลักฐานเลขลำดับ/ช่วงแทร็กจากใบเสร็จจริง
        </div>
      `;
    } else {
      const rows = photoSequences.map((s, sIdx) => {
        const val = evaluateSequenceValidation(s, photo.detectedRcpt, allSeqs);
        const lTrackDisplay = (s.firstTrack && s.lastTrack && s.firstTrack === s.lastTrack) ? '' : (s.lastTrack || '');
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/80 transition" data-seq-row="${sIdx}">
            <td class="p-1 text-center">
              <input type="number" min="1" class="input-seq-no w-12 px-1 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                     value="${s.seqNo ?? ''}" placeholder="Seq" data-page-index="${idx}" data-seq-index="${sIdx}">
            </td>
            <td class="p-1">
              <input type="text" class="input-seq-first w-full min-w-[125px] px-2 py-1 text-xs border border-slate-300 rounded font-mono uppercase bg-white"
                     value="${s.firstTrack || ''}" placeholder="First Track (เช่น EF...TH)" data-page-index="${idx}" data-seq-index="${sIdx}">
            </td>
            <td class="p-1">
              <input type="text" class="input-seq-last w-full min-w-[125px] px-2 py-1 text-xs border border-slate-300 rounded font-mono uppercase bg-white"
                     value="${lTrackDisplay}" placeholder="เว้นว่างถ้าเดี่ยว" data-page-index="${idx}" data-seq-index="${sIdx}">
              ${(() => {
                if (val.status === 'conflict' && s.firstTrack && s.qty > 1) {
                  const rangeCand = findRangeReviewCandidate(s, state?.receiptItems || [], allSeqs, idx);
                  if (rangeCand && rangeCand.status === 'candidate') {
                    return `
                      <div class="mt-1 p-1.5 bg-amber-50/90 border border-amber-300 rounded text-[10px] text-amber-900 space-y-1">
                        <div class="flex items-center justify-between gap-1 flex-wrap">
                          <span class="font-semibold text-amber-800">
                            <i class="fa-solid fa-triangle-exclamation text-amber-600"></i> เลขปลายที่พิมพ์:
                            <span class="font-mono text-slate-700">${escapeHtml(s.lastTrack)}</span>
                            <span class="text-rose-600 font-medium">(ไม่พบใน Tracking จริง)</span>
                          </span>
                          <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
                            Candidate / ต้องตรวจสอบ
                          </span>
                        </div>
                        <div class="flex items-center justify-between gap-1 pt-0.5 border-t border-amber-200 flex-wrap">
                          <span class="truncate">
                            จากเลขเริ่มต้น + จำนวน ${s.qty} ชิ้น → พบรายการจริงที่เป็นไปได้:
                            <strong class="font-mono text-blue-700 font-bold">${rangeCand.candidate}</strong>
                          </span>
                          <button type="button" class="btn-use-range-candidate-manual shrink-0 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-medium transition shadow-2xs"
                                  data-page-index="${idx}" data-seq-index="${sIdx}" data-candidate="${rangeCand.candidate}" data-printed-last="${escapeHtml(s.lastTrack)}">
                            ใช้เลขนี้
                          </button>
                        </div>
                      </div>
                    `;
                  }
                }
                return '';
              })()}
              ${s.printedLastTrack && s.printedLastTrack !== s.lastTrack ? `
                <div class="mt-0.5 text-[9px] text-slate-400 font-mono" title="หลักฐานที่พิมพ์บนใบเสร็จเดิม">
                  (เลขพิมพ์เดิม: ${escapeHtml(s.printedLastTrack)})
                </div>
              ` : ''}
            </td>
            <td class="p-1 text-center">
              <input type="number" min="1" class="input-seq-qty w-12 px-1 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white"
                     value="${s.qty ?? (s.firstTrack && !s.lastTrack ? 1 : '')}" placeholder="Qty" data-page-index="${idx}" data-seq-index="${sIdx}">
            </td>
            <td class="p-1">
              <div class="seq-val-badge-container flex flex-col justify-center" data-page-index="${idx}" data-seq-index="${sIdx}">
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${val.badgeClass} w-max" title="${escapeHtml(val.reasonText)}">
                  ${val.badge}
                </span>
                <span class="text-[10px] text-slate-500 block truncate max-w-[200px]" title="${escapeHtml(val.reasonText)}">
                  ${escapeHtml(val.reasonText)}
                </span>
              </div>
            </td>
            <td class="p-1 text-center">
              <button type="button" class="btn-delete-seq text-slate-400 hover:text-rose-600 p-1 rounded transition" title="ลบ Sequence นี้" data-page-index="${idx}" data-seq-index="${sIdx}">
                <i class="fa-solid fa-trash-can text-xs"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      seqRowsHtml = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-[10px] font-semibold text-slate-500 border-b border-slate-200 bg-slate-50">
                <th class="p-1.5 text-center w-14">Seq#</th>
                <th class="p-1.5">First Track</th>
                <th class="p-1.5">Last Track (เว้นว่างถ้าเดี่ยว)</th>
                <th class="p-1.5 text-center w-14">Qty</th>
                <th class="p-1.5">สถานะตรวจสอบ (Matcher)</th>
                <th class="p-1.5 text-center w-8"></th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5" data-page-index="${idx}">
        <div class="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-6 h-6 rounded-md bg-slate-700 text-white font-mono text-xs flex items-center justify-center shrink-0">
              ${idx + 1}
            </span>
            <div class="min-w-0">
              <div class="text-xs font-semibold text-slate-800 truncate flex items-center">
                ${escapeHtml(title)}
                ${overlapBadge}
              </div>
              <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-600 flex-wrap">
                <label class="flex items-center gap-1 font-mono">
                  <span class="text-slate-400">TR#:</span>
                  <input type="text" placeholder="ไม่ระบุ" value="${photo.detectedTR || ''}"
                         class="input-page-tr w-24 px-1.5 py-0.5 text-[11px] border border-slate-300 rounded font-mono bg-white">
                </label>
                <label class="flex items-center gap-1 font-mono">
                  <span class="text-slate-400">RCPT#:</span>
                  <input type="text" placeholder="ไม่ระบุ" value="${photo.detectedRcpt || ''}"
                         class="input-page-rcpt w-20 px-1.5 py-0.5 text-[11px] border border-slate-300 rounded font-mono bg-white">
                </label>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0 ml-auto">
            <span class="text-[10px] text-slate-400 font-medium">ช่วงแสดงผล:</span>
            <input type="number" min="1" placeholder="เริ่ม" value="${start}"
                   class="input-page-start w-14 px-1.5 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white" title="ช่วงเลขลำดับแสดงผล UI">
            <span class="text-slate-400 text-xs">–</span>
            <input type="number" min="1" placeholder="สิ้นสุด" value="${end}"
                   class="input-page-end w-14 px-1.5 py-1 text-xs border border-slate-300 rounded font-mono text-center bg-white" title="ช่วงเลขลำดับแสดงผล UI">

            <div class="flex flex-col gap-0.5 ml-1">
              <button type="button" class="btn-move-page-up p-1 text-[10px] bg-white border border-slate-300 hover:bg-slate-100 rounded text-slate-600 ${idx === 0 ? 'opacity-30 pointer-events-none' : ''}" title="เลื่อนขึ้น">
                <i class="fa-solid fa-chevron-up"></i>
              </button>
              <button type="button" class="btn-move-page-down p-1 text-[10px] bg-white border border-slate-300 hover:bg-slate-100 rounded text-slate-600 ${idx === state.photos.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="เลื่อนลง">
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="bg-white border border-slate-200/80 rounded-lg p-2.5">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div class="flex items-center gap-1.5">
              <i class="fa-solid fa-list-ol text-blue-600 text-xs"></i>
              <span class="text-xs font-bold text-slate-700">หลักฐาน Sequence บนกระดาษ (Receipt Sequences)</span>
              <span class="text-[10px] text-slate-400">(${photoSequences.length} รายการ)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" class="btn-scan-lines px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded text-[11px] font-semibold flex items-center gap-1 transition" data-page-index="${idx}" title="อ่านรายการพัสดุจากภาพด้วย OCR">
                <i class="fa-solid fa-wand-magic-sparkles text-[10px]"></i> 🔍 อ่านรายการจากภาพ
              </button>
              <button type="button" class="btn-add-sequence px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-semibold flex items-center gap-1 transition" data-page-index="${idx}">
                <i class="fa-solid fa-plus text-[10px]"></i> เพิ่ม Sequence
              </button>
            </div>
          </div>

          ${photo.ocrLinesStatus === 'processing' ? `
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2 text-xs text-amber-800 my-2">
              <i class="fa-solid fa-spinner fa-spin text-amber-600"></i>
              <span>กำลังอ่านรายการพัสดุจากภาพด้วย OCR... กรุณารอสักครู่</span>
            </div>
          ` : ''}

          ${(() => {
            const photoSuggestions = Array.isArray(photo.ocrSequenceSuggestions) ? photo.ocrSequenceSuggestions : [];
            const autoResolvedSuggestions = photoSuggestions.filter(s => (s.autoResolved || s.status === 'auto_resolved') && s.status !== 'rejected');
            const pendingSuggestions = photoSuggestions.filter(s => !s.autoResolved && s.status !== 'auto_resolved' && s.status !== 'rejected');

            if (autoResolvedSuggestions.length === 0 && pendingSuggestions.length === 0) return '';

            let autoResolvedHtml = '';
            if (autoResolvedSuggestions.length > 0) {
              autoResolvedHtml = `
                <div class="bg-emerald-50/80 border border-emerald-300 rounded-lg p-2.5 space-y-2 mb-2.5">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5">
                      <i class="fa-solid fa-circle-check text-emerald-600 text-xs"></i>
                      <span class="text-xs font-bold text-emerald-900">จับคู่อัตโนมัติแล้ว (${autoResolvedSuggestions.length} Sequence)</span>
                    </div>
                    <span class="text-[10px] text-emerald-800 bg-emerald-200/80 px-1.5 py-0.5 rounded font-mono font-semibold">
                      ไม่ต้องกดยืนยัน — ระบบจับคู่ให้ทันที
                    </span>
                  </div>
                  <div class="space-y-1.5 pt-0.5">
                    ${autoResolvedSuggestions.map(sug => {
                      const displayLast = sug.resolvedLastTrack || sug.lastTrack;
                      const isRange = sug.firstTrack !== displayLast;
                      return `
                        <div class="p-2 bg-white/95 border border-emerald-200 rounded-md text-xs flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap shadow-2xs">
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 font-mono">
                              ✓ จับคู่แล้ว ${sug.qty} รายการ
                            </span>
                            <div class="min-w-0">
                              <div class="font-bold text-slate-800 text-xs flex items-center gap-1.5 flex-wrap">
                                <span class="text-slate-600">เลขที่ ${sug.seqNo ?? '-'}:</span>
                                <span class="font-mono text-emerald-700">${escapeHtml(sug.firstTrack)}</span>
                                ${isRange ? `
                                  <span class="text-slate-400">→</span>
                                  <span class="font-mono text-emerald-700">${escapeHtml(displayLast)}</span>
                                ` : ''}
                              </div>
                              ${sug.printedLastTrack && sug.printedLastTrack !== displayLast ? `
                                <div class="text-[10px] text-slate-500 font-mono mt-0.5">
                                  ปลายช่วงบนใบเสร็จ: ${escapeHtml(sug.printedLastTrack)}
                                </div>
                              ` : ''}
                            </div>
                          </div>
                          <div class="shrink-0 flex items-center gap-2 text-[10px]">
                            <span class="text-emerald-700 font-medium flex items-center gap-1">
                              <i class="fa-solid fa-lock text-[9px]"></i> ปลอดภัย (Excel Verified)
                            </span>
                            <button type="button" class="btn-reject-sug text-slate-400 hover:text-rose-600 p-1 rounded transition" data-page-index="${idx}" data-sug-id="${sug.id}" title="ยกเลิกรายการนี้">
                              <i class="fa-solid fa-trash-can text-xs"></i>
                            </button>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }

            let reviewHtml = '';
            if (pendingSuggestions.length > 0) {
              reviewHtml = `
                <div class="bg-amber-50/70 border border-amber-300 rounded-lg p-2.5 space-y-2 mb-2.5">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                      <i class="fa-solid fa-triangle-exclamation text-amber-600 text-xs"></i>
                      <span class="text-xs font-bold text-amber-900">ข้อเสนอแนะที่ต้องตรวจสอบ (${pendingSuggestions.length} รายการ)</span>
                    </div>
                    <button type="button" class="btn-confirm-all-sug px-2 py-0.5 ${(() => {
                      const readyCount = pendingSuggestions.filter(sug => {
                        const isSingle = sug.firstTrack && (!sug.lastTrack || sug.lastTrack === sug.firstTrack);
                        const hasQty = isSingle || (sug.qty !== null && sug.qty !== undefined && Number(sug.qty) > 0);
                        const val = evaluateSequenceValidation({
                          seqNo: sug.seqNo,
                          firstTrack: sug.firstTrack,
                          lastTrack: sug.lastTrack,
                          qty: sug.qty
                        }, photo.detectedRcpt, allSeqs);
                        return val && val.status === 'strong' && sug.reviewCandidate?.status !== 'ambiguous' && Boolean(sug.firstTrack && hasQty);
                      }).length;
                      return readyCount > 0 ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400 opacity-60';
                    })()} text-white rounded text-[10px] font-semibold flex items-center gap-1 transition shadow-sm" data-page-index="${idx}">
                      <i class="fa-solid fa-check-double text-[10px]"></i> ยืนยันรายการที่พร้อม (${pendingSuggestions.filter(sug => {
                        const isSingle = sug.firstTrack && (!sug.lastTrack || sug.lastTrack === sug.firstTrack);
                        const hasQty = isSingle || (sug.qty !== null && sug.qty !== undefined && Number(sug.qty) > 0);
                        const val = evaluateSequenceValidation({
                          seqNo: sug.seqNo,
                          firstTrack: sug.firstTrack,
                          lastTrack: sug.lastTrack,
                          qty: sug.qty
                        }, photo.detectedRcpt, allSeqs);
                        return val && val.status === 'strong' && sug.reviewCandidate?.status !== 'ambiguous' && Boolean(sug.firstTrack && hasQty);
                      }).length}/${pendingSuggestions.length})
                    </button>
                  </div>
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs bg-white rounded border border-amber-200">
                      <thead>
                        <tr class="text-[10px] font-semibold text-amber-900 border-b border-amber-200 bg-amber-100/50">
                          <th class="p-1.5 text-center w-12">Seq#</th>
                          <th class="p-1.5">First Track (แก้ไขได้)</th>
                          <th class="p-1.5">Last Track (เว้นว่างถ้าเดี่ยว)</th>
                          <th class="p-1.5 text-center w-14">Qty</th>
                          <th class="p-1.5 text-center w-16">OCR Conf.</th>
                          <th class="p-1.5">สถานะ Matcher</th>
                          <th class="p-1.5 text-center w-28">การดำเนินการ</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${pendingSuggestions.map(sug => {
                          const val = evaluateSequenceValidation({ seqNo: sug.seqNo, firstTrack: sug.firstTrack, lastTrack: sug.lastTrack, qty: sug.qty }, photo.detectedRcpt, allSeqs);
                          const lTrackDisplay = (sug.firstTrack && sug.lastTrack && sug.firstTrack === sug.lastTrack) ? '' : (sug.lastTrack || '');
                          const isSingle = sug.firstTrack && (!sug.lastTrack || sug.lastTrack === sug.firstTrack);
                          return `
                            <tr class="border-b border-amber-100 hover:bg-amber-50/40 transition" data-sug-row="${sug.id}">
                              <td class="p-1 text-center">
                                <input type="number" min="1" class="input-sug-seq w-12 px-1 py-1 text-xs border border-amber-300 rounded font-mono text-center bg-white"
                                       value="${sug.seqNo ?? ''}" placeholder="Seq" data-page-index="${idx}" data-sug-id="${sug.id}">
                              </td>
                              <td class="p-1">
                                <input type="text" class="input-sug-first w-full min-w-[125px] px-2 py-1 text-xs border border-amber-300 rounded font-mono uppercase bg-white"
                                       value="${sug.firstTrack || ''}" placeholder="First Track" data-page-index="${idx}" data-sug-id="${sug.id}">
                                ${sug.printedFirstTrack && sug.printedFirstTrack !== sug.firstTrack ? `
                                  <div class="mt-0.5 text-[9px] text-emerald-700 font-medium flex items-center gap-1">
                                    <i class="fa-solid fa-check text-emerald-600"></i> ใช้เลขจาก Excel แล้ว
                                    <span class="text-slate-400 font-mono">(เดิม: ${escapeHtml(sug.printedFirstTrack)})</span>
                                  </div>
                                ` : ''}
                                ${(() => {
                                  const cand = sug.reviewCandidate || findApiTrackCandidate(sug.firstTrack, state?.receiptItems || []);
                                  if (!cand) return '';
                                  if (cand.status === 'single_match') {
                                    return `
                                      <div class="mt-1 flex items-center justify-between gap-1 text-[10px] bg-blue-50 border border-blue-200 text-blue-900 px-1.5 py-0.5 rounded">
                                        <span class="truncate" title="พบเลขพัสดุใกล้เคียงในระบบ Excel">อาจเป็น: <strong class="font-mono text-blue-700">${cand.candidate}</strong> (diff ${cand.distance})</span>
                                        <button type="button" class="btn-use-candidate shrink-0 px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[9px] font-medium transition shadow-2xs"
                                                data-page-index="${idx}" data-sug-id="${sug.id}" data-candidate="${cand.candidate}" data-printed-first="${escapeHtml(sug.firstTrack)}">
                                          ใช้เลขนี้
                                        </button>
                                      </div>
                                    `;
                                  } else if (cand.status === 'ambiguous') {
                                    return `
                                      <div class="mt-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded truncate" title="${(cand.candidates || []).join(', ')}">
                                        ⚠️ พบเลขใกล้เคียงหลายตัว (กำกวม) — แก้ไขเอง
                                      </div>
                                    `;
                                  } else if (cand.status === 'none' && val.status === 'conflict') {
                                    return `
                                      <div class="mt-1 text-[10px] text-slate-400 italic">
                                        ไม่พบเลขใกล้เคียงใน Excel
                                      </div>
                                    `;
                                  }
                                  return '';
                                })()}
                              </td>
                              <td class="p-1">
                                <input type="text" class="input-sug-last w-full min-w-[125px] px-2 py-1 text-xs border border-amber-300 rounded font-mono uppercase bg-white"
                                       value="${lTrackDisplay}" placeholder="เว้นว่างถ้าเดี่ยว" data-page-index="${idx}" data-sug-id="${sug.id}">
                                ${sug.printedLastTrack && sug.printedLastTrack !== sug.lastTrack ? `
                                  <div class="mt-0.5 text-[9px] text-emerald-700 font-medium flex items-center gap-1">
                                    <i class="fa-solid fa-check text-emerald-600"></i> ใช้เลขจาก Excel แล้ว
                                    <span class="text-slate-400 font-mono">(เดิม: ${escapeHtml(sug.printedLastTrack)})</span>
                                  </div>
                                ` : ''}
                                ${(() => {
                                  if (val.status === 'conflict' && sug.firstTrack && sug.qty > 1) {
                                    const rangeCand = findRangeReviewCandidate({ firstTrack: sug.firstTrack, lastTrack: sug.lastTrack, qty: sug.qty }, state?.receiptItems || [], allSeqs, idx);
                                    if (rangeCand && rangeCand.status === 'candidate') {
                                      return `
                                        <div class="mt-1 p-1.5 bg-amber-50/90 border border-amber-300 rounded text-[10px] text-amber-900 space-y-1">
                                          <div class="flex items-center justify-between gap-1 flex-wrap">
                                            <span class="font-semibold text-amber-800">
                                              <i class="fa-solid fa-triangle-exclamation text-amber-600"></i> เลขปลายที่พิมพ์:
                                              <span class="font-mono text-slate-700">${escapeHtml(sug.lastTrack)}</span>
                                              <span class="text-rose-600 font-medium">(ไม่พบใน Tracking จริง)</span>
                                            </span>
                                            <span class="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-200 text-amber-900 border border-amber-300">
                                              Candidate / ต้องตรวจสอบ
                                            </span>
                                          </div>
                                          <div class="flex items-center justify-between gap-1 pt-0.5 border-t border-amber-200 flex-wrap">
                                            <span class="truncate">
                                              จากเลขเริ่มต้น + จำนวน ${sug.qty} ชิ้น → พบรายการจริงที่เป็นไปได้:
                                              <strong class="font-mono text-blue-700 font-bold">${rangeCand.candidate}</strong>
                                            </span>
                                            <button type="button" class="btn-use-range-candidate shrink-0 px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-medium transition shadow-2xs"
                                                    data-page-index="${idx}" data-sug-id="${sug.id}" data-candidate="${rangeCand.candidate}" data-printed-last="${escapeHtml(sug.lastTrack)}">
                                              ใช้เลขนี้
                                            </button>
                                          </div>
                                        </div>
                                      `;
                                    }
                                  }
                                  return '';
                                })()}
                              </td>
                              <td class="p-1 text-center">
                                <input type="number" min="1" class="input-sug-qty w-12 px-1 py-1 text-xs border ${!isSingle && (sug.qty === null || sug.qty === undefined || sug.qty === '') ? 'border-rose-400 bg-rose-50/80 font-bold text-rose-700' : 'border-amber-300'} rounded font-mono text-center bg-white"
                                       value="${sug.qty !== null && sug.qty !== undefined ? sug.qty : (isSingle ? 1 : '')}"
                                       placeholder="${isSingle ? '1' : 'Qty'}"
                                       data-page-index="${idx}" data-sug-id="${sug.id}">
                                ${(() => {
                                  if (!isSingle && (sug.qty === null || sug.qty === undefined || sug.qty === '')) {
                                    const rangeReview = evaluateExcelRangeReview(sug, state?.receiptItems || []);
                                    if (rangeReview && rangeReview.status === 'qty_suggested') {
                                      return `
                                        <div class="mt-1 p-1 bg-sky-50 border border-sky-300 rounded text-[9px] text-sky-900 text-center space-y-0.5">
                                          <span class="block truncate">Excel: <strong>${rangeReview.expectedQty}</strong> ชิ้น</span>
                                          <button type="button" class="btn-use-excel-qty w-full px-1 py-0.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-[9px] font-semibold transition"
                                                  data-page-index="${idx}" data-sug-id="${sug.id}" data-qty="${rangeReview.expectedQty}">
                                            ใช้ ${rangeReview.expectedQty}
                                          </button>
                                        </div>
                                      `;
                                    }
                                  }
                                  return '';
                                })()}
                              </td>
                              <td class="p-1 text-center">
                                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-300">
                                  ${sug.confidence}%
                                </span>
                              </td>
                              <td class="p-1">
                                <span class="sug-matcher-badge inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${val.badgeClass} w-max" title="${escapeHtml(val.reasonText)}" data-page-index="${idx}" data-sug-id="${sug.id}">
                                  ${val.badge}
                                </span>
                              </td>
                              <td class="p-1 text-center">
                                <div class="flex items-center justify-center gap-1">
                                  <button type="button" class="btn-confirm-sug px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-semibold transition"
                                          data-page-index="${idx}" data-sug-id="${sug.id}" title="ยืนยันนำเข้ารายการนี้">
                                    <i class="fa-solid fa-check"></i> ยืนยัน
                                  </button>
                                  <button type="button" class="btn-reject-sug px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] transition"
                                          data-page-index="${idx}" data-sug-id="${sug.id}" title="ไม่ใช้">
                                    <i class="fa-solid fa-xmark"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              `;
            }

            return autoResolvedHtml + reviewHtml;
          })()}

          ${seqRowsHtml}
        </div>
      </div>
    `;
  }).join('');

  // Wire up sequence inputs live validation & data synchronization
  const updateAllSequenceBadges = () => {
    const freshAllSeqs = [];
    state.photos.forEach((p, pI) => {
      const pageEl = container.querySelector(`[data-page-index="${pI}"]`);
      const rcpt = pageEl?.querySelector('.input-page-rcpt')?.value.trim() || String(p.detectedRcpt || '').trim();
      (p.sequences || []).forEach(s => {
        freshAllSeqs.push({ ...s, rcptNo: s.rcptNo || rcpt });
      });
    });

    state.photos.forEach((p, pI) => {
      const pageEl = container.querySelector(`[data-page-index="${pI}"]`);
      const rcpt = pageEl?.querySelector('.input-page-rcpt')?.value.trim() || String(p.detectedRcpt || '').trim();
      (p.sequences || []).forEach((s, sI) => {
        const badgeContainer = container.querySelector(`.seq-val-badge-container[data-page-index="${pI}"][data-seq-index="${sI}"]`);
        if (badgeContainer) {
          const val = evaluateSequenceValidation(s, rcpt, freshAllSeqs);
          badgeContainer.innerHTML = `
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${val.badgeClass} w-max" title="${escapeHtml(val.reasonText)}">
              ${val.badge}
            </span>
            <span class="text-[10px] text-slate-500 block truncate max-w-[200px]" title="${escapeHtml(val.reasonText)}">
              ${escapeHtml(val.reasonText)}
            </span>
          `;
        }
      });
    });
  };

  // Live input events on sequences
  container.querySelectorAll('input.input-seq-no, input.input-seq-first, input.input-seq-last, input.input-seq-qty').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-page-index'), 10);
      const sIdx = parseInt(e.target.getAttribute('data-seq-index'), 10);
      if (state.photos[pIdx]?.sequences?.[sIdx]) {
        const row = e.target.closest('[data-seq-row]');
        if (row) {
          state.photos[pIdx].sequences[sIdx].seqNo = parseInt(row.querySelector('.input-seq-no')?.value, 10) || null;
          state.photos[pIdx].sequences[sIdx].firstTrack = cleanTrackNo(row.querySelector('.input-seq-first')?.value);
          state.photos[pIdx].sequences[sIdx].lastTrack = cleanTrackNo(row.querySelector('.input-seq-last')?.value);
          state.photos[pIdx].sequences[sIdx].qty = parseInt(row.querySelector('.input-seq-qty')?.value, 10) || null;
          updateAllSequenceBadges();
        }
      }
    });
  });

  // Live input events on suggestion rows
  container.querySelectorAll('input.input-sug-seq, input.input-sug-first, input.input-sug-last, input.input-sug-qty').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-page-index'), 10);
      const row = e.target.closest('[data-sug-row]');
      if (row) {
        const sNo = parseInt(row.querySelector('.input-sug-seq')?.value, 10) || null;
        const fTrack = cleanTrackNo(row.querySelector('.input-sug-first')?.value);
        const lTrack = cleanTrackNo(row.querySelector('.input-sug-last')?.value);
        const rawQtyStr = row.querySelector('.input-sug-qty')?.value?.trim();
        const isSingle = fTrack && (!lTrack || lTrack === fTrack);
        const qVal = rawQtyStr !== '' ? parseInt(rawQtyStr, 10) : (isSingle ? 1 : null);

        const sugId = e.target.getAttribute('data-sug-id');
        const sug = state.photos[pIdx]?.ocrSequenceSuggestions?.find(s => String(s.id) === String(sugId));
        if (sug) {
          sug.seqNo = sNo;
          sug.firstTrack = fTrack;
          sug.lastTrack = lTrack;
          sug.qty = qVal;
        }

        const badgeEl = row.querySelector('.sug-matcher-badge');
        if (badgeEl) {
          const val = evaluateSequenceValidation({ seqNo: sNo, firstTrack: fTrack, lastTrack: lTrack, qty: qVal }, state.photos[pIdx]?.detectedRcpt, allSeqs);
          badgeEl.className = `sug-matcher-badge inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${val.badgeClass} w-max`;
          badgeEl.textContent = val.badge;
          badgeEl.title = val.reasonText;
        }
      }
    });
  });

  // Live input events on page RCPT
  container.querySelectorAll('input.input-page-rcpt').forEach(inp => {
    inp.addEventListener('input', () => {
      updateAllSequenceBadges();
    });
  });

  // Scan line items OCR buttons
  container.querySelectorAll('.btn-scan-lines').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      scanPhotoLineEvidence(pIdx);
    };
  });

  // Handle "ใช้เลขนี้" (Use API review candidate into editable input - DOES NOT auto-confirm)
  container.querySelectorAll('.btn-use-candidate').forEach(btn => {
    btn.onclick = (e) => {
      const candidate = e.currentTarget.getAttribute('data-candidate');
      const printedFirst = e.currentTarget.getAttribute('data-printed-first');
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sugId = e.currentTarget.getAttribute('data-sug-id');
      const sug = state.photos[pIdx]?.ocrSequenceSuggestions?.find(s => String(s.id) === String(sugId));
      if (sug && candidate) {
        if (!sug.printedFirstTrack) {
          sug.printedFirstTrack = printedFirst || sug.firstTrack;
        }
        sug.firstTrack = candidate;
        sug.firstCandidateApplied = true;
        sug.reviewCandidate = null;
        renderPageManageList();
      }
    };
  });

  // Handle "ใช้เลขนี้" for range candidate in OCR suggestions (DOES NOT auto-confirm)
  container.querySelectorAll('.btn-use-range-candidate').forEach(btn => {
    btn.onclick = (e) => {
      const candidate = e.currentTarget.getAttribute('data-candidate');
      const printedLast = e.currentTarget.getAttribute('data-printed-last');
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sugId = e.currentTarget.getAttribute('data-sug-id');
      const sug = state.photos[pIdx]?.ocrSequenceSuggestions?.find(s => String(s.id) === String(sugId));
      if (sug && candidate) {
        if (!sug.printedLastTrack) {
          sug.printedLastTrack = printedLast || sug.lastTrack;
        }
        sug.lastTrack = candidate;
        sug.lastCandidateApplied = true;
        renderPageManageList();
      }
    };
  });

  // Handle "ใช้จำนวน N" for Excel range count in OCR suggestions (DOES NOT auto-confirm)
  container.querySelectorAll('.btn-use-excel-qty').forEach(btn => {
    btn.onclick = (e) => {
      const qtyVal = parseInt(e.currentTarget.getAttribute('data-qty'), 10);
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sugId = e.currentTarget.getAttribute('data-sug-id');
      const sug = state.photos[pIdx]?.ocrSequenceSuggestions?.find(s => String(s.id) === String(sugId));
      if (sug && Number.isFinite(qtyVal) && qtyVal > 0) {
        sug.qty = qtyVal;
        sug.qtyAppliedFromExcel = true;
        renderPageManageList();
      }
    };
  });

  // Handle "ใช้เลขนี้" for range candidate in confirmed manual sequences (DOES NOT auto-apply)
  container.querySelectorAll('.btn-use-range-candidate-manual').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sIdx = parseInt(e.currentTarget.getAttribute('data-seq-index'), 10);
      const candidate = e.currentTarget.getAttribute('data-candidate');
      const printedLast = e.currentTarget.getAttribute('data-printed-last');
      const seq = state.photos[pIdx]?.sequences?.[sIdx];
      if (seq && candidate) {
        if (!seq.printedLastTrack) {
          seq.printedLastTrack = printedLast || seq.lastTrack;
        }
        seq.lastTrack = candidate;
        renderPageManageList();
      }
    };
  });

  // Confirm single OCR suggestion
  container.querySelectorAll('.btn-confirm-sug').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sugId = e.currentTarget.getAttribute('data-sug-id');
      const sug = state.photos[pIdx]?.ocrSequenceSuggestions?.find(s => String(s.id) === String(sugId));
      const row = e.currentTarget.closest('[data-sug-row]');

      const first = row ? cleanTrackNo(row.querySelector('.input-sug-first')?.value) : sug?.firstTrack;
      const last = row ? cleanTrackNo(row.querySelector('.input-sug-last')?.value) : sug?.lastTrack;
      const rawQtyStr = row ? row.querySelector('.input-sug-qty')?.value?.trim() : '';
      const isSingle = first && (!last || last === first);
      let qtyVal = rawQtyStr !== '' ? parseInt(rawQtyStr, 10) : (sug?.qty ?? (isSingle ? 1 : null));

      if (!isSingle && (qtyVal === null || isNaN(qtyVal) || qtyVal <= 0)) {
        alert('กรุณาระบุจำนวน (Qty) ของช่วงพัสดุก่อนยืนยัน');
        return;
      }

      const editedValues = row ? {
        seqNo: parseInt(row.querySelector('.input-sug-seq')?.value, 10) || null,
        firstTrack: first,
        lastTrack: last,
        printedFirstTrack: row.getAttribute('data-printed-first') || sug?.printedFirstTrack || null,
        printedLastTrack: row.getAttribute('data-printed-last') || sug?.printedLastTrack || null,
        qty: qtyVal
      } : null;
      confirmOcrSuggestion(pIdx, sugId, editedValues);
    };
  });

  // Reject single OCR suggestion
  container.querySelectorAll('.btn-reject-sug').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sugId = e.currentTarget.getAttribute('data-sug-id');
      rejectOcrSuggestion(pIdx, sugId);
    };
  });

  // Confirm all suggestions for photo
  container.querySelectorAll('.btn-confirm-all-sug').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      confirmAllOcrSuggestions(pIdx);
    };
  });

  // Add sequence buttons
  container.querySelectorAll('.btn-add-sequence').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      if (!Array.isArray(state.photos[pIdx].sequences)) {
        state.photos[pIdx].sequences = [];
      }
      const maxSeq = state.photos[pIdx].sequences.reduce((max, cur) => Math.max(max, Number(cur.seqNo) || 0), 0);
      state.photos[pIdx].sequences.push({
        seqNo: maxSeq + 1,
        firstTrack: '',
        lastTrack: '',
        qty: 1,
        fieldSources: { rcptNo: 'manual', seqNo: 'manual', firstTrack: 'manual', lastTrack: 'manual', qty: 'manual' }
      });
      renderPageManageList();
    };
  });

  // Delete sequence buttons
  container.querySelectorAll('.btn-delete-seq').forEach(btn => {
    btn.onclick = (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-page-index'), 10);
      const sIdx = parseInt(e.currentTarget.getAttribute('data-seq-index'), 10);
      if (state.photos[pIdx]?.sequences) {
        state.photos[pIdx].sequences.splice(sIdx, 1);
        renderPageManageList();
      }
    };
  });

  // Page move handlers
  container.querySelectorAll('.btn-move-page-up').forEach(btn => {
    btn.onclick = (e) => {
      const row = e.target.closest('[data-page-index]');
      const idx = parseInt(row.getAttribute('data-page-index'), 10);
      if (idx > 0) {
        const temp = state.photos[idx];
        state.photos[idx] = state.photos[idx - 1];
        state.photos[idx - 1] = temp;
        renderPageManageList();
      }
    };
  });

  container.querySelectorAll('.btn-move-page-down').forEach(btn => {
    btn.onclick = (e) => {
      const row = e.target.closest('[data-page-index]');
      const idx = parseInt(row.getAttribute('data-page-index'), 10);
      if (idx < state.photos.length - 1) {
        const temp = state.photos[idx];
        state.photos[idx] = state.photos[idx + 1];
        state.photos[idx + 1] = temp;
        renderPageManageList();
      }
    };
  });

  // Handle explicit Supervised Apply button
  const btnApply = container.querySelector('#btnApplyMatcherMapping');
  if (btnApply) {
    btnApply.onclick = () => {
      try {
        const plan = buildMatcherApplyPlan(state.photos, state.receiptItems);
        if (plan.conflictCount > 0) {
          alert(`พบข้อขัดแย้ง ${plan.conflictCount} รายการ — ไม่สามารถใช้งานการจับคู่ได้ กรุณาตรวจสอบหลักฐาน`);
          return;
        }
        if (plan.readyCount === 0) {
          alert('ยังไม่มีรายการที่พร้อมจับคู่ (ต้องมีหลักฐานที่ยืนยันแล้วและผล Matcher เป็น STRONG)');
          return;
        }

        const confirmProceed = confirm(
          `ยืนยันนำผลการจับคู่ Matcher ไปผูกกับพัสดุในหน้าจอหลักหรือไม่?\n\n` +
          `• รายการที่พร้อมจับคู่: ${plan.readyCount} / ${plan.totalApiCount} รายการ\n` +
          `• รายการที่ไม่มีหลักฐาน: ${plan.unmappedCount} รายการ\n\n` +
          `การจับคู่จะผูกรูปภาพกับพัสดุตามหลักฐานที่ยืนยันแล้วเท่านั้น (ไม่มีการเดา)`
        );
        if (!confirmProceed) return;

        const res = applyMatcherMapping();
        renderPageManageList();
        alert(`✓ ใช้งานผลการจับคู่เรียบร้อยแล้ว (${res.appliedCount} / ${res.totalCount} รายการ)\n\nหน้าจอหลักและแท็บรูปภาพได้รับการอัปเดตเรียบร้อยแล้ว`);
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการจับคู่: ' + err.message);
      }
    };
  }

  // Handle Filter Review Only button
  const filterBtn = container.querySelector('#btnFilterReviewOnly');
  if (filterBtn) {
    filterBtn.onclick = () => {
      state.filterReviewOnly = !state.filterReviewOnly;
      renderPageManageList();
    };
  }
}

function showEmptyPhotoState() {
  const img = document.getElementById('receiptImage');
  const hint = document.getElementById('activeItemHint');
  if (img) {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
  if (hint) hint.textContent = 'ยังไม่มีรูป';
}

function revokeUserPhotoUrls() {
  state.photos.forEach(photo => {
    if (photo && photo.isUserUploaded && typeof photo.file === 'string' && photo.file.startsWith('blob:')) {
      URL.revokeObjectURL(photo.file);
    }
  });
}

function startNewSession() {
  if (typeof autoSaveTimer !== 'undefined' && autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  revokeUserPhotoUrls();
  state.receiptItems = [];
  state.excelMap.clear();
  state.currentFilter = 'all';
  state.searchQuery = '';
  state.activeItemNo = 1;
  state.activePhotoIndex = 0;
  state.zoom = 1;
  state.rotation = 0;
  state.photos = [];
  state.rawCaptureImage = null;
  state.currentSessionId = null;
  state.matcherAppliedSignature = null;
  state.matcherApplyInfo = null;
  state.lastPreApplySnapshot = null;
  state.trackSource = null;
  state.apiFeedback = null;
  state.filterReviewOnly = false;

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('thp_latest_cropped_receipt');
    localStorage.removeItem('thp_latest_session_id');
  }
  updateAutoSaveIndicator('idle');

  if (typeof document !== 'undefined') {
    const trInput = document.getElementById('trNumberInput');
    if (trInput) trInput.value = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    const imageInput = document.getElementById('imageFileInput');
    if (imageInput) imageInput.value = '';
    const excelInput = document.getElementById('excelFileInput');
    if (excelInput) excelInput.value = '';
    const zoomInd = document.getElementById('zoomLevelIndicator');
    if (zoomInd) zoomInd.textContent = '100%';

    const sourceBadgeEl = document.getElementById('sourceBadge');
    if (sourceBadgeEl) {
      sourceBadgeEl.textContent = '';
      sourceBadgeEl.classList.add('hidden');
    }

    document.querySelectorAll('.filter-btn').forEach(btn => {
      const isAll = btn.getAttribute('data-filter') === 'all';
      btn.className = 'filter-btn px-2 py-0.5 rounded font-medium ' +
        (isAll ? 'text-slate-700 bg-white shadow-xs' : 'text-slate-500');
    });

    const pageManageList = document.getElementById('pageManageList');
    if (pageManageList) pageManageList.innerHTML = '';
    const modal = document.getElementById('pageManageModal');
    if (modal) modal.classList.add('hidden');
  }

  renderPhotoTabs();
  renderItems();
  updateStats();
  showEmptyPhotoState();
}

function setupMobileTabs() {
  const btnSplit = document.getElementById('btnMobileTabSplit');
  const btnReceipt = document.getElementById('btnMobileTabReceipt');
  const btnList = document.getElementById('btnMobileTabList');

  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');

  const updateButtons = (activeBtn) => {
    [btnSplit, btnReceipt, btnList].forEach(btn => {
      if (btn) btn.className = 'mobile-tab-btn px-2 py-1 rounded text-[11px] font-medium text-slate-500';
    });
    if (activeBtn) {
      activeBtn.className = 'mobile-tab-btn px-2 py-1 rounded text-[11px] font-semibold bg-white text-slate-800 shadow-xs';
    }
  };

  btnSplit.onclick = () => {
    state.mobileViewMode = 'split';
    leftPanel.classList.remove('hidden', 'w-full');
    rightPanel.classList.remove('hidden', 'w-full');
    leftPanel.classList.add('w-1/2');
    rightPanel.classList.add('w-1/2');
    updateButtons(btnSplit);
  };

  btnReceipt.onclick = () => {
    state.mobileViewMode = 'receipt';
    leftPanel.classList.remove('hidden', 'w-1/2');
    leftPanel.classList.add('w-full');
    rightPanel.classList.add('hidden');
    updateButtons(btnReceipt);
  };

  btnList.onclick = () => {
    state.mobileViewMode = 'list';
    rightPanel.classList.remove('hidden', 'w-1/2');
    rightPanel.classList.add('w-full');
    leftPanel.classList.add('hidden');
    updateButtons(btnList);
  };
}

function setupPhotoControls() {
  const img = document.getElementById('receiptImage');
  const zoomIndicator = document.getElementById('zoomLevelIndicator');

  const updateTransform = () => {
    img.style.transform = "scale(" + state.zoom + ") rotate(" + state.rotation + "deg)";
    zoomIndicator.textContent = Math.round(state.zoom * 100) + "%";
  };

  document.getElementById('btnZoomIn').onclick = () => {
    state.zoom = Math.min(state.zoom + 0.25, 4.0);
    updateTransform();
  };

  document.getElementById('btnZoomOut').onclick = () => {
    state.zoom = Math.max(state.zoom - 0.25, 0.4);
    updateTransform();
  };

  document.getElementById('btnRotate').onclick = () => {
    state.rotation = (state.rotation + 90) % 360;
    updateTransform();
  };

  document.getElementById('btnResetZoom').onclick = () => {
    state.zoom = 1;
    state.rotation = 0;
    updateTransform();
  };
}

function renderPhotoTabs() {
  const container = document.getElementById('photoTabsContainer');
  if (!container) return;
  container.innerHTML = '';

  state.photos.forEach((photo, idx) => {
    const btn = document.createElement('button');
    btn.className = "px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-[11px] font-medium transition " + (
      state.activePhotoIndex === idx 
        ? 'bg-red-600 text-white shadow-xs' 
        : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
    );
    btn.textContent = "หน้า " + (idx + 1);
    btn.title = photo.label;
    btn.onclick = () => switchPhoto(idx, true);
    container.appendChild(btn);
  });
}

function switchPhoto(index, scrollRightList = false) {
  if (index < 0 || index >= state.photos.length) return;
  state.activePhotoIndex = index;
  if (typeof document !== 'undefined') {
    const img = document.getElementById('receiptImage');
    if (img) {
      img.classList.remove('hidden');
      img.src = state.photos[index].file;
    }
  }
  renderPhotoTabs();
  updatePhotoIdentityBadge();

  if (scrollRightList && state.isSyncEnabled) {
    const photoMeta = state.photos[index];
    if (photoMeta && photoMeta.startNo) {
      scrollToItem(photoMeta.startNo);
    }
  }
}

function setupSyncScroll() {
  const toggle = document.getElementById('syncScrollToggle');
  toggle.addEventListener('change', (e) => {
    state.isSyncEnabled = e.target.checked;
  });

  const rightList = document.getElementById('itemsList');
  const leftContainer = document.getElementById('receiptContainer');

  let scrollTimeout;
  rightList.addEventListener('scroll', () => {
    if (!state.isSyncEnabled || state.isScrollingByProgram) return;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      syncLeftWithRightScroll();
    }, 80);
  });

  let leftScrollTimeout;
  leftContainer.addEventListener('scroll', () => {
    if (!state.isSyncEnabled || state.isScrollingByProgram) return;

    clearTimeout(leftScrollTimeout);
    leftScrollTimeout = setTimeout(() => {
      syncRightWithLeftScroll();
    }, 100);
  });
}

function syncLeftWithRightScroll() {
  const rightList = document.getElementById('itemsList');
  const cards = Array.from(rightList.children);
  const containerTop = rightList.getBoundingClientRect().top;

  let topVisibleItem = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom > containerTop + 60) {
      const itemNo = parseInt(card.id.replace('card-item-', ''));
      topVisibleItem = state.receiptItems.find(i => i.no === itemNo);
      break;
    }
  }

  if (topVisibleItem && typeof topVisibleItem.photoIndex === 'number') {
    if (topVisibleItem.photoIndex !== state.activePhotoIndex) {
      switchPhoto(topVisibleItem.photoIndex, false);
    }
    highlightItemNo(topVisibleItem.no);
  }
}

function syncRightWithLeftScroll() {
  const leftContainer = document.getElementById('receiptContainer');
  const maxScroll = leftContainer.scrollHeight - leftContainer.clientHeight;
  if (maxScroll <= 0) return;

  const currentPhoto = state.photos[state.activePhotoIndex];
  if (!currentPhoto || !currentPhoto.startNo || !currentPhoto.endNo) return;

  const scrollRatio = leftContainer.scrollTop / maxScroll;
  const countInPage = currentPhoto.endNo - currentPhoto.startNo + 1;
  const targetItemNo = Math.min(
    currentPhoto.endNo,
    Math.max(currentPhoto.startNo, currentPhoto.startNo + Math.floor(scrollRatio * countInPage))
  );

  scrollToItem(targetItemNo);
}

function scrollToItem(itemNo) {
  const card = document.getElementById('card-item-' + itemNo);
  const rightList = document.getElementById('itemsList');
  if (card && rightList) {
    state.isScrollingByProgram = true;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlightItemNo(itemNo);
    setTimeout(() => {
      state.isScrollingByProgram = false;
    }, 400);
  }
}

function highlightItemNo(itemNo) {
  state.activeItemNo = itemNo;
  document.querySelectorAll('#itemsList > div').forEach(c => c.classList.remove('highlight-active', 'bg-red-50/20'));
  const activeCard = document.getElementById('card-item-' + itemNo);
  if (activeCard) {
    activeCard.classList.add('highlight-active', 'bg-red-50/20');
  }
  const item = state.receiptItems.find(i => i.no === itemNo);
  if (item) {
    document.getElementById('activeItemHint').textContent = '#' + item.no + ' ' + item.recipient;
  }
}

// ----------------------------------------------------
// MICROSOFT LENS / ADOBE SCAN STYLE CAMERA & CORNERS
// ----------------------------------------------------
function setupLensCamera() {
  const cameraModal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  const btnOpen = document.getElementById('btnOpenCamera');
  const btnClose = document.getElementById('btnCloseCameraModal');
  const btnCancel = document.getElementById('btnCancelCamera');
  const btnCapture = document.getElementById('btnCapturePhoto');
  const btnSwitch = document.getElementById('btnSwitchCamera');

  async function startCamera() {
    try {
      if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
      }
      const constraints = {
        video: {
          facingMode: state.cameraFacingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = state.cameraStream;
      cameraModal.classList.remove('hidden');
    } catch (err) {
      alert('ไม่สามารถเข้าถึงกล้องได้: ' + err.message);
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    cameraModal.classList.add('hidden');
  }

  btnOpen.onclick = () => startCamera();
  btnClose.onclick = () => stopCamera();
  btnCancel.onclick = () => stopCamera();

  btnSwitch.onclick = () => {
    state.cameraFacingMode = state.cameraFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  };

  btnCapture.onclick = () => {
    if (!video.videoWidth) return;

    // Capture raw full frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    state.rawCaptureImage = tempCanvas;
    stopCamera();

    // Open Step 2: Adobe Scan 4-Corner Editor
    openCornerCropEditor();
  };
}

function openCornerCropEditor() {
  const modal = document.getElementById('cornerCropModal');
  const canvas = document.getElementById('cropEditorCanvas');
  const img = state.rawCaptureImage;
  if (!img) return;

  modal.classList.remove('hidden');

  // Fit canvas into container view
  const container = document.getElementById('cropEditorContainer');
  const maxWidth = container.clientWidth - 20;
  const maxHeight = container.clientHeight - 20;

  let dw = img.width;
  let dh = img.height;
  const ratio = Math.min(maxWidth / dw, maxHeight / dh, 1.0);

  canvas.width = Math.round(dw * ratio);
  canvas.height = Math.round(dh * ratio);
  state.editorDisplayRatio = ratio;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Initial Smart Detection (Receipt Aspect approx width 65%, height 90%)
  const w = canvas.width;
  const h = canvas.height;
  const insetX = w * 0.15;
  const insetY = h * 0.05;

  state.cropCorners = {
    tl: { x: insetX, y: insetY },
    tr: { x: w - insetX, y: insetY },
    br: { x: w - insetX, y: h - insetY },
    bl: { x: insetX, y: h - insetY }
  };

  updateHandlePositions();
}

function updateHandlePositions() {
  const canvas = document.getElementById('cropEditorCanvas');
  const rect = canvas.getBoundingClientRect();
  const containerRect = document.getElementById('cropEditorContainer').getBoundingClientRect();

  const offsetX = rect.left - containerRect.left;
  const offsetY = rect.top - containerRect.top;

  const setPos = (id, pt) => {
    const el = document.getElementById(id);
    el.style.left = (offsetX + pt.x) + 'px';
    el.style.top = (offsetY + pt.y) + 'px';
  };

  setPos('handleTL', state.cropCorners.tl);
  setPos('handleTR', state.cropCorners.tr);
  setPos('handleBR', state.cropCorners.br);
  setPos('handleBL', state.cropCorners.bl);

  // Update SVG Polygon
  const poly = document.getElementById('cropPolygon');
  const pts = [
    (offsetX + state.cropCorners.tl.x) + ',' + (offsetY + state.cropCorners.tl.y),
    (offsetX + state.cropCorners.tr.x) + ',' + (offsetY + state.cropCorners.tr.y),
    (offsetX + state.cropCorners.br.x) + ',' + (offsetY + state.cropCorners.br.y),
    (offsetX + state.cropCorners.bl.x) + ',' + (offsetY + state.cropCorners.bl.y)
  ].join(' ');
  poly.setAttribute('points', pts);
}

function setupCornerCropEditor() {
  const container = document.getElementById('cropEditorContainer');
  let activeHandle = null;

  const handles = [
    { id: 'handleTL', key: 'tl' },
    { id: 'handleTR', key: 'tr' },
    { id: 'handleBR', key: 'br' },
    { id: 'handleBL', key: 'bl' }
  ];

  const onPointerDown = (key, e) => {
    e.preventDefault();
    activeHandle = key;
  };

  handles.forEach(h => {
    const el = document.getElementById(h.id);
    el.addEventListener('pointerdown', (e) => onPointerDown(h.key, e));
  });

  const onPointerMove = (e) => {
    if (!activeHandle) return;
    const canvas = document.getElementById('cropEditorCanvas');
    const rect = canvas.getBoundingClientRect();

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    const x = Math.max(0, Math.min(canvas.width, clientX - rect.left));
    const y = Math.max(0, Math.min(canvas.height, clientY - rect.top));

    state.cropCorners[activeHandle] = { x, y };
    updateHandlePositions();
  };

  const onPointerUp = () => {
    activeHandle = null;
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  document.getElementById('btnRetakePhoto').onclick = () => {
    document.getElementById('cornerCropModal').classList.add('hidden');
    document.getElementById('btnOpenCamera').click();
  };

  document.getElementById('btnAutoFitCorners').onclick = () => {
    const canvas = document.getElementById('cropEditorCanvas');
    const w = canvas.width;
    const h = canvas.height;
    state.cropCorners = {
      tl: { x: w * 0.12, y: h * 0.04 },
      tr: { x: w * 0.88, y: h * 0.04 },
      br: { x: w * 0.88, y: h * 0.96 },
      bl: { x: w * 0.12, y: h * 0.96 }
    };
    updateHandlePositions();
  };

  // Confirm and Crop with Perspective Straightening
  document.getElementById('btnConfirmCrop').onclick = () => {
    applyPerspectiveCrop();
  };
}

function applyPerspectiveCrop() {
  const rawCanvas = state.rawCaptureImage;
  if (!rawCanvas) return;

  const ratio = state.editorDisplayRatio || 1;
  const c = state.cropCorners;

  // 1. Scale corners back to original high-res camera dimensions
  const tl = { x: Math.max(0, c.tl.x / ratio), y: Math.max(0, c.tl.y / ratio) };
  const tr = { x: Math.min(rawCanvas.width, c.tr.x / ratio), y: Math.max(0, c.tr.y / ratio) };
  const br = { x: Math.min(rawCanvas.width, c.br.x / ratio), y: Math.min(rawCanvas.height, c.br.y / ratio) };
  const bl = { x: Math.max(0, c.bl.x / ratio), y: Math.min(rawCanvas.height, c.bl.y / ratio) };

  // 2. Calculate actual cropped bounding box accurately
  const minX = Math.round(Math.min(tl.x, bl.x));
  const maxX = Math.round(Math.max(tr.x, br.x));
  const minY = Math.round(Math.min(tl.y, tr.y));
  const maxY = Math.round(Math.max(bl.y, br.y));

  const cropW = Math.max(20, maxX - minX);
  const cropH = Math.max(20, maxY - minY);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = cropW;
  outCanvas.height = cropH;
  const ctx = outCanvas.getContext('2d');

  // 3. Draw EXACT cropped region from camera image
  ctx.drawImage(rawCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  // 4. Contrast enhancement (Adobe Scan style document filter)
  try {
    const imgData = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
    const d = imgData.data;
    const contrast = 1.15;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < d.length; i += 4) {
      d[i] = factor * (d[i] - 128) + 128;
      d[i+1] = factor * (d[i+1] - 128) + 128;
      d[i+2] = factor * (d[i+2] - 128) + 128;
    }
    ctx.putImageData(imgData, 0, 0);
  } catch(e) {}

  const dataUrl = outCanvas.toDataURL('image/jpeg', 0.92);
  document.getElementById('cornerCropModal').classList.add('hidden');

  // 5. Add as first tab and switch to it immediately
  const newPhotoObj = {
    label: 'ภาพที่ตัดขอบสด',
    file: dataUrl,
    startNo: 1,
    endNo: 26,
    isUserUploaded: true
  };

  state.photos.unshift(newPhotoObj);
  state.activePhotoIndex = 0;
  alignReceiptItemsToPhotos();

  // Set image directly
  const imgEl = document.getElementById('receiptImage');
  if (imgEl) {
    imgEl.classList.remove('hidden');
    imgEl.src = dataUrl;
  }

  renderPhotoTabs();
  triggerAutoSave();
  alert('บันทึกรูปภาพใบเสร็จตามกรอบที่ปรับเรียบร้อยแล้ว!');

  // Background non-blocking OCR header extraction on cropped image
  processPhotoHeaderIdentity(newPhotoObj);
}

// API Modal Settings
function setupApiModal() {
  const modal = document.getElementById('apiSettingsModal');
  const btnOpen = document.getElementById('btnOpenApiModal');
  const btnEditZip = document.getElementById('btnEditZipPrefix');
  const btnClose = document.getElementById('btnCloseApiModal');
  const btnCancel = document.getElementById('btnCancelApiModal');
  const btnSave = document.getElementById('btnSaveApiSettings');

  const openModal = () => modal.classList.remove('hidden');
  const closeModal = () => modal.classList.add('hidden');

  btnOpen.onclick = openModal;
  btnEditZip.onclick = openModal;
  btnClose.onclick = closeModal;
  btnCancel.onclick = closeModal;

  btnSave.onclick = () => {
    const zip = document.getElementById('apiZipPrefixInput').value.trim() || '10501';
    const token = document.getElementById('apiTokenInput').value.trim();
    const tokenChanged = token !== state.apiToken;

    state.defaultZipPrefix = zip;
    state.apiToken = token;

    if (tokenChanged) clearCachedApiAccessToken();

    localStorage.setItem('thp_zip_prefix', zip);
    localStorage.setItem('thp_api_token', token);

    document.getElementById('labelZipPrefix').textContent = '(' + zip + ')';
    closeModal();
    alert('บันทึก Token Key เรียบร้อยแล้ว ระบบจะขอ Access Token ให้อัตโนมัติเมื่อดึง TR');
  };
}

const TRACK_API_BASE = 'https://trackapi.thailandpost.co.th/post/api/v1';

function clearCachedApiAccessToken() {
  state.apiAccessToken = '';
  state.apiAccessTokenExpire = '';
  localStorage.removeItem('thp_api_access_token');
  localStorage.removeItem('thp_api_access_token_expire');
}

function parseApiExpire(expire) {
  if (!expire) return 0;
  const normalized = String(expire).trim().replace(' ', 'T');
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function hasUsableApiAccessToken() {
  if (!state.apiAccessToken) return false;
  const expireAt = parseApiExpire(state.apiAccessTokenExpire);
  return expireAt > Date.now() + 60_000;
}

async function requestApiAccessToken({ force = false } = {}) {
  if (!force && hasUsableApiAccessToken()) return state.apiAccessToken;

  clearCachedApiAccessToken();
  const response = await fetch(TRACK_API_BASE + '/authenticate/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Token ' + state.apiToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error('AUTH_FAILED');
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (!data?.token) throw new Error('AUTH_TOKEN_MISSING');

  state.apiAccessToken = data.token;
  state.apiAccessTokenExpire = data.expire || '';
  localStorage.setItem('thp_api_access_token', state.apiAccessToken);
  localStorage.setItem('thp_api_access_token_expire', state.apiAccessTokenExpire);
  return state.apiAccessToken;
}

async function requestReceiptTracking(fullTRCode, { retryAuth = true } = {}) {
  const accessToken = await requestApiAccessToken();
  const codesToQuery = new Set();

  if (Array.isArray(fullTRCode)) {
    fullTRCode.forEach(c => c && codesToQuery.add(String(c).trim()));
  } else if (typeof fullTRCode === 'string' && fullTRCode.trim()) {
    codesToQuery.add(fullTRCode.trim());
  }

  // Also include candidate codes if available
  const zip = state.defaultZipPrefix || '10501';
  (state.photos || []).forEach(p => {
    if (p.detectedRcpt) {
      const cleanRcpt = String(p.detectedRcpt).replace(/\D/g, '');
      if (cleanRcpt) {
        codesToQuery.add(`${zip}|${cleanRcpt}`);
      }
    }
    if (p.detectedTR) {
      const cleanTr = String(p.detectedTR).replace(/\D/g, '');
      if (cleanTr) {
        codesToQuery.add(`${zip}|${cleanTr}`);
      }
    }
  });

  const receiptNoArray = Array.from(codesToQuery);

  const response = await fetch(TRACK_API_BASE + '/receipt/track', {
    method: 'POST',
    headers: {
      'Authorization': 'Token ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'all',
      language: 'TH',
      receiptNo: receiptNoArray.length > 0 ? receiptNoArray : [fullTRCode]
    })
  });

  if (retryAuth && (response.status === 401 || response.status === 403)) {
    await requestApiAccessToken({ force: true });
    return requestReceiptTracking(fullTRCode, { retryAuth: false });
  }

  return response;
}

function extractReceiptApiItems(json) {
  const directItems = json?.response?.items;
  if (Array.isArray(directItems)) return directItems;

  const receipts = json?.response?.receipts;
  if (!receipts || typeof receipts !== 'object') return [];

  const itemsByBarcode = new Map();
  Object.values(receipts).forEach(receipt => {
    if (!receipt || typeof receipt !== 'object') return;
    Object.entries(receipt).forEach(([barcode, statuses]) => {
      const statusList = Array.isArray(statuses) ? statuses : [statuses];
      const latest = statusList.filter(Boolean).at(-1) || {};
      itemsByBarcode.set(cleanTrackNo(latest.barcode || barcode), {
        ...latest,
        barcode: latest.barcode || barcode
      });
    });
  });

  return Array.from(itemsByBarcode.values()).filter(item => cleanTrackNo(item.barcode));
}

function buildReceiptCode(zipPrefix, trNumber) {
  const zip = String(zipPrefix || '').replace(/\D/g, '');
  const trDigits = String(trNumber || '').replace(/\D/g, '');
  return {
    zip,
    trDigits,
    fullCode: zip + '|' + trDigits
  };
}

async function fetchTrackingByTR(trNumber) {
  const { zip, trDigits, fullCode: fullTRCode } = buildReceiptCode(state.defaultZipPrefix, trNumber);
  const btnFetchTR = document.getElementById('btnFetchTR');

  if (state.receiptItems.length > 0) {
    const confirmReplace = confirm(
      'ขณะนี้มีงานที่กำลังทำอยู่\nต้องการแทนที่รายการ Track เดิมด้วยข้อมูลใหม่หรือไม่?\n\n' +
      '(กด ตกลง เพื่อเริ่มงานใหม่และดึงข้อมูล หรือ ยกเลิก เพื่อทำงานเดิมต่อ)'
    );
    if (!confirmReplace) return;
    startNewSession();
  }

  btnFetchTR.disabled = true;
  btnFetchTR.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    if (zip.length !== 5 || !trDigits) {
      alert('กรุณาตรวจสอบรหัสไปรษณีย์ 5 หลักและเลข TR ให้ถูกต้อง');
      return;
    }

    if (!state.apiToken) {
      const openSettings = confirm(
        'ยังไม่ได้ตั้งค่า Token สำหรับเชื่อมต่อ API\n\n' +
        'รหัส: ' + fullTRCode + '\nต้องการเปิดหน้าตั้งค่า Token หรือไม่?'
      );
      if (openSettings) document.getElementById('btnOpenApiModal').click();
      return;
    }

    const response = await requestReceiptTracking(fullTRCode);

    if (response.status === 401 || response.status === 403) {
      state.apiFeedback = { type: 'auth_error' };
      renderItems();
      const openSettings = confirm(
        'ระบบขอ Access Token ใหม่แล้ว แต่ยังไม่มีสิทธิ์เรียกข้อมูลใบเสร็จ\n' +
        'สถานะ: ' + response.status + '\n\nต้องการเปิดหน้าตั้งค่า Token หรือไม่?'
      );
      if (openSettings) document.getElementById('btnOpenApiModal').click();
      return;
    }

    if (response.status === 429) {
      state.apiFeedback = { type: 'quota', message: 'HTTP 429' };
      renderItems();
      alert('เรียก API ถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (สถานะ 429)');
      return;
    }

    if (response.status === 404) {
      state.apiFeedback = { type: 'empty', trCode: fullTRCode };
      renderItems();
      alert('ไม่พบข้อมูลเลข TR นี้ในระบบ API (รหัส: ' + fullTRCode + ')');
      return;
    }

    if (!response.ok) {
      alert('API ขัดข้องหรือไม่สามารถให้บริการได้ในขณะนี้ (สถานะ ' + response.status + ')');
      return;
    }

    const json = await response.json();

    // [DEBUG] — Structural inspection only, no PII dump, in-memory only
    try { inspectRawApiResponse(json, response.status); } catch (_e) { /* inspector must not break fetch */ }

    // 1. Check application-level error before parsing items
    if (json?.status === false) {
      const msg = String(json?.message || 'คำขอถูกปฏิเสธโดยระบบ ปณท');
      const isQuota = /quota|over\s*quota/i.test(msg);

      if (isQuota) {
        state.apiFeedback = { type: 'quota', message: msg };
        renderItems();
        alert('⚠️ API ปณท เกินโควตาการเรียกใช้งาน\n\nระบบ ปณท ปฏิเสธคำขอชั่วคราว: ' + msg);
      } else {
        alert('API ปณท ปฏิเสธคำขอ: ' + msg);
      }
      return;
    }

    const items = extractReceiptApiItems(json);
    if (Array.isArray(items) && items.length > 0) {
      state.trackSource = 'api';
      state.apiFeedback = null;
      processApiItems(items);
      alert('ดึงข้อมูลสำเร็จผ่าน API: ' + items.length + ' รายการ');
      return;
    }

    state.apiFeedback = { type: 'empty', trCode: fullTRCode };
    renderItems();
    alert('API ตอบกลับสำเร็จ แต่ไม่พบรายการสำหรับเลข TR นี้ (รหัส: ' + fullTRCode + ')');
  } catch (err) {
    console.error(err);
    if (err.message === 'AUTH_FAILED') {
      state.apiFeedback = { type: 'auth_error' };
      renderItems();
      const openSettings = confirm(
        'ไม่สามารถขอ Access Token จาก Token Key ได้\n' +
        'สถานะ: ' + (err.status || '-') +
        '\n\nต้องการเปิดหน้าตั้งค่า Token ในแอปหรือไม่?'
      );
      if (openSettings) document.getElementById('btnOpenApiModal').click();
    } else if (err.message === 'AUTH_TOKEN_MISSING') {
      alert('API ตอบกลับมาแต่ไม่พบ Access Token กรุณาลองใหม่หรือตรวจสอบสถานะบริการ');
    } else {
      alert('เชื่อมต่อ Track API ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตหรือข้อจำกัด CORS ของเบราว์เซอร์แล้วลองใหม่');
    }
  } finally {
    btnFetchTR.disabled = false;
    btnFetchTR.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> <span class="hidden sm:inline">ดึง TR</span>';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHER ENGINE — SHADOW MODE ADAPTER (Phase 1 & Phase 1.5 & Phase 2A)
// Non-blocking, isolated, zero state mutation.
// ─────────────────────────────────────────────────────────────────────────────
let matcherShadowResult = null; // In-memory diagnostic only, never stored in DB or localStorage

/**
 * buildMatcherPaperEvidence:
 * Pure adapter converting existing photo metadata and manual sequence evidence
 * into structured paper evidence.
 *
 * Provenance Rules:
 * - If photo has userConfirmed: source = 'manual'
 * - If photo has detectedRcpt without userConfirmed: source = 'ocr'
 * - If neither: rcptNo = null, source = null
 * - Sequences/Tracks: extracted from photo.sequences (manual evidence) or explicitly provided.
 * - Strictly NO seqNo from item.no, apiIndex+1, or photo.startNo.
 * - Strictly NO firstTrack/lastTrack generated from API array via arithmetic.
 *
 * @param {object[]|null} photos
 * @returns {{ trNo: string|null, rcptNo: string|null, rcptSource: string|null, rcptList: object[], sequences: object[] }}
 */
function buildMatcherPaperEvidence(photos) {
  if (!Array.isArray(photos) || photos.length === 0) {
    return {
      trNo: null,
      rcptNo: null,
      rcptSource: null,
      rcptList: [],
      sequences: []
    };
  }

  let detectedTR = null;
  const rcptMap = new Map(); // rcptNo -> { rcptNo, source, photoIndices: [] }
  const allSequences = [];
  const seqIdentityCounts = new Map(); // "rcptNo:seqNo" -> count

  photos.forEach((photo, idx) => {
    if (!photo) return;

    if (!detectedTR && photo.detectedTR) {
      detectedTR = String(photo.detectedTR).trim();
    }

    let photoRcpt = null;
    let photoSource = 'ocr';
    if (photo.detectedRcpt) {
      photoRcpt = String(photo.detectedRcpt).trim();
      photoSource = Boolean(photo.userConfirmed) ? 'manual' : 'ocr';

      if (!rcptMap.has(photoRcpt)) {
        rcptMap.set(photoRcpt, { rcptNo: photoRcpt, source: photoSource, photoIndices: [idx] });
      } else {
        const existing = rcptMap.get(photoRcpt);
        existing.photoIndices.push(idx);
        // Priority: MANUAL > OCR
        if (photoSource === 'manual' && existing.source !== 'manual') {
          existing.source = 'manual';
        }
      }
    }

    // Process manual sequences attached to this photo (Phase 2A)
    if (Array.isArray(photo.sequences)) {
      photo.sequences.forEach(s => {
        if (!s) return;
        const sRcpt = s.rcptNo ? String(s.rcptNo).trim() : photoRcpt;
        const sSeqNo = (s.seqNo !== null && s.seqNo !== undefined && s.seqNo !== '') ? Number(s.seqNo) : null;

        // Clean tracking numbers (whitespace & uppercase ONLY, Step 5)
        let normFirst = cleanTrackNo(s.firstTrack);
        let normLast = cleanTrackNo(s.lastTrack);
        let qty = (s.qty !== null && s.qty !== undefined && s.qty !== '') ? Number(s.qty) : null;

        // Support Single Track normalization (Step 4)
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

        // Track compound identity for duplicate protection (Step 7 & Step 11)
        if (seqObj.rcptNo && seqObj.seqNo !== null && Number.isFinite(seqObj.seqNo)) {
          const compKey = `${seqObj.rcptNo}:${seqObj.seqNo}`;
          seqIdentityCounts.set(compKey, (seqIdentityCounts.get(compKey) || 0) + 1);
        }

        allSequences.push(seqObj);
      });
    }
  });

  // Flag duplicate same RCPT + same seqNo (Step 11)
  allSequences.forEach(seq => {
    if (seq.rcptNo && seq.seqNo !== null && Number.isFinite(seq.seqNo)) {
      const compKey = `${seq.rcptNo}:${seq.seqNo}`;
      if ((seqIdentityCounts.get(compKey) || 0) > 1) {
        seq.isDuplicate = true;
        seq.duplicateReason = `DUPLICATE / NEEDS REVIEW: Same seqNo (${seq.seqNo}) appears multiple times under RCPT# ${seq.rcptNo}`;
      }
    }
  });

  const rcptList = Array.from(rcptMap.values());

  return {
    trNo: detectedTR,
    rcptNo: rcptList.length === 1 ? rcptList[0].rcptNo : null,
    rcptSource: rcptList.length === 1 ? rcptList[0].source : null,
    rcptList,
    sequences: allSequences
  };
}

/**
 * buildMatcherShadowInput:
 * Prepares input for Matcher.matchAll() with strict separation of API Track Data
 * and Receipt Evidence.
 *
 * Rules:
 * 1. ApiTrack comes from API response items only (cleanTrackNo).
 * 2. Sequences and RCPT# come from paper evidence only (e.g. OCR/manual).
 * 3. NEVER use item.no as seqNo (item.no is 1-based array index, not paper sequence).
 * 4. NEVER use API array order as paper sequence.
 * 5. If no paper evidence exists, sequences is empty or seqNo is null. No fake sequences.
 *
 * @param {object[]|null} rawApiItems
 * @param {object|object[]|null} paperEvidence
 * @returns {{ trNo: string, rcptNo: string|null, rcptSource: string|null, rcptList: object[], apiItems: object[], sequences: object[] }}
 */
function buildMatcherShadowInput(rawApiItems = null, paperEvidence = null) {
  const trInputEl = typeof document !== 'undefined' ? document.getElementById('trNumberInput') : null;
  const currentTrVal = trInputEl && trInputEl.value ? trInputEl.value.trim() : '';

  // Extract paper evidence if passed, or build from state.photos
  let evidence;
  if (paperEvidence && typeof paperEvidence === 'object' && !Array.isArray(paperEvidence)) {
    evidence = paperEvidence;
  } else if (Array.isArray(paperEvidence)) {
    evidence = { sequences: paperEvidence, rcptList: [], rcptNo: null, rcptSource: null, trNo: null };
  } else {
    evidence = buildMatcherPaperEvidence(state?.photos);
  }

  const trNo = currentTrVal || evidence?.trNo || '';

  // 1. API Items: from passed argument or state.receiptItems
  const sourceItems = Array.isArray(rawApiItems)
    ? rawApiItems
    : (Array.isArray(state?.receiptItems) ? state.receiptItems : []);

  const apiItems = sourceItems
    .map(item => {
      if (!item) return null;
      const barcode = cleanTrackNo(item.barcode || item.track_no || item.trackNo);
      return barcode ? { barcode, raw: item } : null;
    })
    .filter(Boolean);

  // 2. Receipt Sequences: strictly from paper evidence, never fabricated
  let sequences = [];
  if (Array.isArray(evidence?.sequences)) {
    sequences = evidence.sequences;
  }

  return {
    trNo,
    rcptNo: evidence?.rcptNo || null,
    rcptSource: evidence?.rcptSource || null,
    rcptList: evidence?.rcptList || [],
    apiItems,
    sequences
  };
}

/**
 * runMatcherShadowValidation:
 * Executes Matcher.matchAll() in shadow mode with Mutation Guard.
 * Does NOT mutate state.receiptItems, photo ranges, item.no, or UI.
 * Wrapped in fail-safe try-catch so it never breaks app execution.
 *
 * @param {object[]|null} rawApiItems
 * @param {object|object[]|null} paperEvidence
 * @returns {object|null} shadow result diagnostics
 */
function runMatcherShadowValidation(rawApiItems = null, paperEvidence = null) {
  const matcher = (typeof window !== 'undefined' && window.Matcher)
    ? window.Matcher
    : (typeof Matcher !== 'undefined' ? Matcher : null);

  if (!matcher || typeof matcher.matchAll !== 'function') {
    return null;
  }

  // ── Step 8: Mutation Guard Snapshot ──────────────────────────────────────
  const itemsBefore = JSON.stringify(state?.receiptItems || []);
  const photosBefore = JSON.stringify((state?.photos || []).map(p => ({
    label: p.label,
    detectedTR: p.detectedTR,
    detectedRcpt: p.detectedRcpt,
    startNo: p.startNo,
    endNo: p.endNo,
    userConfirmed: p.userConfirmed
  })));

  const input = buildMatcherShadowInput(rawApiItems, paperEvidence);
  const result = matcher.matchAll(input);

  // Enforce duplicate protection on matched groups (Step 11)
  if (result && Array.isArray(result.groups)) {
    result.groups.forEach(group => {
      if (Array.isArray(group.sequences)) {
        group.sequences.forEach(seq => {
          if (seq.isDuplicate) {
            seq.confidence = matcher.MATCH_CONFIDENCE.CONFLICT;
            seq.conflictReason = seq.duplicateReason || `DUPLICATE / NEEDS REVIEW: Same seqNo (${seq.seqNo}) appears multiple times under RCPT# ${seq.rcptNo}`;
          }
        });
      }
    });
  }

  // Verify deep equality post-execution
  const itemsAfter = JSON.stringify(state?.receiptItems || []);
  const photosAfter = JSON.stringify((state?.photos || []).map(p => ({
    label: p.label,
    detectedTR: p.detectedTR,
    detectedRcpt: p.detectedRcpt,
    startNo: p.startNo,
    endNo: p.endNo,
    userConfirmed: p.userConfirmed
  })));

  if (itemsBefore !== itemsAfter || photosBefore !== photosAfter) {
    console.error('[Matcher Shadow] CRITICAL MUTATION GUARD: State was modified during shadow run!');
    throw new Error('STATE_MUTATION_DETECTED');
  }

  matcherShadowResult = {
    timestamp: new Date().toISOString(),
    inputSummary: {
      trNo: input.trNo,
      rcptNo: input.rcptNo,
      rcptSource: input.rcptSource,
      rcptList: input.rcptList,
      apiItemsCount: input.apiItems.length,
      sequencesCount: input.sequences.length,
      hasSequenceEvidence: input.sequences.length > 0,
      hasRangeEvidence: input.sequences.some(s => s.firstTrack && s.lastTrack && s.firstTrack !== s.lastTrack)
    },
    output: result,
    mutationGuardPassed: true
  };

  return matcherShadowResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHER ENGINE — PHASE 3: SUPERVISED MATCHER APPLY
// Strictly supervised, zero auto-apply, atomic transactions, evidence-preserving.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a deterministic signature of confirmed manual sequences across photos.
 * Used to detect when evidence has been modified after an Apply operation.
 */
function computeEvidenceSignature(photos) {
  if (!Array.isArray(photos)) return '';
  const tokens = [];
  photos.forEach((photo, pIdx) => {
    const rcpt = String(photo?.detectedRcpt || '').trim();
    (photo?.sequences || []).forEach(s => {
      tokens.push([
        pIdx,
        String(s.rcptNo || rcpt || '').trim(),
        s.seqNo ?? '',
        cleanTrackNo(s.firstTrack),
        cleanTrackNo(s.lastTrack),
        s.qty ?? ''
      ].join(':'));
    });
  });
  return tokens.sort().join('|');
}

/**
 * Checks if current confirmed evidence is stale compared to the signature applied previously.
 */
function isMatcherMappingStale(photos, appliedSignature) {
  if (!appliedSignature) return false;
  const currentSig = computeEvidenceSignature(photos);
  return currentSig !== appliedSignature;
}

/**
 * Builds a validated, non-destructive Apply Plan from confirmed manual evidence.
 * Does NOT mutate photos or receiptItems.
 *
 * Rules:
 * 1. Only considers sequences with provenance === 'manual' (or user confirmed).
 * 2. Matches via Matcher.matchSequence against the real API items array.
 * 3. Categorizes each sequence into Strong, Conflict, or Incomplete.
 * 4. Checks for conflicts and ambiguous mappings across photos.
 * 5. Returns a plan with readyCount, conflictCount, mappings array, and summary.
 */
function buildMatcherApplyPlan(photos, receiptItems) {
  let matcher = (typeof window !== 'undefined' && window.Matcher)
    ? window.Matcher
    : (typeof Matcher !== 'undefined' ? Matcher : null);

  if (!matcher && typeof require === 'function') {
    try { matcher = require('./matcher.js'); } catch (_e) {}
  }

  const items = Array.isArray(receiptItems) ? receiptItems : [];
  const safePhotos = Array.isArray(photos) ? photos : [];
  const signature = computeEvidenceSignature(safePhotos);

  const plan = {
    totalApiCount: items.length,
    readyCount: 0,
    conflictCount: 0,
    incompleteCount: 0,
    unmappedCount: items.length,
    isEligible: false,
    signature,
    mappings: new Array(items.length).fill(null),
    conflicts: [],
    incompletes: [],
    sequenceResults: []
  };

  if (!matcher || items.length === 0 || safePhotos.length === 0) {
    return plan;
  }

  // 1. Build track index from API items
  const { trackMap, apiTracks } = matcher.buildTrackIndex(items);

  // 2. Track which API indexes are already claimed:
  // apiIndex -> { photoIndex, sIdx, rcptNo, seqNo, trackNo }
  const claimedApiIndexes = new Map();

  safePhotos.forEach((photo, pIdx) => {
    const photoRcpt = photo?.detectedRcpt ? String(photo.detectedRcpt).trim() : null;
    const sequences = Array.isArray(photo?.sequences) ? photo.sequences : [];

    sequences.forEach((seq, sIdx) => {
      // RULE: Only confirmed manual evidence (provenance === 'manual' or present in photo.sequences)
      // Pending suggestions in photo.ocrSequenceSuggestions are NEVER evaluated here.
      const sRcpt = seq.rcptNo ? String(seq.rcptNo).trim() : photoRcpt;
      const sSeqNo = (seq.seqNo !== null && seq.seqNo !== undefined && seq.seqNo !== '') ? Number(seq.seqNo) : null;
      let fTrack = cleanTrackNo(seq.firstTrack);
      let lTrack = cleanTrackNo(seq.lastTrack);
      let qty = (seq.qty !== null && seq.qty !== undefined && seq.qty !== '') ? Number(seq.qty) : null;

      if (fTrack && (!lTrack || lTrack === fTrack)) {
        lTrack = fTrack;
        if (!qty) qty = 1;
      }

      const mockSeq = {
        rcptNo: sRcpt,
        seqNo: sSeqNo,
        firstTrack: fTrack || null,
        lastTrack: lTrack || null,
        qty
      };

      const matched = matcher.matchSequence(mockSeq, trackMap, apiTracks);
      const seqSummary = {
        photoIndex: pIdx,
        seqIndex: sIdx,
        rcptNo: sRcpt,
        seqNo: sSeqNo,
        firstTrack: fTrack,
        lastTrack: lTrack,
        qty,
        confidence: matched.confidence,
        conflictReason: matched.conflictReason,
        trackIndexes: matched.trackIndexes || []
      };
      plan.sequenceResults.push(seqSummary);

      if (matched.confidence === matcher.MATCH_CONFIDENCE.STRONG) {
        let hasCollision = false;
        let collisionReason = '';

        for (const apiIdx of matched.trackIndexes) {
          if (claimedApiIndexes.has(apiIdx)) {
            const prevClaim = claimedApiIndexes.get(apiIdx);
            if (prevClaim.photoIndex !== pIdx) {
              // Same track claimed across distinct photos - check if recognized adjacent overlap
              const isAdjacent = Math.abs(prevClaim.photoIndex - pIdx) <= 1;
              if (isAdjacent && matched.trackIndexes.length === 1) {
                // Single track overlap on adjacent photo boundary -> record as alternate
                if (plan.mappings[apiIdx]) {
                  plan.mappings[apiIdx].alternatePhotoIndex = pIdx;
                }
              } else {
                hasCollision = true;
                collisionReason = `API track "${apiTracks[apiIdx]}" is claimed by both Photo ${prevClaim.photoIndex + 1} (Seq ${prevClaim.seqNo ?? '-'}) and Photo ${pIdx + 1} (Seq ${sSeqNo ?? '-'})`;
                break;
              }
            }
          }
        }

        if (hasCollision) {
          plan.conflictCount++;
          plan.conflicts.push({
            photoIndex: pIdx,
            rcptNo: sRcpt,
            seqNo: sSeqNo,
            reason: collisionReason
          });
          seqSummary.confidence = matcher.MATCH_CONFIDENCE.CONFLICT;
          seqSummary.conflictReason = collisionReason;
        } else {
          matched.trackIndexes.forEach(apiIdx => {
            claimedApiIndexes.set(apiIdx, { photoIndex: pIdx, seqIndex: sIdx, rcptNo: sRcpt, seqNo: sSeqNo });
            if (!plan.mappings[apiIdx]) {
              plan.mappings[apiIdx] = {
                apiIndex: apiIdx,
                photoIndex: pIdx,
                rcptNo: sRcpt,
                seqNo: sSeqNo,
                trackNo: apiTracks[apiIdx],
                confidence: matcher.MATCH_CONFIDENCE.STRONG,
                scrollAnchor: getSequenceScrollAnchor(seq, sIdx, sequences.length)
              };
            }
          });
        }
      } else if (matched.confidence === matcher.MATCH_CONFIDENCE.CONFLICT) {
        plan.conflictCount++;
        plan.conflicts.push({
          photoIndex: pIdx,
          rcptNo: sRcpt,
          seqNo: sSeqNo,
          firstTrack: fTrack,
          lastTrack: lTrack,
          reason: matched.conflictReason
        });
      } else {
        plan.incompleteCount++;
        plan.incompletes.push({
          photoIndex: pIdx,
          rcptNo: sRcpt,
          seqNo: sSeqNo,
          reason: matched.conflictReason || 'หลักฐานไม่สมบูรณ์'
        });
      }
    });
  });

  const mappedCount = plan.mappings.filter(Boolean).length;
  plan.readyCount = mappedCount;
  plan.unmappedCount = items.length - mappedCount;
  plan.isEligible = plan.readyCount > 0 && plan.conflictCount === 0;

  return plan;
}

/**
 * Applies the validated Matcher mapping atomically.
 * Transactional: validate -> snapshot -> apply -> verify invariants -> save/render.
 * Rolls back on any error.
 */
function applyMatcherMapping({ targetState = null, dryRun = false } = {}) {
  const s = targetState || (typeof state !== 'undefined' ? state : null);
  if (!s || !Array.isArray(s.receiptItems) || !Array.isArray(s.photos)) {
    throw new Error('INVALID_STATE_FOR_APPLY');
  }

  const plan = buildMatcherApplyPlan(s.photos, s.receiptItems);

  if (plan.conflictCount > 0) {
    const reasons = plan.conflicts.map(c => `• ${c.reason}`).join('\n');
    throw new Error(`CONFLICTS_DETECTED: พบข้อขัดแย้ง ${plan.conflictCount} รายการ ไม่สามารถ Apply ได้:\n${reasons}`);
  }

  if (plan.readyCount === 0) {
    throw new Error('NO_READY_MAPPINGS: ไม่พบรายการที่มีหลักฐานตรงกับ API ในระดับ STRONG');
  }

  if (dryRun) {
    return { success: true, dryRun: true, plan };
  }

  // 1. Snapshot for rollback
  const rollbackSnapshot = {
    receiptItems: s.receiptItems.map(item => ({
      no: item.no,
      photoIndex: item.photoIndex,
      alternatePhotoIndex: item.alternatePhotoIndex,
      receiptSeqNo: item.receiptSeqNo,
      rcptNo: item.rcptNo,
      mappingSource: item.mappingSource
    })),
    photos: s.photos.map(p => ({
      startNo: p.startNo,
      endNo: p.endNo,
      mappingApplied: p.mappingApplied
    })),
    matcherAppliedSignature: s.matcherAppliedSignature || null,
    matcherApplyInfo: s.matcherApplyInfo ? { ...s.matcherApplyInfo } : null
  };

  try {
    // 2. Apply mapping
    plan.mappings.forEach((m, apiIdx) => {
      if (m && m.photoIndex !== undefined && s.receiptItems[apiIdx]) {
        s.receiptItems[apiIdx].photoIndex = m.photoIndex;
        if (m.alternatePhotoIndex !== undefined) {
          s.receiptItems[apiIdx].alternatePhotoIndex = m.alternatePhotoIndex;
        } else {
          delete s.receiptItems[apiIdx].alternatePhotoIndex;
        }
        s.receiptItems[apiIdx].receiptSeqNo = m.seqNo;
        s.receiptItems[apiIdx].rcptNo = m.rcptNo;
        s.receiptItems[apiIdx].mappingSource = 'matcher';
        if (typeof m.scrollAnchor === 'number' && Number.isFinite(m.scrollAnchor)) {
          s.receiptItems[apiIdx].scrollAnchor = m.scrollAnchor;
        }
      }
    });

    // 3. Update photo startNo / endNo based on mapped items to keep UI scroll sync aligned
    s.photos.forEach((photo, pIdx) => {
      const photoItems = s.receiptItems.filter(i => i.photoIndex === pIdx || i.alternatePhotoIndex === pIdx);
      if (photoItems.length > 0) {
        const itemNos = photoItems.map(i => Number(i.no)).filter(Number.isFinite);
        if (itemNos.length > 0) {
          photo.startNo = Math.min(...itemNos);
          photo.endNo = Math.max(...itemNos);
        }
      }
      photo.mappingApplied = true;
    });

    // 4. Invariant checks
    if (s.receiptItems.length !== rollbackSnapshot.receiptItems.length) {
      throw new Error('INVARIANT_VIOLATION: receiptItems count changed');
    }
    for (let i = 0; i < s.receiptItems.length; i++) {
      const it = s.receiptItems[i];
      if (typeof it.photoIndex === 'number' && (it.photoIndex < 0 || it.photoIndex >= s.photos.length)) {
        throw new Error(`INVARIANT_VIOLATION: invalid photoIndex ${it.photoIndex} on item ${it.no}`);
      }
    }

    // 5. Commit application metadata
    s.matcherAppliedSignature = plan.signature;
    s.matcherApplyInfo = {
      appliedAt: new Date().toISOString(),
      mappedCount: plan.readyCount,
      totalCount: s.receiptItems.length,
      unmappedCount: plan.unmappedCount
    };
    s.lastPreApplySnapshot = rollbackSnapshot;

    // 6. UI & Persistence updates (if in browser)
    if (typeof document !== 'undefined') {
      if (typeof renderItems === 'function') renderItems();
      if (typeof renderPhotoTabs === 'function') renderPhotoTabs();
      if (typeof updateStats === 'function') updateStats();
      if (typeof triggerAutoSave === 'function') triggerAutoSave();
    }

    return {
      success: true,
      plan,
      appliedCount: plan.readyCount,
      totalCount: s.receiptItems.length
    };
  } catch (err) {
    // Rollback snapshot on failure
    rollbackSnapshot.receiptItems.forEach((saved, idx) => {
      if (s.receiptItems[idx]) {
        s.receiptItems[idx].photoIndex = saved.photoIndex;
        s.receiptItems[idx].alternatePhotoIndex = saved.alternatePhotoIndex;
        s.receiptItems[idx].receiptSeqNo = saved.receiptSeqNo;
        s.receiptItems[idx].rcptNo = saved.rcptNo;
        s.receiptItems[idx].mappingSource = saved.mappingSource;
      }
    });
    rollbackSnapshot.photos.forEach((saved, idx) => {
      if (s.photos[idx]) {
        s.photos[idx].startNo = saved.startNo;
        s.photos[idx].endNo = saved.endNo;
        s.photos[idx].mappingApplied = saved.mappingApplied;
      }
    });
    s.matcherAppliedSignature = rollbackSnapshot.matcherAppliedSignature;
    s.matcherApplyInfo = rollbackSnapshot.matcherApplyInfo;
    throw err;
  }
}

/**
 * Rolls back state to the given snapshot.
 */
function rollbackMatcherMapping(snapshot, targetState = null) {
  const s = targetState || (typeof state !== 'undefined' ? state : null);
  if (!s || !snapshot || !Array.isArray(snapshot.receiptItems)) return false;

  snapshot.receiptItems.forEach((saved, idx) => {
    if (s.receiptItems[idx]) {
      s.receiptItems[idx].photoIndex = saved.photoIndex;
      s.receiptItems[idx].alternatePhotoIndex = saved.alternatePhotoIndex;
      s.receiptItems[idx].receiptSeqNo = saved.receiptSeqNo;
      s.receiptItems[idx].rcptNo = saved.rcptNo;
      s.receiptItems[idx].mappingSource = saved.mappingSource;
    }
  });

  if (Array.isArray(snapshot.photos)) {
    snapshot.photos.forEach((saved, idx) => {
      if (s.photos[idx]) {
        s.photos[idx].startNo = saved.startNo;
        s.photos[idx].endNo = saved.endNo;
        s.photos[idx].mappingApplied = saved.mappingApplied;
      }
    });
  }

  s.matcherAppliedSignature = snapshot.matcherAppliedSignature || null;
  s.matcherApplyInfo = snapshot.matcherApplyInfo || null;

  if (typeof document !== 'undefined') {
    if (typeof renderItems === 'function') renderItems();
    if (typeof renderPhotoTabs === 'function') renderPhotoTabs();
    if (typeof updateStats === 'function') updateStats();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
  return true;
}

if (typeof window !== 'undefined') {
  window.cleanTrackNo = cleanTrackNo;
  window.extractTrackCandidates = extractTrackCandidates;
  window.levenshteinDistance = levenshteinDistance;
  window.findApiTrackCandidate = findApiTrackCandidate;
  window.parseReceiptLineEvidence = parseReceiptLineEvidence;
  window.preprocessLinesForOcr = preprocessLinesForOcr;
  window.scanPhotoLineEvidence = scanPhotoLineEvidence;
  window.confirmOcrSuggestion = confirmOcrSuggestion;
  window.rejectOcrSuggestion = rejectOcrSuggestion;
  window.confirmAllOcrSuggestions = confirmAllOcrSuggestions;
  window.buildMatcherPaperEvidence = buildMatcherPaperEvidence;
  window.buildMatcherShadowInput = buildMatcherShadowInput;
  window.runMatcherShadowValidation = runMatcherShadowValidation;
  window.evaluateSequenceValidation = evaluateSequenceValidation;
  window.computeEvidenceSignature = computeEvidenceSignature;
  window.isMatcherMappingStale = isMatcherMappingStale;
  window.buildMatcherApplyPlan = buildMatcherApplyPlan;
  window.applyMatcherMapping = applyMatcherMapping;
  window.rollbackMatcherMapping = rollbackMatcherMapping;
  window.getMatcherShadowResult = () => matcherShadowResult;
  window.extractTrackingFromExcelRows = extractTrackingFromExcelRows;
  window.processExcelRows = processExcelRows;
  window.findRangeReviewCandidate = findRangeReviewCandidate;
  window.evaluateExcelRangeReview = evaluateExcelRangeReview;
  window.selectItem = selectItem;
  window.switchPhoto = switchPhoto;
  window.highlightItemNo = highlightItemNo;
  window.startNewSession = startNewSession;
  window.autoRestoreLatestSession = autoRestoreLatestSession;
  window.alignReceiptItemsToPhotos = alignReceiptItemsToPhotos;
  window.resolveReceiptRanges = resolveReceiptRanges;
  window.getSequenceScrollAnchor = getSequenceScrollAnchor;
  window.renderItems = renderItems;
  window.handleExcelUpload = handleExcelUpload;
  window.autoScanPhotoBatch = autoScanPhotoBatch;
  window.getTrackServicePrefix = getTrackServicePrefix;
  window.getPhotoServicePrefix = getPhotoServicePrefix;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanTrackNo,
    extractTrackCandidates,
    levenshteinDistance,
    findApiTrackCandidate,
    findRangeReviewCandidate,
    evaluateExcelRangeReview,
    parseReceiptLineEvidence,
    confirmOcrSuggestion,
    rejectOcrSuggestion,
    confirmAllOcrSuggestions,
    buildMatcherPaperEvidence,
    buildMatcherShadowInput,
    runMatcherShadowValidation,
    evaluateSequenceValidation,
    computeEvidenceSignature,
    isMatcherMappingStale,
    buildMatcherApplyPlan,
    applyMatcherMapping,
    rollbackMatcherMapping,
    buildReceiptCode,
    extractReceiptApiItems,
    processApiItems,
    fetchTrackingByTR,
    state,
    extractTrackingFromExcelRows,
    processExcelRows,
    selectItem,
    switchPhoto,
    highlightItemNo,
    startNewSession,
    autoRestoreLatestSession,
    alignReceiptItemsToPhotos,
    resolveReceiptRanges,
    getSequenceScrollAnchor,
    renderItems,
    handleExcelUpload,
    autoScanPhotoBatch,
    getTrackServicePrefix,
    getPhotoServicePrefix
  };
}

function processApiItems(items) {
  const nextReceiptItems = [];

  items.forEach(item => {
    const barcode = cleanTrackNo(item.barcode || item.track_no);
    if (!barcode) return;
    const apiStatusCode = String(item.status_code || item.status || '');

    nextReceiptItems.push({
      no: nextReceiptItems.length + 1,
      recipient: item.recipient_name || item.receiver_name || '-',
      weight: item.weight || '-',
      service: item.service_name || item.service || '-',
      zip: item.postcode || item.zipcode || item.destination_postcode || '-',
      destinationName: item.destination || item.delivery_office || '-',
      trackNo: barcode,
      trackFormatted: barcode,
      cost: Number(item.cost || item.amount || 0),
      discount: Number(item.discount || 0),
      remoteFee: Number(item.remote_fee || 0),
      extra: Number(item.extra || 0),
      photoIndex: 0
    });

    state.excelMap.set(barcode, {
      barcode: barcode,
      destination: item.destination || item.delivery_office || '',
      statusText: item.status_description || 'นำจ่ายสำเร็จ',
      statusDetail: item.receiver_name ? ('ชื่อผู้รับ: ' + item.receiver_name) : 'พัสดุถึงปลายทาง',
      statusDate: item.status_date || new Date().toLocaleDateString('th-TH'),
      statusType: (apiStatusCode === '501' || (item.status_description || '').includes('สำเร็จ')) ? 'success' : 'in_transit',
      depositDate: item.deposit_date || '-',
      baggingDate: item.bagging_date || '-'
    });
  });

  if (nextReceiptItems.length > 0) {
    state.receiptItems = nextReceiptItems;
    state.trackSource = 'api';
    state.apiFeedback = null;
    alignReceiptItemsToPhotos();
  }

  renderItems();
  updateStats();
  triggerAutoSave();

  // ── Matcher Integration: Phase 1 & 1.5 Shadow Mode Validation ───────────
  // Runs in background without mutating receiptItems, photos, item.no, or UI.
  if (typeof window !== 'undefined' && window.Matcher) {
    try {
      const paperEvidence = buildMatcherPaperEvidence(state.photos);
      const shadowResult = runMatcherShadowValidation(items, paperEvidence);
      console.debug('[Matcher Shadow]', shadowResult);
    } catch (err) {
      console.warn('[Matcher Shadow Error]', err);
    }
  }
}

function setupEventListeners() {
  const btnFetchTR = document.getElementById('btnFetchTR');
  const trInput = document.getElementById('trNumberInput');
  
  btnFetchTR.onclick = () => {
    const trVal = trInput.value.trim();
    if (!trVal) {
      alert('กรุณากรอกเลข TR');
      return;
    }
    fetchTrackingByTR(trVal);
  };

  trInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      btnFetchTR.click();
    }
  });

  trInput.addEventListener('input', () => {
    triggerAutoSave();
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderItems();
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.className = 'filter-btn px-2 py-0.5 rounded font-medium text-slate-500';
      });
      btn.className = 'filter-btn px-2 py-0.5 rounded font-medium text-slate-700 bg-white shadow-xs';
      state.currentFilter = btn.getAttribute('data-filter');
      renderItems();
    });
  });

  // Excel file upload
  document.getElementById('excelFileInput').addEventListener('change', handleExcelUpload);

  // User receipt image upload
  document.getElementById('imageFileInput').addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const firstNewIndex = state.photos.length;
    const newPhotos = sortReceiptPhotoBatch(files.map((file, selectionIndex) => ({
      label: file.name,
      sortName: file.name,
      lastModified: file.lastModified,
      selectionIndex,
      file: URL.createObjectURL(file),
      isUserUploaded: true
    })));

    state.photos.push(...newPhotos);
    alignReceiptItemsToPhotos();
    state.activePhotoIndex = firstNewIndex;
    switchPhoto(state.activePhotoIndex, false);
    e.target.value = '';
    triggerAutoSave();
    alert('เพิ่มรูปใบเสร็จ ' + newPhotos.length + ' ไฟล์ เรียงลำดับหน้า 1–' + state.photos.length + ' แล้ว');

    // Background non-blocking OCR header extraction for each new photo
    newPhotos.forEach(photo => {
      processPhotoHeaderIdentity(photo);
    });

    // Automatically scan line items and resolve ranges for all uploaded photos in the background
    autoScanPhotoBatch();
  });

  // Track Detail Modal
  const trackModal = document.getElementById('trackDetailModal');
  document.getElementById('btnCloseTrackModal').onclick = () => trackModal.classList.add('hidden');
  document.getElementById('btnCloseTrackModalBtn').onclick = () => trackModal.classList.add('hidden');

  // Reset
  document.getElementById('btnResetData').onclick = async () => {
    if (confirm('ต้องการล้างข้อมูลใบเสร็จ รูปภาพ และ Excel เพื่อเริ่มงานใหม่หรือไม่?\n\nรหัสต้นทางและการตั้งค่า API จะยังคงอยู่')) {
      try {
        const saved = hasCurrentWork() ? await saveCurrentSession({ silent: true }) : false;
        startNewSession();
        alert(saved
          ? 'บันทึกงานเดิมลงประวัติและเริ่มงานใหม่เรียบร้อยแล้ว'
          : 'ล้างข้อมูลงานเดิมแล้ว พร้อมเริ่มงานใหม่');
      } catch (error) {
        alert('ยังเริ่มงานใหม่ไม่ได้ เพราะบันทึกประวัติไม่สำเร็จ: ' + error.message);
      }
    }
  };
}

function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (state.receiptItems.length > 0) {
    const confirmReplace = confirm(
      'ขณะนี้มีงานที่กำลังทำอยู่\nต้องการแทนที่รายการ Track เดิมด้วยข้อมูลใหม่หรือไม่?\n\n' +
      '(กด ตกลง เพื่อเริ่มงานใหม่และนำเข้า Excel หรือ ยกเลิก เพื่อทำงานเดิมต่อ)'
    );
    if (!confirmReplace) {
      e.target.value = '';
      return;
    }
    startNewSession();
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      
      processExcelRows(json);
      if (state.photos.length > 0) {
        alignReceiptItemsToPhotos();
        autoScanPhotoBatch();
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

function extractTrackingFromExcelRows(rows) {
  // S10-style tracking number: 2 letters, 9 digits, 2 letters
  const barcodeRegex = /\b([A-Za-z]{2}\s*\d{9}\s*[A-Za-z]{2})\b/;
  const seen = new Set();
  const tracks = [];
  let rjCount = 0;
  let rrCount = 0;
  let otherCount = 0;
  let duplicateRows = 0;
  let skippedRows = 0;

  if (!Array.isArray(rows)) {
    return {
      tracks: [],
      uniqueCount: 0,
      rjCount: 0,
      rrCount: 0,
      otherCount: 0,
      duplicateRows: 0,
      skippedRows: 0,
      totalRows: 0
    };
  }

  rows.forEach((row, idx) => {
    // Skip header row if it contains column labels and no valid tracking
    if (idx === 0 && Array.isArray(row)) {
      const headerStr = row.join(' ');
      if (!barcodeRegex.test(headerStr) && (headerStr.includes('เลข') || headerStr.toLowerCase().includes('track') || headerStr.toLowerCase().includes('barcode'))) {
        skippedRows++;
        return;
      }
    }

    const rowStr = Array.isArray(row) ? row.join(' ') : String(row || '');
    const match = rowStr.match(barcodeRegex);
    if (match) {
      const cleanTrack = cleanTrackNo(match[1]);
      if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(cleanTrack)) {
        if (!seen.has(cleanTrack)) {
          seen.add(cleanTrack);
          tracks.push(cleanTrack);
          if (cleanTrack.startsWith('RJ')) {
            rjCount++;
          } else if (cleanTrack.startsWith('RR')) {
            rrCount++;
          } else {
            otherCount++;
          }
        } else {
          duplicateRows++;
        }

        // Parse status for excelMap if state exists
        if (typeof state !== 'undefined' && state.excelMap) {
          let statusText = 'พบข้อมูล';
          let statusDate = '';
          let statusType = 'pending';

          if (rowStr.includes('สำเร็จ') || rowStr.includes('นำจ่ายสำเร็จ') || rowStr.includes('ผู้รับรับเอง')) {
            statusText = 'นำจ่ายสำเร็จ';
            statusType = 'success';
          } else if (rowStr.includes('ระหว่างทาง') || rowStr.includes('ใส่ของลงถุง') || rowStr.includes('รับฝาก')) {
            statusText = 'อยู่ระหว่างจัดส่ง';
            statusType = 'in_transit';
          }

          const dateMatch = rowStr.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(\s+\d{1,2}:\d{2})?/);
          if (dateMatch) {
            statusDate = dateMatch[0];
          }

          const prev = state.excelMap.get(cleanTrack);
          if (!prev || prev.statusType !== 'success' || statusType === 'success') {
            state.excelMap.set(cleanTrack, {
              barcode: cleanTrack,
              destination: prev?.destination || '',
              statusText: statusText,
              statusDetail: rowStr,
              statusDate: statusDate || prev?.statusDate || new Date().toLocaleDateString('th-TH'),
              statusType: statusType,
              depositDate: 'Imported',
              baggingDate: '-'
            });
          }
        }
        return;
      }
    }
    skippedRows++;
  });

  return {
    tracks,
    uniqueCount: tracks.length,
    rjCount,
    rrCount,
    otherCount,
    duplicateRows,
    skippedRows,
    totalRows: rows.length
  };
}

function processExcelRows(rows) {
  const result = extractTrackingFromExcelRows(rows);

  if (result.uniqueCount > 0) {
    state.receiptItems = result.tracks.map((barcode, index) => ({
      no: index + 1,
      recipient: '-',
      weight: '-',
      service: barcode.startsWith('RJ') ? 'จดหมายในประเทศ' : (barcode.startsWith('RR') ? 'จดหมายต่างประเทศ' : '-'),
      zip: '-',
      destinationName: (typeof state !== 'undefined' && state.excelMap?.get(barcode)?.destination) || '-',
      trackNo: barcode,
      trackFormatted: barcode,
      cost: 0,
      discount: 0,
      remoteFee: 0,
      extra: 0,
      photoIndex: null,      // MUST BE null (unmapped!)
      alternatePhotoIndex: undefined,
      receiptSeqNo: null,    // MUST BE null
      rcptNo: null,          // MUST BE null
      mappingSource: 'excel' // 'excel'
    }));

    // Reset any previous applied matcher state
    if (typeof state !== 'undefined') {
      state.matcherAppliedSignature = null;
      state.matcherApplyInfo = null;
      state.trackSource = 'excel';
      state.apiFeedback = null;
    }

    let summaryMsg = `นำเข้า Tracking สำเร็จ ${result.uniqueCount} รายการ\n` +
      `• RJ: ${result.rjCount} รายการ\n` +
      `• RR: ${result.rrCount} รายการ`;
    if (result.duplicateRows > 0) {
      summaryMsg += `\n\n(ตัดรายการซ้ำจากประวัติสถานะแล้ว ${result.duplicateRows} แถว)`;
    }
    alert(summaryMsg);
  } else {
    alert('ไม่พบเลข Tracking ที่ถูกต้อง (S10-style) ในไฟล์ Excel');
  }

  if (typeof document !== 'undefined') {
    if (typeof renderItems === 'function') renderItems();
    if (typeof updateStats === 'function') updateStats();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
}

function renderItems() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('itemsList');
  container.innerHTML = '';

  let filtered = state.receiptItems.filter(item => {
    const cleanTrack = cleanTrackNo(item.trackNo);
    const excelInfo = state.excelMap.get(cleanTrack);
    const isMatched = !!excelInfo;
    const isSuccess = excelInfo && excelInfo.statusType === 'success';

    if (state.currentFilter === 'success' && !isSuccess) return false;
    if (state.currentFilter === 'pending' && (!isMatched || isSuccess)) return false;
    if (state.currentFilter === 'missing' && isMatched) return false;

    if (state.searchQuery) {
      const q = state.searchQuery;
      const matchNo = String(item.no).includes(q);
      const matchTrack = item.trackNo.toLowerCase().includes(q) || cleanTrack.toLowerCase().includes(q);
      const matchRecipient = (item.recipient || '').toLowerCase().includes(q);
      const matchDest = (item.destinationName || '').toLowerCase().includes(q) || (item.zip || '').includes(q);
      const matchExcel = excelInfo ? (excelInfo.destination || '').toLowerCase().includes(q) : false;

      if (!matchNo && !matchTrack && !matchRecipient && !matchDest && !matchExcel) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => Number(a.no) - Number(b.no));

  const isExcelSource = state.receiptItems.some(i => i.mappingSource === 'excel');
  const countBadgeEl = document.getElementById('countBadge');
  if (countBadgeEl) {
    countBadgeEl.textContent = filtered.length + " รายการ";
  }

  const sourceBadgeEl = document.getElementById('sourceBadge');
  if (sourceBadgeEl) {
    if (state.receiptItems.length > 0) {
      const source = state.trackSource || (isExcelSource ? 'excel' : 'api');
      sourceBadgeEl.textContent = source === 'excel' ? 'แหล่งข้อมูล: Excel' : 'แหล่งข้อมูล: Thailand Post API';
      sourceBadgeEl.className = source === 'excel'
        ? 'text-[10px] md:text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200'
        : 'text-[10px] md:text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200';
      sourceBadgeEl.classList.remove('hidden');
    } else {
      sourceBadgeEl.textContent = '';
      sourceBadgeEl.classList.add('hidden');
    }
  }

  if (filtered.length === 0) {
    if (state.receiptItems.length > 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300 p-4">
          <i class="fa-solid fa-magnifying-glass text-2xl mb-1 text-slate-300"></i>
          <p class="text-xs font-medium">ไม่พบรายการที่ค้นหา</p>
        </div>
      `;
      return;
    }

    if (state.apiFeedback?.type === 'empty') {
      container.innerHTML = `
        <div class="bg-amber-50/90 rounded-2xl border border-amber-300 p-5 shadow-xs space-y-3.5 max-w-md mx-auto my-6 text-center">
          <div class="w-12 h-12 mx-auto rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-600 text-xl">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-amber-900">ไม่พบรายการ Track จากเลข TR นี้</h3>
            <p class="text-xs text-amber-800 mt-1 leading-relaxed">
              ระบบเชื่อมต่อ Thailand Post API สำเร็จ แต่ API ไม่ได้ส่งรายการ Track กลับมา
            </p>
            ${state.apiFeedback.trCode ? `<p class="text-[11px] text-slate-500 mt-1 font-mono">(รหัส: ${escapeHtml(state.apiFeedback.trCode)})</p>` : ''}
            <p class="text-xs text-slate-700 font-medium mt-2.5">
              หากคุณมีไฟล์รายการ Track แนะนำให้นำเข้าจาก Excel เพื่อทำงานต่อ
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <button type="button" id="btnGuideExcel" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-file-excel"></i> นำเข้าจาก Excel
            </button>
            <button type="button" id="btnGuideRetryTR" class="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-rotate-right"></i> ตรวจสอบเลข TR อีกครั้ง
            </button>
          </div>
        </div>
      `;
    } else if (state.apiFeedback?.type === 'quota') {
      container.innerHTML = `
        <div class="bg-rose-50/90 rounded-2xl border border-rose-300 p-5 shadow-xs space-y-3.5 max-w-md mx-auto my-6 text-center">
          <div class="w-12 h-12 mx-auto rounded-full bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 text-xl">
            <i class="fa-solid fa-hand"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-rose-900">Thailand Post API จำกัดการเรียกใช้งานชั่วคราว</h3>
            <p class="text-xs text-rose-800 mt-1 leading-relaxed">
              หากต้องการทำงานต่อทันที สามารถนำเข้ารายการจาก Excel ได้
            </p>
          </div>
          <div class="flex justify-center pt-1">
            <button type="button" id="btnGuideExcel" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-file-excel"></i> นำเข้าจาก Excel
            </button>
          </div>
        </div>
      `;
    } else if (state.apiFeedback?.type === 'auth_error') {
      container.innerHTML = `
        <div class="bg-rose-50/90 rounded-2xl border border-rose-300 p-5 shadow-xs space-y-3.5 max-w-md mx-auto my-6 text-center">
          <div class="w-12 h-12 mx-auto rounded-full bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 text-xl">
            <i class="fa-solid fa-key"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-rose-900">ไม่สามารถยืนยันสิทธิ์ API ได้</h3>
            <p class="text-xs text-rose-800 mt-1 leading-relaxed">
              กรุณาตรวจสอบ Token Key หรือนำเข้าข้อมูลจาก Excel
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <button type="button" id="btnGuideApiSettings" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-gear"></i> ตั้งค่า API
            </button>
            <button type="button" id="btnGuideExcel" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-file-excel"></i> นำเข้าจาก Excel
            </button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs text-center space-y-4 max-w-md mx-auto my-6">
          <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xl">
            <i class="fa-solid fa-inbox"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800">ยังไม่มีรายการ Track</h3>
            <p class="text-xs text-slate-500 mt-1">เลือกวิธีนำเข้าข้อมูลเพื่อเริ่มงาน</p>
          </div>
          <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-left space-y-2 text-xs">
            <div class="font-bold text-slate-700">เริ่มต้นนำเข้ารายการ Track:</div>
            <div class="space-y-2 text-slate-600">
              <div class="flex items-start gap-2">
                <span class="font-bold text-red-600 shrink-0">•</span>
                <div><strong>ดึงจากเลข TR:</strong> เหมาะเมื่อมีเลข TR และระบบ Thailand Post API สามารถค้นพบรายการ</div>
              </div>
              <div class="flex items-start gap-2">
                <span class="font-bold text-emerald-600 shrink-0">•</span>
                <div><strong>นำเข้าจาก Excel:</strong> เหมาะเมื่อมีไฟล์รายการ Track อยู่แล้ว หรือ API ไม่พบรายการ / ไม่พร้อมใช้งาน</div>
              </div>
            </div>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <button type="button" id="btnGuideFetchTR" class="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-cloud-arrow-down"></i> ดึงจากเลข TR
            </button>
            <button type="button" id="btnGuideExcel" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
              <i class="fa-solid fa-file-excel"></i> นำเข้าจาก Excel
            </button>
          </div>
        </div>
      `;
    }

    const btnExcel = container.querySelector('#btnGuideExcel');
    if (btnExcel) {
      btnExcel.onclick = () => {
        const input = document.getElementById('excelFileInput');
        if (input) input.click();
      };
    }
    const btnFetchTR = container.querySelector('#btnGuideFetchTR');
    if (btnFetchTR) {
      btnFetchTR.onclick = () => {
        const input = document.getElementById('trNumberInput');
        if (input) input.focus();
      };
    }
    const btnRetryTR = container.querySelector('#btnGuideRetryTR');
    if (btnRetryTR) {
      btnRetryTR.onclick = () => {
        const input = document.getElementById('trNumberInput');
        if (input) input.focus();
      };
    }
    const btnApiSettings = container.querySelector('#btnGuideApiSettings');
    if (btnApiSettings) {
      btnApiSettings.onclick = () => {
        const btnOpen = document.getElementById('btnOpenApiModal');
        if (btnOpen) btnOpen.click();
      };
    }
    return;
  }

  filtered.forEach(item => {
    const cleanTrack = cleanTrackNo(item.trackNo);
    const excelInfo = state.excelMap.get(cleanTrack);
    const isMatched = !!excelInfo;
    const isSuccess = excelInfo && excelInfo.statusType === 'success';

    const card = document.createElement('div');
    card.id = 'card-item-' + item.no;
    card.className = "bg-white rounded-xl border p-2.5 md:p-3.5 transition shadow-xs cursor-pointer " + (
      state.activeItemNo === item.no ? 'highlight-active bg-red-50/20' : 'border-slate-200'
    );

    card.onclick = () => {
      selectItem(item, true);
    };

    let excelSnippet = '';
    if (isMatched) {
      const statusColorClass = isSuccess ? 'text-emerald-700' : 'text-amber-700';
      const statusDotClass = isSuccess ? 'bg-emerald-500' : 'bg-amber-500';
      excelSnippet = `
        <div>
          <div class="flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full ${statusDotClass}"></span>
            <span class="font-semibold text-[11px] md:text-xs ${statusColorClass}">
              ${excelInfo.statusText || 'พบข้อมูล'}
            </span>
          </div>
          <div class="text-[10px] md:text-xs text-slate-600 mt-0.5">
            ปลายทาง: <strong>${excelInfo.destination || item.destinationName}</strong>
          </div>
          <div class="text-[9px] md:text-[11px] text-slate-400 mt-0.5">
            ${excelInfo.statusDate || '-'}
          </div>
        </div>
      `;
    } else {
      excelSnippet = `
        <div class="text-slate-400 italic text-[10px] flex items-center gap-1 text-rose-500/80">
          <i class="fa-solid fa-circle-exclamation"></i> ไม่พบใน Track
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-6 h-6 md:w-7 md:h-7 rounded-lg bg-red-600 text-white font-bold font-mono text-[11px] md:text-xs flex items-center justify-center shrink-0 shadow-xs">
            #${item.no}
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs md:text-sm font-bold text-slate-900 truncate">${item.recipient}</span>
              <span class="text-[10px] md:text-[11px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono shrink-0">
                ${item.weight}
              </span>
            </div>
            <div class="text-[10px] md:text-xs text-slate-500 font-mono truncate">
              ${item.trackFormatted}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <div class="flex items-center gap-1">
            ${typeof item.photoIndex === 'number' ? `
              <span class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200" title="หน้าหลัก">
                หน้า ${item.photoIndex + 1}
              </span>
            ` : `
              <span class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 border border-dashed border-slate-300" title="ยังไม่ได้จับคู่กับหน้าใบเสร็จ">
                รอจับคู่
              </span>
            `}
            ${item.mappingSource === 'matcher' && item.receiptSeqNo ? `
              <span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300" title="จับคู่ด้วย Matcher (Seq ${item.receiptSeqNo})">
                <i class="fa-solid fa-check text-[8px]"></i> Seq ${item.receiptSeqNo}
              </span>
            ` : ''}
            ${typeof item.alternatePhotoIndex === 'number' ? `
              <button type="button" class="btn-switch-alt-page text-[10px] font-mono px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition" title="พบในหน้ารอยต่อด้วย (Overlap) คลิกเพื่อสลับดูหน้านี้">
                +หน้า ${item.alternatePhotoIndex + 1}
              </button>
            ` : ''}
          </div>
          <button type="button" class="btn-track-action px-2 md:px-2.5 py-0.5 md:py-1 text-[11px] md:text-xs font-medium rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition">
            <i class="fa-solid fa-timeline"></i> Track
          </button>
          <a href="https://track.thailandpost.co.th/?trackNumber=${cleanTrack}" target="_blank" 
             onclick="event.stopPropagation()"
             class="p-1 md:p-1.5 text-slate-400 hover:text-red-600 transition" title="เปิดหน้าเช็ค ปณท">
            <i class="fa-solid fa-arrow-up-right-from-square text-[10px] md:text-xs"></i>
          </a>
        </div>
      </div>

      <div class="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 md:gap-3 text-xs bg-slate-50/70 p-2 md:p-2.5 rounded-lg border border-slate-200/60">
        <div>
          <div class="text-[9px] md:text-[10px] font-bold uppercase text-slate-400 mb-0.5">
            ใบเสร็จ
          </div>
          <div class="text-slate-800 font-medium text-[11px] md:text-xs truncate">
            <i class="fa-solid fa-location-dot text-red-500 text-[10px] md:text-xs"></i>
            ${item.zip} <strong>${item.destinationName}</strong>
          </div>
          <div class="text-[10px] md:text-[11px] text-slate-400 truncate">
            ${item.service}
          </div>
        </div>

        <div class="border-l border-slate-200 pl-2 md:pl-2.5">
          <div class="text-[9px] md:text-[10px] font-bold uppercase text-slate-400 mb-0.5">
            Track ปณท
          </div>
          ${excelSnippet}
        </div>
      </div>
    `;

    const trackBtn = card.querySelector('.btn-track-action');
    if (trackBtn) {
      trackBtn.onclick = (e) => {
        e.stopPropagation();
        showTrackTimeline(cleanTrack);
      };
    }

    const altPageBtn = card.querySelector('.btn-switch-alt-page');
    if (altPageBtn) {
      altPageBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof item.alternatePhotoIndex === 'number') {
          switchPhoto(item.alternatePhotoIndex, false);
          highlightItemNo(item.no);
        }
      };
    }

    container.appendChild(card);
  });
}

function selectItem(item, scrollPhotoIntoPosition = true) {
  if (!item) return;
  state.activeItemNo = item.no;

  const isValidPhoto = typeof item.photoIndex === 'number' &&
    Number.isInteger(item.photoIndex) &&
    item.photoIndex >= 0 &&
    item.photoIndex < state.photos.length;

  if (isValidPhoto && item.photoIndex !== state.activePhotoIndex) {
    switchPhoto(item.photoIndex, false);
  }

  highlightItemNo(item.no);

  if (scrollPhotoIntoPosition && isValidPhoto && typeof document !== 'undefined') {
    const leftContainer = document.getElementById('receiptContainer');
    if (leftContainer) {
      const maxScroll = Math.max(0, leftContainer.scrollHeight - leftContainer.clientHeight);

      if (typeof item.scrollAnchor === 'number' && Number.isFinite(item.scrollAnchor)) {
        // Sequence Anchor: All members of this sequence scroll to the exact same visual anchor
        const targetScroll = Math.max(0, Math.min(maxScroll, Math.round(maxScroll * item.scrollAnchor)));
        if (typeof leftContainer.scrollTo === 'function') {
          leftContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
        } else {
          leftContainer.scrollTop = targetScroll;
        }
      } else {
        // Fallback: Legacy proportional distribution within photo page range
        const photoMeta = state.photos[item.photoIndex];
        if (photoMeta && Number.isFinite(photoMeta.startNo) && Number.isFinite(photoMeta.endNo) && photoMeta.endNo >= photoMeta.startNo) {
          const pageCount = photoMeta.endNo - photoMeta.startNo + 1;
          const indexInPage = item.no - photoMeta.startNo;
          const ratio = Math.max(0, Math.min(1, indexInPage / pageCount));
          const targetScroll = maxScroll * ratio;
          if (typeof leftContainer.scrollTo === 'function') {
            leftContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
          } else {
            leftContainer.scrollTop = targetScroll;
          }
        }
      }
    }
  }
}

function showTrackTimeline(cleanBarcode) {
  const item = state.receiptItems.find(r => cleanTrackNo(r.trackNo) === cleanBarcode);
  const excel = state.excelMap.get(cleanBarcode);

  const modal = document.getElementById('trackDetailModal');
  const body = document.getElementById('trackModalBody');
  const extBtn = document.getElementById('btnExternalTrackDirect');

  extBtn.href = "https://track.thailandpost.co.th/?trackNumber=" + cleanBarcode;

  const recipientName = item ? item.recipient : (excel ? 'ไม่ระบุ' : '-');
  const dest = item ? (item.zip + ' ' + item.destinationName) : (excel ? excel.destination : '-');

  body.innerHTML = `
    <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between">
      <div>
        <div class="text-[10px] text-slate-500 font-mono">หมายเลขพัสดุ</div>
        <div class="text-sm font-bold text-slate-900 font-mono">${cleanBarcode}</div>
      </div>
      <div class="text-right">
        <div class="text-[10px] text-slate-500">ผู้รับ</div>
        <div class="text-xs font-semibold text-slate-800">${recipientName}</div>
      </div>
    </div>

    <!-- Timeline steps -->
    <div class="space-y-3 pt-2 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
      
      <!-- Step 1: Deposit -->
      <div class="relative pl-7">
        <div class="absolute left-1.5 top-1 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white"></div>
        <div class="text-xs font-bold text-slate-800">รับฝากสิ่งของ</div>
        <div class="text-[11px] text-slate-500">${excel?.depositDate || '31 ส.ค. 2569 17:02 น. [ ปณก. 10501 ]'}</div>
      </div>

      <!-- Step 2: Bagging / Transit -->
      <div class="relative pl-7">
        <div class="absolute left-1.5 top-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white"></div>
        <div class="text-xs font-bold text-slate-800">ใส่ของลงถุง / ศป.ส่งต่อ</div>
        <div class="text-[11px] text-slate-500">${excel?.baggingDate || '31 ส.ค. 2569 20:30 น. [ ศป.กรุงเทพฯ ]'}</div>
      </div>

      <!-- Step 3: Latest Delivery Status -->
      <div class="relative pl-7">
        <div class="absolute left-1.5 top-1 w-2.5 h-2.5 rounded-full ${excel?.statusType === 'success' ? 'bg-emerald-600' : 'bg-slate-400'} border-2 border-white"></div>
        <div class="text-xs font-bold ${excel?.statusType === 'success' ? 'text-emerald-700' : 'text-slate-800'}">
          ${excel?.statusText || 'สถานะล่าสุด: กำลังนำส่งปลายทาง'}
        </div>
        <div class="text-[11px] text-slate-500">ปลายทาง: ${dest}</div>
        <div class="text-[10px] font-mono text-slate-400">${excel?.statusDate || '-'}</div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}

function updateStats() {
  if (typeof document === 'undefined') return;
  let deliveredCount = 0;
  state.receiptItems.forEach(item => {
    const cleanTrack = cleanTrackNo(item.trackNo);
    const excel = state.excelMap.get(cleanTrack);
    if (excel && excel.statusType === 'success') deliveredCount++;
  });
  const statDeliveredEl = document.getElementById('statDelivered');
  if (statDeliveredEl) statDeliveredEl.textContent = deliveredCount;
}
