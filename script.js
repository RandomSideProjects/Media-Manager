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
        loadVideo(currentIndex);
      });
      episodeList.appendChild(button);
    });
  });
}

function loadVideo(index) {
  const item = flatList[index];
  video.src = item.src;
  title.textContent = item.title;
  nextBtn.style.display = "none";
  video.load();
  video.play();
}

video.addEventListener("timeupdate", () => {
  if (video.currentTime / video.duration > 0.9 && currentIndex < flatList.length - 1) {
    nextBtn.style.display = "inline-block";
  }
});

nextBtn.addEventListener("click", () => {
  if (currentIndex < flatList.length - 1) {
    currentIndex++;
    loadVideo(currentIndex);
  }
});

video.addEventListener("ended", () => {
  if (currentIndex < flatList.length - 1) {
    nextBtn.click();
  }
});

async function init() {
  const params = new URLSearchParams(window.location.search);
  const rawSrc = params.get('source');
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
  const srcUrl = decodeURIComponent(rawSrc);
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
