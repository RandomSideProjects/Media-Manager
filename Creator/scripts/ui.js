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
const maintainerHiddenRow = document.getElementById('maintainerHiddenRow');
const maintainerHiddenToggle = document.getElementById('maintainerHiddenToggle');
let isFolderUploading = false;
let maintainerHidden = false;
const HIDDEN_JSON_KEYS = ['hidden', 'Hidden', 'maintainerHidden'];

function getSiteBasePath() {
  if (typeof window === 'undefined' || !window.location) return '/';
  const path = window.location.pathname || '/';
  const creatorIdx = path.indexOf('/Creator/');
  if (creatorIdx >= 0) return path.slice(0, creatorIdx + 1);
  if (path.endsWith('/')) return path;
  const lastSlash = path.lastIndexOf('/');
  return lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '/';
}

function resolvePosterPreviewUrl(primaryUrl) {
  const raw = (primaryUrl || '').trim();
  if (!raw) return '';
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  const trimmed = raw.replace(/^\.\//, '').replace(/^\/+/, '');
  const normalizedPath = trimmed.startsWith('Sources/') ? trimmed : `Sources/${trimmed}`;
  const basePath = getSiteBasePath();
  const withBase = `${basePath}${normalizedPath}`.replace(/\\/g, '/');
  const cleaned = withBase.startsWith('/') ? withBase : `/${withBase}`;
  return cleaned || '';
}
if (typeof window !== 'undefined') {
  window.isFolderUploading = false;
}

function showCreatorNotice(message, tone = 'info', title = 'Directory Creator') {
  if (!message) return;
  if (typeof window.showStorageNotice === 'function') {
    window.showStorageNotice({
      title,
      message,
      tone,
      autoCloseMs: null
    });
  } else if (typeof window.alert === 'function') {
    window.alert(message);
  }
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
    refreshAllSeparationToggles();
  } catch {}
}

function coerceSeparatedFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
}

function updatePartsVisibilityOnNode(epDiv) {
  if (!epDiv) return;
  try {
    const toggle = epDiv._separatedToggle;
    const container = epDiv._partsContainer;
    const sourceGroup = epDiv._sourceInputGroup;
    if (!toggle || !container) return;
    const showParts = !!toggle.checked;
    container.style.display = showParts ? 'flex' : 'none';
    if (sourceGroup) sourceGroup.style.display = showParts ? 'none' : '';
  } catch {}
}

function updateCategoryAddButton(categoryDiv) {
  if (!categoryDiv) return;
  const addBtn = categoryDiv._addEpisodeButton;
  if (!addBtn) return;
  if (isMangaMode()) {
    addBtn.textContent = 'Add Volume';
    return;
  }
  const isSeparated = categoryDiv.dataset && categoryDiv.dataset.separated === '1';
  addBtn.textContent = isSeparated ? 'Add Part' : 'Add Episode';
}

function updateEpisodeSeparatedUi(epDiv) {
  if (!epDiv) return;
  const wrap = epDiv._separatedToggleWrap;
  const toggle = epDiv._separatedToggle;
  const parts = epDiv._partsContainer;
  const sourceGroup = epDiv._sourceInputGroup;
  const titleInput = epDiv._titleInput;
  if (!wrap || !toggle) return;
  const featureActive = isSeparationFeatureActive();
  const parentCategory = epDiv.closest('.category');
  const categorySeparated = !isMangaMode() && parentCategory && parentCategory.dataset && parentCategory.dataset.separated === '1';
  const forceSeparated = epDiv && epDiv.dataset && epDiv.dataset.forceSeparated === '1';
  const allowEpisodeSeparation = (featureActive || forceSeparated) && !categorySeparated && !isMangaMode();
  let ordinal = 1;
  try {
    const container = epDiv.parentElement;
    if (container) {
      const siblings = Array.from(container.querySelectorAll('.episode'));
      const index = siblings.indexOf(epDiv);
      if (index >= 0) ordinal = index + 1;
    }
  } catch {}
  const defaultLabel = categorySeparated ? `Part ${ordinal}` : labelForUnit(ordinal);
  if (titleInput) {
    titleInput.placeholder = categorySeparated ? 'Part Title' : unitTitlePlaceholder();
    titleInput.dataset.mmDefaultLabel = defaultLabel;
  }
  if (!allowEpisodeSeparation) {
    wrap.style.display = 'none';
    toggle.checked = false;
    toggle.disabled = true;
    if (parts) parts.style.display = 'none';
    if (sourceGroup) sourceGroup.style.display = '';
    epDiv.dataset.separated = '0';
    delete epDiv.dataset.separatedItem;
    delete epDiv.dataset.separatedPartCount;
    if (titleInput && titleInput.dataset.mmEdited !== '1') {
      titleInput.value = defaultLabel;
      titleInput.dataset.mmEdited = '0';
    }
  } else {
    wrap.style.display = '';
    toggle.disabled = false;
    updatePartsVisibilityOnNode(epDiv);
    if (titleInput && titleInput.dataset.mmEdited !== '1') {
      titleInput.value = defaultLabel;
      titleInput.dataset.mmEdited = '0';
    }
  }
}

function buildSeasonEntriesFromFiles(files, { isManga } = {}) {
  const isMangaLibrary = (typeof isManga === 'boolean') ? isManga : isMangaMode();
  const labelHelper = (num) => (isMangaLibrary ? `Volume ${num}` : `Episode ${num}`);
  const episodeFolderPatterns = [
    /[Ss]\d+[Ee]0?(\d{1,4})/,
    /(?:^|\b)e\s*0?(\d{1,4})(?:\b|$)/i,
    /(?:^|\b)ep\s*0?(\d{1,4})(?:\b|$)/i,
    /(?:^|\b)episode\s*0?(\d{1,4})(?:\b|$)/i
  ];
  const partIndexFromName = (baseName) => {
    if (!baseName) return NaN;
    const hashMatch = baseName.match(/#(\d{1,6})/);
    if (hashMatch) return parseInt(hashMatch[1], 10);
    const partMatch = baseName.match(/part[_\-\s]*(\d{1,4})/i);
    if (partMatch) return parseInt(partMatch[1], 10);
    const tailMatch = baseName.match(/(\d+)(?=\D*$)/);
    if (tailMatch) return parseInt(tailMatch[1], 10);
    return NaN;
  };
  const matchEpisodeFolderSegment = (segment) => {
    if (typeof segment !== 'string') return null;
    const trimmed = segment.trim();
    if (!trimmed) return null;
    for (const pattern of episodeFolderPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (Number.isFinite(num)) {
          return { raw: trimmed, number: num };
        }
      }
    }
    return null;
  };

  const rawEntries = files.map((file, idx) => {
    const relPath = file && (file.webkitRelativePath || file.name) || '';
    const segments = relPath.split(/[\\/]/).filter(Boolean);
    const base = segments[segments.length - 1] || (file && file.name) || '';
    let num = idx + 1;
    let label = null;
    if (isMangaLibrary) {
      const mc = base.match(/\bchapter\s*(\d{1,4})\b/i) || base.match(/\bc\s*0?(\d{1,4})\b/i);
      if (mc) {
        num = parseInt(mc[1], 10);
        label = `Chapter ${num}`;
      } else {
        const ms = base.match(/ (0?\d{1,4})\b/);
        if (ms) { num = parseInt(ms[1], 10); label = `Chapter ${num}`; }
        else {
          const mv = base.match(/(?:\bvol(?:ume)?\s*|\bv\s*)(\d{1,3})/i);
          if (mv) { num = parseInt(mv[1], 10); label = `Volume ${num}`; }
        }
      }
    } else {
      const me = base.match(/E0?(\d{1,4})/i);
      if (me) num = parseInt(me[1], 10);
    }
    let folderInfo = null;
    if (!isMangaLibrary && segments.length > 1) {
      const parentSegments = segments.slice(0, -1);
      for (let i = parentSegments.length - 1; i >= 0; i -= 1) {
        const match = matchEpisodeFolderSegment(parentSegments[i]);
        if (match) {
          const normalizedSegments = parentSegments.slice(0, i + 1).map((seg) => (typeof seg === 'string' ? seg.trim() : seg));
          const joinedPath = normalizedSegments.join('/');
          folderInfo = {
            folderName: match.raw,
            folderNumber: match.number,
            folderKey: joinedPath,
            folderKeyLower: joinedPath.toLowerCase()
          };
          break;
        }
      }
    }
    const partIndex = partIndexFromName(base);
    return { file, num, label, base, relPath, segments, folderInfo, partIndex, originalIndex: idx };
  });

  const separatedGroups = new Map();
  const singles = [];

  rawEntries.forEach((entry) => {
    if (!isMangaLibrary && entry.folderInfo) {
      const key = entry.folderInfo.folderKeyLower;
      const existing = separatedGroups.get(key);
      if (!existing) {
        separatedGroups.set(key, {
          key,
          folderName: entry.folderInfo.folderName,
          parts: [entry],
          num: Number.isFinite(entry.folderInfo.folderNumber) ? entry.folderInfo.folderNumber : entry.num,
          label: entry.label || null,
          originalIndex: entry.originalIndex
        });
      } else {
        existing.parts.push(entry);
        existing.originalIndex = Math.min(existing.originalIndex, entry.originalIndex);
        if (!existing.label && entry.label) existing.label = entry.label;
        if (!Number.isFinite(existing.num) && Number.isFinite(entry.folderInfo.folderNumber)) existing.num = entry.folderInfo.folderNumber;
      }
      return;
    }
    singles.push(entry);
  });

  const seasonEntries = [
    ...singles.map((entry) => ({
      type: 'single',
      file: entry.file,
      num: entry.num,
      label: entry.label,
      title: entry.label || labelHelper(entry.num),
      originalIndex: entry.originalIndex
    })),
    ...Array.from(separatedGroups.values()).map((group) => {
      const sortedParts = group.parts.slice().sort((a, b) => {
        const aHas = Number.isFinite(a.partIndex);
        const bHas = Number.isFinite(b.partIndex);
        if (aHas && bHas && a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
        if (aHas) return -1;
        if (bHas) return 1;
        if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;
        return a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' });
      });
      const fallbackNum = Number.isFinite(group.num)
        ? group.num
        : (sortedParts.find((part) => Number.isFinite(part.num))?.num ?? NaN);
      const fallbackTitle = group.label
        || (Number.isFinite(fallbackNum) ? labelHelper(fallbackNum) : null)
        || (group.folderName ? group.folderName : null)
        || 'Episode';
      return {
        type: 'separated',
        num: Number.isFinite(group.num) ? group.num : fallbackNum,
        label: group.label,
        title: fallbackTitle,
        folderName: group.folderName || null,
        key: group.key,
        parts: sortedParts,
        originalIndex: group.originalIndex
      };
    })
  ];

  seasonEntries.sort((a, b) => {
    const aHas = Number.isFinite(a.num);
    const bHas = Number.isFinite(b.num);
    if (aHas && bHas && a.num !== b.num) return a.num - b.num;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return a.originalIndex - b.originalIndex;
  });

  if (!isMangaLibrary && separatedGroups.size > 0) {
    const detectedFolders = Array.from(separatedGroups.values()).map((group) => group.folderName || group.key);
    console.debug('[Creator] Detected separated episode folders', detectedFolders);
  }

  return {
    entries: seasonEntries,
    hasSeparated: !isMangaLibrary && separatedGroups.size > 0
  };
}

function deriveFilesInSeason(files, { isManga } = {}) {
  const isMangaLibrary = (typeof isManga === 'boolean') ? isManga : isMangaMode();
  return files
    .map((file, idx) => {
      const name = (file.webkitRelativePath || file.name || '').split('/').pop();
      let num = idx + 1;
      let label = null;
      if (isMangaLibrary) {
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
        const me = name.match(/E0?(\d{1,4})/i);
        if (me) num = parseInt(me[1], 10);
      }
      return { file, num, label };
    })
    .sort((a, b) => a.num - b.num);
}

if (typeof window !== 'undefined') {
  try {
    window.mmBuildSeasonEntries = (files, options) => buildSeasonEntriesFromFiles(
      Array.isArray(files) ? files : [],
      options && typeof options === 'object' ? options : { isManga: isMangaMode() }
    );
  } catch {}
}

function measureLocalFileDuration(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      const finalize = () => {
        try { URL.revokeObjectURL(url); } catch {}
        resolve(Number.isFinite(video.duration) ? video.duration : NaN);
      };
      video.onloadedmetadata = finalize;
      video.onerror = () => resolve(NaN);
      video.src = url;
    } catch {
      resolve(NaN);
    }
  });
}

// Ensure the Upload Settings close button always hides the panel (safety net if settings.js has not bound yet)
const mmCloseFallbackBtn = document.getElementById('mmCloseUploadSettings');
if (mmCloseFallbackBtn && !mmCloseFallbackBtn.dataset.mmUiBound) {
  mmCloseFallbackBtn.dataset.mmUiBound = '1';
  mmCloseFallbackBtn.addEventListener('click', () => {
    const panel = document.getElementById('mmUploadSettingsPanel');
    if (panel) panel.style.display = 'none';
    refreshAllSeparationToggles();
    const episodes = document.querySelectorAll('.episode');
    episodes.forEach((epDiv) => {
      const toggle = epDiv && epDiv._separatedToggle;
      if (!toggle || !toggle.checked) return;
      try {
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {
        const changeEvent = document.createEvent('Event');
        changeEvent.initEvent('change', true, true);
        toggle.dispatchEvent(changeEvent);
      }
    });
  });
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
const UI_GITHUB_WORKER_ROOT = 'https://mm.littlehacker303.workers.dev/gh';
const UI_DEFAULT_GITHUB_WORKER_URL = (typeof window !== 'undefined' && typeof window.MM_DEFAULT_GITHUB_WORKER_URL === 'string') ? window.MM_DEFAULT_GITHUB_WORKER_URL : UI_GITHUB_WORKER_ROOT;
const LEGACY_GITHUB_WORKER_ROOT = 'https://mmback.littlehacker303.workers.dev/gh';
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
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (withoutTrailingSlash === LEGACY_GITHUB_WORKER_ROOT) {
    return UI_GITHUB_WORKER_ROOT;
  }
  if (withoutTrailingSlash === 'https://mmback.littlehacker303.workers.dev') {
    return UI_GITHUB_WORKER_ROOT;
  }
  if (withoutTrailingSlash === UI_GITHUB_WORKER_ROOT) {
    return UI_GITHUB_WORKER_ROOT;
  }
  return withoutTrailingSlash;
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

function getUploadWebhookOverride() {
  try {
    const settings = getUploadSettingsSafe();
    const raw = settings.webhookUrl;
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

const CREATOR_HIDDEN_CONTROL_KEY = 'mm_creator_hidden_control';
const LEGACY_HIDDEN_CONTROL_KEY = 'mm_creator_hidden_suffix';

function readStoredHiddenControlFlag() {
  try {
    const raw = localStorage.getItem(CREATOR_HIDDEN_CONTROL_KEY);
    if (raw === null) {
      const legacy = localStorage.getItem(LEGACY_HIDDEN_CONTROL_KEY);
      return legacy === '1';
    }
    return raw === '1';
  } catch {
    return false;
  }
}

function isHiddenControlEnabled() {
  return readStoredHiddenControlFlag();
}

function applyHiddenControlVisibility(forceEnabled) {
  const enabled = typeof forceEnabled === 'boolean' ? forceEnabled : isHiddenControlEnabled();
  if (maintainerHiddenRow) maintainerHiddenRow.style.display = enabled ? '' : 'none';
}

function dispatchHiddenControlEvent(enabled) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('creator:hidden-control-updated', { detail: { enabled } }));
  } catch {}
}

function setHiddenControlEnabled(enabled) {
  const desired = enabled === true;
  const prev = isHiddenControlEnabled();
  if (desired === prev) {
    applyHiddenControlVisibility(desired);
    return desired;
  }
  try {
    if (desired) localStorage.setItem(CREATOR_HIDDEN_CONTROL_KEY, '1');
    else localStorage.removeItem(CREATOR_HIDDEN_CONTROL_KEY);
  } catch {}
  applyHiddenControlVisibility(desired);
  dispatchHiddenControlEvent(desired);
  return desired;
}

function setMaintainerHiddenFlag(enabled) {
  maintainerHidden = enabled === true;
  if (typeof window !== 'undefined') {
    try {
      window.mm_creatorHidden = maintainerHidden;
      window.mm_creatorMaintainerHidden = maintainerHidden;
    } catch {}
  }
  if (maintainerHiddenToggle) {
    maintainerHiddenToggle.checked = maintainerHidden;
    maintainerHiddenToggle.setAttribute('aria-checked', maintainerHidden ? 'true' : 'false');
  }
}

if (typeof window !== 'undefined') {
  window.mmHiddenSourceNaming = Object.assign({}, window.mmHiddenSourceNaming, {
    isEnabled: isHiddenControlEnabled,
    setEnabled: setHiddenControlEnabled
  });
}

applyHiddenControlVisibility();

if (maintainerHiddenToggle) {
  maintainerHiddenToggle.addEventListener('change', () => {
    setMaintainerHiddenFlag(!!maintainerHiddenToggle.checked);
  });
}

window.addEventListener('creator:hidden-control-updated', (event) => {
  const explicit = event && event.detail && typeof event.detail.enabled === 'boolean';
  applyHiddenControlVisibility(explicit ? event.detail.enabled : undefined);
});

setMaintainerHiddenFlag(false);

function isPosterCompressionEnabled() {
  const settings = getUploadSettingsSafe();
  if (typeof settings.compressPosters === 'boolean') return settings.compressPosters;
  if (typeof settings.posterCompress === 'boolean') return settings.posterCompress;
  return true;
}

function isSeparationTagEnabled() {
  try {
    const settings = getUploadSettingsSafe();
    return settings && settings.separationTag === true;
  } catch { return false; }
}

function isSeparationFeatureActive() {
  return !isMangaMode() && isSeparationTagEnabled();
}

function updateCategorySeparationToggleVisibility(categoryDiv) {
  if (!categoryDiv) return;
  const wrap = categoryDiv._separationWrap;
  const input = categoryDiv._separationInput;
  const active = isSeparationFeatureActive();
  if (wrap) wrap.style.display = active ? 'flex' : 'none';
  if (input) {
    input.disabled = !active;
    const shouldCheck = categoryDiv.dataset && categoryDiv.dataset.separated === '1';
    if (input.checked !== shouldCheck) input.checked = shouldCheck;
  }
  updateCategoryAddButton(categoryDiv);
}

function refreshAllSeparationToggles() {
  try {
    const nodes = document.querySelectorAll('.category');
    nodes.forEach(node => updateCategorySeparationToggleVisibility(node));
    const episodes = document.querySelectorAll('.episode');
    episodes.forEach(ep => updateEpisodeSeparatedUi(ep));
  } catch {}
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
  if (typeof window !== 'undefined') {
    window.mmLastFolderUploadEvent = Date.now();
  }
  console.debug('[Creator] Folder input change triggered');
  let folderOverlay = null;
  let folderUploadList = null;
  let folderUploadSummary = null;
  try {
    isFolderUploading = true;
    if (typeof window !== 'undefined') {
      window.isFolderUploading = true;
    }
    const files = Array.from((e && e.target && e.target.files) || []);
    folderInput.value = '';
    if (!files.length) {
      console.warn('[Creator] Folder upload aborted – no files provided from input change.');
      return;
    }

    // Prompt for season/collection index or create new
    const seasonIndex = categoriesEl.children.length + 1;
    const defaultTitle = isMangaMode() ? 'Volumes' : `Season ${seasonIndex}`;
    addCategory({ category: defaultTitle });
    const categoryDiv = categoriesEl.lastElementChild;
    if (!categoryDiv) {
      console.error('[Creator] Failed to create category container for folder upload.');
      if (typeof showCreatorNotice === 'function') {
        showCreatorNotice('Could not create a category for the folder upload. Check console for details.', 'error', 'Folder Upload');
      }
      return;
    }
    const titleInput = categoryDiv.querySelector('.category-header input[type="text"]');
    if (titleInput) titleInput.value = defaultTitle;
    const episodesDiv = categoryDiv.querySelector('.episodes');
    if (!episodesDiv) {
      console.error('[Creator] Missing episodes container for folder upload.');
      return;
    }

    const { entries: seasonEntries, hasSeparated } = buildSeasonEntriesFromFiles(files, { isManga: isMangaMode() });
    const normalEntries = deriveFilesInSeason(files, { isManga: isMangaMode() });

    console.debug('[Creator] Folder upload detected', {
      totalFiles: files.length,
      hasSeparated,
      groupedEntries: seasonEntries.length
    });

    // Overlay UI for progress
    folderOverlay = document.getElementById('folderUploadOverlay');
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
    folderUploadList = folderOverlay.querySelector('#folderUploadList');
    folderUploadSummary = folderOverlay.querySelector('#folderUploadSummary');

    const formatBytesCompact = (bytes) => {
      if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIdx = 0;
      while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx += 1;
      }
      const fixed = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
      return `${fixed} ${units[unitIdx]}`;
    };

    function createUploadRowContext(labelText, totalBytes) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.75em';
      row.style.padding = '6px 8px';
      row.style.background = '#222';
      row.style.borderRadius = '6px';
      row.style.fontSize = '0.9em';
      row.style.position = 'relative';
      row.style.transition = 'background 0.25s ease';
      row.tabIndex = 0;

      const labelEl = document.createElement('div');
      labelEl.textContent = labelText;
      labelEl.style.flex = '1';

      const statusEl = document.createElement('div');
      statusEl.textContent = 'Queued';
      statusEl.style.minWidth = '110px';
      statusEl.style.marginLeft = 'auto';
      statusEl.style.textAlign = 'right';

      const tooltip = document.createElement('div');
      tooltip.textContent = 'Total Data: Unknown\nData Left: Unknown\n0% complete';
      tooltip.style.position = 'absolute';
      tooltip.style.top = 'calc(100% + 6px)';
      tooltip.style.left = '0';
      tooltip.style.background = '#111';
      tooltip.style.border = '1px solid #444';
      tooltip.style.borderRadius = '6px';
      tooltip.style.padding = '6px 8px';
      tooltip.style.fontSize = '0.8em';
      tooltip.style.color = '#f1f1f1';
      tooltip.style.boxShadow = '0 6px 14px rgba(0,0,0,0.4)';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.whiteSpace = 'pre-line';
      tooltip.style.display = 'none';
      tooltip.style.zIndex = '5';
      tooltip.style.maxWidth = '280px';

      row.append(labelEl);
      row.append(statusEl);
      row.append(tooltip);
      folderUploadList.appendChild(row);

      const ctx = {
        row,
        statusEl,
        tooltipEl: tooltip,
        totalBytes: (Number.isFinite(totalBytes) && totalBytes >= 0) ? totalBytes : null,
        loadedBytes: 0,
        progress: 0,
        state: 'queued'
      };

      const applyBackground = () => {
        const percent = Math.max(0, Math.min(100, ctx.progress || 0));
        const state = ctx.state || 'active';
        let fillColor = 'rgba(78, 139, 255, 0.45)';
        if (state === 'failed') fillColor = 'rgba(255, 107, 107, 0.45)';
        else if (state === 'complete') fillColor = 'rgba(76, 175, 80, 0.45)';
        else if (state === 'cancelled') fillColor = 'rgba(224, 192, 99, 0.45)';
        else if (state === 'queued') fillColor = 'rgba(140, 140, 140, 0.3)';
        if (percent <= 0) {
          row.style.background = (state === 'failed' || state === 'cancelled') ? fillColor : '#222';
        } else {
          row.style.background = `linear-gradient(90deg, ${fillColor} 0%, ${fillColor} ${percent}%, #222 ${percent}%, #222 100%)`;
        }
      };

      const updateTooltip = () => {
        const total = Number.isFinite(ctx.totalBytes) && ctx.totalBytes >= 0 ? ctx.totalBytes : null;
        const loaded = Number.isFinite(ctx.loadedBytes) && ctx.loadedBytes >= 0 ? ctx.loadedBytes : null;
        const remaining = (total !== null && loaded !== null) ? Math.max(0, total - loaded) : null;
        const pct = Math.max(0, Math.min(100, ctx.progress || 0));
        const pctText = pct >= 100 || pct === 0 ? `${pct.toFixed(0)}% complete` : `${pct.toFixed(1)}% complete`;
        tooltip.textContent = `Total Data: ${total !== null ? formatBytesCompact(total) : 'Unknown'}\n` +
          `Data Left: ${remaining !== null ? formatBytesCompact(remaining) : 'Unknown'}\n${pctText}`;
      };

      ctx.setStatus = (text, { color, title } = {}) => {
        statusEl.textContent = text;
        if (color === null) statusEl.style.color = '';
        else if (typeof color === 'string' && color.length) statusEl.style.color = color;
        else statusEl.style.color = '#6ec1e4';
        statusEl.title = title || '';
        updateTooltip();
      };

      ctx.setProgress = (percent, { state, loadedBytes, totalBytes: overrideTotal } = {}) => {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        ctx.progress = clamped;
        if (typeof overrideTotal === 'number' && overrideTotal >= 0) ctx.totalBytes = overrideTotal;
        if (typeof loadedBytes === 'number' && loadedBytes >= 0) ctx.loadedBytes = loadedBytes;
        else if (Number.isFinite(ctx.totalBytes)) ctx.loadedBytes = (clamped / 100) * ctx.totalBytes;
        if (state) ctx.state = state;
        else if (!ctx.state || ctx.state === 'queued') ctx.state = 'active';
        applyBackground();
        updateTooltip();
      };

      ctx.attachDetailsElement = (detailsEl, { initiallyOpen = false } = {}) => {
        if (!detailsEl || !row.parentNode) return;
        ctx.detailsEl = detailsEl;
        detailsEl.style.display = initiallyOpen ? 'block' : 'none';
        detailsEl.style.margin = '4px 0 8px 1.5em';
        detailsEl.style.padding = '6px 8px';
        detailsEl.style.background = '#181818';
        detailsEl.style.borderRadius = '6px';
        detailsEl.style.fontSize = '0.85em';
        detailsEl.style.lineHeight = '1.4';
        folderUploadList.insertBefore(detailsEl, row.nextSibling);
        const caret = document.createElement('span');
        caret.textContent = initiallyOpen ? '▾' : '▸';
        caret.style.marginRight = '0.35em';
        caret.style.fontSize = '0.85em';
        caret.style.opacity = '0.8';
        caret.dataset.caret = '1';
        labelEl.prepend(caret);
        row.style.cursor = 'pointer';
        const toggle = () => {
          const open = detailsEl.style.display !== 'none';
          const next = !open;
          detailsEl.style.display = next ? 'block' : 'none';
          caret.textContent = next ? '▾' : '▸';
        };
        row.addEventListener('click', (event) => {
          if (event.target && detailsEl.contains(event.target)) return;
          toggle();
        });
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        });
      };

      ctx.setOutline = (style) => {
        row.style.outline = style || '';
      };

      const showTooltip = () => { tooltip.style.display = 'block'; };
      const hideTooltip = () => { tooltip.style.display = 'none'; };
      row.addEventListener('mouseenter', showTooltip);
      row.addEventListener('mouseleave', hideTooltip);
      row.addEventListener('focus', showTooltip);
      row.addEventListener('blur', hideTooltip);

      ctx.setStatus('Queued', { color: '#6ec1e4' });
      ctx.setProgress(0, { state: 'queued' });
      return ctx;
    }

    function createPartDetailRow(labelText) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.5em';
      row.style.padding = '4px 0';
      const labelEl = document.createElement('div');
      labelEl.textContent = labelText;
      labelEl.style.flex = '1';
      labelEl.style.fontSize = '0.85em';
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = 0;
      progress.style.flex = '2';
      const statusEl = document.createElement('div');
      statusEl.textContent = 'Queued';
      statusEl.style.minWidth = '80px';
      statusEl.style.textAlign = 'right';
      statusEl.style.fontSize = '0.8em';
      row.append(labelEl, progress, statusEl);
      return {
        el: row,
        setProgress(value) {
          const pct = Math.max(0, Math.min(100, Number(value) || 0));
          progress.value = pct;
        },
        setStatus(text, color) {
          statusEl.textContent = text;
          statusEl.style.color = color || '#6ec1e4';
        }
      };
    }

    const taskFns = [];
    const maxAttempts = 5;
    let completedCount = 0;

    async function runWithConcurrency(fns, limit) {
      let idx = 0;
      const workers = Array.from({ length: Math.min(limit, fns.length) }, async () => {
        while (idx < fns.length) {
          const current = fns[idx++];
          await current();
        }
      });
      await Promise.all(workers);
    }

    if (!hasSeparated) {
      folderUploadSummary.textContent = `0 / ${normalEntries.length} completed`;

      normalEntries.forEach(({ file, num, label }) => {
        console.debug('[Creator] Normal folder upload item', { label, size: file.size });
        addEpisode(episodesDiv, { title: label || labelForUnit(num), src: '' });
        const epDiv = episodesDiv.lastElementChild;
        if (!epDiv) return;
        try { epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
        if (isMangaMode() && /\.cbz$/i.test(file.name || '')) {
          (async () => {
            try {
              const ab = await file.arrayBuffer();
              const zip = await JSZip.loadAsync(ab);
              const names = Object.keys(zip.files).filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
              epDiv.dataset.VolumePageCount = String(names.length);
              epDiv.dataset.volumePageCount = String(names.length);
            } catch {}
          })();
        } else {
          measureLocalFileDuration(file).then((d) => {
            if (!Number.isNaN(d) && d > 0) {
              epDiv.dataset.durationSeconds = String(Math.round(d));
            }
          }).catch(() => {});
        }

        const inputs = epDiv.querySelectorAll('input[type="text"]');
        const epSrcInput = inputs[1];
        const epError = epDiv.querySelector('.ep-error');
        if (epError) epError.textContent = '';

        const totalBytes = (file && typeof file.size === 'number' && file.size >= 0) ? file.size : null;
        const rowCtx = createUploadRowContext(label || labelForUnit(num), totalBytes);

        const fn = async () => {
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            rowCtx.setStatus((attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`, { color: null });
            rowCtx.setProgress(0, { state: 'active', loadedBytes: 0, totalBytes });
            try {
              const url = await uploadToCatboxWithProgress(
                file,
                (pct) => {
                  const loaded = Number.isFinite(totalBytes) ? (pct / 100) * totalBytes : undefined;
                  rowCtx.setProgress(pct, { loadedBytes: loaded });
                },
                { context: 'batch' }
              );
              epSrcInput.value = url;
              if (epError) epError.textContent = '';
              rowCtx.setStatus('Done', { color: '#6ec1e4' });
              rowCtx.setProgress(100, { state: 'complete', loadedBytes: totalBytes });
              completedCount++;
              folderUploadSummary.textContent = `${completedCount} / ${normalEntries.length} completed`;
              return;
            } catch (err) {
              if (attempt < maxAttempts) {
                const base = 800 * Math.pow(2, attempt - 1);
                const jitter = base * (0.3 + Math.random() * 0.4);
                await sleep(base + jitter);
                continue;
              }
              rowCtx.setStatus('Failed', { color: '#ff4444' });
              rowCtx.setProgress(0, { state: 'failed' });
              if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
              return;
            }
          }
        };
        taskFns.push(fn);
      });

      await runWithConcurrency(taskFns, getUploadConcurrency());
      if (folderOverlay) folderOverlay.remove();
      return;
    }

    const processEntries = seasonEntries.filter((entry) => entry && (entry.type === 'separated' || entry.file));
    if (!processEntries.length) {
      folderUploadSummary.textContent = 'No usable files detected';
      return;
    }
    console.debug('[Creator] Separated folder upload entry count', processEntries.length);
    folderUploadSummary.textContent = `0 / ${processEntries.length} completed`;

    processEntries.forEach((entry, index) => {
      if (!entry) return;
      if (!hasSeparated && entry.type !== 'single') return;
      const title = entry.title || labelForUnit(entry.num);
      const createdEpisode = addEpisode(episodesDiv, { title, src: '' });
      const epDiv = createdEpisode || (episodesDiv ? episodesDiv.lastElementChild : null);
      if (!epDiv) return;
      // Force-enable separation UI for detected separated folder uploads
      try {
        epDiv.dataset.forceSeparated = '1';
        if (typeof updateEpisodeSeparatedUi === 'function') {
          updateEpisodeSeparatedUi(epDiv);
        }
      } catch {}

      let epSrcInput = epDiv._srcInput || null;
      if (!epSrcInput) {
        const inputs = epDiv.querySelectorAll('input[type="text"]');
        if (inputs.length > 1) epSrcInput = inputs[1];
      }
      const epError = epDiv._errorEl || epDiv.querySelector('.ep-error');
      if (epError) {
        epError.textContent = '';
        epError.style.color = '';
      }

      const initialBytes = (entry.file && typeof entry.file.size === 'number' && entry.file.size >= 0)
        ? entry.file.size
        : null;
      const rowCtx = createUploadRowContext(title, initialBytes);

      if (hasSeparated && entry.type === 'separated') {
        const videoParts = entry.parts.filter((part) => {
          const baseName = (typeof part.base === 'string' && part.base)
            ? part.base
            : ((part.file && part.file.name) || '');
          return /\.(mp4|m4v|mov|webm|mkv)$/i.test(baseName);
        });
        console.debug('[Creator] Preparing separated episode', {
          title,
          partCount: videoParts.length,
          folder: entry.folderName || entry.key || null
        });
        if (epDiv._separatedToggle) epDiv._separatedToggle.checked = true;
        try {
          if (epDiv._separatedToggle) {
            // Re-dispatch change so any bindings create parts UI scaffolding
            const evt = (typeof Event === 'function') ? new Event('change', { bubbles: true }) : null;
            if (evt) epDiv._separatedToggle.dispatchEvent(evt);
          }
        } catch {}
        if (typeof epDiv._captureBaseSeparationMeta === 'function') epDiv._captureBaseSeparationMeta();
        if (epDiv._partsList) epDiv._partsList.innerHTML = '';
        if (Array.isArray(epDiv._partRows)) epDiv._partRows.length = 0;
        if (typeof epDiv._updatePartsVisibility === 'function') epDiv._updatePartsVisibility();
        // Ensure parts container is initialized; if creator hasn't bound helpers yet, create a minimal structure
        try {
          if (!epDiv._partsList || typeof epDiv._addPartRow !== 'function') {
            const partsContainer = epDiv.querySelector('.parts') || epDiv.querySelector('[data-role="parts"]');
            if (partsContainer) epDiv._partsList = partsContainer;
            if (typeof epDiv._addPartRow !== 'function' && partsContainer) {
              epDiv._addPartRow = ({ title }) => {
                const row = document.createElement('div');
                row.className = 'part-row';
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Part Source URL';
                row._srcInput = input;
                const titleInput = document.createElement('input');
                titleInput.type = 'text';
                titleInput.value = title || 'Part';
                row._titleInput = titleInput;
                row.appendChild(titleInput);
                row.appendChild(input);
                partsContainer.appendChild(row);
                return row;
              };
            }
          }
        } catch {}
        const totalSize = videoParts.reduce((sum, part) => {
          const size = Number(part.file && part.file.size);
          return sum + (Number.isFinite(size) && size > 0 ? size : 0);
        }, 0);
        if (Number.isFinite(totalSize) && totalSize > 0) {
          try { epDiv.dataset.fileSizeBytes = String(totalSize); } catch {}
        }
        const partRows = [];
        videoParts.forEach((part, idx) => {
          const displayIndex = Number.isFinite(part.partIndex) ? part.partIndex : (idx + 1);
          const partLabel = `Part ${displayIndex}`;
          const partRow = typeof epDiv._addPartRow === 'function'
            ? epDiv._addPartRow({ title: partLabel })
            : null;
          if (partRow && partRow._titleInput) partRow._titleInput.value = partLabel;
          if (partRow) {
            const size = Number(part.file && part.file.size);
            partRows.push({ row: partRow, file: part.file, size: Number.isFinite(size) && size > 0 ? size : 0 });
          }
        });
        if (typeof epDiv._recalcSeparatedTotals === 'function') epDiv._recalcSeparatedTotals();
        if (typeof epDiv._updatePartsVisibility === 'function') epDiv._updatePartsVisibility();
        if (typeof epDiv._syncEpisodeMainSrc === 'function') epDiv._syncEpisodeMainSrc();
        if (Number.isFinite(totalSize) && totalSize > 0) {
          rowCtx.setProgress(0, { totalBytes: totalSize });
        }

        const fn = async () => {
          if (!partRows.length) {
            rowCtx.setStatus('No video parts detected', { color: '#ffb347' });
            rowCtx.setProgress(0, { state: 'failed' });
            return;
          }
          rowCtx.setStatus('Uploading', { color: null });
          let uploadedParts = 0;
          let uploadedBytes = 0;
          for (let i = 0; i < partRows.length; i += 1) {
            const current = partRows[i];
            const partSize = Number.isFinite(current.size) ? current.size : 0;
            try {
              if (typeof epDiv._handlePartFileUpload === 'function') {
                await epDiv._handlePartFileUpload(current.row, current.file, {
                  onProgress: (pct) => {
                    // Aggregate progress only; no per-part UI
                    const normalized = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
                    const overallProgress = ((uploadedParts + normalized) / partRows.length) * 100;
                    const loadedBytes = uploadedBytes + (partSize > 0 ? normalized * partSize : 0);
                    rowCtx.setProgress(overallProgress, { loadedBytes, totalBytes: totalSize });
                  }
                });
              }
            } catch (err) {
              console.error('[Creator] Failed to upload part from folder', err);
            }
            const uploaded = current.row && current.row._srcInput && current.row._srcInput.value.trim();
            if (uploaded) {
              uploadedParts += 1;
              if (partSize > 0) uploadedBytes += partSize;
            }
            rowCtx.setProgress((uploadedParts / partRows.length) * 100, { loadedBytes: uploadedBytes, totalBytes: totalSize });
          }
          if (uploadedParts === partRows.length) {
            rowCtx.setStatus('Done', { color: '#6ec1e4' });
            rowCtx.setProgress(100, { state: 'complete' });
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${processEntries.length} completed`;
          } else {
            rowCtx.setStatus(`Uploaded ${uploadedParts} of ${partRows.length}`, { color: '#ff4444' });
            rowCtx.setProgress((uploadedParts / partRows.length) * 100, { state: 'failed' });
          }
          if (typeof epDiv._recalcSeparatedTotals === 'function') epDiv._recalcSeparatedTotals();
          if (typeof epDiv._syncEpisodeMainSrc === 'function') epDiv._syncEpisodeMainSrc();
        };
        taskFns.push(fn);
        return;
      }

      const fileForUpload = entry.file;
      if (!fileForUpload) {
        rowCtx.setStatus('No file detected', { color: '#ffb347' });
        rowCtx.setProgress(0, { state: 'failed' });
        return;
      }
      if (fileForUpload && fileForUpload.size != null) {
        try { epDiv.dataset.fileSizeBytes = String(fileForUpload.size); } catch {}
        if (!isMangaMode() && typeof epDiv._computeLocalFileDurationSeconds === 'function') {
          epDiv._computeLocalFileDurationSeconds(fileForUpload).then((d) => {
            if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d));
          }).catch(() => {});
        }
      }

      const fileSizeBytes = (fileForUpload && typeof fileForUpload.size === 'number' && fileForUpload.size >= 0)
        ? fileForUpload.size
        : null;
      const fn = async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          rowCtx.setStatus((attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`, { color: null });
          rowCtx.setProgress(0, { state: 'active', totalBytes: fileSizeBytes });
          try {
            if (isMangaMode() && fileForUpload && /\.cbz$/i.test(fileForUpload.name || '')) {
              try {
                const ab = await fileForUpload.arrayBuffer();
                const zip = await JSZip.loadAsync(ab);
                const names = Object.keys(zip.files).filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
                epDiv.dataset.VolumePageCount = String(names.length);
                epDiv.dataset.volumePageCount = String(names.length);
              } catch {}
            }
            const url = await uploadToCatboxWithProgress(
              fileForUpload,
              (pct) => {
                const loaded = Number.isFinite(fileSizeBytes) ? (pct / 100) * fileSizeBytes : undefined;
                rowCtx.setProgress(pct, { loadedBytes: loaded });
              },
              { context: 'batch' }
            );
            if (epSrcInput) epSrcInput.value = url;
            if (epError) epError.textContent = '';
            rowCtx.setStatus('Done', { color: '#6ec1e4' });
            rowCtx.setProgress(100, { state: 'complete', loadedBytes: fileSizeBytes });
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${processEntries.length} completed`;
            return;
          } catch (err) {
            if (attempt < maxAttempts) {
              const base = 800 * Math.pow(2, attempt - 1);
              const jitter = base * (0.3 + Math.random() * 0.4);
              await sleep(base + jitter);
              continue;
            }
            rowCtx.setStatus('Failed', { color: '#ff4444' });
            rowCtx.setProgress(0, { state: 'failed' });
            if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
            return;
          }
        }
      };
      taskFns.push(fn);
    });

    await runWithConcurrency(taskFns, getUploadConcurrency());
  } catch (err) {
    console.error('[Creator] Folder upload failed', err);
    if (folderOverlay) folderOverlay.remove();
    if (typeof showCreatorNotice === 'function') {
      showCreatorNotice('Folder upload failed unexpectedly. Check console for details and try again.', 'error', 'Folder Upload');
    } else if (typeof window.showStorageNotice === 'function') {
      window.showStorageNotice({
        title: 'Folder Upload',
        message: 'Folder upload failed unexpectedly. Check console for details and try again.',
        tone: 'error',
        autoCloseMs: null
      });
    } else if (typeof window.alert === 'function') {
      window.alert('Folder upload failed unexpectedly. Check console for details and try again.');
    }
  } finally {
    isFolderUploading = false;
    if (typeof window !== 'undefined') {
      window.isFolderUploading = false;
    }
    if (folderOverlay && folderOverlay.parentNode) {
      try { folderOverlay.remove(); } catch {}
    }
  }
});

// Add a new category block
function addCategory(data) {
  // Allow multiple categories in Manga mode
  const categoryIndex = categoriesEl.children.length + 1;
  const categoryDiv = document.createElement('div');
  categoryDiv.className = 'category';
  const separatedFromData = (!isMangaMode() && data && Number(data.separated) === 1);
  categoryDiv.dataset.separated = separatedFromData ? '1' : '0';
  categoryDiv.addEventListener('contextmenu', (e) => {
    // Guard against episode right-clicks bubbling up and triggering category removal
    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('.episode')) {
      return;
    }
    e.preventDefault();
    queueRemoval({
      type: 'category',
      elem: categoryDiv,
      onConfirm: () => {
        categoryDiv.remove();
        updateCategoryButtonVisibility();
      }
    });
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

  const separationLabel = document.createElement('label');
  separationLabel.className = 'category-separation-toggle';
  const separationInput = document.createElement('input');
  separationInput.type = 'checkbox';
  separationInput.className = 'category-separation-checkbox';
  separationInput.checked = categoryDiv.dataset.separated === '1';
  const separationText = document.createElement('span');
  separationText.textContent = 'Separated';
  separationLabel.appendChild(separationInput);
  separationLabel.appendChild(separationText);
  categoryHeader.appendChild(separationLabel);
  categoryDiv._separationWrap = separationLabel;
  categoryDiv._separationInput = separationInput;

  separationInput.addEventListener('change', () => {
    categoryDiv.dataset.separated = separationInput.checked ? '1' : '0';
    updateCategoryAddButton(categoryDiv);
    refreshAllSeparationToggles();
  });

  const episodesDiv = document.createElement('div');
  episodesDiv.className = 'episodes';
  const addEpBtn = document.createElement('button');
  addEpBtn.type = 'button';
  categoryDiv._addEpisodeButton = addEpBtn;
  updateCategoryAddButton(categoryDiv);
  addEpBtn.addEventListener('click', () => addEpisode(episodesDiv));

  categoryDiv.appendChild(categoryHeader);
  categoryDiv.appendChild(episodesDiv);
  categoryDiv.appendChild(addEpBtn);
  categoriesEl.appendChild(categoryDiv);
  updateCategorySeparationToggleVisibility(categoryDiv);

  makeSortable(episodesDiv, { itemSelector: '.episode', handleSelector: '.episode-top-row .drag-handle' });

  if (data && data.episodes) { data.episodes.forEach(ep => addEpisode(episodesDiv, ep)); }
  updateCategoryButtonVisibility();
}

// Add a new episode block within a category
function addEpisode(container, data) {
  const episodeIndex = container.querySelectorAll('.episode').length + 1;
  const epDiv = document.createElement('div');
  epDiv.className = 'episode';
  const parentCategory = container.closest('.category');
  const categorySeparated = !isMangaMode() && parentCategory && parentCategory.dataset && parentCategory.dataset.separated === '1';
  let baseSeparationMeta = null;
  try {
    if (data && typeof data.fileSizeBytes === 'number') epDiv.dataset.fileSizeBytes = String(data.fileSizeBytes);
    if (!epDiv.dataset.fileSizeBytes && data && typeof data.ItemfileSizeBytes === 'number') epDiv.dataset.fileSizeBytes = String(data.ItemfileSizeBytes);
    if (data && typeof data.durationSeconds === 'number') epDiv.dataset.durationSeconds = String(data.durationSeconds);
    if (data && typeof data.VolumePageCount === 'number' && Number.isFinite(data.VolumePageCount)) {
      epDiv.dataset.VolumePageCount = String(data.VolumePageCount);
      epDiv.dataset.volumePageCount = String(data.VolumePageCount);
    }
  } catch {}
  epDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation(); // Allow episode deletions without triggering category-level prompts
    queueRemoval({
      type: 'episode',
      elem: epDiv,
      onConfirm: () => {
        epDiv.remove();
        normalizeEpisodeTitles();
      }
    });
  });

  const epTitle = document.createElement('input');
  epTitle.type = 'text';
  epTitle.placeholder = categorySeparated ? 'Part Title' : unitTitlePlaceholder();
  const defaultTitle = categorySeparated ? `Part ${episodeIndex}` : labelForUnit(episodeIndex);
  epTitle.value = (data && data.title) ? data.title : defaultTitle;
  epTitle.dataset.mmDefaultLabel = defaultTitle;
  epTitle.dataset.mmEdited = (data && data.title) ? '1' : '0';
  epTitle.addEventListener('input', () => { epTitle.dataset.mmEdited = '1'; });

  const epSrc = document.createElement('input');
  epSrc.type = 'text';
  epSrc.placeholder = isMangaMode() ? 'CBZ URL or Volume Index URL' : 'MP4 or WebM URL';
  if (data && data.src) epSrc.value = data.src;

  const epFile = document.createElement('input');
  epFile.type = 'file';
  epFile.accept = isMangaMode() ? '.cbz' : '.mp4, .webm';

  const epError = document.createElement('div');
  epError.className = 'ep-error';

  const separatedRow = document.createElement('div');
  separatedRow.className = 'episode-separated-row';
  const separatedLabel = document.createElement('label');
  separatedLabel.className = 'episode-separated-toggle';
  const separatedToggle = document.createElement('input');
  separatedToggle.type = 'checkbox';
  separatedToggle.className = 'episode-separated-checkbox';
  const separatedText = document.createElement('span');
  separatedText.textContent = 'Separated parts';
  separatedLabel.append(separatedToggle, separatedText);
  separatedRow.appendChild(separatedLabel);

  const partsContainer = document.createElement('div');
  partsContainer.className = 'episode-parts-container';
  partsContainer.style.display = 'none';

  const partsList = document.createElement('div');
  partsList.className = 'episode-parts-list';

  const partsActions = document.createElement('div');
  partsActions.className = 'episode-parts-actions';

  const uploadPartsFolderBtn = document.createElement('button');
  uploadPartsFolderBtn.type = 'button';
  uploadPartsFolderBtn.className = 'episode-upload-parts-folder';
  uploadPartsFolderBtn.textContent = 'Upload Parts Folder';

  const addPartBtn = document.createElement('button');
  addPartBtn.type = 'button';
  addPartBtn.className = 'episode-add-part';
  addPartBtn.textContent = 'Add Part';

  partsActions.append(uploadPartsFolderBtn, addPartBtn);
  partsContainer.append(partsList, partsActions);

  const partsFolderInput = document.createElement('input');
  partsFolderInput.type = 'file';
  partsFolderInput.multiple = true;
  partsFolderInput.style.display = 'none';
  try { partsFolderInput.webkitdirectory = true; } catch {}
  try {
    partsFolderInput.setAttribute('webkitdirectory', '');
    partsFolderInput.setAttribute('directory', '');
    partsFolderInput.setAttribute('mozdirectory', '');
  } catch {}
  epDiv.appendChild(partsFolderInput);

  epDiv._separatedToggle = separatedToggle;
  epDiv._separatedToggleWrap = separatedRow;
  epDiv._partsContainer = partsContainer;
  epDiv._partsList = partsList;
  epDiv._partRows = [];

  makeSortable(partsList, { itemSelector: '.episode-part', handleSelector: '.episode-part-top-row .drag-handle' });

  function syncPartRowsFromDom() {
    if (!partsList || !Array.isArray(epDiv._partRows)) return;
    const rows = Array.from(partsList.querySelectorAll('.episode-part'));
    epDiv._partRows.length = 0;
    epDiv._partRows.push(...rows);
  }

  partsList.addEventListener('dragend', () => {
    syncPartRowsFromDom();
    recalcEpisodeSeparatedTotals();
    syncEpisodeMainSrc();
  });

  const episodeTopRow = document.createElement('div');
  episodeTopRow.className = 'episode-top-row';
  const episodeHandle = createDragHandle('episode');
  episodeTopRow.appendChild(episodeHandle);
  episodeTopRow.appendChild(epTitle);

  function captureBaseSeparationMeta() {
    if (baseSeparationMeta) return;
    baseSeparationMeta = {
      fileSize: epDiv.dataset.fileSizeBytes || '',
      duration: epDiv.dataset.durationSeconds || ''
    };
  }

  function applyPartMetadata(row, meta) {
    if (!row || !meta) return;
    if (Object.prototype.hasOwnProperty.call(meta, 'fileSize')) {
      const size = Number(meta.fileSize);
      if (Number.isFinite(size) && size >= 0) row.dataset.fileSizeBytes = String(Math.round(size));
      else delete row.dataset.fileSizeBytes;
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'duration')) {
      const duration = Number(meta.duration);
      if (Number.isFinite(duration) && duration >= 0) row.dataset.durationSeconds = String(Math.round(duration));
      else delete row.dataset.durationSeconds;
    }
  }

  function syncEpisodeMainSrc() {
    if (!separatedToggle.checked) return;
    if (!epSrc) return;
    if (epSrc.dataset.manualEntry === '1') return;
    const firstRow = (epDiv._partRows || []).find(row => row && row._srcInput && row._srcInput.value.trim());
    if (!firstRow) return;
    const newSrc = firstRow._srcInput.value.trim();
    if (!newSrc) return;
    epSrc.value = newSrc;
    epSrc.dataset.autoValue = newSrc;
    epSrc.dataset.manualEntry = '0';
  }

  function recalcEpisodeSeparatedTotals() {
    const enabled = separatedToggle.checked && Array.isArray(epDiv._partRows) && epDiv._partRows.length > 0;
    if (enabled) {
      captureBaseSeparationMeta();
      let totalSize = 0;
      let totalDuration = 0;
      let sizeCount = 0;
      let durationCount = 0;
      epDiv._partRows.forEach((row) => {
        const size = Number(row && row.dataset && row.dataset.fileSizeBytes);
        if (Number.isFinite(size) && size >= 0) { totalSize += size; sizeCount += 1; }
        const duration = Number(row && row.dataset && row.dataset.durationSeconds);
        if (Number.isFinite(duration) && duration >= 0) { totalDuration += duration; durationCount += 1; }
      });
      epDiv.dataset.separated = '1';
      epDiv.dataset.separatedItem = '1';
      epDiv.dataset.separatedPartCount = String(epDiv._partRows.length);
      if (sizeCount > 0) epDiv.dataset.fileSizeBytes = String(Math.round(totalSize));
      else delete epDiv.dataset.fileSizeBytes;
      if (durationCount > 0) epDiv.dataset.durationSeconds = String(Math.round(totalDuration));
      else delete epDiv.dataset.durationSeconds;
    } else {
      epDiv.dataset.separated = separatedToggle.checked ? '1' : '0';
      delete epDiv.dataset.separatedItem;
      delete epDiv.dataset.separatedPartCount;
      if (baseSeparationMeta) {
        if (baseSeparationMeta.fileSize) epDiv.dataset.fileSizeBytes = baseSeparationMeta.fileSize;
        else delete epDiv.dataset.fileSizeBytes;
        if (baseSeparationMeta.duration) epDiv.dataset.durationSeconds = baseSeparationMeta.duration;
        else delete epDiv.dataset.durationSeconds;
      }
    }
  }

  async function handlePartsFolderSelection(event) {
    const incoming = Array.from((event && event.target && event.target.files) || []);
    try { partsFolderInput.value = ''; } catch {}
    if (!incoming.length) return;

    const recognized = incoming.filter(file => /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name || ''));
    if (!recognized.length) {
      if (epError) epError.innerHTML = '<span style="color:red">No video files detected in that folder.</span>';
      return;
    }

    const entries = recognized.map(file => {
      const rel = file.webkitRelativePath || file.name || '';
      const base = rel.split(/[\\/]/).pop() || file.name || '';
      let index = NaN;
      const hashMatch = base.match(/#(\d{1,6})/);
      if (hashMatch) {
        index = parseInt(hashMatch[1], 10);
      } else {
        const tailMatch = base.match(/(\d+)(?=\D*$)/);
        if (tailMatch) index = parseInt(tailMatch[1], 10);
      }
      return { file, base, index, key: base.toLowerCase() };
    });

    entries.sort((a, b) => {
      const aHas = Number.isFinite(a.index);
      const bHas = Number.isFinite(b.index);
      if (aHas && bHas) return a.index - b.index;
      if (aHas) return -1;
      if (bHas) return 1;
      return a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' });
    });

    uploadPartsFolderBtn.disabled = true;
    epDiv.dataset.uploadingParts = '1';

    if (!separatedToggle.checked) {
      separatedToggle.checked = true;
      updatePartsVisibility();
    }
    captureBaseSeparationMeta();

    if (partsList) partsList.innerHTML = '';
    if (Array.isArray(epDiv._partRows)) {
      epDiv._partRows.forEach(row => { try { row.remove(); } catch {} });
    }
    epDiv._partRows = [];

    const total = entries.length;
    let completed = 0;
    if (epError) {
      epError.style.color = '';
      epError.textContent = `Uploading parts… 0 / ${total}`;
    }

    const createdRows = [];
    try {
      for (let i = 0; i < entries.length; i++) {
        const { file, base } = entries[i];
        const rawIndex = entries[i].index;
        const titleNum = Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : (i + 1);
        const partRow = addPartRow({ title: `Part ${titleNum}` });
        if (!partRow) continue;
        if (partRow._titleInput) {
          partRow._titleInput.value = `Part ${titleNum}`;
        }
        try {
          await handlePartFileUpload(partRow, file);
          completed += 1;
          if (epError) epError.textContent = `Uploading parts… ${completed} / ${total}`;
        } catch (err) {
          console.error('[Creator] Failed to upload part from folder', err);
        }
        createdRows.push(partRow);
      }
      createdRows.forEach(row => { try { partsList.appendChild(row); } catch {} });
      syncPartRowsFromDom();
    } finally {
      syncPartRowsFromDom();
      recalcEpisodeSeparatedTotals();
      syncEpisodeMainSrc();
      if (epError) {
        if (completed === total) epError.textContent = '';
        else epError.textContent = `Uploaded ${completed} of ${total} parts.`;
      }
      uploadPartsFolderBtn.disabled = false;
      delete epDiv.dataset.uploadingParts;
    }
  }

  function updatePartsVisibility() {
    updatePartsVisibilityOnNode(epDiv);
  }

  async function maybeFetchPartMetadata(row) {
    if (!row || !row._srcInput) return;
    const fileInput = row._fileInput;
    if (fileInput && fileInput.files && fileInput.files.length > 0) return;
    const url = (row._srcInput.value || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (row._statusEl) { row._statusEl.style.color = '#9ecbff'; row._statusEl.textContent = 'Fetching metadata…'; }
    try {
      const [size, duration] = await Promise.all([
        fetchRemoteContentLength(url),
        computeRemoteDurationSeconds(url)
      ]);
      if (Number.isFinite(size) && size >= 0) applyPartMetadata(row, { fileSize: size });
      if (Number.isFinite(duration) && duration > 0) applyPartMetadata(row, { duration });
      if (row._statusEl) row._statusEl.textContent = '';
    } catch {
      if (row._statusEl) row._statusEl.textContent = '';
    }
    recalcEpisodeSeparatedTotals();
    syncEpisodeMainSrc();
  }

  async function handlePartFileUpload(row, file, options = {}) {
    if (!row || !file) return;
    const opts = (options && typeof options === 'object') ? options : {};
    if (!isMangaMode() && file.size > 200 * 1024 * 1024) {
      if (row._statusEl) {
        row._statusEl.style.color = '#ff6b6b';
        row._statusEl.textContent = 'Files over 200 MB must be uploaded manually.';
      }
      if (row._fileInput) row._fileInput.value = '';
      if (opts.onError) {
        opts.onError(new Error('File too large for automated upload'));
      }
      return;
    }
    if (row._statusEl) {
      row._statusEl.style.color = '#9ecbff';
      row._statusEl.textContent = 'Uploading';
    }
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = 0;
    progress.style.marginLeft = '0.5em';
    if (row._statusEl) row._statusEl.replaceChildren(row._statusEl.textContent || 'Uploading', progress);
    let durationEstimate = NaN;
    if (!isMangaMode()) {
      try {
        const d = await computeLocalFileDurationSeconds(file);
        if (!Number.isNaN(d) && d > 0) durationEstimate = d;
      } catch {}
    }
    try {
      const url = await uploadToCatboxWithProgress(file, pct => {
        progress.value = pct;
        if (row._statusEl) {
          row._statusEl.style.color = '#9ecbff';
          row._statusEl.textContent = `Uploading ${Math.round(pct)}%`;
          row._statusEl.appendChild(progress);
        }
        if (typeof opts.onProgress === 'function') {
          opts.onProgress(pct);
        }
      }, { context: 'manual' });
      if (row._srcInput) row._srcInput.value = url;
      applyPartMetadata(row, { fileSize: file.size });
      if (Number.isFinite(durationEstimate) && durationEstimate > 0) {
        applyPartMetadata(row, { duration: durationEstimate });
      }
      if (row._statusEl) row._statusEl.textContent = '';
      syncEpisodeMainSrc();
      if (typeof opts.onComplete === 'function') {
        opts.onComplete({ url });
      }
    } catch (err) {
      if (row._statusEl) {
        row._statusEl.style.color = '#ff6b6b';
        row._statusEl.textContent = 'Upload failed';
      }
      if (row._srcInput) row._srcInput.value = '';
      if (typeof opts.onError === 'function') {
        opts.onError(err);
      }
    }
  }

  function addPartRow(partData) {
    const partIndex = (epDiv._partRows || []).length + 1;
    const row = document.createElement('div');
    row.className = 'episode-part';
    row.setAttribute('draggable', 'true');

    const topRow = document.createElement('div');
    topRow.className = 'episode-part-top-row';
    const partHandle = createDragHandle('part');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = `Part ${partIndex}`;
    titleInput.value = partData && typeof partData.title === 'string' ? partData.title : `Part ${partIndex}`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'episode-part-remove';
    removeBtn.textContent = 'Remove';

    const confirmPartRemoval = () => {
      const idx = epDiv._partRows.indexOf(row);
      if (idx >= 0) epDiv._partRows.splice(idx, 1);
      try { row.remove(); } catch {}
      syncPartRowsFromDom();
      recalcEpisodeSeparatedTotals();
      syncEpisodeMainSrc();
    };

    removeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      queueRemoval({ type: 'part', elem: row, onConfirm: confirmPartRemoval });
    });

    topRow.append(partHandle, titleInput, removeBtn);

    const partInputGroup = document.createElement('div');
    partInputGroup.className = 'input-group';
    const srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.placeholder = 'Part URL';
    const orSpan = document.createElement('span');
    orSpan.textContent = 'or';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.mp4,.webm,.mkv,.mov';
    partInputGroup.append(srcInput, orSpan, fileInput);

    const statusEl = document.createElement('div');
    statusEl.className = 'ep-error episode-part-status';

    row.append(topRow, partInputGroup, statusEl);

    row._titleInput = titleInput;
    row._srcInput = srcInput;
    row._fileInput = fileInput;
    row._statusEl = statusEl;

    srcInput.addEventListener('change', () => { syncEpisodeMainSrc(); maybeFetchPartMetadata(row); });
    srcInput.addEventListener('blur', () => { syncEpisodeMainSrc(); maybeFetchPartMetadata(row); });
    srcInput.addEventListener('input', () => { if (statusEl) statusEl.textContent = ''; });
    titleInput.addEventListener('input', () => { /* noop but retained for symmetry */ });

    fileInput.addEventListener('change', async (event) => {
      const file = event && event.target && event.target.files ? event.target.files[0] : null;
      if (!file) return;
      await handlePartFileUpload(row, file);
    });

    if (partData) {
      if (typeof partData.title === 'string') titleInput.value = partData.title;
      if (typeof partData.src === 'string') srcInput.value = partData.src;
      const sizeCandidate = partData.fileSizeBytes ?? partData.partfileSizeBytes ?? partData.ItemfileSizeBytes ?? partData.itemFileSizeBytes;
      if (Number.isFinite(Number(sizeCandidate))) applyPartMetadata(row, { fileSize: Number(sizeCandidate) });
      const durationCandidate = partData.durationSeconds ?? partData.partDurationSeconds ?? partData.DurationSeconds;
      if (Number.isFinite(Number(durationCandidate))) applyPartMetadata(row, { duration: Number(durationCandidate) });
      if (!srcInput.value && partData.sources && Array.isArray(partData.sources) && partData.sources[0] && partData.sources[0].src) {
        srcInput.value = String(partData.sources[0].src);
      }
    }

    partsList.appendChild(row);
    if (!Array.isArray(epDiv._partRows)) epDiv._partRows = [];
    epDiv._partRows.push(row);
    syncPartRowsFromDom();
    recalcEpisodeSeparatedTotals();
    syncEpisodeMainSrc();
    return row;
  }

  separatedToggle.addEventListener('change', () => {
    if (separatedToggle.checked) {
      captureBaseSeparationMeta();
      updatePartsVisibility();
      if (!(epDiv._partRows || []).length) addPartRow();
    } else {
      updatePartsVisibility();
    }
    recalcEpisodeSeparatedTotals();
    syncEpisodeMainSrc();
  });

  uploadPartsFolderBtn.addEventListener('click', () => {
    if (uploadPartsFolderBtn.disabled) return;
    try { partsFolderInput.value = ''; } catch {}
    partsFolderInput.click();
  });

  partsFolderInput.addEventListener('change', handlePartsFolderSelection);

  addPartBtn.addEventListener('click', () => {
    if (!separatedToggle.checked) {
      separatedToggle.checked = true;
      captureBaseSeparationMeta();
      updatePartsVisibility();
    }
    const newRow = addPartRow();
    if (newRow && newRow._titleInput) {
      try { newRow._titleInput.focus(); } catch {}
    }
  });

  updatePartsVisibility();

  async function computeLocalFileDurationSeconds(file) {
    return measureLocalFileDuration(file);
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
    if (separatedToggle.checked) {
      recalcEpisodeSeparatedTotals();
      syncEpisodeMainSrc();
    }
  }
  epSrc.addEventListener('input', () => { epSrc.dataset.manualEntry = '1'; });
  epSrc.addEventListener('change', maybeFetchUrlMetadata);
  epSrc.addEventListener('blur', maybeFetchUrlMetadata);

  epDiv.appendChild(episodeTopRow);
  const inputGroup = document.createElement('div');
  inputGroup.className = 'input-group';
  inputGroup.appendChild(epSrc);
  const orSpan = document.createElement('span'); orSpan.textContent = 'or'; inputGroup.appendChild(orSpan);
  inputGroup.appendChild(epFile);
  epDiv.appendChild(inputGroup);
  epDiv._sourceInputGroup = inputGroup;
  updatePartsVisibility();
  epDiv.appendChild(epError);
  epDiv.appendChild(separatedRow);
  epDiv.appendChild(partsContainer);

  if (!isMangaMode()) {
    const allowEpisodeSeparation = !categorySeparated;
    const hasSeparatedData = allowEpisodeSeparation && data && coerceSeparatedFlag(data.separated ?? data.seperated);
    const partsData = [];
    if (hasSeparatedData) {
      if (Array.isArray(data.sources)) partsData.push(...data.sources);
      else if (Array.isArray(data.parts)) partsData.push(...data.parts);
      else if (Array.isArray(data.items)) partsData.push(...data.items);
      else if (Array.isArray(data.__separatedParts)) partsData.push(...data.__separatedParts);
    }
    if (hasSeparatedData && partsData.length) {
      separatedToggle.checked = true;
      updatePartsVisibility();
      captureBaseSeparationMeta();
      partsData.forEach(part => addPartRow(part));
      recalcEpisodeSeparatedTotals();
      syncEpisodeMainSrc();
    } else if (hasSeparatedData && !partsData.length) {
      separatedToggle.checked = true;
      updatePartsVisibility();
      captureBaseSeparationMeta();
      recalcEpisodeSeparatedTotals();
      syncEpisodeMainSrc();
    }
  }

  epDiv._titleInput = epTitle;
  epDiv._srcInput = epSrc;
  epDiv._errorEl = epError;
  epDiv._fetchMeta = maybeFetchUrlMetadata;
  epDiv._addPartRow = addPartRow;
  epDiv._handlePartFileUpload = handlePartFileUpload;
  epDiv._recalcSeparatedTotals = recalcEpisodeSeparatedTotals;
  epDiv._syncEpisodeMainSrc = syncEpisodeMainSrc;
  epDiv._captureBaseSeparationMeta = captureBaseSeparationMeta;
  epDiv._updatePartsVisibility = updatePartsVisibility;
  epDiv._computeLocalFileDurationSeconds = computeLocalFileDurationSeconds;
  container.appendChild(epDiv);
  updateEpisodeSeparatedUi(epDiv);
  return epDiv;
}

function extractEpisodeDataFromElement(epDiv, { isManga } = {}) {
  if (!epDiv) return null;
  const titleInput = epDiv._titleInput;
  const srcInput = epDiv._srcInput;
  const title = titleInput ? titleInput.value.trim() : '';
  const rawSrc = srcInput ? srcInput.value.trim() : '';
  const isMangaModeLocal = !!isManga;
  const separatedToggle = epDiv._separatedToggle;
  const partRows = Array.isArray(epDiv._partRows) ? epDiv._partRows : [];
  const separatedEnabled = !isMangaModeLocal && separatedToggle && separatedToggle.checked && partRows.length > 0;

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  let totalFileSize = toNumber(epDiv.dataset ? epDiv.dataset.fileSizeBytes : 0);
  let totalDuration = toNumber(epDiv.dataset ? epDiv.dataset.durationSeconds : 0);
  let totalPages = toNumber(epDiv.dataset ? (epDiv.dataset.volumePageCount || epDiv.dataset.VolumePageCount) : 0);

  const episode = { title, src: rawSrc };

  if (isMangaModeLocal) {
    if (totalFileSize > 0) episode.fileSizeBytes = Math.round(totalFileSize);
    if (totalPages > 0) episode.VolumePageCount = Math.round(totalPages);
    if (!episode.title || !episode.src) return null;
    return {
      episode,
      totalFileSize: totalFileSize > 0 ? Math.round(totalFileSize) : 0,
      totalDuration: 0,
      totalPages: totalPages > 0 ? Math.round(totalPages) : 0
    };
  }

  let separatedParts = [];
  if (separatedEnabled) {
    let partsTotalSize = 0;
    let partsTotalDuration = 0;
    let partSizeCount = 0;
    let partDurationCount = 0;
    separatedParts = partRows.map((row, idx) => {
      if (!row || !row._srcInput) return null;
      const partSrc = row._srcInput.value.trim();
      if (!partSrc) return null;
      const partTitleInput = row._titleInput;
      const partTitle = partTitleInput ? partTitleInput.value.trim() : `Part ${idx + 1}`;
      const partSize = toNumber(row.dataset ? row.dataset.fileSizeBytes : 0);
      const partDuration = toNumber(row.dataset ? row.dataset.durationSeconds : 0);
      if (partSize > 0) { partsTotalSize += partSize; partSizeCount += 1; }
      if (partDuration > 0) { partsTotalDuration += partDuration; partDurationCount += 1; }
      const partEntry = { title: partTitle || `Part ${idx + 1}`, src: partSrc };
      if (partSize > 0) partEntry.fileSizeBytes = Math.round(partSize);
      if (partDuration > 0) partEntry.durationSeconds = Math.round(partDuration);
      return partEntry;
    }).filter(Boolean);

    if (separatedParts.length) {
      if (!episode.src) episode.src = separatedParts[0].src;
      const aggregatedSize = partSizeCount > 0 ? partsTotalSize : totalFileSize;
      const aggregatedDuration = partDurationCount > 0 ? partsTotalDuration : totalDuration;
      if (aggregatedSize > 0) {
        episode.fileSizeBytes = Math.round(aggregatedSize);
        episode.ItemfileSizeBytes = Math.round(aggregatedSize);
        totalFileSize = aggregatedSize;
      }
      if (aggregatedDuration > 0) {
        episode.durationSeconds = Math.round(aggregatedDuration);
        totalDuration = aggregatedDuration;
      }
      episode.separated = 1;
      episode.seperated = 1;
      episode.sources = separatedParts;
    }
  }

  if (!separatedEnabled) {
    if (totalFileSize > 0) episode.fileSizeBytes = Math.round(totalFileSize);
    if (totalDuration > 0) episode.durationSeconds = Math.round(totalDuration);
  }

  if (!episode.title || !episode.src) return null;

  return {
    episode,
    totalFileSize: totalFileSize > 0 ? Math.round(totalFileSize) : 0,
    totalDuration: totalDuration > 0 ? Math.round(totalDuration) : 0,
    totalPages: 0
  };
}

if (typeof window !== 'undefined') {
  window.mm_extractEpisodeData = extractEpisodeDataFromElement;
}

function applyDirectoryJson(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('JSON payload must be an object');
  }
  const categoriesData = Array.isArray(json.categories) ? json.categories : [];
  const providedPoster = [
    json.poster,
    json.Image,
    json.image,
    json.Image,
    json.image,
    json.poster
  ].find((val) => val && val !== 'N/A');
  posterImageUrl = providedPoster ? providedPoster : '';
  const previewPosterUrl = resolvePosterPreviewUrl(posterImageUrl);
  if (posterImageUrl) {
    setPosterPreviewSource(previewPosterUrl, { isBlob: false });
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
  const hiddenFromJson = HIDDEN_JSON_KEYS.some((key) => json && json[key] === true);
  setMaintainerHiddenFlag(hiddenFromJson);
  const titleInput = document.getElementById('dirTitle');
  if (titleInput) titleInput.value = json.title || '';
  if (categoriesEl) {
    categoriesEl.innerHTML = '';
    categoriesData.forEach(cat => addCategory(cat));
    refreshAllSeparationToggles();
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
  refreshAllSeparationToggles();
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
  setMaintainerHiddenFlag(false);
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
  setMaintainerHiddenFlag(false);
  clearPendingLoadFile();
});

homeTabBtn.addEventListener('click', () => { window.location.href = '../index.html'; });

let confirmModal = null;
let confirmPrompt = null;
let confirmYes = null;
let confirmNo = null;
let pendingRemoval = null;

function ensureConfirmModal() {
  if (!confirmModal) {
    if (window.OverlayFactory && typeof window.OverlayFactory.createConfirmModal === 'function') {
      confirmModal = window.OverlayFactory.createConfirmModal();
      confirmPrompt = confirmModal ? confirmModal.querySelector('p') : null;
      confirmYes = document.getElementById('confirmYes');
      confirmNo = document.getElementById('confirmNo');
      
      if (confirmYes) {
        confirmYes.addEventListener('click', () => {
          if (pendingRemoval) {
            try {
              if (typeof pendingRemoval.onConfirm === 'function') {
                pendingRemoval.onConfirm();
              } else if (pendingRemoval.type === 'category' && pendingRemoval.elem) {
                pendingRemoval.elem.remove();
                updateCategoryButtonVisibility();
              }
            } finally {
              if (confirmModal) confirmModal.style.display = 'none';
              pendingRemoval = null;
            }
          } else {
            if (confirmModal) confirmModal.style.display = 'none';
          }
        });
      }
      
      if (confirmNo) {
        confirmNo.addEventListener('click', () => {
          if (confirmModal) confirmModal.style.display = 'none';
          pendingRemoval = null;
        });
      }
    }
  }
  return confirmModal;
}

function queueRemoval(removal) {
  confirmModal = ensureConfirmModal();
  if (!confirmModal) return;
  confirmPrompt = confirmModal.querySelector('p');
  const messages = {
    category: 'Are you sure you want to delete this category?',
    episode: 'Are you sure you want to delete this episode?',
    part: 'Are you sure you want to delete this part?'
  };
  if (confirmPrompt) {
    const text = removal && removal.message ? removal.message : messages[removal.type] || 'Are you sure you want to delete this item?';
    confirmPrompt.textContent = text;
  }
  pendingRemoval = removal;
  if (confirmModal) confirmModal.style.display = 'flex';
}

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
    showCreatorNotice('No missing metadata detected.', 'info', 'Metadata');
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
  showCreatorNotice(`Metadata refreshed for ${successCount} item(s).`, 'success', 'Metadata');
}

// Local JSON download on A/Z keypress
function buildLocalDirectoryJSON(options = {}) {
  const includeLatestTime = (options && options.includeLatestTime !== false);
  const title = document.getElementById('dirTitle').value.trim();
  const categories = [];
  let totalBytes = 0;
  let totalSecs = 0;
  let totalPages = 0;
  let separatedCategoryCount = 0;
  let separatedItemCount = 0;
  const isMangaLibrary = isMangaMode();
  document.querySelectorAll('.category').forEach(cat => {
    const titleInput = cat.querySelector('.category-header input[type="text"]') || cat.querySelector('input[type="text"]');
    const catTitle = titleInput ? titleInput.value.trim() : '';
    const episodes = [];
    cat.querySelectorAll('.episode').forEach(epDiv => {
      const info = extractEpisodeDataFromElement(epDiv, { isManga: isMangaLibrary });
      if (!info || !info.episode) return;
      episodes.push(info.episode);
      totalBytes += info.totalFileSize || 0;
      if (isMangaLibrary) totalPages += info.totalPages || 0;
      else totalSecs += info.totalDuration || 0;
    });
    if (catTitle) {
      const separated = !isMangaLibrary && cat.dataset && cat.dataset.separated === '1';
      const categoryPayload = { category: catTitle, episodes };
      if (separated) {
        categoryPayload.separated = 1;
        separatedCategoryCount += 1;
        separatedItemCount += episodes.length;
      }
      categories.push(categoryPayload);
    }
  });
  const imageField = posterImageUrl || 'N/A';
  const base = {
    title,
    Image: imageField,
    categories,
    totalFileSizeBytes: totalBytes || 0
  };
  if (includeLatestTime) {
    base.LatestTime = new Date().toISOString();
  }
  if (!isMangaMode()) base.totalDurationSeconds = totalSecs || 0; else base.totalPagecount = totalPages || 0;
  if (!isMangaMode() && separatedCategoryCount > 0) {
    base.separatedCategoryCount = separatedCategoryCount;
    base.separatedItemCount = separatedItemCount;
  }
  if (maintainerHidden === true) {
    base.hidden = true;
  }
  return base;
}

if (typeof window !== 'undefined') {
  window.mm_buildLocalDirectoryJSON = (opts) => buildLocalDirectoryJSON(opts);
}

async function uploadDirectoryToGithub() {
  if (isGithubUploadInFlight) return;
  if (typeof window !== 'undefined' && window.DevMode !== true) return;
  const workerUrlRaw = getGithubWorkerUrl();
  if (!workerUrlRaw) {
    showCreatorNotice('Set the GitHub Worker URL in Upload Settings before uploading to GitHub.', 'warning', 'GitHub Upload');
    return;
  }
  const githubToken = getGithubToken();
  if (!githubToken) {
    showCreatorNotice('Set the GitHub token in Upload Settings before uploading to GitHub.', 'warning', 'GitHub Upload');
    return;
  }
  let workerUrl;
  try {
    workerUrl = new URL(workerUrlRaw);
  } catch (err) {
    showCreatorNotice('GitHub Worker URL is not a valid URL.', 'error', 'GitHub Upload');
    return;
  }

  const directoryJson = buildLocalDirectoryJSON();
  const title = directoryJson.title || '';
  const fileName = sanitizeWorkerFileName(title || `directory-${Date.now()}`);
  const jsonString = JSON.stringify(directoryJson, null, 2);
  const formData = new FormData();
  formData.append('ghtoken', githubToken);
  formData.append('path', `Sources/Files/${isMangaMode() ? 'Manga' : 'Anime'}`);
  formData.append('mode', isMangaMode() ? 'manga' : 'anime');
  formData.append('fileName', fileName);
  if (title) formData.append('title', title);
  const webhookOverride = getUploadWebhookOverride();
  if (webhookOverride) formData.append('webhookUrl', webhookOverride);
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
      showCreatorNotice(`GitHub upload failed: ${message}${details}`, 'error', 'GitHub Upload');
      return;
    }
    githubUploadUrl = data.pullRequestUrl || data.fileUrl || data.rawUrl || '';
    directoryCode = '';
    isFullUrl = true;
    updateOutput();
    if (data.commitUrl) console.info('[Creator] GitHub upload commit:', data.commitUrl);
    if (data.commitType === 'pull_request' && data.pullRequestUrl) {
      console.info('[Creator] GitHub upload pull request:', data.pullRequestUrl);
      showCreatorNotice(`Pull request created: ${data.pullRequestUrl}`, 'success', 'GitHub Upload');
    } else {
      showCreatorNotice(`Uploaded to GitHub: ${data.path || 'success'}`, 'success', 'GitHub Upload');
    }
  } catch (err) {
    console.error('[Creator] GitHub upload error', err);
    showCreatorNotice(`GitHub upload failed: ${err && err.message ? err.message : err}`, 'error', 'GitHub Upload');
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
