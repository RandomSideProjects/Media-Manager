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
    directoryCode = url.replace(/^https:\/\/files\.catbox\.moe\//, '').replace(/\.json$/, '').trim();
    updateOutput();
  } catch (err) {
    outputEl.textContent = 'Failed to auto-upload: ' + err.message;
  }
}

function startAutoUploadPolling() {
  if (window.MM_POLL_TIMER) return; // already started
  if (window.MM_BLOCKED) return;    // don't start when blocked
  window.MM_POLL_TIMER = setInterval(async () => {
    if (window.MM_BLOCKED) return; // hard stop while blocked
    if (isFolderUploading) return;
    const titleEl = document.getElementById('dirTitle');
    if (!titleEl) return;
    const titleVal = titleEl.value.trim();
    const cats = [];
    document.querySelectorAll('.category').forEach(cat => {
      const input = cat.querySelector('label input');
      const catTitle = input ? input.value.trim() : '';
      const eps = [];
      cat.querySelectorAll('.episode').forEach(epDiv => {
        const inputs = epDiv.querySelectorAll('input[type="text"]');
        const t = inputs[0] ? inputs[0].value.trim() : '';
        const s = inputs[1] ? inputs[1].value.trim() : '';
        let fs = null, dur = null;
        try { const v = parseFloat(epDiv.dataset.fileSizeBytes); if (Number.isFinite(v) && v >= 0) fs = Math.round(v); } catch {}
        try { const v = parseFloat(epDiv.dataset.durationSeconds); if (Number.isFinite(v) && v >= 0) dur = Math.round(v); } catch {}
        if (t && s) eps.push({ title: t, src: s, fileSizeBytes: fs, durationSeconds: dur });
      });
      if (catTitle) cats.push({ category: catTitle, episodes: eps });
    });
    const imageField = posterImageUrl || 'N/A';
    let totalFileSizeBytes = 0;
    let totalDurationSeconds = 0;
    for (const c of cats) {
      for (const e of c.episodes) {
        if (typeof e.fileSizeBytes === 'number' && Number.isFinite(e.fileSizeBytes)) totalFileSizeBytes += e.fileSizeBytes;
        if (typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds)) totalDurationSeconds += e.durationSeconds;
      }
    }
    const contentOnly = { title: titleVal, Image: imageField, categories: cats, totalFileSizeBytes, totalDurationSeconds };
    const contentStr = JSON.stringify(contentOnly);
    if (contentStr !== lastContent) {
      lastContent = contentStr;
      try { await autoUploadFromContent(contentOnly); } catch (err) { console.error('Auto-upload error:', err); }
    }
  }, 500);
}

if (!window.MM_BLOCKED) { startAutoUploadPolling(); }

