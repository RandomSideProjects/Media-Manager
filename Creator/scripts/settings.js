"use strict";

// Variables (top)
const DEFAULT_USERHASH = '2cdcc7754c86c2871ed2bde9d';
const LS_SETTINGS_KEY = 'mm_upload_settings';
const SETTINGS_CURRENT_GITHUB_WORKER_ROOT = 'https://mm.littlehacker303.workers.dev/gh';
const SETTINGS_DEFAULT_GITHUB_WORKER_URL = (typeof window !== 'undefined' && typeof window.MM_DEFAULT_GITHUB_WORKER_URL === 'string') ? window.MM_DEFAULT_GITHUB_WORKER_URL : SETTINGS_CURRENT_GITHUB_WORKER_ROOT;
const SETTINGS_LEGACY_GITHUB_WORKER_ROOT = 'https://mmback.littlehacker303.workers.dev/gh';
const SETTINGS_CATBOX_BACKEND_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const SETTINGS_CATBOX_MODE_KEY = 'catboxOverrideMode';

function normalizeGithubWorkerUrlValue(raw) {
  const trimmed = (typeof raw === 'string') ? raw.trim() : '';
  if (!trimmed) return '';
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (withoutTrailingSlash === SETTINGS_LEGACY_GITHUB_WORKER_ROOT) {
    return SETTINGS_CURRENT_GITHUB_WORKER_ROOT;
  }
  if (withoutTrailingSlash === 'https://mmback.littlehacker303.workers.dev') {
    return SETTINGS_CURRENT_GITHUB_WORKER_ROOT;
  }
  if (withoutTrailingSlash === SETTINGS_CURRENT_GITHUB_WORKER_ROOT) {
    return SETTINGS_CURRENT_GITHUB_WORKER_ROOT;
  }
  return withoutTrailingSlash;
}

function defaultCatboxUploadUrl() {
  return SETTINGS_CATBOX_BACKEND_URL;
}

function normalizeCatboxMode(value) {
  const trimmed = (typeof value === 'string') ? value.trim().toLowerCase() : 'default';
  return trimmed === 'proxy' ? 'proxy' : 'default';
}

function applyCatboxOverride(mode, proxyUrl) {
  const normalizedMode = normalizeCatboxMode(mode);
  if (typeof window === 'undefined') return;
  window.MM_CATBOX_OVERRIDE_MODE = normalizedMode;
  if (normalizedMode !== 'proxy') return;

  const candidate = (typeof proxyUrl === 'string' && proxyUrl.trim()) ? proxyUrl.trim() : defaultCatboxUploadUrl();
  const previous = (typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === 'string') ? window.MM_DEFAULT_CATBOX_UPLOAD_URL : '';
  window.MM_DEFAULT_CATBOX_UPLOAD_URL = candidate;
  window.MM_ACTIVE_CATBOX_UPLOAD_URL = candidate;
  try {
    window.dispatchEvent(new CustomEvent('rsp:catbox-default-updated', { detail: { url: candidate, previous, meta: { source: 'overwrite' } } }));
  } catch {}
}

function applyCatboxBackendUrl(url) {
  if (typeof window === 'undefined') return;
  const normalized = (typeof url === 'string' && url.trim()) ? url.trim() : defaultCatboxUploadUrl();
  window.MM_DEFAULT_CATBOX_UPLOAD_URL = normalized;
  window.MM_ACTIVE_CATBOX_UPLOAD_URL = normalized;
  try {
    window.dispatchEvent(new CustomEvent('rsp:catbox-default-updated', { detail: { url: normalized, previous: '', meta: { source: 'dev-override' } } }));
  } catch {}
}

function loadUploadSettings(){
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) {
      const initial = {
        anonymous: true,
        userhash: '',
        githubWorkerUrl: normalizeGithubWorkerUrlValue(SETTINGS_DEFAULT_GITHUB_WORKER_URL),
        catboxUploadUrl: defaultCatboxUploadUrl(),
        webhookUrl: '',
        separationTag: false,
        folderUploadYellWhenHidden: true,
        autoArchiveOversize: false
      };
      return initial;
    }
    const p = JSON.parse(raw);
    const compress = (typeof p.compressPosters === 'boolean') ? p.compressPosters : (typeof p.posterCompress === 'boolean' ? p.posterCompress : true);
    const storedGithubRaw = (typeof p.githubWorkerUrl === 'string') ? p.githubWorkerUrl.trim() : '';
    const normalizedGithubUrl = normalizeGithubWorkerUrlValue(storedGithubRaw || SETTINGS_DEFAULT_GITHUB_WORKER_URL);
    const result = {
      anonymous: typeof p.anonymous==='boolean' ? p.anonymous : true,
      userhash: (p.userhash||'').trim(),
      uploadConcurrency: Number.isFinite(parseInt(p.uploadConcurrency,10)) ? Math.max(1, Math.min(8, parseInt(p.uploadConcurrency,10))) : 2,
      libraryMode: (p.libraryMode === 'manga') ? 'manga' : 'anime',
      cbzExpand: !!p.cbzExpand,
      cbzExpandBatch: (typeof p.cbzExpandBatch === 'boolean') ? p.cbzExpandBatch : true,
      cbzExpandManual: (typeof p.cbzExpandManual === 'boolean') ? p.cbzExpandManual : true,
      compressPosters: compress,
      separationTag: !!p.separationTag,
      folderUploadYellWhenHidden: (typeof p.folderUploadYellWhenHidden === 'boolean') ? p.folderUploadYellWhenHidden : true,
      autoArchiveOversize: (typeof p.autoArchiveOversize === 'boolean') ? p.autoArchiveOversize : false,
      githubWorkerUrl: normalizedGithubUrl,
      githubToken: (typeof p.githubToken === 'string') ? p.githubToken : '',
      catboxUploadUrl: (typeof p.catboxUploadUrl === 'string' && p.catboxUploadUrl.trim()) ? p.catboxUploadUrl.trim() : defaultCatboxUploadUrl(),
      catboxOverrideMode: normalizeCatboxMode(p.catboxOverrideMode),
      webhookUrl: (typeof p.webhookUrl === 'string') ? p.webhookUrl.trim() : ''
    };
    applyCatboxOverride(result.catboxOverrideMode, result.catboxUploadUrl);
    if (storedGithubRaw && normalizedGithubUrl && normalizedGithubUrl !== storedGithubRaw) {
      saveUploadSettings(result);
    }
    return result;
  } catch {
  const fallback = {
    anonymous: true,
    userhash: '',
    githubWorkerUrl: normalizeGithubWorkerUrlValue(SETTINGS_DEFAULT_GITHUB_WORKER_URL),
    githubToken: '',
    catboxUploadUrl: defaultCatboxUploadUrl(),
    catboxOverrideMode: 'default',
    webhookUrl: '',
    separationTag: false,
    folderUploadYellWhenHidden: true,
    autoArchiveOversize: false
  };
  return fallback;
}
}
function saveUploadSettings(s){
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify({
    anonymous: !!s.anonymous,
    userhash: (s.userhash||'').trim(),
    uploadConcurrency: Math.max(1, Math.min(8, parseInt(s.uploadConcurrency||2,10))),
    libraryMode: (s.libraryMode === 'manga') ? 'manga' : 'anime',
    cbzExpand: !!s.cbzExpand,
    cbzExpandBatch: !!s.cbzExpandBatch,
    cbzExpandManual: !!s.cbzExpandManual,
    compressPosters: (typeof s.compressPosters === 'boolean') ? s.compressPosters : true,
    separationTag: !!s.separationTag,
    folderUploadYellWhenHidden: (typeof s.folderUploadYellWhenHidden === 'boolean') ? s.folderUploadYellWhenHidden : true,
    autoArchiveOversize: (typeof s.autoArchiveOversize === 'boolean') ? s.autoArchiveOversize : false,
    githubWorkerUrl: normalizeGithubWorkerUrlValue((typeof s.githubWorkerUrl === 'string') ? s.githubWorkerUrl.trim() : ''),
    githubToken: (typeof s.githubToken === 'string') ? s.githubToken.trim() : '',
    catboxUploadUrl: (typeof s.catboxUploadUrl === 'string') ? s.catboxUploadUrl.trim() : '',
    catboxOverrideMode: normalizeCatboxMode(s.catboxOverrideMode),
    webhookUrl: (typeof s.webhookUrl === 'string') ? s.webhookUrl.trim() : ''
  }));
  applyCatboxOverride(s.catboxOverrideMode, s.catboxUploadUrl);
}

function saveSettingsPartial(partial) {
  const current = loadUploadSettings();
  const next = Object.assign({}, current, partial);
  saveUploadSettings(next);
  try { window.dispatchEvent(new CustomEvent('mm_settings_saved', { detail: next })); } catch {}
}

function getCatboxUploadUrl() {
  const settings = loadUploadSettings();
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';
  return raw || defaultCatboxUploadUrl();
}

if (typeof window !== 'undefined') {
  window.mm_getCatboxUploadUrl = getCatboxUploadUrl;
}

// Expose globals
window.mm_uploadSettings = { load: loadUploadSettings, save: saveUploadSettings };

// UI wiring
let mmBtn = null;
let mmPanel = null;
let mmAnonToggle = null;
let mmUserhashRow = null;
let mmUserhashInput = null;
let mmUploadConcRange = null;
let mmUploadConcValue = null;
let mmSaveBtn = null;
let mmCloseBtn = null;
let mmModeAnime = null;
let mmModeManga = null;
let mmCbzSection = null;
let mmCbzExpandToggle = null;
let mmCbzExpandSubrows = null;
let mmCbzExpandBatch = null;
let mmCbzExpandManual = null;
let mmPosterCompressToggle = null;
let mmSeparationToggle = null;
let mmFolderUploadYellToggle = null;
let mmAutoArchiveOversizeToggle = null;
let mmCatboxUrlInput = null;
let devMenuRow = null;
let devMenuStatus = null;
let settingsPanelInitialized = false;

function ensureUploadSettingsPanel() {
  if (!mmPanel) {
    if (window.OverlayFactory && typeof window.OverlayFactory.createUploadSettingsPanel === 'function') {
      mmPanel = window.OverlayFactory.createUploadSettingsPanel();
      
      // Re-query all elements
      mmAnonToggle = document.getElementById('mmAnonToggle');
      mmUserhashRow = document.getElementById('mmUserhashRow');
      mmUserhashInput = document.getElementById('mmUserhashInput');
      mmUploadConcRange = document.getElementById('mmUploadConcurrencyRange');
      mmUploadConcValue = document.getElementById('mmUploadConcurrencyValue');
      mmSaveBtn = document.getElementById('mmSaveUploadSettings');
      mmCloseBtn = document.getElementById('mmCloseUploadSettings');
      mmModeAnime = document.getElementById('mmModeAnime');
      mmModeManga = document.getElementById('mmModeManga');
      mmCbzSection = document.getElementById('mmCbzSection');
      mmCbzExpandToggle = document.getElementById('mmCbzExpandToggle');
      mmCbzExpandSubrows = document.getElementById('mmCbzExpandSubrows');
      mmCbzExpandBatch = document.getElementById('mmCbzExpandBatch');
      mmCbzExpandManual = document.getElementById('mmCbzExpandManual');
      mmPosterCompressToggle = document.getElementById('mmPosterCompressToggle');
      mmSeparationToggle = document.getElementById('mmSeparationToggle');
      mmFolderUploadYellToggle = document.getElementById('mmFolderUploadYellToggle');
      mmAutoArchiveOversizeToggle = document.getElementById('mmAutoArchiveOversizeToggle');
      devMenuRow = document.getElementById('devMenuRow');
      devMenuStatus = document.getElementById('devMenuStatus');
      
      if (!settingsPanelInitialized) {
        initializeUploadSettingsPanel();
        settingsPanelInitialized = true;
      }
    }
  }
  return mmPanel;
}

function updateDevModeRowsVisibility(force) {
  devMenuRow = document.getElementById('devMenuRow');
  devMenuStatus = document.getElementById('devMenuStatus');
  
  const enabled = typeof force === 'boolean'
    ? force
    : (typeof window !== 'undefined' && window.DevMode === true);
  if (devMenuRow) devMenuRow.style.display = enabled ? '' : 'none';
  if (devMenuStatus) {
    devMenuStatus.textContent = enabled ? 'Developer tools' : 'Enable Dev Mode (O + P)';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('rsp:dev-mode-changed', (event) => {
    const enabled = event && event.detail && event.detail.enabled === true;
    updateDevModeRowsVisibility(enabled);
  });

  window.addEventListener('rsp:catbox-default-updated', (event) => {
    try {
      const detail = event && event.detail ? event.detail : {};
      const previous = (typeof detail.previous === 'string') ? detail.previous.trim() : '';
      const nextDefault = defaultCatboxUploadUrl();

      if (mmCatboxUrlInput) {
        const currentVal = (mmCatboxUrlInput.value || '').trim();
        if (!currentVal || (previous && currentVal === previous)) {
          mmCatboxUrlInput.value = nextDefault;
        }
      }

      const currentSettings = loadUploadSettings();
      const storedUrl = (currentSettings.catboxUploadUrl || '').trim();
      const useProxy = detail && detail.meta && detail.meta.source === 'proxy';

      if (useProxy && (!storedUrl || (previous && storedUrl === previous))) {
        saveSettingsPartial({ catboxUploadUrl: '' });
      }
    } catch (err) {
      console.error('[Creator] Failed to react to Catbox default update', err);
    }
  });
}

function updateCbzRelated() {
  const mmModeManga = document.getElementById('mmModeManga');
  const mmCbzSection = document.getElementById('mmCbzSection');
  const mode = (mmModeManga && mmModeManga.checked) ? 'manga' : 'anime';
  if (mmCbzSection) mmCbzSection.style.display = (mode === 'manga') ? '' : 'none';
  
  const mmCbzExpandToggle = document.getElementById('mmCbzExpandToggle');
  const mmCbzExpandSubrows = document.getElementById('mmCbzExpandSubrows');
  if (mmCbzExpandToggle && mmCbzExpandSubrows) {
    mmCbzExpandSubrows.style.display = mmCbzExpandToggle.checked ? '' : 'none';
  }
}

mmBtn = document.getElementById('mmUploadSettingsBtn');
if (mmBtn) {
  mmBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    mmPanel = ensureUploadSettingsPanel();
    if (mmPanel) {
      mmPanel.style.display = 'flex';
      updateCbzRelated();
    }
  });
}

function initializeUploadSettingsPanel() {
  if (!mmAnonToggle || !mmUserhashRow || !mmUserhashInput || !mmSaveBtn || !mmCloseBtn) return;
  
  const st = loadUploadSettings();
  mmAnonToggle.checked = !!st.anonymous;
  mmUserhashInput.value = st.userhash || '';
  mmUserhashRow.style.display = st.anonymous ? 'none' : '';
  updateDevModeRowsVisibility();
  if (mmModeAnime && mmModeManga) {
    const mode = (st.libraryMode === 'manga') ? 'manga' : 'anime';
    mmModeAnime.checked = (mode === 'anime');
    mmModeManga.checked = (mode === 'manga');
  }
  if (mmPosterCompressToggle) mmPosterCompressToggle.checked = (typeof st.compressPosters === 'boolean') ? st.compressPosters : true;
  if (mmSeparationToggle) mmSeparationToggle.checked = !!st.separationTag;
  if (mmFolderUploadYellToggle) mmFolderUploadYellToggle.checked = (typeof st.folderUploadYellWhenHidden === 'boolean') ? st.folderUploadYellWhenHidden : true;
  if (mmAutoArchiveOversizeToggle) mmAutoArchiveOversizeToggle.checked = (typeof st.autoArchiveOversize === 'boolean') ? st.autoArchiveOversize : false;
  if (mmUploadConcRange) {
    mmUploadConcRange.value = String(st.uploadConcurrency || 2);
    if (mmUploadConcValue) mmUploadConcValue.textContent = String(st.uploadConcurrency || 2);
    mmUploadConcRange.addEventListener('input', () => {
      if (mmUploadConcValue) mmUploadConcValue.textContent = String(mmUploadConcRange.value);
    });
  }

  // Initialize CBZ section visibility and values
  function updateCbzSectionVisibility() {
    const mode = (mmModeManga && mmModeManga.checked) ? 'manga' : 'anime';
    if (mmCbzSection) mmCbzSection.style.display = (mode === 'manga') ? '' : 'none';
  }
  function updateSeparationVisibility() {
    const mode = (mmModeManga && mmModeManga.checked) ? 'manga' : 'anime';
    const mmSeparationRow = mmSeparationToggle ? mmSeparationToggle.closest('.mm-settings-row') : null;
    if (mmSeparationRow) mmSeparationRow.style.display = (mode === 'anime') ? '' : 'none';
  }
  function updateCbzSubrowsVisibility() {
    if (!mmCbzExpandToggle || !mmCbzExpandSubrows) return;
    mmCbzExpandSubrows.style.display = mmCbzExpandToggle.checked ? '' : 'none';
  }
  if (mmCbzExpandToggle) mmCbzExpandToggle.checked = !!st.cbzExpand;
  if (mmCbzExpandBatch) mmCbzExpandBatch.checked = (typeof st.cbzExpandBatch === 'boolean') ? st.cbzExpandBatch : true;
  if (mmCbzExpandManual) mmCbzExpandManual.checked = (typeof st.cbzExpandManual === 'boolean') ? st.cbzExpandManual : true;
  updateCbzSectionVisibility();
  updateSeparationVisibility();
  updateCbzSubrowsVisibility();
  if (mmModeAnime) mmModeAnime.addEventListener('change', () => {
    updateCbzSectionVisibility();
    updateSeparationVisibility();
  });
  if (mmModeManga) mmModeManga.addEventListener('change', () => {
    updateCbzSectionVisibility();
    updateSeparationVisibility();
  });
  if (mmCbzExpandToggle) mmCbzExpandToggle.addEventListener('change', updateCbzSubrowsVisibility);

  mmCloseBtn.addEventListener('click', () => { if (mmPanel) mmPanel.style.display = 'none'; });
  if (mmPanel) {
    mmPanel.addEventListener('click', (e) => { 
      if (e.target === mmPanel && mmPanel) mmPanel.style.display = 'none'; 
    });
  }
  
  function updateAnonFields() {
    try { mmUserhashRow.style.display = mmAnonToggle.checked ? 'none' : ''; } catch {}
  }
  updateAnonFields();
  mmAnonToggle.addEventListener('change', updateAnonFields);
  mmSaveBtn.addEventListener('click', () => {
    const mode = (mmModeManga && mmModeManga.checked) ? 'manga' : 'anime';
    const saved = {
      anonymous: mmAnonToggle.checked,
      userhash: mmUserhashInput.value.trim(),
      uploadConcurrency: mmUploadConcRange ? parseInt(mmUploadConcRange.value,10) : 2,
      libraryMode: mode,
      cbzExpand: mmCbzExpandToggle ? !!mmCbzExpandToggle.checked : false,
      cbzExpandBatch: mmCbzExpandBatch ? !!mmCbzExpandBatch.checked : true,
      cbzExpandManual: mmCbzExpandManual ? !!mmCbzExpandManual.checked : true,
      compressPosters: mmPosterCompressToggle ? !!mmPosterCompressToggle.checked : true,
      separationTag: mmSeparationToggle ? !!mmSeparationToggle.checked : false,
      folderUploadYellWhenHidden: mmFolderUploadYellToggle ? !!mmFolderUploadYellToggle.checked : true,
      autoArchiveOversize: mmAutoArchiveOversizeToggle ? !!mmAutoArchiveOversizeToggle.checked : false
    };
    saveUploadSettings(saved);
    try { window.dispatchEvent(new CustomEvent('mm_settings_saved', { detail: saved })); } catch {}
    mmPanel.style.display = 'none';
  });
}

// Test JSON sender (dev-only)
async function mm_sendTestJson() {
  try {
    const st = loadUploadSettings();
    const effectiveUserhash = (st.userhash || '').trim() || DEFAULT_USERHASH;
    let titleVal = '';
    try { const t = document.getElementById('dirTitle'); titleVal = t ? (t.value || '').trim() : ''; } catch {}
    let categoryCount = 0;
    try { categoryCount = document.querySelectorAll('.category').length; } catch {}

    const payload = {
      _type: 'media-manager-test',
      page: 'Creator/index.html',
      at: new Date().toISOString(),
      settings: { anonymous: !!st.anonymous, userhash: st.anonymous ? '(ignored: anonymous=true)' : effectiveUserhash },
      state: { title: titleVal, categories: categoryCount },
      ua: navigator.userAgent || ''
    };

    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const file = new File([blob], `mm_test_${Date.now()}.json`, { type: 'application/json' });

    const catboxUrl = (typeof st.catboxUploadUrl === 'string' && st.catboxUploadUrl.trim()) ? st.catboxUploadUrl.trim() : defaultCatboxUploadUrl();

    const url = await (window.uploadToCatboxWithProgress ? uploadToCatboxWithProgress(file) : (async () => {
      const fd = new FormData();
      fd.append('reqtype', 'fileupload');
      fd.append('fileToUpload', file);
      const res = await fetch(catboxUrl, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload error: ' + res.status);
      return (await res.text()).trim();
    })());

    try {
      const outLink = document.getElementById('outputLink');
      if (outLink) { outLink.href = url; outLink.textContent = url; }
    } catch {}
    return url;
  } catch (err) {
    console.error('[MM][TestJSON] ❌ Failed:', err);
    throw err;
  }
}
window.mm_sendTestJson = mm_sendTestJson;

async function mm_manualUploadSource() {
  try {
    const builder = (typeof window !== 'undefined' && typeof window.mm_buildLocalDirectoryJSON === 'function')
      ? window.mm_buildLocalDirectoryJSON
      : null;
    if (!builder) throw new Error('Creator payload builder unavailable');
    const payload = builder({ includeLatestTime: false });
    if (!payload || typeof payload !== 'object') throw new Error('Could not build source payload');
    const uploader = (typeof window !== 'undefined' && typeof window.mm_autoUploadFromContent === 'function')
      ? window.mm_autoUploadFromContent
      : (typeof autoUploadFromContent === 'function' ? autoUploadFromContent : null);
    if (!uploader) throw new Error('Upload helper unavailable');
    await uploader(payload);
    return true;
  } catch (err) {
    console.error('[MM][ManualUpload] ❌ Failed:', err);
    if (typeof window !== 'undefined' && typeof window.showStorageNotice === 'function') {
      window.showStorageNotice({
        title: 'Manual Upload',
        message: err && err.message ? err.message : 'Upload failed',
        tone: 'error',
        autoCloseMs: 5000
      });
    }
    return false;
  }
}
window.mm_manualUploadSource = mm_manualUploadSource;

// Create settings panel immediately so dev-menu.js can access its elements
ensureUploadSettingsPanel();

document.addEventListener('keydown', (e) => {
  try {
    if ((e.key || '').toLowerCase() !== 'q') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    mm_manualUploadSource();
  } catch {}
});
