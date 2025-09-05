"use strict";

let lastClipBlob = null;
let lastPreviewObjectURL = null;

function ensureClipDownloadButton() {
  let btn = document.getElementById('clipDownloadBtn');
  if (!btn) {
    const done = document.getElementById('clipDoneBtn');
    if (done && done.parentElement) {
      btn = document.createElement('button');
      btn.id = 'clipDownloadBtn';
      btn.textContent = 'Download';
      Object.assign(btn.style, {
        padding: '0.6em 1.2em',
        background: getComputedStyle(done).backgroundColor || 'var(--button-bg)',
        color: getComputedStyle(done).color || 'var(--button-text)',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      });
      done.parentElement.appendChild(btn);
    }
  }
  if (btn) {
    btn.style.display = 'inline-block';
    btn.onclick = () => {
      if (!lastClipBlob) return;
      const url = URL.createObjectURL(lastClipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'clip.webm';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
}

function displayClipResult(html, isError = false) {
  if (clipMessage) {
    clipMessage.innerHTML = html;
    if (clipOverlay) { clipOverlay.style.display = 'flex'; }
  } else {
    const tmp = document.createElement('div');
    Object.assign(tmp.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.85)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em', zIndex: 10000, fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif', textAlign: 'center',
    });
    const box = document.createElement('div');
    Object.assign(box.style, { background: isError ? 'rgba(80,0,0,0.95)' : 'rgba(20,20,20,0.95)', padding: '1em 1.25em', borderRadius: '12px', maxWidth: '540px', boxShadow: '0 20px 40px -10px rgba(0,0,0,0.6)' });
    box.innerHTML = html;
    const done = document.createElement('button'); done.textContent = 'Done'; Object.assign(done.style, { marginTop: '1em', padding: '0.5em 1em', cursor: 'pointer' });
    done.addEventListener('click', () => tmp.remove()); box.appendChild(done); tmp.appendChild(box); document.body.appendChild(tmp);
  }
}

async function uploadClipToCatboxWithProgress(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://catbox.moe/user/api.php');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', blob, 'clip.webm');
    xhr.upload.onprogress = e => { if (e.lengthComputable && typeof onProgress === 'function') { onProgress(e.loaded / e.total * 100); } };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { resolve((xhr.responseText || '').trim()); } else { reject(new Error('Upload failed: ' + xhr.status)); } };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

if (clipBtn) {
  clipBtn.addEventListener('click', async () => {
    const x = video.currentTime; video.pause();
    const y = parseFloat(prompt('Enter half-length in seconds:', '10'));
    if (isNaN(y) || y <= 0) return;
    const start = Math.max(0, x - y); const end = Math.min(video.duration, x + y);

    const overlay = clipProgressOverlay; const msg = clipProgressMessage; const bar = clipProgressBar;
    overlay.style.display = 'flex'; msg.textContent = 'Preparing clip...'; bar.value = 0;

    let hiddenVideo = document.createElement('video');
    hiddenVideo.muted = false; hiddenVideo.preload = 'auto'; hiddenVideo.crossOrigin = 'anonymous';
    hiddenVideo.style.position = 'absolute'; hiddenVideo.style.left = '-9999px'; hiddenVideo.style.width = '1px'; hiddenVideo.style.height = '1px'; hiddenVideo.style.opacity = '0'; hiddenVideo.setAttribute('playsinline', ''); document.body.appendChild(hiddenVideo);

    try {
      hiddenVideo.src = video.src;
      await new Promise(r => { function onMeta() { hiddenVideo.removeEventListener('loadedmetadata', onMeta); r(); } hiddenVideo.addEventListener('loadedmetadata', onMeta); });
      await new Promise(r => { function onSeeked() { hiddenVideo.removeEventListener('seeked', onSeeked); r(); } hiddenVideo.addEventListener('seeked', onSeeked); hiddenVideo.currentTime = start; });
      hiddenVideo.play(); await new Promise(resolve => { function onPlaying() { hiddenVideo.removeEventListener('playing', onPlaying); resolve(); } hiddenVideo.addEventListener('playing', onPlaying); }); await new Promise(r => setTimeout(r, 100));

      let stream; let canvas; let canvasDrawLoop;
      if (typeof hiddenVideo.captureStream === 'function') {
        stream = hiddenVideo.captureStream();
        if (stream.getAudioTracks().length === 0) {
          try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume().catch(() => {});
            const sourceNode = audioCtx.createMediaElementSource(hiddenVideo); const dest = audioCtx.createMediaStreamDestination(); sourceNode.connect(dest);
            stream = new MediaStream([ ...stream.getVideoTracks(), ...dest.stream.getAudioTracks() ]);
          } catch (err) { console.warn('Supplementing audio failed, proceeding with original stream.', err); }
        }
      } else {
        canvas = document.createElement('canvas'); canvas.width = hiddenVideo.videoWidth || 640; canvas.height = hiddenVideo.videoHeight || 360; const ctx = canvas.getContext('2d');
        canvasDrawLoop = () => { ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height); if (recorder && recorder.state === 'recording') { requestAnimationFrame(canvasDrawLoop); } };
        const canvasStream = canvas.captureStream(30);
        let audioStream = null; try { const audioCtx = new (window.AudioContext || window.webkitAudioContext)(); await audioCtx.resume().catch(() => {}); const sourceNode = audioCtx.createMediaElementSource(hiddenVideo); const dest = audioCtx.createMediaStreamDestination(); sourceNode.connect(dest); sourceNode.connect(audioCtx.destination); audioStream = dest.stream; } catch (e) { console.warn('Audio capture fallback failed, proceeding without audio.', e); }
        stream = audioStream ? new MediaStream([ ...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks() ]) : canvasStream;
      }

      let mimeType = 'video/webm;codecs=vp9,opus'; if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = 'video/webm;codecs=vp8,opus'; if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = 'video/webm'; } }
      let recorder; const recordedChunks = []; try { recorder = new MediaRecorder(stream, { mimeType }); } catch { recorder = new MediaRecorder(stream); }
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };

      const durationMs = (end - start) * 1000; const recordStart = Date.now();
      const progressInterval = setInterval(() => { const elapsed = Date.now() - recordStart; bar.value = Math.min(100, (elapsed / durationMs) * 100); }, 100);

      recorder.start(); if (canvasDrawLoop) requestAnimationFrame(canvasDrawLoop);
      await new Promise(r => setTimeout(r, durationMs));
      recorder.stop(); await new Promise(r => { recorder.onstop = () => r(); }); clearInterval(progressInterval);

      const blob = new Blob(recordedChunks, { type: recordedChunks[0] ? recordedChunks[0].type : 'video/webm' }); lastClipBlob = blob;
      bar.value = 100; overlay.style.display = 'none';

      const previewEnabled = (localStorage.getItem('clipPreviewEnabled') === 'true');
      let previewHTML = '';
      if (previewEnabled) {
        try { if (lastPreviewObjectURL) { URL.revokeObjectURL(lastPreviewObjectURL); lastPreviewObjectURL = null; } lastPreviewObjectURL = URL.createObjectURL(blob); previewHTML = `<video src="${lastPreviewObjectURL}" controls style="max-width:100%; width:480px; margin-top:10px;"></video>`; } catch {}
      }

      try {
        clipButtonsRow.style.display = 'none'; msg.textContent = 'Uploading clip...'; bar.value = 0; overlay.style.display = 'flex';
        const url = await uploadClipToCatboxWithProgress(blob, p => { bar.value = p; });
        overlay.style.display = 'none';
        displayClipResult(`
          <div style="font-weight:700;">Clip uploaded!</div>
          <p style="margin:0;">URL: <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>
          ${previewHTML}
        `);
        ensureClipDownloadButton();
      } catch (err) {
        overlay.style.display = 'none'; const localUrl = (function() { try { return URL.createObjectURL(blob); } catch { return ''; } })();
        displayClipResult(`
          <div style="font-weight:700;">Upload failed</div>
          <p style="margin:0;">${err.message}</p>
          <small>Would you like to <span style="color:#5ab8ff;"><a href="${localUrl}" download="clip.webm" style="color:inherit; text-decoration:none;">download</a></span> the clip instead?</small>
          ${previewHTML}
        `, true);
        ensureClipDownloadButton();
      }
    } finally {
      if (hiddenVideo && hiddenVideo.parentElement) { hiddenVideo.remove(); }
    }
  });
}

if (clipDoneBtn && clipOverlay) {
  clipDoneBtn.addEventListener('click', () => {
    if (lastPreviewObjectURL) { try { URL.revokeObjectURL(lastPreviewObjectURL); } catch {} lastPreviewObjectURL = null; }
    clipOverlay.style.display = 'none'; if (clipButtonsRow) clipButtonsRow.style.display = 'flex';
  });
}

if (clipDownloadBtn) {
  clipDownloadBtn.addEventListener('click', () => {
    if (!lastClipBlob) return; const url = URL.createObjectURL(lastClipBlob);
    const a = document.createElement('a'); a.href = url; a.download = 'clip.webm'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
ensureClipDownloadButton();

