    async function uploadToCatbox(file) {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', file);
      const res = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form
      });
      if (!res.ok) throw new Error('Upload error');
      return await res.text();
    }

    function uploadToCatboxWithProgress(file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://catbox.moe/user/api.php');
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', file);
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            onProgress(percent);
          }
        });
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.responseText);
          } else {
            reject(new Error('Upload error: ' + xhr.status));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(form);
      });
    }

    const categoriesEl = document.getElementById('categories');
    const posterInput = document.getElementById('posterInput');
    const posterPreview = document.getElementById('posterPreview');
    const posterStatus = document.getElementById('posterStatus');
    const posterProgress = document.getElementById('posterProgress');
    let posterImageUrl = '';
    const posterWrapper = document.getElementById('posterWrapper');
    const posterChangeBtn = document.getElementById('posterChangeBtn');
    if (posterInput) {
      posterInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Quick local preview
        try {
          const localUrl = URL.createObjectURL(file);
          posterPreview.src = localUrl;
          if (posterWrapper) posterWrapper.style.display = 'inline-block';
          if (posterInput) posterInput.style.display = 'none';
        } catch {}
        if (posterChangeBtn) posterChangeBtn.style.display = 'inline-block';
        // Show uploading UI
        if (posterStatus) posterStatus.style.display = 'inline-block';
        if (posterProgress) posterProgress.value = 0;
        try {
          const url = await uploadToCatboxWithProgress(file, pct => {
            if (posterProgress) posterProgress.value = pct;
          });
          posterImageUrl = (url || '').trim();
          if (posterStatus) posterStatus.style.display = 'none';
        } catch (err) {
          if (posterStatus) {
            posterStatus.style.display = 'inline-block';
            posterStatus.style.color = '#ff6b6b';
            posterStatus.textContent = 'Image upload failed';
          }
          posterImageUrl = '';
          if (posterChangeBtn) posterChangeBtn.style.display = 'none';
        }
      });
    }
    if (posterChangeBtn) {
      posterChangeBtn.addEventListener('click', () => {
        if (posterWrapper) posterWrapper.style.display = 'none';
        if (posterInput) {
          posterInput.style.display = 'inline-block';
          posterInput.value = '';
          posterInput.focus();
        }
        if (posterChangeBtn) posterChangeBtn.style.display = 'none';
        posterImageUrl = '';
        if (posterPreview) posterPreview.src = '';
      });
    }
    const addCategoryBtn = document.getElementById('addCategory');
    const outputEl = document.getElementById('output');
    const loadUrlInput = document.getElementById('loadUrl');
    const loadBtn = document.getElementById('loadBtn');
    const createTabBtn = document.getElementById('createTabBtn');
    const editTabBtn = document.getElementById('editTabBtn');
    const loadUrlContainer = document.getElementById('loadUrlContainer');
    const homeTabBtn = document.getElementById('homeTabBtn');
    const folderInput = document.getElementById('folderInput');
    let isFolderUploading = false;
    // Import a single folder as the next season
    folderInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      isFolderUploading = true;
      // Reset input to allow re-selection
      folderInput.value = '';
      // Determine next season number
      const seasonNum = categoriesEl.children.length + 1;
      // Create category block
      addCategory({ category: `Season ${seasonNum}`, episodes: [] });
      const catDiv = categoriesEl.lastElementChild;
      const episodesDiv = catDiv.querySelector('.episodes');
      // Prepare files with episode numbers (fallback to folder order if no E# found)
      const filesInSeason = files.map((file, idx) => {
        const name = file.webkitRelativePath.split('/').pop();
        const m = name.match(/E0?(\d{1,2})/i);
        // Use matched number or fallback to original order (idx+1)
        const epNum = m ? parseInt(m[1], 10) : idx + 1;
        return { file, epNum };
      }).sort((a, b) => a.epNum - b.epNum);
      // Create overlay UI
      const folderOverlay = document.createElement('div');
      folderOverlay.id = 'folderUploadOverlay';
      folderOverlay.style.position = 'fixed';
      folderOverlay.style.inset = '0';
      folderOverlay.style.background = 'rgba(0,0,0,0.85)';
      folderOverlay.style.display = 'flex';
      folderOverlay.style.alignItems = 'center';
      folderOverlay.style.justifyContent = 'center';
      folderOverlay.style.zIndex = '10000';
      folderOverlay.innerHTML = `
        <div style="background:#1a1a1a; padding:1em; border-radius:8px; width:90%; max-width:700px; color:#f1f1f1; font-family:inherit;">
          <h2 style="margin-top:0; font-size:1.4em;">Uploading Folder</h2>
          <div id="folderUploadList" style="display:grid; gap:8px; max-height:50vh; overflow:auto;"></div>
          <div style="margin-top:0.75em; display:flex; justify-content:space-between; align-items:center;">
            <div id="folderUploadSummary" style="font-size:0.9em;">0 / 0 completed</div>
          </div>
        </div>
      `;
      document.body.appendChild(folderOverlay);
      const folderUploadList = folderOverlay.querySelector('#folderUploadList');
      const folderUploadSummary = folderOverlay.querySelector('#folderUploadSummary');
      // Upload all episodes concurrently with retry indicators
      const uploadTasks = [];
      const maxAttempts = 5;
      filesInSeason.forEach(({ file, epNum }) => {
        // Add episode UI stub
        addEpisode(episodesDiv, { title: `Episode ${epNum}`, src: '' });
        const epDiv = episodesDiv.lastElementChild;
        const inputs = epDiv.querySelectorAll('input[type="text"]');
        const epSrcInput = inputs[1];
        const epError = epDiv.querySelector('.ep-error');
        epError.textContent = '';
        // Overlay progress row
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '0.75em';
        row.style.padding = '6px 8px';
        row.style.background = '#222';
        row.style.borderRadius = '6px';
        row.style.fontSize = '0.9em';
        const label = document.createElement('div');
        label.textContent = `Episode ${epNum}`;
        label.style.flex = '1';
        const status = document.createElement('div');
        status.textContent = 'Queued';
        status.style.minWidth = '90px';
        const progressWrapper = document.createElement('div');
        progressWrapper.style.flex = '2';
        const prog = document.createElement('progress');
        prog.max = 100;
        prog.value = 0;
        prog.style.width = '100%';
        progressWrapper.appendChild(prog);
        row.appendChild(label);
        row.appendChild(progressWrapper);
        row.appendChild(status);
        folderUploadList.appendChild(row);
        // Upload with retries
        const task = (async () => {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            status.textContent = attempt > 1 ? `Retry ${attempt} of ${maxAttempts}` : 'Uploading';
            prog.value = 0;
            try {
              const url = await uploadToCatboxWithProgress(file, pct => {
                prog.value = pct;
              });
              epSrcInput.value = url;
              epError.textContent = '';
              status.textContent = 'Done';
              status.style.color = '#6ec1e4';
              prog.value = 100;
              return;
            } catch {
              if (attempt === maxAttempts) {
                status.textContent = 'Failed';
                status.style.color = '#ff4444';
                epError.innerHTML = '<span style="color:red">Upload failed</span>';
              }
            }
          }
        })();
        uploadTasks.push(task);
        // Update summary after task finishes
        task.finally(() => {
          const total = filesInSeason.length;
          const completed = Array.from(folderUploadList.children).filter(r => {
            const st = r.querySelector('div:nth-child(3)').textContent;
            return st === 'Done';
          }).length;
          folderUploadSummary.textContent = `${completed} / ${total} completed`;
        });
      });
      try {
        await Promise.all(uploadTasks);
      } finally {
        isFolderUploading = false;
        if (folderOverlay) {
          folderOverlay.remove();
        }
      }
    });
    // Start in Create mode
    loadUrlContainer.style.display = 'none';

    let isFullUrl = false;
    let directoryCode = '';
    const outputLink = document.getElementById('outputLink');


    // Auto-upload current configuration (with LatestTime)
    async function autoUploadFromContent(contentObj) {
      const payload = { ...contentObj, LatestTime: new Date().toISOString() };
      const jsonString = JSON.stringify(payload, null, 2);
      try {
        const blob = new Blob([jsonString], { type: 'application/json' });
        const file = new File([blob], 'directory.json', { type: 'application/json' });
        const url = await uploadToCatbox(file);
        directoryCode = url.replace(/^https:\/\/files\.catbox\.moe\//, '').replace(/\.json$/, '').trim();
        updateOutput();
      } catch (err) {
        outputEl.textContent = 'Failed to auto-upload: ' + err.message;
      }
    }
    // Auto-upload when data changes, every 500ms
    let lastContent = null; // JSON string of title/Image/categories only
    setInterval(async () => {
      if (isFolderUploading) return;
      const titleVal = document.getElementById('dirTitle').value.trim();
      const cats = [];
      document.querySelectorAll('.category').forEach(cat => {
        const catTitle = cat.querySelector('label input').value.trim();
        const eps = [];
        cat.querySelectorAll('.episode').forEach(epDiv => {
          const inputs = epDiv.querySelectorAll('input[type="text"]');
          const t = inputs[0].value.trim();
          const s = inputs[1].value.trim();
          if (t && s) eps.push({ title: t, src: s });
        });
        if (catTitle) cats.push({ category: catTitle, episodes: eps });
      });
      const imageField = posterImageUrl || 'N/A';
      const contentOnly = { title: titleVal, Image: imageField, categories: cats };
      const contentStr = JSON.stringify(contentOnly);
      if (contentStr !== lastContent) {
        lastContent = contentStr;
        try { await autoUploadFromContent(contentOnly); } catch (err) { console.error('Auto-upload error:', err); }
      }
    }, 500);

    // Add a new category block
    function addCategory(data) {
      // Determine category index
      const categoryIndex = categoriesEl.children.length + 1;

      const categoryDiv = document.createElement('div');
      categoryDiv.className = 'category';

      categoryDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        confirmModal.style.display = 'flex';
        pendingRemoval = { type: 'category', elem: categoryDiv };
      });

      const titleLabel = document.createElement('label');
      titleLabel.textContent = 'Category Title:';
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.placeholder = `Season ${categoryIndex}`;
      if (data && data.category) {
        titleInput.value = data.category;
      } else {
        titleInput.value = `Season ${categoryIndex}`;
      }
      titleLabel.appendChild(document.createElement('br'));
      titleLabel.appendChild(titleInput);

      const episodesDiv = document.createElement('div');
      episodesDiv.className = 'episodes';

      const addEpBtn = document.createElement('button');
      addEpBtn.type = 'button';
      addEpBtn.textContent = 'Add Episode';
      addEpBtn.addEventListener('click', () => addEpisode(episodesDiv));

      categoryDiv.appendChild(titleLabel);
      categoryDiv.appendChild(episodesDiv);
      categoryDiv.appendChild(addEpBtn);

      categoriesEl.appendChild(categoryDiv);

      // autoUpload now handled by polling loop

      if (data && data.episodes) {
        data.episodes.forEach(ep => addEpisode(episodesDiv, ep));
      }
    }

    // Add a new episode block within a category
    function addEpisode(container, data) {
      // Determine episode index within this category
      const episodeIndex = container.querySelectorAll('.episode').length + 1;

      const epDiv = document.createElement('div');
      epDiv.className = 'episode';

      epDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        epDiv.remove();
        // autoUpload now handled by polling loop
      });

      const epTitle = document.createElement('input');
      epTitle.type = 'text';
      epTitle.placeholder = 'Episode Title';
      if (data && data.title) {
        epTitle.value = data.title;
      } else {
        epTitle.value = `Episode ${episodeIndex}`;
      }

      const epSrc = document.createElement('input');
      epSrc.type = 'text';
      epSrc.placeholder = 'MP4 or WebM URL';
      if (data && data.src) epSrc.value = data.src;

      const epFile = document.createElement('input');
      epFile.type = 'file';
      epFile.accept = '.mp4, .webm';

      const epError = document.createElement('div');
      epError.className = 'ep-error';

      epFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Clear previous messages
        epError.textContent = '';
        if (file.size > 200 * 1024 * 1024) {
          epError.innerHTML = '<span style="color:#f1f1f1">Our built-in uploader only supports 200 MB. Please try again with a smaller size.</span>';
          return;
        }
        // Primary upload with progress bar
        epSrc.value = '';
        epError.innerHTML = ''; // clear previous messages
        const uploadingMsg = document.createElement('span');
        uploadingMsg.style.color = 'blue';
        uploadingMsg.textContent = 'Uploading';
        epError.appendChild(uploadingMsg);
        const progressBar = document.createElement('progress');
        progressBar.max = 100;
        progressBar.value = 0;
        progressBar.style.marginLeft = '0.5em';
        epError.appendChild(progressBar);
        try {
          const url = await uploadToCatboxWithProgress(file, (percent) => {
            progressBar.value = percent;
          });
          epSrc.value = url;
          epError.textContent = '';
        } catch (err) {
          epError.innerHTML = '<span style="color:red">Upload failed</span>';
          epSrc.value = '';
        }
      });

      epDiv.appendChild(epTitle);

      // URL or File upload group
      const inputGroup = document.createElement('div');
      inputGroup.className = 'input-group';
      inputGroup.appendChild(epSrc);
      const orSpan = document.createElement('span');
      orSpan.textContent = 'or';
      inputGroup.appendChild(orSpan);
      inputGroup.appendChild(epFile);
      epDiv.appendChild(inputGroup);

      epDiv.appendChild(epError);
      container.appendChild(epDiv);

      // autoUpload now handled by polling loop
    }

    async function loadDirectory() {
      const url = loadUrlInput.value.trim();
      if (!url) return;
      try {
        const res = await fetch(url);
        const json = await res.json();
        // Set poster from JSON if present
        posterImageUrl = (json.Image && json.Image !== 'N/A') ? json.Image : '';
        if (posterImageUrl) {
          posterPreview.src = posterImageUrl;
          if (posterWrapper) posterWrapper.style.display = 'inline-block';
          if (posterInput) posterInput.style.display = 'none';
        } else {
          posterPreview.src = '';
          if (posterWrapper) posterWrapper.style.display = 'none';
          if (posterInput) posterInput.style.display = 'inline-block';
        }
        if (posterChangeBtn) posterChangeBtn.style.display = posterImageUrl ? 'inline-block' : 'none';
        if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
        // Clear existing
        document.getElementById('dirTitle').value = json.title || '';
        categoriesEl.innerHTML = '';
        json.categories.forEach(cat => addCategory(cat));
        // Set lastContent so loading doesn't immediately trigger upload
        const contentOnly = { title: json.title || '', Image: posterImageUrl || 'N/A', categories: json.categories || [] };
        lastContent = JSON.stringify(contentOnly);
      } catch (err) {
        outputEl.textContent = 'Failed to load: ' + err.message;
      }
    }
    loadBtn.addEventListener('click', loadDirectory);

    // Button handlers
    addCategoryBtn.addEventListener('click', () => addCategory());

    function updateOutput() {
      if (!directoryCode) {
        outputLink.textContent = '';
        outputLink.href = '#';
        return;
      }
      if (isFullUrl) {
        const full = `https://files.catbox.moe/${directoryCode}.json`;
        outputLink.textContent = full;
        outputLink.href = full;
      } else {
        outputLink.textContent = directoryCode;
        outputLink.href = `https://randomsideprojects.github.io/Media-Manager/Main/index.html?source=${directoryCode}`;
      }
    }

    const outputContainer = document.getElementById('outputContainer');
    outputContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      isFullUrl = !isFullUrl;
      updateOutput();
    });

    createTabBtn.addEventListener('click', () => {
      createTabBtn.classList.add('active');
      editTabBtn.classList.remove('active');
      loadUrlContainer.style.display = 'none';
      // Clear all inputs and output
      document.getElementById('dirTitle').value = '';
      categoriesEl.innerHTML = '';
      directoryCode = '';
      updateOutput();
      posterImageUrl = '';
      if (posterPreview) { posterPreview.src = ''; }
      if (posterWrapper) posterWrapper.style.display = 'none';
      if (posterInput) { posterInput.value = ''; posterInput.style.display = 'inline-block'; }
      if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
      if (posterChangeBtn) posterChangeBtn.style.display = 'none';
    });
    editTabBtn.addEventListener('click', () => {
      editTabBtn.classList.add('active');
      createTabBtn.classList.remove('active');
      loadUrlContainer.style.display = 'flex';
      document.getElementById('dirTitle').value = '';
      categoriesEl.innerHTML = '';
      directoryCode = '';
      updateOutput();
      posterImageUrl = '';
      if (posterPreview) { posterPreview.src = ''; }
      if (posterWrapper) posterWrapper.style.display = 'none';
      if (posterInput) { posterInput.value = ''; posterInput.style.display = 'inline-block'; }
      if (posterStatus) { posterStatus.style.display = 'none'; posterStatus.style.color = '#9ecbff'; posterStatus.textContent = 'Uploading image…'; }
      if (posterChangeBtn) posterChangeBtn.style.display = 'none';
    });
    homeTabBtn.addEventListener('click', () => {
      window.location.href = '../index.html';
    });

    // Auto-upload now handled by polling loop; no need for input event listeners

    const confirmModal = document.getElementById('confirmModal');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    let pendingRemoval = null;
    confirmYes.addEventListener('click', () => {
      if (pendingRemoval && pendingRemoval.type === 'category') {
        pendingRemoval.elem.remove();
        // autoUpload now handled by polling loop
      }
      confirmModal.style.display = 'none';
      pendingRemoval = null;
    });
    confirmNo.addEventListener('click', () => {
      confirmModal.style.display = 'none';
      pendingRemoval = null;
    });


    // Local JSON download on A/Z keypress
    function buildLocalDirectoryJSON() {
      const title = document.getElementById('dirTitle').value.trim();
      const categories = [];
      document.querySelectorAll('.category').forEach(cat => {
        const catTitle = cat.querySelector('input[type="text"]').value.trim();
        const episodes = [];
        cat.querySelectorAll('.episode').forEach(epDiv => {
          const inputs = epDiv.querySelectorAll('input[type="text"]');
          const t = inputs[0].value.trim();
          const s = inputs[1].value.trim();
          if (t && s) episodes.push({ title: t, src: s });
        });
        if (catTitle) categories.push({ category: catTitle, episodes });
      });
      const imageField = posterImageUrl || 'N/A';
      return { title, Image: imageField, categories, LatestTime: new Date().toISOString() };
    }

    document.addEventListener('keydown', (e) => {
      if (['a', 'z'].includes(e.key.toLowerCase())) {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const result = buildLocalDirectoryJSON();
        const jsonString = JSON.stringify(result, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${result.title || 'directory'}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    });

