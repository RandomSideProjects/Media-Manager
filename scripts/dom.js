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

// Settings button - handled by settings.js, other settings elements created dynamically

// Video loading card wiring
let spinnerVideo = null;
let loadingHideTimer = null;
let loadingElapsedTimer = null;
let loadingStartedAt = 0;
const videoLoadingServer = document.getElementById('videoLoadingServer');
const videoLoadingStatus = document.getElementById('videoLoadingStatus');
const videoLoadingElapsed = document.getElementById('videoLoadingElapsed');
const videoLoadingProgress = document.getElementById('videoLoadingProgress');
const videoLoadingProgressFill = document.getElementById('videoLoadingProgressFill');
let videoLoadingSource = '';
let videoLoadingDurationHint = 0;

function getVideoLoadingServerLabel(source) {
  const value = typeof source === 'string' ? source.trim() : '';
  if (!value) return '—';
  if (/^(blob:|data:|file:)/i.test(value)) return 'THIS DEVICE';
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol === 'blob:' || parsed.protocol === 'file:') return 'THIS DEVICE';
    return (parsed.host || parsed.hostname || '—').toUpperCase();
  } catch {
    return '—';
  }
}

function setVideoLoadingSource(source) {
  videoLoadingSource = typeof source === 'string' ? source.trim() : '';
  if (videoLoadingServer) videoLoadingServer.textContent = getVideoLoadingServerLabel(videoLoadingSource);
}

function setVideoLoadingDurationHint(duration) {
  const value = Number(duration);
  videoLoadingDurationHint = Number.isFinite(value) && value > 0 ? value : 0;
}

function setVideoLoadingProgress(target) {
  if (!videoLoadingProgress || !videoLoadingProgressFill) return;
  const media = target || spinnerVideo;
  let ratio = 0;
  const mediaDuration = media && Number.isFinite(Number(media.duration)) && media.duration > 0
    ? Number(media.duration)
    : videoLoadingDurationHint;
  if (media && mediaDuration > 0 && media.buffered && media.buffered.length) {
    try {
      const bufferedEnd = media.buffered.end(media.buffered.length - 1);
      ratio = Math.max(0, Math.min(1, bufferedEnd / mediaDuration));
    } catch {}
  }

  videoLoadingProgressFill.classList.remove('is-indeterminate');
  videoLoadingProgressFill.style.setProperty('--mm-loading-progress', String(ratio));
  videoLoadingProgress.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  if (videoLoadingStatus && ratio < 1) videoLoadingStatus.textContent = 'Loading video data';
}

function formatVideoLoadingElapsed(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function updateVideoLoadingElapsed() {
  if (!videoLoadingElapsed || !loadingStartedAt) return;
  videoLoadingElapsed.textContent = `Elapsed ${formatVideoLoadingElapsed((Date.now() - loadingStartedAt) / 1000)}`;
}

function stopVideoLoadingElapsed() {
  if (loadingElapsedTimer) {
    clearInterval(loadingElapsedTimer);
    loadingElapsedTimer = null;
  }
}

function showVideoLoading(target) {
  if (!spinner) return;
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  if (!loadingStartedAt) loadingStartedAt = Date.now();
  stopVideoLoadingElapsed();
  updateVideoLoadingElapsed();
  loadingElapsedTimer = setInterval(updateVideoLoadingElapsed, 1000);
  if (videoLoadingStatus) videoLoadingStatus.textContent = 'Preparing playback';
  setVideoLoadingProgress(target);
  if (videoLoadingServer) videoLoadingServer.textContent = getVideoLoadingServerLabel(videoLoadingSource);
  spinner.hidden = false;
  spinner.style.display = 'flex';
  requestAnimationFrame(() => spinner.classList.add('is-visible'));
}

function hideVideoLoading() {
  if (!spinner) return;
  stopVideoLoadingElapsed();
  loadingStartedAt = 0;
  spinner.classList.remove('is-visible');
  loadingHideTimer = setTimeout(() => {
    spinner.hidden = true;
    spinner.style.display = 'none';
    loadingHideTimer = null;
  }, 220);
}

window.MM_showVideoLoading = showVideoLoading;
window.MM_hideVideoLoading = hideVideoLoading;
window.MM_setVideoLoadingSource = setVideoLoadingSource;
window.MM_setVideoLoadingDurationHint = setVideoLoadingDurationHint;

const spinnerHandlers = spinner
  ? {
      loadstart: (event) => showVideoLoading(event.currentTarget),
      progress: (event) => setVideoLoadingProgress(event.currentTarget),
      loadedmetadata: (event) => setVideoLoadingProgress(event.currentTarget),
      durationchange: (event) => setVideoLoadingProgress(event.currentTarget),
      playing: () => hideVideoLoading(),
      error: () => hideVideoLoading()
    }
  : null;

function wireSpinnerToVideo(target) {
  if (!spinner || !spinnerHandlers) return;
  if (spinnerVideo && spinnerVideo !== target) {
    try { spinnerVideo.removeEventListener("loadstart", spinnerHandlers.loadstart); } catch {}
    try { spinnerVideo.removeEventListener("progress", spinnerHandlers.progress); } catch {}
    try { spinnerVideo.removeEventListener("loadedmetadata", spinnerHandlers.loadedmetadata); } catch {}
    try { spinnerVideo.removeEventListener("durationchange", spinnerHandlers.durationchange); } catch {}
    try { spinnerVideo.removeEventListener("playing", spinnerHandlers.playing); } catch {}
    try { spinnerVideo.removeEventListener("error", spinnerHandlers.error); } catch {}
  }
  spinnerVideo = target;
  if (!spinnerVideo) return;
  spinnerVideo.addEventListener("loadstart", spinnerHandlers.loadstart);
  spinnerVideo.addEventListener("progress", spinnerHandlers.progress);
  spinnerVideo.addEventListener("loadedmetadata", spinnerHandlers.loadedmetadata);
  spinnerVideo.addEventListener("durationchange", spinnerHandlers.durationchange);
  spinnerVideo.addEventListener("playing", spinnerHandlers.playing);
  spinnerVideo.addEventListener("error", spinnerHandlers.error);
  try { spinnerVideo.preload = 'auto'; } catch {}
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
