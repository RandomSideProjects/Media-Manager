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

    // Prompt for season index or create new
    const seasonIndex = categoriesEl.children.length + 1;
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Category Title:';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = `Season ${seasonIndex}`;
    titleInput.value = `Season ${seasonIndex}`;
    titleLabel.appendChild(document.createElement('br'));
    titleLabel.appendChild(titleInput);
    const episodesDiv = document.createElement('div');
    episodesDiv.className = 'episodes';
    categoryDiv.appendChild(titleLabel);
    categoryDiv.appendChild(episodesDiv);
    categoriesEl.appendChild(categoryDiv);

    // Derive episode numbers from filenames like E01, E1, etc.; fallback to order
    const filesInSeason = files
      .map((file, idx) => {
        const name = (file.webkitRelativePath || file.name || '').split('/').pop();
        const m = name.match(/E0?(\d{1,2})/i);
        const epNum = m ? parseInt(m[1], 10) : (idx + 1);
        return { file, epNum };
      })
      .sort((a, b) => a.epNum - b.epNum);

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

    filesInSeason.forEach(({ file, epNum }) => {
      addEpisode(episodesDiv, { title: `Episode ${epNum}`, src: '' });
      const epDiv = episodesDiv.lastElementChild;
      try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      try {
        computeLocalFileDurationSeconds(file).then(d => { if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d)); });
      } catch {}
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
      const label = document.createElement('div');
      label.textContent = `Episode ${epNum}`;
      label.style.flex = '1';
      const status = document.createElement('div');
      status.textContent = 'Queued';
      status.style.minWidth = '110px';
      const progressWrapper = document.createElement('div');
      progressWrapper.style.flex = '2';
      const prog = document.createElement('progress');
      prog.max = 100; prog.value = 0; prog.style.width = '100%';
      progressWrapper.appendChild(prog);
      row.appendChild(label);
      row.appendChild(progressWrapper);
      row.appendChild(status);
      folderUploadList.appendChild(row);

      const fn = async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          status.textContent = (attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`;
          prog.value = 0;
          try {
            const url = await uploadToCatboxWithProgress(file, pct => { prog.value = pct; });
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
  titleInput.placeholder = `Season ${categoryIndex}`;
  if (data && data.category) { titleInput.value = data.category; } else { titleInput.value = `Season ${categoryIndex}`; }
  titleLabel.appendChild(document.createElement('br'));
  titleLabel.appendChild(titleInput);

  const episodesDiv = document.createElement('div');
  episodesDiv.className = 'episodes';
  const addEpBtn = document.createElement('button');
  addEpBtn.type = 'button';
  addEpBtn.textContent = 'Add Episode';
  addEpBtn.addEventListener('click', () => addEpisode(episodesDiv));

  categoryDiv.appendChild(titleLabel);
  categoryDiv.appendChild(episodesDiv);
  categoryDiv.appendChild(addEpBtn);
  categoriesEl.appendChild(categoryDiv);

  if (data && data.episodes) { data.episodes.forEach(ep => addEpisode(episodesDiv, ep)); }
}

// Add a new episode block within a category
function addEpisode(container, data) {
  const episodeIndex = container.querySelectorAll('.episode').length + 1;
  const epDiv = document.createElement('div');
  epDiv.className = 'episode';
  try {
    if (data && typeof data.fileSizeBytes === 'number') epDiv.dataset.fileSizeBytes = String(data.fileSizeBytes);
    if (data && typeof data.durationSeconds === 'number') epDiv.dataset.durationSeconds = String(data.durationSeconds);
  } catch {}
  epDiv.addEventListener('contextmenu', (e) => { e.preventDefault(); epDiv.remove(); });

  const epTitle = document.createElement('input');
  epTitle.type = 'text';
  epTitle.placeholder = 'Episode Title';
  epTitle.value = (data && data.title) ? data.title : `Episode ${episodeIndex}`;

  const epSrc = document.createElement('input');
  epSrc.type = 'text';
  epSrc.placeholder = 'MP4 or WebM URL';
  if (data && data.src) epSrc.value = data.src;

  const epFile = document.createElement('input');
  epFile.type = 'file';
  epFile.accept = '.mp4, .webm';

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
    if (file.size > 200 * 1024 * 1024) { epError.innerHTML = '<span style="color:#f1f1f1">Our built-in uploader only supports 200 MB. Please try again with a smaller size.</span>'; return; }
    try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
    try { const d = await computeLocalFileDurationSeconds(file); if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d)); } catch {}
    epSrc.value = '';
    epError.innerHTML = '';
    const uploadingMsg = document.createElement('span'); uploadingMsg.style.color = 'blue'; uploadingMsg.textContent = 'Uploading'; epError.appendChild(uploadingMsg);
    const progressBar = document.createElement('progress'); progressBar.max = 100; progressBar.value = 0; progressBar.style.marginLeft = '0.5em'; epError.appendChild(progressBar);
    try {
      const url = await uploadToCatboxWithProgress(file, (percent) => { progressBar.value = percent; });
      epSrc.value = url; epError.textContent = '';
    } catch (err) {
      epError.innerHTML = '<span style="color:red">Upload failed</span>'; epSrc.value = '';
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
    if (epDiv.dataset && (epDiv.dataset.fileSizeBytes || epDiv.dataset.durationSeconds)) return;
    try { epError.style.color = '#9ecbff'; epError.textContent = 'Fetching metadata…'; } catch {}
    try {
      const [size, dur] = await Promise.all([ fetchRemoteContentLength(url), computeRemoteDurationSeconds(url) ]);
      if (Number.isFinite(size) && size >= 0) epDiv.dataset.fileSizeBytes = String(Math.round(size));
      if (Number.isFinite(dur) && dur > 0) epDiv.dataset.durationSeconds = String(Math.round(dur));
      epError.textContent = '';
    } catch { epError.textContent = ''; }
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
});
confirmNo.addEventListener('click', () => { confirmModal.style.display = 'none'; pendingRemoval = null; });

// Local JSON download on A/Z keypress
function buildLocalDirectoryJSON() {
  const title = document.getElementById('dirTitle').value.trim();
  const categories = [];
  let totalBytes = 0;
  let totalSecs = 0;
  document.querySelectorAll('.category').forEach(cat => {
    const catTitle = cat.querySelector('input[type="text"]').value.trim();
    const episodes = [];
    cat.querySelectorAll('.episode').forEach(epDiv => {
      const inputs = epDiv.querySelectorAll('input[type="text"]');
      const t = inputs[0].value.trim();
      const s = inputs[1].value.trim();
      let fs = null, dur = null;
      try { const v = parseFloat(epDiv.dataset.fileSizeBytes); if (Number.isFinite(v) && v >= 0) { fs = Math.round(v); totalBytes += fs; } } catch {}
      try { const v = parseFloat(epDiv.dataset.durationSeconds); if (Number.isFinite(v) && v >= 0) { dur = Math.round(v); totalSecs += dur; } } catch {}
      if (t && s) episodes.push({ title: t, src: s, fileSizeBytes: fs, durationSeconds: dur });
    });
    if (catTitle) categories.push({ category: catTitle, episodes });
  });
  const imageField = posterImageUrl || 'N/A';
  return {
    title,
    Image: imageField,
    categories,
    LatestTime: new Date().toISOString(),
    totalFileSizeBytes: totalBytes || 0,
    totalDurationSeconds: totalSecs || 0
  };
}
document.addEventListener('keydown', (e) => {
  if (['a', 'z'].includes((e.key||'').toLowerCase())) {
    if (['INPUT', 'TEXTAREA'].includes((e.target&&e.target.tagName)||'')) return;
    const result = buildLocalDirectoryJSON();
    const jsonString = JSON.stringify(result, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${result.title || 'directory'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
});
