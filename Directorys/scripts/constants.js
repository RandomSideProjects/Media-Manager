"use strict";

// Variables (top)
const STATUS_URL = 'https://files.catbox.moe/6gkiu0.png';
let SOURCES_SORT = localStorage.getItem('sources_sortOrder') || 'az';
let SOURCES_HIDE_POSTERS = localStorage.getItem('sources_hidePosters') === '1';
let SOURCES_META = [];
let SOURCES_ROW_LIMIT = (function(){
  const v = parseInt(localStorage.getItem('sources_rowLimit') || '3', 10);
  return (Number.isFinite(v) && v >= 2 && v <= 10) ? v : 3;
})();
let SOURCES_MODE = (function(){
  const m = (localStorage.getItem('sources_mode') || 'anime').toLowerCase();
  return (m === 'manga') ? 'manga' : 'anime';
})();
