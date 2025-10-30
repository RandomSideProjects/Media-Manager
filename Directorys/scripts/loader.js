"use strict";

// Variables (top)
// None; relies on global STATUS_URL, SOURCES_* and render/utils.

const HIDDEN_ENTRY_KEYS = ["hidden", "Hidden", "maintainerHidden"];

function shouldSkipManifestEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return HIDDEN_ENTRY_KEYS.some((key) => entry[key] === true);
}

function showHostFailure(container, codeText) {
  container.innerHTML = `
    <div style="
      padding: 3em 1.5em;
      text-align: center;
      font-weight: 800;
      color: #ffffff;
      font-size: 1.6rem;
      white-space: pre-line;
    ">
      Unfortunately, our public source host is currently unavailable.
      \nPlease try again.
      \n<code style="background:#000; display:inline-block; padding:0.6em 0.8em; border-radius:8px; margin-top:0.9em; color:#fff;">HTTP Code : ${codeText}</code>
    </div>
  `;
}

async function checkHostAndLoad() {
  const container = document.getElementById('sourcesContainer');
  // Create status box (hidden until success)
  let statusBox = document.getElementById('serverStatusBox');
  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.id = 'serverStatusBox';
    statusBox.style.display = 'none';
    document.body.appendChild(statusBox);
  }

  // Create loading box
  let checkBox = document.getElementById('serverCheckBox');
  if (!checkBox) {
    checkBox = document.createElement('div');
    checkBox.id = 'serverCheckBox';
    checkBox.innerHTML = `
      <div class="spinner" aria-hidden="true"></div>
      <div class="serverCheckText" id="serverCheckText">Checking if server is responsive\nTime Elapsed : 00:00</div>
    `;
    document.body.appendChild(checkBox);
  }
  const checkText = document.getElementById('serverCheckText');
  checkBox.style.display = 'flex';

  const started = Date.now();
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  const tick = () => {
    if (checkText) checkText.textContent = `Checking if server is responsive\nTime Elapsed : ${fmt(Date.now() - started)}`;
  };
  tick();
  const timer = setInterval(tick, 250);

  const stop = () => {
    clearInterval(timer);
    if (checkBox) checkBox.remove();
  };

  let resp;
  try {
    resp = await fetch(STATUS_URL, { cache: 'no-store' });
  } catch (err) {
    stop();
    showHostFailure(container, err && err.message ? err.message : 'Network error');
    return;
  }

  if (!resp || !resp.ok) {
    const codeText = resp ? `${resp.status} ${resp.statusText || ''}`.trim() : 'Unknown error';
    stop();
    showHostFailure(container, codeText);
    return;
  }

  // Success path: show status code box and continue to load sources
  stop();
  statusBox.textContent = `Server status code\n${resp.status}`;
  statusBox.style.display = 'block';
  await loadSources();
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
        .map((entry, idx) => ({ entry, originalIdx: idx }))
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
        temp.push({
          file: fileName,
          path: filePath,
          title: fileName.replace(/\.json$/i, ''),
          poster: null,
          categoryCount: 0,
          episodeCount: 0,
          LatestTime: null,
          _idx: idx++
        });
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
checkHostAndLoad();
