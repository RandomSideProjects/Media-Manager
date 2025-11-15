"use strict";

const POPOUT_NOTICE_MESSAGE =
  "The player is running in a pop-out window. Close that window to resume playback here.";

let popoutNoticeHandle = null;
let popoutMonitorInterval = null;

function showPopoutNotice() {
  hidePopoutNotice();
  const notifier = window.showStorageNotice || window.showAppNotice;
  if (typeof notifier !== "function") return;
  try {
    popoutNoticeHandle = notifier({
      title: "Pop-out player active",
      message: POPOUT_NOTICE_MESSAGE,
      tone: "info",
      persistent: true,
      autoCloseMs: null,
      dismissLabel: null
    });
  } catch (err) {
    console.error("[Pop-out] failed to show notice", err);
    popoutNoticeHandle = null;
  }
}

function hidePopoutNotice() {
  if (popoutNoticeHandle && typeof popoutNoticeHandle.close === "function") {
    try {
      popoutNoticeHandle.close();
    } catch (err) {
      console.error("[Pop-out] failed to close notice", err);
    }
  }
  popoutNoticeHandle = null;
}

function stopPopoutMonitor() {
  if (popoutMonitorInterval) {
    clearInterval(popoutMonitorInterval);
    popoutMonitorInterval = null;
  }
  hidePopoutNotice();
}

function startPopoutMonitor(pop) {
  stopPopoutMonitor();
  if (!pop) return;
  showPopoutNotice();
  popoutMonitorInterval = setInterval(() => {
    if (!pop || pop.closed) {
      stopPopoutMonitor();
    }
  }, 250);
}

if (theaterBtn && video) {
  theaterBtn.addEventListener("click", () => {
    video.pause();
    const src = video.src;
    const currentTime = video.currentTime || 0;
    const naturalWidth = video.videoWidth || 16;
    const naturalHeight = video.videoHeight || 9;
    const ratio = naturalHeight > 0 ? naturalWidth / naturalHeight : 16 / 9;
    const screenWidth = window.screen.availWidth || window.innerWidth;
    const screenHeight = window.screen.availHeight || window.innerHeight;
    const maxWidth = Math.max(640, Math.min(screenWidth - 60, 1400));
    const maxHeight = Math.max(360, Math.min(screenHeight - 80, 900));
    let popWidth = Math.min(maxWidth, Math.round(maxHeight * ratio));
    let popHeight = Math.round(popWidth / ratio);
    if (popHeight > maxHeight) {
      popHeight = maxHeight;
      popWidth = Math.round(popHeight * ratio);
    }
    const pop = window.open("", "_blank", `width=${popWidth},height=${popHeight},resizable=yes,scrollbars=no`);
    if (!pop || pop.closed || typeof pop.document === "undefined") {
      const msg =
        "Pop-out blocked by your browser. Please allow pop-ups for this site to enable the theater window.";
      try {
        video.play();
      } catch {}
      try {
        if (typeof window.showStorageNotice === "function") {
          window.showStorageNotice({
            title: "Pop-out blocked",
            message: msg,
            tone: "warning",
            autoCloseMs: null
          });
        } else if (typeof showPlayerAlert === "function") {
          showPlayerAlert(msg);
        } else if (typeof window.alert === "function") {
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
          html, body {
            width: 100%;
            height: 100%;
            margin: 0;
            background: black;
            overflow: hidden;
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          body::-webkit-scrollbar {
            display: none;
          }
          video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
          }
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
        <video id="popVideo" src="${src}" autoplay></video>
        <script>
          const v = document.getElementById("popVideo");
          const popSpinner = document.getElementById("popSpinner");
          const activityEvents = ["mousemove","mousedown","keydown","touchstart"];
          let hideControlsTimer = null;
          const hideControls = () => { v.controls = false; };
          const scheduleHide = () => {
            if (hideControlsTimer) {
              clearTimeout(hideControlsTimer);
            }
            hideControlsTimer = setTimeout(hideControls, 10000);
          };
          const revealControls = () => {
            v.controls = true;
            scheduleHide();
          };
          activityEvents.forEach(evt => window.addEventListener(evt, revealControls));
          hideControls();
          v.addEventListener("loadstart", () => { popSpinner.style.display = "block"; });
          v.addEventListener("waiting", () => { popSpinner.style.display = "block"; });
          v.addEventListener("canplay", () => { popSpinner.style.display = "none"; });
          v.addEventListener("playing", () => { popSpinner.style.display = "none"; });
          popSpinner.style.display = "block";
          v.currentTime = ${currentTime};
          window.addEventListener("beforeunload", () => {
            window.opener.postMessage({ type: "popoutTime", currentTime: v.currentTime }, "*");
          });
        <\/script>
      </body>
      </html>
    `);
    pop.document.close();
    startPopoutMonitor(pop);
  });
}
