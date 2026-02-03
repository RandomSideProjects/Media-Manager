"use strict";

(function () {
  if (typeof window === "undefined") return;

  const STORAGE_KEY = "rsp_recent_sources_list_v1";
  const TOGGLE_KEY = "rsp_recent_sources_enabled";
  const PLACEMENT_KEY = "rsp_recent_sources_placement";
  const CENTER_CARDS_KEY = "rsp_recent_sources_center_cards";
  const INLINE_PREFIX = "rsp_recent_inline_payload:";
  const STORAGE_LIMIT = 6;
  const VERTICAL_DISPLAY_LIMIT = 5;
  const HORIZONTAL_DISPLAY_LIMIT = 5;
  const VALID_PLACEMENTS = new Set(["bottom", "left", "right"]);
  const DEFAULT_PLACEMENT = "bottom";
  const INLINE_MAX_LENGTH = 150000; // 150 KB guardrail so it dont kill itself :/ should be plenty for most uses, will probably add an function to auto delete old ones later if i get around to it
  const LEGACY_SOURCE_PREFIX = "Directorys/Files/";
  const LEGACY_SOURCE_REPLACEMENT = "Sources/Files/";
  const LEGACY_SOURCE_PREFIX_LOWER = LEGACY_SOURCE_PREFIX.toLowerCase();
  const recentRail = (typeof recentSourcesRail !== "undefined" && recentSourcesRail) ? recentSourcesRail : document.getElementById("recentSourcesRail");
  const urlInputField = (typeof urlInput !== "undefined" && urlInput) ? urlInput : document.getElementById("urlInput");
  const POINTER_COARSE_QUERY = (typeof window !== "undefined" && typeof window.matchMedia === "function")
    ? window.matchMedia("(pointer:coarse)")
    : null;
  const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const DESKTOP_MIN_WIDTH = 992;

  function escapeRegExp(value) {
    return (typeof value === "string" ? value : "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replaceLegacyPaths(value) {
    if (typeof value !== "string" || !value.includes(LEGACY_SOURCE_PREFIX)) return value;
    const regex = new RegExp(escapeRegExp(LEGACY_SOURCE_PREFIX), "gi");
    return value.replace(regex, LEGACY_SOURCE_REPLACEMENT);
  }

  function migrateLegacyPathsInLocalStorage() {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      keys.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (typeof raw !== "string" || !raw.includes(LEGACY_SOURCE_PREFIX)) return;
        const normalized = replaceLegacyPaths(raw);
        if (normalized !== raw) {
          localStorage.setItem(key, normalized);
        }
      });
    } catch (err) {
      console.warn("[RecentSources] Legacy migration failed", err);
    }
  }

  migrateLegacyPathsInLocalStorage();

  const state = {
    enabled: readEnabledSetting(),
    placement: readPlacementSetting(),
    centerCards: readCenterCardsSetting(),
    items: readStoredItems(),
    active: false,
    viewportDesktop: isDesktopViewport()
  };

  function readStoredItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sources)) {
        let needPersist = false;
        const normalizedSources = parsed.sources.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          if (typeof entry.path === "string") {
            const normalized = normalizeLegacySourcePath(entry.path);
            if (normalized.changed) {
              needPersist = true;
              return { ...entry, path: normalized.value };
            }
          }
          return entry;
        });
        const filtered = normalizedSources.filter(isValidEntry);
        if (filtered.length !== parsed.sources.length) {
          needPersist = true;
        }
        if (needPersist) {
          persistItems(filtered);
        }
        return filtered.slice(0, STORAGE_LIMIT);
      }
    } catch (err) {
      console.warn("[RecentSources] Failed to parse stored list", err);
    }
    return [];
  }

  function persistItems(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sources: items.slice(0, STORAGE_LIMIT) }));
    } catch (err) {
      console.warn("[RecentSources] Failed to persist recent sources", err);
    }
  }

  function readEnabledSetting() {
    try { return localStorage.getItem(TOGGLE_KEY) === "true"; }
    catch { return false; }
  }

  function readPlacementSetting() {
    try {
      const stored = localStorage.getItem(PLACEMENT_KEY);
      if (stored && VALID_PLACEMENTS.has(stored)) return stored;
    } catch {}
    return DEFAULT_PLACEMENT;
  }

  function readCenterCardsSetting() {
    // Default ON.
    try {
      const raw = localStorage.getItem(CENTER_CARDS_KEY);
      if (raw === null || raw === undefined) return true;
      return raw === "true";
    } catch {
      return true;
    }
  }

  function writeEnabledSetting(value) {
    try {
      if (value) localStorage.setItem(TOGGLE_KEY, "true");
      else localStorage.removeItem(TOGGLE_KEY);
    } catch {}
  }

  function writePlacementSetting(value) {
    try {
      localStorage.setItem(PLACEMENT_KEY, value);
    } catch {}
  }

  function writeCenterCardsSetting(value) {
    try {
      if (value) localStorage.setItem(CENTER_CARDS_KEY, "true");
      else localStorage.setItem(CENTER_CARDS_KEY, "false");
    } catch {}
  }

  function isDesktopUserAgent() {
    if (typeof navigator === "undefined" || !navigator.userAgent) return true;
    return !MOBILE_UA_PATTERN.test(navigator.userAgent);
  }

  function isDesktopViewport() {
    if (typeof window === "undefined") return true;
    const widthOk = window.innerWidth >= DESKTOP_MIN_WIDTH;
    const coarsePointer = POINTER_COARSE_QUERY ? POINTER_COARSE_QUERY.matches : false;
    return widthOk && !coarsePointer && isDesktopUserAgent();
  }

  function normalizeLegacySourcePath(rawValue) {
    if (typeof rawValue !== "string") {
      return { value: rawValue, changed: false };
    }
    const trimmed = rawValue.trim();
    if (trimmed.length < LEGACY_SOURCE_PREFIX.length) {
      return { value: rawValue, changed: false };
    }
    const candidate = trimmed.slice(0, LEGACY_SOURCE_PREFIX.length);
    if (candidate.toLowerCase() !== LEGACY_SOURCE_PREFIX_LOWER) {
      return { value: rawValue, changed: false };
    }
    const suffix = trimmed.slice(LEGACY_SOURCE_PREFIX.length);
    return {
      value: `${LEGACY_SOURCE_REPLACEMENT}${suffix}`,
      changed: true
    };
  }

  function isValidEntry(entry) {
    return entry && typeof entry === "object" && typeof entry.title === "string" && typeof entry.path === "string";
  }

  function notifyChange() {
    try {
      window.dispatchEvent(new CustomEvent("rsp:recent-sources-updated", {
        detail: {
          enabled: state.enabled,
          placement: state.placement,
          items: state.items.slice(),
          active: state.active
        }
      }));
    } catch {}
  }

  function slugify(text) {
    if (!text) return "source";
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "source";
  }

  function sumParts(parts, field) {
    if (!Array.isArray(parts)) return 0;
    return parts.reduce((total, part) => {
      const value = Number(part && part[field]);
      return Number.isFinite(value) && value > 0 ? total + value : total;
    }, 0);
  }

  function summarizeSource(json) {
    const categories = Array.isArray(json && json.categories) ? json.categories : [];
    let categoryCount = 0;
    let separatedCategoryCount = 0;
    let episodeCount = 0;
    let separatedItemCount = 0;
    let separatedEpisodeCount = 0;
    let separatedEpisodeItemCount = 0;
    let separatedCategoryItemCount = 0;
    let totalFileSizeBytes = 0;
    let totalDurationSeconds = 0;

    categories.forEach((category) => {
      const isSeparatedCategory = Number(category && category.separated) === 1;
      if (isSeparatedCategory) separatedCategoryCount += 1;
      else categoryCount += 1;
      const episodes = Array.isArray(category && category.episodes) ? category.episodes : [];
      episodes.forEach((episode) => {
        const episodeSeparated = Number(episode && (episode.separated ?? episode.seperated)) === 1;
        const parts = Array.isArray(episode && episode.sources) ? episode.sources : [];
        const partsCount = parts.length ? parts.length : 1;

        if (isSeparatedCategory) {
          separatedCategoryItemCount += partsCount;
        } else {
          episodeCount += 1;
          if (episodeSeparated) {
            separatedEpisodeCount += 1;
            separatedEpisodeItemCount += partsCount;
          }
        }

        let duration = Number(episode && episode.durationSeconds);
        if (!Number.isFinite(duration) || duration <= 0) {
          duration = sumParts(parts, "durationSeconds");
        }
        if (Number.isFinite(duration) && duration > 0) {
          totalDurationSeconds += duration;
        }

        let fileSize = Number(episode && (episode.fileSizeBytes ?? episode.ItemfileSizeBytes ?? episode.itemFileSizeBytes));
        if (!Number.isFinite(fileSize) || fileSize <= 0) {
          fileSize = sumParts(parts, "fileSizeBytes");
        }
        if (Number.isFinite(fileSize) && fileSize > 0) {
          totalFileSizeBytes += fileSize;
        }
      });
    });

    const aggregatedSize = Number(json && json.totalFileSizeBytes);
    if (Number.isFinite(aggregatedSize) && aggregatedSize > 0) {
      totalFileSizeBytes = aggregatedSize;
    }
    const aggregatedDuration = Number(json && json.totalDurationSeconds);
    if (Number.isFinite(aggregatedDuration) && aggregatedDuration > 0) {
      totalDurationSeconds = aggregatedDuration;
    }

    separatedItemCount = separatedCategoryItemCount + separatedEpisodeItemCount;
    const separatedEpisodeExtraParts = Math.max(0, separatedEpisodeItemCount - separatedEpisodeCount);

    return {
      categoryCount,
      separatedCategoryCount,
      episodeCount,
      separatedItemCount,
      itemCount: episodeCount + separatedCategoryItemCount + separatedEpisodeExtraParts,
      totalFileSizeBytes,
      totalDurationSeconds
    };
  }

  function trimAndStoreInlinePayload(payload, existingKey) {
    if (typeof payload !== "string" || !payload) return null;
    if (payload.length > INLINE_MAX_LENGTH) return null;
    const key = existingKey || `inline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      localStorage.setItem(INLINE_PREFIX + key, payload);
      return key;
    } catch (err) {
      console.warn("[RecentSources] Failed to persist inline payload", err);
      return null;
    }
  }

  function readInlinePayload(key) {
    if (!key) return null;
    try { return localStorage.getItem(INLINE_PREFIX + key); }
    catch { return null; }
  }

  function cleanupInlinePayloads(activeItems) {
    const activeKeys = new Set(
      activeItems
        .filter((item) => item.openKind === "inline" && typeof item.inlineKey === "string")
        .map((item) => item.inlineKey)
    );
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(INLINE_PREFIX)) {
          const payloadKey = key.slice(INLINE_PREFIX.length);
          if (!activeKeys.has(payloadKey)) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch {}
  }

  function buildEntry(json, context = {}) {
    if (!json || typeof json !== "object") return null;
    const sourceTitle = typeof json.title === "string" && json.title.trim() ? json.title.trim() : (context.fallbackTitle || "Untitled source");
    const summary = summarizeSource(json);
    const recordedAt = new Date().toISOString();
    const poster = extractPoster({ ...json, Image: (json && json.Image) || context.poster });

    const openKind = context.kind === "local"
      ? "local"
      : (context.kind === "inline" ? "inline" : "remote");

    let entryPath = typeof context.openValue === "string" ? context.openValue : "";
    let inlineKey = null;
    if (openKind === "local" && !entryPath) {
      entryPath = context.sourceKey ? `local::${context.sourceKey}` : "local::source";
    }
    if (openKind === "inline") {
      inlineKey = trimAndStoreInlinePayload(context.inlinePayload || "");
      if (!inlineKey) return null;
      entryPath = `inline::${inlineKey}`;
    }

    const normalizedEntryPath = normalizeLegacySourcePath(entryPath);
    if (normalizedEntryPath.changed) {
      entryPath = normalizedEntryPath.value;
    }

    const entry = {
      file: (typeof context.sourceKey === "string" && context.sourceKey) ? context.sourceKey : `${slugify(sourceTitle)}.json`,
      path: entryPath,
      title: sourceTitle,
      Image: poster || "",
      categoryCount: summary.categoryCount,
      separatedCategoryCount: summary.separatedCategoryCount,
      episodeCount: summary.episodeCount,
      separatedItemCount: summary.separatedItemCount,
      itemCount: summary.itemCount,
      totalFileSizeBytes: summary.totalFileSizeBytes,
      totalDurationSeconds: summary.totalDurationSeconds,
      LatestTime: json.LatestTime || json.latestTime || json.updatedAt || json.updated_on || "",
      recordedAt,
      openKind
    };
    if (inlineKey) entry.inlineKey = inlineKey;
    return entry;
  }

  function dedupeAndInsert(entry) {
    const uniqueKey = entry.openKind === "inline" ? entry.inlineKey : entry.path;
    const filtered = state.items.filter((item) => {
      const itemKey = item.openKind === "inline" ? item.inlineKey : item.path;
      return itemKey !== uniqueKey;
    });
    const next = [entry, ...filtered].slice(0, STORAGE_LIMIT);
    cleanupInlinePayloads(next);
    state.items = next;
    persistItems(next);
  }

  function formatLocalDate(value) {
    if (!value) return "";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "";
    }
  }

  function showNotice(message, tone = "info") {
    if (!message) return;
    const payload = { title: "Recent sources", message: String(message), tone, autoCloseMs: 4500 };
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      window.mmNotices.show(payload);
    } else if (typeof window.showStorageNotice === "function") {
      window.showStorageNotice(payload);
    } else if (typeof window.alert === "function") {
      try { window.alert(`${payload.title}: ${payload.message}`); } catch {}
    }
  }

  function applyPlacement() {
    if (!recentRail) return;
    recentRail.dataset.placement = state.placement;
  }

  function readNumber(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return null;
      const num = parseInt(String(raw), 10);
      return Number.isFinite(num) ? num : null;
    } catch {
      return null;
    }
  }

  function readString(key) {
    try {
      const raw = localStorage.getItem(key);
      return (raw === null || raw === undefined) ? "" : String(raw);
    } catch {
      return "";
    }
  }

  function getContinueIndexForEntry(entry) {
    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk) return null;
    const fromContinue = readNumber(`${sk}:ContinueIndex`);
    if (fromContinue !== null) return fromContinue;
    const fromSaved = readNumber(`${sk}:SavedItem`);
    if (fromSaved !== null) return fromSaved;
    const fromLast = readNumber(`${sk}:LastIndex`);
    if (fromLast !== null) return fromLast;
    return null;
  }

  function getThumbForEntry(entry, idx) {
    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk || idx === null || idx === undefined) return "";
    return readString(`${sk}:thumb:${idx}`);
  }

  function getItemTitleForEntry(entry, idx) {
    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk || idx === null || idx === undefined) return "";
    return readString(`${sk}:itemTitle:${idx}`);
  }

  // --- Preview frame generation (best-effort) ---
  // Uses the playable item src captured during playback (player.js) to generate a thumbnail
  // when the Home rail is shown. This may fail for CORS-tainted sources; that's OK.
  const thumbGenQueue = [];
  let thumbGenActive = false;

  function getItemSrcForEntry(entry, idx) {
    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk || idx === null || idx === undefined) return "";
    return readString(`${sk}:itemSrc:${idx}`);
  }

  function getItemDurationForEntry(entry, idx) {
    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk || idx === null || idx === undefined) return 0;
    const raw = readString(`${sk}:itemDuration:${idx}`);
    const num = Number(raw);
    return (Number.isFinite(num) && num > 0) ? num : 0;
  }

  function queueThumbGeneration(entry, idx) {
    if (!entry) return;
    if (idx === null || idx === undefined) return;
    const existing = getThumbForEntry(entry, idx);
    if (existing) return;

    const itemSrc = getItemSrcForEntry(entry, idx);
    const duration = getItemDurationForEntry(entry, idx);
    if (!itemSrc || !duration) return;

    const sk = entry && entry.file ? String(entry.file) : "";
    if (!sk) return;
    const queueKey = `${sk}::${idx}`;
    if (thumbGenQueue.some((job) => job && job.queueKey === queueKey)) return;

    thumbGenQueue.push({ queueKey, entry, idx, itemSrc, duration });
    pumpThumbQueue();
  }

  function pumpThumbQueue() {
    if (thumbGenActive) return;
    const job = thumbGenQueue.shift();
    if (!job) return;
    thumbGenActive = true;
    generateThumbFromVideo(job.itemSrc, job.duration)
      .then((dataUrl) => {
        if (!dataUrl) return;
        const sk = job.entry && job.entry.file ? String(job.entry.file) : "";
        if (!sk) return;
        localStorage.setItem(`${sk}:thumb:${job.idx}`, dataUrl);
      })
      .catch(() => {})
      .finally(() => {
        thumbGenActive = false;
        // Re-render so the newly generated image shows up.
        try { render(); } catch {}
        pumpThumbQueue();
      });
  }

  function generateThumbFromVideo(src, durationSeconds) {
    return new Promise((resolve) => {
      if (!src) return resolve("");
      const dur = Number(durationSeconds);
      if (!Number.isFinite(dur) || dur <= 0) return resolve("");

      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      // Best effort to allow canvas capture when the server supports it.
      try { el.crossOrigin = "anonymous"; } catch {}
      el.style.position = "fixed";
      el.style.left = "-99999px";
      el.style.top = "0";
      el.style.width = "1px";
      el.style.height = "1px";
      el.style.opacity = "0";
      document.body.appendChild(el);

      let settled = false;
      const cleanup = () => {
        try {
          el.removeEventListener("error", onError);
          el.removeEventListener("loadedmetadata", onMeta);
          el.removeEventListener("seeked", onSeeked);
        } catch {}
        try { el.pause(); } catch {}
        try { el.removeAttribute("src"); } catch {}
        try { el.load(); } catch {}
        try { el.remove(); } catch {}
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value || "");
      };

      const onError = () => finish("");
      const onMeta = () => {
        const realDur = (Number.isFinite(el.duration) && el.duration > 0) ? el.duration : dur;
        const maxSeek = Math.max(1, realDur - 2);
        const seed = Math.random();
        const target = Math.max(1, Math.min(maxSeek, seed * maxSeek));
        try { el.currentTime = target; }
        catch { finish(""); }
      };
      const onSeeked = () => {
        try {
          if (!(el.videoWidth > 0 && el.videoHeight > 0)) return finish("");
          const canvas = document.createElement("canvas");
          const maxW = 720;
          const scale = Math.min(1, maxW / el.videoWidth);
          canvas.width = Math.max(1, Math.floor(el.videoWidth * scale));
          canvas.height = Math.max(1, Math.floor(el.videoHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish("");
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
          if (dataUrl && dataUrl.startsWith("data:image/")) return finish(dataUrl);
        } catch {
          // Likely a CORS-tainted canvas.
        }
        finish("");
      };

      el.addEventListener("error", onError);
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("seeked", onSeeked);

      try {
        el.src = src;
        el.load();
      } catch {
        finish("");
        return;
      }

      // Safety timeout.
      setTimeout(() => finish(""), 8000);
    });
  }

  function formatTime(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const total = Math.floor(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function buildCard(entry) {
    const wrapper = document.createElement("div");
    wrapper.className = "source-card recent-source-card continue-card";

    const continueIndex = getContinueIndexForEntry(entry);
    const itemTitle = (continueIndex !== null && continueIndex !== undefined)
      ? (getItemTitleForEntry(entry, continueIndex) || `Item ${continueIndex + 1}`)
      : "Start watching";

    // Use the poster art as the card image (middle section).
    const poster = extractPoster(entry);
    const posterEl = document.createElement("div");
    posterEl.className = "continue-poster";
    if (poster) {
      posterEl.style.backgroundImage = `url('${String(poster).replace(/'/g, "\\'")}')`;
    } else {
      posterEl.classList.add("no-thumb");
    }

    // Video-only metadata (for bottom line).
    const itemSrc = getItemSrcForEntry(entry, continueIndex);
    const hintedDuration = getItemDurationForEntry(entry, continueIndex);
    const isVideoSource = !!(itemSrc && hintedDuration);

    const content = document.createElement("div");
    content.className = "continue-overlay continue-overlay--centered";

    const top = document.createElement("div");
    top.className = "continue-top";
    top.textContent = itemTitle;

    const bottom = document.createElement("div");
    bottom.className = "continue-bottom";

    // Best-effort progress estimate from stored time/duration.
    let ratio = 0;
    let watched = 0;
    let duration = hintedDuration;
    try {
      const sk = entry && entry.file ? String(entry.file) : "";
      if (continueIndex !== null && continueIndex !== undefined) {
        const durRaw = readString(`${sk}:itemDuration:${continueIndex}`);
        const durNum = Number(durRaw);
        if (Number.isFinite(durNum) && durNum > 0) duration = durNum;
        const timeRaw = readString(`${sk}:itemTime:${continueIndex}`);
        const t = Number(timeRaw);
        if (Number.isFinite(t) && t >= 0) watched = t;
        ratio = (Number.isFinite(duration) && duration > 0) ? Math.max(0, Math.min(1, watched / duration)) : 0;
      }
    } catch {}

    const isNextUp = isVideoSource && ratio >= 0.90;

    // Bottom centered: watched/duration if <90%, else "Next Episode"
    if (!isNextUp && isVideoSource) {
      bottom.textContent = `${formatTime(watched)} / ${formatTime(duration)}`;
    } else if (isVideoSource) {
      bottom.textContent = "Next Episode";
    } else {
      bottom.textContent = "";
    }

    content.append(top, posterEl, bottom);
    wrapper.appendChild(content);

    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("aria-label", `${isNextUp ? "Next up" : "Continue"}: ${itemTitle}`);

    const activate = (event) => {
      event.preventDefault();
      openEntry(entry, { resumeIndex: continueIndex });
    };
    wrapper.addEventListener("click", activate);
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        activate(event);
      }
    });

    // No frame extraction here — posters only.

    return wrapper;
  }

  function openEntry(entry, opts = {}) {
    if (!entry) return;
    if (entry.openKind === "local") {
      showNotice("This source was loaded from a local folder. Use Select Folder to open it again.", "warning");
      return;
    }
    if (entry.openKind === "inline") {
      const payload = readInlinePayload(entry.inlineKey);
      if (!payload) {
        showNotice("Inline data for this source is no longer available.", "error");
        return;
      }
      if (urlInputField) urlInputField.value = "[inline source]";
      if (typeof window.loadSource === "function") {
        try {
          const response = window.loadSource(payload);
          if (response && typeof response.then === "function") {
            response.catch((err) => console.error("[RecentSources] Inline reopen failed", err));
          }
        } catch (err) {
          console.error("[RecentSources] Inline reopen threw", err);
        }
      }
      return;
    }
    const rawValue = entry.path || entry.source || "";
    if (!rawValue) {
      showNotice("No launch data stored for this source.", "error");
      return;
    }
    if (urlInputField) urlInputField.value = rawValue;
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("source", encodeURIComponent(rawValue));
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch {}
    if (typeof window.loadSource === "function") {
      try {
        const response = window.loadSource(rawValue);
        if (response && typeof response.then === "function") {
          response
            .then((ok) => {
              const idx = Number.isFinite(Number(opts.resumeIndex)) ? Number(opts.resumeIndex) : null;
              if (!ok || idx === null) return;
              // Jump straight into the player at the requested index.
              try {
                if (typeof window.currentIndex === 'number') window.currentIndex = idx;
                else if (typeof currentIndex === 'number') currentIndex = idx;
              } catch {}
              try {
                if (typeof selectorScreen !== 'undefined' && selectorScreen) selectorScreen.style.display = 'none';
                if (typeof playerScreen !== 'undefined' && playerScreen) playerScreen.style.display = 'block';
                if (typeof backBtn !== 'undefined' && backBtn) backBtn.style.display = 'inline-block';
                if (typeof theaterBtn !== 'undefined' && theaterBtn) theaterBtn.style.display = 'inline-block';
              } catch {}
              try {
                if (typeof window.loadVideo === 'function') window.loadVideo(idx);
              } catch {}
            })
            .catch((err) => console.error("[RecentSources] reopen failed", err));
        }
      } catch (err) {
        console.error("[RecentSources] reopen threw", err);
      }
    }
  }

  function render() {
    if (!recentRail) return;
    if (!state.viewportDesktop) {
      recentRail.innerHTML = "";
      recentRail.hidden = true;
      recentRail.setAttribute("aria-hidden", "true");
      document.body.classList.remove("recent-sources-active");
      return;
    }
    applyPlacement();
    const isVertical = state.placement === "left" || state.placement === "right";
    const displayLimit = isVertical ? VERTICAL_DISPLAY_LIMIT : HORIZONTAL_DISPLAY_LIMIT;
    const items = state.items.slice(0, displayLimit);
    const shouldShow = state.enabled && items.length > 0 && !state.active;
    if (!shouldShow) {
      recentRail.innerHTML = "";
      recentRail.hidden = true;
      recentRail.setAttribute("aria-hidden", "true");
      document.body.classList.remove("recent-sources-active");
      return;
    }
    document.body.classList.add("recent-sources-active");
    recentRail.hidden = false;
    recentRail.setAttribute("aria-hidden", "false");
    recentRail.innerHTML = "";

    const header = document.createElement("div");
    header.className = "recent-sources-header";
    const title = document.createElement("h3");
    title.textContent = "Continue watching";
    const count = document.createElement("span");
    count.className = "recent-sources-count";
    count.textContent = `${items.length} / ${displayLimit}`;
    count.hidden = true;
    count.setAttribute("aria-hidden", "true");
    header.append(title, count);

    const grid = document.createElement("div");
    grid.className = "recent-sources-grid";
    grid.dataset.layout = isVertical ? "2x3" : "3x2";

    items.forEach((entry) => {
      const card = buildCard(entry);
      grid.appendChild(card);
    });

    recentRail.append(header, grid);

    // Center cards when there are only a few (i.e., no horizontal overflow).
    // If content overflows, keep it left-aligned so the scroll starts at the beginning.
    const updateCentering = () => {
      try {
        const shouldCenter = state.centerCards === true;
        const centered = shouldCenter && grid.scrollWidth <= (grid.clientWidth + 2);
        grid.classList.toggle('is-centered', centered);
      } catch {}
    };
    requestAnimationFrame(updateCentering);
    setTimeout(updateCentering, 0);
  }

  function setEnabled(value) {
    const desired = value === true;
    state.enabled = desired;
    writeEnabledSetting(desired);
    render();
    notifyChange();
  }

  function setPlacement(value) {
    const normalized = VALID_PLACEMENTS.has(value) ? value : DEFAULT_PLACEMENT;
    state.placement = normalized;
    writePlacementSetting(normalized);
    render();
    notifyChange();
  }

  function setCenterCards(value) {
    const desired = value === true;
    state.centerCards = desired;
    writeCenterCardsSetting(desired);
    render();
    notifyChange();
  }

  function recordSource(json, context = {}) {
    try {
      const entry = buildEntry(json, context);
      if (!entry) return;
      dedupeAndInsert(entry);
      if (state.enabled) render();
      notifyChange();
    } catch (err) {
      console.error("[RecentSources] Failed to record source", err);
    }
  }

  function setActiveSource(value) {
    const desired = value === true;
    if (state.active === desired) return;
    state.active = desired;
    render();
    notifyChange();
  }

  function syncFromStorage(event) {
    if (!event || event.storageArea !== localStorage) return;
    if (event.key === TOGGLE_KEY) {
      const next = event.newValue === "true";
      if (state.enabled !== next) {
        state.enabled = next;
        render();
      }
    } else if (event.key === PLACEMENT_KEY) {
      const nextPlacement = event.newValue && VALID_PLACEMENTS.has(event.newValue) ? event.newValue : DEFAULT_PLACEMENT;
      if (state.placement !== nextPlacement) {
        state.placement = nextPlacement;
        render();
      }
    } else if (event.key === STORAGE_KEY) {
      state.items = readStoredItems();
      render();
    }
  }

  function removeEntryByUniqueKey(uniqueKey) {
    if (!uniqueKey) return false;
    const filtered = state.items.filter((item) => {
      const itemKey = item && item.openKind === "inline" ? item.inlineKey : item && item.path;
      return itemKey !== uniqueKey;
    });
    if (filtered.length === state.items.length) return false;
    cleanupInlinePayloads(filtered);
    state.items = filtered.slice(0, STORAGE_LIMIT);
    persistItems(state.items);
    render();
    notifyChange();
    return true;
  }

  function removeInlineKey(inlineKey) {
    if (!inlineKey) return false;
    try { localStorage.removeItem(INLINE_PREFIX + inlineKey); } catch {}
    return removeEntryByUniqueKey(inlineKey);
  }

  function removePath(path) {
    if (!path) return false;
    return removeEntryByUniqueKey(path);
  }

  window.RSPRecentSources = {
    isEnabled: () => state.enabled,
    setEnabled,
    getPlacement: () => state.placement,
    setPlacement,
    isCenterCardsEnabled: () => state.centerCards,
    setCenterCards,
    isSourceActive: () => state.active,
    setSourceActive: setActiveSource,
    getItems: () => state.items.slice(),
    record: recordSource,
    removeInlineKey,
    removePath,
    refresh: render
  };

  render();
  window.addEventListener("storage", syncFromStorage);
  window.addEventListener("resize", scheduleViewportCheck, { passive: true });
  if (POINTER_COARSE_QUERY) {
    if (typeof POINTER_COARSE_QUERY.addEventListener === "function") {
      POINTER_COARSE_QUERY.addEventListener("change", scheduleViewportCheck);
    } else if (typeof POINTER_COARSE_QUERY.addListener === "function") {
      POINTER_COARSE_QUERY.addListener(scheduleViewportCheck);
    }
  }

  let viewportTimer = null;
  function scheduleViewportCheck() {
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(() => {
      const next = isDesktopViewport();
      if (state.viewportDesktop !== next) {
        state.viewportDesktop = next;
      }
      render();
    }, 140);
  }
})();
