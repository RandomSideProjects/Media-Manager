"use strict";

// Variables (top)
const UPLOADER_CATBOX_BACKEND_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const CUSTOM_CATBOX_LIMIT = 104857600;
const DIRECT_CATBOX_UPLOAD_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';

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

function resolveCatboxUploadUrl(settings, { fileSizeBytes, allowProxy = true } = {}) {
  const raw = settings && typeof settings.catboxUploadUrl === 'string' ? settings.catboxUploadUrl.trim() : '';

  const cp = settings && typeof settings.copypartyUploadUrl === 'string' ? settings.copypartyUploadUrl.trim() : '';
  const cpPw = settings && typeof settings.copypartyPw === 'string' ? settings.copypartyPw : '';
  const thresholdMbRaw = (settings && Number.isFinite(parseFloat(settings.copypartyThresholdMb))) ? parseFloat(settings.copypartyThresholdMb) : 100;
  const thresholdMb = Math.max(6, Math.min(100, thresholdMbRaw)); // enforce 5 < x <= 100
  const canUseCopyparty = !!cp;

  const CP_THRESHOLD = thresholdMb * 1024 * 1024;
  const shouldUseCopyparty = canUseCopyparty && Number.isFinite(fileSizeBytes) && fileSizeBytes >= CP_THRESHOLD;

  // Per request: stop using direct Catbox; ALL Catbox uploads go via the worker/proxy URL.
  // We still allow a custom proxy URL, but only if it is actually a proxy.
  const proxyUrl = (raw && isProxyCatboxUrl(raw)) ? raw : getActiveCatboxDefault();

  if (shouldUseCopyparty) return '__COPYPARTY__';

  // Ignore allowProxy; always return proxyUrl for Catbox
  return proxyUrl;
}

function assertUploadSizeLimit() {
  // Delegated to backend limits now
}

function shouldForceCatboxProxyForFile(file) {
  try {
    const type = (file && typeof file.type === 'string') ? file.type.toLowerCase() : '';
    const name = (file && typeof file.name === 'string') ? file.name.toLowerCase() : '';
    // Always send images + json through the worker/proxy
    if (type.startsWith('image/')) return true;
    if (type === 'application/json' || type.endsWith('+json')) return true;
    if (name.endsWith('.json')) return true;
    if (name.endsWith('.webp') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif')) return true;
  } catch {}
  return false;
}

// opts: { context?: 'batch'|'manual' }
async function uploadToCatbox(file, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const uploadFile = withUploadFilename(file, options);

  // Pull current settings; anonymous defaults to true
  const st = readUploadSettings();
  const settings = st && typeof st === 'object' ? st : {};

  const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;

  const forceProxyByType = shouldForceCatboxProxyForFile(uploadFile);
  const uploadUrl = forceProxyByType
    ? getActiveCatboxDefault()
    : resolveCatboxUploadUrl(settings, { fileSizeBytes, allowProxy: options.allowProxy !== false });

  // Copyparty direct upload path
  if (!forceProxyByType && uploadUrl === '__COPYPARTY__') {
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
function uploadToCatboxWithProgress(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    const uploadFile = withUploadFilename(file, options);
    const st = readUploadSettings();
    const settings = st && typeof st === 'object' ? st : { anonymous: true, userhash: '' };
    const fileSizeBytes = uploadFile && typeof uploadFile.size === 'number' ? uploadFile.size : undefined;

    const forceProxyByType = shouldForceCatboxProxyForFile(uploadFile);
    const uploadUrl = forceProxyByType
      ? getActiveCatboxDefault()
      : resolveCatboxUploadUrl(settings, { fileSizeBytes, allowProxy: options.allowProxy !== false });

    // Copyparty direct upload path (up2k)
    if (!forceProxyByType && uploadUrl === '__COPYPARTY__') {
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

// Archive.org IAS3 upload logic -- yes, I know im exposing keys client-side, but it's 1am in the morning and im not spending more time on this.
// plz dont upload anything illegal to these keys
// yes, you
// seriously
// 🙏🙏🙏
// ps normalize using emojis in code, very cool.
const ARCHIVE_ORG_ACCESS_KEY = "1hZkfAqBbnVIXS6Y";
const ARCHIVE_ORG_SECRET_KEY = "hoXj3StnmOSSj2rn";

function mmConfirmArchiveInstead(message, options = {}) {
  const escapeHtml = (value) => {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const title = (options && typeof options.title === 'string' && options.title.trim())
    ? options.title.trim()
    : 'Archive.org Upload';
  const yesLabel = (options && typeof options.yesLabel === 'string' && options.yesLabel.trim())
    ? options.yesLabel.trim()
    : 'Yes, upload to Archive.org';
  const noLabel = (options && typeof options.noLabel === 'string' && options.noLabel.trim())
    ? options.noLabel.trim()
    : 'No';

  let mainMessage = String(message || '');
  let subtitle = (options && typeof options.subtitle === 'string') ? options.subtitle : null;
  if (!subtitle) {
    const idx = mainMessage.indexOf(' Please note');
    if (idx > 0) {
      subtitle = mainMessage.slice(idx + 1).trim();
      mainMessage = mainMessage.slice(0, idx).trim();
    }
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finalize = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(!!value);
    };

    if (typeof window === 'undefined') {
      finalize(false);
      return;
    }

    try {
      const st = readUploadSettings();
      const autoAccept = st && typeof st.autoArchiveOversize === 'boolean' ? st.autoArchiveOversize : false;
      if (autoAccept) {
        finalize(true);
        return;
      }
    } catch {}

    if (typeof window.showStorageNotice !== 'function') {
      try {
        const combined = subtitle ? `${mainMessage}\n\n${subtitle}` : mainMessage;
        finalize(!!window.confirm(String(combined || 'Upload to Archive.org instead?')));
      } catch {
        finalize(false);
      }
      return;
    }

    try {
      const combinedHtml = subtitle
        ? `${escapeHtml(mainMessage)}<div style="margin-top:.35em; font-size:0.92em; opacity:0.9;">${escapeHtml(subtitle)}</div>`
        : null;
      window.showStorageNotice({
        title,
        message: combinedHtml ? '' : String(mainMessage || ''),
        messageHtml: combinedHtml,
        tone: 'warning',
        autoCloseMs: null,
        persistent: true,
        actions: [
          {
            label: yesLabel,
            onClick: () => finalize(true),
            closeOnClick: true
          }
        ],
        dismissLabel: noLabel,
        onClose: () => finalize(false)
      });
    } catch {
      try {
        const combined = subtitle ? `${mainMessage}\n\n${subtitle}` : mainMessage;
        finalize(!!window.confirm(String(combined || 'Upload to Archive.org instead?')));
      } catch {
        finalize(false);
      }
    }
  });
}

function generateArchiveIdentifier() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `upload-${ts}-${rand}`;
}

function generateArchiveTitle() {
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `RSPMM Upload ${rand}`;
}

function uploadToArchiveOrgWithProgress(file, onProgress, opts) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Missing file'));
      return;
    }

    const identifier = generateArchiveIdentifier();
    const fileName = (file && file.name) ? String(file.name) : 'upload.bin';

    const headers = {
      "Authorization": `LOW ${ARCHIVE_ORG_ACCESS_KEY}:${ARCHIVE_ORG_SECRET_KEY}`,
      "Content-Type": "application/octet-stream",
      "x-archive-auto-make-bucket": "1",
      "x-archive-meta-title": generateArchiveTitle(),
      "x-archive-meta01-collection": "opensource",
    };

    const putUrl = `https://s3.us.archive.org/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', putUrl, true);
    for (const [k, v] of Object.entries(headers)) {
      try { xhr.setRequestHeader(k, v); } catch {}
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

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok) {
        finalizeReject(new Error(`Archive.org upload failed (HTTP ${xhr.status}): ${xhr.responseText || ''}`.trim()));
        return;
      }
      finalizeResolve({
        identifier,
        detailsUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
        downloadUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`,
        putUrl,
      });
    };

    xhr.onerror = () => finalizeReject(new Error('Network error'));
    xhr.send(file);
  });
}

if (typeof window !== 'undefined') {
  window.mmConfirmArchiveInstead = mmConfirmArchiveInstead;
  window.uploadToArchiveOrgWithProgress = uploadToArchiveOrgWithProgress;
}
