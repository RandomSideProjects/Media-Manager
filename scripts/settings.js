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

const storedDl = parseInt(localStorage.getItem('downloadConcurrency') || '', 10);
const initialDl = (Number.isFinite(storedDl) && storedDl >= 1 && storedDl <= 8) ? storedDl : 2;
if (downloadConcurrencyRange) downloadConcurrencyRange.value = String(initialDl);
if (downloadConcurrencyValue) downloadConcurrencyValue.textContent = String(initialDl);

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

if (downloadConcurrencyRange) {
  const updateDl = () => {
    const v = parseInt(downloadConcurrencyRange.value, 10) || 2;
    const clamped = Math.max(1, Math.min(8, v));
    if (downloadConcurrencyValue) downloadConcurrencyValue.textContent = String(clamped);
    localStorage.setItem('downloadConcurrency', String(clamped));
  };
  downloadConcurrencyRange.addEventListener('input', updateDl);
  downloadConcurrencyRange.addEventListener('change', updateDl);
}

if (clipToggle) {
  clipToggle.addEventListener('change', () => {
    const enabled = clipToggle.checked;
    localStorage.setItem('clippingEnabled', enabled);
    if (clipBtn) clipBtn.style.display = enabled ? 'inline-block' : 'none';
  });
}

