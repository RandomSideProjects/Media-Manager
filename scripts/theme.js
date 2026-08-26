"use strict";

(function() {
  const toggleBtn = typeof themeToggle !== 'undefined' && themeToggle ? themeToggle : document.getElementById('themeToggle');
  if (!toggleBtn) return;
  const bodyEl = document.body;
  const stored = localStorage.getItem('theme') || 'dark';
  bodyEl.classList.toggle('light-mode', stored === 'light');
  toggleBtn.textContent = stored === 'light' ? '☀' : '☾';
  toggleBtn.addEventListener('click', () => {
    const isLight = bodyEl.classList.toggle('light-mode');
    toggleBtn.textContent = isLight ? '☀' : '☾';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
})();

