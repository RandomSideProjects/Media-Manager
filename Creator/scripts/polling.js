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
    const cats = [];
    let separatedCategoryCount = 0;
    let separatedItemCount = 0;
    document.querySelectorAll('.category').forEach(cat => {
      const input = cat.querySelector('.category-header input[type="text"]');
      const catTitle = input ? input.value.trim() : '';
      const eps = [];
      cat.querySelectorAll('.episode').forEach(epDiv => {
        const inputs = epDiv.querySelectorAll('input[type="text"]');
        const t = inputs[0] ? inputs[0].value.trim() : '';
        const s = inputs[1] ? inputs[1].value.trim() : '';
        let fs = null, dur = null;
        try { const v = parseFloat(epDiv.dataset.fileSizeBytes); if (Number.isFinite(v) && v >= 0) fs = Math.round(v); } catch {}
        if (mode === 'manga') {
          let pages = null; try { const v = parseFloat(epDiv.dataset.volumePageCount || epDiv.dataset.VolumePageCount); if (Number.isFinite(v) && v >= 0) pages = Math.round(v); } catch {}
          if (t && s) eps.push({ title: t, src: s, fileSizeBytes: fs, VolumePageCount: pages });
        } else {
          try { const v = parseFloat(epDiv.dataset.durationSeconds); if (Number.isFinite(v) && v >= 0) dur = Math.round(v); } catch {}
          if (t && s) eps.push({ title: t, src: s, fileSizeBytes: fs, durationSeconds: dur });
        }
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
    let totalFileSizeBytes = 0;
    let totalDurationSeconds = 0;
    let totalPagecount = 0;
    for (const c of cats) {
      for (const e of c.episodes) {
        if (typeof e.fileSizeBytes === 'number' && Number.isFinite(e.fileSizeBytes)) totalFileSizeBytes += e.fileSizeBytes;
        if (typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds)) totalDurationSeconds += e.durationSeconds;
        if (typeof e.VolumePageCount === 'number' && Number.isFinite(e.VolumePageCount)) totalPagecount += e.VolumePageCount;
      }
    }
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
