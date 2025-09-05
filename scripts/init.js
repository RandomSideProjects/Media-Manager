"use strict";

async function init() {
  const params = new URLSearchParams(window.location.search);
  const hasSourceParam = params.has('source');
  const rawSrc = params.get('source');
  if (folderInput && folderInput.files && folderInput.files.length > 0) {
    return;
  }

  // No source parameter at all: show input UI only, no message
  if (!hasSourceParam) {
    urlInputContainer.style.display = 'flex';
    // No source provided: do not show error message.
    if (typeof errorMessage !== 'undefined' && errorMessage) errorMessage.style.display = 'none';
    if (goBtn) {
      goBtn.addEventListener('click', () => {
        const userURL = urlInput.value.trim();
        if (userURL) {
          const encoded = encodeURIComponent(userURL);
          const currentURL = window.location.origin + window.location.pathname;
          window.location.href = `${currentURL}?source=${encoded}`;
        }
      });
    }
    return;
  }

  // Source param is present but blank (e.g., ?source= or ?source)
  if ((rawSrc ?? '').trim() === '') {
    urlInputContainer.style.display = 'flex';
    if (typeof errorMessage !== 'undefined' && errorMessage) {
      errorMessage.textContent = 'Unfortunately, there was no directory given. Please try again or enter directory below.';
      errorMessage.style.display = 'block';
    }
    return;
  }

  if (
    !/^https?:\/\//i.test(rawSrc) &&
    !/^[A-Za-z0-9]{6}$/.test(rawSrc) &&
    !/\.json/i.test(rawSrc)
  ) {
    // Invalid input: show the generic message and input UI
    urlInputContainer.style.display = 'flex';
    if (typeof errorMessage !== 'undefined' && errorMessage) {
      errorMessage.textContent = 'Unfortunately, there was no directory given. Please try again or enter directory below.';
      errorMessage.style.display = 'block';
    }
    return;
  }

  let srcUrl = '';
  const decodedRaw = decodeURIComponent(rawSrc);
  if (/^https?:\/\//i.test(decodedRaw)) {
    srcUrl = decodedRaw;
  } else if (/\.json/i.test(decodedRaw)) {
    if (decodedRaw.startsWith('./') || decodedRaw.startsWith('/')) {
      srcUrl = decodedRaw;
    } else {
      srcUrl = `./${decodedRaw}`;
    }
  } else if (/^[A-Za-z0-9]{6}$/.test(decodedRaw)) {
    srcUrl = `https://files.catbox.moe/${decodedRaw}.json`;
  } else {
    srcUrl = decodedRaw;
  }
  sourceKey = decodedRaw;
  try {
    const response = await fetch(srcUrl);
    if (!response || !response.ok) {
      throw new Error(`${response ? response.status : 'Network'} error`);
    }
    const json = await response.json();
    const { title: srcTitle, categories } = json;
    if (!Array.isArray(categories)) throw new Error("Unexpected JSON structure: 'categories' must be an array");
    videoList = categories;
    errorMessage.style.display = 'none';
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
    const itemParam = params.get('item') || params.get('?item');
    if (itemParam !== null) {
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
  } catch (err) {
    // Source parameter was provided but unreachable or invalid.
    // Show the generic message and the input UI.
    urlInputContainer.style.display = 'flex';
    if (typeof errorMessage !== 'undefined' && errorMessage) {
      errorMessage.textContent = 'Unfortunately, there was no directory given. Please try again or enter directory below.';
      errorMessage.style.display = 'block';
    }
    console.error("Episode List Error:", err);
  }
}

init();
