"use strict";

// Variables (top)
// None specific for this file; uses global SOURCES_* and utils.

function setCountParagraph(p, count, singular, plural) {
  p.innerHTML = `<strong>${count}</strong> ${count === 1 ? singular : plural}`;
  p.style.display = count > 0 ? 'block' : 'none';
}

function updateSourcesResultCount(count, query) {
  const resultCount = document.getElementById('sourcesResultCount');
  if (!resultCount) return;
  const safeCount = Math.max(0, Number(count) || 0);
  const hasQuery = typeof query === 'string' && query.trim() !== '';
  resultCount.textContent = hasQuery
    ? `${safeCount} ${safeCount === 1 ? 'match' : 'matches'}`
    : `${safeCount} ${safeCount === 1 ? 'source' : 'sources'}`;
}

function renderSourcesEmptyState(container, query) {
  if (!container) return;
  const state = document.createElement('section');
  state.className = 'sources-state-card';

  const icon = document.createElement('span');
  icon.className = 'sources-state-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⌕';

  const heading = document.createElement('h2');
  heading.textContent = 'No sources found';

  const copy = document.createElement('p');
  copy.textContent = query
    ? `Nothing in the library matches “${query}”.`
    : 'There are no sources to show yet.';

  state.append(icon, heading, copy);
  container.appendChild(state);
}

function isMovieCategory(category) {
  return /\bmovie\b/i.test(String(category && category.category || '').trim());
}

function makeSourceCardInteractive(card, button, title, openSource) {
  if (!card || typeof openSource !== 'function') return;
  card.classList.add('is-interactive');
  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `Open ${title || 'source'}`);

  card.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input, select, textarea, label')) return;
    openSource();
  });
  card.addEventListener('keydown', (event) => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openSource();
  });
  if (button) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openSource();
    });
  }
}

function readContinueWatchingNumber(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readContinueWatchingString(key) {
  try {
    const value = localStorage.getItem(key);
    return value === null || value === undefined ? '' : String(value);
  } catch {
    return '';
  }
}

function formatContinueWatchingTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getContinueWatchingState(entry) {
  const sourceKey = entry && typeof entry.file === 'string' ? entry.file : '';
  if (!sourceKey) return null;
  const continueIndex = readContinueWatchingNumber(`${sourceKey}:ContinueIndex`);
  const savedIndex = readContinueWatchingNumber(`${sourceKey}:SavedItem`);
  const lastIndex = readContinueWatchingNumber(`${sourceKey}:LastIndex`);
  const index = continueIndex ?? savedIndex ?? lastIndex;
  if (index === null || index < 0) return null;

  const watched = readContinueWatchingNumber(`${sourceKey}:itemTime:${index}`) || 0;
  const duration = readContinueWatchingNumber(`${sourceKey}:itemDuration:${index}`) || 0;
  const movedToNext = continueIndex !== null && lastIndex !== null && continueIndex > lastIndex;
  let detail = 'Start watching';
  if (movedToNext) detail = 'Next episode';
  else if (duration > 0 && watched > 0) {
    detail = `${formatContinueWatchingTime(watched)} / ${formatContinueWatchingTime(duration)}`;
  }

  return {
    index,
    title: readContinueWatchingString(`${sourceKey}:itemTitle:${index}`) || entry.title || `Item ${index + 1}`,
    detail,
    progress: duration > 0 ? Math.max(0, Math.min(1, watched / duration)) : 0
  };
}

function renderContinueWatching() {
  const section = document.getElementById('continueWatchingSection');
  const grid = document.getElementById('continueWatchingGrid');
  if (!section || !grid) return;

  const enabledValue = readContinueWatchingString('rsp_recent_sources_enabled');
  const enabled = enabledValue !== 'false';
  const entries = enabled && typeof readRecentSourceEntries === 'function'
    ? readRecentSourceEntries()
    : [];
  const cards = entries
    .filter((entry) => {
      if (!entry || entry.openKind === 'local' || entry.openKind === 'inline' || !extractPoster(entry)) return false;
      const source = typeof entry.path === 'string' ? entry.path.trim() : '';
      return source && !/^(?:local|inline)::/i.test(source);
    })
    .map((entry) => ({ entry, state: getContinueWatchingState(entry) }))
    .filter(({ state }) => state !== null)
    .slice(0, 5);

  grid.innerHTML = '';
  section.hidden = cards.length === 0;
  if (!cards.length) return;

  cards.forEach(({ entry, state }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'continue-watching-card';
    card.setAttribute('aria-label', `Continue: ${state.title}`);

    const poster = document.createElement('img');
    poster.src = resolvePublicSourceAsset(extractPoster(entry));
    poster.alt = '';
    poster.loading = 'lazy';
    poster.decoding = 'async';

    const title = document.createElement('span');
    title.className = 'continue-watching-card-title';
    title.textContent = state.title;

    const detail = document.createElement('span');
    detail.className = 'continue-watching-card-detail';
    detail.textContent = state.detail;

    const play = document.createElement('span');
    play.className = 'continue-watching-card-play';
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 7.7v8.6L16 12 9 7.7Z"/></svg>';

    const progress = document.createElement('span');
    progress.className = 'continue-watching-progress';
    progress.setAttribute('aria-hidden', 'true');
    const progressFill = document.createElement('span');
    progressFill.style.setProperty('--continue-progress', String(state.progress));
    progress.appendChild(progressFill);

    card.append(poster, title, play, detail, progress);
    card.addEventListener('click', () => {
      const params = new URLSearchParams();
      params.set('source', entry.path);
      params.set('item', String(state.index + 1));
      window.location.href = `index.html?${params.toString()}`;
    });
    grid.appendChild(card);
  });
}

// Build a card from manifest/meta entry
function buildSourceCardFromMeta(meta) {
  const title = meta.title || meta.file || 'Untitled';
  const isManga = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga');
  const categoryCount = isManga ? 0 : (typeof meta.categoryCount === 'number' ? meta.categoryCount : 0);
  const episodeCount  = isManga ? 0 : (typeof meta.episodeCount  === 'number' ? meta.episodeCount  : 0);
  const separatedCountRaw = (!isManga && Number.isFinite(Number(meta.separatedCategoryCount))) ? Number(meta.separatedCategoryCount) : (!isManga && Number.isFinite(Number(meta.separatedCount)) ? Number(meta.separatedCount) : 0);
  const separatedCategoryCount = isManga ? 0 : separatedCountRaw;
  const separatedItemCountRaw = (!isManga && Number.isFinite(Number(meta.separatedItemCount))) ? Number(meta.separatedItemCount) : 0;
  const separatedItemCount = isManga ? 0 : separatedItemCountRaw;
  const movieCount = !isManga && Number.isFinite(Number(meta.movieCount)) ? Number(meta.movieCount) : 0;
  const hasSeparatedMeta = !isManga && separatedCategoryCount > 0;
  let itemCount = 0;
  if (!isManga) {
    const itemCountRaw = Number(meta.itemCount);
    if (Number.isFinite(itemCountRaw) && itemCountRaw >= 0) itemCount = itemCountRaw;
    else itemCount = episodeCount + separatedItemCount;
  }
  const volumeCount   = isManga ? (typeof meta.volumeCount === 'number' ? meta.volumeCount : 0) : 0;
  const pageCountRaw  = isManga ? (Number.isFinite(Number(meta.totalPagecount)) ? Number(meta.totalPagecount) : (typeof meta.pageCount === 'number' ? meta.pageCount : 0)) : 0;
  const openPath = meta.path || `./Files/${meta.file || ''}`;
  const openTarget = (() => {
    const raw = String(openPath || '').trim();
    if (!raw) return '';
    const isAbsolute = /^https?:\/\//i.test(raw) || raw.startsWith('blob:');
    if (isAbsolute) return raw;
    const trimmed = raw.replace(/^\.\//, '').replace(/^\/+/, '');
    if (trimmed.toLowerCase().startsWith('sources/')) return trimmed;
    return `Sources/${trimmed}`;
  })();

  const card = document.createElement('div');
  card.className = 'source-card';

  const posterSrc = extractPoster(meta);
  if (!SOURCES_HIDE_POSTERS && posterSrc && String(posterSrc).toLowerCase() !== 'null') {
    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.alt = `${title} poster`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => fitPosterToCard(img, card));
    window.addEventListener('resize', () => fitPosterToCard(img, card));
    img.onerror = () => { img.style.display = 'none'; card.classList.add('no-thumb'); };
    img.src = resolvePublicSourceAsset(posterSrc);
    if (img.complete && img.naturalWidth) fitPosterToCard(img, card);
    card.appendChild(img);
  } else {
    card.classList.add('no-thumb');
  }

  const right = document.createElement('div');
  right.className = 'source-right';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const p1 = document.createElement('p');
  const p2 = document.createElement('p');
  const p3 = document.createElement('p');
  const stats = document.createElement('div');
  stats.className = 'source-card-stats';
  const isSingleMovie = (!isManga && categoryCount === 0 && episodeCount === 0 && (separatedCategoryCount === 1 || movieCount === 1));
  if (isManga) {
    setCountParagraph(p1, volumeCount, 'Volume', 'Volumes');
    setCountParagraph(p2, pageCountRaw, 'Page', 'Pages');
    p3.style.display = 'none';
  } else if (isSingleMovie) {
    p1.textContent = 'Movie';
    p1.style.display = 'block';
    p2.style.display = 'none';
    p3.style.display = 'none';
  } else {
    setCountParagraph(p1, categoryCount, 'Season', 'Seasons');
    setCountParagraph(p2, episodeCount, 'Episode', 'Episodes');
    if (hasSeparatedMeta || movieCount > 0) {
      setCountParagraph(p3, separatedCategoryCount + movieCount, 'Movie', 'Movies');
    } else {
      p3.style.display = 'none';
    }
  }

  const timeP = document.createElement('p');
  timeP.className = 'source-time';
  timeP.style.display = 'none';
  if (meta.LatestTime) {
    timeP.textContent = 'Updated: ' + formatLocal(meta.LatestTime);
  }

  // totals (hidden by default; shown on right-click)
  const formatBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '—';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
  };
  const formatDur = (s) => {
    if (!Number.isFinite(s) || s <= 0) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };

  const sizeP = document.createElement('p');
  sizeP.className = 'source-time';
  sizeP.style.display = 'none';
  const durP = document.createElement('p');
  durP.className = 'source-time';
  durP.style.display = 'none';
  if (typeof meta.totalFileSizeBytes === 'number') {
    sizeP.textContent = 'Size: ' + formatBytes(meta.totalFileSizeBytes);
  }
  if (typeof meta.totalDurationSeconds === 'number') {
    durP.textContent = 'Duration: ' + formatDur(meta.totalDurationSeconds);
  }

  const btn = document.createElement('button');
  btn.className = 'pill-button';
  btn.textContent = 'Open';
  const openSource = () => {
    const src = encodeURIComponent(openTarget);
    window.location.href = `./index.html?source=${src}`;
  };
  makeSourceCardInteractive(card, btn, title, openSource);

  stats.append(p1, p2);
  if (hasSeparatedMeta || movieCount > 0) stats.appendChild(p3);
  right.append(h3, stats);
  right.append(timeP, sizeP, durP, btn);
  card.appendChild(right);

  // Right-click: toggle details. For Anime, also flips labels; for Manga, just shows details.
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    const showingDetails = timeP.style.display === 'block' || sizeP.style.display === 'block' || durP.style.display === 'block';
    if (isManga || isSingleMovie) {
      // Toggle details only
      timeP.style.display = showingDetails ? 'none' : (meta.LatestTime ? 'block' : 'none');
      sizeP.style.display = showingDetails ? 'none' : ((typeof meta.totalFileSizeBytes === 'number') ? 'block' : 'none');
      durP.style.display = isManga ? 'none' : (showingDetails ? 'none' : ((typeof meta.totalDurationSeconds === 'number') ? 'block' : 'none'));
    } else {
      const inSeasonMode = p1.textContent.includes('Season');
      if (inSeasonMode) {
        setCountParagraph(p1, categoryCount, 'Category', 'Categories');
        setCountParagraph(p2, itemCount, 'Item', 'Items');
        timeP.style.display = meta.LatestTime ? 'block' : 'none';
        sizeP.style.display = (typeof meta.totalFileSizeBytes === 'number') ? 'block' : 'none';
        durP.style.display = (typeof meta.totalDurationSeconds === 'number') ? 'block' : 'none';
        if (hasSeparatedMeta) {
          const separatedCountForItems = separatedItemCount > 0 ? separatedItemCount : separatedCategoryCount;
          setCountParagraph(p3, separatedCountForItems, 'Separated Item', 'Separated Items');
        }
      } else {
        setCountParagraph(p1, categoryCount, 'Season', 'Seasons');
        setCountParagraph(p2, episodeCount, 'Episode', 'Episodes');
        timeP.style.display = 'none';
        sizeP.style.display = 'none';
        durP.style.display = 'none';
        if (hasSeparatedMeta || movieCount > 0) {
          setCountParagraph(p3, separatedCategoryCount + movieCount, 'Movie', 'Movies');
        }
      }
    }
  });

  return card;
}

function renderSourcesFromState() {
  const container = document.getElementById('sourcesContainer');
  if (!container) return;
  container.innerHTML = '';
  const sorted = sortMeta(SOURCES_META, SOURCES_SORT);
  sorted.forEach((meta, index) => {
    const card = buildSourceCardFromMeta(meta);
    card.style.setProperty('--source-index', String(Math.min(index, 8)));
    container.appendChild(card);
  });
  if (!sorted.length) renderSourcesEmptyState(container, '');
  updateSourcesResultCount(sorted.length, '');
  renderContinueWatching();
}

// Build a card from a full data JSON
function buildSourceCard(data, openSourceParam, fileNameForFallback) {
  const title = data.title || fileNameForFallback || 'Untitled';
  const isManga = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga');
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const separatedCategories = isManga ? [] : categories.filter(cat => Number(cat && cat.separated) === 1);
  const primaryCategories = isManga ? categories : categories.filter(cat => Number(cat && cat.separated) !== 1);
  const separatedCategoryCount = isManga ? 0 : separatedCategories.length;
  const movieCategories = isManga ? [] : primaryCategories.filter(isMovieCategory);
  const showCategories = isManga ? primaryCategories : primaryCategories.filter(category => !isMovieCategory(category));
  const seasons = isManga ? primaryCategories.length : showCategories.length;
  let episodes = 0;
  showCategories.forEach(cat => {
    if (Array.isArray(cat.episodes)) episodes += cat.episodes.length;
  });
  const movieCount = isManga ? 0 : movieCategories.length;
  let separatedItemCount = 0;
  separatedCategories.forEach(cat => {
    if (Array.isArray(cat.episodes)) separatedItemCount += cat.episodes.length;
  });
  const itemCount = isManga ? 0 : (episodes + separatedItemCount);
  const volumeCount = isManga ? categories.length : 0;
  let pageCount = isManga ? (Number.isFinite(Number(data.totalPagecount)) ? Number(data.totalPagecount) : 0) : 0;
  if (isManga && pageCount === 0) {
    for (const c of categories) {
      for (const e of (c.episodes || [])) {
        if (Number.isFinite(Number(e.VolumePageCount))) pageCount += Number(e.VolumePageCount);
      }
    }
  }
  // Compute totals if available
  let totalBytes = (typeof data.totalFileSizeBytes === 'number') ? data.totalFileSizeBytes : 0;
  let totalSecs = (typeof data.totalDurationSeconds === 'number') ? data.totalDurationSeconds : 0;
  if ((!totalBytes || !totalSecs) && categories.length) {
    let b = 0, s = 0;
    for (const c of categories) {
      for (const e of (c.episodes || [])) {
        if (typeof e.fileSizeBytes === 'number' && Number.isFinite(e.fileSizeBytes)) b += e.fileSizeBytes;
        if (typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds)) s += e.durationSeconds;
      }
    }
    if (!totalBytes) totalBytes = b;
    if (!totalSecs) totalSecs = s;
  }

  const card = document.createElement('div');
  card.className = 'source-card';

  // Left: poster image (preserve aspect ratio)
  const imgUrl = extractPoster(data);
  if (imgUrl) {
    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.alt = `${title} poster`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => fitPosterToCard(img, card));
    window.addEventListener('resize', () => fitPosterToCard(img, card));
    img.onerror = () => { img.style.display = 'none'; card.classList.add('no-thumb'); };
    img.src = imgUrl;
    if (img.complete && img.naturalWidth) fitPosterToCard(img, card);
    card.appendChild(img);
  } else {
    card.classList.add('no-thumb');
  }

  // Right: text/content column
  const right = document.createElement('div');
  right.className = 'source-right';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const hasSeparatedMeta = !isManga && separatedCategoryCount > 0;
  const p1 = document.createElement('p');
  const p2 = document.createElement('p');
  const p3 = document.createElement('p');
  const stats = document.createElement('div');
  stats.className = 'source-card-stats';
  const isSingleMovie = (!isManga && seasons === 0 && episodes === 0 && (separatedCategoryCount === 1 || movieCount === 1));
  if (isManga) {
    setCountParagraph(p1, volumeCount, 'Volume', 'Volumes');
    setCountParagraph(p2, pageCount, 'Page', 'Pages');
    p3.style.display = 'none';
  } else if (isSingleMovie) {
    p1.textContent = 'Movie';
    p1.style.display = 'block';
    p2.style.display = 'none';
    p3.style.display = 'none';
  } else {
    setCountParagraph(p1, seasons, 'Season', 'Seasons');
    setCountParagraph(p2, episodes, 'Episode', 'Episodes');
    if (hasSeparatedMeta || movieCount > 0) {
      setCountParagraph(p3, separatedCategoryCount + movieCount, 'Movie', 'Movies');
    } else {
      p3.style.display = 'none';
    }
  }

  const btn = document.createElement('button');
  btn.className = 'pill-button';
  btn.textContent = 'Open';
  const openSource = () => {
    const src = encodeURIComponent(openSourceParam);
    window.location.href = `./index.html?source=${src}`;
  };
  makeSourceCardInteractive(card, btn, title, openSource);

  // Totals (hidden by default)
  const formatBytes = (n) => {
    if (!Number.isFinite(n) || n <= 0) return '—';
    const u = ['B','KB','MB','GB','TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
  };
  const formatDur = (s) => {
    if (!Number.isFinite(s) || s <= 0) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };
  const sizeP = document.createElement('p'); sizeP.className = 'source-time'; sizeP.style.display = 'none';
  const durP = document.createElement('p'); durP.className = 'source-time'; durP.style.display = 'none';
  if (totalBytes) sizeP.textContent = 'Size: ' + formatBytes(totalBytes);
  if (totalSecs) durP.textContent = 'Duration: ' + formatDur(totalSecs);

  stats.append(p1, p2);
  if (hasSeparatedMeta || movieCount > 0) stats.appendChild(p3);
  right.append(h3, stats);
  right.append(sizeP, durP, btn);
  card.appendChild(right);

  // Right-click terminology toggle / details
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (isManga || isSingleMovie) {
      const showingDetails = sizeP.style.display === 'block' || durP.style.display === 'block';
      sizeP.style.display = showingDetails ? 'none' : (totalBytes ? 'block' : 'none');
      durP.style.display = showingDetails ? 'none' : (totalSecs ? 'block' : 'none');
    } else {
      const inSeasonMode = p1.textContent.includes('Season');
      if (inSeasonMode) {
        setCountParagraph(p1, seasons, 'Category', 'Categories');
        setCountParagraph(p2, itemCount, 'Item', 'Items');
        sizeP.style.display = totalBytes ? 'block' : 'none';
        durP.style.display = totalSecs ? 'block' : 'none';
        if (hasSeparatedMeta) {
          const separatedCountForItems = separatedItemCount > 0 ? separatedItemCount : separatedCategoryCount;
          setCountParagraph(p3, separatedCountForItems, 'Separated Item', 'Separated Items');
        }
      } else {
        setCountParagraph(p1, seasons, 'Season', 'Seasons');
        setCountParagraph(p2, episodes, 'Episode', 'Episodes');
        sizeP.style.display = 'none';
        durP.style.display = 'none';
        if (hasSeparatedMeta || movieCount > 0) {
          setCountParagraph(p3, separatedCategoryCount + movieCount, 'Movie', 'Movies');
        }
      }
    }
  });

  return card;
}
