"use strict";

// Variables (top)
const UPLOADER_CATBOX_DIRECT_UPLOAD_URL = 'https://catbox.moe/user/api.php';

function getActiveCatboxDefault() {
  if (typeof window !== 'undefined') {
    const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (active) return active;
    const fallback = typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === 'string' ? window.MM_DEFAULT_CATBOX_UPLOAD_URL.trim() : '';
    if (fallback) return fallback;
  }
  return UPLOADER_CATBOX_DIRECT_UPLOAD_URL;
}

function normalizeCatboxUrl(raw) {
  const trimmed = (typeof raw === 'string') ? raw.trim() : '';
  if (!trimmed) {
    return { url: '', code: '' };
  }

  let normalizedUrl = trimmed;
  let code = '';
  try {
    const parsed = new URL(trimmed);
    const hostname = (parsed.hostname || '').toLowerCase();
    if (hostname === 'files.catbox.moe') {
      const path = parsed.pathname.replace(/^\/+/, '');
      normalizedUrl = `https://files.catbox.moe/${path}`;
      code = path.replace(/\.json$/i, '');
    } else {
      const match = parsed.pathname.match(/\/files\/(.+)/i);
      if (match && match[1]) {
        const path = match[1];
        normalizedUrl = `https://files.catbox.moe/${path}`;
        code = path.replace(/\.json$/i, '');
      }
    }
  } catch {
    const match = trimmed.match(/files\.catbox\.moe\/([^\s]+)/i);
    if (match && match[1]) {
      normalizedUrl = `https://files.catbox.moe/${match[1]}`;
      code = match[1].replace(/\.json$/i, '');
    }
  }

  if (!code && normalizedUrl.startsWith('https://files.catbox.moe/')) {
    code = normalizedUrl.replace('https://files.catbox.moe/', '').replace(/\.json$/i, '');
  }

  return { url: normalizedUrl, code };
}

if (typeof window !== 'undefined') {
  window.mm_normalizeCatboxUrl = normalizeCatboxUrl;
}

function readUploadSettings() {
  try {
    if (typeof window !== 'undefined' && window.mm_uploadSettings && typeof window.mm_uploadSettings.load === 'function') {
      return window.mm_uploadSettings.load();
    }
  } catch {}
  try { return JSON.parse(localStorage.getItem('mm_upload_settings') || '{}') || {}; } catch { return {}; }
}

function defaultCatboxUploadUrl() {
  return getActiveCatboxDefault();
}

function resolveCatboxUploadUrl(settings) {
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';
  const defaultUrl = getActiveCatboxDefault();
  if (typeof window !== 'undefined') {
    const forced = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (forced && forced !== UPLOADER_CATBOX_DIRECT_UPLOAD_URL) {
      if (!raw || raw === UPLOADER_CATBOX_DIRECT_UPLOAD_URL || raw === forced) {
        return forced;
      }
    }
    if (forced && !raw) {
      return forced;
    }
    if (!forced && !raw && defaultUrl) {
      return defaultUrl;
    }
  }
  return raw || defaultUrl;
}

// opts: { context?: 'batch'|'manual' }
async function uploadToCatbox(file, opts) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', file);

  // Pull current settings; anonymous defaults to true
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : {};
  let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
  // Per-flow overrides when master anonymous is enabled
  try {
    const ctx = opts && opts.context;
    if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
    if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
  } catch {}
  const effectiveUserhash = ((settings.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
  if (!isAnon) {
    form.append('userhash', effectiveUserhash);
  }

  const uploadUrl = resolveCatboxUploadUrl(settings);

  const res = await fetch(uploadUrl, {
    method: 'POST',
    body: form
  });
  if (!res.ok) throw new Error('Upload error');
  const text = await res.text();
  const normalized = normalizeCatboxUrl(text);
  return normalized.url || text.trim();
}

// opts: { context?: 'batch'|'manual' }
function uploadToCatboxWithProgress(file, onProgress, opts) {
  return new Promise((resolve, reject) => {
    const st = readUploadSettings();
    const settings = st && typeof st === 'object' ? st : { anonymous: true, userhash: '' };
    const uploadUrl = resolveCatboxUploadUrl(settings);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', file);
    // Pull current settings; anonymous defaults to true
    let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
    try {
      const ctx = opts && opts.context;
      if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
      if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
    } catch {}
    const effectiveUserhash = ((settings.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
    if (!isAnon) {
      form.append('userhash', effectiveUserhash);
    }

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          onProgress(percent);
        }
      };
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok) {
          const text = xhr.responseText.trim();
          const normalized = normalizeCatboxUrl(text);
          resolve(normalized.url || text);
        } else {
          const err = new Error('Upload error: ' + xhr.status);
          reject(err);
        }
      }
    };
    xhr.onerror = () => {
      const err = new Error('Network error');
      reject(err);
    };

    xhr.send(form);
  });
}
