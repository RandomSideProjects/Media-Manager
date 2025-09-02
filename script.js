// script.js
let videoList = [];
let sourceKey = '';
let flatList = [];
let currentIndex = 0;
let sourceImageUrl = '';

// Format seconds as H:MM:SS or M:SS
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Format bytes to human-readable string
function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = num;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

// Decimal formatter: choose the largest unit whose value is >= 1 (base 1000)
function formatBytesDecimalMaxUnit(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const base = 1000;
  let i = 0; let v = num;
  while (v >= base && i < units.length - 1) { v /= base; i++; }
  // Ensure chosen unit has value >= 1; if v < 1 and i > 0, step back
  if (v < 1 && i > 0) { v *= base; i -= 1; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}



const video = document.getElementById("videoPlayer");
const spinner = document.getElementById("loadingSpinner");
video.addEventListener("loadstart", () => { spinner.style.display = "block"; });
video.addEventListener("waiting", () => { spinner.style.display = "block"; });
video.addEventListener("canplay", () => { spinner.style.display = "none"; });
video.addEventListener("playing", () => { spinner.style.display = "none"; });
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'popoutTime') {
    try {
      video.currentTime = e.data.currentTime;
    } catch {}
  }
});
const title = document.getElementById("videoTitle");
const nextBtn = document.getElementById("nextBtn");
const selectorScreen = document.getElementById("selectorScreen");
const playerScreen = document.getElementById("playerScreen");
const episodeList = document.getElementById("episodeList");
const urlInputContainer = document.getElementById("urlInputContainer");
const urlInput = document.getElementById("urlInput");
const goBtn = document.getElementById("goBtn");
const errorMessage = document.getElementById("errorMessage");
const directoryHeader = document.getElementById("directoryHeader");
const directoryPoster = document.getElementById("directoryPoster");
const directoryTitle = document.getElementById("directoryTitle");
const backBtn = document.getElementById("backBtn");
const theaterBtn = document.getElementById("theaterBtn");
const placeholderNotice = document.getElementById('placeholderNotice');
theaterBtn.addEventListener("click", () => {
  video.pause();
  const src = video.src;
  const currentTime = video.currentTime || 0;
  const pop = window.open('', '_blank', 'width=800,height=450');
  pop.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Pop-out Player</title>
      <style>
        body { margin: 0; background: black; }
        video { width: 100%; height: 100vh; }
        #popSpinner {
          display: none;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          border: 4px solid rgba(255,255,255,0.3);
          border-top: 4px solid #007bff;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          z-index: 1000;
        }
        @keyframes spin {
          to { transform: translate(-50%, -50%) rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div id="popSpinner" class="spinner"></div>
      <video id="popVideo" src="${src}" controls autoplay></video>
      <script>
        const v = document.getElementById('popVideo');
        const popSpinner = document.getElementById('popSpinner');
        v.addEventListener('loadstart', () => { popSpinner.style.display = 'block'; });
        v.addEventListener('waiting', () => { popSpinner.style.display = 'block'; });
        v.addEventListener('canplay', () => { popSpinner.style.display = 'none'; });
        v.addEventListener('playing', () => { popSpinner.style.display = 'none'; });
        popSpinner.style.display = 'block';
        v.currentTime = ${currentTime};
        window.addEventListener('beforeunload', () => {
          window.opener.postMessage(
            { type: 'popoutTime', currentTime: v.currentTime },
            '*'
          );
        });
      <\/script>
    </body>
    </html>
  `);
});
const folderInput = document.getElementById("folderInput");
folderInput.addEventListener("change", handleFolderUpload);

function renderEpisodeList() {
  episodeList.innerHTML = '';
  flatList = [];
  videoList.forEach(category => {
    const catTitle = document.createElement("div");
    catTitle.className = "category-title";
    catTitle.textContent = category.category;
    episodeList.appendChild(catTitle);

    category.episodes.forEach(episode => {
      const index = flatList.length;
      flatList.push(episode);

      const button = document.createElement("button");
      button.className = "episode-button";
      // Left: title
      const left = document.createElement('span');
      left.textContent = episode.title;
      // Right: meta (watched/duration)
      const right = document.createElement('span');
      right.className = 'episode-meta';
      // Determine duration and watched time
      let durationSec = Number.isFinite(Number(episode.durationSeconds)) ? Number(episode.durationSeconds) : NaN;
      if (!Number.isFinite(durationSec)) {
        const lsDur = parseFloat(localStorage.getItem((episode.src || '') + ':duration'));
        if (Number.isFinite(lsDur)) durationSec = Math.round(lsDur);
      }
      const watched = parseFloat(localStorage.getItem(episode.src || ''));
      const hasWatched = Number.isFinite(watched) && watched > 0;
      if (Number.isFinite(durationSec) && durationSec > 0) {
        right.textContent = hasWatched ? `${formatTime(watched)} / ${formatTime(durationSec)}` : `${formatTime(durationSec)}`;
      } else if (hasWatched) {
        // Fallback: show watched only if started
        right.textContent = `${formatTime(watched)}`;
      } else {
        right.textContent = '';
      }
      button.append(left, right);
      button.addEventListener("click", () => {
        // Remember which episode was last opened
        localStorage.setItem('lastEpSrc', episode.src);
        // Save index per source
        localStorage.setItem(`${sourceKey}:SavedItem`, index);
        currentIndex = index;
        selectorScreen.style.display = "none";
        playerScreen.style.display = "block";
        backBtn.style.display = "inline-block";
        theaterBtn.style.display = "inline-block";
        loadVideo(currentIndex);
      });
      episodeList.appendChild(button);
    });
  });
}

function loadVideo(index) {
  const item = flatList[index];
  // Update browser tab title to include source and item
  try {
    const sourceTitleText = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
    const itemTitleText = (item && item.title) ? item.title : 'Item';
    document.title = `${sourceTitleText} | ${itemTitleText} on RSP Media Manager`;
  } catch {}
  // Handle placeholder episodes (not downloaded)
  if (item && item.isPlaceholder) {
    // Hide actual video player, show custom alert overlay
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch {}
      video.style.display = 'none';
    }
    if (theaterBtn) theaterBtn.style.display = 'none';
    showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
  } else {
    // Normal playback
    if (placeholderNotice) placeholderNotice.style.display = 'none';
    if (video) {
      video.style.display = '';
      video.src = item.src;
      video.addEventListener('loadedmetadata', function onMeta() {
        localStorage.setItem(video.src + ':duration', video.duration);
        video.removeEventListener('loadedmetadata', onMeta);
      });
      // Show custom alert if the player cannot load the file
      function onVideoError() {
        try { video.pause(); } catch {}
        video.style.display = 'none';
        showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
        video.removeEventListener('error', onVideoError);
      }
      video.addEventListener('error', onVideoError);
      const savedTime = localStorage.getItem(video.src);
      if (savedTime) {
        video.currentTime = parseFloat(savedTime);
      }
    }
    if (theaterBtn) theaterBtn.style.display = 'inline-block';
  }
  title.textContent = item.title;
  nextBtn.style.display = "none";
  if (!item.isPlaceholder) {
    video.load();
    video.play();
  }
  // Update the URL to reflect the current episode index
  const params = new URLSearchParams(window.location.search);
  // Preserve or update existing 'item' key if present, otherwise set it
  if (params.has('item')) {
    params.set('item', index + 1);
  } else {
    params.set('item', index + 1);
  }
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

// Custom alert overlay used by player errors and placeholders
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

video.addEventListener("timeupdate", () => {
  if (video.currentTime / video.duration > 0.9 && currentIndex < flatList.length - 1) {
    nextBtn.style.display = "inline-block";
  }
  localStorage.setItem(video.src, video.currentTime);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < flatList.length - 1) {
    currentIndex++;
    loadVideo(currentIndex);
  }
});

video.addEventListener("ended", () => {
  localStorage.removeItem(video.src);
  if (currentIndex < flatList.length - 1) {
    nextBtn.click();
  }
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  const rawSrc = params.get('source');
  if (folderInput.files.length > 0) {
    // Folder was selected, ignore URL init
    return;
  }

  if (!rawSrc) {
    urlInputContainer.style.display = 'flex';
    goBtn.addEventListener('click', () => {
      const userURL = urlInput.value.trim();
      if (userURL) {
        const encoded = encodeURIComponent(userURL);
        const currentURL = window.location.origin + window.location.pathname;
        window.location.href = `${currentURL}?source=${encoded}`;
      }
    });
    return;
  }
  // Validate source: allow full URLs, 6-char alphanumeric codes, or any string containing .json
  if (
    !/^https?:\/\//i.test(rawSrc) &&
    !/^[A-Za-z0-9]{6}$/.test(rawSrc) &&
    !/\.json/i.test(rawSrc)
  ) {
    errorMessage.textContent = 'Invalid source. Please enter a URL, a 6-character code, or a .json filename.';
    errorMessage.style.display = 'block';
    return;
  }
  // Construct the full source URL:
  let srcUrl = '';
  const decodedRaw = decodeURIComponent(rawSrc);
  if (/^https?:\/\//i.test(decodedRaw)) {
    // Full URL provided
    srcUrl = decodedRaw;
  } else if (/\.json/i.test(decodedRaw)) {
    // Local JSON file path
    if (decodedRaw.startsWith('./') || decodedRaw.startsWith('/')) {
      srcUrl = decodedRaw;
    } else {
      srcUrl = `./${decodedRaw}`;
    }
  } else if (/^[A-Za-z0-9]{6}$/.test(decodedRaw)) {
    // Exactly 6-character Catbox code
    srcUrl = `https://files.catbox.moe/${decodedRaw}.json`;
  } else {
    // Fallback – treat as direct path
    srcUrl = decodedRaw;
  }
  // Use decodedRaw (or srcUrl) as unique source identifier
  sourceKey = decodedRaw;
  try {
    const response = await fetch(srcUrl);
    const json = await response.json();
    const { title, categories } = json;
    if (!Array.isArray(categories)) {
      throw new Error("Unexpected JSON structure: 'categories' must be an array");
    }
    videoList = categories;
    errorMessage.style.display = 'none';
    urlInputContainer.style.display = 'none';
    directoryTitle.textContent = title;
    // Set tab title to show source title on menu
    try { document.title = `${(title || '').trim() || 'Source'} on RSP Media Manager`; } catch {}
    // Poster image next to title (supports Image or image, ignoring 'N/A')
    const imgUrl = (typeof json.Image === 'string' && json.Image !== 'N/A')
      ? json.Image
      : (typeof json.image === 'string' && json.image !== 'N/A' ? json.image : '');
    sourceImageUrl = imgUrl || '';
    if (directoryPoster) {
      if (imgUrl) {
        directoryPoster.src = imgUrl;
        directoryPoster.style.display = 'inline-block';
      } else {
        try { directoryPoster.removeAttribute('src'); } catch {}
        directoryPoster.style.display = 'none';
      }
    }
    if (directoryHeader) directoryHeader.style.display = 'flex';
    directoryTitle.style.display = 'block';
    selectorScreen.style.display = 'flex';
    renderEpisodeList();
    showResumeMessage();
    // Auto-select episode if ?item= index is provided
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
    episodeList.textContent = "Failed to load episode list: " + err.message;
    console.error("Episode List Error:", err);
  }
}

// Initialize the player
init();

async function handleFolderUpload(event) {
  const files = Array.from(event.target.files);
  const errorMessage = document.getElementById("errorMessage");
  const indexFile = files.find(f => f.name.toLowerCase() === "index.json");
  if (!indexFile) {
    errorMessage.textContent = "Selected folder must contain index.json";
    errorMessage.style.display = "block";
    return;
  }
  let json;
  try {
    const text = await indexFile.text();
    json = JSON.parse(text);
  } catch (e) {
    errorMessage.textContent = "Failed to read or parse index.json";
    errorMessage.style.display = "block";
    return;
  }
  const { title: dirTitle, categories: cats } = json;
  videoList = cats.map(cat => ({
    category: cat.category,
    episodes: cat.episodes.map(ep => {
      const fileName = ep.src.split("/").pop();
      const fileObj = files.find(f => f.name === fileName);
      const srcUrl = fileObj ? URL.createObjectURL(fileObj) : "";
      const isPlaceholder = !fileObj || (fileObj && fileObj.size === 0);
      return {
        title: ep.title,
        src: srcUrl,
        isPlaceholder,
        // keep metadata from manifest when available so durations show in menu
        durationSeconds: (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null,
        fileSizeBytes: (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null
      };
    })
  }));
  directoryTitle.textContent = dirTitle;
  // Set tab title to show source title on menu (local import)
  try { document.title = `${(dirTitle || '').trim() || 'Source'} on RSP Media Manager`; } catch {}
  // No poster for local folder imports; hide poster image
  sourceImageUrl = '';
  if (directoryPoster) { try { directoryPoster.removeAttribute('src'); } catch {} directoryPoster.style.display = 'none'; }
  if (directoryHeader) directoryHeader.style.display = 'flex';
  directoryTitle.style.display = "block";
  errorMessage.style.display = "none";
  urlInputContainer.style.display = "none";
  selectorScreen.style.display = "flex";
  renderEpisodeList();
  showResumeMessage();
}


backBtn.addEventListener("click", () => {
  video.pause();
  playerScreen.style.display = "none";
  selectorScreen.style.display = "flex";
  backBtn.style.display = "none";
  theaterBtn.style.display = "none";
  document.body.classList.remove("theater-mode");
  // Restore tab title to just the source title when back to menu
  try {
    const st = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
    document.title = `${st} on RSP Media Manager`;
  } catch {}
  // Refresh list to show updated watched/duration info
  renderEpisodeList();
  // Remove any item parameter from the URL
  const params = new URLSearchParams(window.location.search);
  params.delete('item');
  params.delete('?item');
  const query = params.toString();
  const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
});

// Open a selection modal for categories; returns Set of selected indices
async function openSeasonSelectionModal() {
  return new Promise((resolve) => {
    // Backdrop for outside click to close
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'transparent', zIndex: 9998
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #444',
      borderRadius: '10px', padding: '12px', width: '340px',
      boxShadow: '0 10px 24px rgba(0,0,0,0.55)', zIndex: 9999
    });
    // Anchor near settings button
    try {
      const btn = document.getElementById('settingsBtn');
      const r = btn ? btn.getBoundingClientRect() : { top: 16, right: window.innerWidth - 16, bottom: 16 };
      panel.style.top = Math.round((r.bottom || 16) + 8) + 'px';
      panel.style.right = Math.round(Math.max(8, window.innerWidth - (r.right || (window.innerWidth - 16)))) + 'px';
    } catch {}

    const h = document.createElement('div'); h.textContent = 'Download Seasons'; h.style.fontWeight = '700'; h.style.margin = '0 0 6px 0';
    const list = document.createElement('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto'; list.style.padding = '4px 0';

    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px' });
    const btnOk = document.createElement('button'); btnOk.textContent = 'Download'; btnOk.className = 'pill-button';
    const totalSpan = document.createElement('span'); totalSpan.style.color = '#b6b6b6'; totalSpan.style.whiteSpace = 'nowrap';

    const checkboxes = [];
    const seasonSizes = [];
    function computeTotal() {
      let sum = 0;
      checkboxes.forEach((cb, i) => { if (cb.checked) sum += (seasonSizes[i] || 0); });
      totalSpan.textContent = formatBytesDecimalMaxUnit(sum);
    }

    videoList.forEach((cat, idx) => {
      const row = document.createElement('label');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 0' });
      const leftWrap = document.createElement('span');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.index = String(idx);
      const name = document.createElement('span'); name.textContent = cat.category; name.style.marginLeft = '6px';
      leftWrap.append(cb, name);
      const sizeSpan = document.createElement('span'); sizeSpan.style.color = '#b6b6b6'; sizeSpan.style.whiteSpace = 'nowrap';
      let seasonBytes = 0;
      try { (cat.episodes || []).forEach(e => { const v = Number(e.fileSizeBytes); if (Number.isFinite(v) && v >= 0) seasonBytes += v; }); } catch {}
      seasonSizes[idx] = seasonBytes;
      sizeSpan.textContent = formatBytesDecimalMaxUnit(seasonBytes);
      row.append(leftWrap, sizeSpan);
      list.appendChild(row);
      checkboxes.push(cb);
      cb.addEventListener('change', computeTotal);
    });

    computeTotal();
    footer.append(btnOk, totalSpan);
    panel.append(h, list, footer);
    document.body.append(backdrop, panel);

    function closeMenu(result) {
      try { panel.remove(); } catch {}
      try { backdrop.remove(); } catch {}
      resolve(result);
    }
    backdrop.addEventListener('click', () => closeMenu(null));
    btnOk.addEventListener('click', () => {
      const selected = new Set(checkboxes.filter(cb => cb.checked).map(cb => parseInt(cb.dataset.index, 10)));
      closeMenu(selected);
    });
  });
}

async function downloadSourceFolder(options = {}) {
  const selectedSet = options.selectedCategories instanceof Set ? options.selectedCategories : null;
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.7)', color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, fontFamily: 'Segoe UI, sans-serif', textAlign: 'center'
  });
  document.body.appendChild(overlay);

  let cancelRequested = false;
  const xhrs = [];

  const rowsContainer = document.createElement('div');
  rowsContainer.style.width = '80%';
  overlay.appendChild(rowsContainer);

  const zip = new JSZip();
  const titleText = directoryTitle.textContent.trim() || 'directory';
  const safeZipSegment = (name) => {
    try {
      return String(name || '')
        .replace(/[\\/]+/g, ' - ')          // path separators -> hyphen
        .replace(/[<>:"|?*]+/g, '')         // illegal on Windows
        .replace(/\s{2,}/g, ' ')            // collapse spaces
        .trim();
    } catch { return 'untitled'; }
  };
  const rootFolder = zip.folder(titleText);
  rootFolder.file(
    'PUT THIS FOLDER IN YOUR /DIRECTORYS/ FOLDER.txt',
    'https://github.com/RandomSideProjects/Media-Manager/ is the origin of this web app.'
  );

  const manifest = { title: titleText, Image: sourceImageUrl || 'N/A', categories: [] };
  const catFolders = [];
  const catObjs = [];

  const sanitizedCats = videoList.map(cat => safeZipSegment(cat.category));
  videoList.forEach((cat, i) => {
    const catFolder = rootFolder.folder(sanitizedCats[i]);
    catFolders.push(catFolder);
    // Pre-create episodes array to preserve original order
    const episodesPlaceholders = cat.episodes.map(ep => ({
      title: ep.title,
      // default to original remote until overridden for selected downloads
      src: ep.src,
      fileSizeBytes: (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null,
      durationSeconds: (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null
    }));
    const catObj = { category: cat.category, episodes: episodesPlaceholders };
    catObjs.push(catObj);
    manifest.categories.push(catObj);
  });

  // Plan file names per episode and build tasks only for selected categories
  const plannedNames = videoList.map(() => []);
  const tasks = [];
  videoList.forEach((cat, ci) => {
    cat.episodes.forEach((episode, ei) => {
      const urlParts = new URL(episode.src, window.location.href);
      const origName = decodeURIComponent(urlParts.pathname.split('/').pop());
      const ext = origName.includes('.') ? origName.slice(origName.lastIndexOf('.')) : '';
      const pad = String(ei + 1).padStart(2, '0');
      const fileName = `E${pad}${ext}`;
      plannedNames[ci][ei] = fileName;
      const shouldDownload = !selectedSet || selectedSet.has(ci);
      if (shouldDownload) {
        tasks.push({ ci, ei, episode, fileName });
      }
    });
  });

  const progressBars = [];
  // --- 1. Insert initialization of loadedBytes, totalBytes, and after ETA label, speedLabel and dataLeftLabels ---
  // We'll initialize loadedBytes and totalBytes for progress tracking.
  const loadedBytes = Array(tasks.length).fill(0);
  const totalBytes = Array(tasks.length).fill(0);

  // Insert ETA label and speed label after rowsContainer
  // We'll add the labels after rowsContainer is appended, but before rows are built.
  // So, build the rows first, then insert the labels.
  // But per instruction, after ETA label insertion, add speedLabel and dataLeftLabels array.

  // We'll build the rows, then create ETA label and speed label.
  const dataLeftLabels = [];
  tasks.forEach(({ ci, ei }, idx) => {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', margin: '0.5em 0' });
    const label = document.createElement('span');
    label.textContent = `S${ci+1}E${ei+1}`;
    label.style.width = '4em';
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = 0;
    progress.style.flex = '1';
    row.append(label, progress);
    // --- 2. Create and store data-left labels when building rows ---
    const dataLeft = document.createElement('span');
    dataLeft.style.marginLeft = '0.5em';
    dataLeft.style.color = '#6ec1e4';
    dataLeft.textContent = '';
    row.appendChild(dataLeft);
    dataLeftLabels[idx] = dataLeft;
    rowsContainer.appendChild(row);
    progressBars[idx] = progress;
  });

  // ETA label
  const etaLabel = document.createElement('div');
  etaLabel.style.margin = '0.5em';
  etaLabel.style.color = '#6ec1e4';
  overlay.insertBefore(etaLabel, rowsContainer);
  // --- 1. After ETA label, add speed label and dataLeftLabels array ---
  const speedLabel = document.createElement('div');
  speedLabel.style.margin = '0.5em';
  speedLabel.style.color = '#6ec1e4';
  overlay.insertBefore(speedLabel, etaLabel);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'pill-button';
  cancelBtn.style.marginTop = '1em';
  overlay.appendChild(cancelBtn);
  cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    xhrs.forEach(x => x.abort());
    overlay.remove();
  });

  const concurrency = 25;
  let pointer = 0;
  // For ETA calculation
  let lastTime = Date.now();
  let lastLoaded = 0;
  let avgSpeed = 0;
  let downloadedBytes = 0; // track actual downloaded bytes for selected
  async function computeBlobDurationSeconds(blob) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(blob);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = () => {
          try { URL.revokeObjectURL(url); } catch {}
          const d = isFinite(v.duration) ? v.duration : NaN;
          resolve(d);
        };
        v.onloadedmetadata = done;
        v.onerror = done;
        v.src = url;
      } catch {
        resolve(NaN);
      }
    });
  }

  const workers = Array.from({ length: concurrency }, async () => {
    while (!cancelRequested && pointer < tasks.length) {
      const idx = pointer++;
      const { ci, ei, episode, fileName } = tasks[idx];
      try {
        const blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.push(xhr);
          xhr.addEventListener('loadend', () => {
            const i = xhrs.indexOf(xhr);
            if (i >= 0) xhrs.splice(i, 1);
          });
          xhr.open('GET', episode.src);
          xhr.responseType = 'blob';
          xhr.addEventListener('progress', e => {
            if (e.lengthComputable) {
              progressBars[idx].value = (e.loaded / e.total) * 100;
              loadedBytes[idx] = e.loaded;
              totalBytes[idx] = e.total;
              // --- 3. Update speed label and per-file data-left in the progress handler ---
              // Calculate total loaded and speed
              const totalLoaded = loadedBytes.reduce((a, b) => a + b, 0);
              const totalTotal = totalBytes.reduce((a, b) => a + b, 0);
              const now = Date.now();
              const dt = (now - lastTime) / 1000;
              const dLoaded = totalLoaded - lastLoaded;
              let speed = 0;
              if (dt > 0) {
                speed = dLoaded / dt;
                // smooth speed
                avgSpeed = avgSpeed * 0.8 + speed * 0.2;
                lastTime = now;
                lastLoaded = totalLoaded;
              }
              // ETA
              const remaining = totalTotal - totalLoaded;
              let eta = '';
              if (avgSpeed > 0 && remaining > 0) {
                const seconds = remaining / avgSpeed;
                const min = Math.floor(seconds / 60);
                const sec = Math.round(seconds % 60);
                eta = `ETA: ${min}m ${sec}s`;
              }
              etaLabel.textContent = eta;
              // Update current download speed
              const speedMBps = (speed / (1024 * 1024)).toFixed(2);
              speedLabel.textContent = `Speed: ${speedMBps} MB/s`;
              // Update remaining data for this file
              const remainingBytes = totalBytes[idx] - loadedBytes[idx];
              const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(2);
              dataLeftLabels[idx].textContent = `${remainingMB} MB left`;
            }
          });
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300
            ? resolve(xhr.response)
            : reject(new Error('Download failed: ' + xhr.status));
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send();
        });
        catFolders[ci].file(fileName, blob);
        // Assign the local path to the pre-allocated episode slot
        const epObj = catObjs[ci].episodes[ei];
        epObj.src = `Directorys/${titleText}/${sanitizedCats[ci]}/${fileName}`;
        // Record file size
        try {
          const sz = Number(blob && blob.size);
          if (Number.isFinite(sz) && sz >= 0) {
            epObj.fileSizeBytes = sz;
            downloadedBytes += sz;
          }
        } catch {}
        // Compute duration from blob metadata
        try {
          const d = await computeBlobDurationSeconds(blob);
          if (Number.isFinite(d) && d > 0) {
            const sec = Math.round(d);
            epObj.durationSeconds = sec;
          }
        } catch {}
      } catch (err) {
        console.error('Error downloading', episode.src, err);
      }
    }
  });

  await Promise.all(workers);

  // For unselected categories, keep remote src and any existing metadata (no placeholder files)

  if (cancelRequested) {
    return;
  }

  // Compute root totals across ALL episodes (selected and unselected) using available metadata
  let totalBytesAll = 0, totalSecsAll = 0;
  try {
    for (const c of catObjs) {
      for (const e of c.episodes) {
        const b = Number(e.fileSizeBytes);
        const d = Number(e.durationSeconds);
        if (Number.isFinite(b) && b >= 0) totalBytesAll += Math.floor(b);
        if (Number.isFinite(d) && d >= 0) totalSecsAll += Math.floor(d);
      }
    }
  } catch {}
  manifest.totalFileSizeBytes = totalBytesAll || 0;
  manifest.totalDurationSeconds = totalSecsAll || 0;

  // Inline poster image as data URI if possible
  async function fetchAsDataURL(url) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error('image fetch failed');
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
  if (sourceImageUrl) {
    try {
      const dataUrl = await fetchAsDataURL(sourceImageUrl);
      if (dataUrl) manifest.Image = dataUrl;
    } catch {}
  }
  rootFolder.file('index.json', JSON.stringify(manifest, null, 2));

  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = `${titleText}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  overlay.remove();
}

const downloadBtn = document.getElementById('downloadBtn');
if (downloadBtn) {
  downloadBtn.addEventListener('click', async () => {
    const selected = await openSeasonSelectionModal();
    if (selected === null) return; // cancelled
    downloadSourceFolder({ selectedCategories: selected });
  });
}

 (function() {
  const toggleBtn = document.getElementById('themeToggle');
  const bodyEl = document.body;
  const stored = localStorage.getItem('theme') || 'dark';
  bodyEl.classList.toggle('light-mode', stored === 'light');
  toggleBtn.textContent = stored === 'light' ? '☀' : '☾';
  toggleBtn.addEventListener('click', () => {
    const isLight = bodyEl.classList.toggle('light-mode');
    toggleBtn.textContent = isLight ? '☀' : '☾';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
})();


function showResumeMessage() {
  const resumeEl = document.getElementById('resumeMessage');
  const lastSrc = localStorage.getItem('lastEpSrc');
  if (!lastSrc) {
    resumeEl.style.display = 'none';
    return;
  }
  const savedTime = parseFloat(localStorage.getItem(lastSrc));
  const duration = parseFloat(localStorage.getItem(lastSrc + ':duration'));
  if (isNaN(savedTime) || isNaN(duration)) {
    resumeEl.style.display = 'none';
    return;
  }
  // Retrieve index per source
  const savedIdx = parseInt(localStorage.getItem(`${sourceKey}:SavedItem`), 10);
  // Find episode index
  const idx = flatList.findIndex(ep => ep.src === lastSrc);
  if (idx < 0) {
    resumeEl.style.display = 'none';
    return;
  }
  const epNum = idx + 1;
  const nextNum = epNum + 1;
  const fraction = savedTime / duration;
  let message = '';
  if (fraction >= 0.9 && nextNum <= flatList.length) {
    message = `Next up, <a id="resumeLink">Episode ${nextNum}</a>`;
  } else {
    message = `You left off on <a id="resumeLink">Episode ${epNum}</a>`;
  }
  resumeEl.style.display = 'block';
  resumeEl.innerHTML = message;
  const link = document.getElementById('resumeLink');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetIdx = (fraction >= 0.9 && nextNum <= flatList.length) ? idx + 1 : idx;
      currentIndex = targetIdx;
      selectorScreen.style.display = 'none';
      playerScreen.style.display = 'block';
      backBtn.style.display = 'inline-block';
      theaterBtn.style.display = 'inline-block';
      loadVideo(targetIdx);
    });
  }
}
// Clip functionality
const clipBtn = document.getElementById('clipBtn');
const clipOverlay = document.getElementById('clipOverlay');
const clipMessage = document.getElementById('clipMessage');
const clipDoneBtn = document.getElementById('clipDoneBtn');
const clipDownloadBtn = document.getElementById('clipDownloadBtn');
const clipButtonsRow = document.getElementById('clipButtonsRow');
let lastClipBlob = null;
let lastPreviewObjectURL = null;

// Helper to ensure the Download button exists and is wired up
function ensureClipDownloadButton() {
  let btn = document.getElementById('clipDownloadBtn');
  if (!btn) {
    const done = document.getElementById('clipDoneBtn');
    if (done && done.parentElement) {
      btn = document.createElement('button');
      btn.id = 'clipDownloadBtn';
      btn.textContent = 'Download';
      Object.assign(btn.style, {
        padding: '0.6em 1.2em',
        background: getComputedStyle(done).backgroundColor || 'var(--button-bg)',
        color: getComputedStyle(done).color || 'var(--button-text)',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      });
      done.parentElement.appendChild(btn);
    }
  }
  if (btn) {
    btn.style.display = 'inline-block';
    btn.onclick = () => {
      if (!lastClipBlob) return;
      const url = URL.createObjectURL(lastClipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clip.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
}

// Helper to display clip result (success or error), guarding against clipMessage being null
function displayClipResult(html, isError = false) {
  if (clipMessage) {
    clipMessage.innerHTML = html;
    if (clipOverlay) {
      clipOverlay.style.display = 'flex';
    }
  } else {
    // Fallback standalone overlay
    const tmp = document.createElement('div');
    Object.assign(tmp.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1em',
      zIndex: 10000,
      fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
      textAlign: 'center',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: isError ? 'rgba(80,0,0,0.95)' : 'rgba(20,20,20,0.95)',
      padding: '1em 1.25em',
      borderRadius: '12px',
      maxWidth: '540px',
      boxShadow: '0 20px 40px -10px rgba(0,0,0,0.6)',
    });
    box.innerHTML = html;
    const done = document.createElement('button');
    done.textContent = 'Done';
    Object.assign(done.style, {
      marginTop: '1em',
      padding: '0.5em 1em',
      cursor: 'pointer',
    });
    done.addEventListener('click', () => tmp.remove());
    box.appendChild(done);
    tmp.appendChild(box);
    document.body.appendChild(tmp);
  }
}

// Upload clip to Catbox with progress callback
async function uploadClipToCatboxWithProgress(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://catbox.moe/user/api.php');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', blob, 'clip.webm');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(e.loaded / e.total * 100);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.responseText || '').trim());
      } else {
        reject(new Error('Upload failed: ' + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

if (clipBtn) {
  clipBtn.addEventListener('click', async () => {
    const x = video.currentTime;
    video.pause();
    const y = parseFloat(prompt('Enter half-length in seconds:', '10'));
    if (isNaN(y) || y <= 0) return;
    const start = Math.max(0, x - y);
    const end = Math.min(video.duration, x + y);

    const overlay = document.getElementById('clipProgressOverlay');
    const msg = document.getElementById('clipProgressMessage');
    const bar = document.getElementById('clipProgressBar');

    overlay.style.display = 'flex';
    msg.textContent = 'Preparing clip...';
    bar.value = 0;

    let hiddenVideo = document.createElement('video');
    hiddenVideo.muted = false;
    hiddenVideo.preload = 'auto';
    hiddenVideo.crossOrigin = 'anonymous';
    // Ensure hiddenVideo is attached to DOM for stable capture
    hiddenVideo.style.position = 'absolute';
    hiddenVideo.style.left = '-9999px';
    hiddenVideo.style.width = '1px';
    hiddenVideo.style.height = '1px';
    hiddenVideo.style.opacity = '0';
    hiddenVideo.setAttribute('playsinline', '');
    document.body.appendChild(hiddenVideo);

    try {
      hiddenVideo.src = video.src;

      await new Promise(r => {
        function onMeta() {
          hiddenVideo.removeEventListener('loadedmetadata', onMeta);
          r();
        }
        hiddenVideo.addEventListener('loadedmetadata', onMeta);
      });

      await new Promise(r => {
        function onSeeked() {
          hiddenVideo.removeEventListener('seeked', onSeeked);
          r();
        }
        hiddenVideo.addEventListener('seeked', onSeeked);
        hiddenVideo.currentTime = start;
      });

      // Start playback and wait for it to actually start
      hiddenVideo.play();
      await new Promise(resolve => {
        function onPlaying() {
          hiddenVideo.removeEventListener('playing', onPlaying);
          resolve();
        }
        hiddenVideo.addEventListener('playing', onPlaying);
      });
      // small buffer to stabilize
      await new Promise(r => setTimeout(r, 100));

      // Build recording stream (prefer captureStream)
      let stream;
      let canvas;
      let canvasDrawLoop;
      if (typeof hiddenVideo.captureStream === 'function') {
        stream = hiddenVideo.captureStream();

        // If no audio in captureStream, supplement it
        if (stream.getAudioTracks().length === 0) {
          try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            await audioCtx.resume().catch(() => {});
            const sourceNode = audioCtx.createMediaElementSource(hiddenVideo);
            const dest = audioCtx.createMediaStreamDestination();
            sourceNode.connect(dest);
            // Merge video and supplemented audio
            stream = new MediaStream([
              ...stream.getVideoTracks(),
              ...dest.stream.getAudioTracks(),
            ]);
          } catch (err) {
            console.warn('Supplementing audio failed, proceeding with original stream.', err);
          }
        }
      } else {
        canvas = document.createElement('canvas');
        canvas.width = hiddenVideo.videoWidth || 640;
        canvas.height = hiddenVideo.videoHeight || 360;
        const ctx = canvas.getContext('2d');
        canvasDrawLoop = () => {
          ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
          if (recorder && recorder.state === 'recording') {
            requestAnimationFrame(canvasDrawLoop);
          }
        };
        const canvasStream = canvas.captureStream(30);
        let audioStream = null;
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          await audioCtx.resume().catch(() => {});
          const sourceNode = audioCtx.createMediaElementSource(hiddenVideo);
          const dest = audioCtx.createMediaStreamDestination();
          sourceNode.connect(dest);
          sourceNode.connect(audioCtx.destination);
          audioStream = dest.stream;
        } catch (e) {
          console.warn('Audio capture fallback failed, proceeding without audio.', e);
        }
        if (audioStream) {
          stream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks(),
          ]);
        } else {
          stream = canvasStream;
        }
      }

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }
      }

      let recorder;
      const recordedChunks = [];
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };

      const durationMs = (end - start) * 1000;
      const recordStart = Date.now();
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - recordStart;
        bar.value = Math.min(100, (elapsed / durationMs) * 100);
      }, 100);

      // Debug log before starting recording
      console.log('Recording stream tracks:', stream.getVideoTracks().length, 'video /', stream.getAudioTracks().length, 'audio');
      recorder.start();
      if (typeof canvasDrawLoop === 'function') canvasDrawLoop();

      await new Promise(resolve => {
        function checkTime() {
          if (hiddenVideo.currentTime >= end) {
            hiddenVideo.pause();
            resolve();
          } else {
            requestAnimationFrame(checkTime);
          }
        }
        checkTime();
      });

      recorder.stop();
      clearInterval(progressInterval);
      bar.value = 100;
      msg.textContent = 'Processing clip...';

      await new Promise(r => {
        recorder.onstop = () => r();
      });

      const clipBlob = new Blob(recordedChunks, {
        type: recorder.mimeType || 'video/webm',
      });
      lastClipBlob = clipBlob;

      msg.textContent = 'Uploading clip...';
      bar.value = 0;
      try {
        const url = await uploadClipToCatboxWithProgress(clipBlob, pct => {
          bar.value = pct;
        });
        // Preview support block
        const clipPreviewEnabled = localStorage.getItem('clipPreviewEnabled') === 'true';
        let previewHTML = '';
        if (clipPreviewEnabled) {
          try {
            if (lastPreviewObjectURL) {
              URL.revokeObjectURL(lastPreviewObjectURL);
            }
            lastPreviewObjectURL = URL.createObjectURL(clipBlob);
            previewHTML = `
              <div style="margin-top:0.75em">
                <video src="${lastPreviewObjectURL}" controls style="width:100%; max-height:50vh; border-radius:8px; outline:none"></video>
              </div>`;
          } catch {}
        }
        let clipboardMsg = 'Link copied to clipboard.';
        try { await navigator.clipboard.writeText(url); } catch (e) { console.warn('Clipboard write failed:', e); clipboardMsg = 'Could not copy to clipboard. Please copy manually.'; }
        overlay.style.display = 'none';
        displayClipResult(`
          <h2 style="margin:0 0 0.5em; font-size:1.3em;">Your clip has been made!</h2>
          <p style="margin:0 0 .75em;">You can access it at this link:</p>
          <div style="word-break: break-all; margin-bottom:0.5em;">
            <a href="${url}" target="_blank" style="color:#5ab8ff; text-decoration:none; font-weight:600;">${url}</a>
          </div>
          <div style="font-size:0.85em; color:#c0c0c0; margin-bottom:0.75em;">${clipboardMsg}</div>
          ${previewHTML}
          <div style="display:flex; gap:0.5em; justify-content:center; margin-top:0.75em;">
            <button id="clipBoxDownload" style="padding:0.6em 1.2em; background:var(--button-bg); color:var(--button-text); border:none; border-radius:6px; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px;">Download</button>
            <button id="clipBoxDone" style="padding:0.6em 1.2em; background:var(--button-bg); color:var(--button-text); border:none; border-radius:6px; cursor:pointer; text-transform:uppercase; letter-spacing:0.5px;">Done</button>
          </div>
        `);
        if (clipButtonsRow) clipButtonsRow.style.display = 'none';
        const boxDownload = document.getElementById('clipBoxDownload');
        const boxDone = document.getElementById('clipBoxDone');
        if (boxDownload) {
          boxDownload.addEventListener('click', () => {
            if (!lastClipBlob) return;
            const dlUrl = URL.createObjectURL(lastClipBlob);
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = 'clip.webm';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
          });
        }
        if (boxDone) {
          boxDone.addEventListener('click', () => {
            if (lastPreviewObjectURL) { try { URL.revokeObjectURL(lastPreviewObjectURL); } catch {} lastPreviewObjectURL = null; }
            if (clipOverlay) clipOverlay.style.display = 'none';
            if (clipButtonsRow) clipButtonsRow.style.display = 'flex';
          });
        }
        ensureClipDownloadButton();
      } catch (err) {
        overlay.style.display = 'none';
        lastClipBlob = clipBlob;
        // create fallback download URL for the clip
        const clipPreviewEnabled = localStorage.getItem('clipPreviewEnabled') === 'true';
        let previewHTML = '';
        if (clipPreviewEnabled) {
          try {
            if (lastPreviewObjectURL) {
              URL.revokeObjectURL(lastPreviewObjectURL);
            }
            lastPreviewObjectURL = URL.createObjectURL(clipBlob);
            previewHTML = `
              <div style="margin-top:0.75em">
                <video src="${lastPreviewObjectURL}" controls style="width:100%; max-height:50vh; border-radius:8px; outline:none"></video>
              </div>`;
          } catch {}
        }
        const localUrl = URL.createObjectURL(clipBlob);
        displayClipResult(`
          <h2 style="margin:0 0 0.5em; font-size:1.3em;">Clip upload failed</h2>
          <p style="margin:0;">${err.message}</p>
          <small>
            Would you like to <span style="color:#5ab8ff;">
              <a href="${localUrl}" download="clip.webm" style="color:inherit; text-decoration:none;">download</a>
            </span> the clip instead?
          </small>
          ${previewHTML}
        `, true);
        ensureClipDownloadButton();
      }
    } finally {
      // Clean up hiddenVideo from DOM
      if (hiddenVideo && hiddenVideo.parentElement) {
        hiddenVideo.remove();
      }
    }
  });
}

if (clipDoneBtn && clipOverlay) {
  clipDoneBtn.addEventListener('click', () => {
    // Clean up preview object URL if present
    if (lastPreviewObjectURL) {
      try { URL.revokeObjectURL(lastPreviewObjectURL); } catch {}
      lastPreviewObjectURL = null;
    }
    clipOverlay.style.display = 'none';
    if (clipButtonsRow) clipButtonsRow.style.display = 'flex';
  });
}

if (clipDownloadBtn) {
  clipDownloadBtn.addEventListener('click', () => {
    if (!lastClipBlob) return;
    const url = URL.createObjectURL(lastClipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clip.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
ensureClipDownloadButton();

// Settings modal and clipping toggle
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const clipToggle = document.getElementById('clipToggle');
const clipPreviewToggle = document.getElementById('clipPreviewToggle');
const selectiveDownloadToggle = document.getElementById('selectiveDownloadToggle');

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsOverlay) settingsOverlay.style.display = 'flex';
});

if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', () => {
    if (settingsOverlay) settingsOverlay.style.display = 'none';
  });
}

if (settingsOverlay) {
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.style.display = 'none';
    }
  });
}

// Initialize toggle state from localStorage (default: off)
const clippingEnabled = localStorage.getItem('clippingEnabled') === 'true';
clipToggle.checked = clippingEnabled;
// Show or hide the Clip button accordingly
if (clipBtn) clipBtn.style.display = clippingEnabled ? 'inline-block' : 'none';

// Initialize clip preview toggle from localStorage
const clipPreviewEnabledStored = localStorage.getItem('clipPreviewEnabled') === 'true';
if (clipPreviewToggle) clipPreviewToggle.checked = clipPreviewEnabledStored;

// Initialize selective downloads toggle from localStorage
const selectiveDownloadsEnabledStored = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
if (selectiveDownloadToggle) selectiveDownloadToggle.checked = selectiveDownloadsEnabledStored;

// Persist clip preview setting
if (clipPreviewToggle) {
  clipPreviewToggle.addEventListener('change', () => {
    localStorage.setItem('clipPreviewEnabled', clipPreviewToggle.checked);
  });
}

// Persist selective downloads setting
if (selectiveDownloadToggle) {
  selectiveDownloadToggle.addEventListener('change', () => {
    localStorage.setItem('selectiveDownloadsEnabled', selectiveDownloadToggle.checked);
  });
}

// Update clippingEnabled on toggle change
clipToggle.addEventListener('change', () => {
  const enabled = clipToggle.checked;
  localStorage.setItem('clippingEnabled', enabled);
  if (clipBtn) clipBtn.style.display = enabled ? 'inline-block' : 'none';
});
