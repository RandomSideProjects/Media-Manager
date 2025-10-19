"use strict";

(function () {
  const CATBOX_DIRECT_UPLOAD_URL = "https://catbox.moe/user/api.php";
  const CATBOX_PROXY_UPLOAD_URL = "https://catbox-proxy.littlehacker303.workers.dev/user/api.php";
  const LS_SETTINGS_KEY = "mm_upload_settings";

  if (typeof window === "undefined") return;

  const state = {
    detectionPromise: null,
    lastResult: null,
    settingsOverride: null
  };

  function normalizeOverrideMode(value) {
    const normalized = (typeof value === "string" ? value : "").trim().toLowerCase();
    if (normalized === "direct" || normalized === "proxy") return normalized;
    return "auto";
  }

  function loadSettingsOverride() {
    if (state.settingsOverride) return state.settingsOverride;
    let overrideMode = "auto";
    let customUrl = "";
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          overrideMode = normalizeOverrideMode(parsed.catboxOverrideMode);
          if (typeof parsed.catboxUploadUrl === "string") {
            customUrl = parsed.catboxUploadUrl.trim();
          }
        }
      }
    } catch {}
    state.settingsOverride = { mode: overrideMode, customUrl };
    return state.settingsOverride;
  }

  function bootstrapCatboxDefaults() {
    if (typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL !== "string" || !window.MM_DEFAULT_CATBOX_UPLOAD_URL.trim()) {
      window.MM_DEFAULT_CATBOX_UPLOAD_URL = CATBOX_DIRECT_UPLOAD_URL;
    }
    if (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL !== "string" || !window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()) {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = window.MM_DEFAULT_CATBOX_UPLOAD_URL;
    }
    const existingOverride = normalizeOverrideMode(window.MM_CATBOX_OVERRIDE_MODE);
    if (existingOverride !== "auto") {
      window.MM_CATBOX_OVERRIDE_MODE = existingOverride;
      return;
    }
    const settingsOverride = loadSettingsOverride();
    if (settingsOverride.mode !== "auto") {
      window.MM_CATBOX_OVERRIDE_MODE = settingsOverride.mode;
    }
  }

  bootstrapCatboxDefaults();

  function getCatboxOverrideMode() {
    const winOverride = normalizeOverrideMode(window.MM_CATBOX_OVERRIDE_MODE);
    if (winOverride !== "auto") return winOverride;
    const settingsOverride = loadSettingsOverride();
    return settingsOverride.mode !== "auto" ? settingsOverride.mode : "auto";
  }

  async function performUploadProbe(targetUrl, options = {}) {
    try {
      const blob = new Blob(["Upload Test"], { type: "text/plain" });
      const file = new File([blob], "UploadTestFile.txt", { type: "text/plain" });
      const form = new FormData();
      form.append("reqtype", "fileupload");
      form.append("fileToUpload", file);

      const response = await fetch(targetUrl, {
        method: "POST",
        body: form,
        credentials: "omit"
      });

      if (!response || !response.ok) {
        return false;
      }

      const text = await response.text();
      const trimmed = typeof text === "string" ? text.trim() : "";
      const ok = trimmed.length > 0;

      if (!ok && options.onSoftFail) {
        options.onSoftFail(trimmed);
      }
      return ok;
    } catch (err) {
      if (options.onError) options.onError(err);
      return false;
    }
  }

  async function probeCatboxUpload() {
    let lastError = null;
    let lastResponse = "";
    const directOk = await performUploadProbe(CATBOX_DIRECT_UPLOAD_URL, {
      onSoftFail: (body) => { lastResponse = body; },
      onError: (err) => { lastError = err; }
    });
    return { ok: directOk, error: lastError, body: lastResponse };
  }

  function applyCatboxDefault(url, meta) {
    try {
      let clean = (typeof url === "string" && url.trim()) ? url.trim() : CATBOX_DIRECT_UPLOAD_URL;
      const previous = (typeof window.MM_DEFAULT_CATBOX_UPLOAD_URL === "string")
        ? window.MM_DEFAULT_CATBOX_UPLOAD_URL
        : undefined;
      const overrideMode = getCatboxOverrideMode();
      const detailMeta = (meta && typeof meta === "object") ? { ...meta } : {};

      if (overrideMode === "direct") {
        clean = CATBOX_DIRECT_UPLOAD_URL;
        detailMeta.override = "direct";
      } else if (overrideMode === "proxy") {
        clean = CATBOX_PROXY_UPLOAD_URL;
        detailMeta.override = "proxy";
      }

      window.MM_DEFAULT_CATBOX_UPLOAD_URL = clean;
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = clean;
      window.dispatchEvent(new CustomEvent("rsp:catbox-default-updated", {
        detail: { url: clean, previous, meta: detailMeta }
      }));
    } catch (err) {
      console.error("[MediaManager] Failed to apply Catbox default URL", err);
    }
  }

  async function detectCatboxEndpoint() {
    let directResult = null;
    let proxyError = null;
    let proxyBody = "";
    let endpoint = "direct";
    let proxyResult = null;

    try {
      directResult = await probeCatboxUpload();
      if (directResult && directResult.ok) {
        applyCatboxDefault(CATBOX_DIRECT_UPLOAD_URL, { source: "direct" });
        endpoint = "direct";
      } else {
        const proxyOk = await performUploadProbe(CATBOX_PROXY_UPLOAD_URL, {
          onSoftFail: (body) => { proxyBody = body; },
          onError: (err) => { proxyError = err; }
        });
        if (proxyOk) {
          proxyResult = { ok: true };
          applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, { source: "proxy", directResult });
          endpoint = "proxy";
        } else {
          proxyResult = { ok: false, error: proxyError, body: proxyBody };
          applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, {
            source: "unavailable",
            directResult,
            proxyResult
          });
          endpoint = "unavailable";
        }
      }
    } catch (err) {
      proxyResult = { ok: false, error: err };
      applyCatboxDefault(CATBOX_PROXY_UPLOAD_URL, {
        source: "unavailable",
        directResult,
        proxyResult
      });
      endpoint = "unavailable";
    }

    const active = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
      ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
      : "";
    const result = { endpoint, directResult, proxyResult, active };
    state.lastResult = result;
    return result;
  }

  function ensureDetection() {
    if (!state.detectionPromise) {
      state.detectionPromise = detectCatboxEndpoint().catch((err) => {
        console.error("[MediaManager] Catbox endpoint detection failed", err);
        state.detectionPromise = null;
        throw err;
      });
    }
    return state.detectionPromise;
  }

  async function getUploadUrl() {
    try {
      await ensureDetection();
    } catch {
      // Detection failure falls back to the currently recorded active URL.
    }
    const active = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
      ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
      : "";
    return active || CATBOX_DIRECT_UPLOAD_URL;
  }

  window.MM_catbox = {
    ensure: ensureDetection,
    getUploadUrl,
    directUrl: CATBOX_DIRECT_UPLOAD_URL,
    proxyUrl: CATBOX_PROXY_UPLOAD_URL,
    getLastResult: () => state.lastResult
  };

  if (typeof window.mm_getCatboxUploadUrl !== "function") {
    window.mm_getCatboxUploadUrl = getUploadUrl;
  }

  setTimeout(() => {
    ensureDetection().catch(() => {});
  }, 0);
})();
