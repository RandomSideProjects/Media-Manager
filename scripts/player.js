"use strict";

function loadVideo(index) {
  const item = flatList[index];
  try {
    const sourceTitleText = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
    const itemTitleText = (item && item.title) ? item.title : 'Item';
    document.title = `${sourceTitleText} | ${itemTitleText} on RSP Media Manager`;
  } catch {}

  if (item && item.isPlaceholder) {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch {}
      video.style.display = 'none';
    }
    if (theaterBtn) theaterBtn.style.display = 'none';
    showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
  } else {
    if (placeholderNotice) placeholderNotice.style.display = 'none';
    if (video) {
      video.style.display = '';
      video.src = item.src;
      video.addEventListener('loadedmetadata', function onMeta() {
        localStorage.setItem(video.src + ':duration', video.duration);
        video.removeEventListener('loadedmetadata', onMeta);
      });
      function onVideoError() {
        try { video.pause(); } catch {}
        video.style.display = 'none';
        showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
        video.removeEventListener('error', onVideoError);
      }
      video.addEventListener('error', onVideoError);
      const savedTime = localStorage.getItem(video.src);
      if (savedTime) video.currentTime = parseFloat(savedTime);
    }
    if (theaterBtn) theaterBtn.style.display = 'inline-block';
  }
  title.textContent = item.title;
  nextBtn.style.display = "none";
  if (!item.isPlaceholder) { video.load(); video.play(); }
  const params = new URLSearchParams(window.location.search);
  params.set('item', index + 1);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function showPlayerAlert(message) {
  let overlay = document.getElementById('playerFailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'playerFailOverlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10050,
      color: '#ffffff', textAlign: 'center'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #333',
      borderRadius: '12px', padding: '1em 1.25em', maxWidth: '680px', boxShadow: '0 12px 30px rgba(0,0,0,0.5)'
    });
    const p = document.createElement('div'); p.style.whiteSpace = 'pre-line'; p.style.fontWeight = '800'; p.style.fontSize = '1.1rem'; p.id = 'playerFailMessage';
    const btn = document.createElement('button'); btn.textContent = 'Close'; btn.className = 'pill-button'; btn.style.marginTop = '10px';
    btn.addEventListener('click', () => { try { overlay.remove(); } catch {} });
    box.append(p, btn); overlay.appendChild(box); document.body.appendChild(overlay);
  }
  const msgEl = document.getElementById('playerFailMessage');
  if (msgEl) msgEl.textContent = message;
}

if (video) {
  video.addEventListener("timeupdate", () => {
    if (video.currentTime / video.duration > 0.9 && currentIndex < flatList.length - 1) {
      nextBtn.style.display = "inline-block";
    }
    localStorage.setItem(video.src, video.currentTime);
  });
  video.addEventListener("ended", () => {
    localStorage.removeItem(video.src);
    if (currentIndex < flatList.length - 1) { nextBtn.click(); }
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    if (currentIndex < flatList.length - 1) {
      currentIndex++;
      loadVideo(currentIndex);
    }
  });
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    video.pause();
    playerScreen.style.display = "none";
    selectorScreen.style.display = "flex";
    backBtn.style.display = "none";
    theaterBtn.style.display = "none";
    document.body.classList.remove("theater-mode");
    try {
      const st = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
      document.title = `${st} on RSP Media Manager`;
    } catch {}
    renderEpisodeList();
    const params = new URLSearchParams(window.location.search);
    params.delete('item'); params.delete('?item');
    const query = params.toString();
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  });
}

