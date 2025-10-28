"use strict";

// Variables (top)
const settingsBtn = document.getElementById('sourcesSettingsBtn');
const settingsOverlay = document.getElementById('sourcesSettingsOverlay');
const settingsApplyBtn = document.getElementById('settingsApply');
const rowLimitRange = document.getElementById('rowLimitRange');
const rowLimitValue = document.getElementById('rowLimitValue');
const settingsCancelBtn = document.getElementById('settingsCancel');
const hidePostersToggle = document.getElementById('toggleHidePosters');
const sortRadios = Array.from(document.querySelectorAll('#sortOptions input[name="sort"]'));
const modeRadios = Array.from(document.querySelectorAll('#modeOptions input[name="mode"]'));
const searchToggleEl = document.getElementById('toggleSearchBar');

// Behavior
function openSettingsPanel(){
  hidePostersToggle.checked = !!SOURCES_HIDE_POSTERS;
  for (const r of sortRadios) r.checked = (r.value === SOURCES_SORT);
  for (const m of modeRadios) m.checked = (m.value === SOURCES_MODE);
  updateRowLimitMax();
  if (rowLimitRange) {
    rowLimitRange.value = String(SOURCES_ROW_LIMIT);
    if (rowLimitValue) rowLimitValue.textContent = String(SOURCES_ROW_LIMIT);
  }
  if (searchToggleEl) searchToggleEl.checked = !!SOURCES_SEARCH_ENABLED;
  settingsOverlay.style.display = 'flex';
}
function closeSettingsPanel(){ settingsOverlay.style.display = 'none'; }

if (settingsBtn) settingsBtn.addEventListener('click', openSettingsPanel);
if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsPanel);
if (settingsOverlay) settingsOverlay.addEventListener('click', (e)=>{ if (e.target === settingsOverlay) closeSettingsPanel(); });

function applyRowLimit(n){
  const container = document.getElementById('sourcesContainer');
  if (container) container.style.setProperty('--cols', String(n));
}

// Initialize applied row limit on load
applyRowLimit(SOURCES_ROW_LIMIT);

// Compute dynamic max columns based on window/container width (minus one)
function computeMaxCols(){
  try {
    const container = document.getElementById('sourcesContainer');
    const containerWidth = (container && container.clientWidth) ? container.clientWidth : Math.floor((window.innerWidth || 1280) * 0.9);
    const cardWidth = 360; // fixed card width
    const fit = Math.max(1, Math.floor(containerWidth / cardWidth));
    const maxCols = Math.max(1, fit - 1);
    return Math.min(10, Math.max(1, maxCols));
  } catch { return 3; }
}

function updateRowLimitMax(){
  if (!rowLimitRange) return;
  const maxCols = computeMaxCols();
  rowLimitRange.max = String(maxCols);
  if (SOURCES_ROW_LIMIT > maxCols) {
    SOURCES_ROW_LIMIT = maxCols;
    localStorage.setItem('sources_rowLimit', String(SOURCES_ROW_LIMIT));
    applyRowLimit(SOURCES_ROW_LIMIT);
  }
  if (rowLimitValue) rowLimitValue.textContent = String(SOURCES_ROW_LIMIT);
}

// Update limits on resize (throttled)
let __rowLimitTimer = null;
window.addEventListener('resize', () => {
  if (__rowLimitTimer) return;
  __rowLimitTimer = setTimeout(() => { __rowLimitTimer = null; updateRowLimitMax(); }, 100);
});

if (rowLimitRange) {
  rowLimitRange.addEventListener('input', () => {
    if (rowLimitValue) rowLimitValue.textContent = rowLimitRange.value;
    applyRowLimit(parseInt(rowLimitRange.value, 10));
  });
}

if (settingsApplyBtn) settingsApplyBtn.addEventListener('click', async () => {
  const selected = sortRadios.find(r => r.checked);
  SOURCES_SORT = selected ? selected.value : 'az';
  SOURCES_HIDE_POSTERS = !!hidePostersToggle.checked;
  localStorage.setItem('sources_sortOrder', SOURCES_SORT);
  localStorage.setItem('sources_hidePosters', SOURCES_HIDE_POSTERS ? '1':'0');
  if (searchToggleEl) {
    SOURCES_SEARCH_ENABLED = !!searchToggleEl.checked;
    localStorage.setItem('sources_search_enabled', SOURCES_SEARCH_ENABLED ? '1' : '0');
    // Update toolbar immediately if present
    if (window.SourcesSearch && typeof window.SourcesSearch.enabled !== 'undefined') {
      window.SourcesSearch.enabled = SOURCES_SEARCH_ENABLED;
    }
  }
  const selectedMode = modeRadios.find(m => m.checked);
  const newMode = selectedMode ? selectedMode.value : 'anime';
  const modeChanged = newMode !== SOURCES_MODE;
  SOURCES_MODE = newMode;
  localStorage.setItem('sources_mode', SOURCES_MODE);
  if (rowLimitRange) {
    // Clamp to dynamic max based on window width
    const maxCols = computeMaxCols();
    const v = parseInt(rowLimitRange.value, 10);
    const clamped = Math.max(1, Math.min(maxCols, Number.isFinite(v) ? v : SOURCES_ROW_LIMIT));
    SOURCES_ROW_LIMIT = clamped;
    localStorage.setItem('sources_rowLimit', String(clamped));
    applyRowLimit(SOURCES_ROW_LIMIT);
  }
  if (SOURCES_SORT === 'newold' || SOURCES_SORT === 'oldnew') {
    await hydrateMtimes(SOURCES_META);
  }
  if (modeChanged) {
    try { if (typeof loadSources === 'function') await loadSources(); else window.location.reload(); } catch { window.location.reload(); }
  } else {
    renderSourcesFromState();
  }
  closeSettingsPanel();
});
