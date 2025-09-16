"use strict";

(function(){
  try {
    // Create badge element in bottom-right
    const badge = document.createElement('a');
    badge.id = 'versionBadge';
    badge.href = 'https://github.com/RandomSideProjects/Media-Manager';
    badge.target = '_blank';
    badge.rel = 'noopener noreferrer';
    badge.textContent = 'Version …';
    document.body.appendChild(badge);

    function colorForAgeDays(days){
      const d = Math.max(0, Math.min(30, days)); // clamp 0..30
      const hue = 120 - (d / 30) * 120; // 120=green -> 0=red
      return `hsl(${hue}, 70%, 42%)`;
    }

    function setBadgeFromDate(date){
      if (!date || !isFinite(date.getTime())) return;
      const now = new Date();
      const ageMs = Math.max(0, now.getTime() - date.getTime());
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const color = colorForAgeDays(ageDays);
      const dateLabel = date.toISOString().slice(0, 10);
      badge.textContent = `Version ${dateLabel}`;
      badge.style.background = color;
      badge.title = `Built ${Math.floor(ageDays)} day(s) ago (${date.toUTCString()})`;
    }

    async function init(){
      // Attempt to fetch the date file; fall back to current date if unavailable
      try {
        const resp = await fetch('Assets/LastUpdated.txt', { cache: 'no-store' });
        if (resp && resp.ok) {
          const text = (await resp.text()).trim();
          // Accept ISO or any Date-parsable string
          const d = new Date(text);
          if (!isNaN(d.getTime())) { setBadgeFromDate(d); return; }
        }
      } catch {}
      // Fallback: use document last modified or now
      const fallback = new Date(document.lastModified || Date.now());
      setBadgeFromDate(fallback);
    }
    // Defer to ensure body exists in rare cases
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch {}
})();

