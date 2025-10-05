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
const loadFileInput = document.getElementById('loadFileInput');
const loadFileBtn = document.getElementById('loadFileBtn');
const loadFileName = document.getElementById('loadFileName');
const createTabBtn = document.getElementById('createTabBtn');
const editTabBtn = document.getElementById('editTabBtn');
const loadUrlContainer = document.getElementById('loadUrlContainer');
const homeTabBtn = document.getElementById('homeTabBtn');
const folderInput = document.getElementById('folderInput');
let isFolderUploading = false;
if (typeof window !== 'undefined') {
  window.isFolderUploading = false;
}
let __currentCreatorMode = (function(){ try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; } })();
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

let pendingLoadFile = null;

function truncateFileName(name) {
  if (typeof name !== 'string') return '';
  const maxLength = 32;
  if (name.length <= maxLength) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex > 0 && name.length - extIndex <= 6) {
    const base = name.slice(0, maxLength - (name.length - extIndex) - 3);
    return `${base}...${name.slice(extIndex)}`;
  }
  return `${name.slice(0, maxLength - 3)}...`;
}

function updateLoadFileSummary() {
  if (loadFileBtn) loadFileBtn.textContent = pendingLoadFile ? 'Change File' : 'Select File';
  if (loadFileName) {
    if (pendingLoadFile) {
      loadFileName.textContent = `Selected file: ${truncateFileName(pendingLoadFile.name || '')} (click to clear)`;
      loadFileName.style.cursor = 'pointer';
      loadFileName.title = 'Click to clear the selected file.';
    } else {
      loadFileName.textContent = '';
      loadFileName.style.cursor = 'default';
      loadFileName.removeAttribute('title');
    }
  }
}

function clearPendingLoadFile() {
  pendingLoadFile = null;
  if (loadFileInput) loadFileInput.value = '';
  updateLoadFileSummary();
}

function createDragHandle(kind) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'drag-handle';
  handle.setAttribute('aria-label', `Drag ${kind || 'item'} to reorder`);
  handle.draggable = true;
  const grip = document.createElement('span');
  grip.className = 'drag-grip';
  handle.appendChild(grip);
  return handle;
}

function getDirectChildren(container, selector) {
  return Array.from(container.children).filter(child => child.matches(selector));
}

function getDragAfterElement(container, y, selector, draggedItem) {
  const items = getDirectChildren(container, selector).filter(item => item !== draggedItem);
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of items) {
    const box = child.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) {
      closest = { offset, element: child };
    }
  }
  return closest.element;
}

function makeSortable(container, options) {
  const { itemSelector, handleSelector } = options || {};
  if (!container || container.__mmSortableAttached) return;
  container.__mmSortableAttached = true;
  const state = { draggedItem: null };

  container.addEventListener('dragstart', (event) => {
    if (!itemSelector) return;
    const handle = handleSelector ? event.target.closest(handleSelector) : event.target.closest(itemSelector);
    if (handleSelector && !handle) return;
    const item = event.target.closest(itemSelector);
    if (!item || (handle && handle.closest(itemSelector) !== item)) return;
    state.draggedItem = item;
    item.classList.add('is-dragging');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'drag');
    } catch {}
  });

  container.addEventListener('dragover', (event) => {
    if (!state.draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const afterElement = getDragAfterElement(container, event.clientY, itemSelector, state.draggedItem);
    if (!afterElement) {
      container.appendChild(state.draggedItem);
    } else if (afterElement !== state.draggedItem) {
      container.insertBefore(state.draggedItem, afterElement);
    }
  });

  container.addEventListener('drop', (event) => {
    if (!state.draggedItem) return;
    event.preventDefault();
  });

  container.addEventListener('dragend', () => {
    if (!state.draggedItem) return;
    state.draggedItem.classList.remove('is-dragging');
    state.draggedItem = null;
  });
}

if (categoriesEl) {
  makeSortable(categoriesEl, { itemSelector: '.category', handleSelector: '.category-header .drag-handle' });
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
let githubUploadUrl = '';
let isGithubUploadInFlight = false;
let posterPreviewObjectUrl = '';
const UI_DEFAULT_GITHUB_WORKER_URL = (typeof window !== 'undefined' && typeof window.MM_DEFAULT_GITHUB_WORKER_URL === 'string') ? window.MM_DEFAULT_GITHUB_WORKER_URL : '';
const LEGACY_GITHUB_WORKER_ROOT = 'https://mmback.littlehacker303.workers.dev';
const githubUploadComboKeys = new Set(['g', 'h']);
let githubUploadSequence = [];
const resetGithubUploadSequence = () => { githubUploadSequence = []; };
if (typeof window !== 'undefined') {
  window.addEventListener('rsp:dev-mode-changed', resetGithubUploadSequence);
}

// Helpers
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

function setPosterPreviewSource(src, { isBlob } = {}) {
  if (posterPreview) posterPreview.src = src || '';
  if (isBlob) {
    if (posterPreviewObjectUrl && posterPreviewObjectUrl !== src) {
      try { URL.revokeObjectURL(posterPreviewObjectUrl); } catch {}
    }
    posterPreviewObjectUrl = src || '';
  } else if (posterPreviewObjectUrl) {
    try { URL.revokeObjectURL(posterPreviewObjectUrl); } catch {}
    posterPreviewObjectUrl = '';
  }
}

function clearPosterPreviewUI() {
  setPosterPreviewSource('', { isBlob: false });
  if (posterWrapper) posterWrapper.style.display = 'none';
  if (posterInput) posterInput.style.display = 'inline-block';
}

function getUploadSettingsSafe() {
  try {
    const raw = localStorage.getItem('mm_upload_settings') || '{}';
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function normalizeGithubWorkerUrlValue(raw) {
  const trimmed = (typeof raw === 'string') ? raw.trim() : '';
  if (!trimmed) return '';
  const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSlash === LEGACY_GITHUB_WORKER_ROOT) {
    return `${LEGACY_GITHUB_WORKER_ROOT}/gh`;
  }
  return trimmed;
}

function getGithubWorkerUrl() {
  try {
    const settings = getUploadSettingsSafe();
    const raw = settings.githubWorkerUrl;
    const trimmed = (typeof raw === 'string') ? raw.trim() : '';
    const normalized = normalizeGithubWorkerUrlValue(trimmed);
    if (normalized && normalized !== trimmed) {
      try {
        const next = Object.assign({}, settings, { githubWorkerUrl: normalized });
        localStorage.setItem('mm_upload_settings', JSON.stringify(next));
      } catch {}
    }
    return (normalized || trimmed) || UI_DEFAULT_GITHUB_WORKER_URL;
  } catch { return UI_DEFAULT_GITHUB_WORKER_URL; }
}

function getGithubToken() {
  try {
    const settings = getUploadSettingsSafe();
    const raw = settings.githubToken;
    return (typeof raw === 'string') ? raw.trim() : '';
  } catch { return ''; }
}

function sanitizeWorkerFileName(input) {
  const base = typeof input === 'string' ? input : '';
  const normalized = typeof base.normalize === 'function' ? base.normalize('NFKD') : base;
  const filtered = normalized.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!filtered) return 'Untitled_Directory';
  const words = filtered.split(/\s+/).map((word) => {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).filter(Boolean);
  return words.length ? words.join('_') : 'Untitled_Directory';
}

function isPosterCompressionEnabled() {
  const settings = getUploadSettingsSafe();
  if (typeof settings.compressPosters === 'boolean') return settings.compressPosters;
  if (typeof settings.posterCompress === 'boolean') return settings.posterCompress;
  return true;
}

function makeWebpName(name) {
  const base = (typeof name === 'string' && name.trim()) ? name.trim() : 'poster';
  const withoutExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const clean = withoutExt || 'poster';
  return `${clean}.webp`;
}

function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(.+);base64,(.*)$/);
  if (!match) return null;
  const mime = match[1];
  const binary = atob(match[2]);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
  return new Blob([buffer], { type: mime });
}

async function preparePosterForUpload(file) {
  const compress = isPosterCompressionEnabled();
  if (!compress) {
    const previewUrl = URL.createObjectURL(file);
    return { uploadFile: file, previewUrl, isBlob: true, compressed: false };
  }

  return new Promise((resolve) => {
    let done = false;
    const finalizeWithOriginal = () => {
      if (done) return;
      done = true;
      const previewUrl = URL.createObjectURL(file);
      resolve({ uploadFile: file, previewUrl, isBlob: true, compressed: false });
    };

    try {
      const tempUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try { URL.revokeObjectURL(tempUrl); } catch {}
        try {
          const naturalWidth = img.naturalWidth || img.width || 1;
          const naturalHeight = img.naturalHeight || img.height || 1;
          const aspect = naturalWidth / Math.max(1, naturalHeight);
          const targetHeight = 512;
          const targetWidth = Math.max(1, Math.round(targetHeight * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1)));
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas not supported');
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          const handleBlob = (blob) => {
            if (done) return;
            if (!blob) return finalizeWithOriginal();
            done = true;
            const webpFile = new File([blob], makeWebpName(file.name), { type: 'image/webp', lastModified: file.lastModified });
            const previewUrl = URL.createObjectURL(webpFile);
            resolve({ uploadFile: webpFile, previewUrl, isBlob: true, compressed: true });
          };

          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob(handleBlob, 'image/webp', 0.8);
          } else {
            const dataUrl = canvas.toDataURL('image/webp', 0.8);
            const blob = dataUrlToBlob(dataUrl);
            handleBlob(blob);
          }
        } catch (err) {
          console.warn('[MM] Poster compression failed, using original file.', err);
          finalizeWithOriginal();
        }
      };
      img.onerror = () => {
        try { URL.revokeObjectURL(tempUrl); } catch {}
        finalizeWithOriginal();
      };
      img.src = tempUrl;
    } catch (err) {
      console.warn('[MM] Poster compression setup failed, using original file.', err);
      finalizeWithOriginal();
    }
  });
}

// Poster selection and upload
if (posterInput) {
  posterInput.addEventListener('change', async (e) => {
    const file = (e && e.target && e.target.files && e.target.files[0]) || null;
    if (!file) return;
    if (posterChangeBtn) posterChangeBtn.style.display = 'inline-block';
    if (posterStatus) {
      posterStatus.style.display = 'inline-block';
      posterStatus.style.color = '#9ecbff';
      posterStatus.textContent = isPosterCompressionEnabled() ? 'Preparing poster…' : 'Uploading image…';
    }
    if (posterProgress) posterProgress.value = 0;
    try {
      const prepared = await preparePosterForUpload(file);
      setPosterPreviewSource(prepared.previewUrl, { isBlob: prepared.isBlob });
      if (posterWrapper) posterWrapper.style.display = 'inline-block';
      if (posterInput) posterInput.style.display = 'none';
      if (posterStatus) posterStatus.textContent = 'Uploading image…';
      const url = await uploadToCatboxWithProgress(prepared.uploadFile, pct => { if (posterProgress) posterProgress.value = pct; });
      posterImageUrl = (url || '').trim();
      if (posterStatus) posterStatus.style.display = 'none';
    } catch (err) {
      console.error('[MM] Poster upload failed.', err);
      if (posterStatus) {
        posterStatus.style.display = 'inline-block';
        posterStatus.style.color = '#ff6b6b';
        posterStatus.textContent = 'Failed to upload poster.';
      }
    }
  });
}
if (posterChangeBtn) posterChangeBtn.addEventListener('click', () => {
  try { posterInput.value = ''; } catch {}
  posterImageUrl = '';
  clearPosterPreviewUI();
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
});

// Folder selection and bulk upload
folderInput.addEventListener('change', async (e) => {
  try {
    isFolderUploading = true;
    if (typeof window !== 'undefined') {
      window.isFolderUploading = true;
    }
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
      if (typeof window !== 'undefined') {
        window.isFolderUploading = false;
      }
      if (folderOverlay) folderOverlay.remove();
    }
  } finally {
    isFolderUploading = false;
    if (typeof window !== 'undefined') {
      window.isFolderUploading = false;
    }
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

  const categoryHeader = document.createElement('div');
  categoryHeader.className = 'category-header';
  const categoryHandle = createDragHandle('category');

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

  categoryHeader.appendChild(categoryHandle);
  categoryHeader.appendChild(titleLabel);

  const episodesDiv = document.createElement('div');
  episodesDiv.className = 'episodes';
  const addEpBtn = document.createElement('button');
  addEpBtn.type = 'button';
  addEpBtn.textContent = isMangaMode() ? 'Add Volume' : 'Add Episode';
  addEpBtn.addEventListener('click', () => addEpisode(episodesDiv));

  categoryDiv.appendChild(categoryHeader);
  categoryDiv.appendChild(episodesDiv);
  categoryDiv.appendChild(addEpBtn);
  categoriesEl.appendChild(categoryDiv);

  makeSortable(episodesDiv, { itemSelector: '.episode', handleSelector: '.episode-top-row .drag-handle' });

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

  const episodeTopRow = document.createElement('div');
  episodeTopRow.className = 'episode-top-row';
  const episodeHandle = createDragHandle('episode');
  episodeTopRow.appendChild(episodeHandle);
  episodeTopRow.appendChild(epTitle);

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

  epDiv.appendChild(episodeTopRow);
  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';
  inputGroup.appendChild(epSrc);
  const orSpan = document.createElement('span'); orSpan.textContent = 'or'; inputGroup.appendChild(orSpan);
  inputGroup.appendChild(epFile);
  epDiv.appendChild(inputGroup);
  epDiv.appendChild(epError);
  epDiv._titleInput = epTitle;
  epDiv._srcInput = epSrc;
  epDiv._errorEl = epError;
  epDiv._fetchMeta = maybeFetchUrlMetadata;
  container.appendChild(epDiv);
}

function applyDirectoryJson(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('JSON payload must be an object');
  }
  const categoriesData = Array.isArray(json.categories) ? json.categories : [];
  posterImageUrl = (json.Image && json.Image !== 'N/A') ? json.Image : '';
  if (posterImageUrl) {
    setPosterPreviewSource(posterImageUrl, { isBlob: false });
    if (posterWrapper) posterWrapper.style.display = 'inline-block';
    if (posterInput) posterInput.style.display = 'none';
  } else {
    setPosterPreviewSource('', { isBlob: false });
    if (posterWrapper) posterWrapper.style.display = 'none';
    if (posterInput) posterInput.style.display = 'inline-block';
  }
  if (posterChangeBtn) posterChangeBtn.style.display = posterImageUrl ? 'inline-block' : 'none';
  if (posterStatus) {
    posterStatus.style.display = 'none';
    posterStatus.style.color = '#9ecbff';
    posterStatus.textContent = 'Uploading image…';
  }
  const titleInput = document.getElementById('dirTitle');
  if (titleInput) titleInput.value = json.title || '';
  if (categoriesEl) {
    categoriesEl.innerHTML = '';
    categoriesData.forEach(cat => addCategory(cat));
  }
  githubUploadUrl = '';
  updateOutput();
  const contentOnly = {
    title: json.title || '',
    Image: posterImageUrl || 'N/A',
    categories: categoriesData
  };
  try { window.lastContent = JSON.stringify(contentOnly); } catch {}
  if (outputEl) outputEl.textContent = '';
  clearPendingLoadFile();
}

async function loadDirectory(urlOverride) {
  const url = (typeof urlOverride === 'string' && urlOverride.trim()) ? urlOverride.trim() : (loadUrlInput ? loadUrlInput.value.trim() : '');
  if (!url) {
    if (outputEl) outputEl.textContent = 'Enter a URL or select a file to load.';
    return false;
  }
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res || (!res.ok && res.status !== 0)) {
      const statusText = res ? `${res.status} ${res.statusText || ''}`.trim() : 'Network error';
      throw new Error(statusText);
    }
    let json;
    try {
      json = await res.json();
    } catch (err) {
      throw new Error(`Failed to parse JSON (${err && err.message ? err.message : err})`);
    }
    applyDirectoryJson(json);
    return true;
  } catch (err) {
    if (outputEl) outputEl.textContent = 'Failed to load: ' + err.message;
    return false;
  }
}
const loadBtn = document.getElementById('loadBtn');

async function loadDirectoryFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse JSON (${err && err.message ? err.message : err})`);
    }
    applyDirectoryJson(json);
    if (loadUrlInput) loadUrlInput.value = '';
  } catch (err) {
    if (outputEl) outputEl.textContent = 'Failed to load: ' + err.message;
  }
}

if (loadFileBtn && loadFileInput) {
  loadFileBtn.addEventListener('click', () => {
    loadFileInput.click();
  });
  loadFileInput.addEventListener('change', () => {
    const file = loadFileInput.files && loadFileInput.files[0];
    pendingLoadFile = file || null;
    updateLoadFileSummary();
  });
}

if (loadFileName) {
  loadFileName.addEventListener('click', () => {
    if (!pendingLoadFile) return;
    clearPendingLoadFile();
  });
}

if (loadBtn) {
  loadBtn.addEventListener('click', async () => {
    if (pendingLoadFile) {
      await loadDirectoryFromFile(pendingLoadFile);
    } else {
      await loadDirectory();
    }
  });
}

updateLoadFileSummary();

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
      githubUploadUrl = '';
      updateOutput();
      posterImageUrl = '';
      clearPosterPreviewUI();
      if (posterInput) { posterInput.value = ''; }
      if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
      if (posterChangeBtn) posterChangeBtn.style.display = 'none';
      clearPendingLoadFile();
    } catch {}
  }
});

function updateOutput() {
  if (!directoryCode) {
    if (githubUploadUrl) {
      outputLink.textContent = githubUploadUrl;
      outputLink.href = githubUploadUrl;
    } else {
      outputLink.textContent = '';
      outputLink.href = '#';
    }
    return;
  }
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
  githubUploadUrl = '';
  updateOutput();
  posterImageUrl = '';
  clearPosterPreviewUI();
  if (posterInput) { posterInput.value = ''; }
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
  clearPendingLoadFile();
});
editTabBtn.addEventListener('click', () => {
  editTabBtn.classList.add('active');
  createTabBtn.classList.remove('active');
  loadUrlContainer.style.display = 'flex';
  document.getElementById('dirTitle').value = '';
  categoriesEl.innerHTML = '';
  directoryCode = '';
  githubUploadUrl = '';
  updateOutput();
  posterImageUrl = '';
  clearPosterPreviewUI();
  if (posterInput) { posterInput.value = ''; }
  if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
  if (posterChangeBtn) posterChangeBtn.style.display = 'none';
  clearPendingLoadFile();
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

function normalizeEpisodeTitles() {
  const mangaMode = isMangaMode();
  document.querySelectorAll('.category').forEach(cat => {
    const episodes = cat.querySelectorAll('.episode');
    episodes.forEach((epDiv, idx) => {
      const input = epDiv && epDiv._titleInput ? epDiv._titleInput : null;
      if (!input) return;
      const current = (input.value || '').trim();
      const defaultPattern = mangaMode ? /^Volume\s+\d+$/i : /^Episode\s+\d+$/i;
      const chapterPattern = /^Chapter\s+\d+$/i;
      if (current && !defaultPattern.test(current) && !chapterPattern.test(current)) return;
      const label = mangaMode ? 'Volume' : 'Episode';
      const number = String(idx + 1).padStart(2, '0');
      input.value = `${label} ${number}`;
    });
  });
}

async function refreshAllEpisodeMetadata() {
  const episodes = Array.from(document.querySelectorAll('.episode'));
  const tasks = [];
  const mangaMode = isMangaMode();
  episodes.forEach(epDiv => {
    if (!epDiv || typeof epDiv._fetchMeta !== 'function') return;
    const needsSize = !epDiv.dataset || !epDiv.dataset.fileSizeBytes;
    const needsDuration = !mangaMode && (!epDiv.dataset || !epDiv.dataset.durationSeconds);
    const needsPages = mangaMode && (!epDiv.dataset || (!epDiv.dataset.volumePageCount && !epDiv.dataset.VolumePageCount));
    if (needsSize || needsDuration || needsPages) {
      tasks.push(() => epDiv._fetchMeta());
    }
  });
  if (!tasks.length) {
    alert('No missing metadata detected.');
    return;
  }
  let successCount = 0;
  for (const task of tasks) {
    try {
      await task();
      successCount++;
    } catch (err) {
      console.warn('[Creator] Metadata fetch failed for an item', err);
    }
  }
  alert(`Metadata refreshed for ${successCount} item(s).`);
}

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

async function uploadDirectoryToGithub() {
  if (isGithubUploadInFlight) return;
  if (typeof window !== 'undefined' && window.DevMode !== true) return;
  const workerUrlRaw = getGithubWorkerUrl();
  if (!workerUrlRaw) {
    alert('Set the GitHub Worker URL in Upload Settings before uploading to GitHub.');
    return;
  }
  const githubToken = getGithubToken();
  if (!githubToken) {
    alert('Set the GitHub token in Upload Settings before uploading to GitHub.');
    return;
  }
  let workerUrl;
  try {
    workerUrl = new URL(workerUrlRaw);
  } catch (err) {
    alert('GitHub Worker URL is not a valid URL.');
    return;
  }

  const directoryJson = buildLocalDirectoryJSON();
  const title = directoryJson.title || '';
  const fileName = sanitizeWorkerFileName(title || `directory-${Date.now()}`);
  const jsonString = JSON.stringify(directoryJson, null, 2);
  const formData = new FormData();
  formData.append('ghtoken', githubToken);
  formData.append('path', `Directorys/Files/${isMangaMode() ? 'Manga' : 'Anime'}`);
  formData.append('mode', isMangaMode() ? 'manga' : 'anime');
  formData.append('fileName', fileName);
  if (title) formData.append('title', title);
  const jsonBlob = new Blob([jsonString], { type: 'application/json' });
  formData.append('upload', jsonBlob, `${fileName}.json`);

  isGithubUploadInFlight = true;
  try {
    const response = await fetch(workerUrl.toString(), {
      method: 'POST',
      body: formData
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok !== true) {
      const message = data && data.error ? data.error : `HTTP ${response.status}`;
      const details = data && data.details ? `\n${data.details}` : '';
      alert(`GitHub upload failed: ${message}${details}`);
      return;
    }
    githubUploadUrl = data.pullRequestUrl || data.fileUrl || data.rawUrl || '';
    directoryCode = '';
    isFullUrl = true;
    updateOutput();
    if (data.commitUrl) console.info('[Creator] GitHub upload commit:', data.commitUrl);
    if (data.commitType === 'pull_request' && data.pullRequestUrl) {
      console.info('[Creator] GitHub upload pull request:', data.pullRequestUrl);
      alert(`Pull request created: ${data.pullRequestUrl}`);
    } else {
      alert(`Uploaded to GitHub: ${data.path || 'success'}`);
    }
  } catch (err) {
    console.error('[Creator] GitHub upload error', err);
    alert(`GitHub upload failed: ${err && err.message ? err.message : err}`);
  } finally {
    isGithubUploadInFlight = false;
  }
}
document.addEventListener('keydown', (e) => {
  const key = (e.key || '').toLowerCase();
  const tag = ((e.target && e.target.tagName) || '').toUpperCase();
  const isTyping = ['INPUT', 'TEXTAREA'].includes(tag);

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'n') {
    if (isTyping) return;
    e.preventDefault();
    normalizeEpisodeTitles();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'm') {
    if (isTyping) return;
    e.preventDefault();
    refreshAllEpisodeMetadata();
    return;
  }

  if (!isTyping && typeof window !== 'undefined' && window.DevMode === true) {
    if (githubUploadComboKeys.has(key)) {
      if (githubUploadSequence.length && githubUploadSequence[githubUploadSequence.length - 1] === key) return;
      githubUploadSequence.push(key);
      if (githubUploadSequence.length > githubUploadComboKeys.size) githubUploadSequence.shift();
      const unique = new Set(githubUploadSequence);
      if (unique.size === githubUploadComboKeys.size && githubUploadSequence.length === githubUploadComboKeys.size) {
        e.preventDefault();
        resetGithubUploadSequence();
        void uploadDirectoryToGithub();
      }
      return;
    }
    resetGithubUploadSequence();
  }

  if (['a', 'z'].includes(key)) {
    if (isTyping) return;
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

document.addEventListener('keyup', (e) => {
  const key = (e.key || '').toLowerCase();
  if (githubUploadComboKeys.has(key)) {
    resetGithubUploadSequence();
  }
});

window.addEventListener('blur', resetGithubUploadSequence);
