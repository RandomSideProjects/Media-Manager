"use strict";

(function () {
  const POPOUT_NOTICE_MESSAGE =
    "The player is running in a pop-out window. Close that window to resume playback here.";

  const HARD_CODED_TOOLBAR_PLACEMENT = "left";

  let popoutNoticeHandle = null;
  let popoutMonitorInterval = null;

  function getActiveVideo() {
    if (typeof window !== "undefined" && typeof window.MM_getActiveVideoElement === "function") {
      try { return window.MM_getActiveVideoElement(); } catch {}
    }
    if (typeof video !== "undefined") return video;
    return document.getElementById("videoPlayer");
  }

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
      try { popoutNoticeHandle.close(); } catch {}
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
      if (!pop || pop.closed) stopPopoutMonitor();
    }, 250);
  }

  function showBlockedMessage(msg) {
    try {
      if (typeof window.showStorageNotice === "function") {
        window.showStorageNotice({ title: "Pop-out blocked", message: msg, tone: "warning", autoCloseMs: null });
        return;
      }
    } catch {}
    try { if (typeof showPlayerAlert === "function") { showPlayerAlert(msg); return; } } catch {}
    try { if (typeof window.alert === "function") window.alert(msg); } catch {}
  }

  function computePopupSize(v) {
    const naturalWidth = (v && v.videoWidth) ? v.videoWidth : 16;
    const naturalHeight = (v && v.videoHeight) ? v.videoHeight : 9;
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
    return { popWidth, popHeight };
  }

  function openPopout() {
    const v = getActiveVideo();
    if (!v) return;

    try { v.pause(); } catch {}
    const src = (typeof window.MM_getOriginalVideoSource === "function")
      ? (window.MM_getOriginalVideoSource(v) || v.currentSrc || v.src || "")
      : (v.currentSrc || v.src || "");
    const currentTime = v.currentTime || 0;
    const { popWidth, popHeight } = computePopupSize(v);

    const pop = window.open("", "_blank", `width=${popWidth},height=${popHeight},resizable=yes,scrollbars=no`);
    if (!pop || pop.closed || typeof pop.document === "undefined") {
      const msg = "Pop-out blocked by your browser. Please allow pop-ups for this site to enable the pop-out player.";
      try { v.play(); } catch {}
      showBlockedMessage(msg);
      return null;
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
          body::-webkit-scrollbar { display: none; }
          video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #000;
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
          .pop-toolbar {
            position: absolute;
            display: flex;
            gap: 0.35rem;
            align-items: center;
            background: rgba(0, 0, 0, 0.75);
            border: 1px solid rgba(255, 255, 255, 0.25);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
            transition: transform 0.25s ease, opacity 0.25s ease;
            pointer-events: none;
            opacity: 0.98;
          }
          .pop-toolbar.placement-left {
            top: 0;
            bottom: 0;
            left: 0;
            width: 90px;
            padding: 0.7rem 0.35rem;
            flex-direction: column;
            justify-content: center;
            background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.85));
            transform: translateX(-100%);
          }
          .pop-toolbar.visible { pointer-events: auto; transform: translateX(0); }
          .pop-toolbar button { width: 100%; }
          .pop-toolbar button {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 999px;
            padding: 0.35rem 0.6rem;
            color: #fff;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease;
          }
          .pop-toolbar button:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.8); }
          .pop-toolbar button:disabled { opacity: 0.4; cursor: not-allowed; }
          @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
        </style>
      </head>
      <body>
        <div id="popSpinner" class="spinner"></div>
        <video id="popVideo" autoplay playsinline></video>
        <div id="popToolbar" class="pop-toolbar placement-left" aria-hidden="true">
          <button id="popBackBtn" type="button">↩ Back 5s</button>
          <button id="popNextItemBtn" type="button">Next</button>
          <button id="popForwardBtn" type="button">Forward 5s ↪</button>
          <button id="popExitBtn" type="button">Exit</button>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"><\/script>
        <script>
          const popSource = ${JSON.stringify(src)};
          const popStartTime = ${JSON.stringify(Number.isFinite(currentTime) ? currentTime : 0)};
          const v = document.getElementById("popVideo");
          const popSpinner = document.getElementById("popSpinner");
          const activityEvents = ["mousemove","mousedown","keydown","touchstart","touchmove"];
          const popToolbar = document.getElementById("popToolbar");
          const popBackBtn = document.getElementById("popBackBtn");
          const popNextBtn = document.getElementById("popNextItemBtn");
          const popForwardBtn = document.getElementById("popForwardBtn");
          const popExitBtn = document.getElementById("popExitBtn");

          const TOOLBAR_TRIGGER_ZONE = 120;
          const TOOLBAR_HIDE_DELAY_MS = 1500;
          const TOOLBAR_IDLE_HIDE_MS = 400;
          const placement = "left";

          let toolbarHideTimer = null;
          let nextButtonPoll = null;
          let popHls = null;
          let fallbackParts = null;
          let fallbackLoading = false;
          let fallbackOffsets = [];
          let fallbackIndex = 0;

          function setToolbarVisible(visible) {
            if (!popToolbar) return;
            popToolbar.classList.toggle("visible", !!visible);
            popToolbar.setAttribute("aria-hidden", visible ? "false" : "true");
          }

          function scheduleHideToolbar(delay) {
            if (toolbarHideTimer) clearTimeout(toolbarHideTimer);
            toolbarHideTimer = setTimeout(() => setToolbarVisible(false), delay);
          }

          function handleSurfaceMove(event) {
            const x = (event.touches && event.touches[0]) ? event.touches[0].clientX : event.clientX;
            const nearLeft = typeof x === "number" ? x <= TOOLBAR_TRIGGER_ZONE : false;
            if (nearLeft) {
              setToolbarVisible(true);
              scheduleHideToolbar(TOOLBAR_HIDE_DELAY_MS);
              return;
            }
            scheduleHideToolbar(TOOLBAR_IDLE_HIDE_MS);
          }

          function seekBy(delta) {
            if (fallbackParts && fallbackParts.length) {
              setFallbackCombinedTime(getFallbackCombinedTime() + delta);
              return;
            }
            try { v.currentTime = Math.max(0, (v.currentTime || 0) + delta); } catch {}
          }

          function isHlsSource(source) {
            try { return /\\.m3u8$/i.test(new URL(source, window.location.href).pathname); }
            catch { return /\\.m3u8(?:$|[?#])/i.test(String(source || "")); }
          }

          function isManagedPlaylistSource(source) {
            if (!isHlsSource(source)) return false;
            try { return /\\/Sources\\/Files\\/Playlists\\//i.test(new URL(source, window.location.href).pathname); }
            catch { return /(^|\\/)Sources\\/Files\\/Playlists\\//i.test(String(source || "")); }
          }

          function isPrivatePlaybackHost(hostname) {
            const host = String(hostname || "").trim().toLowerCase();
            if (!host) return false;
            if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
            if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
            if (!/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(host)) return false;
            const parts = host.split(".").map(Number);
            if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
            const a = parts[0];
            const b = parts[1];
            return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
          }

          function isHttpUrl(source) {
            try {
              const parsed = new URL(String(source || ""));
              return parsed.protocol === "http:" || parsed.protocol === "https:";
            } catch {
              return false;
            }
          }

          function unwrapVideoProxyUrl(source) {
            const src = String(source || "").trim();
            if (!src || !isHttpUrl(src)) return src;
            try {
              const parsed = new URL(src);
              if (/\\/proxy\\/?$/i.test(parsed.pathname) && parsed.searchParams.has("url")) {
                return parsed.searchParams.get("url") || src;
              }
            } catch {}
            return src;
          }

          function resolveHlsMediaUrl(source) {
            return unwrapVideoProxyUrl(source);
          }

          function canPlayNativeHls(el) {
            try {
              return !!(el && (el.canPlayType("application/vnd.apple.mpegurl") || el.canPlayType("application/x-mpegURL")));
            } catch { return false; }
          }

          function setStartTimeWhenReady(seconds) {
            const target = Number(seconds);
            if (!Number.isFinite(target) || target < 0) return;
            const apply = () => { try { v.currentTime = target; } catch {} };
            if (v && v.readyState >= 1) apply();
            else if (v) v.addEventListener("loadedmetadata", apply, { once: true });
          }

          function destroyPopHls() {
            if (popHls && typeof popHls.destroy === "function") {
              try { popHls.destroy(); } catch {}
            }
            popHls = null;
          }

          function parsePlaylist(text, baseUrl) {
            const parts = [];
            let pendingDuration = null;
            let pendingTitle = "";
            String(text || "").split(/\\r?\\n/).forEach((rawLine) => {
              const line = String(rawLine || "").trim();
              if (!line) return;
              const extInf = line.match(/^#EXTINF:([^,]*)(?:,(.*))?$/i);
              if (extInf) {
                const duration = Number.parseFloat(extInf[1]);
                pendingDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
                pendingTitle = String(extInf[2] || "").trim();
                return;
              }
              if (line[0] === "#") return;
              let partSrc = line;
              try { partSrc = new URL(line, baseUrl).href; } catch {}
              const part = {
                title: pendingTitle || ("Part " + (parts.length + 1)),
                src: resolveHlsMediaUrl(partSrc),
                originalSrc: partSrc
              };
              if (pendingDuration !== null) part.durationSeconds = pendingDuration;
              parts.push(part);
              pendingDuration = null;
              pendingTitle = "";
            });
            return parts;
          }

          function computeFallbackOffsets(parts) {
            const offsets = [];
            let running = 0;
            parts.forEach((part) => {
              offsets.push(running);
              const duration = Number(part && part.durationSeconds);
              if (Number.isFinite(duration) && duration > 0) running += duration;
            });
            return offsets;
          }

          function resolveFallbackPosition(seconds) {
            const target = Math.max(0, Number(seconds) || 0);
            if (!fallbackParts || !fallbackParts.length) return { index: 0, time: target };
            let index = 0;
            for (let i = 0; i < fallbackParts.length; i += 1) {
              const start = fallbackOffsets[i] || 0;
              const next = (i + 1 < fallbackParts.length) ? fallbackOffsets[i + 1] : Infinity;
              if (target >= start && target < next) {
                index = i;
                break;
              }
              if (target >= start) index = i;
            }
            return { index, time: Math.max(0, target - (fallbackOffsets[index] || 0)) };
          }

          function getFallbackCombinedTime() {
            if (!fallbackParts || !fallbackParts.length) return Number(v && v.currentTime) || 0;
            return (fallbackOffsets[fallbackIndex] || 0) + (Number(v && v.currentTime) || 0);
          }

          function setFallbackPart(index, time) {
            if (!fallbackParts || !fallbackParts.length || !v) return;
            fallbackIndex = Math.max(0, Math.min(index, fallbackParts.length - 1));
            const part = fallbackParts[fallbackIndex];
            if (!part || !part.src) return;
            v.src = part.src;
            setStartTimeWhenReady(time || 0);
            try { v.load(); } catch {}
            const playPromise = v.play();
            if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
          }

          function setFallbackCombinedTime(seconds) {
            const position = resolveFallbackPosition(seconds);
            setFallbackPart(position.index, position.time);
          }

          async function startPlaylistFallback(source, startTime) {
            if (!isHlsSource(source) || fallbackParts || fallbackLoading) return;
            fallbackLoading = true;
            try {
              destroyPopHls();
              const playlistUrl = new URL(source, window.location.href).href;
              const response = await fetch(playlistUrl, { cache: "no-store" });
              if (!response || !response.ok) return;
              fallbackParts = parsePlaylist(await response.text(), playlistUrl).filter(part => part && part.src);
              fallbackOffsets = computeFallbackOffsets(fallbackParts);
              if (fallbackParts.length) setFallbackCombinedTime(startTime || 0);
            } catch {
            } finally {
              fallbackLoading = false;
            }
          }

          function attachPopSource(source, startTime) {
            if (!v || !source) return;
            if (isManagedPlaylistSource(source)) {
              startPlaylistFallback(source, startTime);
              return;
            }
            if (!isHlsSource(source)) {
              v.src = source;
              setStartTimeWhenReady(startTime);
              try { v.load(); } catch {}
              return;
            }
            if (canPlayNativeHls(v)) {
              v.src = source;
              setStartTimeWhenReady(startTime);
              v.addEventListener("error", () => startPlaylistFallback(source, startTime), { once: true });
              try { v.load(); } catch {}
              return;
            }
            if (window.Hls && typeof window.Hls.isSupported === "function" && window.Hls.isSupported()) {
              const hlsConfig = { enableWorker: true, backBufferLength: 90 };
              popHls = new window.Hls(hlsConfig);
              popHls.on(window.Hls.Events.ERROR, (_event, data) => {
                if (data && data.fatal) startPlaylistFallback(source, Number(v.currentTime) || startTime || 0);
              });
              popHls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
                try { popHls.loadSource(source); } catch {}
              });
              popHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                setStartTimeWhenReady(startTime);
                const playPromise = v.play();
                if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
              });
              try { popHls.attachMedia(v); } catch { startPlaylistFallback(source, startTime); }
              return;
            }
            startPlaylistFallback(source, startTime);
          }

          function pollNextButton() {
            try {
              const openerNext = window.opener && window.opener.document ? window.opener.document.getElementById("nextBtn") : null;
              const canNext = !!(openerNext && openerNext.getClientRects && openerNext.getClientRects().length > 0);
              if (popNextBtn) popNextBtn.disabled = !canNext;
            } catch {
              if (popNextBtn) popNextBtn.disabled = true;
            }
          }

          function safeClickOpenerNext() {
            try {
              const openerNext = window.opener && window.opener.document ? window.opener.document.getElementById("nextBtn") : null;
              if (openerNext && typeof openerNext.click === "function") openerNext.click();
            } catch {}
          }

          if (v) {
            v.addEventListener("loadstart", () => { if (popSpinner) popSpinner.style.display = "block"; });
            v.addEventListener("waiting", () => { if (popSpinner) popSpinner.style.display = "block"; });
            v.addEventListener("canplay", () => { if (popSpinner) popSpinner.style.display = "none"; });
            v.addEventListener("playing", () => { if (popSpinner) popSpinner.style.display = "none"; });
            v.addEventListener("ended", () => {
              if (fallbackParts && fallbackIndex < fallbackParts.length - 1) {
                setFallbackPart(fallbackIndex + 1, 0);
              }
            });
          }

          attachPopSource(popSource, popStartTime);

          activityEvents.forEach(evt => window.addEventListener(evt, handleSurfaceMove, { passive: true }));
          handleSurfaceMove({ clientX: 0 });

          if (popBackBtn) popBackBtn.addEventListener("click", () => seekBy(-5));
          if (popForwardBtn) popForwardBtn.addEventListener("click", () => seekBy(5));
          if (popExitBtn) popExitBtn.addEventListener("click", () => window.close());
          if (popNextBtn) popNextBtn.addEventListener("click", () => safeClickOpenerNext());

          pollNextButton();
          nextButtonPoll = setInterval(pollNextButton, 700);

          function onUnload() {
            try { if (nextButtonPoll) clearInterval(nextButtonPoll); } catch {}
            try {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: "popoutTime", currentTime: fallbackParts ? getFallbackCombinedTime() : v.currentTime }, "*");
              }
            } catch {}
          }

          window.addEventListener("beforeunload", onUnload);
          window.addEventListener("unload", onUnload);

          // Basic shortcuts
          window.addEventListener("keydown", (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = (event.key || "").toLowerCase();
            if (key === " " || key === "k") { event.preventDefault(); try { v.paused ? v.play() : v.pause(); } catch {} }
            if (key === "m") { event.preventDefault(); try { v.muted = !v.muted; } catch {} }
            if (key === "j" || event.key === "ArrowLeft") { event.preventDefault(); seekBy(-5); }
            if (key === "l" || event.key === "ArrowRight") { event.preventDefault(); seekBy(5); }
            if (key === "escape") { event.preventDefault(); window.close(); }
          });
        <\/script>
      </body>
      </html>
    `);

    try {
      const popVideo = pop.document.getElementById("popVideo");
      if (popVideo) popVideo.currentTime = currentTime;
    } catch {}

    startPopoutMonitor(pop);
    return pop;
  }

  if (typeof window !== "undefined") {
    window.MM_openPopout = openPopout;
  }
})();
