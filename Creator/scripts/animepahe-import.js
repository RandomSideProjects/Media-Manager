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
  const qualityBtn = document.getElementById("paheQualityBtn");
  const qualityMenu = document.getElementById("paheQualityMenu");
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

  let paheReachabilityPromise = null;
  let paheReachabilityOk = (typeof window !== "undefined" && window.MM_PAHE_API_OK === true) ? true : null;
  let paheUnreachableNotified = false;
  let paheProbeAttempted = false;
  let lastImportEnabled = false;

  async function probePaheReachable() {
    const { animeApiBase } = getConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      try { controller.abort(); } catch {}
    }, 6000);
    try {
      const target = `${animeApiBase}/?method=search&query=naruto`;
      const url = isCatboxProxyActive()
        ? `${animeApiBase}/proxy?modify&proxyUrl=${encodeURIComponent(target)}`
        : target;
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      return !!(res && res.ok);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensurePaheReachableIfEnabled() {
    if (!isImportEnabled()) return false;
    if (paheReachabilityOk === true) return true;
    if (paheProbeAttempted) return false;
    if (paheReachabilityPromise) return await paheReachabilityPromise;
    paheReachabilityPromise = (async () => {
      paheProbeAttempted = true;
      const ok = await probePaheReachable();
      paheReachabilityOk = ok;
      paheReachabilityPromise = null;
      return ok;
    })();
    return await paheReachabilityPromise;
  }

  function updateVisibility() {
    const isManga = isMangaModeSafe();
    const enabled = isImportEnabled();
    const paheOk = paheReachabilityOk === true
      || ((typeof window !== "undefined" && window.MM_PAHE_API_OK === true) ? true : false);
    const show = enabled && !isManga && paheOk;
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

    if (enabled && !isManga && !paheOk && !paheProbeAttempted) {
      void (async () => {
        const ok = await ensurePaheReachableIfEnabled();
        if (!ok && !paheUnreachableNotified) {
          paheUnreachableNotified = true;
          try {
            if (typeof window.showStorageNotice === "function") {
              window.showStorageNotice({
                title: "Animepahe Import",
                message: "Animepahe API is unreachable. The import panel will stay hidden until it becomes available.",
                tone: "warning",
                autoCloseMs: 5000
              });
            }
          } catch {}
        }
        try { window.MM_PAHE_API_OK = ok; } catch {}
        updateVisibility();
      })();
    }
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
  try { lastImportEnabled = isImportEnabled(); } catch { lastImportEnabled = false; }
  window.addEventListener("mm_settings_saved", () => {
    let nowEnabled = false;
    try { nowEnabled = isImportEnabled(); } catch { nowEnabled = false; }
    if (nowEnabled && !lastImportEnabled) {
      paheReachabilityOk = (typeof window !== "undefined" && window.MM_PAHE_API_OK === true) ? true : null;
      paheReachabilityPromise = null;
      paheUnreachableNotified = false;
      paheProbeAttempted = false;
    }
    lastImportEnabled = nowEnabled;
    updateVisibility();
  });
  window.addEventListener("mm:pahe-api-status", (event) => {
    try {
      const ok = !!(event && event.detail && event.detail.ok === true);
      paheReachabilityOk = ok;
      try { window.MM_PAHE_API_OK = ok; } catch {}
    } catch {}
    updateVisibility();
  });

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
      if (qualityBtn) qualityBtn.disabled = isBusy;
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

  async function fetchPaheJson(url, { signal } = {}) {
    const { animeApiBase } = getConfig();
    const target = String(url || "").trim();
    const finalUrl = isCatboxProxyActive()
      ? `${animeApiBase}/proxy?modify&proxyUrl=${encodeURIComponent(target)}`
      : target;
    const res = await fetch(finalUrl, { cache: "no-store", signal });
    if (!res || !res.ok) {
      const statusText = res ? `${res.status} ${res.statusText || ""}`.trim() : "Network error";
      throw new Error(statusText);
    }
    return await res.json();
  }

  function paheProxyUrl(resourceUrl) {
    const raw = String(resourceUrl || "").trim();
    if (!raw) return "";
    const { animeApiBase } = getConfig();
    const base = (animeApiBase || "").replace(/\/+$/, "");
    if (base && raw.startsWith(`${base}/proxy?`)) return raw;
    return `${base}/proxy?modify&proxyUrl=${encodeURIComponent(raw)}`;
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

  function parseSizeMb(label) {
    const match = String(label || "").match(/\((\d+(?:\.\d+)?)\s*mb\)/i);
    if (!match) return NaN;
    return asNumber(match[1]);
  }

  function tagForResolution(res) {
    if (!Number.isFinite(res)) return "";
    if (res >= 1080) return "HD";
    if (res >= 720) return "SD";
    return "";
  }

  let selectedQuality = null; // { key, base, variant, res, sizeMb }

  function updateQualityUiSelection() {
    if (qualityMenu) {
      const buttons = Array.from(qualityMenu.querySelectorAll(".pahe-quality-item"));
      buttons.forEach((btn) => {
        const isSelected = !!(selectedQuality && btn.dataset.key === selectedQuality.key);
        if (isSelected) btn.classList.add("is-selected");
        else btn.classList.remove("is-selected");
      });
    }

    if (!qualityBtn) return;
    if (!selectedQuality) {
      qualityBtn.textContent = "Select…";
      return;
    }
    const tag = tagForResolution(selectedQuality.res);
    const baseLabel = selectedQuality.variant && selectedQuality.variant > 1
      ? `${selectedQuality.base} ${selectedQuality.variant}`
      : selectedQuality.base;
    const sizeText = Number.isFinite(selectedQuality.sizeMb) ? `(${selectedQuality.sizeMb}MB)` : "";
    qualityBtn.textContent = [baseLabel, tag, sizeText].filter(Boolean).join(" ");
  }

  function showQualityMenu() {
    if (!qualityMenu) return;
    qualityMenu.style.display = "";
    updateQualityUiSelection();
  }

  function hideQualityMenu() {
    if (!qualityMenu) return;
    qualityMenu.style.display = "none";
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
      .filter((entry) => Number.isFinite(entry.res) && entry.res >= 720)
      .sort((a, b) => (Number.isFinite(b.res) ? b.res : -1) - (Number.isFinite(a.res) ? a.res : -1));
    return (scored[0] && scored[0].item) || null;
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

  function getCatboxUploadEndpoint() {
    try {
      const active = (typeof window !== "undefined" && typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
        ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
        : "";
      if (active) return active;
    } catch {}
    try {
      if (typeof window !== "undefined" && typeof window.mm_getCatboxUploadUrl === "function") {
        const candidate = String(window.mm_getCatboxUploadUrl() || "").trim();
        if (candidate) return candidate;
      }
    } catch {}
    const st = readUploadSettings();
    const fromSettings = st && typeof st.catboxUploadUrl === "string" ? st.catboxUploadUrl.trim() : "";
    return fromSettings || "https://mm.littlehacker303.workers.dev/catbox/user/api.php";
  }

  function isCatboxProxyActive() {
    const endpoint = String(getCatboxUploadEndpoint() || "").trim();
    if (!endpoint) return false;
    try {
      const parsed = new URL(endpoint);
      const host = (parsed.hostname || "").toLowerCase();
      return host !== "catbox.moe";
    } catch {
      return true;
    }
  }

  async function uploadUrlToCatbox(remoteUrl, { signal } = {}) {
    const url = String(remoteUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Invalid URL");

    const form = new FormData();
    form.append("reqtype", "urlupload");
    form.append("url", url);

    const st = readUploadSettings();
    const settings = st && typeof st === "object" ? st : {};
    let isAnon = (typeof settings.anonymous === "boolean") ? settings.anonymous : true;
    const effectiveUserhash = ((settings.userhash || "").trim()) || "2cdcc7754c86c2871ed2bde9d";
    if (!isAnon) {
      form.append("userhash", effectiveUserhash);
    }

    const endpoint = getCatboxUploadEndpoint();
    const res = await fetch(endpoint, { method: "POST", body: form, signal });
    if (!res.ok) throw new Error(`Catbox HTTP ${res.status}`);
    const text = String(await res.text()).trim();
    try {
      if (typeof window !== "undefined" && typeof window.mm_normalizeCatboxUrl === "function") {
        const normalized = window.mm_normalizeCatboxUrl(text);
        if (normalized && normalized.url) return normalized.url;
      }
    } catch {}
    return text;
  }

  async function fetchRemoteContentLength(url) {
    try {
      const head = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (head.ok) {
        const cl = head.headers.get("content-length") || head.headers.get("Content-Length");
        const n = cl ? parseInt(cl, 10) : NaN;
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch {}
    try {
      const resp = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" });
      if (resp.ok || resp.status === 206) {
        const cr = resp.headers.get("content-range") || resp.headers.get("Content-Range");
        if (cr) {
          const m = cr.match(/\/(\d+)\s*$/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n >= 0) return n;
          }
        }
        const cl = resp.headers.get("content-length") || resp.headers.get("Content-Length");
        const n = cl ? parseInt(cl, 10) : NaN;
        if (Number.isFinite(n) && n > 1) return n;
      }
    } catch {}
    return NaN;
  }

  async function computeRemoteDurationSeconds(url) {
    return new Promise((resolve) => {
      try {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.crossOrigin = "anonymous";
        let settled = false;
        const cleanup = (result) => {
          if (settled) return;
          settled = true;
          try { v.pause(); } catch {}
          try { v.removeAttribute("src"); v.load(); } catch {}
          try { v.remove(); } catch {}
          resolve(result);
        };
        const done = () => {
          const d = Number.isFinite(v.duration) ? v.duration : NaN;
          cleanup(d);
        };
        const timer = setTimeout(() => cleanup(NaN), 10000);
        v.onloadedmetadata = () => { clearTimeout(timer); done(); };
        v.onerror = () => { clearTimeout(timer); cleanup(NaN); };
        v.src = url;
      } catch {
        resolve(NaN);
      }
    });
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
          selectedPoster.src = poster ? paheProxyUrl(poster) : "";
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
      const payload = await fetchPaheJson(`${animeApiBase}/?method=search&query=${encodeURIComponent(query)}`);
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
    if (qualityMenu) qualityMenu.innerHTML = "";
    selectedQuality = null;
    updateQualityUiSelection();
    episodeList = [];
    setBusy(true);
    try {
      const { animeApiBase } = getConfig();
      log("Loading episodes…");

      const first = await fetchPaheJson(`${animeApiBase}/?method=series&session=${encodeURIComponent(selectedShow.session)}&page=1`);
      const totalPages = first && first.total_pages ? Number(first.total_pages) : 1;
      const all = [];
      if (first && Array.isArray(first.episodes)) all.push(...first.episodes);
      for (let page = 2; page <= totalPages; page += 1) {
        const next = await fetchPaheJson(`${animeApiBase}/?method=series&session=${encodeURIComponent(selectedShow.session)}&page=${page}`);
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
    if (qualityMenu) qualityMenu.innerHTML = "";

    const { animeApiBase } = getConfig();
    const links = await fetchPaheJson(
      `${animeApiBase}/?method=episode&session=${encodeURIComponent(selectedShow.session)}&ep=${encodeURIComponent(epSession)}`
    );

    const candidates = Array.isArray(links) ? links : [];
    const items = candidates
      .map((l, idx) => {
        const rawName = l && l.name ? String(l.name).trim() : "";
        const key = normalizeQualityName(rawName);
        if (!rawName || !key || !l || !l.link) return null;
        const base = parseSourceLabel(rawName);
        const res = parseResolution(rawName);
        if (!Number.isFinite(res) || res < 720) return null; // only list 720p+
        const sizeMb = parseSizeMb(rawName);
        const resKey = String(Math.round(res));
        return { key, base, res, sizeMb, resKey, order: idx };
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
    const menuButtons = [];

    baseNames.forEach((base) => {
      const resMap = baseMap.get(base);
      const resKeys = Array.from(resMap.keys())
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a)
        .map(String);

      let variantCount = 1;
      resKeys.forEach((rk) => {
        const list = resMap.get(rk) || [];
        variantCount = Math.max(variantCount, list.length);
      });

      for (let variantIdx = 0; variantIdx < variantCount; variantIdx += 1) {
        const groupLabel = variantIdx === 0 ? base : `${base} ${variantIdx + 1}`;
        const groupEl = document.createElement("div");
        groupEl.className = "pahe-quality-group";

        const groupTitle = document.createElement("div");
        groupTitle.className = "pahe-quality-group-title";
        groupTitle.textContent = groupLabel;
        groupEl.appendChild(groupTitle);

        const variantItems = [];
        resKeys.forEach((rk) => {
          const list = resMap.get(rk) || [];
          const picked = list[variantIdx];
          if (picked) variantItems.push(picked);
        });
        if (!variantItems.length) continue;

        variantItems.forEach((item) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pahe-quality-item";
          btn.dataset.key = item.key;
          btn.dataset.resolution = String(item.res);
          btn.dataset.sourceBase = item.base;
          btn.dataset.sourceVariant = String(variantIdx + 1);
          btn.dataset.sizeMb = String(Number.isFinite(item.sizeMb) ? item.sizeMb : "");

          const left = document.createElement("div");
          left.className = "pahe-quality-left";

          const tagText = tagForResolution(item.res);
          const tag = document.createElement("span");
          tag.className = `setting-tag ${tagText === "HD" ? "setting-tag--hd" : "setting-tag--sd"}`;
          tag.textContent = tagText || "SD";
          left.appendChild(tag);

          const right = document.createElement("div");
          const sizeSpan = document.createElement("span");
          const sizeMb = Number.isFinite(item.sizeMb) ? item.sizeMb : NaN;
          const sizeClass = Number.isFinite(sizeMb) && sizeMb > 200 ? "over" : "ok";
          sizeSpan.className = `pahe-quality-size ${sizeClass}`;
          sizeSpan.textContent = Number.isFinite(sizeMb) ? `(${sizeMb}MB)` : "";
          right.appendChild(sizeSpan);

          btn.append(left, right);
          btn.addEventListener("click", () => {
            selectedQuality = {
              key: item.key,
              base: item.base,
              variant: variantIdx + 1,
              res: item.res,
              sizeMb: item.sizeMb
            };
            updateQualityUiSelection();
            hideQualityMenu();
          });

          groupEl.appendChild(btn);
          menuButtons.push(btn);
        });

        if (qualityMenu) qualityMenu.appendChild(groupEl);
      }
    });

    // Keep selection by (base + variant + res) if possible.
    if (selectedQuality) {
      const candidate = menuButtons.find((btn) => {
        const base = btn.dataset.sourceBase || "";
        const variant = parseInt(btn.dataset.sourceVariant || "1", 10) || 1;
        const res = asNumber(btn.dataset.resolution || "");
        return base === selectedQuality.base && variant === selectedQuality.variant && res === selectedQuality.res;
      });
      if (candidate) {
        selectedQuality.key = candidate.dataset.key || selectedQuality.key;
        selectedQuality.sizeMb = asNumber(candidate.dataset.sizeMb || selectedQuality.sizeMb);
      } else {
        selectedQuality = null;
      }
    }

    if (!selectedQuality && menuButtons.length) {
      // Default to first button (highest res, first variant).
      const first = menuButtons[0];
      selectedQuality = {
        key: first.dataset.key || "",
        base: first.dataset.sourceBase || "",
        variant: Math.max(1, parseInt(first.dataset.sourceVariant || "1", 10) || 1),
        res: asNumber(first.dataset.resolution || ""),
        sizeMb: asNumber(first.dataset.sizeMb || "")
      };
    }

    updateQualityUiSelection();
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
    if (!selectedQuality || !selectedQuality.key) {
      log("Select a quality (SD/HD) first.");
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

      const desiredKey = selectedQuality && selectedQuality.key ? selectedQuality.key : "";
      const desiredResolution = selectedQuality && Number.isFinite(selectedQuality.res) ? selectedQuality.res : NaN;
      const desiredSourceBase = selectedQuality && selectedQuality.base ? selectedQuality.base : "";
      const desiredSourceVariant = selectedQuality && Number.isFinite(selectedQuality.variant) ? selectedQuality.variant : 1;

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
          const links = await fetchPaheJson(
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
          const pickedSizeMb = parseSizeMb(picked && picked.name ? picked.name : "");

          setEpStatus("Resolving direct link…", "#9ecbff", { value: 0, max: 100 });
          const directUrl = await fetchDirectUrl(String(picked.link), { signal: abortController.signal });

          // Use the reported size (when present) to skip obvious >200MB uploads early.
          let effectiveSizeBytes = NaN;
          if (Number.isFinite(pickedSizeMb) && pickedSizeMb > 0) {
            effectiveSizeBytes = pickedSizeMb * 1024 * 1024;
          }
          const MAX_CATBOX_BYTES = 200 * 1024 * 1024;
          if (Number.isFinite(effectiveSizeBytes) && effectiveSizeBytes > MAX_CATBOX_BYTES) {
            setEpStatus("Over 200MB; choose a lower quality.", "#ff6b6b", { value: 0, max: 100 });
            log(`${label}: SKIPPED (over 200MB)`);
            if (progressBar) progressBar.value = idx + 1;
            continue;
          }

          // Start Catbox URL upload immediately (no browser download).
          setEpStatus("Uploading (URL)…", "#9ecbff", { indeterminate: true });
          const catboxUrl = await uploadUrlToCatbox(directUrl, { signal: abortController.signal });

          if (epDiv && epDiv._srcInput) {
            epDiv._srcInput.value = catboxUrl;
            epDiv._srcInput.dataset.manualEntry = "0";
          }

          // Fetch metadata from the final Catbox URL using the same logic as a normal remote URL source.
          try {
            if (epDiv && epDiv.dataset) {
              try { delete epDiv.dataset.fileSizeBytes; } catch { epDiv.dataset.fileSizeBytes = ""; }
              try { delete epDiv.dataset.durationSeconds; } catch { epDiv.dataset.durationSeconds = ""; }
            }
            if (epDiv && typeof epDiv._fetchMeta === "function") {
              setEpStatus("Fetching metadata…", "#9ecbff", { indeterminate: true });
              await epDiv._fetchMeta();
            }
          } catch {}

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

  if (qualityBtn) {
    qualityBtn.addEventListener("click", (event) => {
      try { event.preventDefault(); event.stopPropagation(); } catch {}
      if (!qualityMenu) return;
      const open = qualityMenu.style.display !== "none";
      if (open) hideQualityMenu();
      else showQualityMenu();
    });
  }

  if (qualityMenu) {
    qualityMenu.addEventListener("click", (event) => {
      // Keep menu open while clicking inside it (actual selection handlers close it).
      try { event.stopPropagation(); } catch {}
    });
  }

  document.addEventListener("click", () => hideQualityMenu(), { capture: true });
})();
