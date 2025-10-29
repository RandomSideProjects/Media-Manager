"use strict";

console.log('[Settings] Script loaded');

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
      window.clipToggle = document.getElementById('clipToggle');
      window.clipPreviewToggle = document.getElementById('clipPreviewToggle');
      window.selectiveDownloadToggle = document.getElementById('selectiveDownloadToggle');
      window.downloadConcurrencyRange = document.getElementById('downloadConcurrencyRange');
      window.downloadConcurrencyValue = document.getElementById('downloadConcurrencyValue');
      window.recentSourcesToggle = document.getElementById('recentSourcesToggle');
      window.recentSourcesPlacement = document.getElementById('recentSourcesPlacement');
      
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
console.log('[Settings] settingsBtn found:', !!settingsBtn);
console.log('[Settings] OverlayFactory available:', !!window.OverlayFactory);
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
  const clippingEnabled = localStorage.getItem('clippingEnabled') === 'true';
  if (clipToggle) {
    clipToggle.checked = clippingEnabled;
    if (window.clipBtn) window.clipBtn.style.display = clippingEnabled ? 'inline-block' : 'none';
  }
  
  const clipPreviewEnabledStored = localStorage.getItem('clipPreviewEnabled') === 'true';
  if (clipPreviewToggle) clipPreviewToggle.checked = clipPreviewEnabledStored;
  
  const selectiveDownloadsEnabledStored = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
  if (selectiveDownloadToggle) selectiveDownloadToggle.checked = selectiveDownloadsEnabledStored;
  
  // Setup event handlers
  if (clipToggle && !clipToggle.dataset.bound) {
    clipToggle.addEventListener('change', () => {
      const enabled = clipToggle.checked;
      localStorage.setItem('clippingEnabled', enabled);
      if (window.clipBtn) window.clipBtn.style.display = enabled ? 'inline-block' : 'none';
    });
    clipToggle.dataset.bound = '1';
  }
  
  if (clipPreviewToggle && !clipPreviewToggle.dataset.bound) {
    clipPreviewToggle.addEventListener('change', () => {
      localStorage.setItem('clipPreviewEnabled', clipPreviewToggle.checked);
    });
    clipPreviewToggle.dataset.bound = '1';
  }
  
  if (selectiveDownloadToggle && !selectiveDownloadToggle.dataset.bound) {
    selectiveDownloadToggle.addEventListener('change', () => {
      localStorage.setItem('selectiveDownloadsEnabled', selectiveDownloadToggle.checked);
    });
    selectiveDownloadToggle.dataset.bound = '1';
  }
  
  if (recentSourcesToggle && !recentSourcesToggle.dataset.bound) {
    recentSourcesToggle.addEventListener('change', () => {
      if (!window.RSPRecentSources || typeof window.RSPRecentSources.setEnabled !== 'function') return;
      window.RSPRecentSources.setEnabled(recentSourcesToggle.checked === true);
    });
    recentSourcesToggle.dataset.bound = '1';
  }
  
  if (recentSourcesPlacement && !recentSourcesPlacement.dataset.bound) {
    recentSourcesPlacement.addEventListener('change', () => {
      if (!window.RSPRecentSources || typeof window.RSPRecentSources.setPlacement !== 'function') return;
      window.RSPRecentSources.setPlacement(recentSourcesPlacement.value);
    });
    recentSourcesPlacement.dataset.bound = '1';
  }
  
  if (downloadConcurrencyRange && !downloadConcurrencyRange.dataset.bound) {
    downloadConcurrencyRange.addEventListener('input', handleDownloadConcurrencyInput);
    downloadConcurrencyRange.addEventListener('change', handleDownloadConcurrencyInput);
    downloadConcurrencyRange.dataset.bound = '1';
  }
}

const clippingEnabled = localStorage.getItem('clippingEnabled') === 'true';
if (window.clipBtn) window.clipBtn.style.display = clippingEnabled ? 'inline-block' : 'none';

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
  const recentSourcesPlacement = document.getElementById('recentSourcesPlacement');
  if (!recentSourcesToggle) return;
  const api = window.RSPRecentSources;
  const apiAvailable = api && typeof api.isEnabled === 'function';
  const enabled = apiAvailable ? api.isEnabled() === true : false;
  recentSourcesToggle.checked = enabled;
  if (recentSourcesPlacement) {
    const placement = api && typeof api.getPlacement === 'function' ? api.getPlacement() : 'bottom';
    recentSourcesPlacement.value = placement;
    recentSourcesPlacement.disabled = !enabled || !apiAvailable;
  }
}

window.addEventListener('rsp:recent-sources-updated', () => {
  updateRecentSourcesControls();
});
