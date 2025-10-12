"use strict";

// Variables (top)
const UPLOADER_CATBOX_DIRECT_UPLOAD_URL = 'https://catbox.moe/user/api.php';
const UPLOADER_CATBOX_PROXY_UPLOAD_URL = 'https://catbox-proxy.littlehacker303.workers.dev/user/api.php';
const UPLOADER_OVERRIDE_ALLOWED = new Set(['auto', 'direct', 'proxy']);
const PROXY_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const DIRECT_SIZE_LIMIT_BYTES = 200 * 1024 * 1024;

function getActiveCatboxDefault() {
  const override = getCatboxOverrideMode();
  if (override === 'direct') return UPLOADER_CATBOX_DIRECT_UPLOAD_URL;
  if (override === 'proxy') return UPLOADER_CATBOX_PROXY_UPLOAD_URL;
  if (typeof window !== 'undefined') {
    const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (active) return active;
    const fallback = typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === 'string' ? window.MM_DEFAULT_CATBOX_UPLOAD_URL.trim() : '';
    if (fallback) return fallback;
  }
  return UPLOADER_CATBOX_DIRECT_UPLOAD_URL;
}

function getCatboxOverrideMode() {
  if (typeof window === 'undefined') return 'auto';
  const raw = (window.MM_CATBOX_OVERRIDE_MODE || '').toString().trim().toLowerCase();
  return UPLOADER_OVERRIDE_ALLOWED.has(raw) ? raw : 'auto';
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

function resolveCatboxUploadUrl(settings, { fileSizeBytes } = {}) {
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';
  const defaultUrl = getActiveCatboxDefault();
  const override = getCatboxOverrideMode();
  if (override === 'direct') {
    return UPLOADER_CATBOX_DIRECT_UPLOAD_URL;
  }
  if (override === 'proxy') {
    return UPLOADER_CATBOX_PROXY_UPLOAD_URL;
  }
  if (typeof window !== 'undefined') {
    const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (active) {
      const isStandard = !raw || raw === UPLOADER_CATBOX_DIRECT_UPLOAD_URL || raw === UPLOADER_CATBOX_PROXY_UPLOAD_URL || raw === active;
      if (isStandard) {
        return active;
      }
    }
    if (!active && !raw && defaultUrl) {
      return defaultUrl;
    }
  }
  const chosen = raw || defaultUrl;
  if (!fileSizeBytes || chosen === UPLOADER_CATBOX_DIRECT_UPLOAD_URL) return chosen;
  if (fileSizeBytes > PROXY_SIZE_LIMIT_BYTES) {
    return UPLOADER_CATBOX_DIRECT_UPLOAD_URL;
  }
  return chosen;
}

function assertUploadSizeLimit(uploadUrl, fileSizeBytes) {
  if (!Number.isFinite(fileSizeBytes)) return;
  if (uploadUrl === UPLOADER_CATBOX_PROXY_UPLOAD_URL && fileSizeBytes > PROXY_SIZE_LIMIT_BYTES) {
    const limitMb = Math.floor(PROXY_SIZE_LIMIT_BYTES / (1024 * 1024));
    throw new Error(`File is larger than ${limitMb} MB proxy limit. Switch to direct Catbox uploads.`);
  }
  if (uploadUrl === UPLOADER_CATBOX_DIRECT_UPLOAD_URL && fileSizeBytes > DIRECT_SIZE_LIMIT_BYTES) {
    const limitMb = Math.floor(DIRECT_SIZE_LIMIT_BYTES / (1024 * 1024));
    throw new Error(`File exceeds ${limitMb} MB direct Catbox limit.`);
  }
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

  const fileSizeBytes = file && typeof file.size === 'number' ? file.size : undefined;
  const uploadUrl = resolveCatboxUploadUrl(settings, { fileSizeBytes });
  assertUploadSizeLimit(uploadUrl, fileSizeBytes);

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
  const options = (opts && typeof opts === 'object') ? opts : {};
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const st = readUploadSettings();
    const settings = st && typeof st === 'object' ? st : { anonymous: true, userhash: '' };
    const fileSizeBytes = file && typeof file.size === 'number' ? file.size : undefined;
    const uploadUrl = resolveCatboxUploadUrl(settings, { fileSizeBytes });
    assertUploadSizeLimit(uploadUrl, fileSizeBytes);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', file);
    // Pull current settings; anonymous defaults to true
    let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
    try {
      const ctx = options.context;
      if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
      if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
    } catch {}
    const effectiveUserhash = ((settings.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
    if (!isAnon) {
      form.append('userhash', effectiveUserhash);
    }

    const createAbortError = () => {
      if (typeof DOMException === 'function') return new DOMException('Upload aborted', 'AbortError');
      const err = new Error('Upload aborted');
      err.name = 'AbortError';
      return err;
    };

    let settled = false;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      }
    };
    const finalizeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finalizeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try { xhr.abort(); } catch {}
      finalizeReject(createAbortError());
    };

    if (signal && typeof signal.addEventListener === 'function') {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
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
          finalizeResolve(normalized.url || text);
        } else {
          const err = new Error('Upload error: ' + xhr.status);
          finalizeReject(err);
        }
      }
    };
    xhr.onerror = () => {
      const err = new Error('Network error');
      finalizeReject(err);
    };

    xhr.send(form);
  });
}
