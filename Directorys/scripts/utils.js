"use strict";

// Functions
function formatLocal(dt) {
  try { return new Date(dt).toLocaleString(); } catch { return ''; }
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

