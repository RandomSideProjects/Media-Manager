"use strict";

// Variables (top)
// none

const SERVER_DEFAULT_PAHE_ANIME_API_BASE = "https://anime.apex-cloud.workers.dev";
let lastPaheStatusLine = "pending";

function getUploadServerApi() {
  return (typeof window !== "undefined" && window.MMUploadServer) ? window.MMUploadServer : null;
}

function readCreatorSettings() {
  const api = getUploadServerApi();
  if (api && typeof api.readRawSettings === "function") {
    return api.readRawSettings();
  }
  try {
    const raw = localStorage.getItem("mm_upload_settings");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readPaheEnabled() {
  try {
    const parsed = readCreatorSettings();
    return parsed && parsed.paheImportEnabled === true;
  } catch {
    return false;
  }
}

function readPaheApiBase() {
  try {
    const parsed = readCreatorSettings();
    const candidate = parsed && typeof parsed.paheAnimeApiBase === "string" ? parsed.paheAnimeApiBase.trim() : "";
    return (candidate || SERVER_DEFAULT_PAHE_ANIME_API_BASE).replace(/\/+$/, "");
  } catch {
    return SERVER_DEFAULT_PAHE_ANIME_API_BASE;
  }
}

function getPaheStatusLine() {
  if (!readPaheEnabled()) return "disabled";
  if (!lastPaheStatusLine || lastPaheStatusLine === "disabled") return "pending";
  return lastPaheStatusLine || "pending";
}

function getStatusBoxText() {
  const api = getUploadServerApi();
  const state = api && typeof api.getState === "function" ? api.getState() : null;
  const label = state && state.summary ? state.summary : "Auto using direct Catbox";
  return `Pahe API: ${getPaheStatusLine()}\nCatbox uploads via: ${label}`;
}

function refreshStatusBox(statusBox) {
  if (!statusBox) return;
  statusBox.textContent = getStatusBoxText();
  statusBox.style.display = "block";
  statusBox.title = "Click to override upload server";
  statusBox.setAttribute("role", "button");
  statusBox.setAttribute("tabindex", "0");
}

function ensureUploadServerOverrideOverlay() {
  let overlay = document.getElementById("uploadServerOverrideOverlay");
  if (!overlay && window.OverlayFactory && typeof window.OverlayFactory.createUploadServerOverrideOverlay === "function") {
    overlay = window.OverlayFactory.createUploadServerOverrideOverlay();
  }
  return overlay;
}

function closeUploadServerOverrideOverlay() {
  const overlay = document.getElementById("uploadServerOverrideOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("upload-server-override-open");
}

function openUploadServerOverrideOverlay(statusBox) {
  const overlay = ensureUploadServerOverrideOverlay();
  const api = getUploadServerApi();
  if (!overlay || !api || typeof api.getState !== "function") return;

  const state = api.getState();
  const currentLabel = document.getElementById("uploadServerOverrideCurrent");
  const auto = document.getElementById("uploadServerModeAuto");
  const direct = document.getElementById("uploadServerModeDirect");
  const proxy = document.getElementById("uploadServerModeProxy");
  const copyparty = document.getElementById("uploadServerModeCopyparty");
  const copypartyRow = document.getElementById("uploadServerModeCopypartyRow");
  const saveBtn = document.getElementById("uploadServerOverrideSave");
  const closeBtn = document.getElementById("uploadServerOverrideClose");

  if (currentLabel) {
    currentLabel.textContent = `Current: ${state.summary}`;
  }
  if (auto) auto.checked = state.mode === "auto";
  if (direct) direct.checked = state.mode === "direct";
  if (proxy) proxy.checked = state.mode === "proxy";
  if (copyparty) copyparty.checked = state.mode === "copyparty";
  if (copypartyRow) copypartyRow.style.display = state.copypartyUrl ? "" : "none";
  if (copyparty) copyparty.disabled = !state.copypartyUrl;

  if (!overlay.dataset.bound) {
    overlay.dataset.bound = "true";

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeUploadServerOverrideOverlay();
      }
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeUploadServerOverrideOverlay();
      }
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", closeUploadServerOverrideOverlay);
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const selected = overlay.querySelector('input[name="uploadServerOverrideMode"]:checked');
        const nextMode = selected ? String(selected.value || "auto") : "auto";
        if (typeof api.setMode === "function") {
          api.setMode(nextMode);
        }
        if (nextMode === "auto" && typeof api.ensure === "function") {
          try { await api.ensure({ force: true }); } catch {}
        }
        refreshStatusBox(statusBox);
        closeUploadServerOverrideOverlay();
      });
    }
  }

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("upload-server-override-open");
  try { overlay.focus(); } catch {}
}

async function probePaheSearchApi() {
  const base = readPaheApiBase();
  const url = `${base}/?method=search&query=naruto`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res && res.ok) {
      return { ok: true, status: res.status, statusText: res.statusText || "OK" };
    }
    return { ok: false, status: res ? res.status : 0, statusText: res ? (res.statusText || "Error") : "Network error" };
  } catch (err) {
    return { ok: false, status: 0, statusText: (err && err.message) ? err.message : "Network error" };
  }
}

async function checkHostAndLoadCreator() {
  let statusBox = document.getElementById("serverStatusBox");
  if (!statusBox) {
    statusBox = document.createElement("div");
    statusBox.id = "serverStatusBox";
    document.body.appendChild(statusBox);
  }

  const paheEnabled = readPaheEnabled();
  if (paheEnabled) {
    const paheProbe = await probePaheSearchApi();
    const ok = !!(paheProbe && paheProbe.ok);
    if (paheProbe && paheProbe.ok) {
      lastPaheStatusLine = `${paheProbe.status} ${paheProbe.statusText}`.trim();
    } else if (paheProbe) {
      lastPaheStatusLine = `${paheProbe.status || "ERR"} ${paheProbe.statusText || "Error"}`.trim();
    } else {
      lastPaheStatusLine = "ERR";
    }
    try {
      window.MM_PAHE_API_OK = ok;
      window.dispatchEvent(new CustomEvent("mm:pahe-api-status", { detail: { ok, line: lastPaheStatusLine } }));
    } catch {}
  } else {
    lastPaheStatusLine = "disabled";
    try {
      window.MM_PAHE_API_OK = false;
      window.dispatchEvent(new CustomEvent("mm:pahe-api-status", { detail: { ok: false, line: "disabled" } }));
    } catch {}
  }

  const api = getUploadServerApi();
  if (api && typeof api.applyRuntime === "function") {
    api.applyRuntime({ source: "creator-startup" });
  }

  refreshStatusBox(statusBox);
  if (api && typeof api.ensure === "function") {
    api.ensure().then(() => {
      refreshStatusBox(statusBox);
    }).catch(() => {
      refreshStatusBox(statusBox);
    });
  }

  if (!statusBox.dataset.bound) {
    statusBox.dataset.bound = "true";
    statusBox.addEventListener("click", () => openUploadServerOverrideOverlay(statusBox));
    statusBox.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openUploadServerOverrideOverlay(statusBox);
      }
    });
  }

  window.addEventListener("mm_settings_saved", () => {
    refreshStatusBox(statusBox);
    const latest = getUploadServerApi();
    const state = latest && typeof latest.getState === "function" ? latest.getState() : null;
    if (latest && typeof latest.ensure === "function" && state && state.mode === "auto" && state.detection && state.detection.status === "idle") {
      latest.ensure().then(() => refreshStatusBox(statusBox)).catch(() => refreshStatusBox(statusBox));
    }
  });

  window.addEventListener("mm:upload-server-state", () => {
    refreshStatusBox(statusBox);
  });

  try {
    window.MM_BLOCKED = false;
    if (typeof startAutoUploadPolling === "function") {
      startAutoUploadPolling();
    }
  } catch (err) {
    console.warn("[Creator] Failed to enable auto-upload polling", err);
  }
}

checkHostAndLoadCreator();
