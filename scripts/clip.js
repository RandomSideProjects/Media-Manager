"use strict";

let lastClipBlob = null;
let lastClipFileName = 'clip.webm';
let lastPreviewObjectURL = null;
let clipPresetsCache = loadClipPresets();
let clipPreferredLength = loadClipPreferredLength();
let currentClipContext = null;

const TRIM_WINDOW_DURATION = 90; // seconds

let trimWindowBase = 0;
let trimScaleDuration = TRIM_WINDOW_DURATION;
let trimState = { start: 0, end: 20 };
let trimDragHandle = null;
let trimMarkerActive = false;
let lastPointerId = null;

const CLIP_HISTORY_KEY = 'clipHistory';
const MAX_CLIP_HISTORY = 6;

function showClipNotice(message, tone = 'warning') {
  if (!message) return;
  if (typeof window.showStorageNotice === 'function') {
    window.showStorageNotice({
      title: 'Clip Tool',
      message,
      tone,
      autoCloseMs: null
    });
  } else if (typeof window.alert === 'function') {
    window.alert(message);
  }
}

function loadClipPresets() {
  try {
    const stored = JSON.parse(localStorage.getItem('clipPresets') || 'null');
    if (Array.isArray(stored)) {
      const cleaned = stored.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n >= 2 && n <= 1800);
      if (cleaned.length) return Array.from(new Set(cleaned));
    }
  } catch {}
  return [10, 20, 30];
}

function loadClipPreferredLength() {
  const raw = localStorage.getItem('clipPreferredLength');
  const parsed = parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function saveClipPreferredLength(seconds) {
  try {
    if (Number.isFinite(seconds) && seconds > 0) localStorage.setItem('clipPreferredLength', String(Math.round(seconds)));
    else localStorage.removeItem('clipPreferredLength');
  } catch {}
  clipPreferredLength = loadClipPreferredLength();
}

function formatTimeForInput(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setTrimState(start, end) {
  const minGap = 0.5;
  const windowDuration = Math.max(minGap, trimScaleDuration);
  let newStart = Math.max(trimWindowBase, Math.min(start, trimWindowBase + windowDuration - minGap));
  let newEnd = Math.max(newStart + minGap, Math.min(end, trimWindowBase + windowDuration));
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    const duration = video.duration;
    newStart = Math.min(newStart, Math.max(0, duration - minGap));
    newEnd = Math.min(newEnd, duration);
    if (newEnd - newStart < minGap) {
      newEnd = Math.min(duration, newStart + minGap);
    }
  }
  trimState = { start: newStart, end: newEnd };
  updateTrimUI();
}

function isPrimaryPointer(event) {
  if (!event) return false;
  if (typeof event.button === 'number' && event.button !== 0) return false;
  return true;
}

function updateTrimUI() {
  const windowDuration = Math.max(0.1, trimScaleDuration);
  let startPct = ((trimState.start - trimWindowBase) / windowDuration) * 100;
  let endPct = ((trimState.end - trimWindowBase) / windowDuration) * 100;
  startPct = Math.max(0, Math.min(100, startPct));
  endPct = Math.max(0, Math.min(100, endPct));
  if (trimRange) {
    trimRange.style.left = `${startPct}%`;
    trimRange.style.width = `${Math.max(0, endPct - startPct)}%`;
  }
  if (trimHandleStart) trimHandleStart.style.left = `${startPct}%`;
  if (trimHandleEnd) trimHandleEnd.style.left = `${endPct}%`;
  if (clipDisplayStart) clipDisplayStart.textContent = formatTimeForInput(trimState.start);
  if (clipDisplayEnd) clipDisplayEnd.textContent = formatTimeForInput(trimState.end);
  if (clipDisplayLength) clipDisplayLength.textContent = formatTimeForInput(trimState.end - trimState.start);
}

function updateTrimPreviewMarker() {
  if (!trimPreviewMarker || !video) return;
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  if (!duration) {
    trimPreviewMarker.style.display = 'none';
    return;
  }
  const windowDuration = Math.max(0.1, trimScaleDuration);
  if (video.currentTime < trimWindowBase || video.currentTime > trimWindowBase + windowDuration) {
    trimPreviewMarker.style.display = 'none';
    return;
  }
  const pct = ((video.currentTime - trimWindowBase) / windowDuration) * 100;
  trimPreviewMarker.style.display = 'block';
  trimPreviewMarker.style.left = `${Math.max(0, Math.min(100, pct))}%`;
}

function stopTrimPreviewMarker() {
  if (!video || !trimMarkerActive) return;
  video.removeEventListener('timeupdate', updateTrimPreviewMarker);
  trimMarkerActive = false;
  if (trimPreviewMarker) trimPreviewMarker.style.display = 'none';
}

function startTrimPreviewMarker() {
  if (!video || trimMarkerActive) return;
  video.addEventListener('timeupdate', updateTrimPreviewMarker);
  trimMarkerActive = true;
  updateTrimPreviewMarker();
}

function secondsFromPointerEvent(e) {
  if (!trimSlider) return trimWindowBase;
  const rect = trimSlider.getBoundingClientRect();
  const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return trimWindowBase + clamped * trimScaleDuration;
}

function applyTrimPointer(handle, seconds) {
  if (handle === 'start') {
    setTrimState(seconds, trimState.end);
  } else {
    setTrimState(trimState.start, seconds);
  }
}

function onTrimPointerMove(e) {
  if (!trimDragHandle) return;
  e.preventDefault();
  const seconds = secondsFromPointerEvent(e);
  applyTrimPointer(trimDragHandle, seconds);
}

function endTrimDrag() {
  if (!trimDragHandle) return;
  trimDragHandle = null;
  window.removeEventListener('pointermove', onTrimPointerMove);
  window.removeEventListener('pointerup', endTrimDrag);
  window.removeEventListener('pointercancel', endTrimDrag);
  if (trimSlider && lastPointerId !== null && typeof trimSlider.releasePointerCapture === 'function') {
    try { trimSlider.releasePointerCapture(lastPointerId); } catch {}
  }
  lastPointerId = null;
}

function beginTrimDrag(handle, event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  trimDragHandle = handle;
  lastPointerId = event && event.pointerId !== undefined ? event.pointerId : null;
  if (trimSlider && lastPointerId !== null && typeof trimSlider.setPointerCapture === 'function') {
    try { trimSlider.setPointerCapture(lastPointerId); } catch {}
  }
  window.addEventListener('pointermove', onTrimPointerMove);
  window.addEventListener('pointerup', endTrimDrag);
  window.addEventListener('pointercancel', endTrimDrag);
  onTrimPointerMove(event);
}

function jumpTrimToPosition(event) {
  if (!trimSlider) return null;
  const seconds = secondsFromPointerEvent(event);
  const distStart = Math.abs(seconds - trimState.start);
  const distEnd = Math.abs(seconds - trimState.end);
  const handle = distStart <= distEnd ? 'start' : 'end';
  applyTrimPointer(handle, seconds);
  return handle;
}

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
      a.download = lastClipFileName || 'clip.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
}

function buildHistoryPreviewHtml() {
  const history = loadClipHistory();
  if (!history.length) return '';
  const items = history.slice(0, 3).map(entry => {
    const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
    const length = Number.isFinite(entry.lengthSeconds) ? `${entry.lengthSeconds}s` : '';
    const title = entry.itemTitle || 'Clip';
    const meta = [length, time].filter(Boolean).join(' • ');
    return `<li><a href="${entry.url}" target="_blank" rel="noopener noreferrer">${title}</a>${meta ? ` <span class="clip-history-preview__meta">(${meta})</span>` : ''}</li>`;
  }).join('');
  return `<div class="clip-history-preview"><div class="clip-history-preview__title">Recent clips</div><ul>${items}</ul></div>`;
}

function displayClipResult(html, isError = false) {
  const historyHtml = buildHistoryPreviewHtml();
  if (clipMessage) {
    clipMessage.innerHTML = '';
    if (Array.isArray(html)) {
      html.forEach((fragment) => {
        const wrapper = document.createElement('div');
        wrapper.className = `clip-result${isError ? ' clip-result--error' : ''}`;
        wrapper.innerHTML = fragment;
        clipMessage.appendChild(wrapper);
      });
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = `clip-result${isError ? ' clip-result--error' : ''}`;
      wrapper.innerHTML = html;
      clipMessage.appendChild(wrapper);
    }
    if (historyHtml) {
      clipMessage.insertAdjacentHTML('beforeend', historyHtml);
    }
    if (clipButtonsRow) clipButtonsRow.style.display = 'flex';
    if (clipOverlay) { clipOverlay.style.display = 'flex'; }
  } else {
    const tmp = document.createElement('div');
    Object.assign(tmp.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em', zIndex: 10000, fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif', textAlign: 'center',
    });
    const box = document.createElement('div');
    Object.assign(box.style, { background: isError ? 'rgba(80,0,0,0.95)' : 'rgba(20,20,20,0.95)', padding: '1em 1.25em', borderRadius: '12px', maxWidth: '540px', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.6)' });
    box.innerHTML = `<div class="clip-result${isError ? ' clip-result--error' : ''}">${html}</div>${historyHtml}`;
    const done = document.createElement('button'); done.textContent = 'Done'; Object.assign(done.style, { marginTop: '1em', padding: '0.5em 1em', cursor: 'pointer' });
    done.addEventListener('click', () => tmp.remove()); box.appendChild(done); tmp.appendChild(box); document.body.appendChild(tmp);
  }
}

function hideClipOverlay() {
  if (!clipOverlay) return;
  clipOverlay.style.display = 'none';
  if (clipButtonsRow) clipButtonsRow.style.display = 'flex';
  if (clipMessage) clipMessage.innerHTML = '';
  if (lastPreviewObjectURL) {
    try { URL.revokeObjectURL(lastPreviewObjectURL); }
    catch {}
    lastPreviewObjectURL = null;
  }
}

async function uploadClipToCatboxWithProgress(blob, onProgress, fileName) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://catbox.moe/user/api.php');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    const uploadName = (typeof fileName === 'string' && fileName.trim()) ? fileName.trim() : 'clip.webm';
    form.append('fileToUpload', blob, uploadName);
    xhr.upload.onprogress = e => { if (e.lengthComputable && typeof onProgress === 'function') { onProgress(e.loaded / e.total * 100); } };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { resolve((xhr.responseText || '').trim()); } else { reject(new Error('Upload failed: ' + xhr.status)); } };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

function getCurrentMediaItem() {
  if (!Array.isArray(flatList)) return null;
  if (typeof currentIndex !== 'number' || currentIndex < 0 || currentIndex >= flatList.length) return null;
  return flatList[currentIndex];
}

function recordClipHistory(entry) {
  if (!entry || !entry.url) return;
  const history = loadClipHistory();
  history.unshift(entry);
  saveClipHistory(history.slice(0, MAX_CLIP_HISTORY));
  renderClipHistoryList();
}

function loadClipHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIP_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function saveClipHistory(list) {
  try { localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list)); }
  catch {}
}

function renderClipHistoryList() {
  if (!clipHistoryList) return;
  clipHistoryList.innerHTML = '';
  const history = loadClipHistory();
  if (!history.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No clips recorded yet.';
    clipHistoryList.appendChild(empty);
    return;
  }
  history.forEach(entry => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '0.25rem';
    const link = document.createElement('a');
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = entry.itemTitle || 'Clip';
    const meta = document.createElement('span');
    meta.className = 'clip-history-preview__meta';
    const bits = [];
    if (entry.lengthSeconds) bits.push(`${entry.lengthSeconds}s`);
    if (entry.sourceTitle) bits.push(entry.sourceTitle);
    if (entry.createdAt) bits.push(new Date(entry.createdAt).toLocaleString());
    meta.textContent = bits.join(' • ');
    row.append(link, meta);
    clipHistoryList.appendChild(row);
  });
}

function clearClipHistory() {
  saveClipHistory([]);
  renderClipHistoryList();
}

function renderClipPresetButtons() {
  if (!clipPresetButtons) return;
  clipPresetButtons.innerHTML = '';
  clipPresetsCache.forEach(seconds => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${seconds}s`;
    btn.addEventListener('click', () => {
      const remember = clipRememberPreset && clipRememberPreset.checked;
      if (remember) saveClipPreferredLength(seconds);
      else saveClipPreferredLength(null);
      closeClipPresetOverlay();
      startClipCapture(seconds);
    });
    clipPresetButtons.appendChild(btn);
  });
}

function openClipPresetOverlay() {
  if (!clipPresetOverlay) return;
  clipPresetsCache = loadClipPresets();
  clipPreferredLength = loadClipPreferredLength();
  renderClipPresetButtons();
  renderClipHistoryList();
  if (clipRememberPreset) clipRememberPreset.checked = Number.isFinite(clipPreferredLength);

  const fallbackLength = Math.max(1, clipPreferredLength || 20);
  const hasVideo = video && Number.isFinite(video.currentTime);
  const duration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  trimScaleDuration = duration ? Math.min(TRIM_WINDOW_DURATION, duration) : TRIM_WINDOW_DURATION;
  if (!Number.isFinite(trimScaleDuration) || trimScaleDuration <= 0) {
    trimScaleDuration = TRIM_WINDOW_DURATION;
  }
  const current = hasVideo ? video.currentTime : 0;
  if (duration) {
    if (duration <= trimScaleDuration) {
      trimWindowBase = 0;
      trimScaleDuration = duration;
    } else {
      const halfWindow = trimScaleDuration / 2;
      trimWindowBase = Math.max(0, Math.min(current - halfWindow, duration - trimScaleDuration));
    }
  } else {
    trimWindowBase = Math.max(0, current - trimScaleDuration / 2);
  }

  let startDefault = Math.max(trimWindowBase, current - fallbackLength / 2);
  let endDefault = Math.min(trimWindowBase + trimScaleDuration, startDefault + fallbackLength);
  if (endDefault - startDefault < 0.5) {
    endDefault = Math.min(trimWindowBase + trimScaleDuration, startDefault + Math.max(0.5, fallbackLength));
  }
  if (startDefault < trimWindowBase) startDefault = trimWindowBase;
  if (endDefault > trimWindowBase + trimScaleDuration) endDefault = trimWindowBase + trimScaleDuration;
  setTrimState(startDefault, endDefault);

  if (duration) startTrimPreviewMarker();
  else if (trimPreviewMarker) trimPreviewMarker.style.display = 'none';

  clipPresetOverlay.style.display = 'flex';
  updateTrimPreviewMarker();
  if (trimHandleStart) {
    try { trimHandleStart.focus(); } catch {}
  }
}

function closeClipPresetOverlay() {
  if (clipPresetOverlay) clipPresetOverlay.style.display = 'none';
  stopTrimPreviewMarker();
  if (trimPreviewMarker) trimPreviewMarker.style.display = 'none';
  endTrimDrag();
}

async function startClipCapture(lengthSeconds) {
  if (!video) return;
  const total = Math.max(2, Number(lengthSeconds) || 20);
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const duration = Number.isFinite(video.duration) ? video.duration : NaN;
  let start = Math.max(0, currentTime - total / 2);
  let end = currentTime + total / 2;
  if (Number.isFinite(duration) && duration > 0) {
    if (end > duration) {
      const overflow = end - duration;
      start = Math.max(0, start - overflow);
      end = duration;
    }
    if (start < 0) {
      const under = -start;
      start = 0;
      end = Math.min(duration, end + under);
    }
    if (end - start < total) {
      end = Math.min(duration, start + total);
    }
  }
  const actualDuration = Math.max(1, end - start);
  video.pause();
  await executeClipCapture(start, end, actualDuration);
}

async function startClipRange(rangeStart, rangeEnd) {
  if (!video) return;
  let start = Number(rangeStart);
  let end = Number(rangeEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  start = Math.max(trimWindowBase, start);
  end = Math.min(trimWindowBase + trimScaleDuration, end);
  const duration = Number.isFinite(video.duration) ? video.duration : NaN;
  start = Math.max(0, start);
  if (Number.isFinite(duration)) {
    end = Math.min(end, duration);
    start = Math.min(start, Math.max(0, duration - 0.5));
  }
  if (end <= start) return;
  const actualDuration = Math.max(0.5, end - start);
  video.pause();
  await executeClipCapture(start, end, actualDuration);
}

async function executeClipCapture(start, end, durationSeconds) {
  const overlay = clipProgressOverlay;
  const msg = clipProgressMessage;
  const bar = clipProgressBar;
  if (!overlay || !msg || !bar) return;
  overlay.style.display = 'flex';
  msg.textContent = 'Preparing clip...';
  bar.value = 0;

  const hiddenVideo = document.createElement('video');
  hiddenVideo.muted = false;
  hiddenVideo.preload = 'auto';
  hiddenVideo.crossOrigin = 'anonymous';
  hiddenVideo.style.position = 'absolute';
  hiddenVideo.style.left = '-9999px';
  hiddenVideo.style.width = '1px';
  hiddenVideo.style.height = '1px';
  hiddenVideo.style.opacity = '0';
  hiddenVideo.setAttribute('playsinline', '');
  document.body.appendChild(hiddenVideo);

  try {
    hiddenVideo.src = video.src;
    await new Promise(resolve => {
      const onMeta = () => { hiddenVideo.removeEventListener('loadedmetadata', onMeta); resolve(); };
      hiddenVideo.addEventListener('loadedmetadata', onMeta);
    });
    await new Promise(resolve => {
      const onSeeked = () => { hiddenVideo.removeEventListener('seeked', onSeeked); resolve(); };
      hiddenVideo.addEventListener('seeked', onSeeked);
      hiddenVideo.currentTime = start;
    });
    hiddenVideo.play();
    await new Promise(resolve => {
      const onPlaying = () => { hiddenVideo.removeEventListener('playing', onPlaying); resolve(); };
      hiddenVideo.addEventListener('playing', onPlaying);
    });
    await new Promise(r => setTimeout(r, 100));

    let stream;
    let canvas;
    let canvasDrawLoop;
    if (typeof hiddenVideo.captureStream === 'function') {
      stream = hiddenVideo.captureStream();
      if (stream.getAudioTracks().length === 0) {
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          await audioCtx.resume().catch(() => {});
          const sourceNode = audioCtx.createMediaElementSource(hiddenVideo);
          const dest = audioCtx.createMediaStreamDestination();
          sourceNode.connect(dest);
          stream = new MediaStream([ ...stream.getVideoTracks(), ...dest.stream.getAudioTracks() ]);
        } catch (err) { console.warn('Supplementing audio failed, proceeding with original stream.', err); }
      }
    } else {
      canvas = document.createElement('canvas');
      canvas.width = hiddenVideo.videoWidth || 640;
      canvas.height = hiddenVideo.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      canvasDrawLoop = () => {
        ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
        if (recorder && recorder.state === 'recording') requestAnimationFrame(canvasDrawLoop);
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
      } catch (e) { console.warn('Audio capture fallback failed, proceeding without audio.', e); }
      stream = audioStream ? new MediaStream([ ...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks() ]) : canvasStream;
    }

    const preferredMimeTypes = [
      'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    let chosenMime = '';
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
      for (const candidate of preferredMimeTypes) {
        try {
          if (MediaRecorder.isTypeSupported(candidate)) {
            chosenMime = candidate;
            break;
          }
        } catch {}
      }
    }
    let recorder;
    const recordedChunks = [];
    try {
      recorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
    } catch {
      recorder = new MediaRecorder(stream);
      chosenMime = recorder && recorder.mimeType ? recorder.mimeType : chosenMime;
    }
    const effectiveMime = (recorder && recorder.mimeType) ? recorder.mimeType : (chosenMime || 'video/webm');
    const clipExtension = /mp4/i.test(effectiveMime) ? 'mp4' : 'webm';
    lastClipFileName = `clip.${clipExtension}`;
    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };

    const durationMs = durationSeconds * 1000;
    const recordStart = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - recordStart;
      bar.value = Math.min(100, (elapsed / durationMs) * 100);
    }, 100);

    recorder.start();
    if (canvasDrawLoop) requestAnimationFrame(canvasDrawLoop);
    await new Promise(resolve => setTimeout(resolve, durationMs));
    recorder.stop();
    await new Promise(resolve => { recorder.onstop = () => resolve(); });
    clearInterval(progressInterval);

    const blobType = effectiveMime || (recordedChunks[0] ? recordedChunks[0].type : 'video/webm');
    const blob = new Blob(recordedChunks, { type: blobType });
    lastClipBlob = blob;
    bar.value = 100;
    overlay.style.display = 'none';

    const previewEnabled = (localStorage.getItem('clipPreviewEnabled') === 'true');
    let previewHTML = '';
    if (previewEnabled) {
      try {
        if (lastPreviewObjectURL) { URL.revokeObjectURL(lastPreviewObjectURL); lastPreviewObjectURL = null; }
        lastPreviewObjectURL = URL.createObjectURL(blob);
        previewHTML = `<video class="clip-preview-video" src="${lastPreviewObjectURL}" controls playsinline></video>`;
      } catch {}
    }

    const item = getCurrentMediaItem();
    currentClipContext = {
      lengthSeconds: Math.round(durationSeconds),
      itemTitle: item && item.title ? item.title : 'Clip',
      sourceTitle: directoryTitle && directoryTitle.textContent ? directoryTitle.textContent : '',
      createdAt: new Date().toISOString()
    };

    try {
      if (clipButtonsRow) clipButtonsRow.style.display = 'none';
      msg.textContent = 'Uploading clip...';
      bar.value = 0;
      overlay.style.display = 'flex';
      const url = await uploadClipToCatboxWithProgress(blob, p => { bar.value = p; }, lastClipFileName);
      overlay.style.display = 'none';
      const fragments = [`
        <div class="clip-result__title">Clip uploaded!</div>
        ${previewHTML}
        <p class="clip-result__detail clip-result__detail--muted">Saved as ${lastClipFileName || 'clip.webm'}</p>
        <p class="clip-result__detail clip-result__detail--muted">URL copied below:</p>
      `,
      `<div class="clip-result__detail clip-result__detail--link">` +
        `<a class="clip-result__link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` +
      `</div>`];
      displayClipResult(fragments);
      recordClipHistory({ ...currentClipContext, url });
      ensureClipDownloadButton();
    } catch (err) {
      overlay.style.display = 'none';
      const localUrl = (() => { try { return URL.createObjectURL(blob); } catch { return ''; } })();
      const fragments = [`
        <div class="clip-result__title">Upload failed</div>
        <p class="clip-result__detail">${err.message}</p>
        ${previewHTML}
      `,
      `<p class="clip-result__detail clip-result__detail--muted">` +
        `Would you like to <a class="clip-result__link" href="${localUrl}" download="${lastClipFileName || 'clip.webm'}">download</a> the clip instead?` +
      `</p>`];
      displayClipResult(fragments, true);
      ensureClipDownloadButton();
    }
  } finally {
    if (hiddenVideo && hiddenVideo.parentElement) hiddenVideo.remove();
    currentClipContext = null;
  }
}

if (clipBtn) {
  clipBtn.addEventListener('click', (event) => {
    event.preventDefault();
    clipPreferredLength = loadClipPreferredLength();
    clipPresetsCache = loadClipPresets();
    if (clipPreferredLength && !event.shiftKey && !event.altKey) {
      startClipCapture(clipPreferredLength);
    } else {
      openClipPresetOverlay();
    }
  });
}

if (clipPresetCloseBtn) clipPresetCloseBtn.addEventListener('click', closeClipPresetOverlay);
if (clipPresetOverlay) {
  clipPresetOverlay.addEventListener('click', (e) => { if (e.target === clipPresetOverlay) closeClipPresetOverlay(); });
}

if (clipCustomStartBtn) {
  clipCustomStartBtn.addEventListener('click', () => {
    if (!video) {
      showClipNotice('Clip playback is not ready yet.', 'warning');
      return;
    }
    const clampedStart = trimState.start;
    const clampedEnd = trimState.end;
    if (clampedEnd - clampedStart < 0.5) {
      showClipNotice('Clip length must be at least half a second.', 'error');
      return;
    }
    const remember = clipRememberPreset && clipRememberPreset.checked;
    if (remember) saveClipPreferredLength(clampedEnd - clampedStart);
    else saveClipPreferredLength(null);
    closeClipPresetOverlay();
    startClipRange(clampedStart, clampedEnd);
  });
}

if (trimHandleStart) {
  trimHandleStart.addEventListener('pointerdown', (e) => {
    if (!isPrimaryPointer(e)) return;
    beginTrimDrag('start', e);
  });
}
if (trimHandleEnd) {
  trimHandleEnd.addEventListener('pointerdown', (e) => {
    if (!isPrimaryPointer(e)) return;
    beginTrimDrag('end', e);
  });
}
if (trimSlider) {
  trimSlider.addEventListener('pointerdown', (e) => {
    if (!isPrimaryPointer(e)) return;
    if (e.target === trimHandleStart || e.target === trimHandleEnd) return;
    const handle = jumpTrimToPosition(e);
    if (handle) beginTrimDrag(handle, e);
  });
}

if (clipHistoryClearBtn) clipHistoryClearBtn.addEventListener('click', () => { clearClipHistory(); });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (clipPresetOverlay && clipPresetOverlay.style.display === 'flex') {
      e.preventDefault();
      closeClipPresetOverlay();
      return;
    }
    if (clipOverlay && clipOverlay.style.display === 'flex') {
      hideClipOverlay();
    }
  }
});

if (clipDoneBtn && clipOverlay) {
  clipDoneBtn.addEventListener('click', () => {
    hideClipOverlay();
  });
}

if (clipOverlayCloseBtn) {
  clipOverlayCloseBtn.addEventListener('click', () => { hideClipOverlay(); });
}

if (clipOverlay) {
  clipOverlay.addEventListener('click', (event) => {
    if (event.target === clipOverlay) hideClipOverlay();
  });
}

if (clipDownloadBtn) {
  clipDownloadBtn.addEventListener('click', () => {
    if (!lastClipBlob) return;
    const url = URL.createObjectURL(lastClipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = lastClipFileName || 'clip.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

updateTrimUI();
ensureClipDownloadButton();
renderClipHistoryList();
