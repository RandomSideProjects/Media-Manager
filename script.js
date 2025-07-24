let videoList = [];
let flatList = [];
let currentIndex = 0;

const video = document.getElementById("videoPlayer");
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
        currentIndex = index;
        selectorScreen.style.display = "none";
        playerScreen.style.display = "block";
        backBtn.style.display = "inline-block";
        loadVideo(currentIndex);
      });
      episodeList.appendChild(button);
    });
  });
}

function loadVideo(index) {
  const item = flatList[index];
  video.src = item.src;
  // Resume playback if previously saved
  const savedTime = localStorage.getItem(video.src);
  if (savedTime) {
    video.currentTime = parseFloat(savedTime);
  }
  title.textContent = item.title;
  nextBtn.style.display = "none";
  video.load();
  video.play();
}

video.addEventListener("timeupdate", () => {
  if (video.currentTime / video.duration > 0.9 && currentIndex < flatList.length - 1) {
    nextBtn.style.display = "inline-block";
  }
  // Save current playback time
  localStorage.setItem(video.src, video.currentTime);
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < flatList.length - 1) {
    currentIndex++;
    loadVideo(currentIndex);
  }
});

video.addEventListener("ended", () => {
  // Remove saved time when finished
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
  // Find index.json
  const indexFile = files.find(f => f.name.toLowerCase() === "index.json");
  if (!indexFile) {
    errorMessage.textContent = "Selected folder must contain index.json";
    errorMessage.style.display = "block";
    return;
  }
  // Load and parse JSON
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
  // Build videoList from files
  videoList = cats.map(cat => ({
    category: cat.category,
    episodes: cat.episodes.map(ep => {
      const fileName = ep.src.split("/").pop();
      const fileObj = files.find(f => f.name === fileName);
      const srcUrl = fileObj ? URL.createObjectURL(fileObj) : "";
      return { title: ep.title, src: srcUrl };
    })
  }));
  // Initialize UI
  directoryTitle.textContent = dirTitle;
  directoryTitle.style.display = "block";
  errorMessage.style.display = "none";
  urlInputContainer.style.display = "none";
  selectorScreen.style.display = "flex";
  renderEpisodeList();
}


backBtn.addEventListener("click", () => {
  playerScreen.style.display = "none";
  selectorScreen.style.display = "flex";
  backBtn.style.display = "none";
});

// Requires JSZip included in index.html via a <script> tag
async function downloadSourceFolder() {
  // Create overlay and progress UI
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.7)', color: '#fff',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, fontFamily: 'Segoe UI, sans-serif', textAlign: 'center'
  });
  const fileLabel = document.createElement('div');
  fileLabel.style.marginBottom = '0.5em';
  overlay.appendChild(fileLabel);
  const fileProgressBar = document.createElement('progress');
  fileProgressBar.max = 100; fileProgressBar.value = 0;
  fileProgressBar.style.width = '80%'; fileProgressBar.style.marginBottom = '0.5em';
  overlay.appendChild(fileProgressBar);
  const episodesLeftLabel = document.createElement('div');
  overlay.appendChild(episodesLeftLabel);
  document.body.appendChild(overlay);

  const fileStats = document.createElement('div');
  fileStats.style.marginBottom = '0.5em';
  overlay.insertBefore(fileStats, fileProgressBar);
  const totalStats = document.createElement('div');
  totalStats.style.marginTop = '0.5em';
  overlay.appendChild(totalStats);

  // Ensure JSZip is available
  if (typeof JSZip === 'undefined') {
    console.error('JSZip library not loaded.');
    return;
  }
  const zip = new JSZip();
  const titleText = directoryTitle.textContent.trim() || 'directory';
  // Create a top-level folder named after the source title
  const rootFolder = zip.folder(titleText);
  // Add instruction file inside the source folder
  rootFolder.file(
    'PUT FOLDER IN DIRECTORYS FOLDER.txt',
    'https://github.com/RandomSideProjects/Media-Manager/ is the origin of this web app.'
  );
  // Build JSON structure and add video files
  const manifest = { title: titleText, categories: [] };
  const totalEpisodes = videoList.reduce((sum, cat) => sum + cat.episodes.length, 0);
  let processedCount = 0;
  const startTotalTime = Date.now();
  for (let ci = 0; ci < videoList.length; ci++) {
    const category = videoList[ci];
    const catName = category.category || 'Category';
    const catFolder = rootFolder.folder(catName);
    const catObj = { category: catName, episodes: [] };
    for (let ei = 0; ei < category.episodes.length; ei++) {
      const episode = category.episodes[ei];
      try {
        // Update per-file labels
        fileLabel.textContent = `S${ci+1}E${ei+1}`;
        episodesLeftLabel.textContent = `${totalEpisodes - processedCount - 1} Items remaining`;
        // Download via XHR for progress
        const blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const startFileTime = Date.now();
          xhr.open('GET', episode.src);
          xhr.responseType = 'blob';
          xhr.addEventListener('progress', e => {
            if (e.lengthComputable) {
              const loaded = e.loaded;
              const total = e.total;
              fileProgressBar.value = (loaded / total) * 100;
              // Per-file stats
              const now = Date.now();
              const elapsedFileMs = now - startFileTime;
              const fileSpeed = loaded / (elapsedFileMs / 1000);
              const speedDisplay = (fileSpeed / (1024 * 1024)).toFixed(2) + ' MB/s';
              const timeLeftFileSec = (total - loaded) / fileSpeed;
              const etaFile = new Date(timeLeftFileSec * 1000).toISOString().substr(14, 5);
              fileStats.textContent = `${speedDisplay} | ${etaFile} left`;
              // Overall stats
              const elapsedTotalMs = now - startTotalTime;
              const completedFraction = processedCount + loaded / total;
              const avgSecPerEp = elapsedTotalMs / 1000 / completedFraction;
              const remainCount = totalEpisodes - completedFraction;
              const etaTotalSec = avgSecPerEp * remainCount;
              const etaTotalDisplay = new Date(etaTotalSec * 1000).toISOString().substr(14, 5);
              totalStats.textContent = `ETA: ${etaTotalDisplay}`;
            }
          });
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
            else reject(new Error('Failed to download file: ' + xhr.status));
          };
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send();
        });
        const urlParts = new URL(episode.src, window.location.href);
        const fileName = decodeURIComponent(urlParts.pathname.split('/').pop());
        catFolder.file(fileName, blob);
        catObj.episodes.push({ title: episode.title, src: `Directorys/${titleText}/${catName}/${fileName}` });
      } catch (err) {
        console.error('Error fetching episode for ZIP:', episode.src, err);
      }
      processedCount++;
    }
    rootFolder.file('index.json', ''); // ensure folder exists
    manifest.categories.push(catObj);
  }
  // Add the manifest JSON (index.json) at the root of the source folder
  rootFolder.file('index.json', JSON.stringify(manifest, null, 2));
  // Generate and download the ZIP
  const content = await zip.generateAsync({ type: 'blob' }, metadata => {
    // optional: update a progress bar here via metadata.percent
    console.log(`ZIP progress: ${metadata.percent.toFixed(2)}%`);
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = `${titleText}.zip`;
  document.body.appendChild(a);
  a.click();
  // Remove overlay
  overlay.remove();
  document.body.removeChild(a);
}

// Wire up the download button
const downloadBtn = document.getElementById('downloadBtn');
if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const proceed = window.confirm(
      'Zipping all videos into a single archive may take a long time and use significant memory. Proceed?'
    );
    if (proceed) downloadSourceFolder();
  });
}

// Theme toggle setup
(function() {
  const toggleBtn = document.getElementById('themeToggle');
  const bodyEl = document.body;
  // Load stored theme or default to dark
  const stored = localStorage.getItem('theme') || 'dark';
  bodyEl.classList.toggle('light-mode', stored === 'light');
  toggleBtn.textContent = stored === 'light' ? '☀' : '☾';
  // Toggle on click
  toggleBtn.addEventListener('click', () => {
    const isLight = bodyEl.classList.toggle('light-mode');
    toggleBtn.textContent = isLight ? '☀' : '☾';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
})();
