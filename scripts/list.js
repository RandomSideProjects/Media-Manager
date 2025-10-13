"use strict";

function coerceSeparatedFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  }
  return false;
}

function normalizeSeparatedEpisode(entry, context) {
  const separatedFlag = coerceSeparatedFlag(entry.separated ?? entry.seperated);
  let rawParts = Array.isArray(entry.sources)
    ? entry.sources
    : Array.isArray(entry.parts)
      ? entry.parts
      : Array.isArray(entry.items)
        ? entry.items
        : [];
  if ((!rawParts || rawParts.length === 0) && Array.isArray(entry.__separatedParts)) {
    rawParts = entry.__separatedParts;
  }
  if (!separatedFlag || rawParts.length === 0) return entry;

  const normalizedParts = rawParts.map((rawPart, idx) => {
    if (!rawPart || typeof rawPart !== 'object') return null;
    const src = typeof rawPart.src === 'string' ? rawPart.src.trim() : '';
    if (!src) return null;
    const durationRaw = rawPart.durationSeconds ?? rawPart.partDurationSeconds ?? rawPart.DurationSeconds;
    const duration = Number(durationRaw);
    const fileSizeRaw = rawPart.fileSizeBytes ?? rawPart.partfileSizeBytes ?? rawPart.ItemfileSizeBytes ?? rawPart.itemFileSizeBytes;
    const fileSize = Number(fileSizeRaw);
    return {
      title: typeof rawPart.title === 'string' ? rawPart.title : `Part ${idx + 1}`,
      src,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
      fileSizeBytes: Number.isFinite(fileSize) && fileSize > 0 ? Math.round(fileSize) : null,
      _raw: rawPart
    };
  }).filter(Boolean);

  if (!normalizedParts.length) return entry;

  let totalDuration = Number(entry.durationSeconds);
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    let sumDuration = 0;
    let counted = 0;
    normalizedParts.forEach((part) => {
      if (Number.isFinite(part.durationSeconds) && part.durationSeconds > 0) {
        sumDuration += part.durationSeconds;
        counted += 1;
      }
    });
    if (counted > 0) totalDuration = sumDuration;
  }
  const offsets = [];
  let runningDuration = 0;
  normalizedParts.forEach((part) => {
    offsets.push(runningDuration);
    if (Number.isFinite(part.durationSeconds) && part.durationSeconds > 0) {
      runningDuration += part.durationSeconds;
    }
  });
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    totalDuration = runningDuration;
  }

  let totalFileSize = Number(entry.fileSizeBytes);
  if (!Number.isFinite(totalFileSize) || totalFileSize <= 0) {
    let sumSize = 0;
    let counted = 0;
    normalizedParts.forEach((part) => {
      if (Number.isFinite(part.fileSizeBytes) && part.fileSizeBytes > 0) {
        sumSize += part.fileSizeBytes;
        counted += 1;
      }
    });
    if (counted > 0) totalFileSize = sumSize;
  }
  if (!Number.isFinite(totalFileSize) || totalFileSize <= 0) {
    const itemSizeRaw = entry.ItemfileSizeBytes ?? entry.itemFileSizeBytes;
    const altSize = Number(itemSizeRaw);
    if (Number.isFinite(altSize) && altSize > 0) totalFileSize = Math.round(altSize);
  }

  const normalizedEntry = { ...entry };
  normalizedEntry.__separatedItem = true;
  normalizedEntry.__separatedParts = normalizedParts;
  normalizedEntry.__separatedOffsets = offsets;
  normalizedEntry.__separatedTotalDuration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : null;
  normalizedEntry.__separatedTotalFileSize = Number.isFinite(totalFileSize) && totalFileSize > 0 ? totalFileSize : null;
  normalizedEntry.__separatedPartCount = normalizedParts.length;
  normalizedEntry.__separatedDurations = normalizedParts.map(part => Number.isFinite(part.durationSeconds) && part.durationSeconds > 0 ? part.durationSeconds : null);
  normalizedEntry.separated = 1;
  normalizedEntry.seperated = 1;
  if (!normalizedEntry.src && normalizedParts[0] && normalizedParts[0].src) {
    normalizedEntry.src = normalizedParts[0].src;
  }
  if (Number.isFinite(totalDuration) && totalDuration > 0) {
    normalizedEntry.durationSeconds = totalDuration;
  }
  if (Number.isFinite(totalFileSize) && totalFileSize > 0) {
    normalizedEntry.fileSizeBytes = totalFileSize;
  }

  const categoryTitle = context && typeof context.categoryTitle === 'string' ? context.categoryTitle : '';
  const episodeTitle = typeof normalizedEntry.title === 'string' ? normalizedEntry.title : '';
  const episodeIndex = Number.isFinite(Number(context && context.episodeIndex)) ? Number(context.episodeIndex) : 0;
  const resumeSeed = `${categoryTitle}::${episodeTitle}::${episodeIndex}`;
  const resumeKey = `sepitem:${hashStringToKey(resumeSeed || `${Date.now()}`)}`;
  normalizedEntry.__separatedResumeKey = resumeKey;
  if (!normalizedEntry.progressKey) normalizedEntry.progressKey = resumeKey;

  return normalizedEntry;
}

function isEpisodeManga(item) {
  if (!item) return false;
  try {
    const lowerSrc = String(item.src || '').toLowerCase();
    const lowerName = String(item.fileName || '').toLowerCase();
    if (/\.(cbz|json)(?:$|[?#])/i.test(lowerSrc)) return true;
    if (lowerName.endsWith('.cbz') || lowerName.endsWith('.json')) return true;
    return typeof item.VolumePageCount === 'number';
  } catch {
    return false;
  }
}

function shouldTreatCategoryAsSeparated(category) {
  if (!category || Number(category.separated) !== 1) return false;
  const episodes = Array.isArray(category.episodes) ? category.episodes : [];
  if (!episodes.length) return false;
  return episodes.every(ep => !isEpisodeManga(ep));
}

function buildSeparatedResumeKey(startIndex) {
  const base = (sourceKey && typeof sourceKey === 'string' && sourceKey.trim()) ? sourceKey.trim() : 'source';
  return `separated:${base}:${startIndex}`;
}

function findNextDistinctIndex(startIdx) {
  if (!Array.isArray(flatList) || startIdx < 0 || startIdx >= flatList.length) return flatList.length;
  const current = flatList[startIdx];
  const currentGroupId = current && current.__separatedGroup ? current.__separatedGroup.id : null;
  for (let i = startIdx + 1; i < flatList.length; i++) {
    const candidate = flatList[i];
    const candidateGroupId = candidate && candidate.__separatedGroup ? candidate.__separatedGroup.id : null;
    if (currentGroupId && candidateGroupId === currentGroupId) continue;
    return i;
  }
  return flatList.length;
}

function renderEpisodeList() {
  episodeList.innerHTML = '';
  flatList = [];
  const showCategoryTitle = Array.isArray(videoList) && videoList.length > 1;
  let separatedGroupCounter = 0;

  videoList.forEach((category, categoryIdx) => {
    const categoryTitle = (category && category.category) ? category.category : `Category ${categoryIdx + 1}`;
    const episodes = Array.isArray(category && category.episodes) ? category.episodes : [];
    const useSeparated = shouldTreatCategoryAsSeparated(category);

    if (showCategoryTitle) {
      const catTitle = document.createElement('div');
      catTitle.className = 'category-title';
      catTitle.textContent = categoryTitle;
      episodeList.appendChild(catTitle);
    }

    if (useSeparated) {
      if (!episodes.length) return;
      const groupId = `${separatedGroupCounter++}`;
      const startIndex = flatList.length;
      const resumeKey = buildSeparatedResumeKey(startIndex);
      let totalDuration = 0;
      const entries = episodes.map((episode, partIdx) => {
        const entry = { ...episode };
        entry.__categoryTitle = categoryTitle;
        const groupInfo = {
          id: groupId,
          order: partIdx,
          total: episodes.length,
          categoryTitle,
          resumeKey,
          startIndex,
          endIndex: startIndex
        };
        entry.__separatedGroup = groupInfo;
        entry.__groupResumeKey = resumeKey;
        if (typeof entry.durationSeconds === 'number' && Number.isFinite(entry.durationSeconds)) {
          totalDuration += entry.durationSeconds;
        }
        flatList.push(entry);
        return entry;
      });
      const endIndex = flatList.length - 1;
      entries.forEach(entry => {
        if (entry.__separatedGroup) {
          entry.__separatedGroup.startIndex = startIndex;
          entry.__separatedGroup.endIndex = endIndex;
        }
      });

      const button = document.createElement('button');
      button.className = 'episode-button separated-category';
      const left = document.createElement('span');
      left.textContent = categoryTitle;
      const right = document.createElement('span');
      right.className = 'episode-meta';
      const partsLabel = `${entries.length} part${entries.length === 1 ? '' : 's'}`;
      if (totalDuration > 0) {
        right.textContent = `${partsLabel} · ${formatTime(totalDuration)}`;
      } else {
        right.textContent = partsLabel;
      }
      button.append(left, right);
      button.addEventListener('click', () => {
        if (resumeKey) localStorage.setItem('lastEpSrc', resumeKey);
        writeSourceScopedValue('SavedItem', String(startIndex));
        currentIndex = startIndex;
        selectorScreen.style.display = 'none';
        playerScreen.style.display = 'block';
        backBtn.style.display = 'inline-block';
        theaterBtn.style.display = 'inline-block';
        loadVideo(currentIndex);
      });
      episodeList.appendChild(button);
      return;
    }

    episodes.forEach((episode, episodeIndex) => {
      const entry = normalizeSeparatedEpisode({ ...episode }, { categoryTitle, episodeIndex });
      if (entry.__separatedItem) {
        try {
          const original = (category && Array.isArray(category.episodes)) ? category.episodes[episodeIndex] : null;
          if (original && typeof original === 'object') {
            const patched = Object.assign({}, original, {
              fileSizeBytes: entry.fileSizeBytes,
              durationSeconds: entry.durationSeconds,
              separated: 1,
              seperated: 1,
              src: entry.src || original.src,
              ItemfileSizeBytes: entry.fileSizeBytes
            });
            if (entry.progressKey && !original.progressKey) patched.progressKey = entry.progressKey;
            if (entry.__separatedParts) {
              patched.__separatedParts = entry.__separatedParts.slice();
            }
            if (entry.__separatedDurations) {
              patched.__separatedDurations = entry.__separatedDurations.slice();
            }
            if (entry.__separatedResumeKey) patched.__separatedResumeKey = entry.__separatedResumeKey;
            if (Array.isArray(entry.sources)) patched.sources = entry.sources.slice();
            else if (Array.isArray(original.sources)) patched.sources = original.sources.slice();
            category.episodes[episodeIndex] = patched;
          }
        } catch {}
      }
      entry.__categoryTitle = categoryTitle;
      const index = flatList.length;
      flatList.push(entry);

      const button = document.createElement('button');
      button.className = 'episode-button';

      const left = document.createElement('span');
      left.textContent = entry.title || `Item ${index + 1}`;
      const right = document.createElement('span');
      right.className = 'episode-meta';

      const isManga = isEpisodeManga(entry);
      if (isManga) {
        let totalPages = Number.isFinite(Number(entry.VolumePageCount)) ? Number(entry.VolumePageCount) : NaN;
        if (!Number.isFinite(totalPages)) {
          let lsPages = NaN;
          if (entry && entry.progressKey) lsPages = parseInt(localStorage.getItem(String(entry.progressKey) + ':cbzPages'), 10);
          if (!Number.isFinite(lsPages)) lsPages = parseInt(localStorage.getItem((entry.src || '') + ':cbzPages'), 10);
          if (Number.isFinite(lsPages)) totalPages = lsPages;
        }
        let savedPage = NaN;
        if (entry && entry.progressKey) savedPage = parseInt(localStorage.getItem(String(entry.progressKey) + ':cbzPage'), 10);
        if (!Number.isFinite(savedPage)) savedPage = parseInt(localStorage.getItem((entry.src || '') + ':cbzPage'), 10);
        const hasSaved = Number.isFinite(savedPage) && savedPage > 0;
        if (Number.isFinite(totalPages) && totalPages > 0) {
          right.textContent = hasSaved ? `${savedPage} / ${totalPages}` : `${totalPages}`;
        } else if (hasSaved) {
          right.textContent = `${savedPage}`;
        } else {
          right.textContent = '';
        }
      } else {
        let durationSec = Number.isFinite(Number(entry.durationSeconds)) ? Number(entry.durationSeconds) : NaN;
        if (!Number.isFinite(durationSec)) {
          let lsDur = NaN;
          if (entry && entry.progressKey) {
            lsDur = parseFloat(localStorage.getItem(String(entry.progressKey) + ':duration'));
          }
          if (!Number.isFinite(lsDur)) {
            lsDur = parseFloat(localStorage.getItem((entry.src || '') + ':duration'));
          }
          if (Number.isFinite(lsDur)) durationSec = Math.round(lsDur);
        }
        let watched = NaN;
        if (entry && entry.progressKey) watched = parseFloat(localStorage.getItem(String(entry.progressKey)));
        if (!Number.isFinite(watched)) watched = parseFloat(localStorage.getItem(entry.src || ''));
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
        const resumeKey = resolveResumeKeyForItem(entry);
        if (resumeKey) localStorage.setItem('lastEpSrc', resumeKey);
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
  if (!resumeEl) return;
  const lastKey = localStorage.getItem('lastEpSrc');
  if (!lastKey || !Array.isArray(flatList) || flatList.length === 0) { resumeEl.style.display = 'none'; return; }
  const idx = flatList.findIndex(item => {
    const key = resolveResumeKeyForItem(item);
    if (key) return key === lastKey;
    if (item && item.src) return item.src === lastKey;
    return false;
  });
  if (idx < 0) { resumeEl.style.display = 'none'; return; }
  const item = flatList[idx];
  const group = item && item.__separatedGroup ? item.__separatedGroup : null;
  const displayTitle = group
    ? (group.categoryTitle || item.__categoryTitle || item.title || 'Item')
    : (item.title || item.__categoryTitle || 'Item');
  const startIndex = group ? group.startIndex : idx;
  const nextIdx = findNextDistinctIndex(startIndex);
  let message = `You left off on <a id="resumeLink">${displayTitle}</a>`;
  let targetIndex = startIndex;
  if (!group) {
    const savedTime = parseFloat(localStorage.getItem(lastKey));
    const duration = parseFloat(localStorage.getItem(`${lastKey}:duration`));
    if (Number.isFinite(savedTime) && Number.isFinite(duration) && duration > 0 && nextIdx < flatList.length) {
      const fraction = savedTime / duration;
      if (fraction >= 0.9) {
        const nextItem = flatList[nextIdx];
        const nextGroup = nextItem && nextItem.__separatedGroup ? nextItem.__separatedGroup : null;
        const nextTitle = nextGroup
          ? (nextGroup.categoryTitle || nextItem.__categoryTitle || nextItem.title || `Item ${nextIdx + 1}`)
          : (nextItem.title || nextItem.__categoryTitle || `Item ${nextIdx + 1}`);
        message = `Next up, <a id="resumeLink">${nextTitle}</a>`;
        targetIndex = nextGroup ? nextGroup.startIndex : nextIdx;
      }
    }
  } else if (nextIdx < flatList.length) {
    // For separated groups we always prompt to resume the group; next completion relies on player auto-advance.
    targetIndex = startIndex;
  }
  resumeEl.style.display = 'block';
  resumeEl.innerHTML = message;
  const link = document.getElementById('resumeLink');
  if (link) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      currentIndex = targetIndex;
      selectorScreen.style.display = 'none';
      playerScreen.style.display = 'block';
      backBtn.style.display = 'inline-block';
      theaterBtn.style.display = 'inline-block';
      loadVideo(currentIndex);
    });
  }
}
