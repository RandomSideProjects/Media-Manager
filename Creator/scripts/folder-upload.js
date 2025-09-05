// Override folder upload to ensure legacy behavior runs reliably
(function(){
  const folderInput = document.getElementById('folderInput');
  const categoriesEl = document.getElementById('categories');
  if (!folderInput || !categoriesEl) return;

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
      addCategory({ category: `Season ${seasonNum}`, episodes: [] });
    }
    const catDiv = categoriesEl.lastElementChild;
    const episodesDiv = catDiv ? catDiv.querySelector('.episodes') : null;

    const filesInSeason = files.map((file, idx) => {
      const name = (file.webkitRelativePath || file.name || '').split('/').pop();
      const m = name.match(/E0?(\d{1,2})/i);
      const epNum = m ? parseInt(m[1], 10) : idx + 1;
      return { file, epNum };
    }).sort((a, b) => a.epNum - b.epNum);

    const folderOverlay = document.createElement('div');
    folderOverlay.id = 'folderUploadOverlay';
    Object.assign(folderOverlay.style, {
      position:'fixed', inset:'0', background:'rgba(0,0,0,0.85)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:'10000'
    });
    folderOverlay.innerHTML = `
      <div style="background:#1a1a1a; padding:1em; border-radius:8px; width:90%; max-width:700px; color:#f1f1f1; font-family:inherit;">
        <h2 style="margin-top:0; font-size:1.4em;">Uploading Folder</h2>
        <div id="folderUploadList" style="display:grid; gap:8px; max-height:50vh; overflow:auto;"></div>
        <div style="margin-top:0.75em; display:flex; justify-content:space-between; align-items:center;">
          <div id="folderUploadSummary" style="font-size:0.9em;">0 / 0 completed</div>
        </div>
      </div>`;
    document.body.appendChild(folderOverlay);
    const folderUploadList = folderOverlay.querySelector('#folderUploadList');
    const folderUploadSummary = folderOverlay.querySelector('#folderUploadSummary');
    folderUploadSummary.textContent = `0 / ${filesInSeason.length} completed`;

    const taskFns = [];
    const maxAttempts = 5;
    let completedCount = 0;

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

    filesInSeason.forEach(({ file, epNum }) => {
      if (typeof addEpisode === 'function' && episodesDiv) addEpisode(episodesDiv, { title: `Episode ${epNum}`, src: '' });
      const epDiv = episodesDiv ? episodesDiv.lastElementChild : null;
      try { if (epDiv) epDiv.dataset.fileSizeBytes = String(file.size); } catch {}
      try { computeLocalFileDurationSeconds(file).then(d => { if (epDiv && !Number.isNaN(d) && d > 0) epDiv.dataset.durationSeconds = String(Math.round(d)); }); } catch {}
      const inputs = epDiv ? epDiv.querySelectorAll('input[type="text"]') : [];
      const epSrcInput = inputs && inputs[1];
      const epError = epDiv ? epDiv.querySelector('.ep-error') : null;
      if (epError) epError.textContent = '';

      const row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'0.75em', padding:'6px 8px', background:'#222', borderRadius:'6px', fontSize:'0.9em' });
      const label = document.createElement('div'); label.textContent = `Episode ${epNum}`; label.style.flex = '1';
      const status = document.createElement('div'); status.textContent = 'Queued'; status.style.minWidth = '110px';
      const progressWrapper = document.createElement('div'); progressWrapper.style.flex = '2';
      const prog = document.createElement('progress'); prog.max = 100; prog.value = 0; prog.style.width = '100%';
      progressWrapper.appendChild(prog);
      row.append(label, progressWrapper, status);
      folderUploadList.appendChild(row);

      const fn = async () => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          status.textContent = (attempt === 1) ? 'Uploading' : `Retry ${attempt} of ${maxAttempts}`;
          prog.value = 0;
          try {
            const url = await uploadToCatboxWithProgress(file, pct => { prog.value = pct; });
            if (epSrcInput) epSrcInput.value = url;
            if (epError) epError.textContent = '';
            status.textContent = 'Done';
            status.style.color = '#6ec1e4';
            prog.value = 100;
            completedCount++;
            folderUploadSummary.textContent = `${completedCount} / ${filesInSeason.length} completed`;
            return;
          } catch (err) {
            if (attempt < maxAttempts) {
              const base = 800 * Math.pow(2, attempt - 1);
              const jitter = base * (0.3 + Math.random() * 0.4);
              await new Promise(r => setTimeout(r, base + jitter));
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
    });

    const runWithConcurrency = async (fns, limit) => {
      let idx = 0;
      const workers = Array.from({ length: Math.min(limit, fns.length) }, async () => {
        while (idx < fns.length) {
          const current = fns[idx++];
          await current();
        }
      });
      await Promise.all(workers);
    };

    try {
      await runWithConcurrency(taskFns, getUploadConcurrency());
    } finally {
      try { window.isFolderUploading = false; } catch {}
      if (folderOverlay) folderOverlay.remove();
    }
  };

  // Capture phase to prevent the old handler from running
  folderInput.addEventListener('change', onChange, true);
})();

