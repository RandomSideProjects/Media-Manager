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
const DEV_MODE_LS_KEY = 'rsp_dev_mode';
let rspDevModeFlag = false;

function readStoredDevMode() {
  try {
    const raw = localStorage.getItem(DEV_MODE_LS_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

function persistDevMode(value) {
  try {
    if (value) {
      localStorage.setItem(DEV_MODE_LS_KEY, 'true');
    } else {
      localStorage.removeItem(DEV_MODE_LS_KEY);
    }
  } catch {}
}

function isDevModeEnabled() {
  return rspDevModeFlag;
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
  const descriptor = Object.getOwnPropertyDescriptor(window, 'DevMode');
  let initial = readStoredDevMode();
  if (descriptor) {
    try {
      initial = descriptor.get ? descriptor.get.call(window) === true : descriptor.value === true;
    } catch {
      initial = false;
    }
    if (!descriptor.configurable) {
      rspDevModeFlag = initial;
    } else {
      Object.defineProperty(window, 'DevMode', {
        configurable: true,
        enumerable: true,
        get() { return rspDevModeFlag; },
        set(value) {
          const next = value === true;
          const changed = next !== rspDevModeFlag;
          rspDevModeFlag = next;
          persistDevMode(next);
          try {
            applyDownloadConcurrencyUI();
            if (changed && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
              window.dispatchEvent(new CustomEvent('rsp:dev-mode-changed', { detail: { enabled: next } }));
            }
          }
          catch (err) { console.error('[RSP] DevMode update failed', err); }
        }
      });
      rspDevModeFlag = initial;
    }
  } else {
    Object.defineProperty(window, 'DevMode', {
      configurable: true,
      enumerable: true,
      get() { return rspDevModeFlag; },
      set(value) {
        const next = value === true;
        const changed = next !== rspDevModeFlag;
        rspDevModeFlag = next;
        persistDevMode(next);
        try {
          applyDownloadConcurrencyUI();
          if (changed && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('rsp:dev-mode-changed', { detail: { enabled: next } }));
          }
        }
        catch (err) { console.error('[RSP] DevMode update failed', err); }
      }
    });
    rspDevModeFlag = readStoredDevMode();
  }
} else {
  rspDevModeFlag = readStoredDevMode();
}

if (typeof window !== 'undefined') {
  // Toggle dev mode when the O+P key combo is pressed.
  const devModeCombo = new Set(['o', 'p']);
  let devModeSequence = [];
  const resetSequence = () => { devModeSequence = []; };
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = (event.key || '').toLowerCase();
    if (!devModeCombo.has(key)) {
      resetSequence();
      return;
    }
    if (devModeSequence.length && devModeSequence[devModeSequence.length - 1] === key) return;
    devModeSequence.push(key);
    if (devModeSequence.length > devModeCombo.size) devModeSequence.shift();
    const unique = new Set(devModeSequence);
    if (unique.size === devModeCombo.size && devModeSequence.length === devModeCombo.size) {
      window.DevMode = !(window.DevMode === true);
      resetSequence();
    }
  });
  window.addEventListener('blur', resetSequence);
}

applyDownloadConcurrencyUI();

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
