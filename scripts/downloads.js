"use strict";

const activeDownloadObjectUrls = new Set();
try {
  if (typeof window !== 'undefined') {
    const cleanupAllObjectUrls = () => {
      try {
        activeDownloadObjectUrls.forEach((url) => {
          try { URL.revokeObjectURL(url); } catch {}
        });
      } catch {}
      activeDownloadObjectUrls.clear();
    };
    // Do not hook these cleanups to unload events so active downloads keep streaming
    // even if the user navigates away; we rely on the scheduled 2‑hour cleanup instead.
  }
} catch {}

let streamSaverLoadPromise = null;
function resolveStreamSaverAsset(file) {
  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.href === 'string') {
      return new URL(`scripts/streamsaver/${file}`, window.location.href).toString();
    }
  } catch {}
  return `scripts/streamsaver/${file}`;
}

function loadStreamSaver() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.streamSaver) return Promise.resolve(window.streamSaver);
  if (!streamSaverLoadPromise) {
    streamSaverLoadPromise = new Promise((resolve, reject) => {
      try {
        const script = document.createElement('script');
        script.src = resolveStreamSaverAsset('StreamSaver.min.js');
        script.async = true;
        script.onload = () => {
          try {
            if (window.streamSaver && !window.streamSaver.mitm) {
              window.streamSaver.mitm = resolveStreamSaverAsset('mitm.html?version=2.0.6');
            }
          } catch {}
          resolve(window.streamSaver || null);
        };
        script.onerror = (err) => reject(err || new Error('StreamSaver failed to load'));
        document.head.appendChild(script);
      } catch (err) {
        reject(err);
      }
    });
  }
  return streamSaverLoadPromise.catch(() => null);
}

function coerceSeparatedFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return false;
    if (['1','true','yes','y','separated','seperate'].includes(trimmed)) return true;
    if (['0','false','no','n'].includes(trimmed)) return false;
  }
  return false;
}

function pickFirstNumber(values, options = {}) {
  const { allowZero = false } = options;
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  if (allowZero) {
    for (const value of values) {
      const num = Number(value);
      if (Number.isFinite(num) && num === 0) return 0;
    }
  }
  return null;
}

function inferExtensionFromUrl(url, fallback = '') {
  try {
    if (!url) return fallback;
    const full = new URL(url, window.location && window.location.href ? window.location.href : 'http://localhost');
    const name = decodeURIComponent(full.pathname.split('/').pop() || '');
    if (name && name.includes('.')) {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (/^\.[a-z0-9]{1,8}$/i.test(ext)) return ext;
    }
  } catch {}
  return fallback;
}

function extractSeparatedParts(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const candidates = [
    Array.isArray(entry.sources) ? entry.sources : null,
    Array.isArray(entry.parts) ? entry.parts : null,
    Array.isArray(entry.items) ? entry.items : null,
    Array.isArray(entry.__separatedParts) ? entry.__separatedParts : null
  ];
  let sourceList = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      sourceList = candidate;
      break;
    }
  }
  return sourceList
    .filter(part => part && typeof part === 'object' && typeof part.src === 'string' && part.src.trim())
    .map((part, idx) => {
      const title = typeof part.title === 'string' && part.title.trim() ? part.title.trim() : `Part ${idx + 1}`;
      const duration = pickFirstNumber([
        part.durationSeconds,
        part.DurationSeconds,
        part.partDurationSeconds,
        part.partDuration,
        part.lengthSeconds,
        part.lengthInSeconds,
        part.timeSeconds
      ], { allowZero: true });
      const fileSize = pickFirstNumber([
        part.fileSizeBytes,
        part.FileSizeBytes,
        part.partfileSizeBytes,
        part.itemFileSizeBytes,
        part.ItemfileSizeBytes,
        part.sizeBytes,
        part.size
      ], { allowZero: true });
      return {
        title,
        src: part.src.trim(),
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        fileSize: Number.isFinite(fileSize) && fileSize >= 0 ? fileSize : null,
        raw: part
      };
    });
}

function deriveAggregatedStats(episode, parts) {
  const sizeCandidates = [
    episode && episode.fileSizeBytes,
    episode && episode.FileSizeBytes,
    episode && episode.ItemfileSizeBytes,
    episode && episode.itemFileSizeBytes,
    episode && episode.totalFileSizeBytes,
    episode && episode.sizeBytes,
    episode && episode.size
  ];
  let totalSize = pickFirstNumber(sizeCandidates, { allowZero: true });
  if ((totalSize === null || totalSize <= 0) && Array.isArray(parts) && parts.length) {
    let sum = 0;
    parts.forEach(part => {
      if (!part) return;
      const candidate = pickFirstNumber([
        part.fileSize,
        part.raw && part.raw.fileSizeBytes,
        part.raw && part.raw.FileSizeBytes,
        part.raw && part.raw.partfileSizeBytes,
        part.raw && part.raw.itemFileSizeBytes,
        part.raw && part.raw.ItemfileSizeBytes,
        part.raw && part.raw.sizeBytes,
        part.raw && part.raw.size
      ], { allowZero: true });
      if (Number.isFinite(candidate) && candidate > 0) sum += candidate;
    });
    if (sum > 0) totalSize = sum;
  }

  const durationCandidates = [
    episode && episode.durationSeconds,
    episode && episode.DurationSeconds,
    episode && episode.itemDurationSeconds,
    episode && episode.ItemDurationSeconds,
    episode && episode.ItemdurationSeconds,
    episode && episode.totalDurationSeconds,
    episode && episode.runtimeSeconds,
    episode && episode.runtime,
    episode && episode.lengthSeconds,
    episode && episode.lengthInSeconds,
    episode && episode.timeSeconds
  ];
  let totalDuration = pickFirstNumber(durationCandidates, { allowZero: true });
  if ((totalDuration === null || totalDuration <= 0) && Array.isArray(parts) && parts.length) {
    let sum = 0;
    parts.forEach(part => {
      if (!part) return;
      const candidate = pickFirstNumber([
        part.duration,
        part.raw && part.raw.durationSeconds,
        part.raw && part.raw.DurationSeconds,
        part.raw && part.raw.partDurationSeconds,
        part.raw && part.raw.partDuration,
        part.raw && part.raw.lengthSeconds,
        part.raw && part.raw.lengthInSeconds,
        part.raw && part.raw.timeSeconds
      ], { allowZero: true });
      if (Number.isFinite(candidate) && candidate > 0) sum += candidate;
    });
    if (sum > 0) totalDuration = sum;
  }

  return {
    size: Number.isFinite(totalSize) && totalSize > 0 ? Math.round(totalSize) : null,
    duration: Number.isFinite(totalDuration) && totalDuration > 0 ? Math.round(totalDuration) : null
  };
}

async function openSeasonSelectionModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', zIndex: 9998 });
    backdrop.setAttribute('role', 'presentation');
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed', background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #444',
      borderRadius: '10px', padding: '12px', width: '380px', boxShadow: '0 10px 24px rgba(0,0,0,0.55)', zIndex: 9999
    });
    const dialogTitleId = `download-selection-${Date.now().toString(36)}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', dialogTitleId);
    panel.tabIndex = -1;
    const previouslyFocused = (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.focus === 'function')
      ? document.activeElement
      : null;
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusableElements = () => {
      try {
        return Array.from(panel.querySelectorAll(focusableSelectors)).filter((el) => {
          if (!el || typeof el.disabled === 'boolean' && el.disabled) return false;
          if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
          const tabIndex = typeof el.tabIndex === 'number' ? el.tabIndex : 0;
          if (tabIndex < 0) return false;
          const rect = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : null;
          return !!rect && (rect.width > 0 || rect.height > 0);
        });
      } catch { return []; }
    };
    let resolved = false;
    function cleanupAndResolve(result) {
      if (resolved) return;
      resolved = true;
      panel.removeEventListener('keydown', onKeyDown);
      try { panel.remove(); } catch {}
      try { backdrop.remove(); } catch {}
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch {}
      }
      resolve(result);
    }
    function onKeyDown(event) {
      if (!event) return;
      const key = event.key || event.code;
      if (key === 'Escape' || key === 'Esc') {
        event.preventDefault();
        cleanupAndResolve(null);
        return;
      }
      if (key === 'Tab') {
        const focusable = getFocusableElements();
        if (!focusable.length) {
          event.preventDefault();
          try { panel.focus(); } catch {}
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = (typeof document !== 'undefined') ? document.activeElement : null;
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          try { first.focus(); } catch {}
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          try { last.focus(); } catch {}
        }
      }
    }
    panel.addEventListener('keydown', onKeyDown);
    try {
      const btn = document.getElementById('settingsBtn');
      const r = btn ? btn.getBoundingClientRect() : { top: 16, right: window.innerWidth - 16, bottom: 16 };
      panel.style.top = Math.round((r.bottom || 16) + 8) + 'px';
      panel.style.right = Math.round(Math.max(8, window.innerWidth - (r.right || (window.innerWidth - 16)))) + 'px';
    } catch {}

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'overlay-close';
    closeBtn.setAttribute('aria-label', 'Close download selection');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => cleanupAndResolve(null));
    panel.appendChild(closeBtn);

    const h = document.createElement('div'); h.id = dialogTitleId; h.textContent = 'Download Selection'; h.style.fontWeight = '700'; h.style.margin = '0 0 6px 0';
    const list = document.createElement('div'); list.style.maxHeight = '50vh'; list.style.overflow = 'auto'; list.style.padding = '4px 0';
    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '8px' });
    const btnOk = document.createElement('button'); btnOk.type = 'button'; btnOk.textContent = 'Download'; btnOk.className = 'pill-button';
    const totalSpan = document.createElement('span'); totalSpan.style.color = '#b6b6b6'; totalSpan.style.whiteSpace = 'nowrap';

    // State
    const seasonCbs = [];
    const seasonSizes = [];
    const episodeCbs = []; // [seasonIndex] => [HTMLInputElement]
    const episodeSizes = []; // [seasonIndex] => [number]

    function computeTotal() {
      // Sum across selected episodes
      let sum = 0;
      for (let si = 0; si < episodeCbs.length; si++) {
        const eps = episodeCbs[si] || [];
        const sizes = episodeSizes[si] || [];
        for (let ei = 0; ei < eps.length; ei++) {
          if (eps[ei] && eps[ei].checked) {
            sum += (sizes[ei] || 0);
          }
        }
      }
      totalSpan.textContent = formatBytesDecimalMaxUnit(sum);
    }

    function updateSeasonIndeterminate(seasonIndex) {
      const cb = seasonCbs[seasonIndex];
      const eps = episodeCbs[seasonIndex] || [];
      if (!cb || eps.length === 0) return;
      const checkedCount = eps.filter(e => e.checked).length;
      cb.indeterminate = checkedCount > 0 && checkedCount < eps.length;
      cb.checked = checkedCount === eps.length;
    }

    // Build rows
    videoList.forEach((cat, idx) => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 0' });

      const leftWrap = document.createElement('div');
      Object.assign(leftWrap.style, { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 });

      const caret = document.createElement('button');
      caret.textContent = '▸';
      Object.assign(caret.style, { cursor: 'pointer', border: 'none', background: 'transparent', color: '#f1f1f1', fontSize: '14px', width: '18px', marginLeft: '6px' });

      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.index = String(idx);
      const name = document.createElement('span'); name.textContent = cat.category; name.style.marginLeft = '2px'; name.style.whiteSpace = 'nowrap'; name.style.overflow = 'hidden'; name.style.textOverflow = 'ellipsis';
      leftWrap.append(cb, name, caret);

      const sizeSpan = document.createElement('span'); sizeSpan.style.color = '#b6b6b6'; sizeSpan.style.whiteSpace = 'nowrap';
      let seasonBytes = 0; try {
        (cat.episodes || []).forEach(e => {
          const sizeCandidate = e && (e.fileSizeBytes ?? e.ItemfileSizeBytes ?? e.itemFileSizeBytes);
          const v = Number(sizeCandidate);
          if (Number.isFinite(v) && v >= 0) seasonBytes += v;
        });
      } catch {}
      seasonSizes[idx] = seasonBytes; sizeSpan.textContent = formatBytesDecimalMaxUnit(seasonBytes);

      row.append(leftWrap, sizeSpan); list.appendChild(row); seasonCbs.push(cb);

      // Episodes container (collapsed by default)
      const epsContainer = document.createElement('div');
      Object.assign(epsContainer.style, { display: 'none', paddingLeft: '24px', borderLeft: '1px solid #333', marginLeft: '8px' });

      const epsCbs = [];
      const epsSizes = [];
      (cat.episodes || []).forEach((ep, ei) => {
        const epRow = document.createElement('label');
        Object.assign(epRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 0' });
        const epLeft = document.createElement('span');
        const epCb = document.createElement('input'); epCb.type = 'checkbox'; epCb.checked = true; epCb.dataset.season = String(idx); epCb.dataset.episode = String(ei);
        const epTitle = document.createElement('span'); epTitle.textContent = ep.title || `Episode ${ei+1}`; epTitle.style.marginLeft = '6px';
        epLeft.append(epCb, epTitle);
        const epSize = document.createElement('span'); epSize.style.color = '#b6b6b6'; epSize.style.whiteSpace = 'nowrap';
        let epBytes = 0;
        try {
          const sizeCandidate = ep && (ep.fileSizeBytes ?? ep.ItemfileSizeBytes ?? ep.itemFileSizeBytes);
          const v = Number(sizeCandidate);
          if (Number.isFinite(v) && v >= 0) epBytes = v;
        } catch {}
        epSize.textContent = formatBytesDecimalMaxUnit(epBytes);
        epsSizes[ei] = epBytes;
        epRow.append(epLeft, epSize);
        epsContainer.appendChild(epRow);

        epCb.addEventListener('change', () => { updateSeasonIndeterminate(idx); computeTotal(); });
        epsCbs.push(epCb);
      });

      episodeCbs[idx] = epsCbs;
      episodeSizes[idx] = epsSizes;
      list.appendChild(epsContainer);

      // Caret toggle
      caret.addEventListener('click', () => {
        const isOpen = epsContainer.style.display !== 'none';
        epsContainer.style.display = isOpen ? 'none' : 'block';
        caret.textContent = isOpen ? '▸' : '▾';
      });

      // Season checkbox toggles all episodes
      cb.addEventListener('change', () => {
        const check = cb.checked;
        const eps = episodeCbs[idx] || [];
        eps.forEach(e => { e.checked = check; });
        updateSeasonIndeterminate(idx);
        computeTotal();
      });
    });

    // Initialize total and states
    videoList.forEach((_, idx) => updateSeasonIndeterminate(idx));
    computeTotal(); footer.append(btnOk, totalSpan); panel.append(h, list, footer); document.body.append(backdrop, panel);

    function closeMenu(result) { cleanupAndResolve(result); }
    backdrop.addEventListener('click', () => closeMenu(null));

    btnOk.addEventListener('click', () => {
      // Build selection: seasons where all eps checked => selectedCategories; otherwise selectedEpisodesBySeason
      const selectedCategories = new Set();
      const selectedEpisodesBySeason = {};
      for (let si = 0; si < episodeCbs.length; si++) {
        const eps = episodeCbs[si] || [];
        if (eps.length === 0) continue;
        const checkedIdxs = eps.map((cb, i) => cb.checked ? i : -1).filter(i => i >= 0);
        if (checkedIdxs.length === 0) continue;
        if (checkedIdxs.length === eps.length) {
          selectedCategories.add(si);
        } else {
          selectedEpisodesBySeason[si] = new Set(checkedIdxs);
        }
      }
      closeMenu({ selectedCategories, selectedEpisodesBySeason });
    });

    requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      const target = focusable.find((el) => el === btnOk) || focusable[0] || panel;
      try { target.focus(); }
      catch {}
    });
  });
}

async function downloadSourceFolder(options = {}) {
  const selectedSet = options.selectedCategories instanceof Set ? options.selectedCategories : null;
  // selectedEpisodesBySeason: { [seasonIndex]: Set(episodeIndex) }
  const selectedEpisodesBySeason = (options.selectedEpisodesBySeason && typeof options.selectedEpisodesBySeason === 'object') ? options.selectedEpisodesBySeason : null;
  const logDl = (...args) => { try { console.log('[Downloads]', ...args); } catch {} };
  function scheduleObjectUrlCleanup(url) {
    if (!url) return null;
    activeDownloadObjectUrls.add(url);
    const CLEANUP_DELAY_MS = 2 * 60 * 60 * 1000; // keep URL alive for up to 2 hours for very large downloads
    return setTimeout(() => {
      activeDownloadObjectUrls.delete(url);
      try { URL.revokeObjectURL(url); } catch {}
    }, CLEANUP_DELAY_MS);
  }
  // Build overlay + centered modal similar to upload UI
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)', zIndex: 10030,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f1f1f1',
    fontFamily: 'Segoe UI, sans-serif'
  });
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    background: '#1a1a1a', color: '#f1f1f1', border: '1px solid #333', borderRadius: '12px',
    padding: '14px 16px', width: '92%', maxWidth: '720px', boxShadow: '0 14px 28px rgba(0,0,0,0.55)'
  });
  const titleEl = document.createElement('h3');
  titleEl.textContent = 'Downloading source…';
  titleEl.style.margin = '0 0 8px 0';
  const summary = document.createElement('div'); summary.style.marginBottom = '8px'; summary.style.opacity = '.9';
  // Summary line: Speed | Remaining | Failures | ETA
  const speedLabel = document.createElement('span'); speedLabel.style.marginRight = '12px';
  const remainingLabel = document.createElement('span'); remainingLabel.style.marginRight = '12px';
  const failureLabel = document.createElement('span'); failureLabel.style.marginRight = '12px'; failureLabel.style.color = '#ff9b9b';
  const etaLabel = document.createElement('span');
  summary.append(speedLabel, remainingLabel, failureLabel, etaLabel);
  
  // Completed filter controls
  let showCompleted = true;
  let rowEls = [];
  let rowCompleted = [];
  function applyVisibilityAll(){
    try {
      for (let i = 0; i < rowEls.length; i++) {
        const el = rowEls[i]; if (!el) continue;
        el.style.display = (showCompleted || !rowCompleted[i]) ? 'flex' : 'none';
      }
    } catch {}
  }
  const controlsRow = document.createElement('div');
  Object.assign(controlsRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', margin: '4px 0 8px 0' });
  const showCompleteLabel = document.createElement('label');
  showCompleteLabel.style.display = 'flex';
  showCompleteLabel.style.alignItems = 'center';
  showCompleteLabel.style.gap = '6px';
  const showCompleteCb = document.createElement('input'); showCompleteCb.type = 'checkbox'; showCompleteCb.checked = true;
  const showCompleteText = document.createElement('span'); showCompleteText.textContent = 'Show completed downloads';
  showCompleteLabel.append(showCompleteCb, showCompleteText);
  controlsRow.appendChild(showCompleteLabel);
  showCompleteCb.addEventListener('change', () => { showCompleted = !!showCompleteCb.checked; applyVisibilityAll(); });
  const rowsContainer = document.createElement('div');
  Object.assign(rowsContainer.style, { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '50vh', overflow: 'auto' });
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'center';
  footer.style.marginTop = '10px';
  footer.style.gap = '0.75rem';
  const endEarlyBtn = document.createElement('button');
  endEarlyBtn.type = 'button';
  endEarlyBtn.textContent = 'End early';
  endEarlyBtn.className = 'pill-button';
  Object.assign(endEarlyBtn.style, {
    background: '#1d4ed8',
    color: '#fff',
    border: '1px solid #1d4ed8'
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'pill-button';
  footer.append(endEarlyBtn, cancelBtn);
  modal.append(titleEl, summary, controlsRow, rowsContainer, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let stopRequested = false;
  let cancelRequested = false;
  let abortActiveDownloads = false;
  let endEarlyPromptActive = false;
  let endEarlyChoiceMade = false;
  const xhrs = [];
  const activeFetchControllers = [];

  const zip = new JSZip();
  const titleText = (directoryTitle.textContent || 'directory').trim() || 'directory';
  const safeZipSegment = (name) => { try { return String(name || '').replace(/[\\/]+/g, ' - ').replace(/[<>:"|?*]+/g, '').replace(/\s{2,}/g, ' ').trim(); } catch { return 'untitled'; } };
  const zipRootName = safeZipSegment(titleText) || 'directory';
  const rootFolder = zip.folder(zipRootName);
  rootFolder.file('Media-Manager-source.txt', 'https://github.com/RandomSideProjects/Media-Manager/ is the origin of this web app.');

  // Add a LocalID so local-folder progress keys can be stable across sessions
  let localId;
  try { const n = Math.floor((Date.now() + Math.random() * 1000000)) % 1000000; localId = `Local${String(n).padStart(6, '0')}`; }
  catch { localId = 'Local000000'; }
  const { remoteposter: backupPoster } = extractPosterPair({ poster: sourceImageUrl, remoteposter: resolveRemotePosterUrl(sourceImageUrl || '') });
  const manifest = {
    title: titleText,
    poster: sourceImageUrl || 'N/A',
    remoteposter: backupPoster || '',
    categories: [],
    LocalID: localId
  };
  const catFolders = [];
  const catObjs = [];
  const sanitizedCats = videoList.map(cat => safeZipSegment(cat.category));
  const tasks = [];
  const skippedEpisodes = [];
  const missingEpisodes = [];
  let manifestCategoryCount = 0;
  let manifestEpisodeCount = 0;
  let manifestSeparatedCategoryCount = 0;
  let manifestSeparatedItemCount = 0;

  videoList.forEach((cat, ci) => {
    const sanitizedCategory = sanitizedCats[ci];
    const catFolder = rootFolder.folder(sanitizedCategory);
    catFolders.push(catFolder);
    const catSeparated = coerceSeparatedFlag(cat && (cat.separated ?? cat.seperated));
    if (catSeparated) manifestSeparatedCategoryCount += 1;
    else manifestCategoryCount += 1;

    const episodesPlaceholders = [];
    (cat.episodes || []).forEach((episode, ei) => {
      const epTitle = episode && episode.title ? episode.title : (catSeparated ? `Part ${ei + 1}` : `Episode ${ei + 1}`);
      const progressBaseKey = episode && episode.progressKey ? String(episode.progressKey) : null;
      const separatedParts = extractSeparatedParts(episode);
      const treatAsSeparatedItem = !catSeparated && separatedParts.length > 0;
      const rawSrc = typeof episode && typeof episode.src === 'string' ? episode.src.trim() : '';
      let ext = inferExtensionFromUrl(rawSrc);
      if (!ext && treatAsSeparatedItem && separatedParts.length) {
        ext = inferExtensionFromUrl(separatedParts[0].src);
      }
      if (!ext && episode && typeof episode.fileName === 'string' && episode.fileName.includes('.')) {
        ext = episode.fileName.slice(episode.fileName.lastIndexOf('.')).toLowerCase();
      }
      ext = (ext || '').toLowerCase();
      if (!ext || ext.length > 8 || /[^a-z0-9.]/i.test(ext)) ext = '.mp4';
      const isJsonVolume = ext === '.json';
      const isCbz = ext === '.cbz';
      const prefix = (isCbz || isJsonVolume) ? 'V' : 'E';
      const pad = String(ei + 1).padStart(2, '0');
      const folderPath = `Sources/${zipRootName}/${sanitizedCategory}/`;
      const placeholder = {
        title: epTitle,
        progressKey: progressBaseKey
      };

      if (!catSeparated) manifestEpisodeCount += 1;
      else manifestSeparatedItemCount += 1;

      const aggregates = deriveAggregatedStats(episode, treatAsSeparatedItem ? separatedParts : []);
      if (aggregates.size !== null) {
        placeholder.fileSizeBytes = aggregates.size;
        placeholder.ItemfileSizeBytes = aggregates.size;
      } else if (Number.isFinite(Number(episode && episode.fileSizeBytes))) {
        placeholder.fileSizeBytes = Number(episode.fileSizeBytes);
      }
      if (aggregates.duration !== null) {
        placeholder.durationSeconds = aggregates.duration;
      } else if (Number.isFinite(Number(episode && episode.durationSeconds))) {
        placeholder.durationSeconds = Math.round(Number(episode.durationSeconds));
      }
      if (Number.isFinite(Number(episode && episode.VolumePageCount))) {
        placeholder.VolumePageCount = Number(episode.VolumePageCount);
      }

      let shouldDownload = true;
      const epSet = selectedEpisodesBySeason && selectedEpisodesBySeason[ci];
      if (epSet instanceof Set) {
        shouldDownload = epSet.has(ei);
      } else if (selectedSet) {
        shouldDownload = selectedSet.has(ci);
      }

      const isPlaceholder = !!(episode && episode.isPlaceholder);
      const hasSeparatedSources = treatAsSeparatedItem && separatedParts.length > 0;
      const hasDirectSrc = !treatAsSeparatedItem && typeof rawSrc === 'string' && rawSrc.length > 0;
      const isJsonCandidate = isJsonVolume && typeof rawSrc === 'string' && rawSrc.length > 0;
      const lacksSource = treatAsSeparatedItem ? !hasSeparatedSources : !hasDirectSrc;
      const invalidSource = !treatAsSeparatedItem && !isJsonVolume && hasDirectSrc && !rawSrc.startsWith('http');

      let catEntryFolder = catFolder;
      let plannedTask = null;

      if (isPlaceholder || lacksSource || invalidSource) {
        placeholder.downloadFailed = true;
        placeholder.downloadError = isPlaceholder ? 'Placeholder item – skipped' : 'Missing source URL';
        if (isPlaceholder) skippedEpisodes.push(epTitle);
        else missingEpisodes.push(epTitle);
      } else if (isJsonVolume) {
        const volFolderName = `${prefix}${pad}`;
        placeholder.src = `${folderPath}${volFolderName}/index.json`;
        if (!catSeparated) placeholder.separated = 0;
        plannedTask = {
          type: 'json',
          ci,
          ei,
          episode,
          placeholder,
          volumeFolderName: volFolderName,
          sanitizedCategory,
          categoryFolder: catEntryFolder
        };
      } else if (treatAsSeparatedItem) {
        placeholder.separated = 1;
        placeholder.seperated = 1;
        placeholder.sources = [];
        const epFolderName = `${prefix}${pad}`;
        const epFolder = catEntryFolder.folder(epFolderName);
        const partPlans = separatedParts.map((part, partIndex) => {
          const partExt = inferExtensionFromUrl(part.src, ext) || ext || '.mp4';
          const partPad = String(partIndex + 1).padStart(2, '0');
          const partFileName = `P${partPad}${partExt}`;
          const localPath = `${folderPath}${epFolderName}/${partFileName}`;
          const sourceMeta = {
            title: part.title,
            src: localPath
          };
          if (Number.isFinite(part.fileSize) && part.fileSize > 0) sourceMeta.fileSizeBytes = Math.round(part.fileSize);
          if (Number.isFinite(part.duration) && part.duration > 0) sourceMeta.durationSeconds = Math.round(part.duration);
          placeholder.sources.push(sourceMeta);
          return {
            remoteUrl: part.src,
            localPath,
            fileName: partFileName,
            folder: epFolder,
            duration: part.duration,
            fileSize: part.fileSize
          };
        });
        if (!placeholder.src && placeholder.sources.length > 0) {
          placeholder.src = placeholder.sources[0].src;
        }
        plannedTask = {
          type: 'separated',
          ci,
          ei,
          episode,
          placeholder,
          parts: partPlans
        };
      } else {
        const fileName = `${prefix}${pad}${ext}`;
        placeholder.src = `${folderPath}${fileName}`;
        plannedTask = {
          type: isCbz ? 'cbz' : 'video',
          ci,
          ei,
          episode,
          placeholder,
          fileName,
          sanitizedCategory,
          categoryFolder: catEntryFolder
        };
      }

      if (shouldDownload && plannedTask && !placeholder.downloadFailed) {
        tasks.push(plannedTask);
      } else if (!shouldDownload) {
        placeholder.downloadSkipped = true;
      }

      episodesPlaceholders.push(placeholder);
    });

    const catObj = { category: cat.category, episodes: episodesPlaceholders };
    if (catSeparated) {
      catObj.separated = 1;
      catObj.seperated = 1;
    }
    catObjs.push(catObj);
    manifest.categories.push(catObj);
  });

  const totalItemCount = manifestEpisodeCount + manifestSeparatedItemCount;
  if (manifestCategoryCount > 0) manifest.categoryCount = manifestCategoryCount;
  if (manifestEpisodeCount > 0) manifest.episodeCount = manifestEpisodeCount;
  if (totalItemCount > 0) manifest.itemCount = totalItemCount;
  if (manifestSeparatedCategoryCount > 0) {
    manifest.separatedCategoryCount = manifestSeparatedCategoryCount;
    manifest.separatedItemCount = manifestSeparatedItemCount;
  }

  if (tasks.length === 0) {
    try { speedLabel.textContent = 'No downloads started'; } catch {}
    try {
      const messages = [];
      if (skippedEpisodes.length) messages.push(`Skipped placeholders: ${skippedEpisodes.length}`);
      if (missingEpisodes.length) messages.push(`Missing URLs: ${missingEpisodes.length}`);
      remainingLabel.textContent = messages.length ? messages.join(' • ') : 'Nothing eligible to download.';
      failureLabel.textContent = '';
      etaLabel.textContent = '';
    } catch {}
    cancelBtn.textContent = 'Close';
    cancelBtn.addEventListener('click', () => { try { overlay.remove(); } catch {}; }, { once: true });
    return;
  }

  const loadedBytes = Array(tasks.length).fill(0);
  const totalBytes = Array(tasks.length).fill(0);
  const dataLeftLabels = [];
  const tooltipEls = [];
  const rowProgressValues = Array(tasks.length).fill(0);
  const rowStates = Array(tasks.length).fill('queued');
  const fallbackTotalBytes = Array(tasks.length).fill(null);
  function getVisibilityAwareTimeout(baseMs) {
    try {
      if (typeof document !== 'undefined' && document.hidden) {
        return Math.max(baseMs, 15 * 60 * 1000); // 15 minutes when tab is hidden to avoid background throttling aborts
      }
    } catch {}
    return baseMs;
  }

  function applyRowBackground(idx) {
    const row = rowEls[idx];
    if (!row) return;
    const percent = Math.max(0, Math.min(100, rowProgressValues[idx] || 0));
    const state = rowStates[idx];
    let fillColor = 'rgba(78, 139, 255, 0.45)';
    if (state === 'failed') fillColor = 'rgba(255, 107, 107, 0.45)';
    else if (state === 'complete') fillColor = 'rgba(76, 175, 80, 0.45)';
    else if (state === 'cancelled') fillColor = 'rgba(224, 192, 99, 0.45)';
    else if (state === 'queued') fillColor = 'rgba(140, 140, 140, 0.3)';
    if (percent <= 0) {
      row.style.background = (state === 'failed' || state === 'cancelled') ? fillColor : '#222';
      return;
    }
    row.style.background = `linear-gradient(90deg, ${fillColor} 0%, ${fillColor} ${percent}%, #222 ${percent}%, #222 100%)`;
  }

  function setRowProgress(idx, percent, { state } = {}) {
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    rowProgressValues[idx] = clamped;
    if (state) {
      rowStates[idx] = state;
    } else if (!rowStates[idx] || rowStates[idx] === 'queued') {
      rowStates[idx] = 'active';
    }
    applyRowBackground(idx);
    updateHoverDetails(idx);
  }

  function setStatus(idx, text, { color, title } = {}) {
    const label = dataLeftLabels[idx];
    if (!label) return;
    label.textContent = text;
    label.style.color = color || '#6ec1e4';
    label.title = title !== undefined ? (title || '') : '';
    updateHoverDetails(idx);
  }

  function updateHoverDetails(idx) {
    const tooltip = tooltipEls[idx];
    if (!tooltip) return;
    let total = Number(totalBytes[idx]);
    if (!Number.isFinite(total) || total <= 0) {
      total = Number(fallbackTotalBytes[idx]);
    }
    let loaded = Number(loadedBytes[idx]);
    if (!Number.isFinite(loaded) || loaded < 0) {
      if (Number.isFinite(total) && total > 0) {
        loaded = Math.max(0, Math.min(total, (rowProgressValues[idx] / 100) * total));
      } else {
        loaded = 0;
      }
    }
    const remaining = (Number.isFinite(total) && total > 0) ? Math.max(0, total - loaded) : NaN;
    const totalStr = (Number.isFinite(total) && total > 0) ? formatBytes(total) : 'Unknown';
    const remainingStr = Number.isFinite(remaining) ? formatBytes(remaining) : 'Unknown';
    const percent = rowProgressValues[idx];
    const percentStr = Number.isFinite(percent) ? `${percent.toFixed(percent >= 100 || percent === 0 ? 0 : 1)}% complete` : '0% complete';
    tooltip.textContent = `Total Data: ${totalStr}\nData Left: ${Number.isFinite(remaining) ? remainingStr : 'Unknown'}\n${percentStr}`;
  }
  rowEls = Array(tasks.length).fill(null);
  rowCompleted = Array(tasks.length).fill(false);
  // Allow long-lived downloads; disable idle/time-based aborts.
  const REQUEST_IDLE_TIMEOUT_MS = 0; // 0 = no inactivity timeout
  const FETCH_TOTAL_TIMEOUT_MS = 0; // 0 = no total fetch timeout

  function createXhrInactivityWatchdog(xhr, rejectWithCleanup) {
    // If timeout is disabled, return a no-op watchdog.
    if (!REQUEST_IDLE_TIMEOUT_MS || REQUEST_IDLE_TIMEOUT_MS <= 0) {
      return { cancel() {} };
    }
    let finished = false;
    let timerId = null;

    const cancel = () => {
      if (finished) return;
      finished = true;
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    };

    const onTimeout = () => {
      if (finished) return;
      finished = true;
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
      try { xhr.abort(); } catch {}
      rejectWithCleanup(new Error('Timeout'));
    };

    const restart = () => {
      if (finished) return;
      if (timerId !== null) clearTimeout(timerId);
      timerId = setTimeout(onTimeout, getVisibilityAwareTimeout(REQUEST_IDLE_TIMEOUT_MS));
    };

    xhr.addEventListener('loadstart', restart);
    xhr.addEventListener('progress', restart);
    xhr.addEventListener('readystatechange', () => {
      try { if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) restart(); }
      catch {}
    });
    xhr.addEventListener('load', cancel);
    xhr.addEventListener('error', cancel);
    xhr.addEventListener('abort', cancel);
    xhr.addEventListener('loadend', cancel);
    xhr.addEventListener('timeout', onTimeout);
    restart();
    return { cancel };
  }

  async function fetchWithTimeout(resource, options = {}, timeoutMs = REQUEST_IDLE_TIMEOUT_MS) {
    const controller = new AbortController();
    const opts = { ...options, signal: controller.signal };
    let timedOut = false;
    const effectiveTimeout = getVisibilityAwareTimeout(timeoutMs);
    const timeoutId = (timeoutMs && timeoutMs > 0)
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, effectiveTimeout)
      : null;
    activeFetchControllers.push(controller);
    try {
      const response = await fetch(resource, opts);
      return response;
    } catch (err) {
      if (timedOut || (err && err.name === 'AbortError')) {
        const e = new Error('Timeout');
        e.code = 'timeout';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      const idx = activeFetchControllers.indexOf(controller);
      if (idx >= 0) activeFetchControllers.splice(idx, 1);
    }
  }
  let plannedTotalBytes = 0;
  let failureCount = 0;
  let totalFailedBytes = 0;

  function updateFailureSummary() {
    failureLabel.textContent = failureCount > 0 ? `Failed: ${failureCount}` : '';
  }

  function updateRemainingLabel() {
    try {
      const loadedSum = sumBytes(loadedBytes);
      const remainingBytes = Math.max(0, plannedTotalBytes - (loadedSum + totalFailedBytes));
      remainingLabel.textContent = 'Remaining: ' + formatBytes(remainingBytes);
    } catch {
      remainingLabel.textContent = 'Remaining: --';
    }
  }

  function normalizeDownloadError(err, wasCancelled) {
    if (wasCancelled) return 'Cancelled';
    try {
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        if (typeof err.message === 'string' && err.message) return err.message;
        const fallback = JSON.stringify(err);
        if (fallback && fallback !== '{}') return fallback;
        if (typeof err.statusText === 'string' && err.statusText) return err.statusText;
      }
      const str = String(err);
      return str && str !== '[object Object]' ? str : 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }

  function markDownloadFailed(idx, err, ci, ei, episode, { cancelled = false } = {}) {
    const rawMessage = normalizeDownloadError(err, cancelled);
    const friendly = rawMessage.replace(/^Download failed:\s*/i, 'HTTP ').trim();
    const displayMessage = friendly || (cancelled ? 'Cancelled' : 'Unknown error');
    const epObj = (catObjs[ci] && catObjs[ci].episodes) ? catObjs[ci].episodes[ei] : null;
    if (epObj && typeof epObj === 'object') {
      epObj.downloadFailed = true;
      epObj.downloadError = displayMessage;
      if (!epObj.src && episode && episode.src) epObj.src = episode.src;
    }

    if (!cancelled) {
      failureCount += 1;
      updateFailureSummary();
    }

    let plannedBytes = Number(totalBytes[idx]);
    if (!Number.isFinite(plannedBytes) || plannedBytes <= 0) {
      plannedBytes = Number(episode && episode.fileSizeBytes);
    }
    if (!cancelled && Number.isFinite(plannedBytes) && plannedBytes > 0) {
      totalFailedBytes += plannedBytes;
    }

    totalBytes[idx] = 0;
    loadedBytes[idx] = 0;

    const needsPrefix = !/^failed/i.test(displayMessage) && !/^cancelled/i.test(displayMessage);
    const text = cancelled ? displayMessage : (needsPrefix ? `Failed – ${displayMessage}` : displayMessage);
    setRowProgress(idx, 0, { state: cancelled ? 'cancelled' : 'failed' });
    const title = (episode && episode.src) ? `${text}\n${episode.src}` : undefined;
    setStatus(idx, text, { color: cancelled ? '#e0c063' : '#ff6b6b', title });
    if (rowEls[idx]) {
      rowEls[idx].style.outline = cancelled ? '1px solid rgba(224,192,99,0.6)' : '1px solid rgba(255,102,102,0.7)';
    }

    updateRemainingLabel();
    try { updateSpeedAndEta(); } catch {}
  }
  tasks.forEach((task, idx) => {
    const { ci, ei, placeholder, type } = task;
    const catName = (videoList[ci] && videoList[ci].category) ? videoList[ci].category : `Category ${ci + 1}`;
    const epTitle = (placeholder && placeholder.title) ? placeholder.title : ((task.episode && task.episode.title) ? task.episode.title : `Item ${ei + 1}`);
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '0.75em';
    row.style.padding = '6px 8px';
    row.style.background = '#222';
    row.style.borderRadius = '6px';
    row.style.fontSize = '0.9em';
    row.style.position = 'relative';
    row.style.transition = 'background 0.25s ease';
    row.tabIndex = 0;

    const labelEl = document.createElement('div');
    let labelText = `${catName} · ${epTitle}`;
    if (type === 'separated' && Array.isArray(task.parts)) {
      labelText += ` (Parts: ${task.parts.length})`;
    } else if (type === 'json') {
      labelText += ' [JSON]';
    } else if (type === 'cbz') {
      labelText += ' [CBZ]';
    }
    labelEl.textContent = labelText;
    labelEl.style.flex = '3';
    labelEl.style.minWidth = '120px';

    const statusEl = document.createElement('div');
    statusEl.textContent = 'Queued';
    statusEl.style.minWidth = '110px';
    statusEl.style.color = '#6ec1e4';
    statusEl.style.marginLeft = 'auto';
    statusEl.style.textAlign = 'right';

    const tooltip = document.createElement('div');
    tooltip.textContent = 'Total Data: Unknown\nData Left: Unknown\n0% complete';
    tooltip.style.position = 'absolute';
    tooltip.style.top = 'calc(100% + 6px)';
    tooltip.style.left = '0';
    tooltip.style.background = '#111';
    tooltip.style.border = '1px solid #444';
    tooltip.style.borderRadius = '6px';
    tooltip.style.padding = '6px 8px';
    tooltip.style.fontSize = '0.8em';
    tooltip.style.color = '#f1f1f1';
    tooltip.style.boxShadow = '0 6px 14px rgba(0,0,0,0.4)';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.whiteSpace = 'pre-line';
    tooltip.style.display = 'none';
    tooltip.style.zIndex = '5';
    tooltip.style.maxWidth = '280px';

    row.appendChild(labelEl);
    row.appendChild(statusEl);
    row.appendChild(tooltip);

    const showTooltip = () => { tooltip.style.display = 'block'; };
    const hideTooltip = () => { tooltip.style.display = 'none'; };
    row.addEventListener('mouseenter', showTooltip);
    row.addEventListener('mouseleave', hideTooltip);
    row.addEventListener('focus', showTooltip);
    row.addEventListener('blur', hideTooltip);

    dataLeftLabels[idx] = statusEl;
    rowsContainer.appendChild(row);
    rowEls[idx] = row;
    tooltipEls[idx] = tooltip;
    const placeholderSize = Number(placeholder && placeholder.fileSizeBytes);
    if (Number.isFinite(placeholderSize) && placeholderSize > 0) {
      fallbackTotalBytes[idx] = placeholderSize;
    }
    applyRowBackground(idx);
    updateHoverDetails(idx);
  });
  applyVisibilityAll();

  plannedTotalBytes = 0;
  try {
    for (const task of tasks) {
      const placeholder = task && task.placeholder;
      const v = Number(placeholder && placeholder.fileSizeBytes);
      if (Number.isFinite(v) && v >= 0) plannedTotalBytes += v;
    }
  } catch {}
  updateRemainingLabel();
  updateFailureSummary();
  speedLabel.textContent = 'Speed: 0.00 MB/s';
  function resetEndEarlyPrompt() {
    endEarlyPromptActive = false;
    if (!endEarlyChoiceMade) {
      endEarlyBtn.disabled = false;
      endEarlyBtn.textContent = 'End early';
    }
  }
  function finalizeEndEarly(waitForActive) {
    if (endEarlyChoiceMade) return;
    endEarlyChoiceMade = true;
    endEarlyPromptActive = false;
    stopRequested = true;
    endEarlyBtn.disabled = true;
    endEarlyBtn.textContent = 'Ending early…';
    if (waitForActive) {
      try { remainingLabel.textContent = 'Waiting for active downloads to finish…'; } catch {}
    } else {
      abortActiveDownloads = true;
      try { remainingLabel.textContent = 'Ending active downloads immediately…'; } catch {}
      activeFetchControllers.forEach((controller) => {
        if (controller && typeof controller.abort === 'function') {
          try { controller.abort(); } catch {}
        }
      });
      activeFetchControllers.length = 0;
      xhrs.forEach((xhr) => { if (xhr && typeof xhr.abort === 'function') { try { xhr.abort(); } catch {} } });
    }
  }
  endEarlyBtn.addEventListener('click', () => {
    if (stopRequested || endEarlyPromptActive) return;
    endEarlyPromptActive = true;
    const message = 'Do you want to wait until active downloads (non queued) are complete or end immediately?';
    const noticeSource = (typeof window !== 'undefined' && typeof window.showAppNotice === 'function')
      ? window.showAppNotice
      : window.mmNotices?.show;
    if (noticeSource) {
      noticeSource({
        title: 'End early?',
        message,
        tone: 'warning',
        actions: [
          {
            label: 'Wait for active downloads',
            className: 'storage-notice__btn--primary',
            onClick: () => finalizeEndEarly(true)
          },
          {
            label: 'End immediately',
            className: 'storage-notice__btn--danger',
            onClick: () => finalizeEndEarly(false)
          }
        ],
        dismissLabel: 'Cancel',
        onClose: () => resetEndEarlyPrompt()
      });
    } else {
      const waitForActive = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(`${message}\n\nPress OK to wait for active downloads, or Cancel to end immediately.`)
        : true;
      finalizeEndEarly(waitForActive);
    }
  });
  cancelBtn.addEventListener('click', () => {
    stopRequested = true;
    cancelRequested = true;
    xhrs.forEach((xhr) => { if (xhr && typeof xhr.abort === 'function') { try { xhr.abort(); } catch {} } });
    activeFetchControllers.forEach((controller) => {
      if (controller && typeof controller.abort === 'function') {
        try { controller.abort(); } catch {}
      }
    });
    activeFetchControllers.length = 0;
    try { overlay.remove(); } catch {}
  });

  const devModeEnabled = typeof window !== 'undefined' && window.DevMode === true;
  const DEFAULT_DL_CONCURRENCY = 2;
  const STANDARD_MAX_CONCURRENCY = 8;
  const storedDlConc = parseInt(localStorage.getItem('downloadConcurrency') || '', 10);
  const desiredConcurrency = (Number.isFinite(storedDlConc) && storedDlConc > 0)
    ? Math.floor(storedDlConc)
    : DEFAULT_DL_CONCURRENCY;
  const concurrency = Math.max(1, devModeEnabled ? desiredConcurrency : Math.min(STANDARD_MAX_CONCURRENCY, desiredConcurrency));
  try { speedLabel.title = `Concurrency: ${concurrency}${devModeEnabled ? ' (dev)' : ''}`; }
  catch {}
  let pointer = 0;
  const downloadStartTime = Date.now();
  const SPEED_SAMPLE_WINDOW_MS = 5000;
  const speedSamples = [];
  const speedNow = (typeof performance === 'object' && performance && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

  function resetSpeedSamples() {
    speedSamples.length = 0;
    speedSamples.push({ time: speedNow(), bytes: 0 });
  }

  function sumBytes(list) {
    try {
      return list.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
    } catch {
      return 0;
    }
  }

  function updateSpeedAndEta({ totalLoaded, totalTotal } = {}) {
    const loaded = Number.isFinite(totalLoaded) ? totalLoaded : sumBytes(loadedBytes);
    const total = Number.isFinite(totalTotal) ? totalTotal : sumBytes(totalBytes);
    const now = speedNow();
    speedSamples.push({ time: now, bytes: loaded });
    const cutoff = now - SPEED_SAMPLE_WINDOW_MS;
    while (speedSamples.length > 1 && speedSamples[0].time < cutoff) {
      speedSamples.shift();
    }
    let bytesPerSecond = 0;
    if (speedSamples.length >= 2) {
      const first = speedSamples[0];
      const elapsedSec = (now - first.time) / 1000;
      const deltaBytes = loaded - first.bytes;
      if (elapsedSec > 0.05 && deltaBytes >= 0) {
        bytesPerSecond = deltaBytes / elapsedSec;
      }
    }
    if (bytesPerSecond <= 0 && speedSamples.length < 2) {
      const elapsedSec = Math.max(0.001, (Date.now() - downloadStartTime) / 1000);
      bytesPerSecond = loaded / elapsedSec;
    }
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) bytesPerSecond = 0;
    const speedMBps = bytesPerSecond / (1024 * 1024);
    try { speedLabel.textContent = `Speed: ${speedMBps.toFixed(2)} MB/s`; } catch {}
    const remaining = total - loaded;
    let etaText = '';
    if (Number.isFinite(remaining) && remaining > 0 && bytesPerSecond > 0) {
      const seconds = remaining / bytesPerSecond;
      const minutes = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      etaText = `ETA: ${minutes}m ${secs}s`;
    }
    try { etaLabel.textContent = etaText; } catch {}
  }

  resetSpeedSamples();

  async function computeBlobDurationSeconds(blob) {
    return new Promise((resolve) => { try { const url = URL.createObjectURL(blob); const v = document.createElement('video'); v.preload = 'metadata'; const done = () => { try { URL.revokeObjectURL(url); } catch {} const d = isFinite(v.duration) ? v.duration : NaN; resolve(d); }; v.onloadedmetadata = done; v.onerror = done; v.src = url; } catch { resolve(NaN); } });
  }

  async function computeBlobPageCount(blob) {
    try {
      const zip = await JSZip.loadAsync(blob);
      const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
      return names.length;
    } catch { return NaN; }
  }

  const workers = Array.from({ length: concurrency }, async () => {
    while (!stopRequested && pointer < tasks.length) {
      const idx = pointer++;
      const task = tasks[idx];
      const { ci, ei, episode, placeholder, type } = task;
      try {
        setStatus(idx, 'Starting…', { color: '#6ec1e4' });
        logDl('Start', { idx, type, category: ci, episode: ei, src: episode && episode.src });
        if (type === 'json') {
          // JSON volume: fetch JSON, inline remote links as base64 data URIs, save JSON
          const epObj = catObjs[ci].episodes[ei];
          const folderPath = `Sources/${zipRootName}/${task.sanitizedCategory}/`;
          const volFolderName = task.volumeFolderName;
          const volFolder = task.categoryFolder.folder(volFolderName);
          // Point to the nested index.json
          epObj.src = `${folderPath}${volFolderName}/index.json`;

          // Helper to fetch a URL to Blob and detect extension
          function mimeToExt(mime) {
            const m = String(mime || '').toLowerCase();
            if (m.includes('jpeg')) return '.jpg';
            if (m.includes('jpg')) return '.jpg';
            if (m.includes('png')) return '.png';
            if (m.includes('webp')) return '.webp';
            if (m.includes('gif')) return '.gif';
            if (m.includes('bmp')) return '.bmp';
            if (m.includes('svg')) return '.svg';
            return '';
          }
          async function fetchImage(u) {
            // Try XHR first to get progress
            try {
              const blob = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest(); xhrs.push(xhr);
                let cleaned = false;
                let watchdog;
                const cleanup = () => {
                  if (cleaned) return;
                  cleaned = true;
                  if (watchdog) watchdog.cancel();
                  const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1);
                };
                const rejectWithCleanup = (err) => { cleanup(); reject(err); };
                watchdog = createXhrInactivityWatchdog(xhr, rejectWithCleanup);
                xhr.addEventListener('loadend', cleanup);
                xhr.open('GET', u); xhr.responseType = 'blob';
                xhr.onload = () => {
                  const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
                  if (ok) { cleanup(); resolve(xhr.response); }
                  else { rejectWithCleanup(new Error('HTTP ' + xhr.status)); }
                };
                xhr.onerror = () => rejectWithCleanup(new Error('Network error'));
                xhr.send();
              });
              const type = (blob && blob.type) || '';
              let ext = mimeToExt(type);
              if (!ext) {
                try { const urlParts = new URL(u, window.location.href); const name = decodeURIComponent(urlParts.pathname.split('/').pop()); if (name && name.includes('.')) ext = name.slice(name.lastIndexOf('.')).toLowerCase(); } catch {}
              }
              return { blob, ext: ext || '.jpg' };
            } catch {
              const resp = await fetchWithTimeout(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }, REQUEST_IDLE_TIMEOUT_MS);
              if (!resp || (!resp.ok && resp.status !== 0)) throw new Error('fetch failed');
              const blob = await resp.blob();
              const type = (blob && blob.type) || '';
              let ext = mimeToExt(type);
              if (!ext) {
                try { const urlParts = new URL(u, window.location.href); const name = decodeURIComponent(urlParts.pathname.split('/').pop()); if (name && name.includes('.')) ext = name.slice(name.lastIndexOf('.')).toLowerCase(); } catch {}
              }
              return { blob, ext: ext || '.jpg' };
            }
          }

          // Fetch the JSON text (try XHR first to match cross-origin behavior of other downloads)
          let jsonText = '';
          try {
            const blob = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest(); xhrs.push(xhr);
              let cleaned = false;
              let watchdog;
              const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                if (watchdog) watchdog.cancel();
                const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1);
              };
              const rejectWithCleanup = (err) => { cleanup(); reject(err); };
              watchdog = createXhrInactivityWatchdog(xhr, rejectWithCleanup);
              xhr.addEventListener('loadend', cleanup);
              xhr.open('GET', episode.src); xhr.responseType = 'blob';
              xhr.onprogress = (e) => {
                if (e.lengthComputable) {
                  // Map network progress to a small early bump (0-10%)
                  const pct = Math.min(10, (e.loaded / Math.max(1, e.total)) * 10);
                  setRowProgress(idx, pct);
                }
              };
              xhr.onload = () => {
                const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
                if (ok) { cleanup(); resolve(xhr.response); }
                else { rejectWithCleanup(new Error('Download failed: ' + xhr.status)); }
              };
              xhr.onerror = () => rejectWithCleanup(new Error('Network error'));
              xhr.send();
            });
            jsonText = await blob.text();
          } catch {
            const resp = await fetchWithTimeout(episode.src, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }, FETCH_TOTAL_TIMEOUT_MS);
            if (!resp || (!resp.ok && resp.status !== 0)) throw new Error('Download failed');
            jsonText = await resp.text();
          }
          let json;
          try { json = JSON.parse(jsonText); } catch { throw new Error('Invalid JSON'); }
          // Extract page URLs from JSON (supports array or object mapping form)
          function parsePages(j) {
            try {
              if (!j || typeof j !== 'object') return [];
              if (Array.isArray(j.pages)) {
                return j.pages.map(p => {
                  if (typeof p === 'string') return p; if (p && typeof p === 'object') return p.src || p.url || p.data || ''; return '';
                }).filter(Boolean);
              }
              if (Array.isArray(j.images)) {
                return j.images.map(p => (typeof p === 'string') ? p : (p && (p.src || p.url || p.data) || '')).filter(Boolean);
              }
              const candidates = j.pages && typeof j.pages === 'object' ? j.pages : j;
              const entries = Object.entries(candidates).map(([k, v]) => {
                let n = NaN; try { const m = String(k).match(/(\d+)/); if (m) n = parseInt(m[1], 10); } catch {}
                let url = ''; if (typeof v === 'string') url = v; else if (v && typeof v === 'object') url = v.src || v.url || v.data || '';
                return { n, url };
              }).filter(e => Number.isFinite(e.n) && e.n >= 1 && e.url);
              entries.sort((a, b) => a.n - b.n);
              return entries.map(e => e.url);
            } catch { return []; }
          }
          const pageUrls = parsePages(json);
          const totalLinks = pageUrls.length;
          let completed = 0;
          function updateProgress() {
            const pct = totalLinks > 0 ? (completed / totalLinks) * 100 : 100;
            setRowProgress(idx, pct);
            const text = totalLinks > 0 ? `${completed}/${totalLinks} files` : '';
            setStatus(idx, text, { color: '#6ec1e4' });
          }
          updateProgress();

          const perItemConcurrency = Math.min(4, Math.max(1, concurrency));
          let linkPtr = 0;
          const filesOut = Array(totalLinks).fill(null);
          let bytesSum = 0;
          async function workerDl() {
            while (linkPtr < totalLinks) {
              const i = linkPtr++;
              const { blob, ext } = await fetchImage(pageUrls[i]);
              filesOut[i] = { blob, ext };
              try { if (blob && typeof blob.size === 'number') bytesSum += blob.size; } catch {}
              completed++;
              updateProgress();
            }
          }
          await Promise.all(Array.from({ length: perItemConcurrency }, workerDl));

          // Write files and index.json
          const pageList = [];
          for (let i = 0; i < filesOut.length; i++) {
            const f = filesOut[i]; if (!f) continue; const name = `${String(i+1).padStart(3,'0')}${f.ext}`;
            volFolder.file(name, f.blob);
            pageList.push(name);
          }
          const pagesObj = {};
          for (let i = 0; i < pageList.length; i++) pagesObj[`Page ${i+1}`] = pageList[i];
          const outJson = { pagecount: pageList.length, pages: pagesObj };
          const outText = JSON.stringify(outJson, null, 2);
          volFolder.file('index.json', outText);

          // Update manifest ep
          let measuredSize = bytesSum;
          try {
            const sz = new TextEncoder().encode(outText).length;
            measuredSize = bytesSum + sz;
          } catch {}
          epObj.fileSizeBytes = measuredSize;
          if (Number.isFinite(measuredSize) && measuredSize >= 0) {
            loadedBytes[idx] = measuredSize;
            totalBytes[idx] = measuredSize;
            updateRemainingLabel();
            updateSpeedAndEta();
          }
          epObj.VolumePageCount = pageList.length;
          epObj.durationSeconds = null;

          // Mark row completed
          setRowProgress(idx, 100, { state: 'complete' });
          setStatus(idx, 'Done', { color: '#7fe7a9' });
          rowCompleted[idx] = true;
          applyVisibilityAll();
        } else if (type === 'separated') {
          const epObj = catObjs[ci].episodes[ei];
          const partPlans = Array.isArray(task.parts) ? task.parts : [];
          if (!partPlans.length) throw new Error('No separated parts available');
          let completedParts = 0;
          let accumulatedBytes = 0;
          let accumulatedDuration = 0;
          loadedBytes[idx] = 0;
          totalBytes[idx] = 0;
          for (let partIndex = 0; partIndex < partPlans.length; partIndex++) {
            const plan = partPlans[partIndex];
            if (!plan || !plan.remoteUrl) throw new Error(`Missing source for part ${partIndex + 1}`);
            let partBlob = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest(); xhrs.push(xhr);
              let cleaned = false;
              let watchdog;
              const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                if (watchdog) watchdog.cancel();
                const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1);
              };
              const rejectWithCleanup = (err) => { cleanup(); reject(err); };
              watchdog = createXhrInactivityWatchdog(xhr, rejectWithCleanup);
              xhr.addEventListener('loadend', cleanup);
              xhr.open('GET', plan.remoteUrl); xhr.responseType = 'blob';
              xhr.addEventListener('progress', e => {
                if (e.lengthComputable) {
                  const partProgress = Math.max(0, Math.min(1, e.loaded / Math.max(1, e.total)));
                  const overallProgress = ((completedParts + partProgress) / partPlans.length) * 100;
                  setRowProgress(idx, overallProgress);
                  loadedBytes[idx] = accumulatedBytes + e.loaded;
                  totalBytes[idx] = accumulatedBytes + e.total;
                  updateRemainingLabel();
                  const totalLoaded = sumBytes(loadedBytes);
                  const totalTotal = sumBytes(totalBytes);
                  updateSpeedAndEta({ totalLoaded, totalTotal });
                  const remainingBytesPart = e.total - e.loaded;
                  const remainingMB = (remainingBytesPart / (1024 * 1024)).toFixed(2);
                  setStatus(idx, `${remainingMB} MB left (Part ${partIndex + 1}/${partPlans.length})`, { color: '#6ec1e4' });
                } else {
                  setStatus(idx, `Part ${partIndex + 1}/${partPlans.length}…`, { color: '#6ec1e4' });
                }
              });
              xhr.onload = () => {
                const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
                if (ok) { cleanup(); resolve(xhr.response); }
                else { rejectWithCleanup(new Error('Download failed: ' + xhr.status)); }
              };
              xhr.onerror = () => rejectWithCleanup(new Error('Network error'));
              xhr.send();
            }).catch(() => null);

            if (!partBlob) {
              try {
                const resp = await fetchWithTimeout(plan.remoteUrl, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }, FETCH_TOTAL_TIMEOUT_MS);
                if (resp && (resp.ok || resp.status === 0)) {
                  partBlob = await resp.blob();
                }
              } catch {}
            }
            if (!partBlob) throw new Error(`Download failed for part ${partIndex + 1}`);
            plan.folder.file(plan.fileName, partBlob);
            const partSize = Number(partBlob && partBlob.size);
            if (Number.isFinite(partSize) && partSize >= 0) {
              accumulatedBytes += partSize;
              loadedBytes[idx] = accumulatedBytes;
              totalBytes[idx] = accumulatedBytes;
              updateRemainingLabel();
              updateSpeedAndEta();
              if (placeholder && Array.isArray(placeholder.sources) && placeholder.sources[partIndex]) {
                placeholder.sources[partIndex].fileSizeBytes = Math.round(partSize);
              }
            }
            try {
              const duration = await computeBlobDurationSeconds(partBlob);
              if (Number.isFinite(duration) && duration > 0) {
                accumulatedDuration += duration;
                if (placeholder && Array.isArray(placeholder.sources) && placeholder.sources[partIndex]) {
                  placeholder.sources[partIndex].durationSeconds = Math.round(duration);
                }
              }
            } catch {}
            completedParts += 1;
            {
              const pct = (completedParts / partPlans.length) * 100;
              setRowProgress(idx, pct);
              const status = completedParts === partPlans.length ? 'Finalizing…' : `Part ${completedParts}/${partPlans.length}`;
              setStatus(idx, status, { color: '#6ec1e4' });
            }
          }
          if (accumulatedBytes > 0) {
            epObj.fileSizeBytes = Math.round(accumulatedBytes);
            epObj.ItemfileSizeBytes = Math.round(accumulatedBytes);
          }
          if (accumulatedDuration > 0) {
            epObj.durationSeconds = Math.round(accumulatedDuration);
          }
          setRowProgress(idx, 100, { state: 'complete' });
          setStatus(idx, 'Done', { color: '#7fe7a9' });
          rowCompleted[idx] = true;
          applyVisibilityAll();
        } else {
          const fileName = task.fileName;
          const isCbz = type === 'cbz';
          // Regular path: download blob directly
          let blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest(); xhrs.push(xhr);
            let cleaned = false;
            let watchdog;
            const cleanup = () => {
              if (cleaned) return;
              cleaned = true;
              if (watchdog) watchdog.cancel();
              const i = xhrs.indexOf(xhr); if (i >= 0) xhrs.splice(i, 1);
            };
            const rejectWithCleanup = (err) => { cleanup(); reject(err); };
            watchdog = createXhrInactivityWatchdog(xhr, rejectWithCleanup);
            xhr.addEventListener('loadend', cleanup);
            xhr.open('GET', episode.src); xhr.responseType = 'blob';
              xhr.addEventListener('progress', e => {
                if (e.lengthComputable) {
                  setRowProgress(idx, (e.loaded / Math.max(1, e.total)) * 100);
                  loadedBytes[idx] = e.loaded;
                  totalBytes[idx] = e.total;
                  logDl('Progress', { idx, loaded: e.loaded, total: e.total, url: episode.src });
                  const totalLoaded = sumBytes(loadedBytes);
                  const totalTotal = sumBytes(totalBytes);
                  updateSpeedAndEta({ totalLoaded, totalTotal });
                  const remainingBytes = totalBytes[idx] - loadedBytes[idx];
                  const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(2);
                setStatus(idx, `${remainingMB} MB left`, { color: '#6ec1e4' });
                updateRemainingLabel();
              } else {
                setStatus(idx, `${formatBytes(e.loaded)} downloaded`, { color: '#6ec1e4' });
              }
            });
            // Treat status 0 as success for opaque/file responses (matches player.js behavior)
            xhr.onload = () => {
              const ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
              if (ok) { cleanup(); resolve(xhr.response); }
              else { rejectWithCleanup(new Error('Download failed: ' + xhr.status)); }
            };
            xhr.onerror = () => rejectWithCleanup(new Error('Network error'));
            xhr.send();
          }).catch(() => null);

          // Fallback to fetch if XHR fails (some hosts behave better with fetch)
          if (!blob) {
            try {
              const resp = await fetchWithTimeout(episode.src, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }, FETCH_TOTAL_TIMEOUT_MS);
              if (resp && (resp.ok || resp.status === 0)) {
                blob = await resp.blob();
              }
            } catch {
              // ignore; will throw below if blob still null
            }
          }

          if (!blob) throw new Error('Download failed');
          logDl('Downloaded blob', { idx, size: blob && blob.size, fileName, url: episode && episode.src });
          task.categoryFolder.file(fileName, blob);
          const epObj = catObjs[ci].episodes[ei];
          epObj.src = placeholder && placeholder.src ? placeholder.src : `Sources/${zipRootName}/${task.sanitizedCategory}/${fileName}`;
          try {
            const sz = Number(blob && blob.size);
            if (Number.isFinite(sz) && sz >= 0) {
              epObj.fileSizeBytes = sz;
              loadedBytes[idx] = sz;
              totalBytes[idx] = sz;
              updateRemainingLabel();
              updateSpeedAndEta();
            }
          } catch {}
          // Set per-item metadata by type
          if (fileName.toLowerCase().endsWith('.cbz')) {
            try { const pages = await computeBlobPageCount(blob); if (Number.isFinite(pages) && pages >= 0) epObj.VolumePageCount = pages; } catch {}
            epObj.durationSeconds = null;
          } else {
            try { const d = await computeBlobDurationSeconds(blob); if (Number.isFinite(d) && d > 0) { const sec = Math.round(d); epObj.durationSeconds = sec; } } catch {}
          }

          // Mark row completed
          setRowProgress(idx, 100, { state: 'complete' });
          setStatus(idx, 'Done', { color: '#7fe7a9' });
          rowCompleted[idx] = true;
          applyVisibilityAll();
          logDl('Completed', { idx, type, category: ci, episode: ei });
        }
      } catch (err) {
        const errorContext = type === 'separated'
          ? (task.parts && task.parts[0] && task.parts[0].remoteUrl)
          : (episode && episode.src);
        console.error('Error downloading', errorContext, err);
        logDl('Error', { idx, type, category: ci, episode: ei, error: String(err && err.message || err) });
        const failureContext = placeholder && placeholder.src ? placeholder : episode;
        markDownloadFailed(idx, err, ci, ei, failureContext || {}, { cancelled: stopRequested });
      }
    }
  });

  await Promise.all(workers);
  const endedEarly = stopRequested && !cancelRequested;
  if (endedEarly) {
    for (let idx = pointer; idx < tasks.length; idx++) {
      if (!rowEls[idx]) continue;
      setRowProgress(idx, 0, { state: 'cancelled' });
      setStatus(idx, 'Cancelled', { color: '#e0c063' });
      rowCompleted[idx] = false;
    }
    applyVisibilityAll();
  }
  if (cancelRequested) { return; }
  let totalBytesAll = 0, totalSecsAll = 0, totalPagesAll = 0;
  try {
    for (const c of catObjs) {
      for (const e of c.episodes) {
        const b = Number(e.fileSizeBytes);
        const d = Number(e.durationSeconds);
        const p = Number(e.VolumePageCount);
        if (Number.isFinite(b) && b >= 0) totalBytesAll += Math.floor(b);
        if (Number.isFinite(d) && d >= 0) totalSecsAll += Math.floor(d);
        if (Number.isFinite(p) && p >= 0) totalPagesAll += Math.floor(p);
      }
    }
  } catch {}
  manifest.totalFileSizeBytes = totalBytesAll || 0;
  // Only include duration total when there are non-zero durations
  if (totalSecsAll > 0) manifest.totalDurationSeconds = totalSecsAll;
  // Include totalPagecount if there are CBZ volumes
  if (totalPagesAll > 0) manifest.totalPagecount = totalPagesAll;

  async function fetchAsDataURL(url) {
    try {
      const resp = await fetchWithTimeout(url, { cache: 'no-store' }, REQUEST_IDLE_TIMEOUT_MS);
      if (!resp.ok) throw new Error('image fetch failed');
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }
  if (sourceImageUrl) { try { const dataUrl = await fetchAsDataURL(sourceImageUrl); if (dataUrl) manifest.poster = dataUrl; } catch {} }
  rootFolder.file('index.json', JSON.stringify(manifest, null, 2));
  // Update summary to reflect completed transfers before packaging
  try { speedLabel.textContent = 'Speed: 0.00 MB/s'; } catch {}
  updateRemainingLabel();
  updateFailureSummary();
  if (endedEarly) {
    const endedMessage = abortActiveDownloads
      ? 'Ended early; active downloads aborted.'
      : 'Ended early; remaining downloads skipped.';
    try {
      failureLabel.style.color = '#e0c063';
      failureLabel.textContent = failureCount > 0
        ? `Failed: ${failureCount} • Ended early`
        : endedMessage;
    } catch {}
  }
  try { etaLabel.textContent = failureCount > 0 ? 'Downloads complete (with failures).' : 'Downloads complete.'; } catch {}

  const zipBase = String(titleText || 'download').trim().replace(/ /g, '_') || 'download';
  let streamingSucceeded = false;
  let streamingAttempted = false;

  async function attemptStreamSaverDownload() {
    if (typeof ReadableStream !== 'function' || typeof WritableStream !== 'function') return false;
    let streamSaverInstance = null;
    try {
      streamSaverInstance = await loadStreamSaver();
    } catch (err) {
      console.warn('StreamSaver load failed', err);
      return false;
    }
    if (!streamSaverInstance || typeof streamSaverInstance.createWriteStream !== 'function') return false;
    try {
      const mitmUrl = resolveStreamSaverAsset('mitm.html?version=2.0.6');
      if (!streamSaverInstance.mitm || streamSaverInstance.mitm === 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.6') {
        streamSaverInstance.mitm = mitmUrl;
      }
    } catch {}

    streamingAttempted = true;
    logDl('StreamSaver start', { zip: `${zipBase}.zip` });
    cancelBtn.disabled = true;
    try {
      speedLabel.textContent = 'Streaming zip…';
      remainingLabel.textContent = 'Writing directly to disk…';
      etaLabel.textContent = 'Packaging: 0%';
      const startTime = Date.now();
      let emittedBytes = 0;
      const helper = zip.generateInternalStream({
        type: 'uint8array',
        streamFiles: true,
        compression: 'DEFLATE'
      });
      const readableStream = new ReadableStream({
        start(controller) {
          helper.on('data', (chunk, metadata) => {
            try {
              controller.enqueue(chunk);
            } catch (err) {
              controller.error(err);
              return;
            }
            emittedBytes += chunk.length || 0;
            const elapsedSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
            const speedMBps = (emittedBytes / elapsedSeconds) / (1024 * 1024);
            try { speedLabel.textContent = `Stream: ${speedMBps.toFixed(2)} MB/s`; } catch {}
            const pct = Number(metadata && metadata.percent);
            if (Number.isFinite(pct)) {
              try { etaLabel.textContent = `Packaging: ${pct.toFixed(1)}%`; } catch {}
            }
            logDl('Stream chunk', { emittedBytes, pct: metadata && metadata.percent });
          });
          helper.on('error', (err) => controller.error(err));
          helper.on('end', () => controller.close());
          helper.resume();
        }
      });

      const fileStream = streamSaverInstance.createWriteStream(`${zipBase}.zip`);
      await readableStream.pipeTo(fileStream);
      try {
        etaLabel.textContent = 'Streaming complete.';
        remainingLabel.textContent = 'Archive saved to disk.';
      } catch {}
      logDl('StreamSaver complete', { emittedBytes });
      try { speak('Download Complete'); } catch {}
      return true;
    } catch (err) {
      console.error('Streamed download failed', err);
      logDl('StreamSaver failed', { error: String(err && err.message || err) });
      try { etaLabel.textContent = 'Streaming failed – retrying with in-memory packaging…'; } catch {}
      return false;
    } finally {
      cancelBtn.disabled = false;
    }
  }

  streamingSucceeded = await attemptStreamSaverDownload();

  if (streamingSucceeded) {
    overlay.remove();
    return;
  }

  // Fallback: package into a Blob and trigger a standard download.
  cancelBtn.disabled = true;
  let objectUrl = null;
  let objectUrlCleanupTimer = null;
  let downloadTriggered = false;
  try {
    if (streamingAttempted) {
      try { remainingLabel.textContent = 'Fallback to standard zip packaging…'; } catch {}
    } else {
      try { remainingLabel.textContent = 'Packaging files…'; } catch {}
    }
    try { speedLabel.textContent = 'Packaging…'; } catch {}
    try { etaLabel.textContent = 'Packaging: 0%'; } catch {}
    const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      try {
        const pct = Number(metadata && metadata.percent);
        if (Number.isFinite(pct)) etaLabel.textContent = `Packaging: ${pct.toFixed(1)}%`;
      } catch {}
      logDl('Zip packaging', { pct: metadata && metadata.percent });
    });
    logDl('Packaging complete', { size: content && content.size });
    objectUrl = URL.createObjectURL(content);
    objectUrlCleanupTimer = scheduleObjectUrlCleanup(objectUrl);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${zipBase}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    downloadTriggered = true;
    try { etaLabel.textContent = 'Packaging complete.'; } catch {}
    try { speak('Download Complete'); } catch {}
  } catch (err) {
    console.error('Zip packaging failed', err);
    try { etaLabel.textContent = 'Packaging failed. See console for details.'; } catch {}
    try {
      failureLabel.textContent = failureCount > 0 ? `Failed: ${failureCount}` : 'Packaging failed';
      failureLabel.style.color = '#ff9b9b';
    } catch {}
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    cancelBtn.addEventListener('click', () => { try { overlay.remove(); } catch {}; }, { once: true });
    if (objectUrlCleanupTimer !== null) { try { clearTimeout(objectUrlCleanupTimer); } catch {} }
    if (objectUrl) {
      activeDownloadObjectUrls.delete(objectUrl);
      try { URL.revokeObjectURL(objectUrl); } catch {}
    }
    return;
  } finally {
    cancelBtn.disabled = false;
    if (!downloadTriggered && objectUrlCleanupTimer !== null) {
      try { clearTimeout(objectUrlCleanupTimer); } catch {}
      if (objectUrl) {
        activeDownloadObjectUrls.delete(objectUrl);
        try { URL.revokeObjectURL(objectUrl); } catch {}
      }
    }
  }

  overlay.remove();
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', async () => {
    const selectiveEnabled = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
    if (!selectiveEnabled) { downloadSourceFolder(); return; }
    const selected = await openSeasonSelectionModal();
    if (selected === null) return;
    // selected can include { selectedCategories: Set<number>, selectedEpisodesBySeason: { [seasonIdx]: Set<number> } }
    downloadSourceFolder({ selectedCategories: selected.selectedCategories, selectedEpisodesBySeason: selected.selectedEpisodesBySeason });
  });
}
  function speak(TTSMSG) {
        const msg = new SpeechSynthesisUtterance(TTSMSG);
        msg.lang = "en-US";
        msg.rate = 1;
        msg.pitch = 1;
        window.speechSynthesis.speak(msg);
      } 
