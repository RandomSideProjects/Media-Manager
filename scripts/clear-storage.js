"use strict";

(function () {
  function wireUp() {
    const openBtn = document.getElementById('clearStorageOpenBtn');
    const overlay = document.getElementById('clearStorageOverlay');
    const confirmBtn = document.getElementById('clearStorageConfirmBtn');
    const cancelBtn = document.getElementById('clearStorageCancelBtn');
    const closeBtn = document.getElementById('clearStorageCloseBtn');

    if (!openBtn || !overlay || !confirmBtn || !cancelBtn) return false;

    const openOverlay = () => { overlay.style.display = 'flex'; };
    const closeOverlay = () => { overlay.style.display = 'none'; };

    openBtn.addEventListener('click', openOverlay);
    cancelBtn.addEventListener('click', closeOverlay);
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);

    // Close if clicking outside the panel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') closeOverlay();
    });

    confirmBtn.addEventListener('click', () => {
      try {
        localStorage.clear();
      } catch (e) {
        console.error('Failed to clear localStorage:', e);
      }
      // Feedback then reload to reset UI state
      closeOverlay();
      try { alert('Local storage cleared.'); } catch {}
      try { window.location.reload(); } catch {}
    });
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUp, { once: true });
  } else {
    wireUp();
  }
})();
