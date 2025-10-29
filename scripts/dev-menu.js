"use strict";

(function () {
  if (typeof window === "undefined") return;

  let overlay = null;
  let panel = null;
  let openBtn = null;
  let closeBtn = null;
  let modeToggle = null;
  let concurrencyInput = null;
  let concurrencyResetBtn = null;
  let actionGrid = null;
  let diagnosticsRefreshBtn = null;
  let modeStateLabel = null;
  let concurrencyStateLabel = null;
  let catboxStateLabel = null;
  let sourceKeyLabel = null;
  let menuRow = null;
  let menuStatus = null;

  function queryElements() {
    overlay = document.getElementById("devMenuOverlay");
    panel = document.getElementById("devMenuPanel");
    openBtn = document.getElementById("devMenuBtn");
    closeBtn = document.getElementById("devMenuCloseBtn");
    modeToggle = document.getElementById("devModeToggle");
    concurrencyInput = document.getElementById("devConcurrencyInput");
    concurrencyResetBtn = document.getElementById("devConcurrencyResetBtn");
    actionGrid = document.getElementById("devActionGrid");
    diagnosticsRefreshBtn = document.getElementById("devDiagnosticsRefreshBtn");
    modeStateLabel = document.getElementById("devModeStateLabel");
    concurrencyStateLabel = document.getElementById("devConcurrencyStateLabel");
    catboxStateLabel = document.getElementById("devCatboxEndpointLabel");
    sourceKeyLabel = document.getElementById("devSourceKeyLabel");
    menuRow = document.getElementById("devMenuRow");
    menuStatus = document.getElementById("devMenuStatus");
  }

  const DEFAULT_CONCURRENCY = 2;
  const OVERLAY_OPEN_CLASS = "is-open";
  const STORAGE_MENU_DELAY_MS = 90;

  function isDevModeEnabled() {
    if (typeof window === "undefined") return false;
    if (window.RSPDev && typeof window.RSPDev.isEnabled === "function") {
      try { return window.RSPDev.isEnabled() === true; }
      catch {}
    }
    return window.DevMode === true;
  }

  function getStoredConcurrency() {
    const raw = localStorage.getItem("downloadConcurrency");
    const parsed = parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
    return DEFAULT_CONCURRENCY;
  }

  function applyConcurrency(value) {
    const numeric = Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_CONCURRENCY;
    try { localStorage.setItem("downloadConcurrency", String(numeric)); }
    catch {}
    if (typeof applyDownloadConcurrencyUI === "function") {
      try { applyDownloadConcurrencyUI(); }
      catch {}
    } else {
      if (typeof updateConcurrencyDisplay === "function") {
        try { updateConcurrencyDisplay(numeric); }
        catch {}
      } else if (typeof downloadConcurrencyRange !== "undefined" && downloadConcurrencyRange) {
        downloadConcurrencyRange.value = String(numeric);
      }
    }
    refreshDiagnostics();
    return numeric;
  }

  function describeConcurrency(value) {
    const stored = Math.max(1, Math.floor(Number(value) || DEFAULT_CONCURRENCY));
    let effective = stored;
    if (typeof clampConcurrency === "function") {
      try { effective = clampConcurrency(stored); }
      catch { effective = stored; }
    }
    return effective !== stored ? `${stored} (clamped to ${effective})` : String(stored);
  }

  function getCatboxSummary() {
    try {
      if (window.MM_catbox && typeof window.MM_catbox.getLastResult === "function") {
        const last = window.MM_catbox.getLastResult();
        if (last && typeof last === "object") {
          const endpoint = last.endpoint ? String(last.endpoint) : "unknown";
          const active = (typeof last.active === "string" && last.active.trim())
            ? last.active.trim()
            : (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string" ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : "");
          const parts = [`${endpoint}`];
          if (active) parts.push(active);
          return parts.join(" · ");
        }
      }
      const active = typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string" ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim() : "";
      return active || "Pending detection";
    } catch {
      return "Unavailable";
    }
  }

  function updateModeToggle() {
    if (!modeToggle) return;
    const enabled = isDevModeEnabled();
    modeToggle.checked = enabled;
    modeToggle.setAttribute("aria-checked", enabled ? "true" : "false");
    modeToggle.disabled = false;
  }

  function refreshConcurrencyInput() {
    if (!concurrencyInput) return;
    concurrencyInput.value = String(getStoredConcurrency());
    concurrencyInput.disabled = !isDevModeEnabled();
    if (concurrencyResetBtn) concurrencyResetBtn.disabled = !isDevModeEnabled();
  }

  function refreshDiagnostics() {
    const enabled = isDevModeEnabled();
    if (modeStateLabel) modeStateLabel.textContent = enabled ? "On" : "Off";
    if (concurrencyStateLabel) concurrencyStateLabel.textContent = describeConcurrency(getStoredConcurrency());
    if (catboxStateLabel) catboxStateLabel.textContent = getCatboxSummary();
    if (sourceKeyLabel) {
      const key = (typeof sourceKey === "string" && sourceKey) ? sourceKey
        : (Array.isArray(sourceKeyHistory) && sourceKeyHistory.length ? sourceKeyHistory[0] : "");
      sourceKeyLabel.textContent = key || "Not set";
    }
  }

  function refreshAll() {
    updateModeToggle();
    refreshConcurrencyInput();
    refreshDiagnostics();
    updateDevMenuAvailability();
  }

  function updateDevMenuAvailability() {
    if (!menuRow && !openBtn) queryElements();
    const enabled = isDevModeEnabled();
    if (menuRow) {
      menuRow.style.display = enabled ? "" : "none";
    } else if (openBtn) {
      openBtn.style.display = enabled ? "" : "none";
    }
    if (menuStatus) {
      menuStatus.textContent = enabled ? "Developer tools" : "Enable Dev Mode to unlock";
    }
  }

  function openOverlay() {
    if (!overlay) queryElements();
    if (!isDevModeEnabled()) {
      showDevNotice("warning", "Enable Dev Mode first (press O + P) to open this menu.");
      return;
    }
    // Create overlay if it doesn't exist
    if (!overlay && window.OverlayFactory && typeof window.OverlayFactory.createDevMenuOverlay === 'function') {
      window.OverlayFactory.createDevMenuOverlay();
      queryElements();
      attachEventListeners();
    }
    if (!overlay) {
      showDevNotice("warning", "Dev menu overlay not available.");
      return;
    }
    overlay.classList.add(OVERLAY_OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("dev-menu-open");
    refreshAll();
    setTimeout(() => {
      try { if (panel) panel.focus(); } catch {}
    }, 30);
  }

  function closeOverlay(returnFocus = true) {
    if (!overlay) queryElements();
    if (!overlay || !overlay.classList.contains(OVERLAY_OPEN_CLASS)) return;
    overlay.classList.remove(OVERLAY_OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("dev-menu-open");
    if (returnFocus && openBtn) {
      setTimeout(() => {
        try { openBtn.focus(); } catch {}
      }, 30);
    }
  }

  function showDevNotice(tone, message) {
    const payload = { title: "Dev Menu", message: String(message || ""), tone: tone || "info", autoCloseMs: 4000 };
    if (window.mmNotices && typeof window.mmNotices.show === "function") {
      window.mmNotices.show(payload);
    } else if (typeof window.showStorageNotice === "function") {
      window.showStorageNotice(payload);
    } else if (typeof window.alert === "function" && payload.message) {
      try { window.alert(`${payload.title}: ${payload.message}`); } catch {}
    }
  }

  function triggerStorageAction(type) {
    const menuBtn = document.getElementById("storageMenuBtn");
    const menuPanel = document.getElementById("storageMenuPanel");
    const ensureMenuOpen = () => {
      if (menuBtn && menuPanel && !menuPanel.classList.contains("open")) {
        menuBtn.click();
      }
    };
    requestAnimationFrame(() => {
      ensureMenuOpen();
      const clickLater = (id) => {
        setTimeout(() => {
          const btn = document.getElementById(id);
          if (btn) btn.click();
        }, STORAGE_MENU_DELAY_MS);
      };
      switch (type) {
        case "menu":
          break;
        case "clear":
          clickLater("storageDeleteBtn");
          break;
        case "import":
          clickLater("storageImportBtn");
          break;
        default:
          break;
      }
    });
  }

  async function runCatboxDetection() {
    if (!window.MM_catbox || typeof window.MM_catbox.ensure !== "function") {
      showDevNotice("warning", "Catbox helper not ready.");
      return;
    }
    if (catboxStateLabel) catboxStateLabel.textContent = "Detecting…";
    try {
      await window.MM_catbox.ensure();
      refreshDiagnostics();
      showDevNotice("success", "Catbox detection complete.");
    } catch (err) {
      console.error("[DevMenu] Catbox detection failed", err);
      showDevNotice("error", err && err.message ? err.message : "Catbox detection failed.");
      refreshDiagnostics();
    }
  }

  function runClipOverlaySample() {
    if (typeof displayClipResult === "function") {
      displayClipResult("Dev overlay sample — triggered from Developer Menu.");
    } else {
      showDevNotice("info", "Clip overlay API unavailable in this context.");
    }
  }

  function runClipPresetOverlay() {
    if (typeof openClipPresetOverlay === "function") {
      openClipPresetOverlay();
    } else {
      showDevNotice("info", "Clip preset overlay unavailable.");
    }
  }

  function triggerPopout() {
    if (typeof theaterBtn !== "undefined" && theaterBtn) {
      theaterBtn.click();
    } else {
      showDevNotice("info", "Theater button is not available right now.");
    }
  }

  function handleAction(action) {
    switch (action) {
      case "notice:info":
        showDevNotice("info", "Sample info notice triggered via Developer Menu.");
        break;
      case "notice:error":
        showDevNotice("error", "Sample error notice triggered via Developer Menu.");
        break;
      case "storage:menu":
        closeOverlay(false);
        triggerStorageAction("menu");
        break;
      case "storage:clear":
        closeOverlay(false);
        triggerStorageAction("clear");
        break;
      case "storage:import":
        closeOverlay(false);
        triggerStorageAction("import");
        break;
      case "catbox:detect":
        runCatboxDetection();
        break;
      case "clip:preset":
        closeOverlay(false);
        runClipPresetOverlay();
        break;
      case "clip:overlay":
        closeOverlay(false);
        runClipOverlaySample();
        break;
      case "player:popout":
        closeOverlay(false);
        triggerPopout();
        break;
      case "sources:reload": {
        closeOverlay(false);
        const reload = async () => {
          if (typeof window.loadSources === "function") {
            await window.loadSources();
            showDevNotice("success", "Sources reloaded.");
          } else {
            window.location.reload();
          }
        };
        reload().catch((err) => {
          console.error("[DevMenu] Reload failed", err);
          showDevNotice("error", err && err.message ? err.message : "Reload failed.");
        });
        break;
      }
      case "sources:open-settings": {
        closeOverlay(false);
        const btn = document.getElementById("sourcesSettingsBtn");
        if (btn) btn.click();
        else showDevNotice("warning", "Sources settings button not found.");
        break;
      }
      case "sources:feedback": {
        closeOverlay(false);
        if (typeof window.openFeedback === "function") {
          window.openFeedback();
        } else {
          const btn = document.getElementById("openFeedback");
          if (btn) btn.click();
          else showDevNotice("warning", "Feedback controls unavailable.");
        }
        break;
      }
      default:
        showDevNotice("warning", `No handler for ${action}`);
        break;
    }
  }

  function handleOverlayKeydown(event) {
    if (!overlay) queryElements();
    if (!overlay || !overlay.classList.contains(OVERLAY_OPEN_CLASS)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = overlay.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusable.length) return;
    const focusArray = Array.from(focusable).filter((el) => el.offsetParent !== null);
    if (!focusArray.length) return;
    const first = focusArray[0];
    const last = focusArray[focusArray.length - 1];
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

  function attachEventListeners() {
    queryElements();
    if (openBtn) openBtn.addEventListener("click", () => openOverlay());
    if (closeBtn) closeBtn.addEventListener("click", () => closeOverlay());
    if (overlay) {
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeOverlay();
      });
    }
    document.addEventListener("keydown", handleOverlayKeydown);

    if (modeToggle) {
      modeToggle.addEventListener("change", () => {
        const desired = modeToggle.checked === true;
        window.DevMode = desired;
        if (!desired) closeOverlay(false);
      });
    }

    if (concurrencyInput) {
      const commit = () => {
        const next = Number(concurrencyInput.value);
        const applied = applyConcurrency(next);
        concurrencyInput.value = String(applied);
      };
      concurrencyInput.addEventListener("change", commit);
      concurrencyInput.addEventListener("blur", commit);
    }

    if (concurrencyResetBtn) {
      concurrencyResetBtn.addEventListener("click", () => {
        const applied = applyConcurrency(DEFAULT_CONCURRENCY);
        if (concurrencyInput) concurrencyInput.value = String(applied);
        showDevNotice("info", "Download concurrency reset to default.");
      });
    }

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

    if (diagnosticsRefreshBtn) {
      diagnosticsRefreshBtn.addEventListener("click", () => {
        refreshDiagnostics();
        showDevNotice("info", "Diagnostics refreshed.");
      });
    }
  }

  window.addEventListener("rsp:dev-mode-changed", (event) => {
    const enabled = event && event.detail && event.detail.enabled === true;
    if (!enabled) closeOverlay(false);
    refreshAll();
  });

  window.addEventListener("rsp:catbox-default-updated", () => {
    refreshDiagnostics();
  });

  // Initialize
  attachEventListeners();
  
  // Defer initial refresh to ensure settings overlay is created
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(refreshAll, 0);
    });
  } else {
    setTimeout(refreshAll, 0);
  }
})();
