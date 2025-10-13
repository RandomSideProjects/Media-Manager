"use strict";

// Variables (top)
let lastContent = null; // JSON string snapshot for polling compare

async function autoUploadFromContent(contentObj) {
  const payload = { ...contentObj, LatestTime: new Date().toISOString() };
  const jsonString = JSON.stringify(payload, null, 2);
  try {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const file = new File([blob], 'directory.json', { type: 'application/json' });
    const url = await uploadToCatbox(file);
    const normalizer = (typeof window !== 'undefined' && typeof window.mm_normalizeCatboxUrl === 'function')
      ? window.mm_normalizeCatboxUrl
      : null;
    const normalized = normalizer ? normalizer(url) : { url, code: '' };
    const code = (normalized && normalized.code)
      ? normalized.code
      : (url.replace(/^https:\/\/files\.catbox\.moe\//, '').replace(/\.json$/, '').trim());
    if (typeof directoryCode !== 'undefined') {
      directoryCode = code;
    } else if (typeof window !== 'undefined') {
      window.directoryCode = code;
    }
    if (typeof updateOutput === 'function') {
      updateOutput();
    }
  } catch (err) {
    try {
      if (typeof outputEl !== 'undefined') {
        outputEl.textContent = 'Failed to auto-upload: ' + err.message;
      } else if (typeof window !== 'undefined') {
        const el = window.document && window.document.getElementById('output');
        if (el) el.textContent = 'Failed to auto-upload: ' + err.message;
      }
    } catch {}
  }
}

function startAutoUploadPolling() {
  if (window.MM_POLL_TIMER) return; // already started
  if (window.MM_BLOCKED) return;    // don't start when blocked
  window.MM_POLL_TIMER = setInterval(async () => {
    if (window.MM_BLOCKED) return; // hard stop while blocked
    const folderUploading = (
      typeof isFolderUploading !== 'undefined' && isFolderUploading
    ) || (typeof window !== 'undefined' && window.isFolderUploading);
    if (folderUploading) return;
    const titleEl = document.getElementById('dirTitle');
    if (!titleEl) return;
    const titleVal = titleEl.value.trim();
    const mode = (function(){ try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; } })();
    const extractor = (typeof window !== 'undefined' && typeof window.mm_extractEpisodeData === 'function') ? window.mm_extractEpisodeData : null;
    const legacyExtract = (epDiv) => {
      const inputs = epDiv.querySelectorAll('input[type="text"]');
      const title = inputs[0] ? inputs[0].value.trim() : '';
      const src = inputs[1] ? inputs[1].value.trim() : '';
      if (!title || !src) return null;
      const size = Number(epDiv.dataset ? epDiv.dataset.fileSizeBytes : 0);
      if (mode === 'manga') {
        const pages = Number(epDiv.dataset ? (epDiv.dataset.volumePageCount || epDiv.dataset.VolumePageCount) : 0);
        return {
          episode: {
            title,
            src,
            ...(Number.isFinite(size) && size >= 0 ? { fileSizeBytes: Math.round(size) } : {}),
            ...(Number.isFinite(pages) && pages >= 0 ? { VolumePageCount: Math.round(pages) } : {})
          },
          totalFileSize: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
          totalDuration: 0,
          totalPages: Number.isFinite(pages) && pages >= 0 ? Math.round(pages) : 0
        };
      }
      const duration = Number(epDiv.dataset ? epDiv.dataset.durationSeconds : 0);
      return {
        episode: {
          title,
          src,
          ...(Number.isFinite(size) && size >= 0 ? { fileSizeBytes: Math.round(size) } : {}),
          ...(Number.isFinite(duration) && duration >= 0 ? { durationSeconds: Math.round(duration) } : {})
        },
        totalFileSize: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
        totalDuration: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0,
        totalPages: 0
      };
    };

    const cats = [];
    let separatedCategoryCount = 0;
    let separatedItemCount = 0;
    let totalFileSizeBytes = 0;
    let totalDurationSeconds = 0;
    let totalPagecount = 0;

    document.querySelectorAll('.category').forEach(cat => {
      const input = cat.querySelector('.category-header input[type="text"]') || cat.querySelector('label input');
      const catTitle = input ? input.value.trim() : '';
      const eps = [];
      cat.querySelectorAll('.episode').forEach(epDiv => {
        let info = extractor ? extractor(epDiv, { isManga: mode === 'manga' }) : null;
        if (!info || !info.episode) {
          info = legacyExtract(epDiv);
        }
        if (!info || !info.episode) return;
        eps.push(info.episode);
        totalFileSizeBytes += info.totalFileSize || 0;
        if (mode === 'manga') totalPagecount += info.totalPages || 0;
        else totalDurationSeconds += info.totalDuration || 0;
      });
      if (catTitle) {
        const isSeparated = (mode !== 'manga') && cat.dataset && cat.dataset.separated === '1';
        const payload = { category: catTitle, episodes: eps };
        if (isSeparated) {
          payload.separated = 1;
          separatedCategoryCount += 1;
          separatedItemCount += eps.length;
        }
        cats.push(payload);
      }
    });

    const posterValue = (typeof posterImageUrl !== 'undefined')
      ? posterImageUrl
      : ((typeof window !== 'undefined' && typeof window.posterImageUrl !== 'undefined') ? window.posterImageUrl : '');
    const imageField = posterValue || 'N/A';
    // Build payload (omit duration aggregate for manga mode)
    const contentOnly = { title: titleVal, Image: imageField, categories: cats, totalFileSizeBytes };
    if (mode !== 'manga') contentOnly.totalDurationSeconds = totalDurationSeconds; else contentOnly.totalPagecount = totalPagecount;
    if (mode !== 'manga' && separatedCategoryCount > 0) {
      contentOnly.separatedCategoryCount = separatedCategoryCount;
      contentOnly.separatedItemCount = separatedItemCount;
    }
    const contentStr = JSON.stringify(contentOnly);
    if (contentStr !== lastContent) {
      lastContent = contentStr;
      try { await autoUploadFromContent(contentOnly); } catch (err) { console.error('Auto-upload error:', err); }
    }
  }, 500);
}

if (!window.MM_BLOCKED) { startAutoUploadPolling(); }
