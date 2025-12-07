"use strict";

// Variables (top)
let lastUploadedContent = null;     // JSON string snapshot from last successful upload
let lastAttemptedContent = null;    // JSON string for last attempted upload
let lastAutoUploadFailedAt = 0;     // Timestamp of last auto-upload failure
let autoUploadInFlight = false;
let inflightContentStr = null;
const AUTO_UPLOAD_RETRY_DELAY_MS = 2000;
const POLLING_IMAGE_BACKUP_BASE_URL = 'https://raw.githubusercontent.com/RandomSideProjects/Media-Manager/refs/heads/main/';
function resolveRemotePosterUrl(primaryUrl) {
  if (!primaryUrl) return '';
  const str = String(primaryUrl).trim();
  if (!str) return '';
  if (str.toLowerCase() === 'n/a') return '';
  if (/^https?:\/\//i.test(str)) return str;
  const trimmed = str.replace(/^\.\//, '').replace(/^\/+/, '');
  const normalized = trimmed.startsWith('Sources/') ? trimmed : `Sources/${trimmed}`;
  return POLLING_IMAGE_BACKUP_BASE_URL + normalized;
}

function buildAutoUploadPayload() {
  try {
    if (typeof window !== 'undefined' && typeof window.mm_buildLocalDirectoryJSON === 'function') {
      const built = window.mm_buildLocalDirectoryJSON({ includeLatestTime: false });
      if (built && typeof built === 'object') {
        const clone = { ...built };
        try { delete clone.LatestTime; } catch {}
        return clone;
      }
    }
  } catch (err) {
    console.warn('[Creator] Failed to build upload payload from shared helper', err);
  }

  const mode = (function(){
    try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; }
    catch { return 'anime'; }
  })();
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

  const titleEl = document.getElementById('dirTitle');
  const titleVal = titleEl ? titleEl.value.trim() : '';
  const posterValue = (typeof posterImageUrl !== 'undefined')
    ? posterImageUrl
    : ((typeof window !== 'undefined' && typeof window.posterImageUrl !== 'undefined') ? window.posterImageUrl : '');
  const imageField = posterValue || 'N/A';
  const remotePosterUrl = resolveRemotePosterUrl(imageField);
  const contentOnly = {
    title: titleVal,
    poster: imageField,
    categories: cats,
    totalFileSizeBytes
  };
  if (remotePosterUrl) {
    contentOnly.remoteposter = remotePosterUrl;
  }
  const hiddenEnabled = (() => {
    if (typeof window === 'undefined') return false;
    if (window.mm_creatorHidden === true) return true;
    if (window.mm_creatorMaintainerHidden === true) return true;
    const doc = window.document || null;
    if (!doc || typeof doc.getElementById !== 'function') return false;
    const toggle = doc.getElementById('maintainerHiddenToggle');
    return !!(toggle && toggle.checked);
  })();
  if (hiddenEnabled) contentOnly.hidden = true;
  if (mode !== 'manga') contentOnly.totalDurationSeconds = totalDurationSeconds; else contentOnly.totalPagecount = totalPagecount;
  if (mode !== 'manga' && separatedCategoryCount > 0) {
    contentOnly.separatedCategoryCount = separatedCategoryCount;
    contentOnly.separatedItemCount = separatedItemCount;
  }
  return contentOnly;
}

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
if (typeof window !== 'undefined') {
  window.mm_autoUploadFromContent = autoUploadFromContent;
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
    const contentOnly = buildAutoUploadPayload();
    if (!contentOnly) return;
    const contentStr = JSON.stringify(contentOnly);
    if (contentStr === lastUploadedContent) return;

    const now = Date.now();
    const sameAttempt = contentStr === lastAttemptedContent;
    const withinRetryDelay = sameAttempt && (now - lastAutoUploadFailedAt) < AUTO_UPLOAD_RETRY_DELAY_MS;
    if (withinRetryDelay) return;

    if (autoUploadInFlight) {
      if (contentStr === inflightContentStr) return;
      // Different content while an upload is in-flight; wait for current upload to finish then next poll will catch it
      return;
    }

    lastAttemptedContent = contentStr;
    autoUploadInFlight = true;
    inflightContentStr = contentStr;
    try {
      await autoUploadFromContent(contentOnly);
      lastUploadedContent = contentStr;
      lastAutoUploadFailedAt = 0;
    } catch (err) {
      lastAutoUploadFailedAt = now;
      console.error('Auto-upload error:', err);
    } finally {
      autoUploadInFlight = false;
      inflightContentStr = null;
    }
  }, 500);
}

if (!window.MM_BLOCKED) { startAutoUploadPolling(); }
