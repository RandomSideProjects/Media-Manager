"use strict";

// Variables (top)
// none

function showHostFailure(container, codeText) {
  const codeDisplay = typeof codeText === 'undefined' || codeText === null ? 'Unknown' : String(codeText);
  const resume = () => {
    window.MM_BLOCKED = false;
    if (typeof startAutoUploadPolling === 'function' && !window.MM_POLL_TIMER) {
      startAutoUploadPolling();
    }
    const ov = document.getElementById('serverFailOverlay');
    if (ov) ov.remove();
  };

  window.MM_BLOCKED = true;

  if (typeof window.showStorageNotice === 'function') {
    window.showStorageNotice({
      title: 'Source Host Offline',
      message: `Unfortunately, our public source host is currently unavailable.\nPlease try again.\nHTTP Code: ${codeDisplay}`,
      tone: 'error',
      autoCloseMs: null,
      copyText: codeDisplay,
      copyLabel: 'Copy code',
      dismissLabel: 'Continue',
      onClose: resume
    });
    return;
  }

  let overlay = document.getElementById('serverFailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'serverFailOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.zIndex = '10050';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.innerHTML = `
      <div style="background:#1a1a1a; color:#f1f1f1; border:1px solid #333; border-radius:12px; padding:18px 22px; max-width:720px; width:92%; text-align:center; box-shadow:0 16px 40px rgba(0,0,0,.6);">
        <div style="font-weight:800; font-size:1.25rem; line-height:1.35; white-space:pre-line;">
          Unfortunately, our public source host is currently unavailable.\nPlease try again.
        </div>
        <div style="margin-top:10px;">
          <code style="background:#000; display:inline-block; padding:0.6em 0.8em; border-radius:8px; color:#fff;">HTTP Code : ${codeDisplay}</code>
        </div>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center;">
          <button id="serverContinueBtn" style="padding:8px 14px; border:none; border-radius:8px; background:#007bff; color:#fff; cursor:pointer;">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    const codeEl = overlay.querySelector('code');
    if (codeEl) codeEl.textContent = `HTTP Code : ${codeDisplay}`;
  }

  const btn = document.getElementById('serverContinueBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', resume);
  }
}

const CATBOX_DIRECT_UPLOAD_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const CATBOX_PROXY_UPLOAD_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
const SERVER_DEFAULT_PAHE_ANIME_API_BASE = 'https://anime.apex-cloud.workers.dev';

if (typeof window !== 'undefined') {
  window.MM_PROXY_CATBOX_UPLOAD_URL = CATBOX_PROXY_UPLOAD_URL;
}

(function bootstrapCatboxOverride() {
  if (typeof window === 'undefined') return;
  if (typeof window.MM_CATBOX_OVERRIDE_MODE === 'string' && window.MM_CATBOX_OVERRIDE_MODE.trim()) return;
  try {
    const raw = localStorage.getItem('mm_upload_settings');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const mode = parsed && typeof parsed.catboxOverrideMode === 'string' ? parsed.catboxOverrideMode.trim().toLowerCase() : '';
    if (mode === 'direct') {
      window.MM_CATBOX_OVERRIDE_MODE = 'direct';
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = CATBOX_DIRECT_UPLOAD_URL;
    } else if (mode === 'proxy') {
      window.MM_CATBOX_OVERRIDE_MODE = 'proxy';
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = CATBOX_PROXY_UPLOAD_URL;
    }
  } catch {}
})();

function getCatboxOverrideMode() {
  if (typeof window === 'undefined') return 'auto';
  const raw = (window.MM_CATBOX_OVERRIDE_MODE || '').toString().trim().toLowerCase();
  return raw === 'direct' || raw === 'proxy' ? raw : 'auto';
}

async function performUploadProbe(targetUrl, options = {}) {
  try {
    const blob = new Blob(['Upload Test'], { type: 'text/plain' });
    const file = new File([blob], 'UploadTestFile.txt', { type: 'text/plain' });
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', file);

    const response = await fetch(targetUrl, {
      method: 'POST',
      body: form,
      credentials: 'omit'
    });

    if (!response || !response.ok) {
      console.warn('[Creator] Upload probe received non-OK response', { targetUrl, status: response ? response.status : 'no-response' });
      return false;
    }

    const text = await response.text();
    const trimmed = typeof text === 'string' ? text.trim() : '';
    const ok = trimmed.length > 0;

    console.info('[Creator] Upload probe result', { targetUrl, ok, status: response.status, body: trimmed.slice(0, 120) });

    if (!ok && options.onSoftFail) {
      options.onSoftFail(trimmed);
    }
    return ok;
  } catch (err) {
    if (options.onError) options.onError(err);
    console.error('[Creator] Upload probe error', { targetUrl, error: err });
    return false;
  }
}

async function probeCatboxUpload() {
  let lastError = null;
  let lastResponse = '';
  const directOk = await performUploadProbe(CATBOX_DIRECT_UPLOAD_URL, {
    onSoftFail: (body) => { lastResponse = body; },
    onError: (err) => { lastError = err; }
  });
  return { ok: directOk, error: lastError, body: lastResponse };
}

function applyCatboxDefault(url, meta) {
  try {
    let clean = (typeof url === 'string' && url.trim()) ? url.trim() : CATBOX_DIRECT_UPLOAD_URL;
    const previous = (typeof window !== 'undefined' && typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === 'string')
      ? window.MM_DEFAULT_CATBOX_UPLOAD_URL
      : undefined;
    const overrideMode = getCatboxOverrideMode();
    const detailMeta = (meta && typeof meta === 'object') ? { ...meta } : {};

    if (overrideMode === 'direct') {
      clean = CATBOX_DIRECT_UPLOAD_URL;
      detailMeta.override = 'direct';
    } else if (overrideMode === 'proxy') {
      clean = CATBOX_PROXY_UPLOAD_URL;
      detailMeta.override = 'proxy';
    }

    window.MM_DEFAULT_CATBOX_UPLOAD_URL = clean;
    if (typeof window !== 'undefined') {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = clean;
    }
    window.dispatchEvent(new CustomEvent('rsp:catbox-default-updated', { detail: { url: clean, previous, meta: detailMeta } }));
  } catch (err) {
    console.error('[Creator] Failed to apply Catbox default URL', err);
  }
}

async function determineCatboxUploadEndpoint() {
  return { endpoint: 'pending' };
}

function logCatboxUnavailable(info) {
  const parts = ['[Creator] Catbox uploads unavailable.'];
  try {
    const directErr = info && info.directResult && (info.directResult.error || info.directResult.body);
    const proxyErr = info && info.proxyResult && (info.proxyResult.error || info.proxyResult.body);
    if (directErr) parts.push(`Direct: ${directErr instanceof Error ? directErr.message : String(directErr)}`);
    if (proxyErr) parts.push(`Proxy: ${proxyErr instanceof Error ? proxyErr.message : String(proxyErr)}`);
  } catch {}
  console.error(parts.join(' '));
}

async function checkHostAndLoadCreator() {
  const container = document.querySelector('.container') || document.body;
  // Create status box (hidden until success)
  let statusBox = document.getElementById('serverStatusBox');
  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.id = 'serverStatusBox';
    document.body.appendChild(statusBox);
  }

  // Create loading box
  let checkBox = document.getElementById('serverCheckBox');
  if (!checkBox) {
    checkBox = document.createElement('div');
    checkBox.id = 'serverCheckBox';
    checkBox.innerHTML = `
      <div class="spinner" aria-hidden="true"></div>
      <div class="serverCheckText" id="serverCheckText">Checking if server is responsive\nTime Elapsed : 00:00</div>
    `;
    document.body.appendChild(checkBox);
  }
  const checkText = document.getElementById('serverCheckText');
  checkBox.style.display = 'flex';

  const started = Date.now();
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  const readPaheEnabled = () => {
    try {
      const raw = localStorage.getItem('mm_upload_settings') || '{}';
      const parsed = JSON.parse(raw);
      return parsed && parsed.paheImportEnabled === true;
    } catch {
      return false;
    }
  };

  const paheEnabled = readPaheEnabled();
  const tick = () => {
    if (checkText) {
      const mainLine = mainStatusLine ? `Main: ${mainStatusLine}` : 'Main: pending';
      const paheLine = paheEnabled
        ? (paheStatusLine ? `Pahe API: ${paheStatusLine}` : 'Pahe API: pending')
        : 'Pahe API: disabled';
      checkText.textContent = `Checking if server is responsive\n${mainLine}\n${paheLine}\nTime Elapsed : ${fmt(Date.now() - started)}`;
    }
  };
  let mainStatusLine = '';
  let paheStatusLine = '';
  tick();
  const timer = setInterval(tick, 250);

  const stop = () => {
    clearInterval(timer);
    if (checkBox) checkBox.remove();
  };

  let resp;
  try {
    resp = await fetch(STATUS_URL, { cache: 'no-store' });
  } catch (err) {
    stop();
    showHostFailure(container, err && err.message ? err.message : 'Network error');
    return;
  }

  if (!resp || !resp.ok) {
    const codeText = resp ? `${resp.status} ${resp.statusText || ''}`.trim() : 'Unknown error';
    stop();
    showHostFailure(container, codeText);
    return;
  }
  mainStatusLine = `${resp.status} ${resp.statusText || 'OK'}`.trim();
  tick();

  const readPaheApiBase = () => {
    try {
      const raw = localStorage.getItem('mm_upload_settings') || '{}';
      const parsed = JSON.parse(raw);
      const candidate = parsed && typeof parsed.paheAnimeApiBase === 'string' ? parsed.paheAnimeApiBase.trim() : '';
      return (candidate || SERVER_DEFAULT_PAHE_ANIME_API_BASE).replace(/\/+$/, '');
    } catch {
      return SERVER_DEFAULT_PAHE_ANIME_API_BASE;
    }
  };

  const probePaheSearchApi = async () => {
    const base = readPaheApiBase();
    const url = `${base}/?method=search&query=naruto`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res && res.ok) {
        return { ok: true, status: res.status, statusText: res.statusText || 'OK' };
      }
      return { ok: false, status: res ? res.status : 0, statusText: res ? (res.statusText || 'Error') : 'Network error' };
    } catch (err) {
      return { ok: false, status: 0, statusText: (err && err.message) ? err.message : 'Network error' };
    }
  };

  if (paheEnabled) {
    const paheProbe = await probePaheSearchApi();
    const ok = !!(paheProbe && paheProbe.ok);
    if (paheProbe && paheProbe.ok) {
      paheStatusLine = `${paheProbe.status} ${paheProbe.statusText}`.trim();
    } else if (paheProbe) {
      paheStatusLine = `${paheProbe.status || 'ERR'} ${paheProbe.statusText || 'Error'}`.trim();
    } else {
      paheStatusLine = 'ERR';
    }
    try {
      window.MM_PAHE_API_OK = ok;
      window.dispatchEvent(new CustomEvent('mm:pahe-api-status', { detail: { ok, line: paheStatusLine } }));
    } catch {}
    tick();
  } else {
    try {
      window.MM_PAHE_API_OK = false;
      window.dispatchEvent(new CustomEvent('mm:pahe-api-status', { detail: { ok: false, line: 'disabled' } }));
    } catch {}
  }

  let endpointInfo = { endpoint: 'direct' };
  let directResult = null;
  let proxySuccess = false;
  let proxyError = null;
  let proxyBody = '';

  try {
    directResult = await probeCatboxUpload();
    if (directResult && directResult.ok) {
      applyCatboxDefault(CATBOX_DIRECT_UPLOAD_URL, { source: 'direct' });
      endpointInfo = { endpoint: 'direct', directResult };
    } else {
      const proxyOk = await performUploadProbe(CATBOX_PROXY_UPLOAD_URL, {
        onSoftFail: (body) => { proxyBody = body; },
        onError: (err) => { proxyError = err; }
      });
      proxySuccess = proxyOk;

      if (proxyOk) {
        applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, { source: 'proxy', directResult });
        endpointInfo = {
          endpoint: 'proxy',
          directResult,
          proxyResult: { ok: true }
        };
      } else {
        endpointInfo = {
          endpoint: 'unavailable',
          directResult,
          proxyResult: { ok: false, error: proxyError, body: proxyBody }
        };
      }
    }
  } catch (err) {
    console.warn('[Creator] Catbox endpoint probe failed', err);
    endpointInfo = {
      endpoint: 'unavailable',
      directResult,
      proxyResult: { ok: false, error: err }
    };
  }

  if (endpointInfo.endpoint === 'unavailable') {
    applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, {
      source: 'unavailable',
      directResult,
      proxyResult: { ok: false, error: proxyError, body: proxyBody }
    });
  }

  // Success path: show status code box and continue
  stop();
  if (endpointInfo.endpoint === 'unavailable') {
    stop();
    logCatboxUnavailable(endpointInfo);
    showHostFailure(container, 'both upload methods failed, creator may not work as intended');
    return;
  }

  const overrideMode = getCatboxOverrideMode();
  let endpointLabel = endpointInfo.endpoint;
  if (overrideMode === 'direct') {
    endpointLabel = 'direct (override)';
  } else if (overrideMode === 'proxy') {
    endpointLabel = 'proxy (override)';
  }

  stop();
  const paheLineFinal = paheEnabled ? (paheStatusLine || 'pending') : 'disabled';
  statusBox.textContent = `Main: ${mainStatusLine || `${resp.status} ${resp.statusText || 'OK'}`.trim()}\nPahe API: ${paheLineFinal}\nCatbox uploads via: ${endpointLabel}`;
  statusBox.style.display = 'block';

  try {
    window.MM_BLOCKED = false;
    if (typeof startAutoUploadPolling === 'function') {
      startAutoUploadPolling();
    }
  } catch (err) {
    console.warn('[Creator] Failed to enable auto-upload polling', err);
  }
}

// Run on load
checkHostAndLoadCreator();
