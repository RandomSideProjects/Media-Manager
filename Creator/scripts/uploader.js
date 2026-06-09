"use strict";

// Variables (top)
const UPLOADER_CATBOX_BACKEND_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const CUSTOM_CATBOX_LIMIT = 104857600;
const DIRECT_CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';

function getActiveCatboxDefault() {
  if (typeof window !== 'undefined') {
    const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === 'string' ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : '';
    if (active) return active;
  }
  return UPLOADER_CATBOX_BACKEND_URL;
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

function pad2(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return '00';
  return String(n).padStart(2, '0');
}

function parseSeasonNumber(categoryTitle) {
  const raw = (typeof categoryTitle === 'string') ? categoryTitle.trim() : '';
  if (!raw) return null;
  const match = raw.match(/^season\s*#?\s*(\d{1,3})\s*$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function sanitizeFilenameSegment(value, { fallback = 'Item', maxLen = 80 } = {}) {
  const base = (typeof value === 'string') ? value : String(value || '');
  const normalized = typeof base.normalize === 'function' ? base.normalize('NFKD') : base;
  const filtered = normalized
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = filtered.replace(/[^A-Za-z0-9 _.-]+/g, '').trim();
  const collapsed = safe.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const finalValue = collapsed || fallback;
  return finalValue.length > maxLen ? finalValue.slice(0, maxLen) : finalValue;
}

function buildCopypartySourceFolderName(sourceTitle) {
  const base = (typeof sourceTitle === 'string') ? sourceTitle : String(sourceTitle || '');
  const normalized = typeof base.normalize === 'function' ? base.normalize('NFKD') : base;
  const filtered = normalized
    .replace(/['’]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^A-Za-z0-9! ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!filtered) return '';

  const endsWithBang = /!$/.test(filtered);
  const words = filtered
    .replace(/!+$/g, '')
    .split(/\s+/)
    .map((word) => word ? (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : '')
    .filter(Boolean);
  if (!words.length) return '';

  const joined = words.join('');
  return `${joined}${endsWithBang ? '!' : ''}`;
}

function getCurrentSourceTitle() {
  try {
    if (typeof document === 'undefined') return '';
    const input = document.getElementById('dirTitle');
    return input && typeof input.value === 'string' ? input.value.trim() : '';
  } catch {
    return '';
  }
}

function getCopypartySubdir(opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const explicit = typeof options.sourceFolder === 'string' ? options.sourceFolder.trim() : '';
  if (explicit) return explicit;
  return buildCopypartySourceFolderName(getCurrentSourceTitle());
}

function buildCreatorItemFilenameBase({ categoryTitle, itemIndex, sourceTitle } = {}) {
  const season = parseSeasonNumber(categoryTitle);
  const idx = Math.max(1, Math.floor(Number(itemIndex) || 1));
  const indexPart = season ? `S${pad2(season)}E${pad2(idx)}` : pad2(idx);
  const titlePart = sanitizeFilenameSegment(sourceTitle, { fallback: 'Item' });
  return `${indexPart}_${titlePart}`;
}

function randomUploadBase(len = 10) {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, Math.max(8, len));
    }
  } catch {}
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(Math.max(8, Math.ceil(len / 2)));
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
    }
  } catch {}
  return Math.random().toString(16).slice(2, 2 + len);
}

function inferExtensionFromFileName(name) {
  const raw = (typeof name === 'string') ? name : '';
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return '';
  const ext = raw.slice(idx);
  if (!/^\.[a-z0-9]{1,8}$/i.test(ext)) return '';
  return ext;
}

function withUploadFilename(file, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  if (!(file instanceof File)) return file;

  const ext = inferExtensionFromFileName(file.name);
  const explicitFilenameRaw = (typeof options.filename === 'string' ? options.filename : (typeof options.fileName === 'string' ? options.fileName : '')).trim();
  const filenameBaseRaw = typeof options.filenameBase === 'string' ? options.filenameBase.trim() : '';
  const creatorItem = options && typeof options.creatorItem === 'object' ? options.creatorItem : null;

  const shouldRandomize = options.randomizeFilename !== false;

  let nextName = '';
  if (explicitFilenameRaw) {
    nextName = explicitFilenameRaw;
    if (ext && !/\.[a-z0-9]{1,8}$/i.test(nextName)) nextName = `${nextName}${ext}`;
  } else if (filenameBaseRaw) {
    nextName = `${filenameBaseRaw}${ext}`;
  } else if (creatorItem) {
    nextName = `${buildCreatorItemFilenameBase(creatorItem)}${ext}`;
  } else if (shouldRandomize) {
    nextName = `${randomUploadBase()}${ext}`;
  } else {
    nextName = file.name;
  }

  nextName = sanitizeFilenameSegment(nextName, { fallback: file.name || 'upload' });
  if (ext && !nextName.toLowerCase().endsWith(ext.toLowerCase())) {
    nextName = `${nextName}${ext}`;
  }
  if (nextName === file.name) return file;

  try {
    return new File([file], nextName, { type: file.type || 'application/octet-stream', lastModified: file.lastModified });
  } catch {
    return file;
  }
}

if (typeof window !== 'undefined') {
  window.mm_buildCreatorItemFilenameBase = buildCreatorItemFilenameBase;
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

function isProxyCatboxUrl(url) {
  if (!url) return false;
  try {
    const trimmed = String(url).trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('https://mm.littlehacker303.workers.dev/catbox/')) return true;
    if (lower.startsWith('https://mmback.littlehacker303.workers.dev/catbox/')) return true;
    if (typeof window !== 'undefined' && typeof window.MM_PROXY_CATBOX_UPLOAD_URL === 'string') {
      const proxy = window.MM_PROXY_CATBOX_UPLOAD_URL.trim().toLowerCase();
      if (proxy && lower === proxy) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getDirectCatboxUrl() {
  if (typeof window !== 'undefined' && typeof window.MM_DIRECT_CATBOX_UPLOAD_URL === 'string') {
    const direct = window.MM_DIRECT_CATBOX_UPLOAD_URL.trim();
    if (direct) return direct;
  }
  return DIRECT_CATBOX_UPLOAD_URL;
}

function getProxyCatboxUrl(settings) {
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';
  if (raw && isProxyCatboxUrl(raw)) return raw;
  if (typeof window !== 'undefined' && typeof window.MM_PROXY_CATBOX_UPLOAD_URL === 'string') {
    const proxy = window.MM_PROXY_CATBOX_UPLOAD_URL.trim();
    if (proxy) return proxy;
  }
  return UPLOADER_CATBOX_BACKEND_URL;
}

function getCatboxOverrideModeFromSettings(settings) {
  const raw = settings && typeof settings.catboxOverrideMode === 'string'
    ? settings.catboxOverrideMode.trim().toLowerCase()
    : '';
  return raw === 'direct' || raw === 'proxy' ? raw : 'default';
}

function resolveCatboxUploadUrl(settings, { fileSizeBytes, allowProxy = true, forceProxy = false } = {}) {
  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
  const thresholdMbRaw = (settings && Number.isFinite(parseFloat(settings.copypartyThresholdMb))) ? parseFloat(settings.copypartyThresholdMb) : 100;
  const thresholdMb = Math.max(6, Math.min(100, thresholdMbRaw)); // enforce 5 < x <= 100
  const canUseCopyparty = !!cp;
  const proxyUrl = getProxyCatboxUrl(settings);

  if (forceProxy) return proxyUrl;

  const CP_THRESHOLD = thresholdMb * 1024 * 1024;
  const shouldUseCopyparty = canUseCopyparty && Number.isFinite(fileSizeBytes) && fileSizeBytes >= CP_THRESHOLD;

  if (shouldUseCopyparty) return '__COPYPARTY__';

  const mode = getCatboxOverrideModeFromSettings(settings);
  if (mode === 'direct') return getDirectCatboxUrl();
  if (mode === 'proxy') return proxyUrl;

  const forceProxyUnderLimit = !!(settings && settings.catboxForceProxyUnder100Mb)
    && Number.isFinite(fileSizeBytes)
    && fileSizeBytes < CUSTOM_CATBOX_LIMIT;
  if (forceProxyUnderLimit) return proxyUrl;

  const active = getActiveCatboxDefault();
  return active || proxyUrl;
}

function assertUploadSizeLimit() {
  // Delegated to backend limits now
}

function isCopypartyConfigured(settings) {
  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  return !!cp;
}

async function maybeRemuxVideoForCatboxUpload(file, onProgress, options, settings) {
  if (!file || !options || options.remuxVideo === false) return file;
  if (isCopypartyConfigured(settings)) return file;
  if (typeof window === 'undefined' || typeof window.mmShouldRemuxVideoFileToMp4 !== 'function' || typeof window.mmRemuxVideoFileToMp4 !== 'function') {
    return file;
  }
  let shouldRemux = false;
  try { shouldRemux = window.mmShouldRemuxVideoFileToMp4(file) === true; } catch {}
  if (!shouldRemux) return file;

  const result = await window.mmRemuxVideoFileToMp4(file, {
    onProgress: (info) => {
      if (typeof onProgress !== 'function') return;
      const ratio = Math.max(0, Math.min(1, Number(info && info.ratio) || 0));
      try { onProgress(Math.round(ratio * 100), { stage: 'remuxing' }); } catch {}
    }
  });
  return result && result.file ? result.file : file;
}

// opts: { context?: 'batch'|'manual' }
async function uploadToCatbox(file, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : {};
  const sourceFile = await maybeRemuxVideoForCatboxUpload(file, null, options, settings);
  const uploadFile = withUploadFilename(sourceFile, options);

  const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;

  const uploadUrl = resolveCatboxUploadUrl(settings, {
    fileSizeBytes,
    allowProxy: options.allowProxy !== false,
    forceProxy: options.forceProxy === true
  });

  // Copyparty direct upload path
  if (uploadUrl === '__COPYPARTY__') {
    const cpUrl = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
    const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
    if (!cpUrl) throw new Error('Copyparty upload URL missing in settings');
    if (typeof window.mm_up2k_uploadFile !== 'function') throw new Error('Copyparty up2k client not loaded');
    const subdir = getCopypartySubdir(options);
    const url = await window.mm_up2k_uploadFile({ uploadUrl: cpUrl, pw: cpPw, file: uploadFile, subdir });
    return String(url);
  }

  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', uploadFile);

  let isAnon = (typeof settings.anonymous === 'boolean') ? settings.anonymous : true;
  // Per-flow overrides when master anonymous is enabled
  try {
    const ctx = options.context;
    if (isAnon && ctx === 'batch' && typeof settings.anonymousBatch === 'boolean') isAnon = !!settings.anonymousBatch;
    if (isAnon && ctx === 'manual' && typeof settings.anonymousManual === 'boolean') isAnon = !!settings.anonymousManual;
  } catch {}
  const effectiveUserhash = ((settings.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
  if (!isAnon) {
    form.append('userhash', effectiveUserhash);
  }

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
function uploadToCatboxWithProgressPrepared(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const uploadFile = withUploadFilename(file, options);
    const st = readUploadSettings();
    const settings = st && typeof st === 'object' ? st : { anonymous: true, userhash: '' };
    const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;

    const uploadUrl = resolveCatboxUploadUrl(settings, {
      fileSizeBytes,
      allowProxy: options.allowProxy !== false,
      forceProxy: options.forceProxy === true
    });

    // Copyparty direct upload path (up2k)
    if (uploadUrl === '__COPYPARTY__') {
      const cpUrl = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
      const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
      if (!cpUrl) {
        reject(new Error('Copyparty upload URL missing in settings'));
        return;
      }
      if (typeof window.mm_up2k_uploadFile !== 'function') {
        reject(new Error('Copyparty up2k client not loaded'));
        return;
      }

      if (typeof onProgress === 'function') {
        try { onProgress(0, { loadedBytes: 0, totalBytes: fileSizeBytes || 0, bps: 0 }); } catch {}
      }

      const subdir = getCopypartySubdir(options);
      window.mm_up2k_uploadFile({
        uploadUrl: cpUrl,
        pw: cpPw,
        file: uploadFile,
        subdir,
        signal,
        onProgress: (percent, info) => {
          if (typeof onProgress !== 'function') return;
          try { onProgress(percent, info); } catch {}
        }
      }).then((url) => {
        resolve(String(url));
      }).catch(reject);

      return;
    }

    assertUploadSizeLimit(uploadUrl, fileSizeBytes);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', uploadFile);
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
      let lastMs = 0;
      let lastLoaded = 0;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const dt = lastMs ? Math.max(0.001, (now - lastMs) / 1000) : 0;
          const dBytes = lastMs ? Math.max(0, e.loaded - lastLoaded) : 0;
          const bps = (dt > 0) ? (dBytes / dt) : 0;
          lastMs = now;
          lastLoaded = e.loaded;
          onProgress(percent, { loadedBytes: e.loaded, totalBytes: e.total, bps });
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

function uploadToCatboxWithProgress(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : { anonymous: true, userhash: '' };
  return (async () => {
    const sourceFile = await maybeRemuxVideoForCatboxUpload(file, onProgress, options, settings);
    const nextOptions = Object.assign({}, options, { remuxVideo: false });
    return uploadToCatboxWithProgressPrepared(sourceFile, onProgress, nextOptions);
  })();
}
