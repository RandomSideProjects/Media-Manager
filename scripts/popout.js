"use strict";

if (theaterBtn && video) {
  theaterBtn.addEventListener("click", () => {
    video.pause();
    const src = video.src;
    const currentTime = video.currentTime || 0;
    const pop = window.open('', '_blank', 'width=800,height=450');
    if (!pop || pop.closed || typeof pop.document === 'undefined') {
      const msg = 'Pop-out blocked by your browser. Please allow pop-ups for this site to enable the theater window.';
      try { video.play(); } catch {}
      try {
        if (typeof window.showStorageNotice === 'function') {
          window.showStorageNotice({
            title: 'Pop-out blocked',
            message: msg,
            tone: 'warning',
            autoCloseMs: null
          });
        } else if (typeof showPlayerAlert === 'function') {
          showPlayerAlert(msg);
        } else if (typeof window.alert === 'function') {
          window.alert(msg);
        }
      } catch {}
      return;
    }
    pop.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Pop-out Player</title>
        <style>
          body { margin: 0; background: black; }
          video { width: 100%; height: 100vh; }
          #popSpinner {
            display: none;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            border: 4px solid rgba(255,255,255,0.3);
            border-top: 4px solid #007bff;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            z-index: 1000;
          }
          @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
        </style>
      </head>
      <body>
        <div id="popSpinner" class="spinner"></div>
        <video id="popVideo" src="${src}" controls autoplay></video>
        <script>
          const v = document.getElementById('popVideo');
          const popSpinner = document.getElementById('popSpinner');
          v.addEventListener('loadstart', () => { popSpinner.style.display = 'block'; });
          v.addEventListener('waiting', () => { popSpinner.style.display = 'block'; });
          v.addEventListener('canplay', () => { popSpinner.style.display = 'none'; });
          v.addEventListener('playing', () => { popSpinner.style.display = 'none'; });
          popSpinner.style.display = 'block';
          v.currentTime = ${currentTime};
          window.addEventListener('beforeunload', () => {
            window.opener.postMessage({ type: 'popoutTime', currentTime: v.currentTime }, '*');
          });
        <\/script>
      </body>
      </html>
    `);
  });
}
