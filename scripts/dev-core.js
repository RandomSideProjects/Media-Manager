"use strict";

(function () {
  if (typeof window === "undefined") return;

  const DEV_MODE_LS_KEY = "rsp_dev_mode";
  const SHORTCUT_KEYS = new Set(["o", "p"]);
  const shortcutSequence = [];
  const listeners = new Set();

  const devState = {
    flag: readStoredDevMode()
  };

  function readStoredDevMode() {
    try {
      return localStorage.getItem(DEV_MODE_LS_KEY) === "true";
    } catch {
      return false;
    }
  }

  function persistDevMode(value) {
    try {
      if (value) localStorage.setItem(DEV_MODE_LS_KEY, "true");
      else localStorage.removeItem(DEV_MODE_LS_KEY);
    } catch {}
  }

  function notifyActivation() {
    const payload = {
      title: "Developer Mode",
      message: "Developer mode is now active.",
      tone: "success",
      autoCloseMs: 5000
    };
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      window.mmNotices.show(payload);
      return;
    }
    if (typeof window.showStorageNotice === "function") {
      window.showStorageNotice(payload);
      return;
    }
    if (typeof window.alert === "function") {
      try { window.alert(payload.message); }
      catch {}
    }
  }

  function notifyDeactivation() {
    const payload = {
      title: "Developer Mode",
      message: "Developer mode has been turned off.",
      tone: "error",
      autoCloseMs: 4000
    };
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      window.mmNotices.show(payload);
      return;
    }
    if (typeof window.showStorageNotice === "function") {
      window.showStorageNotice(payload);
      return;
    }
    if (typeof window.alert === "function") {
      try { window.alert(payload.message); }
      catch {}
    }
  }

  function emitChange(meta) {
    const detail = { enabled: devState.flag };
    if (meta && typeof meta === "object") detail.meta = meta;
    listeners.forEach((fn) => {
      try { fn(devState.flag, detail); }
      catch (err) { console.error("[RSPDev] listener failed", err); }
    });
    try {
      window.dispatchEvent(new CustomEvent("rsp:dev-mode-changed", { detail }));
    } catch {}
  }

  function updateDevMode(next, meta, options) {
    const desired = next === true;
    const changed = desired !== devState.flag;
    devState.flag = desired;
    const shouldPersist = !options || options.persist !== false;
    if (shouldPersist) persistDevMode(desired);
    if (changed) {
      emitChange(meta);
      if (desired) notifyActivation();
      else notifyDeactivation();
    }
    return desired;
  }

  function defineDevModeProperty() {
    const existing = Object.getOwnPropertyDescriptor(window, "DevMode");
    if (existing && !existing.configurable) {
      try {
        devState.flag = existing.get
          ? existing.get.call(window) === true
          : existing.value === true;
      } catch {
        devState.flag = false;
      }
      return;
    }
    Object.defineProperty(window, "DevMode", {
      configurable: true,
      enumerable: true,
      get() { return devState.flag; },
      set(value) {
        updateDevMode(value === true, { source: "property-set" });
      }
    });
  }

  function handleShortcutToggle() {
    updateDevMode(!devState.flag, { source: "shortcut" });
  }

  function resetShortcutSequence() {
    shortcutSequence.length = 0;
  }

  function wireShortcut() {
    window.addEventListener("keydown", (event) => {
      if (!event || event.repeat) return;
      const key = (event.key || "").toLowerCase();
      if (!SHORTCUT_KEYS.has(key)) {
        resetShortcutSequence();
        return;
      }
      if (shortcutSequence.length && shortcutSequence[shortcutSequence.length - 1] === key) {
        return;
      }
      shortcutSequence.push(key);
      if (shortcutSequence.length > SHORTCUT_KEYS.size) shortcutSequence.shift();
      const unique = new Set(shortcutSequence);
      if (unique.size === SHORTCUT_KEYS.size && shortcutSequence.length === SHORTCUT_KEYS.size) {
        handleShortcutToggle();
        resetShortcutSequence();
      }
    });
    window.addEventListener("blur", resetShortcutSequence);
  }

  function createApi() {
    const api = window.RSPDev || {};
    api.isEnabled = () => devState.flag === true;
    api.setEnabled = (value, meta, options) => updateDevMode(value === true, meta || { source: "api" }, options);
    api.toggle = (meta, options) => updateDevMode(!devState.flag, meta || { source: "api-toggle" }, options);
    api.subscribe = (fn) => {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    api.getStoredFlag = () => devState.flag;
    api.notifyActivation = notifyActivation;
    window.RSPDev = api;
  }

  defineDevModeProperty();
  createApi();
  wireShortcut();
  window.addEventListener("storage", (event) => {
    if (!event || event.storageArea !== localStorage) return;
    if (event.key !== DEV_MODE_LS_KEY) return;
    const next = event.newValue === "true";
    updateDevMode(next, { source: "storage-event" }, { persist: false });
  });
})();
