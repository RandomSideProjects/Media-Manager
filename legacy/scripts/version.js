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
      // Helper: try fetch, then XHR fallback (to support file:// in some browsers)
      async function readTxt(){
        const url = `./Assets/LastUpdated.txt?t=${Date.now()}`;
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          if (resp && (resp.ok || resp.status === 0)) {
            return (await resp.text());
          }
        } catch {}
        // XHR fallback — treat status 0 (file://) as success
        try {
          return await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onreadystatechange = () => {
              if (xhr.readyState === 4) {
                if (xhr.status === 200 || xhr.status === 0) resolve(xhr.responseText);
                else reject(new Error('xhr ' + xhr.status));
              }
            };
            xhr.onerror = () => reject(new Error('xhr error'));
            xhr.send();
          });
        } catch {}
        return null;
      }

      // Attempt to read and parse the text file
      try {
        const raw = (await readTxt());
        if (raw) {
          let text = String(raw).trim();
          // Normalize common formats to ISO for reliable parsing
          if (/UTC$/i.test(text)) {
            text = text.replace(/\sUTC$/i, 'Z').replace(' ', 'T');
          }
          // If just a date, treat it as UTC midnight
          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            text = text + 'T00:00:00Z';
          }
          const d = new Date(text);
          if (!isNaN(d.getTime())) { setBadgeFromDate(d); return; }
        }
      } catch {}
      // If we couldn't read the TXT, do not guess with local system time.
      // Show an explicit placeholder so it's clear the date wasn't loaded.
      try {
        badge.textContent = 'Version unavailable';
        badge.style.background = 'hsl(0, 0%, 40%)';
        badge.title = 'Could not load Assets/LastUpdated.txt';
      } catch {}
    }
    // Defer to ensure body exists in rare cases
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch {}
})();
