"use strict";

// Variables (top)
// none

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

async function checkHostAndLoadCreator() {
  let statusBox = document.getElementById('serverStatusBox');
  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.id = 'serverStatusBox';
    document.body.appendChild(statusBox);
  }

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
  let paheStatusLine = '';

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
  } else {
    try {
      window.MM_PAHE_API_OK = false;
      window.dispatchEvent(new CustomEvent('mm:pahe-api-status', { detail: { ok: false, line: 'disabled' } }));
    } catch {}
  }

  applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, { source: 'startup-default' });
  const overrideMode = getCatboxOverrideMode();
  let endpointLabel = 'proxy';
  if (overrideMode === 'direct') {
    endpointLabel = 'direct (override)';
  } else if (overrideMode === 'proxy') {
    endpointLabel = 'proxy (override)';
  }

  const paheLineFinal = paheEnabled ? (paheStatusLine || 'pending') : 'disabled';
  statusBox.textContent = `Pahe API: ${paheLineFinal}\nCatbox uploads via: ${endpointLabel}`;
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
