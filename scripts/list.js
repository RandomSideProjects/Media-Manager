"use strict";

function renderEpisodeList() {
  episodeList.innerHTML = '';
  flatList = [];
  const showCategoryTitle = Array.isArray(videoList) && videoList.length > 1;

  videoList.forEach(category => {
    if (showCategoryTitle) {
      const catTitle = document.createElement('div');
      catTitle.className = 'category-title';
      catTitle.textContent = category.category;
      episodeList.appendChild(catTitle);
    }

    (category.episodes || []).forEach(episode => {
      const index = flatList.length;
      flatList.push(episode);

      const button = document.createElement('button');
      button.className = 'episode-button';

      const left = document.createElement('span');
      left.textContent = episode.title;
      const right = document.createElement('span');
      right.className = 'episode-meta';

      const lowerSrc = String(episode.src || '').toLowerCase();
      const lowerName = String(episode.fileName || '').toLowerCase();
      const isManga = (/\.(cbz|json)(?:$|[?#])/i.test(lowerSrc)) || lowerName.endsWith('.cbz') || lowerName.endsWith('.json') || (typeof episode.VolumePageCount === 'number');
      if (isManga) {
        let totalPages = Number.isFinite(Number(episode.VolumePageCount)) ? Number(episode.VolumePageCount) : NaN;
        if (!Number.isFinite(totalPages)) {
          let lsPages = NaN;
          if (episode && episode.progressKey) lsPages = parseInt(localStorage.getItem(String(episode.progressKey) + ':cbzPages'), 10);
          if (!Number.isFinite(lsPages)) lsPages = parseInt(localStorage.getItem((episode.src || '') + ':cbzPages'), 10);
          if (Number.isFinite(lsPages)) totalPages = lsPages;
        }
        let savedPage = NaN;
        if (episode && episode.progressKey) savedPage = parseInt(localStorage.getItem(String(episode.progressKey) + ':cbzPage'), 10);
        if (!Number.isFinite(savedPage)) savedPage = parseInt(localStorage.getItem((episode.src || '') + ':cbzPage'), 10);
        const hasSaved = Number.isFinite(savedPage) && savedPage > 0;
        if (Number.isFinite(totalPages) && totalPages > 0) {
          right.textContent = hasSaved ? `${savedPage} / ${totalPages}` : `${totalPages}`;
        } else if (hasSaved) {
          right.textContent = `${savedPage}`;
        } else {
          right.textContent = '';
        }
      } else {
        let durationSec = Number.isFinite(Number(episode.durationSeconds)) ? Number(episode.durationSeconds) : NaN;
        if (!Number.isFinite(durationSec)) {
          let lsDur = NaN;
          if (episode && episode.progressKey) {
            lsDur = parseFloat(localStorage.getItem(String(episode.progressKey) + ':duration'));
          }
          if (!Number.isFinite(lsDur)) {
            lsDur = parseFloat(localStorage.getItem((episode.src || '') + ':duration'));
          }
          if (Number.isFinite(lsDur)) durationSec = Math.round(lsDur);
        }
        let watched = NaN;
        if (episode && episode.progressKey) watched = parseFloat(localStorage.getItem(String(episode.progressKey)));
        if (!Number.isFinite(watched)) watched = parseFloat(localStorage.getItem(episode.src || ''));
        const hasWatched = Number.isFinite(watched) && watched > 0;
        if (Number.isFinite(durationSec) && durationSec > 0) {
          right.textContent = hasWatched ? `${formatTime(watched)} / ${formatTime(durationSec)}` : `${formatTime(durationSec)}`;
        } else if (hasWatched) {
          right.textContent = `${formatTime(watched)}`;
        } else {
          right.textContent = '';
        }
      }

      button.append(left, right);
      button.addEventListener('click', () => {
        localStorage.setItem('lastEpSrc', episode.src);
        writeSourceScopedValue('SavedItem', String(index));
        currentIndex = index;
        selectorScreen.style.display = 'none';
        playerScreen.style.display = 'block';
        backBtn.style.display = 'inline-block';
        theaterBtn.style.display = 'inline-block';
        loadVideo(currentIndex);
      });
      episodeList.appendChild(button);
    });
  });

  if (flatList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No items available in this source yet.';
    episodeList.appendChild(empty);
  }
}

function showResumeMessage() {
  const resumeEl = document.getElementById('resumeMessage');
  const lastSrc = localStorage.getItem('lastEpSrc');
  if (!lastSrc) { resumeEl.style.display = 'none'; return; }
  const savedTime = parseFloat(localStorage.getItem(lastSrc));
  const duration = parseFloat(localStorage.getItem(lastSrc + ':duration'));
  if (isNaN(savedTime) || isNaN(duration)) { resumeEl.style.display = 'none'; return; }
  const savedIdxRaw = readSourceScopedValue('SavedItem');
  const savedIdx = parseInt(savedIdxRaw, 10);
  const idx = flatList.findIndex(ep => ep.src === lastSrc);
  if (idx < 0) { resumeEl.style.display = 'none'; return; }
  const epNum = idx + 1;
  const nextNum = epNum + 1;
  const fraction = savedTime / duration;
  const message = (fraction >= 0.9 && nextNum <= flatList.length)
    ? `Next up, <a id="resumeLink">Episode ${nextNum}</a>`
    : `You left off on <a id=\"resumeLink\">Episode ${epNum}</a>`;
  resumeEl.style.display = 'block';
  resumeEl.innerHTML = message;
  const link = document.getElementById('resumeLink');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetIdx = (fraction >= 0.9 && nextNum <= flatList.length) ? idx + 1 : idx;
      currentIndex = targetIdx;
      selectorScreen.style.display = 'none';
      playerScreen.style.display = 'block';
      backBtn.style.display = 'inline-block';
      theaterBtn.style.display = 'inline-block';
      loadVideo(targetIdx);
    });
  }
}
