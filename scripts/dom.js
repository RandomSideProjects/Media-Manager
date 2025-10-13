"use strict";

// Element refs
const video = document.getElementById("videoPlayer");
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

// CBZ viewer elements
const cbzViewer = document.getElementById('cbzViewer');
const cbzPrevBtn = document.getElementById('cbzPrevBtn');
const cbzNextBtn = document.getElementById('cbzNextBtn');
const cbzPageInfo = document.getElementById('cbzPageInfo');
const cbzImage = document.getElementById('cbzImage');

// CBZ progress elements
const cbzProgressOverlay = document.getElementById('cbzProgressOverlay');
const cbzProgressBar = document.getElementById('cbzProgressBar');
const cbzProgressMessage = document.getElementById('cbzProgressMessage');

// Clip overlay
const clipBtn = document.getElementById('clipBtn');
const clipOverlay = document.getElementById('clipOverlay');
const clipOverlayCloseBtn = document.getElementById('clipOverlayCloseBtn');
const clipMessage = document.getElementById('clipMessage');
const clipDoneBtn = document.getElementById('clipDoneBtn');
const clipDownloadBtn = document.getElementById('clipDownloadBtn');
const clipButtonsRow = document.getElementById('clipButtonsRow');
const clipProgressOverlay = document.getElementById('clipProgressOverlay');
const clipProgressMessage = document.getElementById('clipProgressMessage');
const clipProgressBar = document.getElementById('clipProgressBar');

// Clip preset/history elements
const clipPresetOverlay = document.getElementById('clipPresetOverlay');
const clipPresetButtons = document.getElementById('clipPresetButtons');
const clipCustomStartBtn = document.getElementById('clipCustomStartBtn');
const clipRememberPreset = document.getElementById('clipRememberPreset');
const clipPresetCloseBtn = document.getElementById('clipPresetCloseBtn');
const clipHistoryList = document.getElementById('clipHistoryList');
const clipHistoryClearBtn = document.getElementById('clipHistoryClearBtn');
const trimSlider = document.getElementById('trimSlider');
const trimRange = document.getElementById('trimRange');
const trimHandleStart = document.getElementById('trimHandleStart');
const trimHandleEnd = document.getElementById('trimHandleEnd');
const trimPreviewMarker = document.getElementById('trimPreviewMarker');
const clipDisplayStart = document.getElementById('clipDisplayStart');
const clipDisplayEnd = document.getElementById('clipDisplayEnd');
const clipDisplayLength = document.getElementById('clipDisplayLength');

// Settings elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const clipToggle = document.getElementById('clipToggle');
const clipPreviewToggle = document.getElementById('clipPreviewToggle');
const selectiveDownloadToggle = document.getElementById('selectiveDownloadToggle');
const downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
const downloadConcurrencyValue = document.getElementById('downloadConcurrencyValue');

// Spinner wiring
if (video && spinner) {
  video.addEventListener("loadstart", () => { spinner.style.display = "block"; });
  video.addEventListener("waiting", () => { spinner.style.display = "block"; });
  video.addEventListener("canplay", () => { spinner.style.display = "none"; });
  video.addEventListener("playing", () => { spinner.style.display = "none"; });
}

// Pop-out time sync
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'popoutTime') {
    try { if (video) video.currentTime = e.data.currentTime; } catch {}
  }
});
