"use strict";

// Create overlay immediately on load
let settingsOverlay = null;
let settingsCloseBtn = null;

function ensureSettingsOverlay() {
  if (!settingsOverlay) {
    if (!window.OverlayFactory || typeof window.OverlayFactory.createSettingsOverlay !== 'function') {
      console.error('[Settings] OverlayFactory not available');
      return null;
    }
    try {
      settingsOverlay = window.OverlayFactory.createSettingsOverlay();
      settingsCloseBtn = document.getElementById('settingsCloseBtn');
      
      // Setup close handlers
      if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', () => {
          if (settingsOverlay) settingsOverlay.style.display = 'none';
        });
      }
      
      if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
          if (e.target === settingsOverlay) {
            settingsOverlay.style.display = 'none';
          }
        });
      }
      
      // Re-query elements after overlay creation
      window.selectiveDownloadToggle = document.getElementById('selectiveDownloadToggle');
      window.downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
      window.downloadConcurrencyValue = document.getElementById('downloadConcurrencyValue');
      window.storageShowCameraOptionsToggle = document.getElementById('storageShowCameraOptionsToggle');
      window.recentSourcesToggle = document.getElementById('recentSourcesToggle');
      
      // Setup initial states
      initializeSettingsValues();
    } catch (err) {
      console.error('[Settings] Error creating overlay:', err);
      return null;
    }
  }
  return settingsOverlay;
}

// Create overlay immediately so storage.js and dev-menu.js can access its elements
ensureSettingsOverlay();

const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const overlay = ensureSettingsOverlay();
    if (overlay) {
      updateRecentSourcesControls();
      applyDownloadConcurrencyUI();
      overlay.style.display = 'flex';
    }
  });
}

function initializeSettingsValues() {
  const selectiveDownloadsEnabledStored = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
  if (selectiveDownloadToggle) selectiveDownloadToggle.checked = selectiveDownloadsEnabledStored;
  
  // Setup event handlers
  if (selectiveDownloadToggle && !selectiveDownloadToggle.dataset.bound) {
    selectiveDownloadToggle.addEventListener('change', () => {
      localStorage.setItem('selectiveDownloadsEnabled', selectiveDownloadToggle.checked);
    });
    selectiveDownloadToggle.dataset.bound = '1';
  }

  const showCameraOptionsStored = localStorage.getItem('storageShowCameraOptions') === 'true';
  if (storageShowCameraOptionsToggle) {
    storageShowCameraOptionsToggle.checked = showCameraOptionsStored;
  }
  if (storageShowCameraOptionsToggle && !storageShowCameraOptionsToggle.dataset.bound) {
    storageShowCameraOptionsToggle.addEventListener('change', () => {
      localStorage.setItem('storageShowCameraOptions', storageShowCameraOptionsToggle.checked);
    });
    storageShowCameraOptionsToggle.dataset.bound = '1';
  }
  
  if (recentSourcesToggle && !recentSourcesToggle.dataset.bound) {
    recentSourcesToggle.addEventListener('change', () => {
      if (!window.RSPRecentSources || typeof window.RSPRecentSources.setEnabled !== 'function') return;
      window.RSPRecentSources.setEnabled(recentSourcesToggle.checked === true);
    });
    recentSourcesToggle.dataset.bound = '1';
  }
  
  if (downloadConcurrencyRange && !downloadConcurrencyRange.dataset.bound) {
    downloadConcurrencyRange.addEventListener('input', handleDownloadConcurrencyInput);
    downloadConcurrencyRange.addEventListener('change', handleDownloadConcurrencyInput);
    downloadConcurrencyRange.dataset.bound = '1';
  }

}

const MAX_UI_DL_CONCURRENCY = 8;
const DEFAULT_DL_CONCURRENCY = 2;

function isDevModeEnabled() {
  if (typeof window === 'undefined') return false;
  if (!window.RSPDev || typeof window.RSPDev.isEnabled !== 'function') return false;
  try { return window.RSPDev.isEnabled() === true; }
  catch { return false; }
}

function readStoredConcurrency() {
  const rawValue = localStorage.getItem('downloadConcurrency');
  const parsed = parseInt(rawValue || '', 10);
  const sanitized = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_DL_CONCURRENCY;
  return { parsed, sanitized };
}

function clampConcurrency(value) {
  const numeric = parseInt(value, 10);
  const base = Number.isFinite(numeric) && numeric >= 1 ? numeric : DEFAULT_DL_CONCURRENCY;
  const safe = Math.max(1, Math.floor(base));
  return isDevModeEnabled() ? safe : Math.min(MAX_UI_DL_CONCURRENCY, safe);
}

function configureConcurrencyInput(devMode) {
  const downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
  if (!downloadConcurrencyRange) return;
  if (devMode) {
    try { downloadConcurrencyRange.type = 'number'; } catch {}
    downloadConcurrencyRange.removeAttribute('max');
  } else {
    try { downloadConcurrencyRange.type = 'range'; } catch {}
    downloadConcurrencyRange.setAttribute('max', String(MAX_UI_DL_CONCURRENCY));
  }
  downloadConcurrencyRange.setAttribute('min', '1');
  downloadConcurrencyRange.setAttribute('step', '1');
}

function updateConcurrencyDisplay(value) {
  const downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
  const downloadConcurrencyValue = document.getElementById('downloadConcurrencyValue');
  if (downloadConcurrencyRange) downloadConcurrencyRange.value = String(value);
  if (downloadConcurrencyValue) downloadConcurrencyValue.textContent = String(value);
}

function applyDownloadConcurrencyUI() {
  const devMode = isDevModeEnabled();
  configureConcurrencyInput(devMode);
  const { parsed, sanitized } = readStoredConcurrency();
  const clamped = clampConcurrency(sanitized);
  if (!Number.isFinite(parsed) || parsed !== sanitized || clamped !== sanitized) {
    localStorage.setItem('downloadConcurrency', String(clamped));
  }
  updateConcurrencyDisplay(clamped);
}

function handleDownloadConcurrencyInput() {
  const downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
  if (!downloadConcurrencyRange) return;
  const raw = parseInt(downloadConcurrencyRange.value, 10);
  const clamped = clampConcurrency(raw);
  localStorage.setItem('downloadConcurrency', String(clamped));
  updateConcurrencyDisplay(clamped);
}

if (typeof window !== 'undefined') {
  window.addEventListener('rsp:dev-mode-changed', () => {
    applyDownloadConcurrencyUI();
  });
}

function updateRecentSourcesControls() {
  const recentSourcesToggle = document.getElementById('recentSourcesToggle');
  if (!recentSourcesToggle) return;
  const api = window.RSPRecentSources;
  const apiAvailable = api && typeof api.isEnabled === 'function';
  const enabled = apiAvailable ? api.isEnabled() === true : false;
  recentSourcesToggle.checked = enabled;
}

window.addEventListener('rsp:recent-sources-updated', () => {
  updateRecentSourcesControls();
});

window.addEventListener('mm:storage-synced', (event) => {
  const detail = event && event.detail ? event.detail : null;
  const applied = detail && detail.applied ? detail.applied : null;
  const hasAppliedChanges = applied && (
    applied.cleared === true
    || (Array.isArray(applied.changedKeys) && applied.changedKeys.length)
    || (Array.isArray(applied.removedKeys) && applied.removedKeys.length)
  );
  if (!hasAppliedChanges) return;
  try { initializeSettingsValues(); } catch {}
  try { updateRecentSourcesControls(); } catch {}
  try { applyDownloadConcurrencyUI(); } catch {}
});
