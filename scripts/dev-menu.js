"use strict";

(function () {
  if (typeof window === "undefined") return;

  const overlay = typeof devMenuOverlay !== "undefined" ? devMenuOverlay : document.getElementById("devMenuOverlay");
  const panel = document.getElementById("devMenuPanel");
  const openBtn = typeof devMenuBtn !== "undefined" ? devMenuBtn : document.getElementById("devMenuBtn");
  const closeBtn = typeof devMenuCloseBtn !== "undefined" ? devMenuCloseBtn : document.getElementById("devMenuCloseBtn");
  const modeToggle = typeof devModeToggle !== "undefined" ? devModeToggle : document.getElementById("devModeToggle");
  const concurrencyInput = typeof devConcurrencyInput !== "undefined" ? devConcurrencyInput : document.getElementById("devConcurrencyInput");
  const concurrencyResetBtn = typeof devConcurrencyResetBtn !== "undefined" ? devConcurrencyResetBtn : document.getElementById("devConcurrencyResetBtn");
  const actionGrid = typeof devActionGrid !== "undefined" ? devActionGrid : document.getElementById("devActionGrid");
  const diagnosticsRefreshBtn = typeof devDiagnosticsRefreshBtn !== "undefined" ? devDiagnosticsRefreshBtn : document.getElementById("devDiagnosticsRefreshBtn");
  const modeStateLabel = typeof devModeStateLabel !== "undefined" ? devModeStateLabel : document.getElementById("devModeStateLabel");
  const concurrencyStateLabel = typeof devConcurrencyStateLabel !== "undefined" ? devConcurrencyStateLabel : document.getElementById("devConcurrencyStateLabel");
  const catboxStateLabel = typeof devCatboxEndpointLabel !== "undefined" ? devCatboxEndpointLabel : document.getElementById("devCatboxEndpointLabel");
  const sourceKeyLabel = typeof devSourceKeyLabel !== "undefined" ? devSourceKeyLabel : document.getElementById("devSourceKeyLabel");
  const menuRow = typeof devMenuRow !== "undefined" ? devMenuRow : document.getElementById("devMenuRow");
  const menuStatus = typeof devMenuStatus !== "undefined" ? devMenuStatus : document.getElementById("devMenuStatus");
  const recentSourcesToggle = typeof devRecentSourcesToggle !== "undefined" ? devRecentSourcesToggle : document.getElementById("devRecentSourcesToggle");
  const recentSourcesPlacementSelect = typeof devRecentSourcesPlacement !== "undefined" ? devRecentSourcesPlacement : document.getElementById("devRecentSourcesPlacement");
  const recentSourcesPlacementRow = document.getElementById("devRecentSourcesPlacementRow");

  if (!overlay || !panel || !openBtn) return;

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

  function refreshExperimentalControls() {
    if (!recentSourcesToggle) return;
    const devEnabled = isDevModeEnabled();
    const api = window.RSPRecentSources;
    const featureEnabled = api && typeof api.isEnabled === "function" ? api.isEnabled() === true : false;
    recentSourcesToggle.checked = featureEnabled;
    recentSourcesToggle.disabled = !devEnabled;
    if (recentSourcesPlacementRow) {
      recentSourcesPlacementRow.style.display = featureEnabled ? "" : "none";
    }
    if (recentSourcesPlacementSelect) {
      const placement = api && typeof api.getPlacement === "function" ? api.getPlacement() : "top";
      recentSourcesPlacementSelect.value = placement;
      recentSourcesPlacementSelect.disabled = !devEnabled || !featureEnabled;
    }
  }

  function refreshAll() {
    updateModeToggle();
    refreshConcurrencyInput();
    refreshDiagnostics();
    refreshExperimentalControls();
    updateDevMenuAvailability();
  }

  function updateDevMenuAvailability() {
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
    if (!isDevModeEnabled()) {
      showDevNotice("warning", "Enable Dev Mode first (press O + P) to open this menu.");
      return;
    }
    overlay.classList.add(OVERLAY_OPEN_CLASS);
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("dev-menu-open");
    refreshAll();
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
    if (!overlay.classList.contains(OVERLAY_OPEN_CLASS)) return;
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

  if (openBtn) openBtn.addEventListener("click", () => openOverlay());
  if (closeBtn) closeBtn.addEventListener("click", () => closeOverlay());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeOverlay();
  });
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

  if (recentSourcesToggle) {
    recentSourcesToggle.addEventListener("change", () => {
      if (!window.RSPRecentSources || typeof window.RSPRecentSources.setEnabled !== "function") return;
      window.RSPRecentSources.setEnabled(recentSourcesToggle.checked === true);
      refreshExperimentalControls();
    });
  }

  if (recentSourcesPlacementSelect) {
    recentSourcesPlacementSelect.addEventListener("change", () => {
      if (!window.RSPRecentSources || typeof window.RSPRecentSources.setPlacement !== "function") return;
      window.RSPRecentSources.setPlacement(recentSourcesPlacementSelect.value);
      refreshExperimentalControls();
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

  window.addEventListener("rsp:dev-mode-changed", (event) => {
    const enabled = event && event.detail && event.detail.enabled === true;
    if (!enabled) closeOverlay(false);
    refreshAll();
  });

  window.addEventListener("rsp:catbox-default-updated", () => {
    refreshDiagnostics();
  });

  window.addEventListener("rsp:recent-sources-updated", () => {
    refreshExperimentalControls();
  });

  refreshAll();
})();
