"use strict";

async function handleFolderUpload(event) {
  const files = Array.from(event.target.files || []);
  // Find index.json anywhere in the selected directory tree
  const indexFile = files.find(f => (f.name || '').toLowerCase() === 'index.json');
  if (!indexFile) {
    errorMessage.textContent = "Selected folder must contain index.json";
    errorMessage.style.display = "block";
    return;
  }
  let json;
  try {
    const text = await indexFile.text();
    json = JSON.parse(text);
  } catch (e) {
    errorMessage.textContent = "Failed to read or parse index.json";
    errorMessage.style.display = "block";
    return;
  }
  const { title: dirTitle, categories: cats } = json;

  // Helper to resolve a file for an episode by matching the relative path suffix if possible
  function findEpisodeFile(epSrc) {
    try {
      const parts = String(epSrc || '').split('/').filter(Boolean);
      const fileName = parts.pop() || '';
      const categoryFolder = parts.pop() || '';
      // Prefer matching by relative path suffix
      const bySuffix = files.find(f => {
        const rp = (f.webkitRelativePath || f.relativePath || f.name || '').replace(/\\/g, '/');
        return rp.endsWith(`/${categoryFolder}/${fileName}`);
      });
      if (bySuffix) return bySuffix;
      // Fallback: match by file name; if multiple, return the first
      const candidates = files.filter(f => (f.name || '') === fileName);
      return candidates[0] || null;
    } catch { return null; }
  }

  videoList = (cats || []).map(cat => ({
    category: cat.category,
    episodes: (cat.episodes || []).map(ep => {
      const fileObj = findEpisodeFile(ep && ep.src);
      const srcUrl = fileObj ? URL.createObjectURL(fileObj) : '';
      const isPlaceholder = !fileObj || (fileObj && fileObj.size === 0);
      return {
        title: ep.title,
        src: srcUrl,
        fileName: fileObj ? (fileObj.name || '') : '',
        file: fileObj || null,
        isPlaceholder,
        durationSeconds: (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null,
        fileSizeBytes: (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null
      };
    })
  }));
  directoryTitle.textContent = dirTitle;
  try { document.title = `${(dirTitle || '').trim() || 'Source'} on RSP Media Manager`; } catch {}
  sourceImageUrl = '';
  if (directoryPoster) { try { directoryPoster.removeAttribute('src'); } catch {} directoryPoster.style.display = 'none'; }
  if (directoryHeader) directoryHeader.style.display = 'flex';
  directoryTitle.style.display = "block";
  errorMessage.style.display = "none";
  urlInputContainer.style.display = "none";
  selectorScreen.style.display = "flex";
  renderEpisodeList();
  showResumeMessage();
}

if (folderInput) folderInput.addEventListener("change", handleFolderUpload);
