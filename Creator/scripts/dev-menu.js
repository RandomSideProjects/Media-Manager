"use strict";

(function () {
  if (typeof window === "undefined") return;

  const overlay = document.getElementById("devMenuOverlay");
  const panel = document.getElementById("devMenuPanel");
  const openBtn = document.getElementById("devMenuBtn");
  const closeBtn = document.getElementById("devMenuCloseBtn");
  const actionGrid = document.getElementById("devActionGrid");
  const diagnosticsRefreshBtn = document.getElementById("devDiagnosticsRefreshBtn");
  const modeStateLabel = document.getElementById("devModeStateLabel");
  const uploadConcurrencyStateLabel = document.getElementById("devUploadConcurrencyStateLabel");
  const catboxStateLabel = document.getElementById("devCatboxEndpointLabel");
  const devMenuRow = document.getElementById("devMenuRow");
  const devMenuStatus = document.getElementById("devMenuStatus");
  const uploadConcurrencyInput = document.getElementById("devUploadConcurrencyInput");
  const uploadConcurrencyResetBtn = document.getElementById("devUploadConcurrencyResetBtn");
  const hiddenSuffixToggle = document.getElementById("devHiddenSourceToggle");

  const OVERLAY_OPEN_CLASS = "is-open";
  const DEFAULT_CONCURRENCY = 2;

  const uploadSettingsPanel = document.getElementById("mmUploadSettingsPanel");

  if (!overlay || !panel || !openBtn) return;

  const isDevModeEnabled = () => {
    if (window.RSPDev && typeof window.RSPDev.isEnabled === "function") {
      try { return window.RSPDev.isEnabled() === true; }
      catch {}
    }
    return window.DevMode === true;
  };

  function showNotice(tone, message) {
    const payload = { title: "Creator Dev Menu", message: String(message || ""), tone: tone || "info", autoCloseMs: 4000 };
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      window.mmNotices.show(payload);
    } else if (typeof window.showStorageNotice === "function") {
      window.showStorageNotice(payload);
    } else if (typeof window.alert === "function" && payload.message) {
      try { window.alert(`${payload.title}: ${payload.message}`); } catch {}
    }
  }

  function updateDevMenuRowVisibility() {
    const enabled = isDevModeEnabled();
    if (devMenuRow) devMenuRow.style.display = enabled ? "" : "none";
    if (devMenuStatus) {
      devMenuStatus.textContent = enabled
        ? "Developer tools"
        : "Enable Dev Mode (O + P)";
    }
  }

  function getStoredUploadConcurrency() {
    const raw = localStorage.getItem("mm_upload_concurrency");
    const parsed = parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
    return DEFAULT_CONCURRENCY;
  }

  function applyUploadConcurrency(value) {
    const next = Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_CONCURRENCY;
    try { localStorage.setItem("mm_upload_concurrency", String(next)); }
    catch {}
    if (typeof mm_uploadSettings !== "undefined" && typeof mm_uploadSettings.save === "function") {
      try {
        const current = loadUploadSettings();
        current.uploadConcurrency = next;
        saveUploadSettings(current);
      } catch (err) {
        console.warn("[CreatorDevMenu] Failed to persist upload concurrency through settings", err);
      }
    }
    updateUploadConcurrencyDisplay(next);
    return next;
  }

  function updateUploadConcurrencyDisplay(value) {
    if (typeof document === "undefined") return;
    if (uploadConcurrencyStateLabel) {
      uploadConcurrencyStateLabel.textContent = `${value}`;
    }
    const range = document.getElementById("mmUploadConcurrencyRange");
    const label = document.getElementById("mmUploadConcurrencyValue");
    if (range) range.value = String(value);
    if (label) label.textContent = String(value);
  }

  function getCatboxSummary() {
    try {
      if (window.MM_catbox && typeof window.MM_catbox.getLastResult === "function") {
        const last = window.MM_catbox.getLastResult();
        if (last && typeof last === "object") {
          const endpoint = last.endpoint ? String(last.endpoint) : "unknown";
          const active = (typeof last.active === "string" && last.active.trim())
            ? last.active.trim()
            : (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string"
              ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
              : "");
          return active ? `${endpoint} · ${active}` : endpoint;
        }
      }
      const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string"
        ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
        : "";
      return active || "Pending detection";
    } catch {
      return "Unavailable";
    }
  }

  async function runCatboxDetection() {
    if (!window.MM_catbox || typeof window.MM_catbox.ensure !== "function") {
      showNotice("warning", "Catbox helper not ready.");
      return;
    }
    if (catboxStateLabel) catboxStateLabel.textContent = "Detecting…";
    try {
      await window.MM_catbox.ensure();
      refreshDiagnostics();
      showNotice("success", "Catbox detection complete.");
    } catch (err) {
      console.error("[CreatorDevMenu] Catbox detection failed", err);
      showNotice("error", err && err.message ? err.message : "Catbox detection failed.");
      refreshDiagnostics();
    }
  }

  function openUploadSettings() {
    const btn = document.getElementById("mmUploadSettingsBtn");
    if (btn) {
      closeOverlay(false);
      btn.click();
    } else {
      showNotice("warning", "Upload settings button not found.");
    }
  }

  function sendTestJson() {
    if (typeof window.mm_sendTestJson !== "function") {
      showNotice("warning", "Test JSON helper unavailable.");
      return;
    }
    closeOverlay(false);
    (async () => {
      try {
        const url = await window.mm_sendTestJson();
        const msg = url ? `Test payload uploaded: ${url}` : "Test payload uploaded.";
        showNotice("success", msg);
      } catch (err) {
        console.error("[CreatorDevMenu] Test JSON failed", err);
        showNotice("error", err && err.message ? err.message : "Test upload failed.");
      }
    })();
  }

  function handleAction(action) {
    switch (action) {
      case "notice:info":
        showNotice("info", "Sample info notice triggered via Developer Menu.");
        break;
      case "notice:error":
        showNotice("error", "Sample error notice triggered via Developer Menu.");
        break;
      case "catbox:detect":
        runCatboxDetection();
        break;
      case "creator:open-settings":
        openUploadSettings();
        break;
      case "creator:test-json":
        sendTestJson();
        break;
      default:
        showNotice("warning", `No handler for action "${action}".`);
        break;
    }
  }

  function openOverlay() {
    if (!isDevModeEnabled()) {
      showNotice("warning", "Enable Dev Mode first (press O + P) to open this menu.");
      return;
    }
    if (uploadSettingsPanel && uploadSettingsPanel.style.display !== "none") {
      uploadSettingsPanel.style.display = "none";
    }
    overlay.classList.add(OVERLAY_OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("dev-menu-open");
    refreshDiagnostics();
    setTimeout(() => {
      try { panel.focus(); } catch {}
    }, 30);
  }

  function closeOverlay(returnFocus = true) {
    if (!overlay.classList.contains(OVERLAY_OPEN_CLASS)) return;
    overlay.classList.remove(OVERLAY_OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dev-menu-open");
    if (returnFocus && openBtn) {
      setTimeout(() => {
        try { openBtn.focus(); } catch {}
      }, 30);
    }
  }

  function handleOverlayKeydown(event) {
    if (!overlay.classList.contains(OVERLAY_OPEN_CLASS)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = overlay.querySelectorAll(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    if (!focusable.length) return;
    const focusables = Array.from(focusable).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !overlay.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function refreshHiddenSuffixToggle() {
    if (!hiddenSuffixToggle) return;
    const helper = window.mmHiddenSourceNaming;
    const enabled = helper && typeof helper.isEnabled === "function"
      ? helper.isEnabled()
      : (function fallback() {
          try { return localStorage.getItem("mm_creator_hidden_suffix") === "1"; }
          catch { return false; }
        })();
    hiddenSuffixToggle.checked = enabled;
  }

  function refreshDiagnostics() {
    const enabled = isDevModeEnabled();
    if (modeStateLabel) modeStateLabel.textContent = enabled ? "On" : "Off";
    if (catboxStateLabel) catboxStateLabel.textContent = getCatboxSummary();
    const currentUploadConc = getStoredUploadConcurrency();
    updateUploadConcurrencyDisplay(currentUploadConc);
    if (uploadConcurrencyInput) uploadConcurrencyInput.value = String(currentUploadConc);
    refreshHiddenSuffixToggle();
  }

  updateDevMenuRowVisibility();

  if (openBtn) openBtn.addEventListener("click", () => openOverlay());
  if (closeBtn) closeBtn.addEventListener("click", () => closeOverlay());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOverlay();
  });
  document.addEventListener("keydown", handleOverlayKeydown);

  if (actionGrid) {
    actionGrid.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || target.tagName !== "BUTTON") return;
      const action = target.getAttribute("data-dev-action");
      if (!action) return;
      event.preventDefault();
      handleAction(action);
    });
  }

  if (uploadConcurrencyInput) {
    const commitUpload = () => {
      const value = Number(uploadConcurrencyInput.value);
      const applied = applyUploadConcurrency(value);
      uploadConcurrencyInput.value = String(applied);
    };
    uploadConcurrencyInput.addEventListener("change", commitUpload);
    uploadConcurrencyInput.addEventListener("blur", commitUpload);
  }

  if (uploadConcurrencyResetBtn) {
    uploadConcurrencyResetBtn.addEventListener("click", () => {
      const applied = applyUploadConcurrency(DEFAULT_CONCURRENCY);
      if (uploadConcurrencyInput) uploadConcurrencyInput.value = String(applied);
      showNotice("info", "Upload concurrency reset to default.");
    });
  }

  if (diagnosticsRefreshBtn) {
    diagnosticsRefreshBtn.addEventListener("click", () => {
      refreshDiagnostics();
      showNotice("info", "Diagnostics refreshed.");
    });
  }

  if (hiddenSuffixToggle) {
    hiddenSuffixToggle.addEventListener("change", () => {
      const desired = hiddenSuffixToggle.checked;
      const helper = window.mmHiddenSourceNaming;
      if (helper && typeof helper.setEnabled === "function") {
        helper.setEnabled(desired);
      } else {
        try {
          if (desired) localStorage.setItem("mm_creator_hidden_suffix", "1");
          else localStorage.removeItem("mm_creator_hidden_suffix");
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent("creator:hidden-suffix-updated", { detail: { enabled: desired } }));
        } catch {}
      }
    });
  }

  window.addEventListener("rsp:dev-mode-changed", (event) => {
    const enabled = event && event.detail && event.detail.enabled === true;
    if (!enabled) closeOverlay(false);
    updateDevMenuRowVisibility();
    refreshDiagnostics();
  });

  window.addEventListener("rsp:catbox-default-updated", () => {
    refreshDiagnostics();
  });

  window.addEventListener("creator:hidden-suffix-updated", (event) => {
    if (!hiddenSuffixToggle) return;
    const enabled = !!(event && event.detail && event.detail.enabled === true);
    if (hiddenSuffixToggle.checked !== enabled) {
      hiddenSuffixToggle.checked = enabled;
    }
  });

  refreshDiagnostics();
})();
