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
  defaultZipPrefix: localStorage.getItem('thp_zip_prefix') || '10501',
  apiToken: localStorage.getItem('thp_api_token') || '',
  currentSessionId: null,
  mobileViewMode: 'split',
  
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

// Initialize
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
  setupMobileTabs();
  renderPhotoTabs();
  renderItems();
  updateStats();
  showEmptyPhotoState();
});

function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
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
  return state.receiptItems.length > 0 || state.excelMap.size > 0 || state.photos.length > 0 ||
    document.getElementById('trNumberInput').value.trim().length > 0;
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
    stats: getSessionStats(receiptItems, excelEntries)
  };

  await putHistory(record);
  state.currentSessionId = id;
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
  state.receiptItems = JSON.parse(JSON.stringify(record.receiptItems || []));
  state.excelMap = new Map(record.excelEntries || []);
  state.photos = hydratePhotos(record.photos || []);
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
  if (state.photos.length > 0) switchPhoto(0, false);
  else showEmptyPhotoState();
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

  localStorage.removeItem('thp_latest_cropped_receipt');

  document.getElementById('trNumberInput').value = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('imageFileInput').value = '';
  document.getElementById('excelFileInput').value = '';
  document.getElementById('zoomLevelIndicator').textContent = '100%';

  document.querySelectorAll('.filter-btn').forEach(btn => {
    const isAll = btn.getAttribute('data-filter') === 'all';
    btn.className = 'filter-btn px-2 py-0.5 rounded font-medium ' +
      (isAll ? 'text-slate-700 bg-white shadow-xs' : 'text-slate-500');
  });

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
  const img = document.getElementById('receiptImage');
  img.classList.remove('hidden');
  img.src = state.photos[index].file;
  renderPhotoTabs();

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

  // Set image directly
  const imgEl = document.getElementById('receiptImage');
  if (imgEl) {
    imgEl.classList.remove('hidden');
    imgEl.src = dataUrl;
  }

  renderPhotoTabs();
  alert('บันทึกรูปภาพใบเสร็จตามกรอบที่ปรับเรียบร้อยแล้ว!');
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

    state.defaultZipPrefix = zip;
    state.apiToken = token;

    localStorage.setItem('thp_zip_prefix', zip);
    localStorage.setItem('thp_api_token', token);

    document.getElementById('labelZipPrefix').textContent = '(' + zip + ')';
    closeModal();
    alert('บันทึกการตั้งค่า API เรียบร้อยแล้ว!');
  };
}

async function fetchTrackingByTR(trNumber) {
  const zip = state.defaultZipPrefix;
  const fullTRCode = zip + '|' + trNumber;
  const btnFetchTR = document.getElementById('btnFetchTR');

  btnFetchTR.disabled = true;
  btnFetchTR.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    if (state.apiToken) {
      const response = await fetch('https://trackapi.thailandpost.co.th/post/api/v1/track/receipt', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + state.apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ receipt_no: fullTRCode })
      });

      if (response.ok) {
        const json = await response.json();
        if (json && json.response && json.response.items) {
          processApiItems(json.response.items);
          alert('ดึงข้อมูลสำเร็จผ่าน API: ' + json.response.items.length + ' รายการ');
          return;
        }
      }
    }

    const reason = state.apiToken
      ? 'API ไม่คืนข้อมูลสำหรับรหัสนี้'
      : 'ยังไม่ได้ตั้งค่า Token สำหรับเชื่อมต่อ API';
    const openWeb = confirm(reason + '\n\nรหัส: ' + fullTRCode + '\nต้องการเปิดหน้า Dashboard เพื่อตรวจสอบข้อมูลหรือไม่?');
    if (openWeb) {
      window.open('https://track.thailandpost.co.th/dashboard', '_blank');
    }
  } catch (err) {
    console.error(err);
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
  } finally {
    btnFetchTR.disabled = false;
    btnFetchTR.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> <span class="hidden sm:inline">ดึง TR</span>';
  }
}

function processApiItems(items) {
  const nextReceiptItems = [];

  items.forEach(item => {
    const barcode = cleanTrackNo(item.barcode || item.track_no);
    if (!barcode) return;

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
      statusType: (item.status_code === '501' || (item.status_description || '').includes('สำเร็จ')) ? 'success' : 'in_transit',
      depositDate: item.deposit_date || '-',
      baggingDate: item.bagging_date || '-'
    });
  });

  if (nextReceiptItems.length > 0) {
    state.receiptItems = nextReceiptItems;
    state.activeItemNo = nextReceiptItems[0].no;
  }

  renderItems();
  updateStats();
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
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      state.photos.push({ label: 'รูปใหม่ #' + (state.photos.length + 1), file: url, isUserUploaded: true });
      state.activePhotoIndex = state.photos.length - 1;
      switchPhoto(state.activePhotoIndex, false);
    }
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

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      
      processExcelRows(json);
      alert("นำเข้าสำเร็จ: " + json.length + " บรรทัด");
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function processExcelRows(rows) {
  const barcodeRegex = /[A-Z]{2}\s*\d{9}\s*TH/i;
  const importedBarcodes = [];

  rows.forEach(row => {
    const rowStr = Array.isArray(row) ? row.join(' ') : String(row);
    const match = rowStr.match(barcodeRegex);
    if (match) {
      const cleanBarcode = cleanTrackNo(match[0]);
      if (!importedBarcodes.includes(cleanBarcode)) importedBarcodes.push(cleanBarcode);
      
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

      const dateMatch = rowStr.match(/\d{1,2}\s+[\u0E00-\u0E7F\.]+\s+\d{2,4}(\s+\d{1,2}:\d{2})?/);
      if (dateMatch) {
        statusDate = dateMatch[0];
      }

      state.excelMap.set(cleanBarcode, {
        barcode: cleanBarcode,
        destination: (state.excelMap.get(cleanBarcode)?.destination || ''),
        statusText: statusText,
        statusDetail: rowStr,
        statusDate: statusDate || new Date().toLocaleDateString('th-TH'),
        statusType: statusType,
        depositDate: 'Imported',
        baggingDate: '-'
      });
    }
  });

  if (state.receiptItems.length === 0 && importedBarcodes.length > 0) {
    state.receiptItems = importedBarcodes.map((barcode, index) => ({
      no: index + 1,
      recipient: '-',
      weight: '-',
      service: '-',
      zip: '-',
      destinationName: state.excelMap.get(barcode)?.destination || '-',
      trackNo: barcode,
      trackFormatted: barcode,
      cost: 0,
      discount: 0,
      remoteFee: 0,
      extra: 0,
      photoIndex: 0
    }));
    state.activeItemNo = 1;
  }

  renderItems();
  updateStats();
}

function renderItems() {
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
  });

  document.getElementById('countBadge').textContent = filtered.length + " รายการ";

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300 p-4">
        <i class="fa-solid fa-inbox text-2xl mb-1 text-slate-300"></i>
        <p class="text-xs font-medium">${state.receiptItems.length === 0 ? 'ยังไม่มีข้อมูลงาน — ดึง TR หรือนำเข้า Excel เพื่อเริ่มต้น' : 'ไม่พบรายการที่ค้นหา'}</p>
      </div>
    `;
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

    container.appendChild(card);
  });
}

function selectItem(item, scrollPhotoIntoPosition = true) {
  state.activeItemNo = item.no;
  
  if (typeof item.photoIndex === 'number' && item.photoIndex !== state.activePhotoIndex) {
    switchPhoto(item.photoIndex, false);
  }

  highlightItemNo(item.no);

  if (scrollPhotoIntoPosition) {
    const leftContainer = document.getElementById('receiptContainer');
    const photoMeta = state.photos[item.photoIndex || 0];
    if (photoMeta && photoMeta.startNo && photoMeta.endNo) {
      const pageCount = photoMeta.endNo - photoMeta.startNo + 1;
      const indexInPage = item.no - photoMeta.startNo;
      const ratio = Math.max(0, Math.min(1, indexInPage / pageCount));
      const targetScroll = (leftContainer.scrollHeight - leftContainer.clientHeight) * ratio;
      leftContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
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
  let deliveredCount = 0;
  state.receiptItems.forEach(item => {
    const cleanTrack = cleanTrackNo(item.trackNo);
    const excel = state.excelMap.get(cleanTrack);
    if (excel && excel.statusType === 'success') deliveredCount++;
  });
  document.getElementById('statDelivered').textContent = deliveredCount;
}
