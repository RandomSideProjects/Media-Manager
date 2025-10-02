"use strict";

// Variables (top)
const DEFAULT_USERHASH = '2cdcc7754c86c2871ed2bde9d';
const LS_SETTINGS_KEY = 'mm_upload_settings';
const SETTINGS_DEFAULT_GITHUB_WORKER_URL = (typeof window !== 'undefined' && typeof window.MM_DEFAULT_GITHUB_WORKER_URL === 'string') ? window.MM_DEFAULT_GITHUB_WORKER_URL : '';

function defaultCatboxUploadUrl() {
  if (typeof window !== 'undefined' && typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === 'string') {
    const trimmed = window.MM_DEFAULT_CATBOX_UPLOAD_URL.trim();
    if (trimmed) return trimmed;
  }
  return 'https://catbox.moe/user/api.php';
}

function loadUploadSettings(){
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) {
      return {
        anonymous: true,
        userhash: '',
        githubWorkerUrl: SETTINGS_DEFAULT_GITHUB_WORKER_URL,
        catboxUploadUrl: defaultCatboxUploadUrl()
      };
    }
    const p = JSON.parse(raw);
    const compress = (typeof p.compressPosters === 'boolean') ? p.compressPosters : (typeof p.posterCompress === 'boolean' ? p.posterCompress : true);
    return {
      anonymous: typeof p.anonymous==='boolean' ? p.anonymous : true,
      userhash: (p.userhash||'').trim(),
      uploadConcurrency: Number.isFinite(parseInt(p.uploadConcurrency,10)) ? Math.max(1, Math.min(8, parseInt(p.uploadConcurrency,10))) : 2,
      libraryMode: (p.libraryMode === 'manga') ? 'manga' : 'anime',
      cbzExpand: !!p.cbzExpand,
      cbzExpandBatch: (typeof p.cbzExpandBatch === 'boolean') ? p.cbzExpandBatch : true,
      cbzExpandManual: (typeof p.cbzExpandManual === 'boolean') ? p.cbzExpandManual : true,
      compressPosters: compress,
      githubWorkerUrl: (typeof p.githubWorkerUrl === 'string' && p.githubWorkerUrl.trim()) ? p.githubWorkerUrl.trim() : SETTINGS_DEFAULT_GITHUB_WORKER_URL,
      githubToken: (typeof p.githubToken === 'string') ? p.githubToken : '',
      catboxUploadUrl: (typeof p.catboxUploadUrl === 'string' && p.catboxUploadUrl.trim()) ? p.catboxUploadUrl.trim() : defaultCatboxUploadUrl()
    };
  } catch {
    return {
      anonymous: true,
      userhash: '',
      githubWorkerUrl: SETTINGS_DEFAULT_GITHUB_WORKER_URL,
      githubToken: '',
      catboxUploadUrl: defaultCatboxUploadUrl()
    };
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
    githubWorkerUrl: (typeof s.githubWorkerUrl === 'string') ? s.githubWorkerUrl.trim() : '',
    githubToken: (typeof s.githubToken === 'string') ? s.githubToken.trim() : '',
    catboxUploadUrl: (typeof s.catboxUploadUrl === 'string') ? s.catboxUploadUrl.trim() : ''
  }));
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
const mmBtn = document.getElementById('mmUploadSettingsBtn');
const mmPanel = document.getElementById('mmUploadSettingsPanel');
const mmAnonToggle = document.getElementById('mmAnonToggle');
const mmUserhashRow = document.getElementById('mmUserhashRow');
const mmUserhashInput = document.getElementById('mmUserhashInput');
const mmUploadConcRange = document.getElementById('mmUploadConcurrencyRange');
const mmUploadConcValue = document.getElementById('mmUploadConcurrencyValue');
const mmSaveBtn = document.getElementById('mmSaveUploadSettings');
const mmCloseBtn = document.getElementById('mmCloseUploadSettings');
const mmModeAnime = document.getElementById('mmModeAnime');
const mmModeManga = document.getElementById('mmModeManga');
const mmGithubWorkerRow = document.getElementById('mmGithubWorkerRow');
const mmGithubWorkerUrlInput = document.getElementById('mmGithubWorkerUrl');
const mmGithubTokenInput = document.getElementById('mmGithubToken');
const mmCatboxRow = document.getElementById('mmCatboxRow');
const mmCatboxUrlInput = document.getElementById('mmCatboxUploadUrl');
// CBZ expansion controls
const mmCbzSection = document.getElementById('mmCbzSection');
const mmCbzExpandToggle = document.getElementById('mmCbzExpandToggle');
const mmCbzExpandSubrows = document.getElementById('mmCbzExpandSubrows');
const mmCbzExpandBatch = document.getElementById('mmCbzExpandBatch');
const mmCbzExpandManual = document.getElementById('mmCbzExpandManual');
const mmPosterCompressToggle = document.getElementById('mmPosterCompressToggle');
// No per-flow anon controls; only userhash visibility when anonymous is off

function updateDevModeRowsVisibility(force) {
  const enabled = typeof force === 'boolean'
    ? force
    : (typeof window !== 'undefined' && window.DevMode === true);
  if (mmGithubWorkerRow) mmGithubWorkerRow.style.display = enabled ? '' : 'none';
  if (mmCatboxRow) mmCatboxRow.style.display = enabled ? '' : 'none';
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

if (mmBtn && mmPanel && mmAnonToggle && mmUserhashRow && mmUserhashInput && mmSaveBtn && mmCloseBtn) {
  const st = loadUploadSettings();
  mmAnonToggle.checked = !!st.anonymous;
  mmUserhashInput.value = st.userhash || '';
  mmUserhashRow.style.display = st.anonymous ? 'none' : '';
  if (mmGithubWorkerUrlInput) mmGithubWorkerUrlInput.value = st.githubWorkerUrl || SETTINGS_DEFAULT_GITHUB_WORKER_URL;
  if (mmGithubTokenInput) mmGithubTokenInput.value = st.githubToken || '';
  if (mmCatboxUrlInput) mmCatboxUrlInput.value = st.catboxUploadUrl || defaultCatboxUploadUrl();
  updateDevModeRowsVisibility();
  if (mmModeAnime && mmModeManga) {
    const mode = (st.libraryMode === 'manga') ? 'manga' : 'anime';
    mmModeAnime.checked = (mode === 'anime');
    mmModeManga.checked = (mode === 'manga');
  }
  if (mmPosterCompressToggle) mmPosterCompressToggle.checked = (typeof st.compressPosters === 'boolean') ? st.compressPosters : true;
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
  function updateCbzSubrowsVisibility() {
    if (!mmCbzExpandToggle || !mmCbzExpandSubrows) return;
    mmCbzExpandSubrows.style.display = mmCbzExpandToggle.checked ? '' : 'none';
  }
  if (mmCbzExpandToggle) mmCbzExpandToggle.checked = !!st.cbzExpand;
  if (mmCbzExpandBatch) mmCbzExpandBatch.checked = (typeof st.cbzExpandBatch === 'boolean') ? st.cbzExpandBatch : true;
  if (mmCbzExpandManual) mmCbzExpandManual.checked = (typeof st.cbzExpandManual === 'boolean') ? st.cbzExpandManual : true;
  updateCbzSectionVisibility();
  updateCbzSubrowsVisibility();
  if (mmModeAnime) mmModeAnime.addEventListener('change', updateCbzSectionVisibility);
  if (mmModeManga) mmModeManga.addEventListener('change', updateCbzSectionVisibility);
  if (mmCbzExpandToggle) mmCbzExpandToggle.addEventListener('change', updateCbzSubrowsVisibility);

  mmBtn.addEventListener('click', () => {
    mmPanel.style.display = 'flex';
    updateDevModeRowsVisibility();
  });
  mmCloseBtn.addEventListener('click', () => { mmPanel.style.display = 'none'; });
  mmPanel.addEventListener('click', (e)=>{ if(e.target===mmPanel) mmPanel.style.display='none'; });
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
      githubWorkerUrl: mmGithubWorkerUrlInput ? mmGithubWorkerUrlInput.value.trim() : '',
      githubToken: mmGithubTokenInput ? mmGithubTokenInput.value.trim() : '',
      catboxUploadUrl: mmCatboxUrlInput ? mmCatboxUrlInput.value.trim() : ''
    };
    saveUploadSettings(saved);
    try { window.dispatchEvent(new CustomEvent('mm_settings_saved', { detail: saved })); } catch {}
    mmPanel.style.display = 'none';
  });
}

if (mmGithubTokenInput) {
  const commitToken = () => { saveSettingsPartial({ githubToken: mmGithubTokenInput.value.trim() }); };
  mmGithubTokenInput.addEventListener('change', commitToken);
  mmGithubTokenInput.addEventListener('blur', commitToken);
}

// Test JSON sender + 'Q' hotkey
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

document.addEventListener('keydown', (e) => {
  try {
    if ((e.key || '').toLowerCase() !== 'q') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    mm_sendTestJson();
  } catch {}
});
