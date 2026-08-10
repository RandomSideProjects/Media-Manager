"use strict";

// Variables (top)
// None; relies on global SOURCES_* and render/utils.

const HIDDEN_ENTRY_KEYS = ["hidden", "Hidden", "maintainerHidden"];

function createSkeletonLine(className) {
  const line = document.createElement('span');
  line.className = `source-skeleton-line ${className}`;
  return line;
}

function renderSourcesLoadingState(container) {
  if (!container) return;
  const resultCount = document.getElementById('sourcesResultCount');
  if (resultCount) resultCount.textContent = 'Loading library…';
  const fragment = document.createDocumentFragment();
  const skeletonCount = 6;

  for (let index = 0; index < skeletonCount; index += 1) {
    const card = document.createElement('div');
    card.className = 'source-skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.style.setProperty('--skeleton-index', String(index));

    const poster = document.createElement('span');
    poster.className = 'source-skeleton-poster';

    const copy = document.createElement('span');
    copy.className = 'source-skeleton-copy';
    copy.append(
      createSkeletonLine('source-skeleton-line--title'),
      createSkeletonLine('source-skeleton-line--short'),
      createSkeletonLine('source-skeleton-line--medium'),
      createSkeletonLine('source-skeleton-line--button')
    );

    card.append(poster, copy);
    fragment.appendChild(card);
  }

  container.classList.remove('is-revealing');
  container.classList.add('is-loading');
  container.setAttribute('aria-busy', 'true');
  container.replaceChildren(fragment);
}

function renderSourcesLoadError(container, manifestName) {
  if (!container) return;
  const state = document.createElement('section');
  state.className = 'sources-state-card sources-state-card--error';
  state.setAttribute('role', 'alert');

  const icon = document.createElement('span');
  icon.className = 'sources-state-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '!';

  const heading = document.createElement('h2');
  heading.textContent = 'The library did not load';

  const copy = document.createElement('p');
  copy.textContent = `Media Manager could not read ${manifestName}.`;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => { void loadSources(); });

  state.append(icon, heading, copy, retry);
  container.replaceChildren(state);
}

function withPosterFallbacks(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const poster = extractPoster(entry);
  return { ...entry, Image: poster };
}

function shouldSkipManifestEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return HIDDEN_ENTRY_KEYS.some((key) => entry[key] === true);
}

async function loadSources() {
  const container = document.getElementById('sourcesContainer');
  if (!container) return;
  renderSourcesLoadingState(container);
  try {
    const manifestName = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga') ? 'MangaSourceList.json' : 'AnimeSourceList.json';
    const manifestUrl = new URL(`Sources/${manifestName}`, window.location.href).href;
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    const text = await response.text();
    const manifest = JSON.parse(text);
    console.log('Loaded', manifestName + ':', manifestUrl);

    if (Array.isArray(manifest.sources)) {
      const decorated = manifest.sources
        .map((entry, idx) => ({ entry: withPosterFallbacks(entry), originalIdx: idx }))
        .filter(({ entry }) => !shouldSkipManifestEntry(entry));
      const skipped = manifest.sources.length - decorated.length;
      if (skipped > 0) {
        console.info(`[Sources] Skipped ${skipped} hidden entr${skipped === 1 ? 'y' : 'ies'} based on maintainer flags.`);
      }
      SOURCES_META = decorated.map(({ entry, originalIdx }) => ({ ...entry, _idx: originalIdx }));
    } else {
      const temp = [];
      let idx = 0;
      for (const [fileName, filePath] of Object.entries(manifest)) {
        if (typeof filePath !== 'string') continue;
        const lower = String(fileName).toLowerCase();
        if (!lower.endsWith('.json') || lower === 'exampledir.json') continue;
        if (shouldSkipManifestEntry({ file: fileName, path: filePath })) continue;
        temp.push(withPosterFallbacks({
          file: fileName,
          path: filePath,
          title: fileName.replace(/\.json$/i, ''),
          poster: null,
          categoryCount: 0,
          episodeCount: 0,
          LatestTime: null,
          _idx: idx++
        }));
      }
      SOURCES_META = temp;
    }

    container.classList.remove('is-loading');
    container.classList.add('is-revealing');
    container.removeAttribute('aria-busy');
    renderSourcesFromState();
    window.setTimeout(() => container.classList.remove('is-revealing'), 700);
    if ((SOURCES_SORT === 'newold' || SOURCES_SORT === 'oldnew')) {
      await hydrateMtimes(SOURCES_META);
      renderSourcesFromState();
    }
  } catch (error) {
    const n = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga') ? 'MangaSourceList.json' : 'AnimeSourceList.json';
    container.classList.remove('is-loading', 'is-revealing');
    container.removeAttribute('aria-busy');
    renderSourcesLoadError(container, n);
    if (typeof updateSourcesResultCount === 'function') updateSourcesResultCount(0, '');
    console.error('Error:', error);
  }
}

// Kick off on load
loadSources();
