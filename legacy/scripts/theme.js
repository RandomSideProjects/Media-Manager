"use strict";

(function() {
  if (!themeToggle) return;
  const bodyEl = document.body;
  const stored = localStorage.getItem('theme') || 'dark';
  bodyEl.classList.toggle('light-mode', stored === 'light');
  themeToggle.textContent = stored === 'light' ? '☀' : '☾';
  themeToggle.addEventListener('click', () => {
    const isLight = bodyEl.classList.toggle('light-mode');
    themeToggle.textContent = isLight ? '☀' : '☾';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  });
})();

