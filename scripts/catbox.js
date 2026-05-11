"use strict";

(function () {
  if (typeof window === "undefined") return;

  const DIRECT_URL = "https://catbox.moe/user/api.php";
  const DEFAULT_PROXY_URL = "https://mm.littlehacker303.workers.dev/catbox/user/api.php";
  const LS_SETTINGS_KEY = "mm_upload_settings";
  const PROBE_TIMEOUT_MS = 4500;

  const state = {
    status: "idle",
    preferredKind: "direct",
    checkedAt: 0,
    lastResult: null,
    ensurePromise: null
  };

  function normalizeMode(value) {
    const trimmed = (typeof value === "string") ? value.trim().toLowerCase() : "auto";
    if (trimmed === "direct") return "direct";
    if (trimmed === "proxy") return "proxy";
    if (trimmed === "default") return "auto";
    return "auto";
  }

  function readSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const data = parsed && typeof parsed === "object" ? parsed : {};
      return {
        mode: normalizeMode(data.catboxOverrideMode),
        proxyUrl: (typeof data.catboxUploadUrl === "string" && data.catboxUploadUrl.trim())
          ? data.catboxUploadUrl.trim()
          : DEFAULT_PROXY_URL
      };
    } catch {
      return { mode: "auto", proxyUrl: DEFAULT_PROXY_URL };
    }
  }

  function writeSettingsPartial(partial) {
    let current = {};
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      current = raw ? JSON.parse(raw) : {};
      if (!current || typeof current !== "object") current = {};
    } catch {
      current = {};
    }
    const next = Object.assign({}, current, partial && typeof partial === "object" ? partial : {});
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  function getActiveUrl() {
    const active = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
      ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
      : "";
    return active || "";
  }

  function setActiveUrl(url) {
    if (typeof url === "string" && url.trim()) {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = url.trim();
    }
  }

  function isNoFilesResponse(text) {
    const sample = String(text || "").trim().toLowerCase();
    return sample.includes("no files given")
      || sample.includes("no file given")
      || sample.includes("did not provide a file")
      || sample.includes("no files were given");
  }

  function isBannedResponse(finalUrl, text) {
    const sample = String(text || "").trim().toLowerCase();
    return /\/banned\.php(?:$|[?#])/.test(String(finalUrl || ""))
      || sample.includes("you're banned")
      || sample.includes("you are banned");
  }

  async function probeUploadEndpoint(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append("reqtype", "fileupload");
      const response = await fetch(url, {
        method: "POST",
        body: form,
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      const text = await response.text();
      const banned = isBannedResponse(response.url || url, text);
      return {
        ok: !banned && isNoFilesResponse(text),
        status: response.status || 0,
        error: banned ? "Catbox returned a banned response." : ""
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error && error.name === "AbortError"
          ? `Probe timed out after ${PROBE_TIMEOUT_MS}ms.`
          : (error && error.message ? error.message : "Network error")
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function getState() {
    const settings = readSettings();
    const active = getActiveUrl();
    let activeKind = "direct";

    if (settings.mode === "proxy") {
      activeKind = "proxy";
    } else if (active === settings.proxyUrl) {
      activeKind = "proxy";
    } else if (settings.mode === "direct") {
      activeKind = "direct";
    } else if (state.preferredKind === "proxy") {
      activeKind = "proxy";
    }

    const activeUrl = activeKind === "proxy" ? settings.proxyUrl : DIRECT_URL;
    const summary = settings.mode === "proxy"
      ? "Proxy override"
      : settings.mode === "direct"
        ? "Direct override"
        : activeKind === "proxy"
          ? "Auto using proxy fallback"
          : state.status === "running"
            ? "Auto detecting direct Catbox"
            : "Auto using direct Catbox";

    return {
      mode: settings.mode,
      directUrl: DIRECT_URL,
      proxyUrl: settings.proxyUrl,
      activeKind,
      activeUrl,
      status: state.status,
      checkedAt: state.checkedAt,
      summary,
      lastResult: state.lastResult
    };
  }

  function dispatchState(meta) {
    const detail = Object.assign({}, getState(), { meta: meta && typeof meta === "object" ? meta : {} });
    try {
      window.dispatchEvent(new CustomEvent("rsp:catbox-default-updated", {
        detail: {
          url: detail.activeUrl,
          previous: "",
          meta: detail.meta
        }
      }));
    } catch {}
  }

  function applyRuntime(meta) {
    const current = getState();
    window.MM_DEFAULT_CATBOX_UPLOAD_URL = DIRECT_URL;
    window.MM_DIRECT_CATBOX_UPLOAD_URL = DIRECT_URL;
    window.MM_PROXY_CATBOX_UPLOAD_URL = current.proxyUrl;
    setActiveUrl(current.activeUrl);
    window.MM_CATBOX_OVERRIDE_MODE = current.mode;
    dispatchState(Object.assign({ source: "apply-runtime" }, meta && typeof meta === "object" ? meta : {}));
    return current;
  }

  async function ensure(options = {}) {
    const current = readSettings();
    if (current.mode !== "auto") {
      state.status = current.mode;
      return applyRuntime({ source: "ensure-manual", mode: current.mode });
    }
    if (state.ensurePromise) return state.ensurePromise;
    if (!options.force && state.status !== "idle" && state.status !== "running") {
      return applyRuntime({ source: "ensure-cached" });
    }

    state.status = "running";
    dispatchState({ source: "detect-start", force: options.force === true });

    state.ensurePromise = (async () => {
      const directProbe = await probeUploadEndpoint(DIRECT_URL);
      if (directProbe.ok) {
        state.status = "direct";
        state.preferredKind = "direct";
        state.checkedAt = Date.now();
        setActiveUrl(DIRECT_URL);
        return applyRuntime({ source: "detect-complete", preferredKind: "direct" });
      }

      const proxyProbe = await probeUploadEndpoint(current.proxyUrl);
      if (proxyProbe.ok) {
        state.status = "proxy";
        state.preferredKind = "proxy";
        state.checkedAt = Date.now();
        setActiveUrl(current.proxyUrl);
        return applyRuntime({ source: "detect-complete", preferredKind: "proxy", directError: directProbe.error || "" });
      }

      state.status = "unverified";
      state.preferredKind = "direct";
      state.checkedAt = Date.now();
      setActiveUrl(DIRECT_URL);
      return applyRuntime({
        source: "detect-unverified",
        directError: directProbe.error || "",
        proxyError: proxyProbe.error || ""
      });
    })().finally(() => {
      state.ensurePromise = null;
    });

    return state.ensurePromise;
  }

  async function getUploadUrl() {
    const resolved = await ensure();
    return resolved && resolved.activeUrl ? resolved.activeUrl : getState().activeUrl;
  }

  function getUploadPlan() {
    const current = getState();
    return {
      url: current.activeUrl,
      fallbackUrl: current.mode === "auto" && current.activeKind === "direct" ? current.proxyUrl : "",
      mode: current.mode,
      directUrl: current.directUrl,
      proxyUrl: current.proxyUrl
    };
  }

  function markResult(result) {
    const current = getState();
    const payload = result && typeof result === "object" ? result : {};
    const endpoint = (typeof payload.endpoint === "string") ? payload.endpoint.trim() : "";
    const ok = payload.ok !== false;
    if (current.mode === "auto") {
      if (ok && endpoint === current.proxyUrl) {
        state.status = "proxy";
        state.preferredKind = "proxy";
      } else if (ok && endpoint === DIRECT_URL) {
        state.status = "direct";
        state.preferredKind = "direct";
      } else if (!ok && endpoint === DIRECT_URL) {
        state.status = "proxy";
        state.preferredKind = "proxy";
        setActiveUrl(current.proxyUrl);
      }
      state.checkedAt = Date.now();
    }
    if (ok && endpoint) setActiveUrl(endpoint);
    state.lastResult = Object.assign({
      ok,
      endpoint,
      active: getState().activeUrl,
      mode: current.mode
    }, payload);
    applyRuntime({ source: "mark-result", ok, endpoint, error: payload.error || "" });
    return state.lastResult;
  }

  function persistSettingsPartial(partial) {
    const next = writeSettingsPartial(partial);
    if (partial && Object.prototype.hasOwnProperty.call(partial, "catboxUploadUrl")) {
      state.status = "idle";
      state.preferredKind = "direct";
      state.checkedAt = 0;
      state.lastResult = null;
    }
    applyRuntime({ source: "persist-settings-partial" });
    return next;
  }

  function setMode(mode) {
    persistSettingsPartial({ catboxOverrideMode: normalizeMode(mode) });
    return getState().mode;
  }

  applyRuntime({ source: "bootstrap" });

  window.MM_catbox = {
    ensure,
    getUploadUrl,
    getUploadPlan,
    getState,
    get directUrl() { return DIRECT_URL; },
    get proxyUrl() { return readSettings().proxyUrl; },
    getLastResult: () => state.lastResult,
    markResult,
    setMode,
    persistSettingsPartial,
    normalizeMode
  };

  if (typeof window.mm_getCatboxUploadUrl !== "function") {
    window.mm_getCatboxUploadUrl = getUploadUrl;
  }
}());
