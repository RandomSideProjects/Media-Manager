"use strict";

const LEGACY_SOURCE_PREFIX = 'Directorys/Files/';
const LEGACY_SOURCE_REPLACEMENT = 'Sources/Files/';
const LEGACY_SOURCE_PREFIX_LOWER = LEGACY_SOURCE_PREFIX.toLowerCase();

function normalizeLegacySourcePath(rawValue) {
  if (typeof rawValue !== 'string') {
    return { value: rawValue, changed: false };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length < LEGACY_SOURCE_PREFIX.length) {
    return { value: rawValue, changed: false };
  }
  const candidate = trimmed.slice(0, LEGACY_SOURCE_PREFIX.length);
  if (candidate.toLowerCase() !== LEGACY_SOURCE_PREFIX_LOWER) {
    return { value: rawValue, changed: false };
  }
  const suffix = trimmed.slice(LEGACY_SOURCE_PREFIX.length);
  return {
    value: `${LEGACY_SOURCE_REPLACEMENT}${suffix}`,
    changed: true
  };
}

function buildUrlWithSourceValue(value, searchString = window.location.search) {
  try {
    const params = new URLSearchParams(searchString);
    if (value) {
      params.set('source', value);
    } else {
      params.delete('source');
    }
    const basePath = window.location.pathname || '';
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  } catch {
    return null;
  }
}

function attemptLegacySourceRedirect() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const rawSource = params.get('source') || '';
  if (!rawSource.trim()) return false;
  let decoded = rawSource;
  try {
    decoded = decodeURIComponent(rawSource);
  } catch {}
  const normalized = normalizeLegacySourcePath(decoded);
  if (!normalized.changed) return false;
  const newUrl = buildUrlWithSourceValue(normalized.value);
  if (!newUrl) return false;
  window.location.replace(newUrl);
  return true;
}

function setRecentSourcesActive(flag) {
  if (window.RSPRecentSources && typeof window.RSPRecentSources.setSourceActive === 'function') {
    try {
      window.RSPRecentSources.setSourceActive(flag);
    } catch {}
  }
}

// Centralized loader so we can reuse for initial param load and manual input without forcing a full page reload.
async function loadSource(rawInput) {
  const rawSrc = (rawInput || '').trim();
  if (!rawSrc) {
    urlInputContainer.style.display = 'flex';
    if (errorMessage) {
      errorMessage.textContent = 'Unfortunately, there was no directory given. Please try again or enter directory below.';
      errorMessage.style.display = 'block';
    }
    setRecentSourcesActive(false);
    return false;
  }

  let srcUrl = '';
  let directJson = null;
  let keyPrefix = 'remote';
  // Allow encoded sources (we previously encoded in URL param) – decode once.
  let decodedRaw = rawSrc;
  try {
    decodedRaw = decodeURIComponent(rawSrc);
  } catch {
    decodedRaw = rawSrc;
  }
  // New: allow pasting raw JSON or data: URIs directly
  try {
    if (decodedRaw.startsWith('{') || decodedRaw.startsWith('[')) {
      directJson = JSON.parse(decodedRaw);
    } else if (/^data:\s*application\/json/i.test(decodedRaw)) {
      const m = decodedRaw.match(/^data:\s*application\/json(?:;base64)?,(.*)$/i);
      if (m) {
        const isB64 = /;base64,/.test(decodedRaw);
        const payload = isB64 ? atob(m[1]) : decodeURIComponent(m[1]);
        directJson = JSON.parse(payload);
      }
    }
  } catch {}

  const normalizedLegacySource = normalizeLegacySourcePath(decodedRaw);
  if (normalizedLegacySource.changed) {
    decodedRaw = normalizedLegacySource.value;
    if (urlInput) {
      try { urlInput.value = normalizedLegacySource.value; }
      catch {}
    }
    const normalizedUrl = buildUrlWithSourceValue(normalizedLegacySource.value);
    if (normalizedUrl) {
      try { window.history.replaceState(null, '', normalizedUrl); }
      catch {}
    }
  }

  if (directJson) {
    srcUrl = '';
    keyPrefix = 'inline';
    setSourceKey(decodedRaw || 'inline', { prefix: 'inline', aliases: ['inline'] });
  }
  if (!directJson && /^https?:\/\//i.test(decodedRaw)) {
    srcUrl = decodedRaw;
    keyPrefix = 'url';
  } else if (!directJson && (/\.(json)(?:$|[?#])/i.test(decodedRaw) || decodedRaw.toLowerCase().endsWith('.json'))) {
    // Relative json path support
    if (decodedRaw.startsWith('./') || decodedRaw.startsWith('/')) srcUrl = decodedRaw; else srcUrl = `./${decodedRaw}`;
    keyPrefix = 'path';
  } else if (!directJson && /^[A-Za-z0-9]{6}$/.test(decodedRaw)) {
    // Catbox 6-char ID
    srcUrl = `https://files.catbox.moe/${decodedRaw}.json`;
    keyPrefix = 'catbox';
  } else if (!directJson) {
    // Fallback – treat as relative json if missing extension
    srcUrl = decodedRaw.endsWith('.json') ? decodedRaw : `./${decodedRaw}.json`;
    keyPrefix = 'path';
  }
  if (!directJson) {
    const useRawKey = keyPrefix === 'path';
    let keyInput = decodedRaw;
    if (useRawKey) {
      keyInput = keyInput.replace(/^[./\\]+/, '');
      keyInput = keyInput.replace(/\\/g, '/');
    }
    setSourceKey(keyInput, { prefix: keyPrefix, useRawKey });
  }

  try {
    let json = directJson;
    if (!json) {
      const response = await fetch(srcUrl, { cache: 'no-store' });
      if (!response) throw new Error('No response');
      const statusPart = response.status;
      const allowStatus0 = statusPart === 0; // file:// or opaque (CORS) – attempt parse anyway
      if (!response.ok && !allowStatus0) {
        let extra = '';
        if (statusPart === 0) {
          extra = ' (Possible CORS / opaque response)';
        }
        throw new Error(`${statusPart || 'Network'} error${extra}`);
      }
      try { json = await response.json(); }
      catch (e) {
        if (allowStatus0) {
          throw new Error('0 error: Received opaque/local response but could not parse JSON. If using file:// run a local web server (e.g., python -m http.server) so fetch can read the file. ' + (e && e.message ? e.message : e));
        }
        throw new Error('Invalid JSON: ' + (e && e.message ? e.message : e));
      }
    }
    const { title: srcTitle, categories } = json || {};
    if (!Array.isArray(categories)) throw new Error("Unexpected JSON structure: 'categories' must be an array");
    videoList = categories;
    if (errorMessage) errorMessage.style.display = 'none';
    urlInputContainer.style.display = 'none';
    directoryTitle.textContent = srcTitle;
    try { document.title = `${(srcTitle || '').trim() || 'Source'} on RSP Media Manager`; } catch {}
    const imgUrl = (typeof json.Image === 'string' && json.Image !== 'N/A') ? json.Image : (typeof json.image === 'string' && json.image !== 'N/A' ? json.image : '');
    sourceImageUrl = imgUrl || '';
    if (directoryPoster) {
      if (imgUrl) { directoryPoster.src = imgUrl; directoryPoster.style.display = 'inline-block'; }
      else { try { directoryPoster.removeAttribute('src'); } catch {} directoryPoster.style.display = 'none'; }
    }

    if (directoryHeader) directoryHeader.style.display = 'flex';
    directoryTitle.style.display = 'block';
    selectorScreen.style.display = 'flex';
    renderEpisodeList();
    showResumeMessage();
    setRecentSourcesActive(true);
    if (window.RSPRecentSources && typeof window.RSPRecentSources.record === 'function') {
      try {
        let inlinePayload = null;
        if (directJson) {
          inlinePayload = JSON.stringify(directJson);
        }
        window.RSPRecentSources.record(json, {
          sourceKey,
          openValue: directJson ? '' : decodedRaw,
          kind: directJson ? 'inline' : 'remote',
          inlinePayload
        });
      } catch (err) {
        console.warn('[RecentSources] Unable to record remote source', err);
      }
    }
    return true;
  } catch (err) {
    urlInputContainer.style.display = 'flex';
    if (errorMessage) {
      const msg = (err && err.message) ? err.message : String(err);
      errorMessage.textContent = `Failed to load source. ${msg}`;
      errorMessage.style.display = 'block';
    }
    console.error('Source Load Error:', err);
    setRecentSourcesActive(false);
    return false;
  }
}

async function init() {
  if (attemptLegacySourceRedirect()) return;
  const params = new URLSearchParams(window.location.search);
  const paramValue = params.get('source') || '';

  // Wire Go button & Enter key once.
  if (goBtn && !goBtn.dataset.bound) {
    goBtn.dataset.bound = '1';
    const triggerLoad = async () => {
      const userURL = (urlInput && urlInput.value ? urlInput.value : '').trim();
      if (!userURL) { if (errorMessage) { errorMessage.textContent = 'Please enter a source URL / ID / path.'; errorMessage.style.display = 'block'; } return; }
      // Update query param without full reload.
      const basePath = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set('source', encodeURIComponent(userURL));
      window.history.replaceState(null, '', `${basePath}?${searchParams.toString()}`);
      await loadSource(userURL);
    };
    goBtn.addEventListener('click', triggerLoad);
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); triggerLoad(); } });
    }
  }

  // If folder upload already chosen, do nothing (local-folder.js will render)
  if (folderInput && folderInput.files && folderInput.files.length > 0) return;

  if (!paramValue.trim()) {
    // Show empty input UI
    urlInputContainer.style.display = 'flex';
    if (errorMessage) errorMessage.style.display = 'none';
    setRecentSourcesActive(false);
    return;
  }

  // Param exists, attempt to load (it may already be percent-encoded twice; decode once for display convenience)
  if (urlInput) {
    try { urlInput.value = decodeURIComponent(paramValue); } catch { urlInput.value = paramValue; }
  }
  await loadSource(paramValue);

  // If item param present and list ready, player.js will handle navigation after list built. We re-run logic here to ensure direct deep link works.
  const itemParam = params.get('item') || params.get('?item');
  if (itemParam !== null && flatList.length > 0) {
    const itemIndex = parseInt(itemParam, 10) - 1;
    if (!isNaN(itemIndex) && itemIndex >= 0 && itemIndex < flatList.length) {
      currentIndex = itemIndex;
      selectorScreen.style.display = 'none';
      playerScreen.style.display = 'block';
      backBtn.style.display = 'inline-block';
      theaterBtn.style.display = 'inline-block';
      loadVideo(currentIndex);
    }
  }
}

init();
