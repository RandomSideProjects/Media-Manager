"use strict";

(function () {
  if (typeof window === "undefined") return;

  const SETTINGS_KEY = "mm_upload_settings";
  const DIRECT_URL = "https://catbox.moe/user/api.php";
  const DEFAULT_PROXY_URL = "https://mm.littlehacker303.workers.dev/catbox/user/api.php";
  const DEFAULT_THRESHOLD_MB = 100;
  const DEFAULT_PROBE_TIMEOUT_MS = 4500;
  const STATE_EVENT = "mm:upload-server-state";

  const state = {
    lastResult: null,
    detection: createDefaultDetection(),
    ensurePromise: null
  };

  function createDefaultDetection() {
    return {
      status: "idle",
      preferredKind: "direct",
      checkedAt: 0,
      directOk: null,
      proxyOk: null,
      directStatus: 0,
      proxyStatus: 0,
      directError: "",
      proxyError: ""
    };
  }

  function normalizeMode(value) {
    const trimmed = (typeof value === "string") ? value.trim().toLowerCase() : "auto";
    if (trimmed === "direct") return "direct";
    if (trimmed === "proxy") return "proxy";
    if (trimmed === "copyparty") return "copyparty";
    return "auto";
  }

  function readRawSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeRawSettings(next) {
    const payload = next && typeof next === "object" ? next : {};
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    return payload;
  }

  function normalizeThresholdMb(raw) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_THRESHOLD_MB;
    return Math.max(6, Math.min(100, parsed));
  }

  function isUsableUploadUrl(raw) {
    if (typeof raw !== "string") return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower === "undefined" || lower === "null") return false;
    try {
      const parsed = new URL(trimmed, (typeof location !== "undefined" && location && location.href) ? location.href : undefined);
      return /^https?:$/i.test(parsed.protocol);
    } catch {
      return false;
    }
  }

  function sanitizeUploadUrl(raw, fallback = "") {
    return isUsableUploadUrl(raw) ? raw.trim() : fallback;
  }

  function isObject(value) {
    return !!value && typeof value === "object";
  }

  function cloneDetection() {
    return Object.assign({}, state.detection);
  }

  function setDetection(next) {
    state.detection = Object.assign(createDefaultDetection(), isObject(next) ? next : {});
    return cloneDetection();
  }

  function getSettings() {
    const raw = readRawSettings();
    const copypartyUrl = (typeof raw.copypartyUploadUrl === "string" && raw.copypartyUploadUrl.trim())
      ? raw.copypartyUploadUrl.trim()
      : "";
    let mode = normalizeMode(raw.catboxOverrideMode);
    if (mode === "copyparty" && !copypartyUrl) {
      mode = "auto";
    }
    return {
      raw,
      mode,
      directUrl: DIRECT_URL,
      proxyUrl: sanitizeUploadUrl((typeof raw.catboxUploadUrl === "string" && raw.catboxUploadUrl.trim())
        ? raw.catboxUploadUrl.trim()
        : "", DEFAULT_PROXY_URL),
      copypartyUrl,
      copypartyPw: (typeof raw.copypartyPw === "string") ? raw.copypartyPw : "",
      copypartyThresholdMb: normalizeThresholdMb(raw.copypartyThresholdMb),
      forceProxyUnderThreshold: raw.catboxForceProxyUnder100Mb === true
    };
  }

  function getModeOptions(settings) {
    const current = settings || getSettings();
    return current.copypartyUrl
      ? ["auto", "direct", "proxy", "copyparty"]
      : ["auto", "direct", "proxy"];
  }

  function hasCopyparty(settings) {
    const current = settings || getSettings();
    return !!current.copypartyUrl;
  }

  function getWindowActiveUrl() {
    const active = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
      ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
      : "";
    return sanitizeUploadUrl(active, "");
  }

  function setWindowActiveUrl(url) {
    const next = sanitizeUploadUrl(url, "");
    if (next) {
      window.MM_ACTIVE_CATBOX_UPLOAD_URL = next;
    }
  }

  function getAutoPreferredKind(settings) {
    const current = settings || getSettings();
    if (state.lastResult && state.lastResult.ok === true) {
      if (state.lastResult.active === current.proxyUrl) return "proxy";
      if (state.lastResult.active === current.directUrl) return "direct";
    }
    if (state.detection.preferredKind === "proxy" && current.proxyUrl) return "proxy";
    return "direct";
  }

  function getActiveRoute(settings) {
    const current = settings || getSettings();
    if (current.mode === "copyparty" && current.copypartyUrl) {
      return { kind: "copyparty", url: current.copypartyUrl };
    }
    if (current.mode === "proxy") {
      return { kind: "proxy", url: current.proxyUrl };
    }
    if (current.mode === "direct") {
      return { kind: "direct", url: current.directUrl };
    }

    const active = getWindowActiveUrl();
    if (active === current.proxyUrl) {
      return { kind: "proxy", url: current.proxyUrl };
    }
    if (active === current.directUrl) {
      return { kind: "direct", url: current.directUrl };
    }

    const preferredKind = getAutoPreferredKind(current);
    return preferredKind === "proxy"
      ? { kind: "proxy", url: current.proxyUrl }
      : { kind: "direct", url: current.directUrl };
  }

  function buildSummary(currentState) {
    const detail = currentState || getState();
    if (detail.mode === "direct") {
      return "Direct override";
    }
    if (detail.mode === "proxy") {
      return "Proxy override";
    }
    if (detail.mode === "copyparty") {
      return "Copyparty override";
    }
    if (detail.detection.status === "running") {
      return "Auto detecting direct Catbox";
    }
    if (detail.activeKind === "proxy") {
      return "Auto using proxy fallback";
    }
    if (detail.detection.status === "unverified") {
      return "Auto direct-first (unverified)";
    }
    return "Auto using direct Catbox";
  }

  function buildDetailText(currentState) {
    const detail = currentState || getState();
    if (detail.mode === "direct") {
      return "Always upload straight to Catbox.";
    }
    if (detail.mode === "proxy") {
      return "Always upload through the configured proxy URL.";
    }
    if (detail.mode === "copyparty") {
      return "Always upload to the configured Copyparty folder.";
    }
    if (detail.detection.status === "running") {
      return "Checking whether direct Catbox is available right now.";
    }
    if (detail.activeKind === "proxy") {
      return detail.detection.directError
        ? `Direct Catbox probe failed, so proxy is active. ${detail.detection.directError}`
        : "Proxy is currently active for auto mode.";
    }
    if (detail.detection.status === "unverified") {
      return "Direct Catbox will be tried first, with proxy fallback if needed.";
    }
    return "Direct Catbox is active and proxy remains available as fallback.";
  }

  function getState() {
    const settings = getSettings();
    const route = getActiveRoute(settings);
    let statusKey = route.kind;
    if (settings.mode === "direct") statusKey = "direct (override)";
    else if (settings.mode === "proxy") statusKey = "proxy (override)";
    else if (settings.mode === "copyparty" && hasCopyparty(settings)) statusKey = "copyparty (override)";

    const detail = {
      ...settings,
      activeUrl: route.url,
      activeKind: route.kind,
      statusKey,
      modeOptions: getModeOptions(settings),
      detection: cloneDetection(),
      lastResult: state.lastResult
    };

    detail.summary = buildSummary(detail);
    detail.detailText = buildDetailText(detail);
    return detail;
  }

  function dispatchStateChange(meta) {
    const detail = {
      ...getState(),
      meta: isObject(meta) ? meta : {}
    };
    try {
      window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail }));
    } catch {}
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
    const settings = getSettings();
    const route = getActiveRoute(settings);

    window.MM_DEFAULT_CATBOX_UPLOAD_URL = settings.directUrl;
    window.MM_DIRECT_CATBOX_UPLOAD_URL = settings.directUrl;
    window.MM_PROXY_CATBOX_UPLOAD_URL = settings.proxyUrl;
    if (route.kind !== "copyparty") {
      setWindowActiveUrl(route.url);
    }
    window.MM_CATBOX_OVERRIDE_MODE = settings.mode;

    dispatchStateChange(Object.assign({
      source: "apply-runtime",
      mode: settings.mode,
      activeKind: route.kind
    }, isObject(meta) ? meta : {}));

    return getState();
  }

  function shouldUseCopyparty(settings, fileSizeBytes, mode) {
    const current = settings || getSettings();
    if (!current.copypartyUrl) return false;
    if (normalizeMode(mode || current.mode) === "copyparty") return true;
    const thresholdBytes = current.copypartyThresholdMb * 1024 * 1024;
    return Number.isFinite(fileSizeBytes) && fileSizeBytes >= thresholdBytes;
  }

  function shouldForceProxy(settings, fileSizeBytes, mode) {
    const current = settings || getSettings();
    if (!current.forceProxyUnderThreshold) return false;
    if (normalizeMode(mode || current.mode) !== "auto") return false;
    if (!Number.isFinite(fileSizeBytes)) return false;
    const thresholdBytes = current.copypartyThresholdMb * 1024 * 1024;
    return fileSizeBytes < thresholdBytes;
  }

  function resolveTarget(options = {}) {
    const current = options.settings || getSettings();
    const mode = normalizeMode(options.mode || current.mode);
    const fileSizeBytes = options.fileSizeBytes;
    const allowProxy = options.allowProxy !== false;
    const route = getActiveRoute(current);

    if (shouldUseCopyparty(current, fileSizeBytes, mode)) {
      return { kind: "copyparty", url: current.copypartyUrl, fallbackUrl: "", mode, settings: current };
    }
    if (mode === "proxy") {
      return { kind: "proxy", url: current.proxyUrl, fallbackUrl: "", mode, settings: current };
    }
    if (mode === "direct") {
      return { kind: "direct", url: current.directUrl, fallbackUrl: "", mode, settings: current };
    }
    if (allowProxy && shouldForceProxy(current, fileSizeBytes, mode)) {
      return { kind: "proxy", url: current.proxyUrl, fallbackUrl: "", mode, forced: true, settings: current };
    }
    return {
      kind: "auto",
      url: route.kind === "proxy" ? current.proxyUrl : current.directUrl,
      fallbackUrl: allowProxy && route.kind !== "proxy" ? current.proxyUrl : "",
      mode,
      settings: current
    };
  }

  function isNoFilesProbeResponse(text) {
    const sample = String(text || "").trim().toLowerCase();
    return sample.includes("no files given")
      || sample.includes("no file given")
      || sample.includes("did not provide a file")
      || sample.includes("no files were given");
  }

  function isBannedProbeResponse(finalUrl, text) {
    const sample = String(text || "").trim().toLowerCase();
    return /\/banned\.php(?:$|[?#])/.test(String(finalUrl || ""))
      || sample.includes("you're banned")
      || sample.includes("you are banned");
  }

  function formatProbeError(result) {
    if (!result || result.ok) return "";
    if (result.error) return result.error;
    if (result.status) return `HTTP ${result.status}`;
    return "Network error";
  }

  async function probeUploadEndpoint(url, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
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
      const finalUrl = response.url || url;
      const banned = isBannedProbeResponse(finalUrl, text);
      const ok = !banned && isNoFilesProbeResponse(text);

      return {
        ok,
        status: response.status || 0,
        statusText: response.statusText || "",
        finalUrl,
        bodySample: String(text || "").trim().slice(0, 200),
        error: banned ? "Catbox returned a banned response." : (ok ? "" : "Probe response was not recognized.")
      };
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? `Probe timed out after ${timeoutMs}ms.`
        : (error && error.message ? error.message : "Network error");
      return {
        ok: false,
        status: 0,
        statusText: "",
        finalUrl: url,
        bodySample: "",
        error: message
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function detectAutoRoute(options = {}) {
    if (state.ensurePromise) return state.ensurePromise;

    const current = options.settings || getSettings();
    if (current.mode !== "auto") {
      return Promise.resolve(applyRuntime({ source: "detect-skip-manual-mode", mode: current.mode }));
    }
    if (!options.force) {
      if (state.detection.status === "idle") {
        setDetection({
          status: "unverified",
          preferredKind: getAutoPreferredKind(current),
          checkedAt: state.detection.checkedAt || 0,
          directOk: state.detection.directOk,
          proxyOk: state.detection.proxyOk,
          directStatus: state.detection.directStatus || 0,
          proxyStatus: state.detection.proxyStatus || 0,
          directError: state.detection.directError || "",
          proxyError: state.detection.proxyError || ""
        });
      }
      return Promise.resolve(applyRuntime({ source: "detect-passive-auto", mode: current.mode }));
    }
    if (!options.force && state.detection.status !== "idle" && state.detection.status !== "running") {
      return Promise.resolve(applyRuntime({ source: "detect-cached", mode: current.mode }));
    }

    setDetection(Object.assign(cloneDetection(), { status: "running" }));
    dispatchStateChange({ source: "detect-start", force: options.force === true });

    state.ensurePromise = (async () => {
      const directProbe = await probeUploadEndpoint(current.directUrl, options);
      if (directProbe.ok) {
        setDetection({
          status: "direct",
          preferredKind: "direct",
          checkedAt: Date.now(),
          directOk: true,
          proxyOk: null,
          directStatus: directProbe.status || 0,
          proxyStatus: 0,
          directError: "",
          proxyError: ""
        });
        setWindowActiveUrl(current.directUrl);
        return applyRuntime({
          source: "detect-complete",
          preferredKind: "direct",
          directStatus: directProbe.status || 0
        });
      }

      const proxyProbe = await probeUploadEndpoint(current.proxyUrl, options);
      if (proxyProbe.ok) {
        setDetection({
          status: "proxy",
          preferredKind: "proxy",
          checkedAt: Date.now(),
          directOk: false,
          proxyOk: true,
          directStatus: directProbe.status || 0,
          proxyStatus: proxyProbe.status || 0,
          directError: formatProbeError(directProbe),
          proxyError: ""
        });
        setWindowActiveUrl(current.proxyUrl);
        return applyRuntime({
          source: "detect-complete",
          preferredKind: "proxy",
          directError: formatProbeError(directProbe),
          proxyStatus: proxyProbe.status || 0
        });
      }

      setDetection({
        status: "unverified",
        preferredKind: "direct",
        checkedAt: Date.now(),
        directOk: false,
        proxyOk: false,
        directStatus: directProbe.status || 0,
        proxyStatus: proxyProbe.status || 0,
        directError: formatProbeError(directProbe),
        proxyError: formatProbeError(proxyProbe)
      });
      setWindowActiveUrl(current.directUrl);
      return applyRuntime({
        source: "detect-unverified",
        directError: formatProbeError(directProbe),
        proxyError: formatProbeError(proxyProbe)
      });
    })().finally(() => {
      state.ensurePromise = null;
    });

    return state.ensurePromise;
  }

  function markResult(result) {
    const current = getSettings();
    const payload = isObject(result) ? result : {};
    const endpoint = (typeof payload.endpoint === "string") ? payload.endpoint.trim() : "";
    const ok = payload.ok !== false;
    const detection = cloneDetection();

    if (current.mode === "auto") {
      if (endpoint === current.directUrl) {
        detection.directOk = ok;
        detection.directStatus = payload.status || detection.directStatus || 0;
        detection.directError = ok ? "" : String(payload.error || "Direct upload failed.");
        if (ok) {
          detection.status = "direct";
          detection.preferredKind = "direct";
        } else if (current.proxyUrl) {
          detection.status = "proxy";
          detection.preferredKind = "proxy";
        }
      } else if (endpoint === current.proxyUrl) {
        detection.proxyOk = ok;
        detection.proxyStatus = payload.status || detection.proxyStatus || 0;
        detection.proxyError = ok ? "" : String(payload.error || "Proxy upload failed.");
        if (ok) {
          detection.status = "proxy";
          detection.preferredKind = "proxy";
        }
      }
      detection.checkedAt = Date.now();
      setDetection(detection);
    }

    let active = endpoint || getActiveRoute(current).url;
    if (!ok && current.mode === "auto" && endpoint === current.directUrl && current.proxyUrl) {
      active = current.proxyUrl;
    }
    if (active && active !== current.copypartyUrl) {
      setWindowActiveUrl(active);
    }

    state.lastResult = Object.assign({
      ok,
      endpoint,
      active,
      mode: current.mode
    }, payload);

    applyRuntime({
      source: "mark-result",
      ok,
      endpoint,
      fallbackFrom: payload.fallbackFrom || "",
      error: payload.error || ""
    });

    return state.lastResult;
  }

  function resetRuntimeHints(partial) {
    if (!isObject(partial)) return;
    if (Object.prototype.hasOwnProperty.call(partial, "catboxUploadUrl")) {
      setDetection(createDefaultDetection());
      state.lastResult = null;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(partial, "copypartyUploadUrl")) {
      state.lastResult = null;
    }
  }

  function persistSettingsPartial(partial, meta) {
    resetRuntimeHints(partial);
    const next = Object.assign({}, readRawSettings(), isObject(partial) ? partial : {});
    writeRawSettings(next);
    applyRuntime(Object.assign({ source: "persist-settings-partial" }, isObject(meta) ? meta : {}));
    try {
      window.dispatchEvent(new CustomEvent("mm_settings_saved", { detail: next }));
    } catch {}
    return next;
  }

  function setMode(mode) {
    persistSettingsPartial({ catboxOverrideMode: normalizeMode(mode) }, { source: "set-mode" });
    return getState().mode;
  }

  function ensure(options = {}) {
    return detectAutoRoute(options);
  }

  function getUploadUrl() {
    return getActiveRoute(getSettings()).url;
  }

  window.MMUploadServer = {
    settingsKey: SETTINGS_KEY,
    directUrl: DIRECT_URL,
    defaultProxyUrl: DEFAULT_PROXY_URL,
    normalizeMode,
    readRawSettings,
    getSettings,
    getModeOptions,
    hasCopyparty,
    getState,
    getCatboxUploadUrl: getUploadUrl,
    shouldUseCopyparty,
    resolveTarget,
    applyRuntime,
    ensure,
    detectAutoRoute,
    markResult,
    persistSettingsPartial,
    setMode
  };

  window.MM_catbox = {
    ensure,
    getUploadUrl,
    get directUrl() { return DIRECT_URL; },
    get proxyUrl() { return getSettings().proxyUrl; },
    getLastResult() { return state.lastResult; },
    markResult,
    setMode,
    getState
  };

  window.mm_getCatboxUploadUrl = getUploadUrl;
  window.mm_getCatboxMode = () => getState().mode;
  window.mm_setCatboxMode = setMode;

  applyRuntime({ source: "bootstrap" });
}());
