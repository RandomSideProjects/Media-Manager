"use strict";

// Variables (top)
let settingsBtn = null;
let settingsOverlay = null;
let settingsApplyBtn = null;
let rowLimitRange = null;
let rowLimitValue = null;
let settingsCancelBtn = null;
let hidePostersToggle = null;
let sortSelect = null;
let modeRadios = [];
let searchToggleEl = null;
let openFeedbackBtn = null;

function ensureSourcesSettingsOverlay() {
  if (!settingsOverlay) {
    if (window.OverlayFactory && typeof window.OverlayFactory.createSourcesSettingsOverlay === 'function') {
      settingsOverlay = window.OverlayFactory.createSourcesSettingsOverlay();
      
      // Re-query all elements
      settingsApplyBtn = document.getElementById('settingsApply');
      rowLimitRange = document.getElementById('rowLimitRange');
      rowLimitValue = document.getElementById('rowLimitValue');
      settingsCancelBtn = document.getElementById('settingsCancel');
      hidePostersToggle = document.getElementById('toggleHidePosters');
      sortSelect = document.getElementById('sortOptions');
      modeRadios = Array.from(document.querySelectorAll('#modeOptions input[name="mode"]'));
      searchToggleEl = document.getElementById('toggleSearchBar');
      openFeedbackBtn = document.getElementById('openFeedback');
      
      // Setup event handlers
      if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsPanel);
      if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (e) => {
          if (e.target === settingsOverlay) closeSettingsPanel();
        });
      }
      
      if (rowLimitRange) {
        rowLimitRange.addEventListener('input', () => {
          if (rowLimitValue) rowLimitValue.textContent = rowLimitRange.value;
          applyRowLimit(parseInt(rowLimitRange.value, 10));
        });
      }
      
      if (settingsApplyBtn) settingsApplyBtn.addEventListener('click', applySettings);
      
      if (openFeedbackBtn) {
        openFeedbackBtn.addEventListener('click', () => {
          closeSettingsPanel();
          if (window.OverlayFactory && typeof window.OverlayFactory.createFeedbackOverlay === 'function') {
            window.OverlayFactory.createFeedbackOverlay();
          }
          const feedbackOverlay = document.getElementById('feedbackOverlay');
          if (feedbackOverlay) feedbackOverlay.style.display = 'flex';
        });
      }
    }
  }
  return settingsOverlay;
}

// Behavior
function openSettingsPanel(){
  settingsOverlay = ensureSourcesSettingsOverlay();
  if (!settingsOverlay) return;
  
  // Re-query elements
  hidePostersToggle = document.getElementById('toggleHidePosters');
  sortSelect = document.getElementById('sortOptions');
  modeRadios = Array.from(document.querySelectorAll('#modeOptions input[name="mode"]'));
  rowLimitRange = document.getElementById('rowLimitRange');
  rowLimitValue = document.getElementById('rowLimitValue');
  searchToggleEl = document.getElementById('toggleSearchBar');
  
  if (hidePostersToggle) hidePostersToggle.checked = !!SOURCES_HIDE_POSTERS;
  if (sortSelect) sortSelect.value = SOURCES_SORT;
  for (const m of modeRadios) m.checked = (m.value === SOURCES_MODE);
  if (rowLimitRange) {
    rowLimitRange.value = String(SOURCES_ROW_LIMIT);
    if (rowLimitValue) rowLimitValue.textContent = String(SOURCES_ROW_LIMIT);
  }
  if (searchToggleEl) searchToggleEl.checked = !!SOURCES_SEARCH_ENABLED;
  if (settingsOverlay) settingsOverlay.style.display = 'flex';
}
function closeSettingsPanel(){ 
  // The range previews changes immediately. Restore the saved value when the
  // panel is dismissed without applying.
  applyRowLimit(SOURCES_ROW_LIMIT);
  if (settingsOverlay) settingsOverlay.style.display = 'none'; 
}

// Create settings overlay immediately so other scripts can reference its elements
ensureSourcesSettingsOverlay();

settingsBtn = document.getElementById('sourcesSettingsBtn');
if (settingsBtn) settingsBtn.addEventListener('click', openSettingsPanel);

function applyRowLimit(n){
  const container = document.getElementById('sourcesContainer');
  const value = Number.isFinite(n) ? Math.max(2, Math.min(10, Math.floor(n))) : 3;
  if (container) container.style.setProperty('--cols', String(value));
}

// Initialize applied row limit on load
applyRowLimit(SOURCES_ROW_LIMIT);

async function applySettings() {
  sortSelect = document.getElementById('sortOptions');
  modeRadios = Array.from(document.querySelectorAll('#modeOptions input[name="mode"]'));
  hidePostersToggle = document.getElementById('toggleHidePosters');
  searchToggleEl = document.getElementById('toggleSearchBar');
  rowLimitRange = document.getElementById('rowLimitRange');
  
  SOURCES_SORT = sortSelect ? sortSelect.value : 'az';
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
    const v = parseInt(rowLimitRange.value, 10);
    const clamped = Math.max(2, Math.min(10, Number.isFinite(v) ? v : SOURCES_ROW_LIMIT));
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
}
