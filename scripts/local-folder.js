"use strict";

async function handleFolderUpload(event) {
  const files = Array.from(event.target.files || []);
  // Build index of all selected files by relative path (lowercased)
  const filesIndex = {};
  let rootPrefix = '';
  try {
    files.forEach(f => {
      const rp = String((f.webkitRelativePath || f.relativePath || f.name || '')).replace(/\\/g, '/');
      const lower = rp.toLowerCase();
      filesIndex[lower] = f;
      if (!rootPrefix) {
        const i = rp.indexOf('/');
        rootPrefix = (i > 0) ? rp.slice(0, i + 1) : '';
      }
    });
  } catch {}
  // Find all index.json files; prefer the shallowest that has a source manifest (with categories)
  const allIndexFiles = files.filter(f => (f.name || '').toLowerCase() === 'index.json');
  if (!allIndexFiles.length) {
    errorMessage.textContent = "Selected folder must contain index.json";
    errorMessage.style.display = "block";
    return;
  }
  allIndexFiles.sort((a, b) => {
    const pa = String((a.webkitRelativePath || a.relativePath || a.name || '')).split(/[\\\/]+/).length;
    const pb = String((b.webkitRelativePath || b.relativePath || b.name || '')).split(/[\\\/]+/).length;
    return pa - pb;
  });
  let indexFile = null;
  let json = null;
  for (const f of allIndexFiles) {
    try {
      const text = await f.text();
      const candidate = JSON.parse(text);
      if (candidate && Array.isArray(candidate.categories)) { indexFile = f; json = candidate; break; }
      if (!indexFile) { indexFile = f; json = candidate; }
    } catch {}
  }
  if (!json || !indexFile || !Array.isArray(json.categories)) {
    errorMessage.textContent = "Selected folder's root index.json is missing or invalid (no categories). Select the folder that contains the source index.json.";
    errorMessage.style.display = "block";
    return;
  }
  const { title: dirTitle, categories: cats } = json;
  // Derive a stable local source ID from JSON or generate one
  let localId = json.LocalID || json.localId || json.sourceId || json.id;
  if (!localId) {
    try {
      // Generate 6-digit numeric id and prefix with "Local"
      const n = Math.floor((Date.now() + Math.random() * 1000000)) % 1000000;
      localId = `Local${String(n).padStart(6, '0')}`;
    } catch {
      localId = 'Local000000';
    }
  }
  try { sourceKey = localId; } catch {}

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

  let flatCounter = 0;
  videoList = (cats || []).map(cat => ({
    category: cat.category,
    episodes: (cat.episodes || []).map(ep => {
      const fileObj = findEpisodeFile(ep && ep.src);
      const srcUrl = fileObj ? URL.createObjectURL(fileObj) : '';
      const isPlaceholder = !fileObj || (fileObj && fileObj.size === 0);
      const progressKey = `${localId}:item${flatCounter++}`;
      let filePathRel = '';
      let fileBaseDirRel = '';
      try {
        const rp = fileObj ? String((fileObj.webkitRelativePath || fileObj.relativePath || fileObj.name || '')).replace(/\\/g, '/') : '';
        filePathRel = rp;
        fileBaseDirRel = rp ? rp.slice(0, rp.lastIndexOf('/') + 1) : '';
      } catch {}
      return {
        title: ep.title,
        src: srcUrl,
        fileName: fileObj ? (fileObj.name || '') : '',
        progressKey,
        file: fileObj || null,
        filePathRel,
        fileBaseDirRel,
        filesIndex,
        rootPrefix,
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
