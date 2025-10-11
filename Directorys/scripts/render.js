"use strict";

// Variables (top)
// None specific for this file; uses global SOURCES_* and utils.

// Build a card from manifest/meta entry
function buildSourceCardFromMeta(meta) {
  const title = meta.title || meta.file || 'Untitled';
  const isManga = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga');
  const categoryCount = isManga ? 0 : (typeof meta.categoryCount === 'number' ? meta.categoryCount : 0);
  const episodeCount  = isManga ? 0 : (typeof meta.episodeCount  === 'number' ? meta.episodeCount  : 0);
  const separatedCategoryCount = (!isManga && Number.isFinite(Number(meta.separatedCategoryCount))) ? Number(meta.separatedCategoryCount) : (!isManga && Number.isFinite(Number(meta.separatedCount)) ? Number(meta.separatedCount) : 0);
  const separatedItemCount = (!isManga && Number.isFinite(Number(meta.separatedItemCount))) ? Number(meta.separatedItemCount) : 0;
  const hasSeparatedMeta = !isManga && separatedCategoryCount > 0;
  const volumeCount   = isManga ? (typeof meta.volumeCount === 'number' ? meta.volumeCount : 0) : 0;
  const pageCountRaw  = isManga ? (Number.isFinite(Number(meta.totalPagecount)) ? Number(meta.totalPagecount) : (typeof meta.pageCount === 'number' ? meta.pageCount : 0)) : 0;
  const openPath = meta.path || `./Files/${meta.file || ''}`;

  const card = document.createElement('div');
  card.className = 'source-card';

  const posterSrc = meta.poster || meta.image;
  if (!SOURCES_HIDE_POSTERS && posterSrc && String(posterSrc).toLowerCase() !== 'null') {
    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.alt = `${title} poster`;
    img.src = posterSrc;
    img.addEventListener('error', () => { img.style.display = 'none'; });
    img.addEventListener('load', () => fitPosterToCard(img, card));
    if (img.complete && img.naturalWidth) fitPosterToCard(img, card);
    window.addEventListener('resize', () => fitPosterToCard(img, card));
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
  if (isManga) {
    p1.innerHTML = `<strong>${volumeCount}</strong> ${volumeCount === 1 ? 'Volume' : 'Volumes'}`;
    p2.innerHTML = `<strong>${pageCountRaw}</strong> ${pageCountRaw === 1 ? 'Page' : 'Pages'}`;
    p3.style.display = 'none';
  } else {
    p1.innerHTML = `<strong>${categoryCount}</strong> ${categoryCount === 1 ? 'Season' : 'Seasons'}`;
    p2.innerHTML = `<strong>${episodeCount}</strong> ${episodeCount === 1 ? 'Episode' : 'Episodes'}`;
    if (hasSeparatedMeta) {
      p3.innerHTML = `<strong>${separatedCategoryCount}</strong> ${separatedCategoryCount === 1 ? 'Movie' : 'Movies'}`;
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
  btn.onclick = () => {
    const openParam = `Directorys/${openPath.replace(/^\.\//,'')}`;
    const src = encodeURIComponent(openParam);
    window.location.href = `../index.html?source=${src}`;
  };

  right.append(h3, p1, p2);
  if (hasSeparatedMeta) right.appendChild(p3);
  right.append(timeP, sizeP, durP, btn);
  card.appendChild(right);

  // Right-click: toggle details. For Anime, also flips labels; for Manga, just shows details.
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    const showingDetails = timeP.style.display === 'block' || sizeP.style.display === 'block' || durP.style.display === 'block';
    if (isManga) {
      // Toggle details only
      timeP.style.display = showingDetails ? 'none' : (meta.LatestTime ? 'block' : 'none');
      sizeP.style.display = showingDetails ? 'none' : ((typeof meta.totalFileSizeBytes === 'number') ? 'block' : 'none');
      durP.style.display = 'none';
    } else {
      const inSeasonMode = p1.textContent.includes('Season');
      if (inSeasonMode) {
        p1.innerHTML = `<strong>${categoryCount}</strong> ${categoryCount === 1 ? 'Category' : 'Categories'}`;
        p2.innerHTML = `<strong>${episodeCount}</strong> ${episodeCount === 1 ? 'Item' : 'Items'}`;
        timeP.style.display = meta.LatestTime ? 'block' : 'none';
        sizeP.style.display = (typeof meta.totalFileSizeBytes === 'number') ? 'block' : 'none';
        durP.style.display = (typeof meta.totalDurationSeconds === 'number') ? 'block' : 'none';
        if (hasSeparatedMeta) {
          const separatedCountForItems = separatedItemCount > 0 ? separatedItemCount : separatedCategoryCount;
          p3.innerHTML = `<strong>${separatedCountForItems}</strong> ${separatedCountForItems === 1 ? 'Separated Item' : 'Separated Items'}`;
          p3.style.display = 'block';
        }
      } else {
        p1.innerHTML = `<strong>${categoryCount}</strong> ${categoryCount === 1 ? 'Season' : 'Seasons'}`;
        p2.innerHTML = `<strong>${episodeCount}</strong> ${episodeCount === 1 ? 'Episode' : 'Episodes'}`;
        timeP.style.display = 'none';
        sizeP.style.display = 'none';
        durP.style.display = 'none';
        if (hasSeparatedMeta) {
          p3.innerHTML = `<strong>${separatedCategoryCount}</strong> ${separatedCategoryCount === 1 ? 'Movie' : 'Movies'}`;
          p3.style.display = 'block';
        }
      }
    }
  });

  return card;
}

function renderSourcesFromState() {
  const container = document.getElementById('sourcesContainer');
  container.innerHTML = '';
  const sorted = sortMeta(SOURCES_META, SOURCES_SORT);
  for (const meta of sorted) {
    const card = buildSourceCardFromMeta(meta);
    container.appendChild(card);
  }
}

// Build a card from a full data JSON
function buildSourceCard(data, openSourceParam, fileNameForFallback) {
  const title = data.title || fileNameForFallback || 'Untitled';
  const isManga = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga');
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const separatedCategories = isManga ? [] : categories.filter(cat => Number(cat && cat.separated) === 1);
  const primaryCategories = isManga ? categories : categories.filter(cat => Number(cat && cat.separated) !== 1);
  const seasons = isManga ? primaryCategories.length : primaryCategories.length;
  let episodes = 0;
  primaryCategories.forEach(cat => {
    if (Array.isArray(cat.episodes)) episodes += cat.episodes.length;
  });
  const separatedCategoryCount = isManga ? 0 : separatedCategories.length;
  let separatedItemCount = 0;
  separatedCategories.forEach(cat => {
    if (Array.isArray(cat.episodes)) separatedItemCount += cat.episodes.length;
  });
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
  const imgUrl = (typeof data.Image === 'string' && data.Image !== 'N/A')
    ? data.Image
    : (typeof data.image === 'string' && data.image !== 'N/A' ? data.image : '');
  if (imgUrl) {
    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.alt = `${title} poster`;
    img.src = imgUrl;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.style.display = 'none'; });
    img.addEventListener('load', () => fitPosterToCard(img, card));
    if (img.complete && img.naturalWidth) fitPosterToCard(img, card);
    window.addEventListener('resize', () => fitPosterToCard(img, card));
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
  if (isManga) {
    p1.innerHTML = `<strong>${volumeCount}</strong> ${volumeCount === 1 ? 'Volume' : 'Volumes'}`;
    p2.innerHTML = `<strong>${pageCount}</strong> ${pageCount === 1 ? 'Page' : 'Pages'}`;
    p3.style.display = 'none';
  } else {
    p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Season' : 'Seasons'}`;
    p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Episode' : 'Episodes'}`;
    if (hasSeparatedMeta) {
      p3.innerHTML = `<strong>${separatedCategoryCount}</strong> ${separatedCategoryCount === 1 ? 'Movie' : 'Movies'}`;
    } else {
      p3.style.display = 'none';
    }
  }

  const btn = document.createElement('button');
  btn.className = 'pill-button';
  btn.textContent = 'Open';
  btn.onclick = () => {
    const src = encodeURIComponent(openSourceParam);
    window.location.href = `../index.html?source=${src}`;
  };

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

  right.append(h3, p1, p2);
  if (hasSeparatedMeta) right.appendChild(p3);
  right.append(sizeP, durP, btn);
  card.appendChild(right);

  // Right-click terminology toggle / details
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (isManga) {
      const showingDetails = sizeP.style.display === 'block' || durP.style.display === 'block';
      sizeP.style.display = showingDetails ? 'none' : (totalBytes ? 'block' : 'none');
      durP.style.display = showingDetails ? 'none' : (totalSecs ? 'block' : 'none');
    } else {
      const inSeasonMode = p1.textContent.includes('Season');
      if (inSeasonMode) {
        p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Category' : 'Categories'}`;
        p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Item' : 'Items'}`;
        sizeP.style.display = totalBytes ? 'block' : 'none';
        durP.style.display = totalSecs ? 'block' : 'none';
        if (hasSeparatedMeta) {
          const separatedCountForItems = separatedItemCount > 0 ? separatedItemCount : separatedCategoryCount;
          p3.innerHTML = `<strong>${separatedCountForItems}</strong> ${separatedCountForItems === 1 ? 'Separated Item' : 'Separated Items'}`;
          p3.style.display = 'block';
        }
      } else {
        p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Season' : 'Seasons'}`;
        p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Episode' : 'Episodes'}`;
        sizeP.style.display = 'none';
        durP.style.display = 'none';
        if (hasSeparatedMeta) {
          p3.innerHTML = `<strong>${separatedCategoryCount}</strong> ${separatedCategoryCount === 1 ? 'Movie' : 'Movies'}`;
          p3.style.display = 'block';
        }
      }
    }
  });

  return card;
}
