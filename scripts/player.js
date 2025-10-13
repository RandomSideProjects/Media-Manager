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

function updateCbzPageInfo() {
  if (!cbzState.active) return;
  if (cbzPageInfo) cbzPageInfo.textContent = `Page ${cbzState.index + 1} / ${cbzState.pages.length}`;
  if (cbzImage) cbzImage.src = cbzState.pages[cbzState.index] || '';
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
document.addEventListener('keydown', (e) => {
  if (!cbzState.active) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); if (cbzState.index > 0) { cbzState.index--; updateCbzPageInfo(); } }
  if (e.key === 'ArrowRight') { e.preventDefault(); if (cbzState.index < cbzState.pages.length - 1) { cbzState.index++; updateCbzPageInfo(); } }
});

function loadVideo(index) {
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

  if (video) {
    function onVideoError() {
      try { video.pause(); } catch {}
      video.style.display = 'none';
      showPlayerAlert("Unfortunatly, this file in unavalible at this moment, please try again later.\n If this is a local source, please download the remaining files to continue");
      video.removeEventListener('error', onVideoError);
    }
    video.addEventListener('error', onVideoError);
  }

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
  if (msgEl) msgEl.textContent = message;
}

if (video) {
  video.addEventListener("timeupdate", () => {
    let handledSeparated = false;
    let curItem = null;
    let aggregatedTime = Number(video.currentTime) || 0;
    try {
      curItem = (typeof currentIndex === 'number' && flatList && flatList[currentIndex]) ? flatList[currentIndex] : null;
      const groupInfo = curItem && curItem.__separatedGroup ? curItem.__separatedGroup : null;
      if (hasSeparatedParts(curItem)) {
        handledSeparated = true;
        const progress = computeSeparatedProgress(curItem, video.currentTime);
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
            localStorage.setItem(`${baseKey}:partTime`, String(video.currentTime));
            writeSourceScopedValue && writeSourceScopedValue('SavedItemTime', String(progress.time));
          } catch {}
        }
        const part = curItem.__separatedParts[curItem.__activePartIndex || 0];
        if (part && part.src) {
          try { localStorage.setItem(part.src, video.currentTime); } catch {}
        }
      } else {
        const safeDuration = (Number.isFinite(video.duration) && video.duration > 0) ? video.duration : null;
        if (nextBtn) {
          if (!safeDuration || groupInfo) {
            nextBtn.style.display = 'none';
          } else if ((video.currentTime / safeDuration) > 0.9 && currentIndex < flatList.length - 1) {
            nextBtn.style.display = 'inline-block';
          } else {
            nextBtn.style.display = 'none';
          }
        }
        const pk = curItem && curItem.progressKey ? String(curItem.progressKey) : '';
        if (pk) localStorage.setItem(pk, video.currentTime);
        try {
          writeSourceScopedValue && writeSourceScopedValue('SavedItemTime', String(video.currentTime));
        } catch {}
      }
    } catch {}
    updateEpisodeTimeOverlay(curItem, aggregatedTime);
    if (!handledSeparated) {
      try { localStorage.setItem(video.src, video.currentTime); } catch {}
    }
  });
  video.addEventListener("ended", () => {
    try { localStorage.removeItem(video.src); } catch {}
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
  });
  // Native controls handle play/pause/seek UI.
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
