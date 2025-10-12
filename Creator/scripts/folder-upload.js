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
      alert('Could not prepare a category for folder upload. Please add one and try again.');
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
    const totalFiles = filesInSeason.length;
    let completedCount = 0;
    folderUploadSummary.textContent = `0 / ${totalFiles} completed`;
    const uploadAbortController = new AbortController();
    let cancelRequested = false;
    const isCancelled = () => cancelRequested || uploadAbortController.signal.aborted;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (cancelRequested) return;
        cancelRequested = true;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
        folderUploadSummary.textContent = `Cancelling... ${completedCount} / ${totalFiles} completed`;
        try { uploadAbortController.abort(); } catch {}
      });
    }

    const taskFns = [];
    const maxAttempts = 5;

    const computeLocalFileDurationSeconds = (file) => new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        const done = () => { try { URL.revokeObjectURL(url); } catch {}; resolve(isFinite(v.duration) ? v.duration : NaN); };
        v.onloadedmetadata = done;
        v.onerror = () => resolve(NaN);
        v.src = url;
      } catch { resolve(NaN); }
    });

    // Allow browser to paint overlay before heavy work
    try { await new Promise(r => setTimeout(r, 0)); } catch {}

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

      const row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'0.75em', padding:'6px 8px', background:'#222', borderRadius:'6px', fontSize:'0.9em' });
      const labelEl = document.createElement('div'); labelEl.textContent = title; labelEl.style.flex = '1';
      const status = document.createElement('div'); status.textContent = 'Queued'; status.style.minWidth = '110px';
      const progressWrapper = document.createElement('div'); progressWrapper.style.flex = '2';
      const prog = document.createElement('progress'); prog.max = 100; prog.value = 0; prog.style.width = '100%';
      progressWrapper.appendChild(prog);
      row.append(labelEl, progressWrapper, status);
      folderUploadList.appendChild(row);

      const fn = async () => {
        const markCancelled = () => {
          status.textContent = 'Cancelled';
          status.style.color = '#cccccc';
          prog.value = 0;
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
            status.textContent = 'Processing';
            prog.value = 0;
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
                pct => { const adj = Math.max(0, Math.min(100, base + pct / totalSteps)); prog.value = adj; },
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
              pct => { const base = ((names.length) / totalSteps) * 100; const adj = Math.max(0, Math.min(100, base + pct / totalSteps)); prog.value = adj; },
              { context: 'batch', signal: uploadAbortController.signal }
            );
            if (epSrcInput) epSrcInput.value = url;
            if (epError) epError.textContent = '';
            status.textContent = 'Done';
            status.style.color = '#6ec1e4';
            prog.value = 100;
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${totalFiles} completed`;
            return;
          } catch (err) {
            if (isCancelled() || (err && err.name === 'AbortError')) {
              markCancelled();
              return;
            }
            status.textContent = 'Failed';
            status.style.color = '#ff4444';
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
          status.textContent = (attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`;
          prog.value = 0;
          try {
            const url = await uploadToCatboxWithProgress(
              file,
              pct => { prog.value = pct; },
              { context: 'batch', signal: uploadAbortController.signal }
            );
            if (epSrcInput) epSrcInput.value = url;
            if (epError) epError.textContent = '';
            status.textContent = 'Done';
            status.style.color = '#6ec1e4';
            prog.value = 100;
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${totalFiles} completed`;
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
            status.textContent = 'Failed';
            status.style.color = '#ff4444';
            if (epError) epError.innerHTML = '<span style="color:red">Upload failed</span>';
            return;
          }
        }
      };
      taskFns.push(fn);
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
        folderUploadSummary.textContent = `Cancelled ${completedCount} / ${totalFiles} completed`;
      }
      if (folderOverlay) folderOverlay.remove();
    }
  };

  // Capture phase to prevent the old handler from running
  folderInput.addEventListener('change', onChange, true);
})();
