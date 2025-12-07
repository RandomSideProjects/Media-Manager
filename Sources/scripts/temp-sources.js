"use strict";

// Variables (top)
const tempContainer = document.getElementById('sourcesContainer');
const tempState = { urls: [] };

// First temp source API (IIFE in original)
(function exposeTempSourceAPI(){
  async function addTempSource(input, name) {
    try {
      let data, openParam, displayName = name;
      if (typeof input === 'string') {
        // If string looks like full URL or blob, treat as direct; else resolve relative to this page.
        const isDirect = /^(https?:|blob:)/i.test(input);
        const fetchUrl = isDirect ? input : new URL(input, window.location.href).href;
        const text = await (await fetch(fetchUrl)).text();
        data = JSON.parse(text);
        openParam = isDirect ? input : `Sources/${(input || '').replace(/^\.\//,'')}`;
        displayName = displayName || (data && data.title) || input;
      } else if (input && typeof input === 'object') {
        data = input;
        displayName = displayName || data.title || 'Temporary Source';
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);
        tempState.urls.push(blobUrl);
        openParam = blobUrl; // pass blob URL straight to viewer
      } else {
        throw new Error('addTempSource expects a URL string or a JSON object.');
      }

      const card = buildSourceCard(data, openParam, displayName);
      card.dataset.temp = '1';
      tempContainer.prepend(card);
      console.log('✅ Temp source added:', displayName);
      return card;
    } catch (e) {
      console.error('addTempSource failed:', e);
      throw e;
    }
  }

  function clearTempSources() {
    document.querySelectorAll('.source-card[data-temp="1"]').forEach(el => el.remove());
    tempState.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    tempState.urls = [];
    console.log('🧹 Cleared temporary sources.');
  }

  // Expose to console
  window.addTempSource = addTempSource;
  window.clearTempSources = clearTempSources;
  console.log('%cTip:', 'color:#5ab8ff', 'Use addTempSource(urlOrObject[, name]) to temporarily add a source card. Call clearTempSources() to remove them.');
})();

// ----- Temp source injection helpers (console) -----
function createSourceCard(data, openTarget) {
  const container = document.getElementById('sourcesContainer');
  const title = data.title || 'Temporary Source';
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const seasons = categories.length;
  let episodes = 0;
  categories.forEach(cat => {
    if (Array.isArray(cat.episodes)) episodes += cat.episodes.length;
  });

  const card = document.createElement('div');
  card.className = 'source-card';

  // Left: poster image (preserve aspect ratio, no cropping)
  const { poster: imgUrl, remoteposter: fallbackPoster } = extractPosterPair(data);
  if (imgUrl || fallbackPoster) {
    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.alt = `${title} poster`;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => fitPosterToCard(img, card));
    window.addEventListener('resize', () => fitPosterToCard(img, card));
    applyPosterFallback(img, imgUrl, fallbackPoster, () => { img.style.display = 'none'; card.classList.add('no-thumb'); });
    if (img.complete && img.naturalWidth) fitPosterToCard(img, card);
    card.appendChild(img);
  } else {
    card.classList.add('no-thumb');
  }

  // Right: text/content column
  const right = document.createElement('div');
  right.className = 'source-right';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const p1 = document.createElement('p');
  p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Season' : 'Seasons'}`;
  const p2 = document.createElement('p');
  p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Episode' : 'Episodes'}`;

  const btn = document.createElement('button');
  btn.className = 'pill-button';
  btn.textContent = 'Open';
  if (openTarget) {
    btn.onclick = () => {
      const isFull = /^https?:\/\//i.test(openTarget);
      const srcParam = isFull ? openTarget : `Sources/${openTarget.replace(/^\.\/?/, '')}`;
      window.location.href = `../index.html?source=${encodeURIComponent(srcParam)}`;
    };
  } else {
    btn.disabled = true;
    btn.title = 'No source URL provided for this temporary card';
  }

  right.append(h3, p1, p2, btn);
  card.appendChild(right);

  // Right-click terminology toggle (Season/Categories, Episode/Items)
  card.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (p1.textContent.includes('Season')) {
      p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Category' : 'Categories'}`;
      p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Item' : 'Items'}`;
    } else {
      p1.innerHTML = `<strong>${seasons}</strong> ${seasons === 1 ? 'Season' : 'Seasons'}`;
      p2.innerHTML = `<strong>${episodes}</strong> ${episodes === 1 ? 'Episode' : 'Episodes'}`;
    }
  });

  container.prepend(card);
  return card;
}

async function addTempSource(input) {
  try {
    let data = null;
    let open = null;
    if (typeof input === 'string') {
      // Treat as URL to JSON
      const resp = await fetch(input);
      const text = await resp.text();
      data = JSON.parse(text);
      open = input;
    } else if (input && typeof input === 'object') {
      if (input.data && typeof input.data === 'object') {
        data = input.data;
      }
      if (typeof input.url === 'string') {
        const resp = await fetch(input.url);
        const text = await resp.text();
        data = JSON.parse(text);
        open = input.url;
      }
      if (typeof input.open === 'string') open = input.open; // explicit open target
    }
    if (!data) throw new Error('No data provided or failed to fetch/parse JSON.');
    createSourceCard(data, open);
    console.log('Temp source added:', data.title || '(untitled)');
  } catch (e) {
    console.error('addTempSource error:', e);
  }
}

// Expose to console (override prior assignment like original)
window.addTempSource = addTempSource;
