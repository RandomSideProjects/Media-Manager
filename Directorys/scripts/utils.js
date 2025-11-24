"use strict";

const RECENT_SOURCES_STORAGE_KEY = 'rsp_recent_sources_list_v1';

// Functions
function formatLocal(dt) {
  try { return new Date(dt).toLocaleString(); } catch { return ''; }
}

function readRecentSourceEntries() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_SOURCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sources)) return [];
    return parsed.sources;
  } catch {
    return [];
  }
}

function buildRecentSourceTimestampMap() {
  const entries = readRecentSourceEntries();
  const map = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const key = typeof entry.path === 'string' ? entry.path : '';
    if (!key) continue;
    const recordedAt = entry.recordedAt || entry.recorded_at || entry.recorded_on || '';
    const parsed = recordedAt ? Date.parse(recordedAt) : NaN;
    const timestamp = Number.isFinite(parsed) ? parsed : 0;
    const existing = map.get(key);
    map.set(key, Math.max(existing || 0, timestamp));
  }
  return map;
}

function getPublicSourceOpenKey(meta) {
  const openPath = (meta && typeof meta.path === 'string' && meta.path)
    ? meta.path
    : `./Files/${meta && meta.file ? meta.file : ''}`;
  const normalized = openPath.replace(/^\.\//, '');
  return `Directorys/${normalized}`;
}

function sortMeta(list, mode) {
  const arr = [...list];
  switch (mode) {
    case 'az':
      arr.sort((a,b)=>String(a.title).localeCompare(String(b.title)));
      break;
    case 'za':
      arr.sort((a,b)=>String(b.title).localeCompare(String(a.title)));
      break;
    case 'newold': {
      arr.sort((a,b)=>{
        const at = a.LatestTime ? Date.parse(a.LatestTime) : (a._mtime||0);
        const bt = b.LatestTime ? Date.parse(b.LatestTime) : (b._mtime||0);
        return bt - at;
      });
      break; }
    case 'oldnew': {
      arr.sort((a,b)=>{
        const at = a.LatestTime ? Date.parse(a.LatestTime) : (a._mtime||0);
        const bt = b.LatestTime ? Date.parse(b.LatestTime) : (b._mtime||0);
        return at - bt;
      });
      break; }
    case 'recent': {
      const timestampMap = buildRecentSourceTimestampMap();
      arr.sort((a,b)=>{
        const aKey = getPublicSourceOpenKey(a);
        const bKey = getPublicSourceOpenKey(b);
        const aTime = timestampMap.get(aKey) || 0;
        const bTime = timestampMap.get(bKey) || 0;
        if (aTime === bTime) {
          return String(a.title || a.file).localeCompare(String(b.title || b.file));
        }
        return bTime - aTime;
      });
      break; }
  }
  return arr;
}

async function hydrateMtimes(list) {
  const tasks = list.map(async (m, idx) => {
    if (m.LatestTime) return; // we have explicit timestamp
    if (typeof m._mtime === 'number') return;
    try {
      const url = new URL(m.path || m.openPath || '', window.location.href).href;
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      const lm = resp.headers.get('last-modified') || resp.headers.get('Last-Modified');
      m._mtime = lm ? Date.parse(lm) : idx;
    } catch {
      m._mtime = idx;
    }
  });
  await Promise.allSettled(tasks);
}

function fitPosterToCard(img, card) {
  const cardH = card.clientHeight;
  const cardW = card.clientWidth;
  const maxH = Math.max(1, Math.floor(cardH * 0.9));   // 90% of card height
  const maxW = Math.max(1, Math.floor(cardW * 0.55));  // keep space for text

  const iw = img.naturalWidth || 0;
  const ih = img.naturalHeight || 0;
  if (!iw || !ih) return;

  const aspect = iw / ih; // width / height
  let targetW, targetH;

  if (ih >= iw) {
    // Portrait (or square): try to use full 90% height
    targetH = maxH;
    targetW = Math.round(targetH * aspect);
    if (targetW > maxW) {
      // Width would overflow; scale down proportionally
      targetW = maxW;
      targetH = Math.round(targetW / aspect);
    }
  } else {
    // Landscape: cap by width first, then ensure we don't exceed maxH
    targetW = maxW;
    targetH = Math.round(targetW / aspect);
    if (targetH > maxH) {
      targetH = maxH;
      targetW = Math.round(targetH * aspect);
    }
  }

  img.style.width  = targetW + 'px';
  img.style.height = targetH + 'px';
  img.style.objectFit = 'contain';
  img.style.objectPosition = 'center';
}
