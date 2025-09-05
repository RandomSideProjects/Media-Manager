"use strict";

async function openSeasonSelectionModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, { position: 'fixed', inset: '0', background: 'transparent', zIndex: 9998 });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #444',
      borderRadius: '10px', padding: '12px', width: '340px', boxShadow: '0 10px 24px rgba(0,0,0,0.55)', zIndex: 9999
    });
    try {
      const btn = document.getElementById('settingsBtn');
      const r = btn ? btn.getBoundingClientRect() : { top: 16, right: window.innerWidth - 16, bottom: 16 };
      panel.style.top = Math.round((r.bottom || 16) + 8) + 'px';
      panel.style.right = Math.round(Math.max(8, window.innerWidth - (r.right || (window.innerWidth - 16)))) + 'px';
    } catch {}

    const h = document.createElement('div'); h.textContent = 'Download Seasons'; h.style.fontWeight = '700'; h.style.margin = '0 0 6px 0';
    const list = document.createElement('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto'; list.style.padding = '4px 0';
    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px' });
    const btnOk = document.createElement('button'); btnOk.textContent = 'Download'; btnOk.className = 'pill-button';
    const totalSpan = document.createElement('span'); totalSpan.style.color = '#b6b6b6'; totalSpan.style.whiteSpace = 'nowrap';

    const checkboxes = [];
    const seasonSizes = [];
    function computeTotal() {
      let sum = 0; checkboxes.forEach((cb, i) => { if (cb.checked) sum += (seasonSizes[i] || 0); });
      totalSpan.textContent = formatBytesDecimalMaxUnit(sum);
    }

    videoList.forEach((cat, idx) => {
      const row = document.createElement('label');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 0' });
      const leftWrap = document.createElement('span');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.index = String(idx);
      const name = document.createElement('span'); name.textContent = cat.category; name.style.marginLeft = '6px';
      leftWrap.append(cb, name);
      const sizeSpan = document.createElement('span'); sizeSpan.style.color = '#b6b6b6'; sizeSpan.style.whiteSpace = 'nowrap';
      let seasonBytes = 0; try { (cat.episodes || []).forEach(e => { const v = Number(e.fileSizeBytes); if (Number.isFinite(v) && v >= 0) seasonBytes += v; }); } catch {}
      seasonSizes[idx] = seasonBytes; sizeSpan.textContent = formatBytesDecimalMaxUnit(seasonBytes);
      row.append(leftWrap, sizeSpan); list.appendChild(row); checkboxes.push(cb); cb.addEventListener('change', computeTotal);
    });

    computeTotal(); footer.append(btnOk, totalSpan); panel.append(h, list, footer); document.body.append(backdrop, panel);
    function closeMenu(result) { try { panel.remove(); } catch {} try { backdrop.remove(); } catch {} resolve(result); }
    backdrop.addEventListener('click', () => closeMenu(null));
    btnOk.addEventListener('click', () => { const selected = new Set(checkboxes.filter(cb => cb.checked).map(cb => parseInt(cb.dataset.index, 10))); closeMenu(selected); });
  });
}

async function downloadSourceFolder(options = {}) {
  const selectedSet = options.selectedCategories instanceof Set ? options.selectedCategories : null;
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

  const manifest = { title: titleText, Image: sourceImageUrl || 'N/A', categories: [] };
  const catFolders = []; const catObjs = [];
  const sanitizedCats = videoList.map(cat => safeZipSegment(cat.category));
  videoList.forEach((cat, i) => {
    const catFolder = rootFolder.folder(sanitizedCats[i]); catFolders.push(catFolder);
    const episodesPlaceholders = cat.episodes.map((ep, ei) => {
      let ext = '.mp4';
      try { const urlParts = new URL(ep.src, window.location.href); const origName = decodeURIComponent(urlParts.pathname.split('/').pop()); if (origName && origName.includes('.')) ext = origName.slice(origName.lastIndexOf('.')); } catch {}
      const pad = String(ei + 1).padStart(2, '0'); const localPath = `Directorys/${titleText}/${sanitizedCats[i]}/E${pad}${ext}`;
      return { title: ep.title, src: localPath, fileSizeBytes: (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null, durationSeconds: (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null };
    });
    const catObj = { category: cat.category, episodes: episodesPlaceholders }; catObjs.push(catObj); manifest.categories.push(catObj);
  });

  const plannedNames = videoList.map(() => []);
  const tasks = [];
  videoList.forEach((cat, ci) => {
    cat.episodes.forEach((episode, ei) => {
      const urlParts = new URL(episode.src, window.location.href);
      const origName = decodeURIComponent(urlParts.pathname.split('/').pop());
      const ext = origName.includes('.') ? origName.slice(origName.lastIndexOf('.')) : '';
      const pad = String(ei + 1).padStart(2, '0');
      const fileName = `E${pad}${ext}`; plannedNames[ci][ei] = fileName;
      const shouldDownload = !selectedSet || selectedSet.has(ci); if (shouldDownload) tasks.push({ ci, ei, episode, fileName });
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

  const workers = Array.from({ length: concurrency }, async () => {
    while (!cancelRequested && pointer < tasks.length) {
      const idx = pointer++;
      const { ci, ei, episode, fileName } = tasks[idx];
      try {
        const blob = await new Promise((resolve, reject) => {
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
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error('Download failed: ' + xhr.status));
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send();
        });
        catFolders[ci].file(fileName, blob);
        const epObj = catObjs[ci].episodes[ei]; epObj.src = `Directorys/${titleText}/${sanitizedCats[ci]}/${fileName}`;
        try { const sz = Number(blob && blob.size); if (Number.isFinite(sz) && sz >= 0) { epObj.fileSizeBytes = sz; downloadedBytes += sz; } } catch {}
        try { const d = await computeBlobDurationSeconds(blob); if (Number.isFinite(d) && d > 0) { const sec = Math.round(d); epObj.durationSeconds = sec; } } catch {}
      } catch (err) {
        console.error('Error downloading', episode.src, err);
      }
    }
  });

  await Promise.all(workers);
  if (cancelRequested) { return; }
  let totalBytesAll = 0, totalSecsAll = 0;
  try { for (const c of catObjs) { for (const e of c.episodes) { const b = Number(e.fileSizeBytes); const d = Number(e.durationSeconds); if (Number.isFinite(b) && b >= 0) totalBytesAll += Math.floor(b); if (Number.isFinite(d) && d >= 0) totalSecsAll += Math.floor(d); } } } catch {}
  manifest.totalFileSizeBytes = totalBytesAll || 0; manifest.totalDurationSeconds = totalSecsAll || 0;

  async function fetchAsDataURL(url) {
    try { const resp = await fetch(url, { cache: 'no-store' }); if (!resp.ok) throw new Error('image fetch failed'); const blob = await resp.blob(); return await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result || '')); fr.onerror = reject; fr.readAsDataURL(blob); }); } catch { return null; }
  }
  if (sourceImageUrl) { try { const dataUrl = await fetchAsDataURL(sourceImageUrl); if (dataUrl) manifest.Image = dataUrl; } catch {} }
  rootFolder.file('index.json', JSON.stringify(manifest, null, 2));
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${titleText}.zip`; document.body.appendChild(a); a.click(); a.remove(); overlay.remove();
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', async () => {
    const selectiveEnabled = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
    if (!selectiveEnabled || (Array.isArray(videoList) && videoList.length <= 1)) { downloadSourceFolder(); return; }
    const selected = await openSeasonSelectionModal(); if (selected === null) return; downloadSourceFolder({ selectedCategories: selected });
  });
}

