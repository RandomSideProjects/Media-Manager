"use strict";

(function () {
  if (typeof window === "undefined") return;

  const ACCOUNT_ID_KEY = "rsp_account_id";
  const BACKEND_ROOT_KEY = "dev:mmBackendRoot";
  const LEGACY_SYNC_URL_KEY = "dev:accountSyncUrl";
  const SINCE_KEY = "dev:accountSyncSince";
  const LAST_SYNC_AT_KEY = "dev:accountSyncLastSyncAt";
  const AUTO_SYNC_INTERVAL_SEC_KEY = "rsp_account_auto_sync_sec";
  const QUEUE_KEY = "dev:accountSyncQueue";
  const DEVICE_ID_KEY = "rsp_device_id";
  const LOCK_KEY = "dev:accountSyncLock";

  const DEFAULT_BACKEND_ROOT = "https://mm.littlehacker303.workers.dev";
  const LOCK_TTL_MS = 25_000;
  const REQUEST_TIMEOUT_MS = 15_000;
  const MAX_OPS_PER_SYNC = 2500;
  const PULL_INTERVAL_MS = 30 * 60 * 1000;

  const internalKeys = new Set([ACCOUNT_ID_KEY, BACKEND_ROOT_KEY, LEGACY_SYNC_URL_KEY, SINCE_KEY, LAST_SYNC_AT_KEY, QUEUE_KEY, LOCK_KEY]);

  let suspendRecording = false;
  let queue = null;
  let flushTimer = null;
  let lastPullAttemptAt = 0;
  let autoSyncTimerId = null;
  let autoSyncIntervalMs = 0;
  let quickSyncTimerId = null;

  function showNotice(options) {
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      return window.mmNotices.show(options || {});
    }
    if (typeof window.showStorageNotice === "function") {
      return window.showStorageNotice(options || {});
    }
    try { window.alert(options && options.message ? String(options.message) : ""); } catch {}
    return null;
  }

  function parseTimeValue(raw) {
    if (raw === null || typeof raw === "undefined") return null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const str = String(raw).trim();
    if (!str) return null;
    const numeric = Number(str);
    if (Number.isFinite(numeric)) return numeric;
    if (!/^\d+(?::\d{1,2}){1,2}$/.test(str)) return null;
    const parts = str.split(":").map((segment) => Number(segment));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    if (parts.length === 2) {
      seconds = (parts[0] * 60) + parts[1];
    } else if (parts.length === 3) {
      seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    } else {
      return null;
    }
    return seconds;
  }

  function isInvalidIncomingValue(value) {
    const trimmed = String(value ?? "").trim().toLowerCase();
    return !trimmed || trimmed === "null" || trimmed === "undefined" || trimmed === "nan";
  }

  function shouldSetByMerge(existingValue, incomingValue) {
    if (incomingValue === null || typeof incomingValue === "undefined") return false;
    const serializedIncoming = typeof incomingValue === "string" ? incomingValue : String(incomingValue);
    if (existingValue === null || typeof existingValue === "undefined") {
      return !isInvalidIncomingValue(serializedIncoming);
    }

    const existingStr = String(existingValue);
    if (existingStr === serializedIncoming) return false;

    const existingTime = parseTimeValue(existingStr);
    const incomingTime = parseTimeValue(serializedIncoming);
    if (existingTime !== null && incomingTime !== null) {
      return incomingTime > existingTime;
    }

    return !isInvalidIncomingValue(serializedIncoming);
  }

  function isDevOnlyKey(key) {
    if (typeof key !== "string" || !key) return true;
    if (key === "rsp_dev_mode") return true;
    const lower = key.toLowerCase();
    return lower.startsWith("dev:") || lower.startsWith("dev_") || lower.startsWith("rsp_dev_");
  }

  function isSyncableKey(key) {
    if (typeof key !== "string" || !key) return false;
    if (internalKeys.has(key)) return false;
    return !isDevOnlyKey(key);
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try {
      suspendRecording = true;
      localStorage.setItem(key, value);
    } catch {} finally {
      suspendRecording = false;
    }
  }

  function safeRemove(key) {
    try {
      suspendRecording = true;
      localStorage.removeItem(key);
    } catch {} finally {
      suspendRecording = false;
    }
  }

  function normalizeBackendRoot(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return DEFAULT_BACKEND_ROOT;
    const withScheme = raw.includes("://") ? raw : `http://${raw}`;
    let normalized = withScheme.replace(/\/+$/, "");
    try {
      const url = new URL(normalized);
      normalized = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    } catch {}
    return normalized;
  }

  function getBackendRoot() {
    const stored = safeGet(BACKEND_ROOT_KEY);
    if (stored && typeof stored === "string" && stored.trim()) return normalizeBackendRoot(stored);

    const legacy = safeGet(LEGACY_SYNC_URL_KEY);
    const legacyTrimmed = typeof legacy === "string" ? legacy.trim() : "";
    if (legacyTrimmed) {
      try {
        const url = new URL(legacyTrimmed.includes("://") ? legacyTrimmed : `http://${legacyTrimmed}`);
        return normalizeBackendRoot(`${url.protocol}//${url.host}`);
      } catch {
        return DEFAULT_BACKEND_ROOT;
      }
    }

    return DEFAULT_BACKEND_ROOT;
  }

  function getSyncUrl() {
    return `${getBackendRoot()}/account/storage`;
  }

  function getCheckUrl() {
    return `${getBackendRoot()}/account/check`;
  }

  function randomBase64Url(bytes) {
    const raw = crypto.getRandomValues(new Uint8Array(bytes));
    const b64 = btoa(String.fromCharCode(...raw));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function getOrCreateDeviceId() {
    const existing = safeGet(DEVICE_ID_KEY);
    const trimmed = typeof existing === "string" ? existing.trim() : "";
    if (trimmed) return trimmed;
    const next = `mm-${randomBase64Url(9)}`;
    safeSet(DEVICE_ID_KEY, next);
    return next;
  }

  function getAccountConfig() {
    const accountId = (safeGet(ACCOUNT_ID_KEY) || "").trim();
    if (!accountId) return null;
    return { accountId };
  }

  function loadQueue() {
    if (Array.isArray(queue)) return queue;
    const raw = safeGet(QUEUE_KEY);
    if (!raw) {
      queue = [];
      return queue;
    }
    try {
      const parsed = JSON.parse(raw);
      queue = Array.isArray(parsed) ? parsed : [];
    } catch {
      queue = [];
    }
    return queue;
  }

  function scheduleQueueFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      try {
        safeSet(QUEUE_KEY, JSON.stringify(loadQueue()));
      } catch {}
    }, 250);
  }

  function enqueueOp(op) {
    if (!op || typeof op !== "object") return;
    const q = loadQueue();
    if (op.type === "set" || op.type === "remove") {
      const key = op.key;
      for (let i = q.length - 1; i >= 0; i -= 1) {
        const existing = q[i];
        if (existing && (existing.type === "set" || existing.type === "remove") && existing.key === key) {
          q.splice(i, 1);
          break;
        }
      }
    }
    q.push(op);
    if (q.length > MAX_OPS_PER_SYNC * 3) {
      q.splice(0, q.length - (MAX_OPS_PER_SYNC * 3));
    }
    scheduleQueueFlush();

    if (op.type === "set" || op.type === "remove") {
      const key = op.key;
      if (isLikelySettingKey(key)) scheduleQuickSync();
    }
  }

  const settingKeys = new Set([
    "clippingEnabled",
    "clipPreviewEnabled",
    "clipLocalMode",
    "selectiveDownloadsEnabled",
    "downloadConcurrency",
    "storageShowCameraOptions",
    "popoutToolbarPlacement",
    "mm_upload_settings",
    "currentSourceKey",
    "rsp_recent_sources_enabled",
    "rsp_recent_sources_placement",
    "rsp_recent_sources_list_v1",
    AUTO_SYNC_INTERVAL_SEC_KEY
  ]);

  function isLikelySettingKey(key) {
    if (typeof key !== "string" || !key) return false;
    if (!isSyncableKey(key)) return false;
    if (settingKeys.has(key)) return true;
    if (key.startsWith("rsp_")) return true;
    if (key.startsWith("mm_")) return true;
    return false;
  }

  function scheduleQuickSync() {
    const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
    if (!loggedIn) return;
    if (quickSyncTimerId) return;
    quickSyncTimerId = setTimeout(() => {
      quickSyncTimerId = null;
      syncNow({ forcePull: false }).catch(() => {});
    }, 1100);
  }

  function installLocalStorageHook() {
    if (window.__MM_ACCOUNT_SYNC_HOOKED) return;
    window.__MM_ACCOUNT_SYNC_HOOKED = true;

    const deviceId = getOrCreateDeviceId();
    const storageProto = Object.getPrototypeOf(localStorage);
    const target = storageProto && storageProto.setItem ? storageProto : localStorage;
    const originalSetItem = target.setItem.bind(localStorage);
    const originalRemoveItem = target.removeItem.bind(localStorage);
    const originalClear = target.clear ? target.clear.bind(localStorage) : localStorage.clear.bind(localStorage);

    const wrappedSetItem = function (key, value) {
      originalSetItem(key, value);
      if (suspendRecording) return;
      if (!isSyncableKey(key)) return;
      enqueueOp({
        type: "set",
        key,
        value: typeof value === "string" ? value : String(value),
        ts: Date.now(),
        deviceId
      });
    };

    const wrappedRemoveItem = function (key) {
      originalRemoveItem(key);
      if (suspendRecording) return;
      if (!isSyncableKey(key)) return;
      enqueueOp({
        type: "remove",
        key,
        ts: Date.now(),
        deviceId
      });
    };

    const wrappedClear = function () {
      originalClear();
      if (suspendRecording) return;
      enqueueOp({
        type: "clear",
        ts: Date.now(),
        deviceId
      });
    };

    try { target.setItem = wrappedSetItem; } catch {}
    try { target.removeItem = wrappedRemoveItem; } catch {}
    try { target.clear = wrappedClear; } catch {}
  }

  function buildInitialSnapshotOps(limit) {
    const deviceId = getOrCreateDeviceId();
    const ops = [];
    const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_OPS_PER_SYNC;
    const baseTs = Date.now();
    try {
      for (let i = 0; i < localStorage.length && ops.length < max; i += 1) {
        const key = localStorage.key(i);
        if (!isSyncableKey(key)) continue;
        const value = localStorage.getItem(key);
        if (value === null || typeof value === "undefined") continue;
        ops.push({
          type: "set",
          key,
          value: String(value),
          ts: baseTs + ops.length,
          deviceId
        });
      }
    } catch {}
    return ops;
  }

  function clearNonDevStorage() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (isDevOnlyKey(key)) continue;
        keys.push(key);
      }
    } catch {}

    try {
      suspendRecording = true;
      keys.forEach((key) => {
        try { localStorage.removeItem(key); } catch {}
      });
    } finally {
      suspendRecording = false;
    }
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return { changedKeys: [], removedKeys: [], cleared: false };
    const data = snapshot.data && typeof snapshot.data === "object" ? snapshot.data : {};
    const changedKeys = [];
    try {
      suspendRecording = true;
      Object.entries(data).forEach(([key, value]) => {
        if (!isSyncableKey(key)) return;
        try {
          const incoming = typeof value === "string" ? value : String(value);
          const existing = localStorage.getItem(key);
          if (!shouldSetByMerge(existing, incoming)) return;
          localStorage.setItem(key, incoming);
          changedKeys.push(key);
        } catch {}
      });
    } finally {
      suspendRecording = false;
    }
    return { changedKeys, removedKeys: [], cleared: false };
  }

  function applyChanges(changes) {
    if (!changes || typeof changes !== "object") return { changedKeys: [], removedKeys: [], cleared: false };
    const cleared = Boolean(changes.clearedAt && Number(changes.clearedAt) > 0);
    if (cleared) clearNonDevStorage();
    const remove = Array.isArray(changes.remove) ? changes.remove : [];
    const set = changes.set && typeof changes.set === "object" ? changes.set : {};
    const changedKeys = [];
    const removedKeys = [];

    try {
      suspendRecording = true;
      remove.forEach((key) => {
        if (!isSyncableKey(key)) return;
        try {
          localStorage.removeItem(key);
          removedKeys.push(key);
        } catch {}
      });
      Object.entries(set).forEach(([key, value]) => {
        if (!isSyncableKey(key)) return;
        try {
          const incoming = typeof value === "string" ? value : String(value);
          const existing = localStorage.getItem(key);
          if (!shouldSetByMerge(existing, incoming)) return;
          localStorage.setItem(key, incoming);
          changedKeys.push(key);
        } catch {}
      });
    } finally {
      suspendRecording = false;
    }
    return { changedKeys, removedKeys, cleared };
  }

  async function fetchJsonWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let json;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!response.ok) {
        const message = (json && json.error) ? String(json.error) : `Request failed (${response.status})`;
        throw new Error(message);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  function tryAcquireLock() {
    const now = Date.now();
    const raw = safeGet(LOCK_KEY);
    const parsed = Number(raw || 0);
    if (Number.isFinite(parsed) && parsed > now) return false;
    safeSet(LOCK_KEY, String(now + LOCK_TTL_MS));
    return true;
  }

  function releaseLock() {
    safeRemove(LOCK_KEY);
  }

  function setSince(value) {
    const num = Number(value) || 0;
    safeSet(SINCE_KEY, String(Math.max(0, Math.floor(num))));
  }

  function getSince() {
    const raw = safeGet(SINCE_KEY);
    const num = Number(raw) || 0;
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function setLastSyncAt(value) {
    const num = Number(value) || 0;
    safeSet(LAST_SYNC_AT_KEY, String(Math.max(0, Math.floor(num))));
  }

  function getLastSyncAt() {
    const raw = safeGet(LAST_SYNC_AT_KEY);
    const num = Number(raw) || 0;
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function formatTimestamp(value) {
    const ts = Number(value) || 0;
    if (!(ts > 0)) return "never";
    try { return new Date(ts).toLocaleString(); }
    catch { return String(ts); }
  }

  function getAutoSyncIntervalSeconds() {
    const raw = safeGet(AUTO_SYNC_INTERVAL_SEC_KEY);
    const parsed = Number.parseInt(String(raw || ""), 10);
    const base = Number.isFinite(parsed) ? parsed : 10;
    const clamped = Math.max(5, Math.min(3600, base));
    return clamped;
  }

  function setAutoSyncIntervalSeconds(value) {
    const parsed = Number.parseInt(String(value || ""), 10);
    const base = Number.isFinite(parsed) ? parsed : 10;
    const clamped = Math.max(5, Math.min(3600, base));
    safeSet(AUTO_SYNC_INTERVAL_SEC_KEY, String(clamped));
    return clamped;
  }

  function stopAutoSyncTimer() {
    if (!autoSyncTimerId) return;
    try { clearInterval(autoSyncTimerId); } catch {}
    autoSyncTimerId = null;
    autoSyncIntervalMs = 0;
  }

  function ensureAutoSyncTimer() {
    const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
    if (!loggedIn) {
      stopAutoSyncTimer();
      return;
    }
    const seconds = getAutoSyncIntervalSeconds();
    const nextMs = seconds * 1000;
    if (autoSyncTimerId && autoSyncIntervalMs === nextMs) return;
    stopAutoSyncTimer();
    autoSyncIntervalMs = nextMs;
    autoSyncTimerId = setInterval(() => {
      syncNow({ forcePull: true }).catch(() => {});
    }, nextMs);
  }

  async function registerAccount() {
    const url = getSyncUrl();
    const accountIdInput = document.getElementById("accountSyncAccountId");
    const requestedId = accountIdInput ? String(accountIdInput.value || "").trim() : "";
    const json = await fetchJsonWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", accountId: requestedId })
    }, REQUEST_TIMEOUT_MS);
    if (!json || json.ok !== true || !json.accountId) {
      throw new Error("Registration failed.");
    }
    safeSet(ACCOUNT_ID_KEY, String(json.accountId));
    setSince(0);
    setLastSyncAt(0);
    return { accountId: String(json.accountId) };
  }

  async function checkAccountExists() {
    const cfg = getAccountConfig();
    if (!cfg) return { ok: false, skipped: true };
    const url = `${getCheckUrl()}?accountId=${encodeURIComponent(cfg.accountId)}`;
    try {
      const json = await fetchJsonWithTimeout(url, { method: "GET" }, REQUEST_TIMEOUT_MS);
      return json && json.ok === true ? { ok: true, exists: json.exists !== false } : { ok: false, exists: false };
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      if (message.toLowerCase().includes("account not found")) return { ok: false, exists: false };
      return { ok: false, error: message };
    }
  }

  function clearSession() {
    safeRemove(ACCOUNT_ID_KEY);
    setSince(0);
    setLastSyncAt(0);
    queue = [];
    safeRemove(QUEUE_KEY);
  }

  async function syncNow(options = {}) {
    const cfg = getAccountConfig();
    if (!cfg) return { ok: false, skipped: true, reason: "not-configured" };
    if (!tryAcquireLock()) return { ok: false, skipped: true, reason: "locked" };

    try {
      const url = getSyncUrl();
      const deviceId = getOrCreateDeviceId();
      const q = loadQueue();
      let ops = q.slice(0, MAX_OPS_PER_SYNC);
      const since = getSince();
      const shouldPull = options.forcePull === true || (Date.now() - lastPullAttemptAt) > PULL_INTERVAL_MS || since === 0;
      const appliedChangedKeys = new Set();
      const appliedRemovedKeys = new Set();
      let appliedCleared = false;

      const recordApplied = (applied) => {
        if (!applied) return;
        if (applied.cleared) appliedCleared = true;
        if (Array.isArray(applied.changedKeys)) applied.changedKeys.forEach((key) => { appliedChangedKeys.add(key); });
        if (Array.isArray(applied.removedKeys)) applied.removedKeys.forEach((key) => { appliedRemovedKeys.add(key); });
      };

      const usingSyntheticOps = ops.length === 0 && since === 0;
      if (usingSyntheticOps) {
        ops = buildInitialSnapshotOps(MAX_OPS_PER_SYNC);
      }

      if (!ops.length && !shouldPull) {
        return { ok: true, skipped: true, reason: "idle" };
      }

      const postSync = async (payload) => {
        return fetchJsonWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, REQUEST_TIMEOUT_MS);
      };

      lastPullAttemptAt = Date.now();

      const json = await postSync({
        action: "sync",
        accountId: cfg.accountId,
        deviceId,
        since,
        ops,
        full: since === 0
      });

      if (!json || json.ok !== true) throw new Error("Sync failed.");
      if (json.full === true && json.snapshot) {
        recordApplied(applySnapshot(json.snapshot));
      } else if (json.full === false && json.changes) {
        recordApplied(applyChanges(json.changes));
      } else if (json.snapshot) {
        recordApplied(applySnapshot(json.snapshot));
      }

      if (Number.isFinite(json.lastUpdatedAt) && json.lastUpdatedAt > 0) {
        setSince(json.lastUpdatedAt);
      }
      setLastSyncAt(Date.now());

      if (ops.length) {
        if (!usingSyntheticOps) {
          q.splice(0, ops.length);
          safeSet(QUEUE_KEY, JSON.stringify(q));
        }
      }

      if (options.twoPhase === true) {
        const secondSince = getSince();
        const second = await postSync({
          action: "sync",
          accountId: cfg.accountId,
          deviceId,
          since: secondSince,
          ops: [],
          full: false
        });
        if (second && second.ok === true) {
          if (second.full === true && second.snapshot) {
            recordApplied(applySnapshot(second.snapshot));
          } else if (second.full === false && second.changes) {
            recordApplied(applyChanges(second.changes));
          }
          if (Number.isFinite(second.lastUpdatedAt) && second.lastUpdatedAt > 0) {
            setSince(second.lastUpdatedAt);
          }
          setLastSyncAt(Date.now());
        }
      }

      const applied = {
        cleared: appliedCleared,
        changedKeys: appliedCleared ? null : Array.from(appliedChangedKeys),
        removedKeys: appliedCleared ? null : Array.from(appliedRemovedKeys)
      };
      try { window.dispatchEvent(new CustomEvent("mm:storage-synced", { detail: { accountId: cfg.accountId, applied, result: json } })); } catch {}
      try { window.dispatchEvent(new CustomEvent("mm:account-sync-complete", { detail: json })); } catch {}
      return { ok: true, result: json };
    } finally {
      releaseLock();
    }
  }

  function ensureOverlay() {
    if (!window.OverlayFactory || typeof window.OverlayFactory.createAccountSyncOverlay !== "function") return null;
    const existing = document.getElementById("accountSyncOverlay");
    if (existing) return existing;
    return window.OverlayFactory.createAccountSyncOverlay();
  }

  function refreshOverlay() {
    const accountIdInput = document.getElementById("accountSyncAccountId");
    const statusEl = document.getElementById("accountSyncStatus");
    if (accountIdInput) accountIdInput.value = (safeGet(ACCOUNT_ID_KEY) || "").trim();

    if (statusEl) {
      const accountId = (safeGet(ACCOUNT_ID_KEY) || "").trim();
      const since = getSince();
      const lastSyncAt = getLastSyncAt();
      statusEl.textContent = accountId
        ? `Logged in as ${accountId} since ${formatTimestamp(since)}\nSync: ${formatTimestamp(lastSyncAt)}`
        : "";
    }

    const loginBtn = document.getElementById("accountSyncDisconnectBtn");
    if (loginBtn) {
      const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
      loginBtn.textContent = loggedIn ? "Logout" : "Login";
      loginBtn.classList.toggle("danger-button", loggedIn);
    }

    const syncBtn = document.getElementById("accountSyncNowBtn");
    if (syncBtn) {
      const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
      syncBtn.style.display = loggedIn ? "" : "none";
    }

    const intervalInput = document.getElementById("accountSyncIntervalSec");
    if (intervalInput) {
      const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
      intervalInput.style.display = loggedIn ? "" : "none";
      intervalInput.value = String(getAutoSyncIntervalSeconds());
      intervalInput.disabled = false;
    }

    ensureAutoSyncTimer();
  }

  function setStatusLine(message) {
    const statusEl = document.getElementById("accountSyncStatus");
    if (!statusEl) return;
    statusEl.textContent = String(message || "");
  }

  function setBusy(busy) {
    const loginBtn = document.getElementById("accountSyncDisconnectBtn");
    const syncBtn = document.getElementById("accountSyncNowBtn");
    const accountIdInput = document.getElementById("accountSyncAccountId");
    const isBusy = busy === true;
    if (loginBtn) loginBtn.disabled = isBusy;
    if (syncBtn) syncBtn.disabled = isBusy;
    if (accountIdInput) accountIdInput.disabled = isBusy;
  }

  function openOverlay() {
    const overlay = ensureOverlay();
    if (!overlay) return;
    overlay.style.display = "flex";
    refreshOverlay();
  }

  function closeOverlay() {
    const overlay = document.getElementById("accountSyncOverlay");
    if (!overlay) return;
    overlay.style.display = "none";
  }

  function wireOverlay() {
    const overlay = ensureOverlay();
    if (!overlay || overlay.dataset.bound) return;
    overlay.dataset.bound = "1";

    const closeBtn = document.getElementById("accountSyncCloseBtn");
    const warningBtn = document.getElementById("accountSyncWarningBtn");
    const syncBtn = document.getElementById("accountSyncNowBtn");
    const disconnectBtn = document.getElementById("accountSyncDisconnectBtn");
    const accountIdInput = document.getElementById("accountSyncAccountId");
    const intervalInput = document.getElementById("accountSyncIntervalSec");

    if (closeBtn) closeBtn.addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOverlay();
    });

    if (warningBtn && !warningBtn.dataset.bound) {
      warningBtn.addEventListener("click", () => {
        showNotice({
          title: "LET ME BE VERY CLEAR",
          messageHtml: "THIS IS <strong>NOT</strong> SECURE<br><br>THERE IS NO PASSWORD<br><br>THIS IS NOT ENCRYPTED<br><br>DO WITH THAT WHAT YOU MUST",
          tone: "error",
          autoCloseMs: null
        });
      });
      warningBtn.dataset.bound = "1";
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", () => {
        const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
        if (loggedIn) {
          clearSession();
          refreshOverlay();
          showNotice({
            title: "Account",
            message: "Logged out.",
            tone: "info"
          });
          return;
        }

        const accountId = accountIdInput ? String(accountIdInput.value || "").trim() : "";
        if (!accountId) {
          showNotice({
            title: "Account",
            message: "Enter an Account ID to log in.",
            tone: "warning"
          });
          return;
        }

        safeSet(ACCOUNT_ID_KEY, accountId);
        setSince(0);
        setLastSyncAt(0);
        refreshOverlay();

        setBusy(true);
        setStatusLine("Logging in…");
        syncNow({ forcePull: true }).then(() => {
          setBusy(false);
          refreshOverlay();
          showNotice({
            title: "Account",
            message: `Logged in as ${accountId}.`,
            tone: "success",
            autoCloseMs: 2500
          });
        }).catch((err) => {
          setBusy(false);
          const message = err && err.message ? String(err.message) : String(err);
          if (message.toLowerCase().includes("account not found")) {
            showNotice({
              title: "Account not found",
              message: `No account exists for "${accountId}". Create it now?`,
              tone: "warning",
              autoCloseMs: null,
              dismissLabel: null,
              actions: [
                {
                  label: "Create account",
                  className: "storage-notice__btn--primary",
                  closeOnClick: true,
                  onClick: async () => {
                    setBusy(true);
                    setStatusLine("Creating account…");
                    await registerAccount();
                    setStatusLine("Syncing…");
                    await syncNow({ forcePull: true });
                    setBusy(false);
                    refreshOverlay();
                    showNotice({
                      title: "Account",
                      message: `Account created: ${accountId}`,
                      tone: "success",
                      autoCloseMs: 3000
                    });
                  }
                },
                {
                  label: "Cancel",
                  className: "storage-notice__btn--secondary",
                  closeOnClick: true,
                  onClick: () => {
                    clearSession();
                    refreshOverlay();
                  }
                }
              ]
            });
            return;
          }

          showNotice({
            title: "Login failed",
            message,
            tone: "error"
          });
          clearSession();
          refreshOverlay();
        });
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        try {
          if (syncBtn) syncBtn.disabled = true;
          const accountIdInput = document.getElementById("accountSyncAccountId");
          const accountId = accountIdInput ? String(accountIdInput.value || "").trim() : "";
          if (!accountId) {
            showNotice({
              title: "Account",
              message: "Enter an Account ID first.",
              tone: "warning"
            });
            return;
          }
          const previous = (safeGet(ACCOUNT_ID_KEY) || "").trim();
          if (accountId !== previous) {
            safeSet(ACCOUNT_ID_KEY, accountId);
            setSince(0);
            setLastSyncAt(0);
            queue = [];
            safeRemove(QUEUE_KEY);
          }
          refreshOverlay();

          setBusy(true);
          setStatusLine("Syncing…");
          await syncNow({ forcePull: true, twoPhase: true });
          setBusy(false);
          refreshOverlay();
          showNotice({
            title: "Account",
            message: "Sync complete.",
            tone: "success"
          });
        } catch (err) {
          setBusy(false);
          showNotice({
            title: "Sync failed",
            message: err && err.message ? err.message : String(err),
            tone: "error"
          });
        } finally {
          if (syncBtn) syncBtn.disabled = false;
        }
      });
    }

    if (intervalInput && !intervalInput.dataset.bound) {
      const commit = () => {
        const next = setAutoSyncIntervalSeconds(intervalInput.value);
        intervalInput.value = String(next);
        ensureAutoSyncTimer();
      };
      intervalInput.addEventListener("change", commit);
      intervalInput.addEventListener("blur", commit);
      intervalInput.dataset.bound = "1";
    }

    if (accountIdInput && !accountIdInput.dataset.boundEnter) {
      accountIdInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
        if (!loggedIn) {
          if (disconnectBtn) disconnectBtn.click();
        } else {
          if (syncBtn) syncBtn.click();
        }
      });
      accountIdInput.dataset.boundEnter = "1";
    }
  }

  function start() {
    installLocalStorageHook();
    wireOverlay();
    const loggedIn = Boolean((safeGet(ACCOUNT_ID_KEY) || "").trim());
    if (loggedIn) {
      checkAccountExists().then((res) => {
        if (res && res.ok === false && res.exists === false) {
          clearSession();
          refreshOverlay();
          return;
        }
        syncNow({ forcePull: true }).catch(() => {});
      }).catch(() => {
        syncNow({ forcePull: true }).catch(() => {});
      });
    }
    ensureAutoSyncTimer();
  }

  window.MMAccountSync = {
    openOverlay,
    closeOverlay,
    syncNow,
    registerAccount,
    getSyncUrl,
    getBackendRoot
  };

  window.addEventListener("mm:account-sync-url-changed", () => {
    refreshOverlay();
  });

  window.addEventListener("mm:backend-root-changed", () => {
    refreshOverlay();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
