"use strict";

function coerceSeparatedFlag(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return false;
    if (['1','true','yes','y','separated','seperate'].includes(trimmed)) return true;
    if (['0','false','no','n'].includes(trimmed)) return false;
  }
  return false;
}

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
  try { setSourceKey(localId || 'local', { prefix: 'local' }); } catch {}

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
    separated: Number(cat && cat.separated) === 1 ? 1 : 0,
    episodes: (cat.episodes || []).map(ep => {
      const separatedItemFlag = coerceSeparatedFlag(ep && (ep.separated ?? ep.seperated));
      const manifestSources = Array.isArray(ep && ep.sources) ? ep.sources : [];
      const treatAsSeparatedItem = separatedItemFlag || manifestSources.length > 0;

      const primaryFile = findEpisodeFile(ep && ep.src);
      const primarySrcUrl = primaryFile ? URL.createObjectURL(primaryFile) : '';

      const separatedParts = treatAsSeparatedItem ? manifestSources.map((source, idx) => {
        const sourcePath = source && source.src;
        const partFile = findEpisodeFile(sourcePath);
        const objectUrl = partFile ? URL.createObjectURL(partFile) : '';
        const title = (source && typeof source.title === 'string' && source.title.trim()) ? source.title.trim() : `Part ${idx + 1}`;
        const partSize = partFile ? Number(partFile.size) : Number(source && source.fileSizeBytes);
        const partDuration = Number(source && source.durationSeconds);
        let partPathRel = '';
        try {
          const rp = partFile ? String((partFile.webkitRelativePath || partFile.relativePath || partFile.name || '')).replace(/\\/g, '/') : '';
          partPathRel = rp;
        } catch {}
        return {
          title,
          src: objectUrl,
          file: partFile || null,
          fileName: partFile ? (partFile.name || '') : '',
          filePathRel: partPathRel,
          fileSizeBytes: Number.isFinite(partSize) && partSize >= 0 ? partSize : null,
          durationSeconds: Number.isFinite(partDuration) && partDuration > 0 ? partDuration : null,
          manifestSrc: sourcePath || ''
        };
      }) : [];

      const progressKey = `${localId}:item${flatCounter++}`;
      let filePathRel = '';
      let fileBaseDirRel = '';
      try {
        const rp = primaryFile ? String((primaryFile.webkitRelativePath || primaryFile.relativePath || primaryFile.name || '')).replace(/\\/g, '/') : '';
        filePathRel = rp;
        fileBaseDirRel = rp ? rp.slice(0, rp.lastIndexOf('/') + 1) : '';
      } catch {}
      if (treatAsSeparatedItem && !filePathRel && separatedParts.length && separatedParts[0].filePathRel) {
        filePathRel = separatedParts[0].filePathRel;
        fileBaseDirRel = filePathRel ? filePathRel.slice(0, filePathRel.lastIndexOf('/') + 1) : '';
      }

      const missingParts = treatAsSeparatedItem ? separatedParts.filter(part => !part.file) : [];
      const baseIsPlaceholder = !primaryFile || (primaryFile && primaryFile.size === 0);
      const isPlaceholder = treatAsSeparatedItem ? (missingParts.length > 0) : baseIsPlaceholder;

      let durationSeconds = (typeof ep.durationSeconds === 'number') ? ep.durationSeconds : null;
      let fileSizeBytes = (typeof ep.fileSizeBytes === 'number') ? ep.fileSizeBytes : null;
      if (!Number.isFinite(fileSizeBytes) && primaryFile) fileSizeBytes = Number(primaryFile.size);
      if (treatAsSeparatedItem) {
        let sumSize = 0;
        let sumDuration = 0;
        let anySize = false;
        let anyDuration = false;
        separatedParts.forEach(part => {
          if (Number.isFinite(part.fileSizeBytes) && part.fileSizeBytes > 0) {
            sumSize += part.fileSizeBytes;
            anySize = true;
          }
          if (Number.isFinite(part.durationSeconds) && part.durationSeconds > 0) {
            sumDuration += part.durationSeconds;
            anyDuration = true;
          }
        });
        if (anySize) fileSizeBytes = sumSize;
        if (anyDuration) durationSeconds = sumDuration;
      }

      const entry = {
        title: ep.title,
        src: treatAsSeparatedItem && separatedParts.length ? separatedParts[0].src : primarySrcUrl,
        fileName: treatAsSeparatedItem && separatedParts.length ? separatedParts[0].fileName : (primaryFile ? (primaryFile.name || '') : ''),
        progressKey,
        file: treatAsSeparatedItem ? (separatedParts[0] ? separatedParts[0].file : null) : (primaryFile || null),
        filePathRel,
        fileBaseDirRel,
        filesIndex,
        rootPrefix,
        isPlaceholder,
        durationSeconds,
        fileSizeBytes,
        separated: treatAsSeparatedItem ? 1 : 0,
        seperated: treatAsSeparatedItem ? 1 : 0
      };

      if (treatAsSeparatedItem) {
        entry.sources = separatedParts.map(part => {
          const sourceEntry = { title: part.title, src: part.src || '' };
          if (Number.isFinite(part.fileSizeBytes) && part.fileSizeBytes >= 0) sourceEntry.fileSizeBytes = Math.round(part.fileSizeBytes);
          if (Number.isFinite(part.durationSeconds) && part.durationSeconds > 0) sourceEntry.durationSeconds = Math.round(part.durationSeconds);
          return sourceEntry;
        });
        entry.__localSeparatedFiles = separatedParts;
      }

      return entry;
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
