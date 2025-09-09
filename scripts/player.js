"use strict";

// --- CBZ viewer state and helpers ---
let cbzState = {
  active: false,
  pages: [],
  index: 0
};
let cbzObjectUrls = [];
let cbzCache = new Map(); // key -> { pages: string[] }
let cbzCurrentKey = '';
let cbzProgressBase = 0; // base percent before extraction phase

function isCbzItem(item) {
  if (!item) return false;
  const nameFromSrc = (typeof item.src === 'string') ? item.src : '';
  const fileName = (item.fileName || '').toLowerCase();
  const lowerSrc = nameFromSrc.toLowerCase();
  const hasCbzInSrc = /\.cbz(?:$|[?#])/i.test(lowerSrc);
  const hasCbzInName = fileName.endsWith('.cbz');
  return hasCbzInSrc || hasCbzInName;
}

function clearCbzUrls() {
  try {
    cbzObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  } catch {}
  cbzObjectUrls = [];
}

function hideVideoShowCbz() {
  if (video) { try { video.pause(); } catch {} video.style.display = 'none'; }
  if (cbzViewer) cbzViewer.style.display = 'block';
  if (clipBtn) clipBtn.style.display = 'none';
  if (theaterBtn) theaterBtn.style.display = 'none';
}

function hideCbzShowVideo() {
  if (cbzViewer) cbzViewer.style.display = 'none';
  if (video) video.style.display = '';
  if (clipBtn) clipBtn.style.display = '';
}

function updateCbzPageInfo() {
  if (!cbzState.active) return;
  if (cbzPageInfo) cbzPageInfo.textContent = `Page ${cbzState.index + 1} / ${cbzState.pages.length}`;
  if (cbzImage) cbzImage.src = cbzState.pages[cbzState.index] || '';
  if (nextBtn) nextBtn.style.display = (cbzState.index >= cbzState.pages.length - 1 && flatList && currentIndex < flatList.length - 1) ? 'inline-block' : 'none';
  // Persist current page and total pages for this CBZ item
  try {
    const curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
    const src = curItem && curItem.src ? curItem.src : '';
    if (src) {
      localStorage.setItem(src + ':cbzPage', String(cbzState.index + 1));
      localStorage.setItem(src + ':cbzPages', String(cbzState.pages.length));
    }
  } catch {}
}

function showCbzProgress(message, value) {
  if (cbzProgressOverlay) cbzProgressOverlay.style.display = 'flex';
  if (cbzProgressMessage && typeof message === 'string') cbzProgressMessage.textContent = message;
  if (cbzProgressBar) {
    if (typeof value === 'number' && isFinite(value)) {
      cbzProgressBar.value = Math.max(0, Math.min(100, value));
    } else {
      try { cbzProgressBar.removeAttribute('value'); } catch {}
    }
  }
}

function hideCbzProgress() {
  if (cbzProgressOverlay) cbzProgressOverlay.style.display = 'none';
  try { if (cbzProgressBar) cbzProgressBar.value = 0; } catch {}
}

function formatMB(bytes) {
  const num = Number(bytes) || 0;
  return `${(num / (1024*1024)).toFixed(1)} MB`;
}

function fetchBlobWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onprogress = (e) => { try { onProgress && onProgress(e.loaded, e.lengthComputable ? e.total : undefined); } catch {} };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
        else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.send();
    } catch (e) { reject(e); }
  });
}

function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onprogress = (e) => { try { onProgress && onProgress(e.loaded, e.lengthComputable ? e.total : undefined); } catch {} };
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.onload = () => {
        try { resolve(new Blob([fr.result])); } catch (e) { reject(e); }
      };
      fr.readAsArrayBuffer(file);
    } catch (e) { reject(e); }
  });
}

function getCbzCacheKey(item) {
  if (item && item.file) {
    const f = item.file;
    const lm = typeof f.lastModified === 'number' ? f.lastModified : 0;
    return `local:${f.name}:${f.size}:${lm}`;
  }
  return `url:${item && item.src ? item.src : ''}`;
}

async function loadCbz(item) {
  cbzState = { active: true, pages: [], index: 0 };
  // Use progress overlay instead of spinner
  showCbzProgress('Starting download…', 0);
  try { if (spinner) spinner.style.display = 'none'; } catch {}
  hideVideoShowCbz();
  try {
    const cacheKey = getCbzCacheKey(item);
    cbzCurrentKey = cacheKey;
    // Serve from cache if present
    if (cbzCache.has(cacheKey)) {
      const cached = cbzCache.get(cacheKey);
      cbzState.pages = cached.pages.slice();
      cbzObjectUrls = cached.pages; // current reference for convenience
      cbzState.index = 0;
      // Restore saved page and persist total pages
      try {
        const pk = (item && item.progressKey) ? String(item.progressKey) : '';
        if (item && item.src) localStorage.setItem(item.src + ':cbzPages', String(cbzState.pages.length));
        if (pk) localStorage.setItem(pk + ':cbzPages', String(cbzState.pages.length));
        const savedSrc = item && item.src ? parseInt(localStorage.getItem(item.src + ':cbzPage'), 10) : NaN;
        const savedPk = pk ? parseInt(localStorage.getItem(pk + ':cbzPage'), 10) : NaN;
        const savedPage = Number.isFinite(savedPk) ? savedPk : savedSrc;
        if (Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= cbzState.pages.length) {
          cbzState.index = savedPage - 1;
        }
      } catch {}
      updateCbzPageInfo();
      hideCbzProgress();
      return;
    }

    let blob;
    const onNetProgress = (loaded, total) => {
      if (total && isFinite(total) && total > 0) {
        const pct = (loaded / total) * 80; // allocate 80% to download phase
        showCbzProgress(`Downloading… ${formatMB(loaded)} / ${formatMB(total)}`, pct);
      } else {
        showCbzProgress('Downloading…', undefined);
      }
    };
    if (item.file && typeof item.file.arrayBuffer === 'function') {
      blob = await readFileWithProgress(item.file, onNetProgress);
    } else {
      blob = await fetchBlobWithProgress(item.src, onNetProgress);
    }

    cbzProgressBase = 80; // remaining 20% for extraction
    showCbzProgress('Parsing archive…', cbzProgressBase);
    const zip = await JSZip.loadAsync(blob);
    const fileNames = Object.keys(zip.files)
      .filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const pages = [];
    for (let i = 0; i < fileNames.length; i++) {
      const name = fileNames[i];
      showCbzProgress(`Extracting pages… ${i + 1} / ${fileNames.length}`, cbzProgressBase + (20 * ((i) / Math.max(1, fileNames.length))));
      const data = await zip.files[name].async('blob');
      const url = URL.createObjectURL(data);
      cbzObjectUrls.push(url);
      pages.push(url);
    }
    showCbzProgress('Finalizing…', 99);
    if (pages.length === 0) throw new Error('No images found in CBZ');
    cbzState.pages = pages;
    cbzState.index = 0;
    // Save total pages and restore saved page if present
    try {
      if (item && item.src) localStorage.setItem(item.src + ':cbzPages', String(pages.length));
      const pk = (item && item.progressKey) ? String(item.progressKey) : '';
      if (pk) localStorage.setItem(pk + ':cbzPages', String(pages.length));
      const savedSrc = item && item.src ? parseInt(localStorage.getItem(item.src + ':cbzPage'), 10) : NaN;
      const savedPk = pk ? parseInt(localStorage.getItem(pk + ':cbzPage'), 10) : NaN;
      const savedPage = Number.isFinite(savedPk) ? savedPk : savedSrc;
      if (Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= pages.length) {
        cbzState.index = savedPage - 1;
      }
    } catch {}
    // Cache the pages for reuse until reload
    cbzCache.set(cacheKey, { pages });
    updateCbzPageInfo();
  } catch (e) {
    cbzState.active = false;
    clearCbzUrls();
    if (cbzViewer) cbzViewer.style.display = 'none';
    showPlayerAlert((e && e.message) ? e.message : 'Failed to load CBZ file');
  } finally {
    hideCbzProgress();
  }
}

function unloadCbz() {
  cbzState.active = false;
  if (cbzViewer) cbzViewer.style.display = 'none';
  // Do not revoke URLs here; cache persists until page reload.
}

function clearAllCbzCache() {
  try {
    // Revoke all cached pages
    cbzCache.forEach(entry => {
      (entry.pages || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    });
  } catch {}
  cbzCache.clear();
  clearCbzUrls();
}

window.addEventListener('pagehide', clearAllCbzCache);
window.addEventListener('beforeunload', clearAllCbzCache);

// Bind CBZ controls once
if (cbzPrevBtn) {
  cbzPrevBtn.addEventListener('click', () => {
    if (!cbzState.active) return;
    if (cbzState.index > 0) { cbzState.index--; updateCbzPageInfo(); }
  });
}
if (cbzNextBtn) {
  cbzNextBtn.addEventListener('click', () => {
    if (!cbzState.active) return;
    if (cbzState.index < cbzState.pages.length - 1) { cbzState.index++; updateCbzPageInfo(); }
  });
}
document.addEventListener('keydown', (e) => {
  if (!cbzState.active) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); if (cbzState.index > 0) { cbzState.index--; updateCbzPageInfo(); } }
  if (e.key === 'ArrowRight') { e.preventDefault(); if (cbzState.index < cbzState.pages.length - 1) { cbzState.index++; updateCbzPageInfo(); } }
});

function loadVideo(index) {
  const item = flatList[index];
  try {
    const sourceTitleText = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
    const itemTitleText = (item && item.title) ? item.title : 'Item';
    document.title = `${sourceTitleText} | ${itemTitleText} on RSP Media Manager`;
  } catch {}

  if (item && item.isPlaceholder) {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch {}
      video.style.display = 'none';
    }
    if (theaterBtn) theaterBtn.style.display = 'none';
    unloadCbz();
    showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
  } else if (isCbzItem(item)) {
    // Load CBZ instead of video
    if (placeholderNotice) placeholderNotice.style.display = 'none';
    unloadCbz();
    loadCbz(item);
  } else {
    if (placeholderNotice) placeholderNotice.style.display = 'none';
    // Ensure CBZ viewer is disabled when playing video
    unloadCbz();
    hideCbzShowVideo();
    if (video) {
      video.style.display = '';
      video.src = item.src;
      video.addEventListener('loadedmetadata', function onMeta() {
        // Persist duration under src and progressKey (for local folders)
        localStorage.setItem(video.src + ':duration', video.duration);
        try {
          const pk = (item && item.progressKey) ? String(item.progressKey) : '';
          if (pk) localStorage.setItem(pk + ':duration', video.duration);
        } catch {}
        video.removeEventListener('loadedmetadata', onMeta);
      });
      function onVideoError() {
        try { video.pause(); } catch {}
        video.style.display = 'none';
        showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
        video.removeEventListener('error', onVideoError);
      }
      video.addEventListener('error', onVideoError);
      let savedTime = localStorage.getItem(video.src);
      if (!savedTime && item && item.progressKey) savedTime = localStorage.getItem(String(item.progressKey));
      if (savedTime) video.currentTime = parseFloat(savedTime);
    }
    if (theaterBtn) theaterBtn.style.display = 'inline-block';
  }
  title.textContent = item.title;
  nextBtn.style.display = "none";
  if (!item.isPlaceholder && !isCbzItem(item)) { video.load(); video.play(); }
  const params = new URLSearchParams(window.location.search);
  params.set('item', index + 1);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function showPlayerAlert(message) {
  let overlay = document.getElementById('playerFailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'playerFailOverlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10050,
      color: '#ffffff', textAlign: 'center'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #333',
      borderRadius: '12px', padding: '1em 1.25em', maxWidth: '680px', boxShadow: '0 12px 30px rgba(0,0,0,0.5)'
    });
    const p = document.createElement('div'); p.style.whiteSpace = 'pre-line'; p.style.fontWeight = '800'; p.style.fontSize = '1.1rem'; p.id = 'playerFailMessage';
    const btn = document.createElement('button'); btn.textContent = 'Close'; btn.className = 'pill-button'; btn.style.marginTop = '10px';
    btn.addEventListener('click', () => {
      try { overlay.remove(); } catch {}
      try { if (typeof backBtn !== 'undefined' && backBtn) backBtn.click(); } catch {}
    });
    box.append(p, btn); overlay.appendChild(box); document.body.appendChild(overlay);
  }
  const msgEl = document.getElementById('playerFailMessage');
  if (msgEl) msgEl.textContent = message;
}

if (video) {
  video.addEventListener("timeupdate", () => {
    if (video.currentTime / video.duration > 0.9 && currentIndex < flatList.length - 1) {
      nextBtn.style.display = "inline-block";
    }
    try {
      const curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
      const pk = curItem && curItem.progressKey ? String(curItem.progressKey) : '';
      if (pk) localStorage.setItem(pk, video.currentTime);
    } catch {}
    localStorage.setItem(video.src, video.currentTime);
  });
  video.addEventListener("ended", () => {
    localStorage.removeItem(video.src);
    if (currentIndex < flatList.length - 1) { nextBtn.click(); }
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    if (currentIndex < flatList.length - 1) {
      currentIndex++;
      loadVideo(currentIndex);
    }
  });
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    try { video.pause(); } catch {}
    unloadCbz();
    playerScreen.style.display = "none";
    selectorScreen.style.display = "flex";
    backBtn.style.display = "none";
    theaterBtn.style.display = "none";
    document.body.classList.remove("theater-mode");
    try {
      const st = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
      document.title = `${st} on RSP Media Manager`;
    } catch {}
    renderEpisodeList();
    const params = new URLSearchParams(window.location.search);
    params.delete('item'); params.delete('?item');
    const query = params.toString();
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  });
}
