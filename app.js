// App State
const state = {
  receiptItems: [],
  excelMap: new Map(), // barcode -> trackingInfo
  currentFilter: 'all',
  searchQuery: '',
  activeItemNo: 1,
  activePhotoIndex: 0,
  zoom: 1,
  rotation: 0,
  photos: [],
  isSyncEnabled: true,
  isScrollingByProgram: false
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (window.APP_DATA) {
    state.receiptItems = JSON.parse(JSON.stringify(window.APP_DATA.receiptItems || []));
    state.photos = window.APP_DATA.sampleImages || [];
    
    // Index excel items
    (window.APP_DATA.excelTracking || []).forEach(item => {
      const cleanBarcode = cleanTrackNo(item.barcode);
      state.excelMap.set(cleanBarcode, item);
    });
  }

  setupPhotoControls();
  setupEventListeners();
  setupSyncScroll();
  renderPhotoTabs();
  renderItems();
  updateStats();

  // Initial select item #1
  if (state.receiptItems.length > 0) {
    selectItem(state.receiptItems[0], false);
  }
});

function cleanTrackNo(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '').toUpperCase().trim();
}

function setupPhotoControls() {
  const img = document.getElementById('receiptImage');
  const zoomIndicator = document.getElementById('zoomLevelIndicator');
  const container = document.getElementById('receiptContainer');

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
    btn.className = "px-2 py-0.5 rounded text-[11px] font-medium transition " + (
      state.activePhotoIndex === idx 
        ? 'bg-red-600 text-white shadow-xs' 
        : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
    );
    btn.textContent = "หน้า " + (idx + 1);
    btn.title = photo.label;
    btn.onclick = () => switchPhoto(idx, true); // true = scroll right side to start of this page
    container.appendChild(btn);
  });
}

function switchPhoto(index, scrollRightList = false) {
  if (index < 0 || index >= state.photos.length) return;
  state.activePhotoIndex = index;
  const img = document.getElementById('receiptImage');
  img.src = state.photos[index].file;
  renderPhotoTabs();

  // If user explicitly switched photo tab, scroll right side list to the first item of this photo
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

  // When Right List is scrolled -> automatically detect visible items and switch photo / highlight
  let scrollTimeout;
  rightList.addEventListener('scroll', () => {
    if (!state.isSyncEnabled || state.isScrollingByProgram) return;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      syncLeftWithRightScroll();
    }, 80);
  });

  // When Left Photo container is scrolled -> proportion scroll right
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

  // Find the top-most visible card
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
    document.getElementById('activeItemHint').textContent = 'กำลังตรวจสอบลำดับที่ ' + item.no + ': ' + item.recipient + ' (' + item.trackFormatted + ')';
  }
}

function setupEventListeners() {
  // Search
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderItems();
  });

  // Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.className = 'filter-btn px-2.5 py-1 rounded-md font-medium text-slate-500 hover:text-slate-800 transition';
      });
      btn.className = 'filter-btn px-2.5 py-1 rounded-md font-medium text-slate-700 bg-white shadow-xs transition';
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
      state.photos.push({ label: 'รูปใหม่ (' + (state.photos.length + 1) + ')', file: url });
      state.activePhotoIndex = state.photos.length - 1;
      switchPhoto(state.activePhotoIndex, false);
    }
  });

  // Paste Modal
  const pasteModal = document.getElementById('pasteModal');
  document.getElementById('btnPasteModal').onclick = () => pasteModal.classList.remove('hidden');
  document.getElementById('btnClosePasteModal').onclick = () => pasteModal.classList.add('hidden');
  document.getElementById('btnCancelPaste').onclick = () => pasteModal.classList.add('hidden');
  document.getElementById('btnProcessPaste').onclick = handleProcessPaste;

  // Track Detail Modal
  const trackModal = document.getElementById('trackDetailModal');
  document.getElementById('btnCloseTrackModal').onclick = () => trackModal.classList.add('hidden');
  document.getElementById('btnCloseTrackModalBtn').onclick = () => trackModal.classList.add('hidden');

  // Reset
  document.getElementById('btnResetData').onclick = () => {
    if (confirm('ต้องการรีเซ็ตข้อมูลกลับสู่ค่าเริ่มต้นจากระบบ?')) {
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
      alert("นำเข้าข้อมูลสำเร็จ: ประมวลผล " + json.length + " บรรทัด");
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function handleProcessPaste() {
  const text = document.getElementById('pasteDataTextarea').value;
  if (!text.trim()) return;

  const lines = text.split(/\r?\n/);
  const rows = lines.map(line => line.split(/[\t,;]+/));
  processExcelRows(rows);

  document.getElementById('pasteModal').classList.add('hidden');
  document.getElementById('pasteDataTextarea').value = '';
}

function processExcelRows(rows) {
  const barcodeRegex = /[A-Z]{2}\s*\d{9}\s*TH/i;
  let countAdded = 0;

  rows.forEach(row => {
    const rowStr = Array.isArray(row) ? row.join(' ') : String(row);
    const match = rowStr.match(barcodeRegex);
    if (match) {
      const cleanBarcode = cleanTrackNo(match[0]);
      
      let statusText = 'พบข้อมูลในระบบ';
      let destination = '';
      let statusDate = '';
      let statusType = 'pending';

      if (rowStr.includes('สำเร็จ') || rowStr.includes('นำจ่ายสำเร็จ') || rowStr.includes('ผู้รับรับเอง')) {
        statusText = 'นำจ่ายสำเร็จ';
        statusType = 'success';
      } else if (rowStr.includes('ระหว่างทาง') || rowStr.includes('ใส่ของลงถุง') || rowStr.includes('รับฝาก')) {
        statusText = 'อยู่ระหว่างจัดส่ง/รับฝาก';
        statusType = 'in_transit';
      }

      const dateMatch = rowStr.match(/\d{1,2}\s+[\u0E00-\u0E7F\.]+\s+\d{2,4}(\s+\d{1,2}:\d{2})?/);
      if (dateMatch) {
        statusDate = dateMatch[0];
      }

      state.excelMap.set(cleanBarcode, {
        barcode: cleanBarcode,
        destination: destination || (state.excelMap.get(cleanBarcode)?.destination || ''),
        statusText: statusText,
        statusDetail: rowStr,
        statusDate: statusDate || new Date().toLocaleDateString('th-TH'),
        statusType: statusType,
        depositDate: 'บันทึกผ่านการ Import',
        baggingDate: '-'
      });
      countAdded++;
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
      <div class="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300 p-6">
        <i class="fa-solid fa-inbox text-3xl mb-2 text-slate-300"></i>
        <p class="text-sm font-medium">ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหาหรือตัวกรอง</p>
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
    card.className = "bg-white rounded-xl border p-3.5 transition shadow-xs hover:shadow-md cursor-pointer " + (
      state.activeItemNo === item.no ? 'highlight-active bg-red-50/20' : 'border-slate-200 hover:border-slate-300'
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
            <span class="font-semibold ${statusColorClass}">
              ${excelInfo.statusText || 'พบข้อมูล'}
            </span>
          </div>
          <div class="text-[11px] text-slate-600 mt-0.5 flex items-center justify-between">
            <span>ปลายทาง: <strong>${excelInfo.destination || item.destinationName}</strong></span>
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">
            <i class="fa-regular fa-clock"></i> ${excelInfo.statusDate || '-'}
          </div>
        </div>
      `;
    } else {
      excelSnippet = `
        <div class="text-slate-400 italic text-[11px] flex items-center gap-1 text-rose-500/80">
          <i class="fa-solid fa-circle-exclamation"></i> ยังไม่มีในตาราง Excel
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-7 h-7 rounded-lg bg-red-600 text-white font-bold font-mono text-xs flex items-center justify-center shadow-xs">
            #${item.no}
          </span>
          <div>
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-bold text-slate-900">ผู้รับ: ${item.recipient}</span>
              <span class="text-[11px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                ${item.weight}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 font-mono flex items-center gap-1">
              <i class="fa-solid fa-barcode text-slate-400"></i> ${item.trackFormatted}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" class="btn-track-action px-2.5 py-1 text-xs font-medium rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 transition" data-track="${cleanTrack}">
            <i class="fa-solid fa-timeline"></i> Track
          </button>
          <a href="https://track.thailandpost.co.th/?trackNumber=${cleanTrack}" target="_blank" 
             onclick="event.stopPropagation()"
             title="เปิดหน้าเว็บ ปณท ทันที" 
             class="p-1 text-slate-400 hover:text-red-600 rounded transition">
            <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
          </a>
        </div>
      </div>

      <div class="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs bg-slate-50/70 p-2.5 rounded-lg border border-slate-200/60">
        <div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1">
            <i class="fa-solid fa-file-invoice text-rose-500"></i> ข้อมูลในใบเสร็จ
          </div>
          <div class="text-slate-800 font-medium flex items-center gap-1">
            <i class="fa-solid fa-location-dot text-red-500 text-[11px]"></i>
            <span>${item.zip} <strong>${item.destinationName}</strong></span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            บริการ: ${item.service}
          </div>
        </div>

        <div class="border-l border-slate-200 pl-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1 mb-1">
            <i class="fa-solid fa-file-excel text-emerald-600"></i> ข้อมูลจาก Excel (Track)
          </div>
          ${excelSnippet}
        </div>
      </div>
    `;

    // Attach button click event
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

  // Approximate vertical scroll in image container
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
    <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
      <div>
        <div class="text-xs text-slate-500 font-mono">หมายเลขพัสดุ</div>
        <div class="text-base font-bold text-slate-900 font-mono">${cleanBarcode}</div>
      </div>
      <div class="text-right">
        <div class="text-xs text-slate-500">ผู้รับ</div>
        <div class="text-sm font-semibold text-slate-800">${recipientName}</div>
      </div>
    </div>

    <!-- Timeline steps -->
    <div class="space-y-4 pt-2 relative before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
      
      <!-- Step 1: Deposit -->
      <div class="relative pl-8">
        <div class="absolute left-1.5 top-1 w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white shadow-xs"></div>
        <div class="text-xs font-bold text-slate-800">รับฝากสิ่งของ</div>
        <div class="text-xs text-slate-500">${excel?.depositDate || '31 ส.ค. 2569 17:02 น. [ ปณก. 10501 ]'}</div>
        <div class="text-[11px] text-slate-400">ที่ทำการไปรษณีย์ต้นทางรับสิ่งของเข้าระบบเรียบร้อย</div>
      </div>

      <!-- Step 2: Bagging / Transit -->
      <div class="relative pl-8">
        <div class="absolute left-1.5 top-1 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white shadow-xs"></div>
        <div class="text-xs font-bold text-slate-800">ใส่ของลงถุง / ศป.ส่งต่อ</div>
        <div class="text-xs text-slate-500">${excel?.baggingDate || '31 ส.ค. 2569 20:30 น. [ ศป.กรุงเทพฯ ]'}</div>
        <div class="text-[11px] text-slate-400">สิ่งของอยู่ระหว่างการคัดแยกและส่งต่อไปยังที่ทำการปลายทาง</div>
      </div>

      <!-- Step 3: Latest Delivery Status -->
      <div class="relative pl-8">
        <div class="absolute left-1.5 top-1 w-3.5 h-3.5 rounded-full ${excel?.statusType === 'success' ? 'bg-emerald-600' : 'bg-slate-400'} border-2 border-white shadow-xs"></div>
        <div class="text-xs font-bold ${excel?.statusType === 'success' ? 'text-emerald-700' : 'text-slate-800'}">
          ${excel?.statusText || 'สถานะล่าสุด: กำลังนำส่งปลายทาง'}
        </div>
        <div class="text-xs text-slate-500">ปลายทาง: ${dest}</div>
        <div class="text-xs font-mono text-slate-500 mt-0.5">${excel?.statusDate || '-'}</div>
        <div class="text-[11px] text-slate-600 bg-emerald-50 border border-emerald-200 p-2 rounded mt-1.5 whitespace-pre-line">
          ${excel?.statusDetail || 'พัสดุเตรียมการนำจ่ายตามกำหนด'}
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
}

function updateStats() {
  const totalReceipt = state.receiptItems.length;
  let matchedCount = 0;
  let deliveredCount = 0;

  state.receiptItems.forEach(item => {
    const cleanTrack = cleanTrackNo(item.trackNo);
    const excel = state.excelMap.get(cleanTrack);
    if (excel) {
      matchedCount++;
      if (excel.statusType === 'success') deliveredCount++;
    }
  });

  document.getElementById('statTotalReceipt').textContent = totalReceipt;
  document.getElementById('statMatched').textContent = matchedCount;
  document.getElementById('statDelivered').textContent = deliveredCount;
}
