"use strict";

(function initAnimepaheImport() {
  const group = document.getElementById("paheImportGroup");
  const sidePanel = group && typeof group.closest === "function" ? group.closest(".side-panel") : null;
  const layout = typeof document !== "undefined" ? document.querySelector(".creator-layout") : null;
  const mainContainer = layout ? layout.querySelector(".container") : (typeof document !== "undefined" ? document.querySelector(".container") : null);
  const queryInput = document.getElementById("paheQuery");
  const searchBtn = document.getElementById("paheSearchBtn");
  const resultsEl = document.getElementById("paheResults");
  const selectionEl = document.getElementById("paheSelection");
  const selectedPoster = document.getElementById("paheSelectedPoster");
  const selectedTitle = document.getElementById("paheSelectedTitle");
  const selectedMeta = document.getElementById("paheSelectedMeta");
  const modeSingle = document.getElementById("paheModeSingle");
  const modeAll = document.getElementById("paheModeAll");
  const episodePickerRow = document.getElementById("paheEpisodePickerRow");
  const episodeSelect = document.getElementById("paheEpisodeSelect");
  const qualitySelect = document.getElementById("paheQualitySelect");
  const startBtn = document.getElementById("paheStartBtn");
  const cancelBtn = document.getElementById("paheCancelBtn");
  const applyPosterToggle = document.getElementById("paheApplyPosterToggle");
  const progressWrap = document.getElementById("paheProgress");
  const progressText = document.getElementById("paheProgressText");
  const progressBar = document.getElementById("paheProgressBar");
  const logEl = document.getElementById("paheLog");

  if (!group || !queryInput || !searchBtn || !resultsEl || !selectionEl) return;

  function isMangaModeSafe() {
    try {
      if (typeof window !== "undefined" && typeof window.isMangaMode === "function") return !!window.isMangaMode();
      if (typeof window !== "undefined" && typeof window.getCreatorMode === "function") return window.getCreatorMode() === "manga";
      const raw = localStorage.getItem("mm_upload_settings") || "{}";
      const parsed = JSON.parse(raw);
      return parsed && parsed.libraryMode === "manga";
    } catch {
      return false;
    }
  }

  function isImportEnabled() {
    try {
      const st = readUploadSettings();
      return st && st.paheImportEnabled === true;
    } catch {
      return false;
    }
  }

  function updateVisibility() {
    const isManga = isMangaModeSafe();
    const enabled = isImportEnabled();
    const show = enabled && !isManga;
    if (sidePanel) sidePanel.style.display = show ? "" : "none";
    group.style.display = show ? "" : "none";
    if (!show) {
      try {
        resultsEl.innerHTML = "";
        selectionEl.style.display = "none";
        clearLog();
      } catch {}
    }
    syncSidePanelToCreator();
  }

  function syncSidePanelToCreator() {
    if (!sidePanel || !mainContainer) return;
    if (sidePanel.style.display === "none") return;
    try {
      const pos = window.getComputedStyle(sidePanel).position;
      if (pos !== "absolute") return;
    } catch {}

    try {
      const top = mainContainer.offsetTop;
      const height = mainContainer.offsetHeight;
      if (Number.isFinite(top)) sidePanel.style.top = `${top}px`;
      if (Number.isFinite(height) && height > 0) sidePanel.style.height = `${height}px`;
    } catch {}
  }

  updateVisibility();
  window.addEventListener("mm_settings_saved", updateVisibility);

  try {
    if (typeof ResizeObserver === "function" && mainContainer) {
      const ro = new ResizeObserver(() => syncSidePanelToCreator());
      ro.observe(mainContainer);
    }
  } catch {}

  window.addEventListener("resize", () => syncSidePanelToCreator());

  const DEFAULTS = {
    animeApiBase: "https://anime.apex-cloud.workers.dev",
    kwikApiBase: "https://access-kwik.apex-cloud.workers.dev",
    kwikAuthToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.O0FKaqhJjEZgCAVfZoLz6Pjd7Gs9Kv6qi0P8RyATjaE",
  };

  function readUploadSettings() {
    try {
      if (typeof window !== "undefined" && window.mm_uploadSettings && typeof window.mm_uploadSettings.load === "function") {
        return window.mm_uploadSettings.load();
      }
    } catch {}
    try {
      return JSON.parse(localStorage.getItem("mm_upload_settings") || "{}") || {};
    } catch {
      return {};
    }
  }

  function getConfig() {
    const st = readUploadSettings();
    const rawAnime = typeof st.paheAnimeApiBase === "string" ? st.paheAnimeApiBase.trim() : "";
    const rawKwik = typeof st.paheKwikApiBase === "string" ? st.paheKwikApiBase.trim() : "";
    const rawAuth = typeof st.paheKwikAuthToken === "string" ? st.paheKwikAuthToken.trim() : "";
    return {
      animeApiBase: (rawAnime || DEFAULTS.animeApiBase).replace(/\/+$/, ""),
      kwikApiBase: (rawKwik || DEFAULTS.kwikApiBase).replace(/\/+$/, ""),
      kwikAuthToken: rawAuth || DEFAULTS.kwikAuthToken,
    };
  }

  function log(line) {
    try {
      const next = String(line || "");
      logEl.textContent = (logEl.textContent ? `${logEl.textContent}\n` : "") + next;
      logEl.scrollTop = logEl.scrollHeight;
    } catch {}
  }

  function clearLog() {
    try {
      logEl.textContent = "";
    } catch {}
  }

  function setBusy(isBusy) {
    try {
      if (searchBtn) searchBtn.disabled = isBusy;
      if (queryInput) queryInput.disabled = isBusy;
      if (startBtn) startBtn.disabled = isBusy;
      if (modeSingle) modeSingle.disabled = isBusy;
      if (modeAll) modeAll.disabled = isBusy;
      if (episodeSelect) episodeSelect.disabled = isBusy;
      if (qualitySelect) qualitySelect.disabled = isBusy;
      if (cancelBtn) cancelBtn.style.display = isBusy ? "" : "none";
    } catch {}
  }

  async function fetchJson(url, { signal } = {}) {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res || !res.ok) {
      const statusText = res ? `${res.status} ${res.statusText || ""}`.trim() : "Network error";
      throw new Error(statusText);
    }
    return await res.json();
  }

  function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function normalizeQualityName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function parseSourceLabel(name) {
    const raw = String(name || "").trim();
    if (!raw) return "Options";
    const match = raw.match(/^(.*?)\s*\d{3,4}p\b/i);
    if (match && match[1]) {
      const label = match[1].trim();
      return label || "Options";
    }
    return "Options";
  }

  function parseResolution(label) {
    const match = String(label || "").match(/(\d{3,4})p/i);
    if (!match) return NaN;
    return asNumber(match[1]);
  }

  function sanitizeFilename(value) {
    return String(value == null ? "" : value)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pickBestLink(links, { desiredNameKey, desiredResolution, desiredSourceBase, desiredSourceVariant } = {}) {
    const list = Array.isArray(links) ? links.filter((item) => item && item.link) : [];
    if (!list.length) return null;

    const desiredNameNorm = normalizeQualityName(desiredNameKey);
    if (desiredNameNorm) {
      const exactName = list.find((item) => normalizeQualityName(item.name) === desiredNameNorm);
      if (exactName) return exactName;
    }

    const desiredBase = String(desiredSourceBase || "").trim();
    const desiredVariant = Number.isFinite(Number(desiredSourceVariant)) ? Math.max(1, Math.floor(Number(desiredSourceVariant))) : 1;
    if (desiredBase && Number.isFinite(desiredResolution)) {
      const matches = list.filter((item) => parseSourceLabel(item.name) === desiredBase && parseResolution(item.name) === desiredResolution);
      if (matches.length) {
        const picked = matches[Math.min(matches.length - 1, desiredVariant - 1)];
        if (picked) return picked;
      }
    }

    if (Number.isFinite(desiredResolution)) {
      const exact = list.find((item) => parseResolution(item.name) === desiredResolution);
      if (exact) return exact;
      const contains = list.find((item) => String(item.name || "").includes(`${desiredResolution}p`));
      if (contains) return contains;
    }

    const scored = list
      .map((item) => ({ item, res: parseResolution(item.name) }))
      .sort((a, b) => (Number.isFinite(b.res) ? b.res : -1) - (Number.isFinite(a.res) ? a.res : -1));
    return (scored[0] && scored[0].item) || list[0] || null;
  }

  async function fetchDirectUrl(kwikUrl, { signal } = {}) {
    const { kwikApiBase, kwikAuthToken } = getConfig();
    const res = await fetch(`${kwikApiBase}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "kwik",
        action: "fetch",
        content: { kwik: kwikUrl },
        auth: kwikAuthToken,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`KWIK HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload || payload.status !== true || !payload.content || !payload.content.url) {
      throw new Error("KWIK direct link missing");
    }
    return String(payload.content.url);
  }

  async function downloadAsBlobViaAnimeProxy(directUrl, { signal, onProgress } = {}) {
    const { animeApiBase } = getConfig();
    const proxied = `${animeApiBase}/proxy?modify&proxyUrl=${encodeURIComponent(directUrl)}`;
    const res = await fetch(proxied, { signal });
    if (!res || !res.ok) {
      const statusText = res ? `${res.status} ${res.statusText || ""}`.trim() : "Network error";
      throw new Error(`Download failed (${statusText})`);
    }
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? parseInt(totalHeader, 10) : NaN;

    if (!res.body || typeof res.body.getReader !== "function") {
      const blob = await res.blob();
      if (typeof onProgress === "function") {
        try { onProgress({ loaded: blob.size, total: Number.isFinite(total) ? total : undefined }); } catch {}
      }
      return blob;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength || value.length || 0;
      if (typeof onProgress === "function") {
        try { onProgress({ loaded, total: Number.isFinite(total) ? total : undefined }); } catch {}
      }
    }
    return new Blob(chunks, { type: contentType });
  }

  function guessFilenameFromDirectUrl(directUrl) {
    try {
      const u = new URL(directUrl);
      const file = u.searchParams.get("file");
      if (file) return sanitizeFilename(file);
      const path = (u.pathname || "").split("/").pop();
      if (path && /\.[a-z0-9]{2,5}$/i.test(path)) return sanitizeFilename(path);
    } catch {}
    return "";
  }

  function ensureTargetCategory({ createNew } = {}) {
    const categories = document.getElementById("categories");
    if (!categories) throw new Error("Categories container missing");
    const currentCount = categories.children.length;

    if (createNew || currentCount === 0) {
      if (typeof window.addCategory !== "function") throw new Error("Creator category builder unavailable");
      window.addCategory({ category: `Season ${currentCount + 1}`, episodes: [] });
    }

    const categoryDiv = categories.lastElementChild;
    if (!categoryDiv) throw new Error("Failed to create/find category");
    const episodesDiv = categoryDiv.querySelector(".episodes");
    if (!episodesDiv) throw new Error("Failed to find episodes container");
    return episodesDiv;
  }

  let selectedShow = null;
  let episodeList = [];
  let abortController = null;

  function renderResults(items) {
    resultsEl.innerHTML = "";
    selectionEl.style.display = "none";
    selectedShow = null;
    episodeList = [];

    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.85";
      empty.textContent = "No results.";
      resultsEl.appendChild(empty);
      return;
    }

    list.forEach((item) => {
      const title = item && item.title ? String(item.title) : "Unknown title";
      const type = item && item.type ? String(item.type) : "";
      const year = item && item.year ? String(item.year) : "";
      const episodes = item && item.episodes ? String(item.episodes) : "";
      const score = item && item.score ? String(item.score) : "";
      const session = item && item.session ? String(item.session) : "";
      const poster = item && item.poster ? String(item.poster) : "";

      const row = document.createElement("div");
      row.className = "pahe-result-item";
      row.tabIndex = 0;

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";
      left.style.gap = "0.15em";

      const titleEl = document.createElement("div");
      titleEl.className = "pahe-result-title";
      titleEl.textContent = title;

      const metaEl = document.createElement("div");
      metaEl.className = "pahe-result-meta";
      metaEl.textContent = [type, year ? `(${year})` : "", episodes ? `${episodes} eps` : "", score ? `★ ${score}` : ""]
        .filter(Boolean)
        .join(" • ");

      left.append(titleEl, metaEl);

      const pick = document.createElement("button");
      pick.type = "button";
      pick.textContent = "Select";
      pick.style.margin = "0";

      const selectThis = () => {
        selectedShow = { title, type, year, episodes, score, session, poster };
        selectionEl.style.display = "";
        if (selectedPoster) {
          selectedPoster.src = poster || "";
          selectedPoster.style.display = poster ? "" : "none";
        }
        if (selectedTitle) selectedTitle.textContent = title;
        if (selectedMeta) selectedMeta.textContent = metaEl.textContent;
        void loadEpisodesForSelected();
      };

      pick.addEventListener("click", selectThis);
      row.addEventListener("click", (e) => {
        if (e && e.target === pick) return;
        selectThis();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") selectThis();
      });

      row.append(left, pick);
      resultsEl.appendChild(row);
    });
  }

  async function search() {
    const query = String(queryInput.value || "").trim();
    if (!query) return;
    clearLog();
    resultsEl.innerHTML = "";
    setBusy(true);
    try {
      const { animeApiBase } = getConfig();
      log(`Searching: ${query}`);
      const payload = await fetchJson(`${animeApiBase}/?method=search&query=${encodeURIComponent(query)}`);
      renderResults(payload && payload.data ? payload.data : []);
    } catch (err) {
      log(`Search failed: ${err && err.message ? err.message : String(err)}`);
      renderResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadEpisodesForSelected() {
    if (!selectedShow || !selectedShow.session) return;
    clearLog();
    episodeSelect.innerHTML = "";
    qualitySelect.innerHTML = "";
    episodeList = [];
    setBusy(true);
    try {
      const { animeApiBase } = getConfig();
      log("Loading episodes…");

      const first = await fetchJson(`${animeApiBase}/?method=series&session=${encodeURIComponent(selectedShow.session)}&page=1`);
      const totalPages = first && first.total_pages ? Number(first.total_pages) : 1;
      const all = [];
      if (first && Array.isArray(first.episodes)) all.push(...first.episodes);
      for (let page = 2; page <= totalPages; page += 1) {
        const next = await fetchJson(`${animeApiBase}/?method=series&session=${encodeURIComponent(selectedShow.session)}&page=${page}`);
        if (next && Array.isArray(next.episodes)) all.push(...next.episodes);
      }

      episodeList = all
        .map((ep) => {
          const rawEp = ep && ep.episode != null ? String(ep.episode) : "";
          const num = parseInt(rawEp, 10);
          return {
            episode: Number.isFinite(num) ? String(num) : rawEp,
          session: ep && ep.session ? String(ep.session) : "",
          snapshot: ep && ep.snapshot ? String(ep.snapshot) : "",
          };
        })
        .filter((ep) => ep.session && ep.episode)
        .sort((a, b) => Number(a.episode) - Number(b.episode));

      episodeList.forEach((ep) => {
        const opt = document.createElement("option");
        opt.value = ep.episode;
        opt.textContent = `Episode ${ep.episode}`;
        episodeSelect.appendChild(opt);
      });

      if (!episodeList.length) throw new Error("No episodes found");

      const sampleEp = episodeList[0];
      await refreshQualityOptionsForEpisode(sampleEp.session);
      log(`Ready. Episodes: ${episodeList.length}`);
    } catch (err) {
      log(`Failed to load episodes: ${err && err.message ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      updateEpisodePickerVisibility();
    }
  }

  async function refreshQualityOptionsForEpisode(episodeSession) {
    if (!selectedShow || !selectedShow.session) return;
    const epSession = String(episodeSession || "").trim();
    if (!epSession) return;
    qualitySelect.innerHTML = "";

    const { animeApiBase } = getConfig();
    const links = await fetchJson(
      `${animeApiBase}/?method=episode&session=${encodeURIComponent(selectedShow.session)}&ep=${encodeURIComponent(epSession)}`
    );
    const candidates = Array.isArray(links) ? links : [];
    const items = candidates
      .map((l, idx) => {
        const label = l && l.name ? String(l.name).trim() : "";
        const key = normalizeQualityName(label);
        if (!label || !key || !l || !l.link) return null;
        const base = parseSourceLabel(label);
        const res = parseResolution(label);
        const resKey = Number.isFinite(res) ? String(res) : "__unknown__";
        return { key, name: label, base, res, resKey, order: idx };
      })
      .filter(Boolean);

    const baseMap = new Map();
    items.forEach((item) => {
      if (!baseMap.has(item.base)) baseMap.set(item.base, new Map());
      const resMap = baseMap.get(item.base);
      if (!resMap.has(item.resKey)) resMap.set(item.resKey, []);
      resMap.get(item.resKey).push(item);
    });

    // Sort variants by original appearance so "Alex 2" matches the 2nd entry per quality.
    for (const resMap of baseMap.values()) {
      for (const list of resMap.values()) {
        list.sort((a, b) => a.order - b.order);
      }
    }

    const baseNames = Array.from(baseMap.keys()).sort((a, b) => a.localeCompare(b));
    baseNames.forEach((base) => {
      const resMap = baseMap.get(base);
      const resKeys = Array.from(resMap.keys());
      const numericRes = resKeys
        .filter((k) => k !== "__unknown__")
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);
      const orderedResKeys = numericRes.map(String);
      if (resKeys.includes("__unknown__")) orderedResKeys.push("__unknown__");

      let variantCount = 1;
      orderedResKeys.forEach((rk) => {
        const list = resMap.get(rk) || [];
        variantCount = Math.max(variantCount, list.length);
      });

      for (let variantIdx = 0; variantIdx < variantCount; variantIdx += 1) {
        const groupLabel = variantIdx === 0 ? base : `${base} ${variantIdx + 1}`;
        const optgroup = document.createElement("optgroup");
        optgroup.label = groupLabel;

        const variantItems = [];
        orderedResKeys.forEach((rk) => {
          const list = resMap.get(rk) || [];
          const picked = list[variantIdx];
          if (picked) variantItems.push(picked);
        });

        // If a base has only one variant, don't emit empty "Alex 2" groups.
        if (!variantItems.length) continue;

        variantItems.sort((a, b) => {
          const na = Number.isFinite(a.res);
          const nb = Number.isFinite(b.res);
          if (na && nb) return b.res - a.res;
          if (na && !nb) return -1;
          if (!na && nb) return 1;
          return a.name.localeCompare(b.name);
        });

        variantItems.forEach((item) => {
          const opt = document.createElement("option");
          opt.value = item.key;
          opt.textContent = item.name;
          opt.dataset.resolution = String(Number.isFinite(item.res) ? item.res : "");
          opt.dataset.sourceBase = item.base;
          opt.dataset.sourceVariant = String(variantIdx + 1);
          optgroup.appendChild(opt);
        });

        qualitySelect.appendChild(optgroup);
      }
    });

    if (qualitySelect.options.length) qualitySelect.selectedIndex = 0;
  }

  function updateEpisodePickerVisibility() {
    const whole = !!(modeAll && modeAll.checked);
    if (episodePickerRow) episodePickerRow.style.display = whole ? "none" : "";
    if (startBtn) startBtn.textContent = whole ? "Upload show" : "Upload episode";
  }

  if (modeSingle) modeSingle.addEventListener("change", updateEpisodePickerVisibility);
  if (modeAll) modeAll.addEventListener("change", updateEpisodePickerVisibility);
  if (episodeSelect) {
    episodeSelect.addEventListener("change", () => {
      const selectedEpisode = String(episodeSelect.value || "").trim();
      const match = episodeList.find((ep) => ep && ep.episode === selectedEpisode);
      if (match) {
        void (async () => {
          try { await refreshQualityOptionsForEpisode(match.session); }
          catch (err) { log(`Failed to load quality options: ${err && err.message ? err.message : String(err)}`); }
        })();
      }
    });
  }

  async function uploadSelection() {
    if (!selectedShow || !selectedShow.session) return;
    if (!episodeList.length) {
      log("No episodes loaded yet.");
      return;
    }

    abortController = new AbortController();
    setBusy(true);
    if (progressWrap) progressWrap.style.display = "";
    if (progressBar) {
      progressBar.max = modeAll.checked ? episodeList.length : 1;
      progressBar.value = 0;
    }

    try {
      const applyPoster = !!(applyPosterToggle && applyPosterToggle.checked);
      if (applyPoster) {
        const titleInput = document.getElementById("dirTitle");
        if (titleInput && !String(titleInput.value || "").trim()) {
          titleInput.value = selectedShow.title || "";
        }
        if (typeof window.mm_setCreatorPosterUrl === "function" && selectedShow.poster) {
          window.mm_setCreatorPosterUrl(selectedShow.poster);
        }
      }

      const desiredKey = String(qualitySelect.value || "").trim();
      let desiredResolution = NaN;
      let desiredSourceBase = "";
      let desiredSourceVariant = 1;
      try {
        const sel = qualitySelect.selectedOptions && qualitySelect.selectedOptions[0];
        if (sel && sel.dataset) {
          if (sel.dataset.resolution) desiredResolution = asNumber(sel.dataset.resolution);
          if (sel.dataset.sourceBase) desiredSourceBase = String(sel.dataset.sourceBase || "").trim();
          if (sel.dataset.sourceVariant) desiredSourceVariant = Math.max(1, parseInt(sel.dataset.sourceVariant, 10) || 1);
        }
      } catch {}

      const toUpload = modeAll.checked
        ? episodeList.slice()
        : [episodeList.find((ep) => ep.episode === String(episodeSelect.value || ""))].filter(Boolean);

      if (!toUpload.length) throw new Error("No episode selected");

      const episodesDiv = ensureTargetCategory({ createNew: modeAll.checked });
      clearLog();

      for (let idx = 0; idx < toUpload.length; idx += 1) {
        const ep = toUpload[idx];
        if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const label = `Episode ${ep.episode}`;
        if (progressText) progressText.textContent = `Processing ${label} (${idx + 1}/${toUpload.length})`;

        const epDiv = typeof window.addEpisode === "function"
          ? window.addEpisode(episodesDiv, { title: label, src: "" })
          : null;

        const ensureEpProgressUi = () => {
          const el = epDiv && epDiv._errorEl ? epDiv._errorEl : null;
          if (!el) return { label: null, progress: null };
          if (el._paheProgress && el._paheLabel) return { label: el._paheLabel, progress: el._paheProgress };
          const label = document.createElement("div");
          const progress = document.createElement("progress");
          progress.style.width = "100%";
          progress.style.marginTop = "0.25em";
          progress.max = 100;
          progress.value = 0;
          el.replaceChildren(label, progress);
          el._paheLabel = label;
          el._paheProgress = progress;
          return { label, progress };
        };

        const setEpStatus = (text, tone, progressMeta) => {
          const el = epDiv && epDiv._errorEl ? epDiv._errorEl : null;
          if (!el) return;
          el.style.color = tone || "#9ecbff";
          const ui = ensureEpProgressUi();
          if (ui.label) ui.label.textContent = String(text || "");
          if (ui.progress) {
            if (progressMeta && progressMeta.indeterminate) {
              ui.progress.removeAttribute("value");
            } else if (progressMeta && Number.isFinite(progressMeta.value) && Number.isFinite(progressMeta.max)) {
              ui.progress.max = progressMeta.max;
              ui.progress.value = progressMeta.value;
            } else if (progressMeta && Number.isFinite(progressMeta.value)) {
              ui.progress.max = 100;
              ui.progress.value = progressMeta.value;
            }
          }
        };

        try {
          setEpStatus("Fetching links…", "#9ecbff", { value: 0, max: 100 });
          const { animeApiBase } = getConfig();
          const links = await fetchJson(
            `${animeApiBase}/?method=episode&session=${encodeURIComponent(selectedShow.session)}&ep=${encodeURIComponent(ep.session)}`,
            { signal: abortController.signal }
          );
          const picked = pickBestLink(links, {
            desiredNameKey: desiredKey,
            desiredResolution,
            desiredSourceBase,
            desiredSourceVariant
          });
          if (!picked || !picked.link) throw new Error("No download links found");

          setEpStatus("Resolving direct link…", "#9ecbff", { value: 0, max: 100 });
          const directUrl = await fetchDirectUrl(String(picked.link), { signal: abortController.signal });

          setEpStatus("Downloading…", "#9ecbff", { indeterminate: true });
          const blob = await downloadAsBlobViaAnimeProxy(directUrl, {
            signal: abortController.signal,
            onProgress: ({ loaded, total }) => {
              if (abortController.signal.aborted) return;
              if (Number.isFinite(total) && total > 0) {
                setEpStatus("Downloading…", "#9ecbff", { value: loaded, max: total });
              } else {
                setEpStatus("Downloading…", "#9ecbff", { indeterminate: true });
              }
            }
          });

          const fallbackName = `${sanitizeFilename(selectedShow.title || "series")} - ${ep.episode}.mp4`;
          const directName = guessFilenameFromDirectUrl(directUrl);
          const fileName = sanitizeFilename(directName || fallbackName);
          const fileType = blob && blob.type ? blob.type : "video/mp4";
          const file = new File([blob], fileName, { type: fileType });

          const MAX_CATBOX_BYTES = 200 * 1024 * 1024;
          if (file.size > MAX_CATBOX_BYTES) {
            setEpStatus("File over 200MB; choose a lower quality.", "#ff6b6b");
            log(`${label}: SKIPPED (over 200MB)`);
            if (progressBar) progressBar.value = idx + 1;
            continue;
          }

          // Metadata (size/duration) before upload so the exported JSON includes it.
          try {
            if (epDiv && epDiv.dataset) {
              epDiv.dataset.fileSizeBytes = String(file.size);
            }
            if (epDiv && typeof epDiv._computeLocalFileDurationSeconds === "function") {
              setEpStatus("Reading metadata…", "#9ecbff", { indeterminate: true });
              const duration = await epDiv._computeLocalFileDurationSeconds(file);
              if (Number.isFinite(duration) && duration > 0 && epDiv.dataset) {
                epDiv.dataset.durationSeconds = String(Math.round(duration));
              }
            }
          } catch {}

          setEpStatus("Uploading…", "#9ecbff", { value: 0, max: 100 });
          const catboxUrl = await window.uploadToCatboxWithProgress(
            file,
            (pct) => {
              setEpStatus(`Uploading ${Math.round(pct)}%`, "#9ecbff", { value: pct, max: 100 });
            },
            { context: "batch" }
          );

          if (epDiv && epDiv._srcInput) {
            epDiv._srcInput.value = catboxUrl;
            epDiv._srcInput.dataset.manualEntry = "0";
          }
          setEpStatus("Done", "#9ecbff", { value: 100, max: 100 });

          if (progressBar) progressBar.value = idx + 1;
          log(`${label}: ${catboxUrl}`);
        } catch (err) {
          const aborted = (err && err.name === "AbortError") || abortController.signal.aborted;
          if (aborted) {
            setEpStatus("Cancelled", "#cccccc", { value: 0, max: 100 });
            throw err;
          }
          setEpStatus(`Failed: ${err && err.message ? err.message : String(err)}`, "#ff6b6b", { value: 0, max: 100 });
          log(`${label}: FAILED (${err && err.message ? err.message : String(err)})`);
          if (progressBar) progressBar.value = idx + 1;
        }
      }

      try {
        if (typeof window.updateOutput === "function") window.updateOutput();
      } catch {}
    } finally {
      setBusy(false);
      abortController = null;
      if (progressText) progressText.textContent = "";
      if (progressWrap) progressWrap.style.display = "none";
    }
  }

  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    try {
      if (abortController) abortController.abort();
    } catch {}
  });

  if (searchBtn) searchBtn.addEventListener("click", search);
  if (queryInput) queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
  if (startBtn) startBtn.addEventListener("click", uploadSelection);
})();
