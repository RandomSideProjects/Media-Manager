// Override folder upload to ensure legacy behavior runs reliably
(function(){
  const folderInput = document.getElementById('folderInput');
  const categoriesEl = document.getElementById('categories');
  if (!folderInput || !categoriesEl) return;

  function getMode(){
    try { const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}'); return (p.libraryMode === 'manga') ? 'manga' : 'anime'; } catch { return 'anime'; }
  }
  function isManga(){ return getMode() === 'manga'; }

  function getCbzExpandSettings(){
    // Prefer live UI state if settings panel is present
    try {
      const toggle = document.getElementById('mmCbzExpandToggle');
      const batch = document.getElementById('mmCbzExpandBatch');
      const manual = document.getElementById('mmCbzExpandManual');
      if (toggle) {
        return {
          expand: !!toggle.checked,
          batch: batch ? !!batch.checked : true,
          manual: manual ? !!manual.checked : true
        };
      }
    } catch {}
    try {
      const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}');
      return {
        expand: !!p.cbzExpand,
        batch: (typeof p.cbzExpandBatch === 'boolean') ? p.cbzExpandBatch : true,
        manual: (typeof p.cbzExpandManual === 'boolean') ? p.cbzExpandManual : true
      };
    } catch { return { expand: false, batch: true, manual: true }; }
  }

  function getUploadConcurrency(){
    try {
      const p = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}');
      const v = parseInt(p.uploadConcurrency, 10);
      return (Number.isFinite(v) && v >= 1 && v <= 8) ? v : 2;
    } catch { return 2; }
  }

  const onChange = async (e) => {
    // Removed mmBuildSeasonEntries guard to always run enhanced handler
    try {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
    } catch {}

    const files = Array.from((e && e.target && e.target.files) || []);
    if (!files.length) return;

    try { window.isFolderUploading = true; } catch {}
    try { folderInput.value = ''; } catch {}

    const seasonNum = categoriesEl.children.length + 1;
    if (typeof addCategory === 'function') {
      const defaultCat = isManga() ? 'Volumes' : `Season ${seasonNum}`;
      addCategory({ category: defaultCat, episodes: [] });
    }
    let catDiv = categoriesEl.lastElementChild;
    let episodesDiv = catDiv ? catDiv.querySelector('.episodes') : null;
    if (!episodesDiv) {
      // Ensure a category exists (especially in Manga mode where addCategory may be blocked when one exists)
      if (typeof addCategory === 'function') {
        const defaultCat = isManga() ? 'Volumes' : `Season ${seasonNum}`;
        addCategory({ category: defaultCat, episodes: [] });
        catDiv = categoriesEl.lastElementChild;
        episodesDiv = catDiv ? catDiv.querySelector('.episodes') : null;
      }
    }
    if (!episodesDiv) {
      if (typeof showCreatorNotice === 'function') {
        showCreatorNotice('Could not prepare a category for folder upload. Please add one and try again.', 'error', 'Folder Upload');
      } else if (typeof window.showStorageNotice === 'function') {
        window.showStorageNotice({
          title: 'Folder Upload',
          message: 'Could not prepare a category for folder upload. Please add one and try again.',
          tone: 'error',
          autoCloseMs: null
        });
      } else if (typeof window.alert === 'function') {
        window.alert('Could not prepare a category for folder upload. Please add one and try again.');
      }
      try { window.isFolderUploading = false; } catch {}
      return;
    }

    const filesInSeason = files.map((file, idx) => {
      const name = (file.webkitRelativePath || file.name || '').split('/').pop();
      let num = idx + 1;
      let label = null;
      if (isManga()) {
        // Prefer Chapter detection: matches "Chapter ###", "c###", or a standalone number with a preceding space " ###"
        const mc = name.match(/\bchapter\s*(\d{1,4})\b/i) || name.match(/\bc\s*0?(\d{1,4})\b/i);
        if (mc) { num = parseInt(mc[1], 10); label = `Chapter ${num}`; }
        else {
          const ms = name.match(/ (0?\d{1,4})\b/);
          if (ms) { num = parseInt(ms[1], 10); label = `Chapter ${num}`; }
          else {
            const mv = name.match(/(?:\bvol(?:ume)?\s*|\bv\s*)(\d{1,3})/i);
            if (mv) { num = parseInt(mv[1], 10); label = `Volume ${num}`; }
          }
        }
      } else {
        const me = name.match(/E0?(\d{1,3})/i);
        if (me) num = parseInt(me[1], 10);
      }
      return { file, num, label };
    }).sort((a, b) => a.num - b.num);

    try {
      const sample = files.slice(0, 20).map((file) => file && (file.webkitRelativePath || file.name || ''));
      console.debug('[Creator] Folder upload sample paths', sample);
    } catch {}

    let seasonEntries = [];
    try {
      if (typeof window !== 'undefined' && typeof window.mmBuildSeasonEntries === 'function') {
        const info = window.mmBuildSeasonEntries(files, { isManga: isManga() });
        if (info && Array.isArray(info.entries) && info.entries.length) {
          seasonEntries = info.entries.slice();
        }
      }
    } catch (err) {
      console.warn('[Creator] mmBuildSeasonEntries failed in override', err);
    }

    if (!seasonEntries.length) {
      seasonEntries = filesInSeason.map(({ file, num, label }, index) => ({
        type: 'single',
        file,
        num,
        label,
        title: label || (isManga() ? `Volume ${num}` : `Episode ${num}`),
        originalIndex: index
      }));
    }

    const separatedEntries = seasonEntries.filter((entry) => entry && entry.type === 'separated');
    const singleEntries = seasonEntries.filter((entry) => entry && entry.type !== 'separated');
    const hasSeparated = separatedEntries.length > 0;
    const summaryTotal = Math.max(1, hasSeparated
      ? (separatedEntries.length + singleEntries.length)
      : filesInSeason.length);

    console.debug('[Creator] Folder upload grouping summary', {
      totalFiles: files.length,
      seasonEntryCount: seasonEntries.length,
      separatedDetected: hasSeparated,
      separatedCount: separatedEntries.length,
      singleCount: singleEntries.length,
      fallbackFilesCount: filesInSeason.length,
      sampleEntries: seasonEntries.slice(0, 10).map((entry) => ({
        type: entry.type,
        title: entry.title,
        num: entry.num,
        parts: entry.parts ? entry.parts.length : 0,
        key: entry.key || null,
        folderName: entry.folderName || null
      }))
    });

    let folderOverlay = document.getElementById('folderUploadOverlay');
    if (!folderOverlay) {
      folderOverlay = document.createElement('div');
      folderOverlay.id = 'folderUploadOverlay';
      document.body.appendChild(folderOverlay);
    }
    Object.assign(folderOverlay.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:'10030'
    });
    folderOverlay.innerHTML = `
      <div style="background:#1a1a1a; padding:1em; border-radius:8px; width:90%; max-width:700px; color:#f1f1f1; font-family:inherit;">
        <h2 style="margin-top:0; font-size:1.4em;">Uploading Folder</h2>
        <div id="folderUploadList" style="display:grid; gap:8px; max-height:50vh; overflow:auto;"></div>
        <div style="margin-top:0.75em; display:flex; justify-content:space-between; align-items:center; gap:0.75em;">
          <div id="folderUploadSummary" style="font-size:0.9em;">0 / 0 completed</div>
          <button id="folderUploadCancel" type="button" style="background:#ff5f5f; color:#111; border:none; border-radius:4px; padding:0.45em 1em; cursor:pointer; font-weight:600;">Cancel</button>
        </div>
      </div>`;
    folderOverlay.style.display = 'flex';
    const folderUploadList = folderOverlay.querySelector('#folderUploadList');
    const folderUploadSummary = folderOverlay.querySelector('#folderUploadSummary');
    const cancelBtn = folderOverlay.querySelector('#folderUploadCancel');
    let completedCount = 0;
    folderUploadSummary.textContent = `0 / ${summaryTotal} completed`;
    const uploadAbortController = new AbortController();
    let cancelRequested = false;
    const isCancelled = () => cancelRequested || uploadAbortController.signal.aborted;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (cancelRequested) return;
        cancelRequested = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
        folderUploadSummary.textContent = `Cancelling... ${completedCount} / ${summaryTotal} completed`;
        try { uploadAbortController.abort(); } catch {}
      });
    }

    const formatBytesCompact = (bytes) => {
      if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let unitIdx = 0;
      while (value >= 1024 && unitIdx < units.length - 1) {
        value /= 1024;
        unitIdx += 1;
      }
      const fixed = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
      return `${fixed} ${units[unitIdx]}`;
    };

    function createUploadRowContext(labelText, totalBytes) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '0.75em',
        padding: '6px 8px',
        background: '#222',
        borderRadius: '6px',
        fontSize: '0.9em',
        position: 'relative',
        transition: 'background 0.25s ease'
      });
      row.tabIndex = 0;
      const labelEl = document.createElement('div');
      labelEl.textContent = labelText;
      labelEl.style.flex = '1';
      const statusEl = document.createElement('div');
      statusEl.textContent = 'Queued';
      statusEl.style.minWidth = '110px';
      statusEl.style.marginLeft = 'auto';
      statusEl.style.textAlign = 'right';
      const tooltip = document.createElement('div');
      tooltip.textContent = 'Total Data: Unknown\nData Left: Unknown\n0% complete';
      Object.assign(tooltip.style, {
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '0',
        background: '#111',
        border: '1px solid #444',
        borderRadius: '6px',
        padding: '6px 8px',
        fontSize: '0.8em',
        color: '#f1f1f1',
        boxShadow: '0 6px 14px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
        display: 'none',
        zIndex: '5',
        maxWidth: '280px'
      });
      row.append(labelEl, statusEl, tooltip);
      folderUploadList.appendChild(row);
      const ctx = {
        row,
        statusEl,
        tooltipEl: tooltip,
        totalBytes: (Number.isFinite(totalBytes) && totalBytes >= 0) ? totalBytes : null,
        loadedBytes: 0,
        progress: 0,
        state: 'queued'
      };
      const applyBackground = () => {
        const percent = Math.max(0, Math.min(100, ctx.progress || 0));
        const state = ctx.state || 'active';
        let fillColor = 'rgba(78, 139, 255, 0.45)';
        if (state === 'failed') fillColor = 'rgba(255, 107, 107, 0.45)';
        else if (state === 'complete') fillColor = 'rgba(76, 175, 80, 0.45)';
        else if (state === 'cancelled') fillColor = 'rgba(224, 192, 99, 0.45)';
        else if (state === 'queued') fillColor = 'rgba(140, 140, 140, 0.3)';
        if (percent <= 0) {
          row.style.background = (state === 'failed' || state === 'cancelled') ? fillColor : '#222';
        } else {
          row.style.background = `linear-gradient(90deg, ${fillColor} 0%, ${fillColor} ${percent}%, #222 ${percent}%, #222 100%)`;
        }
      };
      const updateTooltip = () => {
        const total = Number.isFinite(ctx.totalBytes) && ctx.totalBytes >= 0 ? ctx.totalBytes : null;
        const loaded = Number.isFinite(ctx.loadedBytes) && ctx.loadedBytes >= 0 ? ctx.loadedBytes : null;
        const remaining = (total !== null && loaded !== null) ? Math.max(0, total - loaded) : null;
        const pct = Math.max(0, Math.min(100, ctx.progress || 0));
        const pctText = pct >= 100 || pct === 0 ? `${pct.toFixed(0)}% complete` : `${pct.toFixed(1)}% complete`;
        tooltip.textContent = `Total Data: ${total !== null ? formatBytesCompact(total) : 'Unknown'}\n` +
          `Data Left: ${remaining !== null ? formatBytesCompact(remaining) : 'Unknown'}\n${pctText}`;
      };
      ctx.setStatus = (text, { color, title } = {}) => {
        statusEl.textContent = text;
        if (color === null) statusEl.style.color = '';
        else if (typeof color === 'string' && color.length) statusEl.style.color = color;
        else statusEl.style.color = '#6ec1e4';
        statusEl.title = title || '';
        updateTooltip();
      };
      ctx.setProgress = (percent, { state, loadedBytes, totalBytes: overrideTotal } = {}) => {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        ctx.progress = clamped;
        if (typeof overrideTotal === 'number' && overrideTotal >= 0) ctx.totalBytes = overrideTotal;
        if (typeof loadedBytes === 'number' && loadedBytes >= 0) ctx.loadedBytes = loadedBytes;
        else if (Number.isFinite(ctx.totalBytes)) ctx.loadedBytes = (clamped / 100) * ctx.totalBytes;
        if (state) ctx.state = state;
        else if (!ctx.state || ctx.state === 'queued') ctx.state = 'active';
        applyBackground();
        updateTooltip();
      };

      ctx.attachDetailsElement = (detailsEl, { initiallyOpen = false } = {}) => {
        if (!detailsEl || !row.parentNode) return;
        ctx.detailsEl = detailsEl;
        detailsEl.style.display = initiallyOpen ? 'block' : 'none';
        detailsEl.style.margin = '4px 0 8px 1.5em';
        detailsEl.style.padding = '6px 8px';
        detailsEl.style.background = '#181818';
        detailsEl.style.borderRadius = '6px';
        detailsEl.style.fontSize = '0.85em';
        folderUploadList.insertBefore(detailsEl, row.nextSibling);
        const caret = document.createElement('span');
        caret.textContent = initiallyOpen ? '▾' : '▸';
        caret.style.marginRight = '0.35em';
        caret.style.fontSize = '0.85em';
        caret.style.opacity = '0.8';
        labelEl.prepend(caret);
        row.style.cursor = 'pointer';
        const toggle = () => {
          const open = detailsEl.style.display !== 'none';
          const next = !open;
          detailsEl.style.display = next ? 'block' : 'none';
          caret.textContent = next ? '▾' : '▸';
        };
        row.addEventListener('click', (event) => {
          if (event.target && detailsEl.contains(event.target)) return;
          toggle();
        });
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        });
      };
      const showTooltip = () => { tooltip.style.display = 'block'; };
      const hideTooltip = () => { tooltip.style.display = 'none'; };
      row.addEventListener('mouseenter', showTooltip);
      row.addEventListener('mouseleave', hideTooltip);
      row.addEventListener('focus', showTooltip);
      row.addEventListener('blur', hideTooltip);
      ctx.setStatus('Queued', { color: '#6ec1e4' });
      ctx.setProgress(0, { state: 'queued' });
      return ctx;
    }

    const taskFns = [];
    const maxAttempts = 5;

    const computeLocalFileDurationSeconds = (file) => new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
        const finalize = (value) => { cleanup(); resolve(value); };
        v.onloadedmetadata = () => finalize(isFinite(v.duration) ? v.duration : NaN);
        v.onerror = () => finalize(NaN);
        v.src = url;
      } catch { resolve(NaN); }
    });

    // Allow browser to paint overlay before heavy work
    try { await new Promise(r => setTimeout(r, 0)); } catch {}

    if (!hasSeparated) {
      if (!filesInSeason.length) {
        folderUploadSummary.textContent = 'No usable files detected';
        return;
      }
      for (const { file, num, label } of filesInSeason) {
        if (isCancelled()) break;
        const title = label || (isManga() ? `Volume ${num}` : `Episode ${num}`);
        if (typeof addEpisode === 'function' && episodesDiv) addEpisode(episodesDiv, { title, src: '' });
        const epDiv = episodesDiv ? episodesDiv.lastElementChild : null;
        try { if (epDiv) epDiv.dataset.fileSizeBytes = String(file.size); } catch {}

        const inputs = epDiv ? epDiv.querySelectorAll('input[type="text"]') : [];
        const epSrcInput = inputs && inputs[1];
        const epError = epDiv ? epDiv.querySelector('.ep-error') : null;
        if (epError) epError.textContent = '';

        const totalBytes = (file && typeof file.size === 'number' && file.size >= 0) ? file.size : null;
        const rowCtx = createUploadRowContext(title, totalBytes);

        const fn = async () => {
          const markCancelled = () => {
            rowCtx.setStatus('Cancelled', { color: '#cccccc' });
            rowCtx.setProgress(0, { state: 'cancelled' });
          };
          if (isCancelled()) {
            markCancelled();
            return;
          }
          // Compute metadata per file inside the task so queue builds instantly
          try {
            if (isCancelled()) {
              markCancelled();
              return;
            }
            if (isManga() && /\.cbz$/i.test(file.name||'')) {
              const ab = await file.arrayBuffer();
              const zip = await JSZip.loadAsync(ab);
              const names = Object.keys(zip.files).filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
              if (epDiv) { epDiv.dataset.VolumePageCount = String(names.length); epDiv.dataset.volumePageCount = String(names.length); }
            } else {
              const d = await computeLocalFileDurationSeconds(file);
              if (epDiv && !Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d));
            }
          } catch {}

          // Manga CBZ → optionally expand per settings
          const cbzSet = getCbzExpandSettings();
          if (isManga() && /\.cbz$/i.test(file.name||'') && cbzSet.expand && cbzSet.batch) {
            try {
              if (isCancelled()) {
                markCancelled();
                return;
              }
              rowCtx.setStatus('Processing', { color: null });
              rowCtx.setProgress(0, { state: 'active' });
              const ab = await file.arrayBuffer();
              const zip = await JSZip.loadAsync(ab);
              const names = Object.keys(zip.files)
                .filter(n => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
              const pageUrls = [];
              const totalSteps = names.length + 1; // +1 for JSON upload
              for (let i = 0; i < names.length; i++) {
                if (isCancelled()) {
                  markCancelled();
                  return;
                }
                const name = names[i];
                const imgBlob = await zip.files[name].async('blob');
                const ext = (() => { const m = name.toLowerCase().match(/\.(jpe?g|png|gif|webp|bmp)$/); return m ? m[0] : '.png'; })();
                const pageFile = new File([imgBlob], `${i + 1}${ext}`, { type: imgBlob.type || 'application/octet-stream' });
                const base = (i / totalSteps) * 100;
                const url = await uploadToCatboxWithProgress(
                  pageFile,
                  pct => {
                    const adj = Math.max(0, Math.min(100, base + pct / totalSteps));
                    rowCtx.setProgress(adj);
                  },
                  { context: 'batch', signal: uploadAbortController.signal }
                );
                pageUrls.push(url);
              }
              if (isCancelled()) {
                markCancelled();
                return;
              }
              // Build volume JSON with pagecount and mapping { "Page 1": url }
              const pagesMap = {};
              for (let i = 0; i < pageUrls.length; i++) pagesMap[`Page ${i + 1}`] = pageUrls[i];
              const volumeJson = { pagecount: pageUrls.length, pages: pagesMap };
              const volBlob = new Blob([JSON.stringify(volumeJson, null, 2)], { type: 'application/json' });
              const volNum = num || 1;
              const volFile = new File([volBlob], `${volNum}.json`, { type: 'application/json' });
              const url = await uploadToCatboxWithProgress(
                volFile,
                pct => {
                  const base = ((names.length) / totalSteps) * 100;
                  const adj = Math.max(0, Math.min(100, base + pct / totalSteps));
                  rowCtx.setProgress(adj);
                },
                { context: 'batch', signal: uploadAbortController.signal }
              );
              if (epSrcInput) epSrcInput.value = url;
              if (epError) epError.textContent = '';
              rowCtx.setStatus('Done', { color: '#6ec1e4' });
              rowCtx.setProgress(100, { state: 'complete' });
              completedCount++;
              folderUploadSummary.textContent = `${completedCount} / ${summaryTotal} completed`;
              return;
            } catch (err) {
              if (isCancelled() || (err && err.name === 'AbortError')) {
                markCancelled();
                return;
              }
              rowCtx.setStatus('Failed', { color: '#ff4444' });
              rowCtx.setProgress(0, { state: 'failed' });
              if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
              return;
            }
          }

          // Default path (videos or non-CBZ files)
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (isCancelled()) {
              markCancelled();
              return;
            }
            rowCtx.setStatus((attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`, { color: null });
            rowCtx.setProgress(0, { state: 'active', totalBytes });
            try {
              const fileSizeBytes = (file && typeof file.size === 'number' && file.size >= 0) ? file.size : null;
              const url = await uploadToCatboxWithProgress(
                file,
                pct => {
                  const loaded = Number.isFinite(fileSizeBytes) ? (pct / 100) * fileSizeBytes : undefined;
                  rowCtx.setProgress(pct, { loadedBytes: loaded });
                },
                { context: 'batch', signal: uploadAbortController.signal }
              );
              if (epSrcInput) epSrcInput.value = url;
              if (epError) epError.textContent = '';
              rowCtx.setStatus('Done', { color: '#6ec1e4' });
              rowCtx.setProgress(100, { state: 'complete', loadedBytes: fileSizeBytes });
              completedCount++;
              folderUploadSummary.textContent = `${completedCount} / ${summaryTotal} completed`;
              return;
            } catch (err) {
              if (isCancelled() || (err && err.name === 'AbortError')) {
                markCancelled();
                return;
              }
              if (attempt < maxAttempts) {
                const base = 800 * Math.pow(2, attempt - 1);
                const jitter = base * (0.3 + Math.random() * 0.4);
                await new Promise(r => setTimeout(r, base + jitter));
                if (isCancelled()) {
                  markCancelled();
                  return;
                }
                continue;
              }
              rowCtx.setStatus('Failed', { color: '#ff4444' });
              rowCtx.setProgress(0, { state: 'failed' });
              if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
              return;
            }
          }
        };
        taskFns.push(fn);
      }
    } else {
      const processEntries = seasonEntries.slice();
      if (!processEntries.length) {
        folderUploadSummary.textContent = 'No usable files detected';
        return;
      }
      console.debug('[Creator] Folder upload entry count', processEntries.length);
      folderUploadSummary.textContent = `0 / ${summaryTotal} completed`;

      processEntries.forEach((entry) => {
        if (!entry || isCancelled()) return;
        const rawNum = Number(entry.num);
        const title = entry.title || entry.label || (isManga() ? `Volume ${rawNum || ''}`.trim() : `Episode ${rawNum || ''}`.trim());
        const createdEpisode = (typeof addEpisode === 'function' && episodesDiv) ? addEpisode(episodesDiv, { title, src: '' }) : null;
        const epDiv = createdEpisode || (episodesDiv ? episodesDiv.lastElementChild : null);
        if (!epDiv) return;
        try {
          if (entry.type === 'separated') epDiv.dataset.forceSeparated = '1';
          else delete epDiv.dataset.forceSeparated;
          if (typeof updateEpisodeSeparatedUi === 'function') updateEpisodeSeparatedUi(epDiv);
        } catch {}

        let epSrcInput = epDiv._srcInput || null;
        if (!epSrcInput) {
          const inputs = epDiv.querySelectorAll('input[type="text"]');
          if (inputs.length > 1) epSrcInput = inputs[1];
        }
        const epError = epDiv._errorEl || epDiv.querySelector('.ep-error');
        if (epError) {
          epError.textContent = '';
          epError.style.color = '';
        }

        const baseLabel = title || (isManga() ? 'Volume' : 'Episode');
        const initialBytes = (entry.file && typeof entry.file.size === 'number' && entry.file.size >= 0)
          ? entry.file.size
          : null;
        const rowCtx = createUploadRowContext(baseLabel, initialBytes);

        if (entry.type === 'separated') {
          const videoParts = (entry.parts || []).filter((part) => {
            const baseName = (typeof part.base === 'string' && part.base)
              ? part.base
              : ((part.file && part.file.name) || '');
            return /\.(mp4|m4v|mov|webm|mkv)$/i.test(baseName);
          });
          if (epDiv._separatedToggle) epDiv._separatedToggle.checked = true;
          try {
            if (epDiv._separatedToggle) {
              const evt = (typeof Event === 'function') ? new Event('change', { bubbles: true }) : null;
              if (evt) epDiv._separatedToggle.dispatchEvent(evt);
            }
          } catch {}
          if (typeof epDiv._captureBaseSeparationMeta === 'function') epDiv._captureBaseSeparationMeta();
          if (epDiv._partsList) epDiv._partsList.innerHTML = '';
          if (Array.isArray(epDiv._partRows)) epDiv._partRows.length = 0;
          if (typeof epDiv._updatePartsVisibility === 'function') epDiv._updatePartsVisibility();

          const totalSize = videoParts.reduce((sum, part) => {
            const size = Number(part.file && part.file.size);
            return sum + (Number.isFinite(size) && size > 0 ? size : 0);
          }, 0);
          if (Number.isFinite(totalSize) && totalSize > 0) {
            try { epDiv.dataset.fileSizeBytes = String(totalSize); } catch {}
            rowCtx.setProgress(0, { totalBytes: totalSize });
          }

          const partRows = [];
          videoParts.forEach((part, idx) => {
            const displayIndex = Number.isFinite(part.partIndex) ? part.partIndex : (idx + 1);
            const partLabel = `Part ${displayIndex}`;
            const partRow = typeof epDiv._addPartRow === 'function'
              ? epDiv._addPartRow({ title: partLabel })
              : null;
            if (partRow && partRow._titleInput) partRow._titleInput.value = partLabel;
            if (partRow) {
              const size = Number(part.file && part.file.size);
              partRows.push({
                row: partRow,
                file: part.file,
                size: Number.isFinite(size) && size > 0 ? size : 0
              });
            }
          });

          if (typeof epDiv._recalcSeparatedTotals === 'function') epDiv._recalcSeparatedTotals();
          if (typeof epDiv._updatePartsVisibility === 'function') epDiv._updatePartsVisibility();
          if (typeof epDiv._syncEpisodeMainSrc === 'function') epDiv._syncEpisodeMainSrc();

          const fn = async () => {
            const markCancelled = () => {
              rowCtx.setStatus('Cancelled', { color: '#cccccc' });
              rowCtx.setProgress(0, { state: 'cancelled' });
            };
            if (isCancelled()) {
              markCancelled();
              return;
            }
            if (!partRows.length) {
              rowCtx.setStatus('No video parts detected', { color: '#ffb347' });
              rowCtx.setProgress(0, { state: 'failed' });
              return;
            }
            rowCtx.setStatus('Uploading', { color: null });
            let uploadedParts = 0;
            let uploadedBytes = 0;
            for (let idx = 0; idx < partRows.length; idx += 1) {
              if (isCancelled()) {
                markCancelled();
                return;
              }
              const current = partRows[idx];
              const partSize = Number.isFinite(current.size) ? current.size : 0;
              try {
                if (typeof epDiv._handlePartFileUpload === 'function') {
                  await epDiv._handlePartFileUpload(current.row, current.file, {
                    onProgress: (pct) => {
                      const normalized = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
                      const overallProgress = ((uploadedParts + normalized) / partRows.length) * 100;
                      const loadedBytes = uploadedBytes + (partSize > 0 ? normalized * partSize : 0);
                      rowCtx.setProgress(overallProgress, { loadedBytes, totalBytes: totalSize });
                    }
                  });
                }
              } catch (err) {
                console.error('[Creator] Failed to upload part from folder', err);
              }
              const uploaded = current.row && current.row._srcInput && current.row._srcInput.value && current.row._srcInput.value.trim();
              if (uploaded) {
                uploadedParts += 1;
                if (partSize > 0) uploadedBytes += partSize;
              }
              rowCtx.setProgress((uploadedParts / partRows.length) * 100, { loadedBytes: uploadedBytes, totalBytes: totalSize });
            }
            if (uploadedParts === partRows.length) {
              rowCtx.setStatus('Done', { color: '#6ec1e4' });
              rowCtx.setProgress(100, { state: 'complete' });
              completedCount++;
              folderUploadSummary.textContent = `${completedCount} / ${summaryTotal} completed`;
            } else if (!isCancelled()) {
              rowCtx.setStatus(`Uploaded ${uploadedParts} of ${partRows.length}`, { color: '#ff4444' });
              rowCtx.setProgress((uploadedParts / partRows.length) * 100, { state: 'failed' });
            }
            if (typeof epDiv._recalcSeparatedTotals === 'function') epDiv._recalcSeparatedTotals();
            if (typeof epDiv._syncEpisodeMainSrc === 'function') epDiv._syncEpisodeMainSrc();
          };
          taskFns.push(fn);
          return;
        }

        const fileForUpload = entry.file;
        if (!fileForUpload) {
          rowCtx.setStatus('No file detected', { color: '#ffb347' });
          rowCtx.setProgress(0, { state: 'failed' });
          return;
        }
        if (fileForUpload && fileForUpload.size != null) {
          try { epDiv.dataset.fileSizeBytes = String(fileForUpload.size); } catch {}
          if (!isManga() && typeof epDiv._computeLocalFileDurationSeconds === 'function') {
            epDiv._computeLocalFileDurationSeconds(fileForUpload).then((d) => {
              if (!Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d));
            }).catch(() => {});
          }
        }

        const fileSizeBytes = (fileForUpload && typeof fileForUpload.size === 'number' && fileForUpload.size >= 0)
          ? fileForUpload.size
          : null;
        const fn = async () => {
          const markCancelled = () => {
            rowCtx.setStatus('Cancelled', { color: '#cccccc' });
            rowCtx.setProgress(0, { state: 'cancelled' });
          };
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            if (isCancelled()) {
              markCancelled();
              return;
            }
            rowCtx.setStatus((attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`, { color: null });
            rowCtx.setProgress(0, { state: 'active', totalBytes: fileSizeBytes });
            try {
              if (isManga() && fileForUpload && /\.cbz$/i.test(fileForUpload.name || '')) {
                try {
                  const ab = await fileForUpload.arrayBuffer();
                  const zip = await JSZip.loadAsync(ab);
                  const names = Object.keys(zip.files).filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n));
                  epDiv.dataset.VolumePageCount = String(names.length);
                  epDiv.dataset.volumePageCount = String(names.length);
                } catch {}
              }
              const url = await uploadToCatboxWithProgress(
                fileForUpload,
                (pct) => {
                  const loaded = Number.isFinite(fileSizeBytes) ? (pct / 100) * fileSizeBytes : undefined;
                  rowCtx.setProgress(pct, { loadedBytes: loaded });
                },
                { context: 'batch', signal: uploadAbortController.signal }
              );
              if (epSrcInput) epSrcInput.value = url;
              if (epError) epError.textContent = '';
              rowCtx.setStatus('Done', { color: '#6ec1e4' });
              rowCtx.setProgress(100, { state: 'complete', loadedBytes: fileSizeBytes });
              completedCount++;
              folderUploadSummary.textContent = `${completedCount} / ${summaryTotal} completed`;
              return;
            } catch (err) {
              if (isCancelled() || (err && err.name === 'AbortError')) {
                markCancelled();
                return;
              }
              if (attempt < maxAttempts) {
                const base = 800 * Math.pow(2, attempt - 1);
                const jitter = base * (0.3 + Math.random() * 0.4);
                await new Promise(r => setTimeout(r, base + jitter));
                continue;
              }
              rowCtx.setStatus('Failed', { color: '#ff4444' });
              rowCtx.setProgress(0, { state: 'failed' });
              if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
              return;
            }
          }
        };
        taskFns.push(fn);
      });

    }

    const runWithConcurrency = async (fns, limit) => {
      let idx = 0;
      const workers = Array.from({ length: Math.min(limit, fns.length) }, async () => {
        while (true) {
          if (isCancelled()) return;
          let current;
          if (idx < fns.length) {
            current = fns[idx++];
          } else {
            return;
          }
          await current();
        }
      });
      await Promise.all(workers);
    };

    try {
      await runWithConcurrency(taskFns, getUploadConcurrency());
    } finally {
      try { window.isFolderUploading = false; } catch {}
      if (cancelRequested && folderUploadSummary) {
        folderUploadSummary.textContent = `Cancelled ${completedCount} / ${summaryTotal} completed`;
      }
      if (folderOverlay) folderOverlay.remove();
    }
  };

  // Capture phase to prevent the old handler from running
  folderInput.addEventListener('change', onChange, true);
})();
