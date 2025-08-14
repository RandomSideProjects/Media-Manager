// Settings modal and clipping toggle
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsPanel = document.getElementById('settingsPanel');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const clipToggle = document.getElementById('clipToggle');
const clipPreviewToggle = document.getElementById('clipPreviewToggle');

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsOverlay) settingsOverlay.style.display = 'flex';
});

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

// Initialize toggle state from localStorage (default: off)
const clippingEnabled = localStorage.getItem('clippingEnabled') === 'true';
clipToggle.checked = clippingEnabled;
// Show or hide the Clip button accordingly
if (clipBtn) clipBtn.style.display = clippingEnabled ? 'inline-block' : 'none';

// Initialize clip preview toggle from localStorage
const clipPreviewEnabledStored = localStorage.getItem('clipPreviewEnabled') === 'true';
if (clipPreviewToggle) clipPreviewToggle.checked = clipPreviewEnabledStored;

// Persist clip preview setting
if (clipPreviewToggle) {
  clipPreviewToggle.addEventListener('change', () => {
    localStorage.setItem('clipPreviewEnabled', clipPreviewToggle.checked);
  });
}

// Update clippingEnabled on toggle change
clipToggle.addEventListener('change', () => {
  const enabled = clipToggle.checked;
  localStorage.setItem('clippingEnabled', enabled);
  if (clipBtn) clipBtn.style.display = enabled ? 'inline-block' : 'none';

