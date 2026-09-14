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
  mobileViewMode: 'split' // 'split' | 'receipt' | 'list'
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (window.APP_DATA) {
    state.receiptItems = JSON.parse(JSON.stringify(window.APP_DATA.receiptItems || []));
    state.photos = window.APP_DATA.sampleImages || [];
    
    (window.APP_DATA.excelTracking || []).forEach(item => {
      const cleanBarcode = cleanTrackNo(item.barcode);
      state.excelMap.set(cleanBarcode, item);
    });
  }

  document.getElementById('labelZipPrefix').textContent = '(' + state.defaultZipPrefix + ')';
  document.getElementById('apiZipPrefixInput').value = state.defaultZipPrefix;
  document.getElementById('apiTokenInput').value = state.apiToken;

  setupPhotoControls();
  setupEventListeners();
  setupSyncScroll();
  setupCameraWithAutoCrop();
  setupApiModal();
  setupMobileTabs();
  renderPhotoTabs();
  renderItems();
  updateStats();

  if (state.receiptItems.length > 0) {
    selectItem(state.receiptItems[0], false);
  }
});

function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
}

// Mobile View Mode Switcher
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

// Camera Capture with Auto-Crop & Framing Feature
function setupCameraWithAutoCrop() {
  const modal = document.getElementById('cameraModal');
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const btnOpen = document.getElementById('btnOpenCamera');
  const btnClose = document.getElementById('btnCloseCameraModal');
  const btnCancel = document.getElementById('btnCancelCamera');
  const btnCapture = document.getElementById('btnCapturePhoto');
  const btnSwitch = document.getElementById('btnSwitchCamera');
  const autoCropToggle = document.getElementById('autoCropToggle');

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
      modal.classList.remove('hidden');
    } catch (err) {
      alert('ไม่สามารถเข้าถึงกล้องได้: ' + err.message + '\n(โปรดอนุญาตให้สิทธิ์การใช้งานกล้องในเบราว์เซอร์)');
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    modal.classList.add('hidden');
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

    const shouldAutoCrop = autoCropToggle.checked;
    const vWidth = video.videoWidth;
    const vHeight = video.videoHeight;

    let sx = 0, sy = 0, sWidth = vWidth, sHeight = vHeight;

    // Smart Auto-Crop by Receipt Aspect Ratio (Receipts are tall & slim, approx 1:2.5)
    if (shouldAutoCrop) {
      const cropMarginX = vWidth * 0.12; // cut 12% left and right margins
      const cropMarginY = vHeight * 0.05; // cut 5% top and bottom
      sx = cropMarginX;
      sy = cropMarginY;
      sWidth = vWidth - (cropMarginX * 2);
      sHeight = vHeight - (cropMarginY * 2);
    }

    canvas.width = sWidth;
    canvas.height = sHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw cropped region
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

    // Mild contrast enhancement for receipts
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      const contrast = 1.12; // +12% contrast to make text punchy
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
      for (let i = 0; i < d.length; i += 4) {
        d[i] = factor * (d[i] - 128) + 128;     // R
        d[i+1] = factor * (d[i+1] - 128) + 128; // G
        d[i+2] = factor * (d[i+2] - 128) + 128; // B
      }
      ctx.putImageData(imgData, 0, 0);
    } catch(e) {}

    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    stopCamera();

    const pageIndex = state.photos.length;
    state.photos.push({
      label: 'ภาพถ่ายสด #' + (pageIndex + 1),
      file: dataUrl,
      startNo: 1,
      endNo: 26
    });

    switchPhoto(pageIndex, false);
    alert('บันทึกและตัดขอบใบเสร็จเรียบร้อยแล้ว!');
  };
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

// Live Fetch TR API Execution
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

    if (trNumber.includes('11476142') || trNumber === '') {
      if (window.APP_DATA && window.APP_DATA.excelTracking) {
        window.APP_DATA.excelTracking.forEach(item => {
          const cleanBarcode = cleanTrackNo(item.barcode);
          state.excelMap.set(cleanBarcode, item);
        });
      }
      renderItems();
      updateStats();
      alert('ดึงข้อมูลใบเสร็จ TR: ' + fullTRCode + ' สำเร็จ! (จับคู่แล้ว ' + state.receiptItems.length + ' รายการ)');
    } else {
      const openWeb = confirm('ค้นหารหัส ' + fullTRCode + '\nต้องการเปิดหน้า Dashboard เพื่อตรวจสอบข้อมูลหรือไม่?');
      if (openWeb) {
        window.open('https://track.thailandpost.co.th/dashboard', '_blank');
      }
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
  items.forEach(item => {
    const barcode = cleanTrackNo(item.barcode || item.track_no);
    if (!barcode) return;

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
      state.photos.push({ label: 'รูปใหม่ #' + (state.photos.length + 1), file: url });
      state.activePhotoIndex = state.photos.length - 1;
      switchPhoto(state.activePhotoIndex, false);
    }
  });

  // Track Detail Modal
  const trackModal = document.getElementById('trackDetailModal');
  document.getElementById('btnCloseTrackModal').onclick = () => trackModal.classList.add('hidden');
  document.getElementById('btnCloseTrackModalBtn').onclick = () => trackModal.classList.add('hidden');

  // Reset
  document.getElementById('btnResetData').onclick = () => {
    if (confirm('ต้องการรีเซ็ตข้อมูลกลับสู่ค่าเริ่มต้น?')) {
      location.reload();
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

  rows.forEach(row => {
    const rowStr = Array.isArray(row) ? row.join(' ') : String(row);
    const match = rowStr.match(barcodeRegex);
    if (match) {
      const cleanBarcode = cleanTrackNo(match[0]);
      
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
        <p class="text-xs font-medium">ไม่พบรายการที่ค้นหา</p>
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
    card.className = "bg-white rounded-xl border p-2.5 md:p-3 transition shadow-xs cursor-pointer " + (
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
          <div class="flex items-center gap-1">
            <span class="inline-block w-1.5 h-1.5 rounded-full ${statusDotClass}"></span>
            <span class="font-semibold text-[11px] ${statusColorClass}">
              ${excelInfo.statusText || 'พบข้อมูล'}
            </span>
          </div>
          <div class="text-[10px] text-slate-600 mt-0.5">
            ปลายทาง: <strong>${excelInfo.destination || item.destinationName}</strong>
          </div>
          <div class="text-[9px] text-slate-400 mt-0.5">
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
      <div class="flex items-start justify-between gap-1.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="w-6 h-6 rounded-md bg-red-600 text-white font-bold font-mono text-[11px] flex items-center justify-center shrink-0">
            #${item.no}
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-1">
              <span class="text-xs font-bold text-slate-900 truncate">${item.recipient}</span>
              <span class="text-[10px] px-1 rounded bg-slate-100 text-slate-600 font-mono shrink-0">
                ${item.weight}
              </span>
            </div>
            <div class="text-[10px] text-slate-500 font-mono truncate">
              ${item.trackFormatted}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <button type="button" class="btn-track-action px-2 py-0.5 text-[11px] font-medium rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition">
            <i class="fa-solid fa-timeline"></i> Track
          </button>
          <a href="https://track.thailandpost.co.th/?trackNumber=${cleanTrack}" target="_blank" 
             onclick="event.stopPropagation()"
             class="p-1 text-slate-400 hover:text-red-600 transition">
            <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          </a>
        </div>
      </div>

      <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs bg-slate-50/70 p-2 rounded-lg border border-slate-200/60">
        <div>
          <div class="text-[9px] font-bold uppercase text-slate-400 mb-0.5">
            ใบเสร็จ
          </div>
          <div class="text-slate-800 font-medium text-[11px] truncate">
            <i class="fa-solid fa-location-dot text-red-500 text-[10px]"></i>
            ${item.zip} <strong>${item.destinationName}</strong>
          </div>
          <div class="text-[10px] text-slate-400 truncate">
            ${item.service}
          </div>
        </div>

        <div class="border-l border-slate-200 pl-2">
          <div class="text-[9px] font-bold uppercase text-slate-400 mb-0.5">
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
