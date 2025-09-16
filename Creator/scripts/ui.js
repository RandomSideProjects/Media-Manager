"use strict";

// Variables (top)
const categoriesEl = document.getElementById('categories');
const posterInput = document.getElementById('posterInput');
const posterPreview = document.getElementById('posterPreview');
const posterStatus = document.getElementById('posterStatus');
const posterProgress = document.getElementById('posterProgress');
let posterImageUrl = '';
const posterWrapper = document.getElementById('posterWrapper');
const posterChangeBtn = document.getElementById('posterChangeBtn');
const addCategoryBtn = document.getElementById('addCategory');
const outputEl = document.getElementById('output');
const loadUrlInput = document.getElementById('loadUrl');
const createTabBtn = document.getElementById('createTabBtn');
const editTabBtn = document.getElementById('editTabBtn');
const loadUrlContainer = document.getElementById('loadUrlContainer');
const homeTabBtn = document.getElementById('homeTabBtn');
const folderInput = document.getElementById('folderInput');
let isFolderUploading = false;
let __currentCreatorMode = (function(){ try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; } })();
function getCreatorMode(){
  try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; }
}
function isMangaMode(){ return getCreatorMode() === 'manga'; }
function labelForUnit(n){ return isMangaMode() ? `Volume ${n}` : `Episode ${n}`; }
function unitTitlePlaceholder(){ return isMangaMode() ? 'Volume Title' : 'Episode Title'; }
function getCreatorMode(){
  try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; }
}
function isMangaMode(){ return getCreatorMode() === 'manga'; }
function labelForUnit(n){ return isMangaMode() ? `Volume ${n}` : `Episode ${n}`; }
function unitTitlePlaceholder(){ return isMangaMode() ? 'Volume Title' : 'Episode Title'; }
function updateCategoryButtonVisibility(){
  try {
    if (!addCategoryBtn) return;
    addCategoryBtn.textContent = isMangaMode() ? 'Add Volumes' : 'Add Category';
    // Allow multiple categories in Manga mode as well
    addCategoryBtn.disabled = false;
    addCategoryBtn.style.opacity = '';
  } catch {}
}
function getUploadConcurrency(){
  try {
    const raw = localStorage.getItem('mm_upload_settings') || '{}';
    const p = JSON.parse(raw);
    const v = parseInt(p.uploadConcurrency, 10);
    return (Number.isFinite(v) && v >= 1 && v <= 8) ? v : 2;
  } catch { return 2; }
}
const outputLink = document.getElementById('outputLink');
let isFullUrl = false;
let directoryCode = '';

// Helpers
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Poster selection and upload
if (posterInput) {
  posterInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const localUrl = URL.createObjectURL(file);
      posterPreview.src = localUrl;
      if (posterWrapper) posterWrapper.style.display = 'inline-block';
      if (posterInput) posterInput.style.display = 'none';
    } catch {}
    if (posterChangeBtn) posterChangeBtn.style.display = 'inline-block';
    if (posterStatus) posterStatus.style.display = 'inline-block';
    if (posterProgress) posterProgress.value = 0;
    try {
      const url = await uploadToCatboxWithProgress(file, pct => { if (posterProgress) posterProgress.value = pct; });
      posterImageUrl = (url || '').trim();
      if (posterStatus) posterStatus.style.display = 'none';
    } catch (err) {
      if (posterStatus) { posterStatus.style.display = 'inline-block'; posterStatus.style.color = '#ff6b6b'; posterStatus.textContent = 'Failed to upload poster.'; }
    }
  });
}
if (posterChangeBtn) posterChangeBtn.addEventListener('click', () => {
  try { posterInput.value = ''; } catch {}
  posterImageUrl = '';
  if (posterPreview) posterPreview.src = '';
  if (posterWrapper) posterWrapper.style.display = 'none';
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterInput) posterInput.style.display = 'inline-block';
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
});

// Folder selection and bulk upload
folderInput.addEventListener('change', async (e) => {
  try {
    isFolderUploading = true;
    folderInput.value = '';

    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Prompt for season/collection index or create new
    const seasonIndex = categoriesEl.children.length + 1;
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Category Title:';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    if (isMangaMode()) { titleInput.placeholder = 'Volumes'; titleInput.value = 'Volumes'; }
    else { titleInput.placeholder = `Season ${seasonIndex}`; titleInput.value = `Season ${seasonIndex}`; }
    titleLabel.appendChild(document.createElement('br'));
    titleLabel.appendChild(titleInput);
    const episodesDiv = document.createElement('div');
    episodesDiv.className = 'episodes';
    categoryDiv.appendChild(titleLabel);
    categoryDiv.appendChild(episodesDiv);
    categoriesEl.appendChild(categoryDiv);

    // Derive numbers and labels from filenames
    const filesInSeason = files
      .map((file, idx) => {
        const name = (file.webkitRelativePath || file.name || '').split('/').pop();
        let num = idx + 1;
        let label = null;
        if (isMangaMode()) {
          // Prefer Chapter detection: matches "Chapter ###", "c###", or a standalone number with a preceding space " ###"
          const mc = name.match(/\bchapter\s*(\d{1,4})\b/i) || name.match(/\bc\s*0?(\d{1,4})\b/i);
          if (mc) {
            num = parseInt(mc[1], 10);
            label = `Chapter ${num}`;
          } else {
            const ms = name.match(/ (0?\d{1,4})\b/);
            if (ms) { num = parseInt(ms[1], 10); label = `Chapter ${num}`; }
            else {
              const mv = name.match(/(?:\bvol(?:ume)?\s*|\bv\s*)(\d{1,3})/i);
              if (mv) { num = parseInt(mv[1], 10); label = `Volume ${num}`; }
            }
          }
        } else {
          const me = name.match(/E0?(\d{1,3})/i);
          if (me) num = parseInt(me[1], 10);
        }
        return { file, num, label };
      })
      .sort((a, b) => a.num - b.num);

    // Overlay UI for progress
    let folderOverlay = document.getElementById('folderUploadOverlay');
    if (!folderOverlay) {
      folderOverlay = document.createElement('div');
      folderOverlay.id = 'folderUploadOverlay';
    }
    folderOverlay.style.position = 'fixed';
    folderOverlay.style.inset = '0';
    folderOverlay.style.background = 'rgba(0,0,0,0.6)';
    folderOverlay.style.zIndex = '10030';
    folderOverlay.style.display = 'flex';
    folderOverlay.style.alignItems = 'center';
    folderOverlay.style.justifyContent = 'center';
    folderOverlay.innerHTML = `
      <div style="background:#1a1a1a; color:#f1f1f1; border:1px solid #333; border-radius:12px; padding:14px 16px; width:92%; max-width:720px; box-shadow:0 14px 28px rgba(0,0,0,0.55);">
        <h3 style="margin:0 0 8px 0;">Uploading folder…</h3>
        <div id="folderUploadSummary" style="margin-bottom:8px; opacity:.9;">Starting…</div>
        <div id="folderUploadList" style="display:flex; flex-direction:column; gap:6px; max-height:50vh; overflow:auto;"></div>
      </div>
    `;
    document.body.appendChild(folderOverlay);
    const folderUploadList = folderOverlay.querySelector('#folderUploadList');
    const folderUploadSummary = folderOverlay.querySelector('#folderUploadSummary');
    folderUploadSummary.textContent = `0 / ${filesInSeason.length} completed`;

    const taskFns = [];
    const maxAttempts = 5;
    let completedCount = 0;

    filesInSeason.forEach(async ({ file, num, label }) => {
      addEpisode(episodesDiv, { title: label || labelForUnit(num), src: '' });
      const epDiv = episodesDiv.lastElementChild;
      try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      if (isMangaMode() && /\.cbz$/i.test(file.name||'')) {
        try { const ab = await file.arrayBuffer(); const zip = await JSZip.loadAsync(ab); const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n)); epDiv.dataset.VolumePageCount = String(names.length); epDiv.dataset.volumePageCount = String(names.length); } catch {}
      } else {
        try { computeLocalFileDurationSeconds(file).then(d => { if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d)); }); } catch {}
      }
      const inputs = epDiv.querySelectorAll('input[type="text"]');
      const epSrcInput = inputs[1];
      const epError = epDiv.querySelector('.ep-error');
      epError.textContent = '';

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.75em';
      row.style.padding = '6px 8px';
      row.style.background = '#222';
      row.style.borderRadius = '6px';
      row.style.fontSize = '0.9em';
      const labelEl = document.createElement('div');
      labelEl.textContent = label || labelForUnit(num);
      labelEl.style.flex = '1';
      const status = document.createElement('div');
      status.textContent = 'Queued';
      status.style.minWidth = '110px';
      const progressWrapper = document.createElement('div');
      progressWrapper.style.flex = '2';
      const prog = document.createElement('progress');
      prog.max = 100; prog.value = 0; prog.style.width = '100%';
      progressWrapper.appendChild(prog);
      row.appendChild(labelEl);
      row.appendChild(progressWrapper);
      row.appendChild(status);
      folderUploadList.appendChild(row);

      const fn = async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          status.textContent = (attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`;
          prog.value = 0;
          try {
            const url = await uploadToCatboxWithProgress(file, pct => { prog.value = pct; }, { context: 'batch' });
            epSrcInput.value = url;
            epError.textContent = '';
            status.textContent = 'Done';
            status.style.color = '#6ec1e4';
            prog.value = 100;
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${filesInSeason.length} completed`;
            return;
          } catch (err) {
            if (attempt < maxAttempts) {
              const base = 800 * Math.pow(2, attempt - 1);
              const jitter = base * (0.3 + Math.random() * 0.4);
              await sleep(base + jitter);
              continue;
            }
            status.textContent = 'Failed';
            status.style.color = '#ff4444';
            epError.innerHTML = '<span style="color:red">Upload failed</span>';
            return;
          }
        }
      };
      taskFns.push(fn);
    });

    const runWithConcurrency = async (fns, limit) => {
      let idx = 0;
      const workers = Array.from({ length: Math.min(limit, fns.length) }, async () => {
        while (idx < fns.length) {
          const current = fns[idx++];
          await current();
        }
      });
      await Promise.all(workers);
    };

    try {
      await runWithConcurrency(taskFns, getUploadConcurrency());
    } finally {
      isFolderUploading = false;
      if (folderOverlay) folderOverlay.remove();
    }
  } finally {
    isFolderUploading = false;
  }
});

// Add a new category block
function addCategory(data) {
  // Allow multiple categories in Manga mode
  const categoryIndex = categoriesEl.children.length + 1;
  const categoryDiv = document.createElement('div');
  categoryDiv.className = 'category';
  categoryDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    confirmModal.style.display = 'flex';
    pendingRemoval = { type: 'category', elem: categoryDiv };
  });

  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Category Title:';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  if (isMangaMode()) {
    titleInput.placeholder = 'Volumes';
    if (data && data.category) { titleInput.value = data.category; } else { titleInput.value = 'Volumes'; }
  } else {
    titleInput.placeholder = `Season ${categoryIndex}`;
    if (data && data.category) { titleInput.value = data.category; } else { titleInput.value = `Season ${categoryIndex}`; }
  }
  titleLabel.appendChild(document.createElement('br'));
  titleLabel.appendChild(titleInput);

  const episodesDiv = document.createElement('div');
  episodesDiv.className = 'episodes';
  const addEpBtn = document.createElement('button');
  addEpBtn.type = 'button';
  addEpBtn.textContent = isMangaMode() ? 'Add Volume' : 'Add Episode';
  addEpBtn.addEventListener('click', () => addEpisode(episodesDiv));

  categoryDiv.appendChild(titleLabel);
  categoryDiv.appendChild(episodesDiv);
  categoryDiv.appendChild(addEpBtn);
  categoriesEl.appendChild(categoryDiv);

  if (data && data.episodes) { data.episodes.forEach(ep => addEpisode(episodesDiv, ep)); }
  updateCategoryButtonVisibility();
}

// Add a new episode block within a category
function addEpisode(container, data) {
  const episodeIndex = container.querySelectorAll('.episode').length + 1;
  const epDiv = document.createElement('div');
  epDiv.className = 'episode';
  try {
    if (data && typeof data.fileSizeBytes === 'number') epDiv.dataset.fileSizeBytes = String(data.fileSizeBytes);
    if (data && typeof data.durationSeconds === 'number') epDiv.dataset.durationSeconds = String(data.durationSeconds);
    if (data && typeof data.VolumePageCount === 'number' && Number.isFinite(data.VolumePageCount)) {
      epDiv.dataset.VolumePageCount = String(data.VolumePageCount);
      epDiv.dataset.volumePageCount = String(data.VolumePageCount);
    }
  } catch {}
  epDiv.addEventListener('contextmenu', (e) => { e.preventDefault(); epDiv.remove(); });

  const epTitle = document.createElement('input');
  epTitle.type = 'text';
  epTitle.placeholder = unitTitlePlaceholder();
  epTitle.value = (data && data.title) ? data.title : labelForUnit(episodeIndex);

  const epSrc = document.createElement('input');
  epSrc.type = 'text';
  epSrc.placeholder = isMangaMode() ? 'CBZ URL or Volume Index URL' : 'MP4 or WebM URL';
  if (data && data.src) epSrc.value = data.src;

  const epFile = document.createElement('input');
  epFile.type = 'file';
  epFile.accept = isMangaMode() ? '.cbz' : '.mp4, .webm';

  const epError = document.createElement('div');
  epError.className = 'ep-error';

  async function computeLocalFileDurationSeconds(file) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = () => { try { URL.revokeObjectURL(url); } catch {} resolve(isFinite(v.duration) ? v.duration : NaN); };
        v.onloadedmetadata = done;
        v.onerror = () => resolve(NaN);
        v.src = url;
      } catch { resolve(NaN); }
    });
  }

  epFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    epError.textContent = '';
    if (isMangaMode()) {
      if (!/\.cbz$/i.test(file.name||'')) { epError.innerHTML = '<span style="color:red">Please select a .cbz file in Manga mode.</span>'; return; }
      try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      try { const ab = await file.arrayBuffer(); const zip = await JSZip.loadAsync(ab); const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n)); epDiv.dataset.VolumePageCount = String(names.length); epDiv.dataset.volumePageCount = String(names.length); } catch {}

      // Auto-set title from filename if it contains Chapter/Volume info
      try {
        const base = (file.name || '').split('/').pop();
        let newTitle = null;
        const mc = base.match(/\bchapter\s*(\d{1,4})\b/i) || base.match(/\bc\s*0?(\d{1,4})\b/i);
        if (mc) newTitle = `Chapter ${parseInt(mc[1], 10)}`;
        else {
          const ms = base.match(/ (0?\d{1,4})\b/);
          if (ms) newTitle = `Chapter ${parseInt(ms[1], 10)}`;
          else {
            const mv = base.match(/(?:\bvol(?:ume)?\s*|\bv\s*)(\d{1,3})/i);
            if (mv) newTitle = `Volume ${parseInt(mv[1], 10)}`;
          }
        }
        if (newTitle) {
          const current = (epTitle.value || '').trim();
          const defaultVol = /^Volume\s+\d+$/i;
          const defaultEp = /^Episode\s+\d+$/i;
          const defaultChap = /^Chapter\s+\d+$/i;
          if (!current || defaultVol.test(current) || defaultEp.test(current) || defaultChap.test(current)) {
            epTitle.value = newTitle;
          }
        }
      } catch {}
      epSrc.value = '';
      epError.innerHTML = '';
      const uploadingMsg = document.createElement('span'); uploadingMsg.style.color = 'blue'; uploadingMsg.textContent = 'Uploading'; epError.appendChild(uploadingMsg);
      const progressBar = document.createElement('progress'); progressBar.max = 100; progressBar.value = 0; progressBar.style.marginLeft = '0.5em'; epError.appendChild(progressBar);

      // Read expansion settings (prefer live UI state if panel is open)
      let expand = false, expandManual = true;
      try {
        const liveToggle = document.getElementById('mmCbzExpandToggle');
        const liveManual = document.getElementById('mmCbzExpandManual');
        if (liveToggle) expand = !!liveToggle.checked;
        if (liveManual) expandManual = !!liveManual.checked;
        if (!liveToggle) {
          const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}');
          expand = !!p.cbzExpand;
          expandManual = (typeof p.cbzExpandManual === 'boolean') ? p.cbzExpandManual : true;
        }
      } catch {}
      // Reflect action in message
      try { uploadingMsg.textContent = (expand && expandManual) ? 'Processing 0%' : 'Uploading 0%'; } catch {}
      if (expand && expandManual) {
        try {
          // Expand CBZ -> upload pages -> build/upload JSON
          const ab = await file.arrayBuffer();
          const zip = await JSZip.loadAsync(ab);
          const names = Object.keys(zip.files)
            .filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const totalSteps = names.length + 1; // +1 for JSON upload
          const pageUrls = [];
          for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const imgBlob = await zip.files[name].async('blob');
            const ext = (() => { const m = name.toLowerCase().match(/\.(jpe?g|png|gif|webp|bmp)$/); return m ? m[0] : '.png'; })();
            const pageFile = new File([imgBlob], `${i + 1}${ext}`, { type: imgBlob.type || 'application/octet-stream' });
            const base = (i / totalSteps) * 100;
            const url = await uploadToCatboxWithProgress(pageFile, pct => { const adj = Math.max(0, Math.min(100, base + pct / totalSteps)); progressBar.value = adj; try { uploadingMsg.textContent = `Processing ${Math.round(adj)}%`; } catch {} }, { context: 'manual' });
            pageUrls.push(url);
          }
          const pagesMap = {};
          for (let i = 0; i < pageUrls.length; i++) pagesMap[`Page ${i + 1}`] = pageUrls[i];
          const volumeJson = { pagecount: pageUrls.length, pages: pagesMap };
          const volBlob = new Blob([JSON.stringify(volumeJson, null, 2)], { type: 'application/json' });
          // Try to extract volume number from title; fallback to 1
          let volNum = 1;
          try { const m = (epTitle.value||'').match(/(\d+)/); if (m) volNum = parseInt(m[1], 10) || 1; } catch {}
          const volFile = new File([volBlob], `${volNum}.json`, { type: 'application/json' });
          const url = await uploadToCatboxWithProgress(volFile, pct => { const base = ((names.length) / totalSteps) * 100; const adj = Math.max(0, Math.min(100, base + pct / totalSteps)); progressBar.value = adj; try { uploadingMsg.textContent = `Processing ${Math.round(adj)}%`; } catch {} }, { context: 'manual' });
          epSrc.value = url;
          try { epDiv.dataset.VolumePageCount = String(pageUrls.length); epDiv.dataset.volumePageCount = String(pageUrls.length); } catch {}
          epError.textContent = '';
        } catch (err) {
          epError.innerHTML = '<span style="color:red">Upload failed</span>';
          epSrc.value = '';
        }
      } else {
        try { const url = await uploadToCatboxWithProgress(file, (percent) => { progressBar.value = percent; try { uploadingMsg.textContent = `Uploading ${Math.round(percent)}%`; } catch {} }, { context: 'manual' }); epSrc.value = url; epError.textContent = ''; }
        catch (err) { epError.innerHTML = '<span style="color:red">Upload failed</span>'; epSrc.value = ''; }
      }
    } else {
    if (isMangaMode()) {
      if (!/\.cbz$/i.test(file.name||'')) { epError.innerHTML = '<span style="color:red">Please select a .cbz file in Manga mode.</span>'; return; }
      try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      try {
        const ab = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(ab);
        const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
        epDiv.dataset.VolumePageCount = String(names.length);
        epDiv.dataset.volumePageCount = String(names.length);
      } catch {}
    } else {
      if (file.size > 200 * 1024 * 1024) { epError.innerHTML = '<span style="color:#f1f1f1">Our built-in uploader only supports 200 MB. Please try again with a smaller size.</span>'; return; }
      try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      try { const d = await computeLocalFileDurationSeconds(file); if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d)); } catch {}
    }
      epSrc.value = '';
      epError.innerHTML = '';
      const uploadingMsg = document.createElement('span'); uploadingMsg.style.color = 'blue'; uploadingMsg.textContent = 'Uploading'; epError.appendChild(uploadingMsg);
      const progressBar = document.createElement('progress'); progressBar.max = 100; progressBar.value = 0; progressBar.style.marginLeft = '0.5em'; epError.appendChild(progressBar);
      try { const url = await uploadToCatboxWithProgress(file, (percent) => { progressBar.value = percent; try { uploadingMsg.textContent = `Uploading ${Math.round(percent)}%`; } catch {} }, { context: 'manual' }); epSrc.value = url; epError.textContent = ''; }
      catch (err) { epError.innerHTML = '<span style="color:red">Upload failed</span>'; epSrc.value = ''; }
    }
  });

  async function fetchRemoteContentLength(url) {
    try {
      const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (head.ok) {
        const cl = head.headers.get('content-length') || head.headers.get('Content-Length');
        const n = cl ? parseInt(cl, 10) : NaN;
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch {}
    try {
      const resp = await fetch(url, { method: 'GET', headers: { 'Range': 'bytes=0-0' }, cache: 'no-store' });
      if (resp.ok || resp.status === 206) {
        const cr = resp.headers.get('content-range') || resp.headers.get('Content-Range');
        if (cr) {
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n >= 0) return n; }
        }
        const cl = resp.headers.get('content-length') || resp.headers.get('Content-Length');
        const n = cl ? parseInt(cl, 10) : NaN;
        if (Number.isFinite(n) && n > 1) return n;
      }
    } catch {}
    return NaN;
  }

  async function computeRemoteDurationSeconds(url) {
    return new Promise((resolve) => {
      try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.crossOrigin = 'anonymous';
        const done = () => { const d = isFinite(v.duration) ? v.duration : NaN; resolve(d); };
        v.onloadedmetadata = done;
        v.onerror = () => resolve(NaN);
        v.src = url;
      } catch { resolve(NaN); }
    });
  }

  async function maybeFetchUrlMetadata() {
    if (epFile && epFile.files && epFile.files.length > 0) return;
    const url = (epSrc.value || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (isMangaMode()) {
      const lower = url.toLowerCase();
      if (/\.json(?:$|[?#])/i.test(lower)) {
        try { epError.style.color = '#9ecbff'; epError.textContent = 'Fetching volume JSON…'; } catch {}
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          const text = await resp.text();
          let json; try { json = JSON.parse(text); } catch { json = null; }
          let count = 0;
          if (json && Array.isArray(json.pages)) count = json.pages.length;
          else if (json && Array.isArray(json.images)) count = json.images.length;
          else if (json && typeof json === 'object') {
            const obj = json.pages && typeof json.pages === 'object' ? json.pages : json;
            try { count = Object.values(obj).filter(Boolean).length; } catch { count = 0; }
          }
          if (Number.isFinite(count) && count > 0) {
            epDiv.dataset.VolumePageCount = String(count);
            epDiv.dataset.volumePageCount = String(count);
          }
        } catch {}
      } else if (/\.cbz(?:$|[?#])/i.test(lower)) {
        try { epError.style.color = '#9ecbff'; epError.textContent = 'Fetching CBZ…'; } catch {}
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          const blob = await resp.blob();
          const zip = await JSZip.loadAsync(blob);
          const pages = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
          epDiv.dataset.VolumePageCount = String(pages.length);
          epDiv.dataset.volumePageCount = String(pages.length);
        } catch {}
      } else {
        return;
      }
      // Attempt to auto-set title from URL filename (Chapter/Volume)
      try {
        const last = (() => { try { const u = new URL(url); return decodeURIComponent((u.pathname||'').split('/').pop()||''); } catch { return (url.split('?')[0]||'').split('/').pop()||''; } })();
        let newTitle = null;
        const mc = last.match(/\bchapter\s*(\d{1,4})\b/i) || last.match(/\bc\s*0?(\d{1,4})\b/i);
        if (mc) newTitle = `Chapter ${parseInt(mc[1], 10)}`;
        else {
          const ms = last.match(/ (0?\d{1,4})\b/);
          if (ms) newTitle = `Chapter ${parseInt(ms[1], 10)}`;
          else {
            const mv = last.match(/(?:\bvol(?:ume)?\s*|\bv\s*)(\d{1,3})/i);
            if (mv) newTitle = `Volume ${parseInt(mv[1], 10)}`;
          }
        }
        if (newTitle) {
          const current = (epTitle.value || '').trim();
          const defaultVol = /^Volume\s+\d+$/i;
          const defaultEp = /^Episode\s+\d+$/i;
          const defaultChap = /^Chapter\s+\d+$/i;
          if (!current || defaultVol.test(current) || defaultEp.test(current) || defaultChap.test(current)) {
            epTitle.value = newTitle;
          }
        }
      } catch {}
      epError.textContent = '';
    } else {
      if (epDiv.dataset && (epDiv.dataset.fileSizeBytes || epDiv.dataset.durationSeconds)) return;
      try { epError.style.color = '#9ecbff'; epError.textContent = 'Fetching metadata…'; } catch {}
      try {
        const [size, dur] = await Promise.all([ fetchRemoteContentLength(url), computeRemoteDurationSeconds(url) ]);
        if (Number.isFinite(size) && size >= 0) epDiv.dataset.fileSizeBytes = String(Math.round(size));
        if (Number.isFinite(dur) && dur > 0) epDiv.dataset.durationSeconds = String(Math.round(dur));
        epError.textContent = '';
      } catch { epError.textContent = ''; }
    }
  }
  epSrc.addEventListener('change', maybeFetchUrlMetadata);
  epSrc.addEventListener('blur', maybeFetchUrlMetadata);

  epDiv.appendChild(epTitle);
  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';
  inputGroup.appendChild(epSrc);
  const orSpan = document.createElement('span'); orSpan.textContent = 'or'; inputGroup.appendChild(orSpan);
  inputGroup.appendChild(epFile);
  epDiv.appendChild(inputGroup);
  epDiv.appendChild(epError);
  container.appendChild(epDiv);
}

async function loadDirectory() {
  const url = loadUrlInput.value.trim();
  if (!url) return;
  try {
    const res = await fetch(url);
    const json = await res.json();
    posterImageUrl = (json.Image && json.Image !== 'N/A') ? json.Image : '';
    if (posterImageUrl) {
      posterPreview.src = posterImageUrl;
      if (posterWrapper) posterWrapper.style.display = 'inline-block';
      if (posterInput) posterInput.style.display = 'none';
    } else {
      posterPreview.src = '';
      if (posterWrapper) posterWrapper.style.display = 'none';
      if (posterInput) posterInput.style.display = 'inline-block';
    }
    if (posterChangeBtn) posterChangeBtn.style.display = posterImageUrl ? 'inline-block' : 'none';
    if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
    document.getElementById('dirTitle').value = json.title || '';
    categoriesEl.innerHTML = '';
    json.categories.forEach(cat => addCategory(cat));
    const contentOnly = { title: json.title || '', Image: posterImageUrl || 'N/A', categories: json.categories || [] };
    try { window.lastContent = JSON.stringify(contentOnly); } catch {}
  } catch (err) {
    outputEl.textContent = 'Failed to load: ' + err.message;
  }
}
const loadBtn = document.getElementById('loadBtn');
loadBtn.addEventListener('click', loadDirectory);

// Button handlers
addCategoryBtn.addEventListener('click', () => addCategory());
// Initialize button state based on mode
updateCategoryButtonVisibility();
window.addEventListener('mm_settings_saved', (e) => {
  const newMode = (e && e.detail && e.detail.libraryMode) ? e.detail.libraryMode : getCreatorMode();
  const changed = newMode !== __currentCreatorMode;
  __currentCreatorMode = newMode;
  updateCategoryButtonVisibility();
  if (changed) {
    // Clear Creator state when mode changes
    try {
      document.getElementById('dirTitle').value = '';
      categoriesEl.innerHTML = '';
      directoryCode = '';
      updateOutput();
      posterImageUrl = '';
      if (posterPreview) { posterPreview.src = ''; }
      if (posterWrapper) posterWrapper.style.display = 'none';
      if (posterInput) { posterInput.value = ''; posterInput.style.display = 'inline-block'; }
      if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
      if (posterChangeBtn) posterChangeBtn.style.display = 'none';
    } catch {}
  }
});

function updateOutput() {
  if (!directoryCode) { outputLink.textContent = ''; outputLink.href = '#'; return; }
  if (isFullUrl) {
    const full = `https://files.catbox.moe/${directoryCode}.json`;
    outputLink.textContent = full; outputLink.href = full;
  } else {
    outputLink.textContent = directoryCode;
    outputLink.href = `https://randomsideprojects.github.io/Media-Manager/index.html?source=${directoryCode}`;
  }
}
const outputContainer = document.getElementById('outputContainer');
outputContainer.addEventListener('contextmenu', (e) => { e.preventDefault(); isFullUrl = !isFullUrl; updateOutput(); });

createTabBtn.addEventListener('click', () => {
  createTabBtn.classList.add('active');
  editTabBtn.classList.remove('active');
  loadUrlContainer.style.display = 'none';
  document.getElementById('dirTitle').value = '';
  categoriesEl.innerHTML = '';
  directoryCode = '';
  updateOutput();
  posterImageUrl = '';
  if (posterPreview) { posterPreview.src = ''; }
  if (posterWrapper) posterWrapper.style.display = 'none';
  if (posterInput) { posterInput.value = ''; posterInput.style.display = 'inline-block'; }
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
});
editTabBtn.addEventListener('click', () => {
  editTabBtn.classList.add('active');
  createTabBtn.classList.remove('active');
  loadUrlContainer.style.display = 'flex';
  document.getElementById('dirTitle').value = '';
  categoriesEl.innerHTML = '';
  directoryCode = '';
  updateOutput();
  posterImageUrl = '';
  if (posterPreview) { posterPreview.src = ''; }
  if (posterWrapper) posterWrapper.style.display = 'none';
  if (posterInput) { posterInput.value = ''; posterInput.style.display = 'inline-block'; }
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
});

homeTabBtn.addEventListener('click', () => { window.location.href = '../index.html'; });

const confirmModal = document.getElementById('confirmModal');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
let pendingRemoval = null;
confirmYes.addEventListener('click', () => {
  if (pendingRemoval && pendingRemoval.type === 'category') { pendingRemoval.elem.remove(); }
  confirmModal.style.display = 'none'; pendingRemoval = null;
  updateCategoryButtonVisibility();
});
confirmNo.addEventListener('click', () => { confirmModal.style.display = 'none'; pendingRemoval = null; });

// Local JSON download on A/Z keypress
function buildLocalDirectoryJSON() {
  const title = document.getElementById('dirTitle').value.trim();
  const categories = [];
  let totalBytes = 0;
  let totalSecs = 0;
  let totalPages = 0;
  document.querySelectorAll('.category').forEach(cat => {
    const catTitle = cat.querySelector('input[type="text"]').value.trim();
    const episodes = [];
    cat.querySelectorAll('.episode').forEach(epDiv => {
      const inputs = epDiv.querySelectorAll('input[type="text"]');
      const t = inputs[0].value.trim();
      const s = inputs[1].value.trim();
      let fs = null, dur = null;
      try { const v = parseFloat(epDiv.dataset.fileSizeBytes); if (Number.isFinite(v) && v >= 0) { fs = Math.round(v); totalBytes += fs; } } catch {}
      if (isMangaMode()) {
        let pages = null; try { const v = parseFloat(epDiv.dataset.volumePageCount || epDiv.dataset.VolumePageCount); if (Number.isFinite(v) && v >= 0) { pages = Math.round(v); totalPages += pages; } } catch {}
        if (t && s) episodes.push({ title: t, src: s, fileSizeBytes: fs, VolumePageCount: pages });
      } else {
        try { const v = parseFloat(epDiv.dataset.durationSeconds); if (Number.isFinite(v) && v >= 0) { dur = Math.round(v); totalSecs += dur; } } catch {}
        if (t && s) episodes.push({ title: t, src: s, fileSizeBytes: fs, durationSeconds: dur });
      }
    });
    if (catTitle) categories.push({ category: catTitle, episodes });
  });
  const imageField = posterImageUrl || 'N/A';
  const base = {
    title,
    Image: imageField,
    categories,
    LatestTime: new Date().toISOString(),
    totalFileSizeBytes: totalBytes || 0
  };
  if (!isMangaMode()) base.totalDurationSeconds = totalSecs || 0; else base.totalPagecount = totalPages || 0;
  return base;
}
document.addEventListener('keydown', (e) => {
  if (['a', 'z'].includes((e.key||'').toLowerCase())) {
    if (['INPUT', 'TEXTAREA'].includes((e.target&&e.target.tagName)||'')) return;
    const result = buildLocalDirectoryJSON();
    const jsonString = JSON.stringify(result, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const baseName = (result.title || 'directory').trim().replace(/ /g, '_');
    a.download = `${baseName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
});
