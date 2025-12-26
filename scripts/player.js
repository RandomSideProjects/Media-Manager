"use strict";

// --- Manga (CBZ/JSON) viewer state and helpers ---
let cbzState = {
  active: false,
  pages: [],
  index: 0
};
let cbzObjectUrls = [];
let cbzCache = new Map(); // key -> { pages: string[] }
let cbzCurrentKey = '';
let cbzProgressBase = 0; // base percent before extraction phase

// Adjust this to change how many pages are preloaded ahead/behind the current page.
let cbzPreloadAheadCount = 20;
const cbzPreloadedImages = new Map();

function isMangaVolumeItem(item) {
  if (!item) return false;
  const nameFromSrc = (typeof item.src === 'string') ? item.src : '';
  const fileName = (item.fileName || '').toLowerCase();
  const lowerSrc = nameFromSrc.toLowerCase();
  const hasCbzInSrc = /\.(cbz)(?:$|[?#])/i.test(lowerSrc);
  const hasCbzInName = fileName.endsWith('.cbz');
  const hasJsonInSrc = /\.(json)(?:$|[?#])/i.test(lowerSrc);
  const hasJsonInName = fileName.endsWith('.json');
  return hasCbzInSrc || hasCbzInName || hasJsonInSrc || hasJsonInName;
}

function clearCbzUrls() {
  try {
    cbzObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  } catch {}
  cbzObjectUrls = [];
}

function hasSeparatedParts(item) {
  return !!(item && Array.isArray(item.__separatedParts) && item.__separatedParts.length > 0);
}

function getSeparatedMeta(item) {
  if (!hasSeparatedParts(item)) return null;
  const parts = item.__separatedParts;
  let offsets = Array.isArray(item.__separatedOffsets) && item.__separatedOffsets.length === parts.length
    ? item.__separatedOffsets.slice()
    : null;
  let derivedTotal = 0;
  if (!offsets) {
    offsets = [];
    let running = 0;
    const fallbackDurations = Array.isArray(item.__separatedDurations) ? item.__separatedDurations : [];
    parts.forEach((part, idx) => {
      offsets.push(running);
      let d = Number(part && part.durationSeconds);
      if (!Number.isFinite(d) || d <= 0) {
        const fallback = Number(fallbackDurations[idx]);
        if (Number.isFinite(fallback) && fallback > 0) d = fallback;
      }
      if (Number.isFinite(d) && d > 0) running += d;
    });
    derivedTotal = running;
  } else {
    const fallbackDurations = Array.isArray(item.__separatedDurations) ? item.__separatedDurations : [];
    derivedTotal = offsets[offsets.length - 1] || 0;
    const lastIdx = parts.length - 1;
    if (lastIdx >= 0) {
      let lastDur = Number(parts[lastIdx] && parts[lastIdx].durationSeconds);
      if (!Number.isFinite(lastDur) || lastDur <= 0) {
        const fallback = Number(fallbackDurations[lastIdx]);
        if (Number.isFinite(fallback) && fallback > 0) lastDur = fallback;
      }
      if (Number.isFinite(lastDur) && lastDur > 0) derivedTotal += lastDur;
    }
  }
  let totalDuration = Number(item.__separatedTotalDuration);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    const lastOffset = offsets[offsets.length - 1] || 0;
    const lastPart = parts[parts.length - 1];
    let lastDuration = Number(lastPart && lastPart.durationSeconds);
    if (!Number.isFinite(lastDuration) || lastDuration <= 0) {
      const fallbackDur = Array.isArray(item.__separatedDurations) ? Number(item.__separatedDurations[parts.length - 1]) : NaN;
      if (Number.isFinite(fallbackDur) && fallbackDur > 0) lastDuration = fallbackDur;
    }
    const inferred = lastOffset + (Number.isFinite(lastDuration) && lastDuration > 0 ? lastDuration : 0);
    totalDuration = inferred > 0 ? inferred : (derivedTotal > 0 ? derivedTotal : Number(item.durationSeconds));
  }
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) totalDuration = null;
  return { parts, offsets, totalDuration };
}

function getPartDuration(meta, item, index) {
  if (!meta || !meta.parts || index < 0 || index >= meta.parts.length) return 0;
  const part = meta.parts[index];
  let d = Number(part && part.durationSeconds);
  if (!Number.isFinite(d) || d <= 0) {
    const fallback = item && Array.isArray(item.__separatedDurations) ? Number(item.__separatedDurations[index]) : NaN;
    if (Number.isFinite(fallback) && fallback > 0) d = fallback;
  }
  if (!Number.isFinite(d) || d <= 0) {
    const nextOffset = meta.offsets[index + 1];
    const currentOffset = meta.offsets[index] || 0;
    if (Number.isFinite(nextOffset)) d = Math.max(0, nextOffset - currentOffset);
  }
  return Number.isFinite(d) && d > 0 ? d : 0;
}

// --- Separated part prefetch (best-effort) ---
// Goal: warm up the browser cache with ~first 10% of the next part so the switch is less likely to stall.
const SEPARATED_NEXT_PART_PREFETCH_FRACTION = 0.10;
const SEPARATED_NEXT_PART_PREFETCH_TRIGGER_RATIO = 0.80; // start prefetch when current part is ~80% done
const SEPARATED_NEXT_PART_PREFETCH_TRIGGER_REMAINING_SECONDS = 90; // or within last N seconds
const SEPARATED_NEXT_PART_PREFETCH_MIN_BUFFER_AHEAD_SECONDS = 6; // avoid competing with current playback
const SEPARATED_NEXT_PART_PREFETCH_MIN_BYTES = 512 * 1024;
const SEPARATED_NEXT_PART_PREFETCH_MAX_BYTES = 25 * 1024 * 1024;
const SEPARATED_NEXT_PART_PREFETCH_FALLBACK_BYTES = 8 * 1024 * 1024;
const SEPARATED_NEXT_PART_PREFETCH_METHOD_KEY = 'dev:partPreloadMethod'; // 'fetch' | 'video' | 'swap'

let separatedNextPartPrefetchState = {
  src: '',
  targetPartIndex: -1,
  controller: null
};

const separatedNextPartPrefetchHistory = new Map(); // src -> { ok, attempts, ts }
let separatedNextPartPrefetchVideo = null;

let separatedSwapPreload = {
  stack: null,
  standby1: null,
  standby1Src: '',
  standby2: null,
  standby2Src: '',
  slot1: { src: '', bytesTarget: 0, controller: null },
  slot2: { src: '', bytesTarget: 0, controller: null }
};

let activeVideoListenersAttachedTo = null;

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(num, max));
}

function getSeparatedNextPartPrefetchMethod() {
  try {
    const stored = localStorage.getItem(SEPARATED_NEXT_PART_PREFETCH_METHOD_KEY);
    const value = (typeof stored === 'string') ? stored.trim().toLowerCase() : '';
    if (value === 'video') return 'video';
    if (value === 'swap') return 'swap';
    if (value === 'fetch') return 'fetch';
    return 'swap';
  } catch {
    return 'swap';
  }
}

function ensureSeparatedSwapStack() {
  if (!video || typeof document === 'undefined') return null;
  const parent = video.parentElement;
  if (!parent) return null;
  if (parent && parent.classList && parent.classList.contains('mm-video-stack')) {
    separatedSwapPreload.stack = parent;
    return parent;
  }
  try {
    const stack = document.createElement('div');
    stack.className = 'mm-video-stack';
    parent.insertBefore(stack, video);
    stack.appendChild(video);
    separatedSwapPreload.stack = stack;
    return stack;
  } catch {
    return null;
  }
}

function ensureSeparatedSwapStandby() {
  const stack = ensureSeparatedSwapStack();
  if (!stack || typeof document === 'undefined') return null;
  if (separatedSwapPreload.standby1 && separatedSwapPreload.standby1.isConnected) return separatedSwapPreload.standby1;
  try {
    const standby = document.createElement('video');
    standby.muted = true;
    standby.preload = 'auto';
    standby.playsInline = true;
    standby.setAttribute('aria-hidden', 'true');
    standby.setAttribute('data-mm-video-role', 'standby-1');
    standby.classList.add('mm-video-hidden');
    // Match common player attributes where possible
    try { standby.controls = !!(video && video.controls); } catch {}
    stack.appendChild(standby);
    separatedSwapPreload.standby1 = standby;
    separatedSwapPreload.standby1Src = '';
    return separatedSwapPreload.standby1;
  } catch {
    return null;
  }
}

function ensureSeparatedSwapStandby2() {
  const stack = ensureSeparatedSwapStack();
  if (!stack || typeof document === 'undefined') return null;
  if (separatedSwapPreload.standby2 && separatedSwapPreload.standby2.isConnected) return separatedSwapPreload.standby2;
  try {
    const standby = document.createElement('video');
    standby.muted = true;
    standby.preload = 'auto';
    standby.playsInline = true;
    standby.setAttribute('aria-hidden', 'true');
    standby.setAttribute('data-mm-video-role', 'standby-2');
    standby.classList.add('mm-video-hidden');
    try { standby.controls = !!(video && video.controls); } catch {}
    stack.appendChild(standby);
    separatedSwapPreload.standby2 = standby;
    separatedSwapPreload.standby2Src = '';
    return separatedSwapPreload.standby2;
  } catch {
    return null;
  }
}

function abortSwapFetchSlot(slot) {
  const st = slot === 2 ? separatedSwapPreload.slot2 : separatedSwapPreload.slot1;
  if (st && st.controller) {
    try { st.controller.abort(); } catch {}
  }
  if (st) {
    st.controller = null;
    st.src = '';
    st.bytesTarget = 0;
  }
}

function clearSwapFetchController(controller) {
  if (!controller) return;
  if (separatedSwapPreload.slot1 && separatedSwapPreload.slot1.controller === controller) {
    separatedSwapPreload.slot1.controller = null;
  }
  if (separatedSwapPreload.slot2 && separatedSwapPreload.slot2.controller === controller) {
    separatedSwapPreload.slot2.controller = null;
  }
}

function resetSeparatedSwapPreload() {
  abortSwapFetchSlot(1);
  abortSwapFetchSlot(2);

  const standby1 = separatedSwapPreload.standby1;
  const standby2 = separatedSwapPreload.standby2;
  separatedSwapPreload.standby1Src = '';
  separatedSwapPreload.standby2Src = '';
  if (standby1) {
    try { standby1.pause(); } catch {}
    try { standby1.removeAttribute('src'); } catch {}
    try { standby1.load(); } catch {}
    try { standby1.remove(); } catch {}
  }
  if (standby2) {
    try { standby2.pause(); } catch {}
    try { standby2.removeAttribute('src'); } catch {}
    try { standby2.load(); } catch {}
    try { standby2.remove(); } catch {}
  }
  separatedSwapPreload.standby1 = null;
  separatedSwapPreload.standby2 = null;
  separatedSwapPreload.stack = null;
}

function setActiveVideoElement(next) {
  if (!next) return;
  if (typeof window !== 'undefined' && window.MM_setActiveVideoElement && typeof window.MM_setActiveVideoElement === 'function') {
    try { window.MM_setActiveVideoElement(next); } catch {}
  } else {
    try { video = next; } catch {}
  }
  attachActiveVideoListeners(video);
}

function resetSeparatedNextPartPrefetch() {
  if (separatedNextPartPrefetchState.controller) {
    try { separatedNextPartPrefetchState.controller.abort(); } catch {}
  }
  separatedNextPartPrefetchState.controller = null;
  separatedNextPartPrefetchState.src = '';
  separatedNextPartPrefetchState.targetPartIndex = -1;
  if (separatedNextPartPrefetchVideo) {
    try { separatedNextPartPrefetchVideo.pause(); } catch {}
    try { separatedNextPartPrefetchVideo.removeAttribute('src'); } catch {}
    try { separatedNextPartPrefetchVideo.load(); } catch {}
  }
  resetSeparatedSwapPreload();
}

function recordSeparatedNextPartPrefetch(src, ok) {
  if (!src) return;
  const prev = separatedNextPartPrefetchHistory.get(src);
  const attempts = (prev && Number.isFinite(prev.attempts)) ? prev.attempts + 1 : 1;
  separatedNextPartPrefetchHistory.set(src, { ok: !!ok, attempts, ts: Date.now() });
  if (separatedNextPartPrefetchHistory.size > 200) {
    const entries = Array.from(separatedNextPartPrefetchHistory.entries())
      .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    for (let i = 0; i < Math.max(0, entries.length - 200); i++) {
      separatedNextPartPrefetchHistory.delete(entries[i][0]);
    }
  }
}

function computeSeparatedNextPartPrefetchBytes(part) {
  const size = Number(part && part.fileSizeBytes);
  if (Number.isFinite(size) && size > 0) {
    const requested = Math.ceil(size * SEPARATED_NEXT_PART_PREFETCH_FRACTION);
    const clamped = clampNumber(requested, SEPARATED_NEXT_PART_PREFETCH_MIN_BYTES, SEPARATED_NEXT_PART_PREFETCH_MAX_BYTES);
    return Math.min(size, clamped);
  }
  return SEPARATED_NEXT_PART_PREFETCH_FALLBACK_BYTES;
}

function safeBufferedEnd(el) {
  try {
    if (!el || !el.buffered || el.buffered.length === 0) return 0;
    return Number(el.buffered.end(el.buffered.length - 1)) || 0;
  } catch {
    return 0;
  }
}

async function prefetchFirstBytes(url, bytes, signal) {
  if (!url || typeof url !== 'string') return false;
  if (typeof fetch !== 'function') return false;
  const targetBytes = Math.max(1, Math.floor(Number(bytes) || 0));
  if (targetBytes <= 0) return false;

  try {
    const headers = new Headers();
    headers.set('Range', `bytes=0-${Math.max(0, targetBytes - 1)}`);
    const res = await fetch(url, { method: 'GET', headers, cache: 'force-cache', credentials: 'omit', signal });
    if (!res) return false;

    // Some hosts ignore range; we still stop reading early.
    const okStatus = res.status === 206 || res.status === 200;
    if (!okStatus) return false;

    if (!res.body || typeof res.body.getReader !== 'function') return true;
    const reader = res.body.getReader();
    let received = 0;
    while (received < targetBytes) {
      const next = await reader.read();
      if (!next || next.done) break;
      const value = next.value;
      received += value ? (value.byteLength || value.length || 0) : 0;
      if (signal && signal.aborted) break;
    }
    try { await reader.cancel(); } catch {}
    return received > 0;
  } catch {
    return false;
  }
}

function ensureSeparatedNextPartPrefetchVideo() {
  if (separatedNextPartPrefetchVideo) return separatedNextPartPrefetchVideo;
  if (typeof document === 'undefined') return null;
  try {
    const el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.playsInline = true;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-mm-video-role', 'prefetch');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '0';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    separatedNextPartPrefetchVideo = el;
    return separatedNextPartPrefetchVideo;
  } catch {
    return null;
  }
}

function prefetchNextPartViaVideoElement(url, targetSeconds, signal) {
  const el = ensureSeparatedNextPartPrefetchVideo();
  if (!el) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finalize = (ok) => {
      if (done) return;
      done = true;
      el.removeEventListener('progress', onProgress);
      el.removeEventListener('error', onError);
      try { el.pause(); } catch {}
      try { el.removeAttribute('src'); } catch {}
      try { el.load(); } catch {}
      resolve(!!ok);
    };
    const onError = () => finalize(false);
    const onProgress = () => {
      const bufferedEnd = safeBufferedEnd(el);
      if (bufferedEnd >= targetSeconds) finalize(true);
    };
    if (signal) {
      try {
        if (signal.aborted) return finalize(false);
        signal.addEventListener('abort', () => finalize(false), { once: true });
      } catch {}
    }
    el.addEventListener('progress', onProgress);
    el.addEventListener('error', onError);
    try {
      el.src = url;
      el.load();
    } catch {
      finalize(false);
      return;
    }
    // Safety timeout: we only want a small warm-up, not a full background download.
    setTimeout(() => finalize(safeBufferedEnd(el) > 0), 6000);
  });
}

function maybePrimeSeparatedNextPartSwap(item) {
  if (!item || !video) return;
  if (!hasSeparatedParts(item)) return;
  const meta = getSeparatedMeta(item);
  if (!meta || !Array.isArray(meta.parts) || meta.parts.length < 2) return;

  const currentPartIndex = (item && Number.isFinite(Number(item.__activePartIndex))) ? Number(item.__activePartIndex) : 0;
  const nextIndex = currentPartIndex + 1;
  if (nextIndex < 0 || nextIndex >= meta.parts.length) return;
  const nextPart = meta.parts[nextIndex];
  const nextSrc = nextPart && typeof nextPart.src === 'string' ? nextPart.src : '';
  if (!nextSrc) return;

  const currentTime = Number(video.currentTime) || 0;
  const currentDuration = (Number.isFinite(video.duration) && video.duration > 0)
    ? Number(video.duration)
    : getPartDuration(meta, item, currentPartIndex);
  const ratio = currentDuration > 0 ? (currentTime / currentDuration) : 0;
  const remaining = currentDuration > 0 ? (currentDuration - currentTime) : Infinity;

  const bufferedEnd = safeBufferedEnd(video);
  const bufferAhead = bufferedEnd > currentTime ? (bufferedEnd - currentTime) : 0;

  const remainingPartsAhead = meta.parts.length - (currentPartIndex + 1);
  const earlyTriggerRatio = remainingPartsAhead >= 2 ? 0.20 : 0.50;
  const shouldStart = (ratio >= earlyTriggerRatio)
    || (Number.isFinite(remaining) && remaining <= SEPARATED_NEXT_PART_PREFETCH_TRIGGER_REMAINING_SECONDS);
  if (!shouldStart) return;
  const allowAggressive = Number.isFinite(remaining) && remaining <= 30;
  if (!allowAggressive && bufferAhead < SEPARATED_NEXT_PART_PREFETCH_MIN_BUFFER_AHEAD_SECONDS) return;

  const nextFraction = remainingPartsAhead >= 2 ? 1.0 : 0.5;
  const next2Fraction = remainingPartsAhead >= 2 ? 0.2 : 0;

  const standby1 = ensureSeparatedSwapStandby();
  if (!standby1) return;
  if (separatedSwapPreload.standby1Src !== nextSrc || normalizeVideoSrc(standby1.src) !== nextSrc) {
    separatedSwapPreload.standby1Src = nextSrc;
    try { standby1.controls = !!(video && video.controls); } catch {}
    try { standby1.muted = true; } catch {}
    try { standby1.preload = 'auto'; } catch {}
    try { standby1.setAttribute('data-mm-video-role', 'standby-1'); } catch {}
    try {
      standby1.src = nextSrc;
      standby1.load();
    } catch {}
  }

  // Prefetch bytes for the next part (best-effort, may be blocked by CORS/range).
  const nextSize = Number(nextPart && nextPart.fileSizeBytes);
  const nextBytes = (Number.isFinite(nextSize) && nextSize > 0)
    ? Math.max(1, Math.ceil(nextSize * nextFraction))
    : Math.max(1, Math.ceil(SEPARATED_NEXT_PART_PREFETCH_FALLBACK_BYTES * nextFraction));
  if (separatedSwapPreload.slot1.src !== nextSrc || separatedSwapPreload.slot1.bytesTarget !== nextBytes) {
    abortSwapFetchSlot(1);
    separatedSwapPreload.slot1.src = nextSrc;
    separatedSwapPreload.slot1.bytesTarget = nextBytes;
    const controller = new AbortController();
    separatedSwapPreload.slot1.controller = controller;
    prefetchFirstBytes(nextSrc, nextBytes, controller.signal)
      .catch(() => {})
      .finally(() => {
        clearSwapFetchController(controller);
      });
  }

  // Optionally preload the part after next: 20% (total policy: "120%").
  const next2Index = nextIndex + 1;
  if (next2Fraction > 0 && next2Index < meta.parts.length) {
    const next2Part = meta.parts[next2Index];
    const next2Src = next2Part && typeof next2Part.src === 'string' ? next2Part.src : '';
    if (next2Src) {
      const standby2 = ensureSeparatedSwapStandby2();
      if (standby2) {
        if (separatedSwapPreload.standby2Src !== next2Src || normalizeVideoSrc(standby2.src) !== next2Src) {
          separatedSwapPreload.standby2Src = next2Src;
          try { standby2.controls = !!(video && video.controls); } catch {}
          try { standby2.muted = true; } catch {}
          try { standby2.preload = 'auto'; } catch {}
          try { standby2.setAttribute('data-mm-video-role', 'standby-2'); } catch {}
          try {
            standby2.src = next2Src;
            standby2.load();
          } catch {}
        }
        const next2Size = Number(next2Part && next2Part.fileSizeBytes);
        const next2Bytes = (Number.isFinite(next2Size) && next2Size > 0)
          ? Math.max(1, Math.ceil(next2Size * next2Fraction))
          : Math.max(1, Math.ceil(SEPARATED_NEXT_PART_PREFETCH_FALLBACK_BYTES * next2Fraction));
        if (separatedSwapPreload.slot2.src !== next2Src || separatedSwapPreload.slot2.bytesTarget !== next2Bytes) {
          abortSwapFetchSlot(2);
          separatedSwapPreload.slot2.src = next2Src;
          separatedSwapPreload.slot2.bytesTarget = next2Bytes;
          const controller = new AbortController();
          separatedSwapPreload.slot2.controller = controller;
          prefetchFirstBytes(next2Src, next2Bytes, controller.signal)
            .catch(() => {})
            .finally(() => {
              clearSwapFetchController(controller);
            });
        }
      }
    }
  } else {
    abortSwapFetchSlot(2);
    if (separatedSwapPreload.standby2) {
      try { separatedSwapPreload.standby2.pause(); } catch {}
      try { separatedSwapPreload.standby2.removeAttribute('src'); } catch {}
      try { separatedSwapPreload.standby2.load(); } catch {}
      try { separatedSwapPreload.standby2.remove(); } catch {}
    }
    separatedSwapPreload.standby2 = null;
    separatedSwapPreload.standby2Src = '';
  }
}

function maybePrefetchSeparatedNextPart(item) {
  if (!item || !video) return;
  if (!hasSeparatedParts(item)) return;
  const method = getSeparatedNextPartPrefetchMethod();
  if (method === 'swap') {
    maybePrimeSeparatedNextPartSwap(item);
    return;
  }
  const meta = getSeparatedMeta(item);
  if (!meta || !Array.isArray(meta.parts) || meta.parts.length < 2) return;

  const currentPartIndex = (item && Number.isFinite(Number(item.__activePartIndex))) ? Number(item.__activePartIndex) : 0;
  const nextIndex = currentPartIndex + 1;
  if (nextIndex < 0 || nextIndex >= meta.parts.length) return;
  const nextPart = meta.parts[nextIndex];
  const nextSrc = nextPart && typeof nextPart.src === 'string' ? nextPart.src : '';
  if (!nextSrc) return;

  const history = separatedNextPartPrefetchHistory.get(nextSrc);
  if (history && history.ok) return;
  if (history && history.attempts >= 2) return;
  if (separatedNextPartPrefetchState.src === nextSrc) return;

  const currentTime = Number(video.currentTime) || 0;
  const currentDuration = (Number.isFinite(video.duration) && video.duration > 0)
    ? Number(video.duration)
    : getPartDuration(meta, item, currentPartIndex);
  const ratio = currentDuration > 0 ? (currentTime / currentDuration) : 0;
  const remaining = currentDuration > 0 ? (currentDuration - currentTime) : Infinity;

  const bufferedEnd = safeBufferedEnd(video);
  const bufferAhead = bufferedEnd > currentTime ? (bufferedEnd - currentTime) : 0;

  const shouldStart = (ratio >= SEPARATED_NEXT_PART_PREFETCH_TRIGGER_RATIO)
    || (Number.isFinite(remaining) && remaining <= SEPARATED_NEXT_PART_PREFETCH_TRIGGER_REMAINING_SECONDS);
  if (!shouldStart) return;
  const allowAggressive = Number.isFinite(remaining) && remaining <= 30;
  if (!allowAggressive && bufferAhead < SEPARATED_NEXT_PART_PREFETCH_MIN_BUFFER_AHEAD_SECONDS) return;

  if (separatedNextPartPrefetchState.controller) {
    try { separatedNextPartPrefetchState.controller.abort(); } catch {}
  }
  const controller = new AbortController();
  separatedNextPartPrefetchState.controller = controller;
  separatedNextPartPrefetchState.src = nextSrc;
  separatedNextPartPrefetchState.targetPartIndex = nextIndex;

  const nextDuration = getPartDuration(meta, item, nextIndex);
  const targetSeconds = nextDuration > 0
    ? Math.max(1, Math.floor(nextDuration * SEPARATED_NEXT_PART_PREFETCH_FRACTION))
    : 0;

  const task = (method === 'video')
    ? prefetchNextPartViaVideoElement(nextSrc, targetSeconds, controller.signal)
    : prefetchFirstBytes(nextSrc, computeSeparatedNextPartPrefetchBytes(nextPart), controller.signal)
      .then((ok) => {
        if (ok) return true;
        if (targetSeconds <= 0) return false;
        // Fallback for hosts without CORS/range support: best-effort warm-up via hidden video element.
        return prefetchNextPartViaVideoElement(nextSrc, targetSeconds, controller.signal);
      });

  task
    .then((ok) => recordSeparatedNextPartPrefetch(nextSrc, ok))
    .catch(() => recordSeparatedNextPartPrefetch(nextSrc, false))
    .finally(() => {
      if (separatedNextPartPrefetchState.controller === controller) {
        separatedNextPartPrefetchState.controller = null;
        separatedNextPartPrefetchState.src = '';
        separatedNextPartPrefetchState.targetPartIndex = -1;
      }
    });
}

function normalizeVideoSrc(value) {
  return (typeof value === 'string') ? value.trim() : '';
}

function tryPromoteSeparatedSwapStandby(item, nextIndex, nextStart, baseKey) {
  if (!item || !hasSeparatedParts(item)) return false;
  const meta = getSeparatedMeta(item);
  if (!meta || !Array.isArray(meta.parts) || meta.parts.length === 0) return false;
  if (nextIndex < 0 || nextIndex >= meta.parts.length) return false;

  const standby1 = ensureSeparatedSwapStandby();
  if (!standby1) return false;
  const nextPart = meta.parts[nextIndex];
  const desiredSrc = normalizeVideoSrc(nextPart && nextPart.src);
  if (!desiredSrc) return false;

  const standbySrc = normalizeVideoSrc(standby1 && standby1.src);
  const standbyCurrent = normalizeVideoSrc(standby1 && standby1.currentSrc);
  if ((!standbySrc || standbySrc !== desiredSrc) && (!standbyCurrent || standbyCurrent !== desiredSrc)) return false;

  const outgoing = video;
  const incoming = standby1;
  const priorStandby2 = (separatedSwapPreload.standby2 && separatedSwapPreload.standby2.isConnected) ? separatedSwapPreload.standby2 : null;

  // Prepare incoming as active
  try { incoming.classList.remove('mm-video-hidden'); } catch {}
  try { incoming.removeAttribute('aria-hidden'); } catch {}
  try { incoming.setAttribute('data-mm-video-role', 'active'); } catch {}
  try { incoming.controls = !!(outgoing && outgoing.controls); } catch {}
  try { incoming.muted = !!(outgoing && outgoing.muted); } catch {}
  try { incoming.volume = (outgoing && Number.isFinite(outgoing.volume)) ? outgoing.volume : incoming.volume; } catch {}
  try { incoming.playbackRate = (outgoing && Number.isFinite(outgoing.playbackRate)) ? outgoing.playbackRate : incoming.playbackRate; } catch {}
  try { incoming.currentTime = 0; } catch {}

  // Demote outgoing to standby
  if (outgoing && outgoing !== incoming) {
    detachActiveVideoListeners(outgoing);
    try { outgoing.pause(); } catch {}
    try { outgoing.classList.add('mm-video-hidden'); } catch {}
    try { outgoing.setAttribute('aria-hidden', 'true'); } catch {}
    try { outgoing.setAttribute('data-mm-video-role', 'standby-2'); } catch {}
    try { outgoing.muted = true; } catch {}
    try { outgoing.removeAttribute('src'); } catch {}
    try { outgoing.load(); } catch {}
  }

  // Point the app's active video reference to incoming.
  setActiveVideoElement(incoming);

  // Rotate standby elements: prior standby-2 becomes standby-1, outgoing becomes standby-2.
  separatedSwapPreload.standby1 = priorStandby2;
  separatedSwapPreload.standby1Src = priorStandby2 ? normalizeVideoSrc(priorStandby2.src || priorStandby2.currentSrc || '') : '';
  if (priorStandby2) {
    try { priorStandby2.classList.add('mm-video-hidden'); } catch {}
    try { priorStandby2.setAttribute('aria-hidden', 'true'); } catch {}
    try { priorStandby2.setAttribute('data-mm-video-role', 'standby-1'); } catch {}
    try { priorStandby2.muted = true; } catch {}
  }
  separatedSwapPreload.standby2 = (outgoing && outgoing !== incoming) ? outgoing : null;
  separatedSwapPreload.standby2Src = '';

  // Rotate fetch slot bookkeeping: slot2 becomes slot1; abort old slot1 (incoming is now playing).
  abortSwapFetchSlot(1);
  separatedSwapPreload.slot1.src = separatedSwapPreload.slot2.src;
  separatedSwapPreload.slot1.bytesTarget = separatedSwapPreload.slot2.bytesTarget;
  separatedSwapPreload.slot1.controller = separatedSwapPreload.slot2.controller;
  separatedSwapPreload.slot2.src = '';
  separatedSwapPreload.slot2.bytesTarget = 0;
  separatedSwapPreload.slot2.controller = null;

  // Update separated bookkeeping + UI
  item.__activePartIndex = nextIndex;
  if (!Array.isArray(item.__separatedOffsets) || item.__separatedOffsets.length !== meta.offsets.length) {
    item.__separatedOffsets = meta.offsets.slice();
  }
  if (!Number.isFinite(item.__separatedTotalDuration) || item.__separatedTotalDuration <= 0) {
    item.__separatedTotalDuration = meta.totalDuration;
  }
  updateChaptersSelection(item);

  if (video && video.dataset) {
    video.dataset.separatedItem = '1';
    video.dataset.separatedPartIndex = String(nextIndex);
    video.dataset.separatedPartCount = String(meta.parts.length);
    video.dataset.separatedBaseKey = baseKey || '';
  }

  if (baseKey) {
    try {
      localStorage.setItem(baseKey, String(Math.max(0, Number(nextStart) || 0)));
      localStorage.setItem(`${baseKey}:part`, String(nextIndex));
      localStorage.setItem(`${baseKey}:partTime`, '0');
    } catch {}
  }

  try {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  } catch {}

  updateEpisodeTimeOverlay(item, Math.max(0, Number(nextStart) || 0));
  return true;
}

function computeSeparatedProgress(item, currentPartTime) {
  const meta = getSeparatedMeta(item);
  const safeCurrent = Math.max(0, Number(currentPartTime) || 0);
  if (!meta) {
    let totalDuration = Number(item && item.__separatedTotalDuration);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) totalDuration = Number(item && item.durationSeconds);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) totalDuration = Number(video && video.duration);
    const clamped = (Number.isFinite(totalDuration) && totalDuration > 0) ? Math.min(safeCurrent, totalDuration) : safeCurrent;
    return {
      time: clamped,
      duration: (Number.isFinite(totalDuration) && totalDuration > 0) ? totalDuration : clamped,
      partIndex: 0,
      partTime: clamped,
      partCount: 1
    };
  }

  const partCount = meta.parts.length;
  let activeIndex = Number(item && item.__activePartIndex);
  if (!Number.isFinite(activeIndex) || activeIndex < 0 || activeIndex >= partCount) {
    let datasetIndex = NaN;
    if (video && video.dataset && video.dataset.separatedPartIndex !== undefined) {
      const parsed = Number(video.dataset.separatedPartIndex);
      if (Number.isFinite(parsed)) datasetIndex = parsed;
    }
    activeIndex = Number.isFinite(datasetIndex) ? datasetIndex : 0;
  }
  activeIndex = Math.max(0, Math.min(activeIndex, partCount - 1));
  if (item) item.__activePartIndex = activeIndex;

  const startOffset = meta.offsets[activeIndex] || 0;
  const partDuration = getPartDuration(meta, item, activeIndex);
  const effectivePartDuration = (Number.isFinite(partDuration) && partDuration > 0) ? partDuration : null;
  const partTime = effectivePartDuration ? Math.min(safeCurrent, effectivePartDuration) : safeCurrent;

  let totalDuration = Number(item && item.__separatedTotalDuration);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    if (Number.isFinite(meta.totalDuration) && meta.totalDuration > 0) {
      totalDuration = meta.totalDuration;
    } else {
      const lastOffset = meta.offsets[partCount - 1] || 0;
      const lastDur = getPartDuration(meta, item, partCount - 1);
      const fallback = lastOffset + (Number.isFinite(lastDur) && lastDur > 0 ? lastDur : 0);
      if (fallback > 0) totalDuration = fallback;
    }
  }
  if ((!Number.isFinite(totalDuration) || totalDuration <= 0) && Number.isFinite(item && item.durationSeconds) && item.durationSeconds > 0) {
    totalDuration = Number(item.durationSeconds);
  }
  const aggregated = startOffset + partTime;
  const clampedAggregated = (Number.isFinite(totalDuration) && totalDuration > 0)
    ? Math.min(aggregated, totalDuration)
    : aggregated;

  return {
    time: clampedAggregated,
    duration: (Number.isFinite(totalDuration) && totalDuration > 0) ? totalDuration : clampedAggregated,
    partIndex: activeIndex,
    partTime,
    partCount
  };
}

function getAggregatedDurationForItem(item) {
  if (!item) return 0;
  const meta = getSeparatedMeta(item);
  if (meta) {
    if (Number.isFinite(meta.totalDuration) && meta.totalDuration > 0) return meta.totalDuration;
    let total = 0;
    for (let i = 0; i < meta.parts.length; i++) {
      total += getPartDuration(meta, item, i);
    }
    if (total > 0) return total;
  }
  if (Number.isFinite(item.durationSeconds) && item.durationSeconds > 0) return Number(item.durationSeconds);
  if (video && Number.isFinite(video.duration) && video.duration > 0) return Number(video.duration);
  return 0;
}

function resolveCombinedPosition(item, combinedSeconds) {
  const safeCombined = Math.max(0, Number(combinedSeconds) || 0);
  const meta = getSeparatedMeta(item);
  if (!meta) {
    return { partIndex: 0, partTime: safeCombined };
  }
  const totalDuration = getAggregatedDurationForItem(item);
  const clampedCombined = totalDuration > 0 ? Math.min(safeCombined, totalDuration) : safeCombined;
  let partIndex = meta.parts.length - 1;
  for (let i = 0; i < meta.parts.length; i++) {
    const start = meta.offsets[i] || 0;
    const duration = getPartDuration(meta, item, i);
    const end = start + (duration || 0);
    if (clampedCombined < end || i === meta.parts.length - 1) {
      partIndex = i;
      break;
    }
  }
  const startOffset = meta.offsets[partIndex] || 0;
  const partTime = Math.max(0, clampedCombined - startOffset);
  return { partIndex, partTime };
}

function getAggregatedCurrentTime(item) {
  if (!item) return 0;
  if (hasSeparatedParts(item)) {
    const progress = computeSeparatedProgress(item, video ? video.currentTime : 0);
    return progress.time;
  }
  return Number(video ? video.currentTime : 0) || 0;
}

function getCurrentMediaItem() {
  if (typeof currentIndex !== 'number' || !Array.isArray(flatList)) return null;
  if (currentIndex < 0 || currentIndex >= flatList.length) return null;
  return flatList[currentIndex];
}

function updateEpisodeTimeOverlay(item, aggregatedTime) {
  if (!item) {
    return;
  }
  const duration = getAggregatedDurationForItem(item);
  const totalDuration = duration > 0 ? duration : 0;
  const clamped = Math.max(0, Math.min(Number(aggregatedTime) || 0, totalDuration || Number(aggregatedTime) || 0));
}

function seekAggregated(item, targetTimeSeconds, shouldPlay) {
  if (!item) return;
  const desiredPlay = shouldPlay === undefined ? !video.paused : shouldPlay;
  const target = Math.max(0, Number(targetTimeSeconds) || 0);
  if (hasSeparatedParts(item)) {
    const position = resolveCombinedPosition(item, target);
    setSeparatedPartSource(item, position.partIndex, { resumeTime: position.partTime, suppressPlay: !desiredPlay, combinedTime: target });
  } else if (video) {
    const duration = Number(video.duration);
    const clamped = Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(target, duration)) : target;
    try { video.currentTime = clamped; } catch {}
    if (desiredPlay) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    }
    updateEpisodeTimeOverlay(item, clamped);
  }
}

function setSeparatedPartSource(item, partIndex, options) {
  resetSeparatedNextPartPrefetch();
  const meta = getSeparatedMeta(item);
  if (!meta) return;
  const targetIndex = Math.max(0, Math.min(partIndex, meta.parts.length - 1));
  const part = meta.parts[targetIndex];
  item.__activePartIndex = targetIndex;
  if (!Array.isArray(item.__separatedOffsets) || item.__separatedOffsets.length !== meta.offsets.length) {
    item.__separatedOffsets = meta.offsets.slice();
  }
  if (!Number.isFinite(item.__separatedTotalDuration) || item.__separatedTotalDuration <= 0) {
    item.__separatedTotalDuration = meta.totalDuration;
  }
  const resumeKey = item.__separatedBaseKey || resolveResumeKeyForItem(item);
  item.__separatedBaseKey = resumeKey;
  const resumeTime = options && Number.isFinite(Number(options.resumeTime)) ? Number(options.resumeTime) : 0;
  const aggregatedTime = (options && Number.isFinite(Number(options.combinedTime)))
    ? Math.max(0, Number(options.combinedTime))
    : (meta.offsets[targetIndex] || 0) + Math.max(0, resumeTime);
  updateEpisodeTimeOverlay(item, aggregatedTime);
  updateChaptersSelection(item);
  if (resumeKey) {
    try { localStorage.setItem(`${resumeKey}:part`, String(targetIndex)); }
    catch {}
  }
  if (video) {
    const suppressPlay = options && options.suppressPlay === true;
    video.dataset.separatedItem = '1';
    video.dataset.separatedPartIndex = String(targetIndex);
    video.dataset.separatedPartCount = String(meta.parts.length);
    video.dataset.separatedBaseKey = resumeKey || '';
    const onMeta = () => {
      try {
        localStorage.setItem(video.src + ':duration', video.duration);
        if (resumeKey && Number.isFinite(item.__separatedTotalDuration) && item.__separatedTotalDuration > 0) {
          localStorage.setItem(`${resumeKey}:duration`, item.__separatedTotalDuration);
        }
        const clamped = Math.max(0, Math.min(resumeTime, Number(video.duration) || resumeTime));
        try { video.currentTime = clamped; } catch {}
        if (!suppressPlay) {
          const playPromise = video.play();
          if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
        }
        updateEpisodeTimeOverlay(item, aggregatedTime);
      } catch {}
      video.removeEventListener('loadedmetadata', onMeta);
    };
    video.addEventListener('loadedmetadata', onMeta);
    try {
      video.src = part.src;
      video.load();
    } catch {}
  }
  if (resumeKey) {
    try {
      localStorage.setItem(resumeKey, String(Math.max(0, aggregatedTime)));
      localStorage.setItem(`${resumeKey}:part`, String(targetIndex));
      localStorage.setItem(`${resumeKey}:partTime`, String(Math.max(0, resumeTime)));
      if (typeof writeSourceScopedValue === 'function') {
        writeSourceScopedValue('SavedItemTime', String(Math.max(0, aggregatedTime)));
      }
    } catch {}
  }
}

function updateChaptersSelection(item) {
  if (!separatedPartsBar) return;
  separatedPartsBar.innerHTML = '';
  separatedPartsBar.style.display = 'none';
  separatedPartsBar.setAttribute('aria-hidden', 'true');

  if (!item || !hasSeparatedParts(item)) return;
  const meta = getSeparatedMeta(item);
  if (!meta || !Array.isArray(meta.parts) || meta.parts.length === 0) return;

  const activeIndexRaw = Number(item.__activePartIndex);
  const activeIndex = Number.isFinite(activeIndexRaw) && activeIndexRaw >= 0 ? activeIndexRaw : 0;
  const formatter = (typeof formatTime === 'function')
    ? formatTime
    : (value => `${Math.round(Math.max(0, Number(value) || 0))}s`);

  separatedPartsBar.style.display = 'flex';
  separatedPartsBar.setAttribute('aria-hidden', 'false');
  meta.parts.forEach((part, idx) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'separated-part-pill';
    const label = (part && typeof part.title === 'string' && part.title.trim())
      ? part.title.trim()
      : `Part ${idx + 1}`;
    const duration = getPartDuration(meta, item, idx);
    button.textContent = duration > 0 ? `${label} · ${formatter(duration)}` : label;
    button.dataset.partIndex = String(idx);
    button.setAttribute('aria-pressed', idx === activeIndex ? 'true' : 'false');
    if (idx === activeIndex) button.classList.add('active');
    button.addEventListener('click', () => {
      const offsets = meta.offsets || [];
      const startAt = offsets[idx] || 0;
      seekAggregated(item, startAt, undefined);
    });
    separatedPartsBar.appendChild(button);
  });
}

function hideVideoShowCbz() {
  if (video) { try { video.pause(); } catch {} video.style.display = 'none'; }
  if (cbzViewer) cbzViewer.style.display = 'block';
  if (clipBtn) clipBtn.style.display = 'none';
  if (theaterBtn) theaterBtn.style.display = 'none';
}

function hideCbzShowVideo() {
  if (cbzViewer) cbzViewer.style.display = 'none';
  if (video) video.style.display = '';
  if (clipBtn) clipBtn.style.display = '';
}

function getCbzPreloadWindowSize() {
  const count = Number(cbzPreloadAheadCount);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.max(0, Math.floor(count));
}

function ensureCbzPagePreloaded(index) {
  if (!Array.isArray(cbzState.pages)) return;
  if (!Number.isFinite(index)) return;
  const intIndex = Math.trunc(index);
  if (intIndex < 0 || intIndex >= cbzState.pages.length) return;
  if (cbzPreloadedImages.has(intIndex)) return;
  const src = cbzState.pages[intIndex];
  if (!src) return;
  const img = new Image();
  img.decoding = 'async';
  try { img.loading = 'eager'; } catch {}
  img.src = src;
  cbzPreloadedImages.set(intIndex, img);
}

function syncCbzPreloads(currentIndex) {
  if (!Array.isArray(cbzState.pages) || cbzState.pages.length === 0) {
    cbzPreloadedImages.clear();
    return;
  }
  const windowSize = getCbzPreloadWindowSize();
  if (windowSize <= 0) {
    cbzPreloadedImages.clear();
    return;
  }
  const maxIndex = cbzState.pages.length - 1;
  for (let offset = 1; offset <= windowSize; offset++) {
    const ahead = currentIndex + offset;
    if (ahead <= maxIndex) ensureCbzPagePreloaded(ahead);
    const behind = currentIndex - offset;
    if (behind >= 0) ensureCbzPagePreloaded(behind);
  }
  const removals = [];
  cbzPreloadedImages.forEach((_, idx) => {
    if (Math.abs(idx - currentIndex) > windowSize) removals.push(idx);
  });
  for (const idx of removals) {
    cbzPreloadedImages.delete(idx);
  }
}

function updateCbzPageInfo() {
  if (!cbzState.active) return;
  if (cbzPageInfo) cbzPageInfo.textContent = `Page ${cbzState.index + 1} / ${cbzState.pages.length}`;
  if (cbzImage) cbzImage.src = cbzState.pages[cbzState.index] || '';
  syncCbzPreloads(cbzState.index);
  if (nextBtn) nextBtn.style.display = (cbzState.index >= cbzState.pages.length - 1 && flatList && currentIndex < flatList.length - 1) ? 'inline-block' : 'none';
  // Persist current page and total pages for this CBZ item
  try {
    const curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
    const src = curItem && curItem.src ? curItem.src : '';
    if (src) {
      localStorage.setItem(src + ':cbzPage', String(cbzState.index + 1));
      localStorage.setItem(src + ':cbzPages', String(cbzState.pages.length));
    }
  } catch {}
}

function showCbzProgress(message, value) {
  if (cbzProgressOverlay) cbzProgressOverlay.style.display = 'flex';
  // Prefer a unified "Loading... {percent}%" message whenever we have numeric progress
  let text = 'Loading...';
  if (typeof value === 'number' && isFinite(value)) {
    const pct = Math.max(0, Math.min(100, value));
    text = `Loading... ${Math.round(pct)}%`;
  } else if (typeof message === 'string' && message) {
    text = message;
  }
  if (cbzProgressMessage) cbzProgressMessage.textContent = text;
  if (cbzProgressBar) {
    if (typeof value === 'number' && isFinite(value)) {
      cbzProgressBar.value = Math.max(0, Math.min(100, value));
    } else {
      try { cbzProgressBar.removeAttribute('value'); } catch {}
    }
  }
}

function hideCbzProgress() {
  if (cbzProgressOverlay) cbzProgressOverlay.style.display = 'none';
  try { if (cbzProgressBar) cbzProgressBar.value = 0; } catch {}
}

function formatMB(bytes) {
  const num = Number(bytes) || 0;
  return `${(num / (1024*1024)).toFixed(1)} MB`;
}

function fetchBlobWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.onprogress = (e) => { try { onProgress && onProgress(e.loaded, e.lengthComputable ? e.total : undefined); } catch {} };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
        else reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.send();
    } catch (e) { reject(e); }
  });
}

function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const fr = new FileReader();
      fr.onprogress = (e) => { try { onProgress && onProgress(e.loaded, e.lengthComputable ? e.total : undefined); } catch {} };
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.onload = () => {
        try { resolve(new Blob([fr.result])); } catch (e) { reject(e); }
      };
      fr.readAsArrayBuffer(file);
    } catch (e) { reject(e); }
  });
}

function getCbzCacheKey(item) {
  if (item && item.file) {
    const f = item.file;
    const lm = typeof f.lastModified === 'number' ? f.lastModified : 0;
    return `local:${f.name}:${f.size}:${lm}`;
  }
  return `url:${item && item.src ? item.src : ''}`;
}

function parseMangaJsonToPages(json) {
  try {
    if (!json || typeof json !== 'object') return [];
    // Prefer explicit array fields
    if (Array.isArray(json.pages)) {
      return json.pages.map(p => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') return p.src || p.url || p.data || '';
        return '';
      }).filter(Boolean);
    }
    if (Array.isArray(json.images)) {
      return json.images.map(p => (typeof p === 'string') ? p : (p && (p.src || p.url || p.data) || '')).filter(Boolean);
    }
    // Fallback: object mapping like { "Page 1": "1.png", ... } or { "1": "..." }
    const candidates = json.pages && typeof json.pages === 'object' ? json.pages : json;
    const entries = Object.entries(candidates)
      .map(([k, v]) => {
        let n = NaN;
        try {
          const m = String(k).match(/(\d+)/);
          if (m) n = parseInt(m[1], 10);
        } catch {}
        let url = '';
        if (typeof v === 'string') url = v;
        else if (v && typeof v === 'object') url = v.src || v.url || v.data || '';
        return { n, url };
      })
      .filter(e => Number.isFinite(e.n) && e.n >= 1 && e.url);
    entries.sort((a, b) => a.n - b.n);
    return entries.map(e => e.url);
  } catch { return []; }
}

async function loadMangaVolume(item) {
  cbzState = { active: true, pages: [], index: 0 };
  cbzPreloadedImages.clear();
  // Use progress overlay instead of spinner
  showCbzProgress('Loading...', 0);
  try { if (spinner) spinner.style.display = 'none'; } catch {}
  hideVideoShowCbz();
  try {
    const cacheKey = getCbzCacheKey(item);
    cbzCurrentKey = cacheKey;
    // Serve from cache if present
    if (cbzCache.has(cacheKey)) {
      const cached = cbzCache.get(cacheKey);
      cbzState.pages = cached.pages.slice();
      cbzObjectUrls = cached.pages; // current reference for convenience
      cbzState.index = 0;
      // Restore saved page and persist total pages
      try {
        const pk = (item && item.progressKey) ? String(item.progressKey) : '';
        if (item && item.src) localStorage.setItem(item.src + ':cbzPages', String(cbzState.pages.length));
        if (pk) localStorage.setItem(pk + ':cbzPages', String(cbzState.pages.length));
        const savedSrc = item && item.src ? parseInt(localStorage.getItem(item.src + ':cbzPage'), 10) : NaN;
        const savedPk = pk ? parseInt(localStorage.getItem(pk + ':cbzPage'), 10) : NaN;
        const savedPage = Number.isFinite(savedPk) ? savedPk : savedSrc;
        if (Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= cbzState.pages.length) {
          cbzState.index = savedPage - 1;
        }
      } catch {}
      updateCbzPageInfo();
      hideCbzProgress();
      return;
    }

    let blob;
    const onNetProgress = (loaded, total) => {
      if (total && isFinite(total) && total > 0) {
        const pct = (loaded / total) * 80; // allocate 80% to download phase
        showCbzProgress(undefined, pct); // message unified by showCbzProgress
      } else {
        showCbzProgress('Loading...', undefined);
      }
    };
    let isJson = false;
    try {
      const srcLower = (item && item.src ? String(item.src) : '').toLowerCase();
      const nameLower = (item && item.fileName ? String(item.fileName) : '').toLowerCase();
      isJson = /\.json(?:$|[?#])/.test(srcLower) || nameLower.endsWith('.json');
    } catch {}

    if (item.file && typeof item.file.arrayBuffer === 'function') {
      blob = await readFileWithProgress(item.file, onNetProgress);
    } else {
      blob = await fetchBlobWithProgress(item.src, onNetProgress);
    }

    let pages = [];
    if (isJson) {
      cbzProgressBase = 80;
      showCbzProgress(undefined, cbzProgressBase);
      // Parse JSON and extract page list
      const text = await blob.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('Invalid volume JSON'); }
      pages = parseMangaJsonToPages(json);
      if (!pages || pages.length === 0) throw new Error('No pages found in volume JSON');
      // Resolve local-relative paths when using local folder selections
      try {
        const isLocal = !!(item && item.file);
        const filesIndex = item && item.filesIndex ? item.filesIndex : null;
        const baseDir = item && typeof item.fileBaseDirRel === 'string' ? item.fileBaseDirRel : '';
        if (isLocal && filesIndex && baseDir) {
          const resolved = [];
          const lowerIndex = filesIndex; // object mapping lowercased relative path -> File
          function joinRel(base, rel) {
            const a = String(base || '').replace(/\\/g, '/');
            const b = String(rel || '').replace(/\\/g, '/');
            if (!a) return b;
            if (!b) return a;
            let out = a.endsWith('/') ? (a + b) : (a + '/' + b);
            // normalize a/./b and a//b
            out = out.replace(/\/+\./g, '/').replace(/\/{2,}/g, '/');
            // resolve a/../b conservatively (single pass is fine for shallow paths)
            const parts = out.split('/');
            const stack = [];
            for (const part of parts) {
              if (part === '..') stack.pop();
              else if (part !== '.') stack.push(part);
            }
            return stack.join('/');
          }
          for (let i = 0; i < pages.length; i++) {
            const p = String(pages[i] || '');
            const lower = p.toLowerCase();
            const isAbs = /^https?:\/\//.test(p) || /^data:/.test(p);
            if (isAbs) { resolved.push(p); continue; }
            const relPath = joinRel(baseDir, p).toLowerCase();
            const f = lowerIndex[relPath] || null;
            if (f) {
              const url = URL.createObjectURL(f);
              cbzObjectUrls.push(url);
              resolved.push(url);
            } else {
              // Also try without first folder segment (in case of differing roots)
              const idx = relPath.indexOf('/');
              const alt = idx > 0 ? relPath.slice(idx + 1) : relPath;
              const f2 = lowerIndex[alt] || null;
              if (f2) {
                const url = URL.createObjectURL(f2);
                cbzObjectUrls.push(url);
                resolved.push(url);
              } else {
                resolved.push(p);
              }
            }
          }
          pages = resolved;
        }
      } catch {}
      // For non-local JSON, resolve relative paths against the JSON's directory
      try {
        const isLocal = !!(item && item.file);
        if (!isLocal && item && item.src) {
          const base = new URL('.', new URL(String(item.src), window.location.href)).href;
          pages = pages.map(p => {
            try {
              if (typeof p !== 'string') return '';
              if (/^data:/i.test(p)) return p;
              return new URL(p, base).href;
            } catch { return p; }
          }).filter(Boolean);
        }
      } catch {}
      // If not local, pages should be direct URLs or data URIs
      showCbzProgress(undefined, 99);
    } else {
      cbzProgressBase = 80; // remaining 20% for extraction
      showCbzProgress(undefined, cbzProgressBase);
      const zip = await JSZip.loadAsync(blob);
      const fileNames = Object.keys(zip.files)
        .filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      pages = [];
      for (let i = 0; i < fileNames.length; i++) {
        const name = fileNames[i];
        showCbzProgress(undefined, cbzProgressBase + (20 * ((i) / Math.max(1, fileNames.length))));
        const data = await zip.files[name].async('blob');
        const url = URL.createObjectURL(data);
        cbzObjectUrls.push(url);
        pages.push(url);
      }
      showCbzProgress(undefined, 99);
      if (pages.length === 0) throw new Error('No images found in CBZ');
    }

    cbzState.pages = pages;
    cbzState.index = 0;
    // Save total pages and restore saved page if present
    try {
      if (item && item.src) localStorage.setItem(item.src + ':cbzPages', String(pages.length));
      const pk = (item && item.progressKey) ? String(item.progressKey) : '';
      if (pk) localStorage.setItem(pk + ':cbzPages', String(pages.length));
      const savedSrc = item && item.src ? parseInt(localStorage.getItem(item.src + ':cbzPage'), 10) : NaN;
      const savedPk = pk ? parseInt(localStorage.getItem(pk + ':cbzPage'), 10) : NaN;
      const savedPage = Number.isFinite(savedPk) ? savedPk : savedSrc;
      if (Number.isFinite(savedPage) && savedPage >= 1 && savedPage <= pages.length) {
        cbzState.index = savedPage - 1;
      }
    } catch {}
    // Cache the pages for reuse until reload
    cbzCache.set(cacheKey, { pages });
    updateCbzPageInfo();
  } catch (e) {
    cbzState.active = false;
    clearCbzUrls();
    if (cbzViewer) cbzViewer.style.display = 'none';
    showPlayerAlert((e && e.message) ? e.message : 'Failed to load volume');
  } finally {
    hideCbzProgress();
  }
}

function unloadCbz() {
  cbzState.active = false;
  cbzPreloadedImages.clear();
  if (cbzViewer) cbzViewer.style.display = 'none';
  // Do not revoke URLs here; cache persists until page reload.
}

function clearAllCbzCache() {
  try {
    // Revoke all cached pages
    cbzCache.forEach(entry => {
      (entry.pages || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    });
  } catch {}
  cbzCache.clear();
  cbzPreloadedImages.clear();
  clearCbzUrls();
}

window.addEventListener('pagehide', clearAllCbzCache);
window.addEventListener('beforeunload', clearAllCbzCache);

// Bind CBZ controls once
if (cbzPrevBtn) {
  cbzPrevBtn.addEventListener('click', () => {
    if (!cbzState.active) return;
    if (cbzState.index > 0) { cbzState.index--; updateCbzPageInfo(); }
  });
}
if (cbzNextBtn) {
  cbzNextBtn.addEventListener('click', () => {
    if (!cbzState.active) return;
    if (cbzState.index < cbzState.pages.length - 1) { cbzState.index++; updateCbzPageInfo(); }
  });
}
if (cbzImageWrap) {
  cbzImageWrap.addEventListener('click', (e) => {
    if (!cbzState.active) return;
    const rect = cbzImageWrap.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const offsetX = e.clientX - rect.left;
    if (!Number.isFinite(offsetX)) return;
    if (offsetX <= rect.width / 2) {
      if (cbzState.index > 0) { cbzState.index--; updateCbzPageInfo(); }
    } else {
      if (cbzState.index < cbzState.pages.length - 1) { cbzState.index++; updateCbzPageInfo(); }
    }
  });
}

function handleCbzKeyboardNavigation(e) {
  if (e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!isShortcutContextAllowed(e.target)) return;
  if (e.key === 'Escape' || e.key === 'Esc') {
    try {
      const doc = document;
      const fullscreenElement =
        doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
      if (fullscreenElement) return;
    } catch {}
    e.preventDefault();
    try {
      if (typeof backBtn !== 'undefined' && backBtn && typeof backBtn.click === 'function') {
        const visible = typeof backBtn.getClientRects === 'function' ? backBtn.getClientRects().length > 0 : true;
        if (visible) backBtn.click();
      }
    } catch {}
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (cbzState.index > 0) {
      cbzState.index--;
      updateCbzPageInfo();
    }
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (cbzState.index < cbzState.pages.length - 1) {
      cbzState.index++;
      updateCbzPageInfo();
    }
  }
}

const SHORTCUT_IGNORE_SELECTOR = 'input, textarea, select, button, [contenteditable="true"]';
const GAMEPAD_VOLUME_DELTA = 0.1;
const SEEK_DELTA = 5;

let gamepadPollHandle = null;
const gamepadPrevButtonState = new Map();

function isShortcutContextAllowed(target) {
  if (!target) return true;
  if (target === video || target === document.body || target === document.documentElement) return true;
  if (typeof target.matches !== 'function') return true;
  if (target.matches(SHORTCUT_IGNORE_SELECTOR)) return false;
  if (typeof target.closest === 'function' && target.closest(SHORTCUT_IGNORE_SELECTOR)) return false;
  if (target.isContentEditable) return false;
  return true;
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value));
}

function togglePlayPause() {
  if (!video) return;
  if (video.paused) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  } else {
    video.pause();
  }
}

function toggleMute() {
  if (!video) return;
  video.muted = !video.muted;
}

function seekBy(seconds) {
  if (!video) return;
  let target = (Number.isFinite(video.currentTime) && video.currentTime >= 0) ? video.currentTime : 0;
  target += Number(seconds) || 0;
  const duration = (Number.isFinite(video.duration) && video.duration > 0) ? video.duration : null;
  if (duration !== null) {
    target = Math.min(duration, Math.max(0, target));
  } else {
    target = Math.max(0, target);
  }
  try {
    video.currentTime = target;
  } catch {}
}

function changeVolume(delta) {
  if (!video) return;
  let current = Number.isFinite(video.volume) ? video.volume : 0;
  current = clampVolume(current + (Number(delta) || 0));
  if (current > 0 && video.muted) {
    video.muted = false;
  }
  video.volume = current;
}

function toggleFullscreen() {
  if (!video) return;
  const doc = document;
  const fullscreenElement =
    doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
  if (fullscreenElement) {
    const exitFullscreen =
      doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
    if (typeof exitFullscreen === 'function') {
      exitFullscreen.call(doc);
    }
    return;
  }
  const requestFullscreen =
    video.requestFullscreen || video.webkitRequestFullscreen || video.mozRequestFullScreen || video.msRequestFullscreen;
  if (typeof requestFullscreen === 'function') {
    requestFullscreen.call(video);
  }
}

function handleVideoKeyboardShortcuts(e) {
  if (!video) return;
  if (cbzState.active) return;
  if (e.defaultPrevented) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!isShortcutContextAllowed(e.target)) return;

  const key = e.key || '';
  const lowerKey = key.toLowerCase();
  const handled = [];

  if (key === 'Escape' || key === 'Esc') handled.push('menu');
  if (key === ' ' || e.code === 'Space') handled.push('space');
  if (lowerKey === 'k') handled.push('play');
  if (lowerKey === 'm') handled.push('mute');
  if (lowerKey === 'f') handled.push('fullscreen');
  if (lowerKey === 't') handled.push('popout');
  if (key === 'ArrowRight') handled.push('seek-forward');
  if (lowerKey === 'l') handled.push('seek-forward');
  if (key === 'ArrowLeft') handled.push('seek-back');
  if (lowerKey === 'j') handled.push('seek-back');
  if (key === 'ArrowUp') handled.push('volume-up');
  if (key === 'ArrowDown') handled.push('volume-down');

  if (!handled.length) return;
  if (handled.includes('menu')) {
    try {
      const doc = document;
      const fullscreenElement =
        doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
      if (fullscreenElement) return;
    } catch {}
    e.preventDefault();
    try {
      if (typeof backBtn !== 'undefined' && backBtn && typeof backBtn.click === 'function') {
        const visible = typeof backBtn.getClientRects === 'function' ? backBtn.getClientRects().length > 0 : true;
        if (visible) backBtn.click();
      }
    } catch {}
    return;
  }
  e.preventDefault();
  if (handled.includes('space') || handled.includes('play')) togglePlayPause();
  if (handled.includes('mute')) toggleMute();
  if (handled.includes('fullscreen')) toggleFullscreen();
  if (handled.includes('popout')) {
    try {
      if (typeof theaterBtn !== 'undefined' && theaterBtn && typeof theaterBtn.click === 'function') {
        const visible = typeof theaterBtn.getClientRects === 'function' ? theaterBtn.getClientRects().length > 0 : true;
        if (visible) theaterBtn.click();
      }
    } catch {}
  }
  if (handled.includes('seek-forward')) seekBy(SEEK_DELTA);
  if (handled.includes('seek-back')) seekBy(-SEEK_DELTA);
  if (handled.includes('volume-up')) changeVolume(0.05);
  if (handled.includes('volume-down')) changeVolume(-0.05);
}

const GAMEPAD_BUTTON_ACTIONS = {
  0: () => togglePlayPause(), // A
  1: () => toggleMute(), // B
  2: () => toggleFullscreen(), // X
  12: () => changeVolume(GAMEPAD_VOLUME_DELTA), // D-pad up
  13: () => changeVolume(-GAMEPAD_VOLUME_DELTA), // D-pad down
  14: () => seekBy(-SEEK_DELTA), // D-pad left
  15: () => seekBy(SEEK_DELTA) // D-pad right
};

function handleGamepadButtonPress(buttonIndex) {
  if (cbzState.active) return;
  const action = GAMEPAD_BUTTON_ACTIONS[buttonIndex];
  if (typeof action === 'function') {
    action();
  }
}

function pollGamepads() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  const gamepads = navigator.getGamepads();
  if (!gamepads) return;
  let anyConnected = false;
  for (const pad of gamepads) {
    if (!pad || !pad.connected) continue;
    anyConnected = true;
    const previous = gamepadPrevButtonState.get(pad.index) || [];
    pad.buttons.forEach((button, idx) => {
      const wasPressed = !!previous[idx];
      if (button && button.pressed && !wasPressed) {
        handleGamepadButtonPress(idx);
      }
    });
    const nextStates = pad.buttons.map(btn => !!(btn && btn.pressed));
    gamepadPrevButtonState.set(pad.index, nextStates);
  }
  if (!anyConnected) {
    gamepadPrevButtonState.clear();
  }
}

function gamepadLoop() {
  pollGamepads();
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  gamepadPollHandle = window.requestAnimationFrame(gamepadLoop);
}

function startGamepadPolling() {
  if (gamepadPollHandle !== null) return;
  if (typeof window === 'undefined') return;
  if (typeof window.requestAnimationFrame !== 'function') return;
  gamepadLoop();
}

function stopGamepadPolling() {
  if (gamepadPollHandle !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(gamepadPollHandle);
  }
  gamepadPollHandle = null;
  gamepadPrevButtonState.clear();
}

document.addEventListener('keydown', (e) => {
  if (cbzState.active) {
    handleCbzKeyboardNavigation(e);
    return;
  }
  handleVideoKeyboardShortcuts(e);
});

if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  const supportsGamepad = typeof navigator.getGamepads === 'function' || 'getGamepads' in navigator;
  if (supportsGamepad) {
    startGamepadPolling();
    window.addEventListener('gamepadconnected', startGamepadPolling);
    window.addEventListener('gamepaddisconnected', () => {
      if (typeof navigator.getGamepads !== 'function') return;
      const pads = navigator.getGamepads();
      if (!pads) {
        stopGamepadPolling();
        return;
      }
      const connected = Array.from(pads).some(p => p && p.connected);
      if (!connected) {
        stopGamepadPolling();
      }
    });
  }
}

function loadVideo(index) {
  resetSeparatedNextPartPrefetch();
  const item = flatList[index];
  updateChaptersSelection(null);
  const resumeKey = resolveResumeKeyForItem(item);
  if (resumeKey) {
    try { localStorage.setItem('lastEpSrc', resumeKey); } catch {}
  }
  try {
    const sourceTitleText = (directoryTitle && directoryTitle.textContent ? directoryTitle.textContent.trim() : '') || 'Source';
    const itemTitleText = (item && item.title) ? item.title : 'Item';
    document.title = `${sourceTitleText} | ${itemTitleText} on RSP Media Manager`;
  } catch {}

  if (item && item.isPlaceholder) {
    updateEpisodeTimeOverlay(null, 0);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch {}
      video.style.display = 'none';
      video.dataset.separatedItem = '';
      video.dataset.separatedPartIndex = '';
      video.dataset.separatedPartCount = '';
      video.dataset.separatedBaseKey = '';
    }
    if (theaterBtn) theaterBtn.style.display = 'none';
    unloadCbz();
    showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
    return;
  }

  if (isMangaVolumeItem(item)) {
    if (placeholderNotice) placeholderNotice.style.display = 'none';
    unloadCbz();
    loadMangaVolume(item);
    if (video) {
      video.dataset.separatedItem = '';
      video.dataset.separatedPartIndex = '';
      video.dataset.separatedPartCount = '';
      video.dataset.separatedBaseKey = '';
      video.style.display = 'none';
    }
    updateEpisodeTimeOverlay(null, 0);
    if (theaterBtn) theaterBtn.style.display = 'none';
    return;
  }

  if (placeholderNotice) placeholderNotice.style.display = 'none';
  unloadCbz();
  hideCbzShowVideo();
  if (video) {
    video.style.display = '';
    video.dataset.separatedItem = '';
    video.dataset.separatedPartIndex = '';
    video.dataset.separatedPartCount = '';
    video.dataset.separatedBaseKey = '';
  }

  const isSeparatedItem = hasSeparatedParts(item);
  if (isSeparatedItem && video) {
    const baseKey = resumeKey || item.__separatedBaseKey || '';
    item.__separatedBaseKey = baseKey || item.__separatedBaseKey || '';
    let resumeCombined = NaN;
    if (baseKey) {
      const storedCombined = parseFloat(localStorage.getItem(baseKey));
      if (Number.isFinite(storedCombined) && storedCombined >= 0) resumeCombined = storedCombined;
      if (Number.isFinite(item.__separatedTotalDuration) && item.__separatedTotalDuration > 0) {
        try { localStorage.setItem(`${baseKey}:duration`, item.__separatedTotalDuration); } catch {}
      }
    }
    const meta = getSeparatedMeta(item);
    if (Number.isFinite(resumeCombined)) {
      const position = resolveCombinedPosition(item, resumeCombined);
      setSeparatedPartSource(item, position.partIndex, { resumeTime: position.partTime, combinedTime: resumeCombined });
    } else {
      let fallbackIndex = 0;
      let fallbackTime = 0;
      if (baseKey) {
        const storedPart = parseInt(localStorage.getItem(`${baseKey}:part`), 10);
        if (Number.isFinite(storedPart) && storedPart >= 0) fallbackIndex = Math.max(0, storedPart);
        const storedPartTime = parseFloat(localStorage.getItem(`${baseKey}:partTime`));
        if (Number.isFinite(storedPartTime) && storedPartTime >= 0) fallbackTime = storedPartTime;
      }
      const combinedGuess = (meta && meta.offsets && meta.offsets[fallbackIndex] || 0) + Math.max(0, fallbackTime);
      setSeparatedPartSource(item, fallbackIndex, { resumeTime: fallbackTime, combinedTime: combinedGuess });
    }
  } else if (video) {
    video.src = item.src;
    video.addEventListener('loadedmetadata', function onMeta() {
      try { localStorage.setItem(video.src + ':duration', video.duration); } catch {}
      try {
        const pk = (item && item.progressKey) ? String(item.progressKey) : '';
        if (pk) localStorage.setItem(pk + ':duration', video.duration);
      } catch {}
      updateEpisodeTimeOverlay(item, video.currentTime);
      video.removeEventListener('loadedmetadata', onMeta);
    });
    let savedTime = localStorage.getItem(video.src);
    if (!savedTime && item && item.progressKey) savedTime = localStorage.getItem(String(item.progressKey));
    if (savedTime) {
      const targetTime = parseFloat(savedTime);
      if (Number.isFinite(targetTime) && targetTime >= 0) {
        try { video.currentTime = targetTime; } catch {}
      }
    }
    video.load();
  }

  if (video) attachActiveVideoListeners(video);

  if (theaterBtn) theaterBtn.style.display = 'inline-block';
  title.textContent = item.title;
  updateEpisodeTimeOverlay(item, getAggregatedCurrentTime(item));
  nextBtn.style.display = "none";
  if (!isSeparatedItem && video) {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  const params = new URLSearchParams(window.location.search);
  params.set('item', index + 1);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function showPlayerAlert(message) {
  const text = message || 'Playback error.';
  if (typeof window.showStorageNotice === 'function') {
    window.showStorageNotice({
      title: 'Playback Error',
      message: text,
      tone: 'error',
      autoCloseMs: null,
      onClose: () => {
        try {
          const legacy = document.getElementById('playerFailOverlay');
          if (legacy) legacy.remove();
        } catch {}
        try {
          if (typeof backBtn !== 'undefined' && backBtn) backBtn.click();
        } catch {}
      }
    });
    return;
  }
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
    btn.addEventListener('click', () => {
      try { overlay.remove(); } catch {}
      try { if (typeof backBtn !== 'undefined' && backBtn) backBtn.click(); } catch {}
    });
    box.append(p, btn); overlay.appendChild(box); document.body.appendChild(overlay);
  }
  const msgEl = document.getElementById('playerFailMessage');
  if (msgEl) msgEl.textContent = text;
}

function handleActiveVideoError(event) {
  const el = event && event.currentTarget ? event.currentTarget : video;
  if (!el) return;
  try { el.pause(); } catch {}
  try { el.style.display = 'none'; } catch {}
  showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
}

function handleActiveVideoTimeUpdate(event) {
  const el = event && event.currentTarget ? event.currentTarget : video;
  if (!el) return;
  let handledSeparated = false;
  let curItem = null;
  let aggregatedTime = Number(el.currentTime) || 0;
  try {
    curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
    const groupInfo = curItem && curItem.__separatedGroup ? curItem.__separatedGroup : null;
    if (hasSeparatedParts(curItem)) {
      handledSeparated = true;
      const progress = computeSeparatedProgress(curItem, el.currentTime);
      aggregatedTime = progress.time;
      const baseKey = curItem.__separatedBaseKey || resolveResumeKeyForItem(curItem);
      const ratio = (progress.duration > 0) ? (progress.time / progress.duration) : 0;
      if (nextBtn) {
        if (ratio > 0.9 && currentIndex < flatList.length - 1 && (curItem.__activePartIndex || 0) >= curItem.__separatedParts.length - 1) {
          nextBtn.style.display = 'inline-block';
        } else {
          nextBtn.style.display = 'none';
        }
      }
      if (baseKey) {
        try {
          localStorage.setItem(baseKey, progress.time);
          if (progress.duration > 0) localStorage.setItem(`${baseKey}:duration`, progress.duration);
          localStorage.setItem(`${baseKey}:part`, String(curItem.__activePartIndex || 0));
          localStorage.setItem(`${baseKey}:partTime`, String(el.currentTime));
          writeSourceScopedValue && writeSourceScopedValue('SavedItemTime', String(progress.time));
        } catch {}
      }
      const part = curItem.__separatedParts[curItem.__activePartIndex || 0];
      if (part && part.src) {
        try { localStorage.setItem(part.src, el.currentTime); } catch {}
      }
      maybePrefetchSeparatedNextPart(curItem);
    } else {
      const safeDuration = (Number.isFinite(el.duration) && el.duration > 0) ? el.duration : null;
      if (nextBtn) {
        if (!safeDuration || groupInfo) {
          nextBtn.style.display = 'none';
        } else if ((el.currentTime / safeDuration) > 0.9 && currentIndex < flatList.length - 1) {
          nextBtn.style.display = 'inline-block';
        } else {
          nextBtn.style.display = 'none';
        }
      }
      const pk = curItem && curItem.progressKey ? String(curItem.progressKey) : '';
      if (pk) localStorage.setItem(pk, el.currentTime);
      try {
        writeSourceScopedValue && writeSourceScopedValue('SavedItemTime', String(el.currentTime));
      } catch {}
    }
  } catch {}
  updateEpisodeTimeOverlay(curItem, aggregatedTime);
  if (!handledSeparated) {
    try { localStorage.setItem(el.src, el.currentTime); } catch {}
  }
}

function handleActiveVideoEnded(event) {
  const el = event && event.currentTarget ? event.currentTarget : video;
  if (!el) return;
  try { localStorage.removeItem(el.src); } catch {}
  const curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
  if (hasSeparatedParts(curItem)) {
    const meta = getSeparatedMeta(curItem);
    const baseKey = curItem.__separatedBaseKey || resolveResumeKeyForItem(curItem);
    const partIndex = curItem && Number.isFinite(Number(curItem.__activePartIndex)) ? Number(curItem.__activePartIndex) : 0;
    if (partIndex < meta.parts.length - 1) {
      if (baseKey) {
        try {
          localStorage.setItem(`${baseKey}:part`, String(partIndex + 1));
          localStorage.setItem(`${baseKey}:partTime`, '0');
        } catch {}
      }
      const nextStart = meta.offsets[partIndex + 1] || ((meta.offsets[partIndex] || 0) + getPartDuration(meta, curItem, partIndex));
      const method = getSeparatedNextPartPrefetchMethod();
      if (method === 'swap' && tryPromoteSeparatedSwapStandby(curItem, partIndex + 1, nextStart, baseKey)) {
        return;
      }
      setSeparatedPartSource(curItem, partIndex + 1, { resumeTime: 0, combinedTime: nextStart });
      try {
        video.load();
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch {}
      return;
    }
    if (baseKey) {
      try { localStorage.setItem(`${baseKey}:partTime`, '0'); } catch {}
    }
  }
  if (currentIndex < flatList.length - 1) { nextBtn.click(); }
}

function detachActiveVideoListeners(target) {
  if (!target) return;
  try { target.removeEventListener("timeupdate", handleActiveVideoTimeUpdate); } catch {}
  try { target.removeEventListener("ended", handleActiveVideoEnded); } catch {}
  try { target.removeEventListener("error", handleActiveVideoError); } catch {}
}

function attachActiveVideoListeners(target) {
  if (!target) return;
  if (activeVideoListenersAttachedTo && activeVideoListenersAttachedTo !== target) {
    detachActiveVideoListeners(activeVideoListenersAttachedTo);
  }
  activeVideoListenersAttachedTo = target;
  target.addEventListener("timeupdate", handleActiveVideoTimeUpdate);
  target.addEventListener("ended", handleActiveVideoEnded);
  target.addEventListener("error", handleActiveVideoError);
  // Native controls handle play/pause/seek UI.
}

if (video) attachActiveVideoListeners(video);

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
    resetSeparatedNextPartPrefetch();
    try { video.pause(); } catch {}
    unloadCbz();
    updateEpisodeTimeOverlay(null, 0);
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
