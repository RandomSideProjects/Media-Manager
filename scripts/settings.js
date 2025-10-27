"use strict";

if (settingsBtn) {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (settingsOverlay) settingsOverlay.style.display = 'flex';
  });
}

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

const clippingEnabled = localStorage.getItem('clippingEnabled') === 'true';
if (clipToggle) clipToggle.checked = clippingEnabled;
if (clipBtn) clipBtn.style.display = clippingEnabled ? 'inline-block' : 'none';

const clipPreviewEnabledStored = localStorage.getItem('clipPreviewEnabled') === 'true';
if (clipPreviewToggle) clipPreviewToggle.checked = clipPreviewEnabledStored;

const selectiveDownloadsEnabledStored = localStorage.getItem('selectiveDownloadsEnabled') === 'true';
if (selectiveDownloadToggle) selectiveDownloadToggle.checked = selectiveDownloadsEnabledStored;

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
  if (!downloadConcurrencyRange) return;
  const raw = parseInt(downloadConcurrencyRange.value, 10);
  const clamped = clampConcurrency(raw);
  localStorage.setItem('downloadConcurrency', String(clamped));
  updateConcurrencyDisplay(clamped);
}

if (downloadConcurrencyRange && !downloadConcurrencyRange.dataset.bound) {
  downloadConcurrencyRange.addEventListener('input', handleDownloadConcurrencyInput);
  downloadConcurrencyRange.addEventListener('change', handleDownloadConcurrencyInput);
  downloadConcurrencyRange.dataset.bound = '1';
}

if (typeof window !== 'undefined') {
  window.addEventListener('rsp:dev-mode-changed', () => {
    applyDownloadConcurrencyUI();
  });
}

applyDownloadConcurrencyUI();

function updateRecentSourcesControls() {
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

if (recentSourcesToggle) {
  recentSourcesToggle.addEventListener('change', () => {
    if (!window.RSPRecentSources || typeof window.RSPRecentSources.setEnabled !== 'function') return;
    window.RSPRecentSources.setEnabled(recentSourcesToggle.checked === true);
  });
}

if (recentSourcesPlacement) {
  recentSourcesPlacement.addEventListener('change', () => {
    if (!window.RSPRecentSources || typeof window.RSPRecentSources.setPlacement !== 'function') return;
    window.RSPRecentSources.setPlacement(recentSourcesPlacement.value);
  });
}

if (clipPreviewToggle) {
  clipPreviewToggle.addEventListener('change', () => {
    localStorage.setItem('clipPreviewEnabled', clipPreviewToggle.checked);
  });
}

if (selectiveDownloadToggle) {
  selectiveDownloadToggle.addEventListener('change', () => {
    localStorage.setItem('selectiveDownloadsEnabled', selectiveDownloadToggle.checked);
  });
}

if (clipToggle) {
  clipToggle.addEventListener('change', () => {
    const enabled = clipToggle.checked;
    localStorage.setItem('clippingEnabled', enabled);
    if (clipBtn) clipBtn.style.display = enabled ? 'inline-block' : 'none';
  });
}

window.addEventListener('rsp:recent-sources-updated', () => {
  updateRecentSourcesControls();
});

updateRecentSourcesControls();
