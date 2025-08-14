// script.js
let videoList = [];
let sourceKey = '';
let flatList = [];
let currentIndex = 0;


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
const directoryTitle = document.getElementById("directoryTitle");
const backBtn = document.getElementById("backBtn");
const theaterBtn = document.getElementById("theaterBtn");
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
      button.textContent = episode.title;
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
  video.src = item.src;
  video.addEventListener('loadedmetadata', function onMeta() {
    localStorage.setItem(video.src + ':duration', video.duration);
    video.removeEventListener('loadedmetadata', onMeta);
  });
  const savedTime = localStorage.getItem(video.src);
  if (savedTime) {
    video.currentTime = parseFloat(savedTime);
  }
  title.textContent = item.title;
  nextBtn.style.display = "none";
  video.load();
  video.play();
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

