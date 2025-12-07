"use strict";

// Globals
let videoList = [];
let sourceKey = '';
let sourceKeyHistory = [];
let flatList = [];
let currentIndex = 0;
let sourceImageUrl = '';
const IMAGE_BACKUP_BASE_URL = 'https://raw.githubusercontent.com/RandomSideProjects/Media-Manager/refs/heads/main/';

function resolveRemotePosterUrl(primaryUrl) {
  if (!primaryUrl) return '';
  const str = String(primaryUrl).trim();
  if (!str) return '';
  if (/^https?:\/\//i.test(str)) return str;
  const trimmed = str.replace(/^\.\//, '').replace(/^\/+/, '');
  const normalized = trimmed.startsWith('Sources/') ? trimmed : `Sources/${trimmed}`;
  return IMAGE_BACKUP_BASE_URL + normalized;
}

const resolveImage2Url = resolveRemotePosterUrl;

function extractPosterPair(entry) {
  if (!entry || typeof entry !== 'object') return { poster: '', remoteposter: '' };
  const poster = (typeof entry.poster === 'string' && entry.poster !== 'N/A')
    ? entry.poster
    : (typeof entry.Image === 'string' && entry.Image !== 'N/A')
      ? entry.Image
      : (typeof entry.image === 'string' && entry.image !== 'N/A' ? entry.image : '');
  const remoteposter = (typeof entry.remoteposter === 'string' && entry.remoteposter)
    ? entry.remoteposter
    : (typeof entry.Image2 === 'string' && entry.Image2)
      ? entry.Image2
      : resolveRemotePosterUrl(poster);
  return { poster: poster || '', remoteposter: remoteposter || '' };
}

function applyPosterFallback(img, primaryUrl, backupUrl, onFail) {
  if (!img) return;
  const fallback = backupUrl || resolveRemotePosterUrl(primaryUrl);
  let triedBackup = false;
  const hidePoster = () => {
    img.style.display = 'none';
    try { img.removeAttribute('src'); } catch {}
    if (typeof onFail === 'function') {
      try { onFail(); } catch {}
    }
  };
  img.addEventListener('error', () => {
    if (!triedBackup && fallback && img.src !== fallback) {
      triedBackup = true;
      img.src = fallback;
      return;
    }
    hidePoster();
  });
  if (primaryUrl) {
    img.src = primaryUrl;
  } else if (fallback) {
    img.src = fallback;
  } else {
    hidePoster();
  }
}

function hashStringToKey(value) {
  const str = String(value || '');
  if (!str) return '0';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

function deriveSourceKey(rawValue, options) {
  const opts = options || {};
  const rawInput = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '').trim();
  if (!rawInput) {
    const fallbackPrefix = typeof opts.prefix === 'string' && opts.prefix.trim() ? opts.prefix.trim().toLowerCase() : 'source';
    return `${fallbackPrefix}-anon`;
  }

  if (opts.useRawKey === true) {
    return rawInput;
  }

  const prefix = typeof opts.prefix === 'string' && opts.prefix.trim() ? opts.prefix.trim().toLowerCase() : 'source';
  const cleaned = rawInput.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const maxLen = 48;
  if (cleaned && cleaned.length <= maxLen) {
    return `${prefix}-${cleaned}`;
  }

  const slug = cleaned ? cleaned.slice(0, Math.max(8, Math.min(24, cleaned.length))) : 'src';
  const hash = hashStringToKey(rawInput);
  return `${prefix}-${slug}-${hash}`;
}

function setSourceKey(rawValue, options) {
  const primary = deriveSourceKey(rawValue, options);
  sourceKey = primary;
  const history = [primary];
  const raw = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '').trim();
  if (raw && raw !== primary) history.push(raw);
  const extra = (options && Array.isArray(options.aliases)) ? options.aliases : [];
  extra.forEach((alias) => {
    if (typeof alias === 'string' && alias && alias !== primary) history.push(alias);
  });
  sourceKeyHistory = history.filter((key, idx) => history.indexOf(key) === idx);
  try { localStorage.setItem('currentSourceKey', primary); } catch {}
  return primary;
}

function getSourceKeyCandidates(includeLegacy = true) {
  if (!includeLegacy) return sourceKey ? [sourceKey] : [];
  if (Array.isArray(sourceKeyHistory) && sourceKeyHistory.length) return sourceKeyHistory.slice();
  return sourceKey ? [sourceKey] : [];
}

function readSourceScopedValue(suffix) {
  if (!suffix) return null;
  const parts = getSourceKeyCandidates(true);
  for (let i = 0; i < parts.length; i++) {
    try {
      const value = localStorage.getItem(`${parts[i]}:${suffix}`);
      if (value !== null && value !== undefined) return value;
    } catch {}
  }
  return null;
}

function writeSourceScopedValue(suffix, value) {
  if (!suffix) return;
  const key = `${sourceKey}:${suffix}`;
  try { localStorage.setItem(key, value); }
  catch {}
  const legacyKeys = getSourceKeyCandidates(true).filter((candidate) => candidate && candidate !== sourceKey);
  legacyKeys.forEach((candidate) => {
    try { localStorage.removeItem(`${candidate}:${suffix}`); } catch {}
  });
}

// Utils
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = num;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatBytesDecimalMaxUnit(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const base = 1000;
  let i = 0; let v = num;
  while (v >= base && i < units.length - 1) { v /= base; i++; }
  if (v < 1 && i > 0) { v *= base; i -= 1; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function resolveResumeKeyForItem(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.__separatedResumeKey) return String(item.__separatedResumeKey);
  if (item.__groupResumeKey) return String(item.__groupResumeKey);
  if (item.__separatedGroup && item.__separatedGroup.resumeKey) return String(item.__separatedGroup.resumeKey);
  if (item.progressKey) return String(item.progressKey);
  if (item.src) return String(item.src);
  return '';
}
