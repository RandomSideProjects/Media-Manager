"use strict";

// Variables (top)
// None; relies on global SOURCES_* and render/utils.

const HIDDEN_ENTRY_KEYS = ["hidden", "Hidden", "maintainerHidden"];

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
  container.innerHTML = '';
  try {
    const manifestName = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga') ? 'MangaSourceList.json' : 'AnimeSourceList.json';
    const manifestUrl = new URL(manifestName, window.location.href).href;
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

    renderSourcesFromState();
    if ((SOURCES_SORT === 'newold' || SOURCES_SORT === 'oldnew')) {
      await hydrateMtimes(SOURCES_META);
      renderSourcesFromState();
    }
  } catch (error) {
    const n = (typeof SOURCES_MODE !== 'undefined' && SOURCES_MODE === 'manga') ? 'MangaSourceList.json' : 'AnimeSourceList.json';
    container.innerHTML = `<p style="color:#f1f1f1;">Failed to load ${n}.</p>`;
    console.error('Error:', error);
  }
}

// Kick off on load
loadSources();
