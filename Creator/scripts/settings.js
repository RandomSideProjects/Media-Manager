"use strict";

// Variables (top)
const DEFAULT_USERHASH = '2cdcc7754c86c2871ed2bde9d';
const LS_SETTINGS_KEY = 'mm_upload_settings';

function loadUploadSettings(){
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return { anonymous: true, userhash: '' };
    const p = JSON.parse(raw);
    return { 
      anonymous: typeof p.anonymous==='boolean' ? p.anonymous : true,
      userhash: (p.userhash||'').trim(),
      uploadConcurrency: Number.isFinite(parseInt(p.uploadConcurrency,10)) ? Math.max(1, Math.min(8, parseInt(p.uploadConcurrency,10))) : 2
    };
  } catch { return { anonymous: true, userhash: '' }; }
}
function saveUploadSettings(s){
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify({ 
    anonymous: !!s.anonymous,
    userhash: (s.userhash||'').trim(),
    uploadConcurrency: Math.max(1, Math.min(8, parseInt(s.uploadConcurrency||2,10)))
  }));
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

if (mmBtn && mmPanel && mmAnonToggle && mmUserhashRow && mmUserhashInput && mmSaveBtn && mmCloseBtn) {
  const st = loadUploadSettings();
  mmAnonToggle.checked = !!st.anonymous;
  mmUserhashInput.value = st.userhash || '';
  mmUserhashRow.style.display = st.anonymous ? 'none' : '';
  if (mmUploadConcRange) {
    mmUploadConcRange.value = String(st.uploadConcurrency || 2);
    if (mmUploadConcValue) mmUploadConcValue.textContent = String(st.uploadConcurrency || 2);
    mmUploadConcRange.addEventListener('input', () => {
      if (mmUploadConcValue) mmUploadConcValue.textContent = String(mmUploadConcRange.value);
    });
  }

  mmBtn.addEventListener('click', () => { mmPanel.style.display = 'flex'; });
  mmCloseBtn.addEventListener('click', () => { mmPanel.style.display = 'none'; });
  mmPanel.addEventListener('click', (e)=>{ if(e.target===mmPanel) mmPanel.style.display='none'; });
  mmAnonToggle.addEventListener('change', () => { mmUserhashRow.style.display = mmAnonToggle.checked ? 'none' : ''; });
  mmSaveBtn.addEventListener('click', () => {
    saveUploadSettings({
      anonymous: mmAnonToggle.checked,
      userhash: mmUserhashInput.value.trim(),
      uploadConcurrency: mmUploadConcRange ? parseInt(mmUploadConcRange.value,10) : 2
    });
    mmPanel.style.display = 'none';
  });
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

    const url = await (window.uploadToCatboxWithProgress ? uploadToCatboxWithProgress(file) : (async () => {
      const fd = new FormData();
      fd.append('reqtype', 'fileupload');
      fd.append('fileToUpload', file);
      const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd });
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
