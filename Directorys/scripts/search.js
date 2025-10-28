"use strict";

(function(){
  if (typeof document === 'undefined') return;

  const toolbar = document.getElementById('sourcesToolbar');
  const input = document.getElementById('sourcesSearchInput');

  function setToolbarVisibility() {
    const enabled = (typeof SOURCES_SEARCH_ENABLED === 'boolean') ? SOURCES_SEARCH_ENABLED : true;
    if (toolbar) toolbar.style.display = enabled ? 'flex' : 'none';
  }

  function normalize(s){ return String(s || '').toLowerCase(); }

  function filterAndRender(query){
    const q = normalize(query);
    if (!q) { renderSourcesFromState(); return; }
    try {
      const filtered = sortMeta(
        SOURCES_META.filter(m => {
          const title = normalize(m.title || m.file);
          const file = normalize(m.file);
          const poster = normalize(m.poster || m.image);
          return title.includes(q) || file.includes(q) || poster.includes(q);
        }),
        SOURCES_SORT
      );
      const container = document.getElementById('sourcesContainer');
      container.innerHTML = '';
      for (const meta of filtered) container.appendChild(buildSourceCardFromMeta(meta));
    } catch { renderSourcesFromState(); }
  }

  function attach() {
    setToolbarVisibility();
    if (!input) return;
    let t = null;
    input.addEventListener('input', () => {
      const v = input.value;
      if (t) cancelAnimationFrame(t);
      t = requestAnimationFrame(() => filterAndRender(v));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  // Expose simple API to toggle setting from console or UI in future
  window.SourcesSearch = {
    get enabled(){ return !!SOURCES_SEARCH_ENABLED; },
    set enabled(v){
      SOURCES_SEARCH_ENABLED = !!v;
      try { localStorage.setItem('sources_search_enabled', SOURCES_SEARCH_ENABLED ? '1' : '0'); } catch {}
      setToolbarVisibility();
    }
  };
})();

