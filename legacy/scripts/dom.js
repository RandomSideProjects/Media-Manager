"use strict";

// Element refs
let video = document.getElementById("videoPlayer");
const spinner = document.getElementById("loadingSpinner");
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
const folderInput = document.getElementById("folderInput");
const downloadBtn = document.getElementById('downloadBtn');
const themeToggle = document.getElementById('themeToggle');
const separatedPartsBar = document.getElementById('separatedPartsBar');
const homeMainRegion = document.getElementById('homeMainRegion');
const recentSourcesRail = document.getElementById('recentSourcesRail');
const playerContainer = document.getElementById('playerContainer');

// CBZ viewer elements
const cbzViewer = document.getElementById('cbzViewer');
const cbzPrevBtn = document.getElementById('cbzPrevBtn');
const cbzNextBtn = document.getElementById('cbzNextBtn');
const cbzPageInfo = document.getElementById('cbzPageInfo');
const cbzImage = document.getElementById('cbzImage');
const cbzImageWrap = document.getElementById('cbzImageWrap');

// CBZ progress elements (created dynamically)
let cbzProgressOverlay = document.getElementById('cbzProgressOverlay');
let cbzProgressBar = document.getElementById('cbzProgressBar');
let cbzProgressMessage = document.getElementById('cbzProgressMessage');

// Clip progress overlay elements (used by clip.js but not managed by it)
let clipProgressOverlay = document.getElementById('clipProgressOverlay');
let clipProgressMessage = document.getElementById('clipProgressMessage');
let clipProgressBar = document.getElementById('clipProgressBar');

// Clip overlay (created dynamically by clip.js, all elements declared there)
// clipBtn is declared in clip.js and exposed to window there

// Settings button - handled by settings.js, other settings elements created dynamically

// Spinner wiring
let spinnerVideo = null;
const spinnerHandlers = spinner
  ? {
      loadstart: () => { spinner.style.display = "block"; },
      waiting: () => { spinner.style.display = "block"; },
      canplay: () => { spinner.style.display = "none"; },
      playing: () => { spinner.style.display = "none"; }
    }
  : null;

function wireSpinnerToVideo(target) {
  if (!spinner || !spinnerHandlers) return;
  if (spinnerVideo && spinnerVideo !== target) {
    try { spinnerVideo.removeEventListener("loadstart", spinnerHandlers.loadstart); } catch {}
    try { spinnerVideo.removeEventListener("waiting", spinnerHandlers.waiting); } catch {}
    try { spinnerVideo.removeEventListener("canplay", spinnerHandlers.canplay); } catch {}
    try { spinnerVideo.removeEventListener("playing", spinnerHandlers.playing); } catch {}
  }
  spinnerVideo = target;
  if (!spinnerVideo) return;
  spinnerVideo.addEventListener("loadstart", spinnerHandlers.loadstart);
  spinnerVideo.addEventListener("waiting", spinnerHandlers.waiting);
  spinnerVideo.addEventListener("canplay", spinnerHandlers.canplay);
  spinnerVideo.addEventListener("playing", spinnerHandlers.playing);
}

if (video && spinner) wireSpinnerToVideo(video);

window.MM_getActiveVideoElement = () => video;
window.MM_setActiveVideoElement = (next) => {
  if (!next || next === video) return video;
  video = next;
  wireSpinnerToVideo(video);
  return video;
};

// Pop-out time sync
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'popoutTime') {
    try { if (video) video.currentTime = e.data.currentTime; } catch {}
  }
});
