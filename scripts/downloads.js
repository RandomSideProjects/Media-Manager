"use strict";

async function openSeasonSelectionModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, { position: 'fixed', inset: '0', background: 'transparent', zIndex: 9998 });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #444',
      borderRadius: '10px', padding: '12px', width: '380px', boxShadow: '0 10px 24px rgba(0,0,0,0.55)', zIndex: 9999
    });
    try {
      const btn = document.getElementById('settingsBtn');
      const r = btn ? btn.getBoundingClientRect() : { top: 16, right: window.innerWidth - 16, bottom: 16 };
      panel.style.top = Math.round((r.bottom || 16) + 8) + 'px';
      panel.style.right = Math.round(Math.max(8, window.innerWidth - (r.right || (window.innerWidth - 16)))) + 'px';
    } catch {}

    const h = document.createElement('div'); h.textContent = 'Download Selection'; h.style.fontWeight = '700'; h.style.margin = '0 0 6px 0';
    const list = document.createElement('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto'; list.style.padding = '4px 0';
    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px' });
    const btnOk = document.createElement('button'); btnOk.textContent = 'Download'; btnOk.className = 'pill-button';
    const totalSpan = document.createElement('span'); totalSpan.style.color = '#b6b6b6'; totalSpan.style.whiteSpace = 'nowrap';

    // State
    const seasonCbs = [];
    const seasonSizes = [];
    const episodeCbs = []; // [seasonIndex] => [HTMLInputElement]
    const episodeSizes = []; // [seasonIndex] => [number]

    function computeTotal() {
      // Sum across selected episodes
      let sum = 0;
      for (let si = 0; si < episodeCbs.length; si++) {
        const eps = episodeCbs[si] || [];
        const sizes = episodeSizes[si] || [];
        for (let ei = 0; ei < eps.length; ei++) {
          if (eps[ei] && eps[ei].checked) {
            sum += (sizes[ei] || 0);
          }
        }
      }
      totalSpan.textContent = formatBytesDecimalMaxUnit(sum);
    }

    function updateSeasonIndeterminate(seasonIndex) {
      const cb = seasonCbs[seasonIndex];
      const eps = episodeCbs[seasonIndex] || [];
      if (!cb || eps.length === 0) return;
      const checkedCount = eps.filter(e => e.checked).length;
      cb.indeterminate = checkedCount > 0 && checkedCount < eps.length;
      cb.checked = checkedCount === eps.length;
    }

    // Build rows
    videoList.forEach((cat, idx) => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 0' });

      const leftWrap = document.createElement('div');
      Object.assign(leftWrap.style, { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 });

      const caret = document.createElement('button');
      caret.textContent = '▸';
      Object.assign(caret.style, { cursor: 'pointer', border: 'none', background: 'transparent', color: '#f1f1f1', fontSize: '14px', width: '18px', marginLeft: '6px' });

      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.index = String(idx);
      const name = document.createElement('span'); name.textContent = cat.category; name.style.marginLeft = '2px'; name.style.whiteSpace = 'nowrap'; name.style.overflow = 'hidden'; name.style.textOverflow = 'ellipsis';
      leftWrap.append(cb, name, caret);

      const sizeSpan = document.createElement('span'); sizeSpan.style.color = '#b6b6b6'; sizeSpan.style.whiteSpace = 'nowrap';
      let seasonBytes = 0; try { (cat.episodes || []).forEach(e => { const v = Number(e.fileSizeBytes); if (Number.isFinite(v) && v >= 0) seasonBytes += v; }); } catch {}
      seasonSizes[idx] = seasonBytes; sizeSpan.textContent = formatBytesDecimalMaxUnit(seasonBytes);

      row.append(leftWrap, sizeSpan); list.appendChild(row); seasonCbs.push(cb);

      // Episodes container (collapsed by default)
      const epsContainer = document.createElement('div');
      Object.assign(epsContainer.style, { display: 'none', paddingLeft: '24px', borderLeft: '1px solid #333', marginLeft: '8px' });

      const epsCbs = [];
      const epsSizes = [];
      (cat.episodes || []).forEach((ep, ei) => {
        const epRow = document.createElement('label');
        Object.assign(epRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 0' });
        const epLeft = document.createElement('span');
        const epCb = document.createElement('input'); epCb.type = 'checkbox'; epCb.checked = true; epCb.dataset.season = String(idx); epCb.dataset.episode = String(ei);
        const epTitle = document.createElement('span'); epTitle.textContent = ep.title || `Episode ${ei+1}`; epTitle.style.marginLeft = '6px';
        epLeft.append(epCb, epTitle);
        const epSize = document.createElement('span'); epSize.style.color = '#b6b6b6'; epSize.style.whiteSpace = 'nowrap';
        let epBytes = 0; try { const v = Number(ep.fileSizeBytes); if (Number.isFinite(v) && v >= 0) epBytes = v; } catch {}
        epSize.textContent = formatBytesDecimalMaxUnit(epBytes);
        epsSizes[ei] = epBytes;
        epRow.append(epLeft, epSize);
        epsContainer.appendChild(epRow);

        epCb.addEventListener('change', () => { updateSeasonIndeterminate(idx); computeTotal(); });
        epsCbs.push(epCb);
      });

      episodeCbs[idx] = epsCbs;
      episodeSizes[idx] = epsSizes;
      list.appendChild(epsContainer);

      // Caret toggle
      caret.addEventListener('click', () => {
        const isOpen = epsContainer.style.display !== 'none';
        epsContainer.style.display = isOpen ? 'none' : 'block';
        caret.textContent = isOpen ? '▸' : '▾';
      });

      // Season checkbox toggles all episodes
      cb.addEventListener('change', () => {
        const check = cb.checked;
        const eps = episodeCbs[idx] || [];
        eps.forEach(e => { e.checked = check; });
        updateSeasonIndeterminate(idx);
        computeTotal();
      });
    });

    // Initialize total and states
    videoList.forEach((_, idx) => updateSeasonIndeterminate(idx));
    computeTotal(); footer.append(btnOk, totalSpan); panel.append(h, list, footer); document.body.append(backdrop, panel);

    function closeMenu(result) { try { panel.remove(); } catch {} try { backdrop.remove(); } catch {} resolve(result); }
    backdrop.addEventListener('click', () => closeMenu(null));

    btnOk.addEventListener('click', () => {
      // Build selection: seasons where all eps checked => selectedCategories; otherwise selectedEpisodesBySeason
      const selectedCategories = new Set();
      const selectedEpisodesBySeason = {};
      for (let si = 0; si < episodeCbs.length; si++) {
        const eps = episodeCbs[si] || [];
        if (eps.length === 0) continue;
        const checkedIdxs = eps.map((cb, i) => cb.checked ? i : -1).filter(i => i >= 0);
        if (checkedIdxs.length === 0) continue;
        if (checkedIdxs.length === eps.length) {
          selectedCategories.add(si);
        } else {
          selectedEpisodesBySeason[si] = new Set(checkedIdxs);
        }
      }
      closeMenu({ selectedCategories, selectedEpisodesBySeason });
    });
  });
}

async function downloadSourceFolder(options = {}) {
  const selectedSet = options.selectedCategories instanceof Set ? options.selectedCategories : null;
  // selectedEpisodesBySeason: { [seasonIndex]: Set(episodeIndex) }
  const selectedEpisodesBySeason = (options.selectedEpisodesBySeason && typeof options.selectedEpisodesBySeason === 'object') ? options.selectedEpisodesBySeason : null;
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999, fontFamily: 'Segoe UI, sans-serif', textAlign: 'center' });
  document.body.appendChild(overlay);

  let cancelRequested = false; const xhrs = [];
  const rowsContainer = document.createElement('div'); rowsContainer.style.width = '80%'; overlay.appendChild(rowsContainer);

  const zip = new JSZip();
  const titleText = (directoryTitle.textContent || 'directory').trim() || 'directory';
  const safeZipSegment = (name) => { try { return String(name || '').replace(/[\\/]+/g, ' - ').replace(/[<>:"|?*]+/g, '').replace(/\s{2,}/g, ' ').trim(); } catch { return 'untitled'; } };
  const rootFolder = zip.folder(titleText);
  rootFolder.file('PUT THIS FOLDER IN YOUR /DIRECTORYS/ FOLDER.txt', 'https://github.com/RandomSideProjects/Media-Manager/ is the origin of this web app.');

  // Add a LocalID so local-folder progress keys can be stable across sessions
  let localId;
  try { const n = Math.floor((Date.now() + Math.random() * 1000000)) % 1000000; localId = `Local${String(n).padStart(6, '0')}`; }
  catch { localId = 'Local000000'; }
  const manifest = { title: titleText, Image: sourceImageUrl || 'N/A', categories: [], LocalID: localId };
  const catFolders = []; const catObjs = [];
  const sanitizedCats = videoList.map(cat => safeZipSegment(cat.category));
  videoList.forEach((cat, i) => {
    const catFolder = rootFolder.folder(sanitizedCats[i]); catFolders.push(catFolder);
    const episodesPlaceholders = cat.episodes.map((ep, ei) => {
      let ext = '.mp4';
      try {
        const urlParts = new URL(ep.src, window.location.href);
        const origName = decodeURIComponent(urlParts.pathname.split('/').pop());
        if (origName && origName.includes('.')) ext = origName.slice(origName.lastIndexOf('.')).toLowerCase();
      } catch {}
      const pad = String(ei + 1).padStart(2, '0');
      const isCbz = ext === '.cbz';
      const isJsonVolume = ext === '.json';
      const prefix = (isCbz || isJsonVolume) ? 'V' : 'E';
      // For JSON volumes, store an index.json within a V##/ subfolder
      const localPath = isJsonVolume
        ? `Directorys/${titleText}/${sanitizedCats[i]}/${prefix}${pad}/index.json`
        : `Directorys/${titleText}/${sanitizedCats[i]}/${prefix}${pad}${ext}`;
      const base = { title: ep.title, src: localPath, fileSizeBytes: (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null };
      if (isCbz || isJsonVolume) { base.VolumePageCount = (typeof ep.VolumePageCount === 'number') ? ep.VolumePageCount : null; }
      else { base.durationSeconds = (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null; }
      return base;
    });
    const catObj = { category: cat.category, episodes: episodesPlaceholders }; catObjs.push(catObj); manifest.categories.push(catObj);
  });

  const plannedNames = videoList.map(() => []);
  const tasks = [];
  videoList.forEach((cat, ci) => {
    cat.episodes.forEach((episode, ei) => {
      const urlParts = new URL(episode.src, window.location.href);
      const origName = decodeURIComponent(urlParts.pathname.split('/').pop());
      const ext = origName.includes('.') ? origName.slice(origName.lastIndexOf('.')).toLowerCase() : '';
      const pad = String(ei + 1).padStart(2, '0');
      const prefix = (ext === '.cbz' || ext === '.json') ? 'V' : 'E';
      const fileName = `${prefix}${pad}${ext}`; plannedNames[ci][ei] = fileName;
      let shouldDownload = true;
      const epSet = selectedEpisodesBySeason && selectedEpisodesBySeason[ci];
      if (epSet instanceof Set) {
        shouldDownload = epSet.has(ei);
      } else if (selectedSet) {
        shouldDownload = selectedSet.has(ci);
      } else {
        shouldDownload = true;
      }
      if (shouldDownload) tasks.push({ ci, ei, episode, fileName });
    });
  });

  const progressBars = []; const loadedBytes = Array(tasks.length).fill(0); const totalBytes = Array(tasks.length).fill(0);
  const dataLeftLabels = [];
  tasks.forEach(({ ci, ei }, idx) => {
    const row = document.createElement('div'); Object.assign(row.style, { display: 'flex', alignItems: 'center', margin: '0.5em 0' });
    const label = document.createElement('span'); label.textContent = `S${ci+1}E${ei+1}`; label.style.width = '4em';
    const progress = document.createElement('progress'); progress.max = 100; progress.value = 0; progress.style.flex = '1';
    row.append(label, progress);
    const dataLeft = document.createElement('span'); dataLeft.style.marginLeft = '0.5em'; dataLeft.style.color = '#6ec1e4'; dataLeft.textContent = '';
    row.appendChild(dataLeft); dataLeftLabels[idx] = dataLeft;
    rowsContainer.appendChild(row); progressBars[idx] = progress;
  });

  let plannedTotalBytes = 0; try { for (const { episode } of tasks) { const v = Number(episode && episode.fileSizeBytes); if (Number.isFinite(v) && v >= 0) plannedTotalBytes += v; } } catch {}
  const etaLabel = document.createElement('div'); etaLabel.style.margin = '0.5em'; etaLabel.style.color = '#6ec1e4'; overlay.insertBefore(etaLabel, rowsContainer);
  const speedLabel = document.createElement('div'); speedLabel.style.margin = '0.5em'; speedLabel.style.color = '#6ec1e4'; overlay.insertBefore(speedLabel, etaLabel);
  const remainingLabel = document.createElement('div'); remainingLabel.style.margin = '0.5em'; remainingLabel.style.color = '#6ec1e4'; remainingLabel.textContent = 'Remaining: ' + formatBytes(plannedTotalBytes); overlay.insertBefore(remainingLabel, etaLabel);
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'Cancel'; cancelBtn.className = 'pill-button'; cancelBtn.style.marginTop = '1em'; overlay.appendChild(cancelBtn);
  cancelBtn.addEventListener('click', () => { cancelRequested = true; xhrs.forEach(x => x.abort()); overlay.remove(); });

  const DEFAULT_DL_CONCURRENCY = 2; const storedDlConc = parseInt(localStorage.getItem('downloadConcurrency') || '', 10);
  const concurrency = (Number.isFinite(storedDlConc) && storedDlConc > 0) ? Math.max(1, Math.min(8, storedDlConc)) : DEFAULT_DL_CONCURRENCY;
  let pointer = 0; let lastTime = Date.now(); let lastLoaded = 0; let avgSpeed = 0; let downloadedBytes = 0;

  async function computeBlobDurationSeconds(blob) {
    return new Promise((resolve) => { try { const url = URL.createObjectURL(blob); const v = document.createElement('video'); v.preload = 'metadata'; const done = () => { try { URL.revokeObjectURL(url); } catch {} const d = isFinite(v.duration) ? v.duration : NaN; resolve(d); }; v.onloadedmetadata = done; v.onerror = done; v.src = url; } catch { resolve(NaN); } });
  }

  async function computeBlobPageCount(blob) {
    try {
      const zip = await JSZip.loadAsync(blob);
      const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
      return names.length;
    } catch { return NaN; }
  }

  const workers = Array.from({ length: concurrency }, async () => {
    while (!cancelRequested && pointer < tasks.length) {
      const idx = pointer++;
      const { ci, ei, episode, fileName } = tasks[idx];
      try {
        const isJson = fileName.toLowerCase().endsWith('.json');
        if (isJson) {
          // JSON volume: fetch JSON, inline remote links as base64 data URIs, save JSON
          const epObj = catObjs[ci].episodes[ei];
          const folderPath = `Directorys/${titleText}/${sanitizedCats[ci]}/`;
          const pad = String(ei + 1).padStart(2, '0');
          const volFolderName = `V${pad}`;
          const volFolder = catFolders[ci].folder(volFolderName);
          // Point to the nested index.json
          epObj.src = `${folderPath}${volFolderName}/index.json`;

          // Helper to fetch a URL to Blob and detect extension
          function mimeToExt(mime) {
            const m = String(mime || '').toLowerCase();
            if (m.includes('jpeg')) return '.jpg';
            if (m.includes('jpg')) return '.jpg';
            if (m.includes('png')) return '.png';
            if (m.includes('webp')) return '.webp';
            if (m.includes('gif')) return '.gif';
            if (m.includes('bmp')) return '.bmp';
            if (m.includes('svg')) return '.svg';
            return '';
          }
          async function fetchImage(u) {
            // Try XHR first to get progress
            try {
              const blob = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest(); xhrs.push(xhr);
                xhr.addEventListener('loadend', () => { const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1); });
                xhr.open('GET', u); xhr.responseType = 'blob';
                xhr.onload = () => ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) ? resolve(xhr.response) : reject(new Error('HTTP ' + xhr.status));
                xhr.onerror = () => reject(new Error('Network error'));
                xhr.send();
              });
              const type = (blob && blob.type) || '';
              let ext = mimeToExt(type);
              if (!ext) {
                try { const urlParts = new URL(u, window.location.href); const name = decodeURIComponent(urlParts.pathname.split('/').pop()); if (name && name.includes('.')) ext = name.slice(name.lastIndexOf('.')).toLowerCase(); } catch {}
              }
              return { blob, ext: ext || '.jpg' };
            } catch {
              const resp = await fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (!resp || (!resp.ok && resp.status !== 0)) throw new Error('fetch failed');
              const blob = await resp.blob();
              const type = (blob && blob.type) || '';
              let ext = mimeToExt(type);
              if (!ext) {
                try { const urlParts = new URL(u, window.location.href); const name = decodeURIComponent(urlParts.pathname.split('/').pop()); if (name && name.includes('.')) ext = name.slice(name.lastIndexOf('.')).toLowerCase(); } catch {}
              }
              return { blob, ext: ext || '.jpg' };
            }
          }

          // Fetch the JSON text (try XHR first to match cross-origin behavior of other downloads)
          let jsonText = '';
          try {
            const blob = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest(); xhrs.push(xhr);
              xhr.addEventListener('loadend', () => { const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1); });
              xhr.open('GET', episode.src); xhr.responseType = 'blob';
              xhr.onprogress = (e) => {
                if (e.lengthComputable) {
                  // Map network progress to a small early bump (0-10%)
                  const pct = Math.min(10, (e.loaded / Math.max(1, e.total)) * 10);
                  try { progressBars[idx].value = pct; } catch {}
                }
              };
              xhr.onload = () => ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0)
                ? resolve(xhr.response)
                : reject(new Error('Download failed: ' + xhr.status));
              xhr.onerror = () => reject(new Error('Network error'));
              xhr.send();
            });
            jsonText = await blob.text();
          } catch {
            const resp = await fetch(episode.src, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!resp || (!resp.ok && resp.status !== 0)) throw new Error('Download failed');
            jsonText = await resp.text();
          }
          let json;
          try { json = JSON.parse(jsonText); } catch { throw new Error('Invalid JSON'); }
          // Extract page URLs from JSON (supports array or object mapping form)
          function parsePages(j) {
            try {
              if (!j || typeof j !== 'object') return [];
              if (Array.isArray(j.pages)) {
                return j.pages.map(p => {
                  if (typeof p === 'string') return p; if (p && typeof p === 'object') return p.src || p.url || p.data || ''; return '';
                }).filter(Boolean);
              }
              if (Array.isArray(j.images)) {
                return j.images.map(p => (typeof p === 'string') ? p : (p && (p.src || p.url || p.data) || '')).filter(Boolean);
              }
              const candidates = j.pages && typeof j.pages === 'object' ? j.pages : j;
              const entries = Object.entries(candidates).map(([k, v]) => {
                let n = NaN; try { const m = String(k).match(/(\d+)/); if (m) n = parseInt(m[1], 10); } catch {}
                let url = ''; if (typeof v === 'string') url = v; else if (v && typeof v === 'object') url = v.src || v.url || v.data || '';
                return { n, url };
              }).filter(e => Number.isFinite(e.n) && e.n >= 1 && e.url);
              entries.sort((a, b) => a.n - b.n);
              return entries.map(e => e.url);
            } catch { return []; }
          }
          const pageUrls = parsePages(json);
          const totalLinks = pageUrls.length;
          let completed = 0;
          function updateProgress() {
            try {
              const pct = totalLinks > 0 ? (completed / totalLinks) * 100 : 100;
              progressBars[idx].value = pct;
              dataLeftLabels[idx].textContent = totalLinks > 0 ? `${completed}/${totalLinks} files` : '';
            } catch {}
          }
          updateProgress();

          const perItemConcurrency = Math.min(4, Math.max(1, concurrency));
          let linkPtr = 0;
          const filesOut = Array(totalLinks).fill(null);
          let bytesSum = 0;
          async function workerDl() {
            while (linkPtr < totalLinks) {
              const i = linkPtr++;
              const { blob, ext } = await fetchImage(pageUrls[i]);
              filesOut[i] = { blob, ext };
              try { if (blob && typeof blob.size === 'number') bytesSum += blob.size; } catch {}
              completed++;
              updateProgress();
            }
          }
          await Promise.all(Array.from({ length: perItemConcurrency }, workerDl));

          // Write files and index.json
          const pageList = [];
          for (let i = 0; i < filesOut.length; i++) {
            const f = filesOut[i]; if (!f) continue; const name = `${String(i+1).padStart(3,'0')}${f.ext}`;
            volFolder.file(name, f.blob);
            pageList.push(name);
          }
          const pagesObj = {};
          for (let i = 0; i < pageList.length; i++) pagesObj[`Page ${i+1}`] = pageList[i];
          const outJson = { pagecount: pageList.length, pages: pagesObj };
          const outText = JSON.stringify(outJson, null, 2);
          volFolder.file('index.json', outText);

          // Update manifest ep
          try { const sz = new TextEncoder().encode(outText).length; epObj.fileSizeBytes = bytesSum + sz; downloadedBytes += (bytesSum + sz); } catch { epObj.fileSizeBytes = bytesSum; }
          epObj.VolumePageCount = pageList.length;
          epObj.durationSeconds = null;
        } else {
          // Regular path: download blob directly
          let blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest(); xhrs.push(xhr);
            xhr.addEventListener('loadend', () => { const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1); });
            xhr.open('GET', episode.src); xhr.responseType = 'blob';
            xhr.addEventListener('progress', e => {
              if (e.lengthComputable) {
                progressBars[idx].value = (e.loaded / e.total) * 100; loadedBytes[idx] = e.loaded; totalBytes[idx] = e.total;
                const totalLoaded = loadedBytes.reduce((a, b) => a + b, 0); const totalTotal = totalBytes.reduce((a, b) => a + b, 0);
                const now = Date.now(); const dt = (now - lastTime) / 1000; let speed = 0; if (dt > 0) { speed = (totalLoaded - lastLoaded) / dt; avgSpeed = avgSpeed * 0.8 + speed * 0.2; lastTime = now; lastLoaded = totalLoaded; }
                const remaining = totalTotal - totalLoaded; let eta = ''; if (avgSpeed > 0 && remaining > 0) { const seconds = remaining / avgSpeed; const min = Math.floor(seconds / 60); const sec = Math.round(seconds % 60); eta = `ETA: ${min}m ${sec}s`; }
                etaLabel.textContent = eta; const speedMBps = (speed / (1024 * 1024)).toFixed(2); speedLabel.textContent = `Speed: ${speedMBps} MB/s`;
                const remainingBytes = totalBytes[idx] - loadedBytes[idx]; const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(2); dataLeftLabels[idx].textContent = `${remainingMB} MB left`;
                const loadedSum = loadedBytes.reduce((a, b) => a + b, 0); const remainFromSource = Math.max(0, plannedTotalBytes - loadedSum); remainingLabel.textContent = 'Remaining: ' + formatBytes(remainFromSource);
              }
            });
            // Treat status 0 as success for opaque/file responses (matches player.js behavior)
            xhr.onload = () => ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0)
              ? resolve(xhr.response)
              : reject(new Error('Download failed: ' + xhr.status));
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send();
          }).catch(() => null);

          // Fallback to fetch if XHR fails (some hosts behave better with fetch)
          if (!blob) {
            try {
              const resp = await fetch(episode.src, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
              if (resp && (resp.ok || resp.status === 0)) {
                blob = await resp.blob();
              }
            } catch {
              // ignore; will throw below if blob still null
            }
          }

          if (!blob) throw new Error('Download failed');
          catFolders[ci].file(fileName, blob);
          const epObj = catObjs[ci].episodes[ei]; epObj.src = `Directorys/${titleText}/${sanitizedCats[ci]}/${fileName}`;
          try { const sz = Number(blob && blob.size); if (Number.isFinite(sz) && sz >= 0) { epObj.fileSizeBytes = sz; downloadedBytes += sz; } } catch {}
          // Set per-item metadata by type
          if (fileName.toLowerCase().endsWith('.cbz')) {
            try { const pages = await computeBlobPageCount(blob); if (Number.isFinite(pages) && pages >= 0) epObj.VolumePageCount = pages; } catch {}
            epObj.durationSeconds = null;
          } else {
            try { const d = await computeBlobDurationSeconds(blob); if (Number.isFinite(d) && d > 0) { const sec = Math.round(d); epObj.durationSeconds = sec; } } catch {}
          }
        }
      } catch (err) {
        console.error('Error downloading', episode.src, err);
      }
    }
  });

  await Promise.all(workers);
  if (cancelRequested) { return; }
  let totalBytesAll = 0, totalSecsAll = 0, totalPagesAll = 0;
  try {
    for (const c of catObjs) {
      for (const e of c.episodes) {
        const b = Number(e.fileSizeBytes);
        const d = Number(e.durationSeconds);
        const p = Number(e.VolumePageCount);
        if (Number.isFinite(b) && b >= 0) totalBytesAll += Math.floor(b);
        if (Number.isFinite(d) && d >= 0) totalSecsAll += Math.floor(d);
        if (Number.isFinite(p) && p >= 0) totalPagesAll += Math.floor(p);
      }
    }
  } catch {}
  manifest.totalFileSizeBytes = totalBytesAll || 0;
  // Only include duration total when there are non-zero durations
  if (totalSecsAll > 0) manifest.totalDurationSeconds = totalSecsAll;
  // Include totalPagecount if there are CBZ volumes
  if (totalPagesAll > 0) manifest.totalPagecount = totalPagesAll;

  async function fetchAsDataURL(url) {
    try { const resp = await fetch(url, { cache: 'no-store' }); if (!resp.ok) throw new Error('image fetch failed'); const blob = await resp.blob(); return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || '')); fr.onerror = reject; fr.readAsDataURL(blob); }); } catch { return null; }
  }
  if (sourceImageUrl) { try { const dataUrl = await fetchAsDataURL(sourceImageUrl); if (dataUrl) manifest.Image = dataUrl; } catch {} }
  rootFolder.file('index.json', JSON.stringify(manifest, null, 2));
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  const zipBase = String(titleText || 'download').trim().replace(/ /g, '_');
  a.download = `${zipBase}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  overlay.remove();
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', async () => {
    const selectiveEnabled = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
    if (!selectiveEnabled) { downloadSourceFolder(); return; }
    const selected = await openSeasonSelectionModal();
    if (selected === null) return;
    // selected can include { selectedCategories: Set<number>, selectedEpisodesBySeason: { [seasonIdx]: Set<number> } }
    downloadSourceFolder({ selectedCategories: selected.selectedCategories, selectedEpisodesBySeason: selected.selectedEpisodesBySeason });
  });
}
