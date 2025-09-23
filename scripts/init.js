"use strict";

// Centralized loader so we can reuse for initial param load and manual input without forcing a full page reload.
async function loadSource(rawInput) {
  const rawSrc = (rawInput || '').trim();
  if (!rawSrc) {
    urlInputContainer.style.display = 'flex';
    if (errorMessage) {
      errorMessage.textContent = 'Unfortunately, there was no directory given. Please try again or enter directory below.';
      errorMessage.style.display = 'block';
    }
    return false;
  }

  let srcUrl = '';
  let directJson = null;
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

  if (directJson) {
    srcUrl = '';
    sourceKey = 'inline';
  }
  if (!directJson && /^https?:\/\//i.test(decodedRaw)) {
    srcUrl = decodedRaw;
  } else if (!directJson && (/\.(json)(?:$|[?#])/i.test(decodedRaw) || decodedRaw.toLowerCase().endsWith('.json'))) {
    // Relative json path support
    if (decodedRaw.startsWith('./') || decodedRaw.startsWith('/')) srcUrl = decodedRaw; else srcUrl = `./${decodedRaw}`;
  } else if (!directJson && /^[A-Za-z0-9]{6}$/.test(decodedRaw)) {
    // Catbox 6-char ID
    srcUrl = `https://files.catbox.moe/${decodedRaw}.json`;
  } else if (!directJson) {
    // Fallback – treat as relative json if missing extension
    srcUrl = decodedRaw.endsWith('.json') ? decodedRaw : `./${decodedRaw}.json`;
  }
  if (!directJson) sourceKey = decodedRaw;

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
    return true;
  } catch (err) {
    urlInputContainer.style.display = 'flex';
    if (errorMessage) {
      const msg = (err && err.message) ? err.message : String(err);
      errorMessage.textContent = `Failed to load source. ${msg}`;
      errorMessage.style.display = 'block';
    }
    console.error('Source Load Error:', err);
    return false;
  }
}

async function init() {
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
