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
          .pop-toolbar.placement-bottom {
            left: 0;
            right: 0;
            bottom: 0;
            padding: 0.5rem 1rem;
            justify-content: center;
            flex-direction: row;
            background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.85));
            transform: translateY(100%);
          }
          .pop-toolbar.placement-left,
          .pop-toolbar.placement-right {
            top: 0;
            bottom: 0;
            width: 90px;
            padding: 0.7rem 0.35rem;
            flex-direction: column;
            justify-content: center;
            background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.85));
          }
          .pop-toolbar.placement-left {
            left: 0;
            right: auto;
            transform: translateX(-100%);
          }
          .pop-toolbar.placement-right {
            right: 0;
            left: auto;
            transform: translateX(100%);
          }
          .pop-toolbar.visible {
            pointer-events: auto;
          }
          .pop-toolbar.visible.placement-bottom {
            transform: translateY(0);
          }
          .pop-toolbar.visible.placement-left,
          .pop-toolbar.visible.placement-right {
            transform: translateX(0);
          }
          .pop-toolbar.placement-left button,
          .pop-toolbar.placement-right button {
            width: 100%;
          }
          .pop-toolbar button {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 999px;
            padding: 0.35rem 1.1rem;
            color: #fff;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s ease, border-color 0.2s ease;
          }
          .pop-toolbar button:hover {
            background: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.8);
          }
          .pop-toolbar button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
        </style>
      </head>
      <body>
        <div id="popSpinner" class="spinner"></div>
        <video id="popVideo" src="${src}" autoplay></video>
        <div id="popToolbar" class="pop-toolbar" aria-hidden="true">
          <button id="popBackBtn" type="button">↩ Back 5s</button>
          <button id="popNextItemBtn" type="button">Next</button>
          <button id="popForwardBtn" type="button">Forward 5s ↪</button>
          <button id="popExitBtn" type="button">Exit Pop-out</button>
        </div>
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
            hideControlsTimer = setTimeout(hideControls, 2000);
          };
          const revealControls = () => {
            v.controls = true;
            scheduleHide();
          };
          activityEvents.forEach(evt => window.addEventListener(evt, revealControls));
          const popToolbar = document.getElementById("popToolbar");
          const popBackBtn = document.getElementById("popBackBtn");
          const popNextBtn = document.getElementById("popNextItemBtn");
          const popForwardBtn = document.getElementById("popForwardBtn");
          const popExitBtn = document.getElementById("popExitBtn");
          const TOOLBAR_TRIGGER_ZONE = 120;
          const TOOLBAR_HIDE_DELAY_MS = 1500;
          const TOOLBAR_IDLE_HIDE_MS = 400;
          const POPUP_TOOLBAR_PLACEMENT_KEY = "popoutToolbarPlacement";
          const POPUP_TOOLBAR_PLACEMENTS = ["bottom", "left", "right"];
          let toolbarHideTimer = null;
          let nextButtonPoll = null;
          const storedPlacement = localStorage.getItem(POPUP_TOOLBAR_PLACEMENT_KEY);
          let toolbarPlacement = POPUP_TOOLBAR_PLACEMENTS.includes(storedPlacement) ? storedPlacement : "bottom";

          function applyToolbarPlacement(value) {
            if (!popToolbar) return;
            const placement = POPUP_TOOLBAR_PLACEMENTS.includes(value) ? value : "bottom";
            toolbarPlacement = placement;
            POPUP_TOOLBAR_PLACEMENTS.forEach(pl => {
              popToolbar.classList.toggle('placement-' + pl, pl === placement);
            });
          }

          function showPopToolbar() {
            if (!popToolbar) return;
            popToolbar.classList.add("visible");
            popToolbar.setAttribute("aria-hidden", "false");
          }

          function scheduleToolbarHide(delay) {
            if (!popToolbar) return;
            if (toolbarHideTimer) clearTimeout(toolbarHideTimer);
            toolbarHideTimer = setTimeout(() => {
              popToolbar.classList.remove("visible");
              popToolbar.setAttribute("aria-hidden", "true");
              toolbarHideTimer = null;
            }, typeof delay === "number" ? delay : TOOLBAR_HIDE_DELAY_MS);
          }

          function getEventCoords(event) {
            if (event.touches && event.touches.length) {
              return {
                x: event.touches[0].clientX,
                y: event.touches[0].clientY
              };
            }
            return {
              x: event.clientX,
              y: event.clientY
            };
          }

          function isNearToolbarEdge(coords) {
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            if (toolbarPlacement === "left") {
              return typeof coords.x === "number" && coords.x <= TOOLBAR_TRIGGER_ZONE;
            }
            if (toolbarPlacement === "right") {
              return typeof coords.x === "number" && viewportWidth - coords.x <= TOOLBAR_TRIGGER_ZONE;
            }
            return typeof coords.y === "number" && viewportHeight - coords.y <= TOOLBAR_TRIGGER_ZONE;
          }

          function handlePopoutSurfaceMove(event) {
            if (!popToolbar) return;
            const coords = getEventCoords(event);
            if (isNearToolbarEdge(coords)) {
              showPopToolbar();
              scheduleToolbarHide(TOOLBAR_HIDE_DELAY_MS);
              return;
            }
            if (!popToolbar.contains(event.target)) {
              scheduleToolbarHide(TOOLBAR_IDLE_HIDE_MS);
            }
          }

          applyToolbarPlacement(toolbarPlacement);

          if (popToolbar) {
            popToolbar.addEventListener("mouseenter", () => {
              if (toolbarHideTimer) {
                clearTimeout(toolbarHideTimer);
                toolbarHideTimer = null;
              }
              showPopToolbar();
            });
            popToolbar.addEventListener("mouseleave", () => {
              scheduleToolbarHide(TOOLBAR_IDLE_HIDE_MS);
            });
          }
          window.addEventListener("mousemove", handlePopoutSurfaceMove);
          window.addEventListener("touchstart", handlePopoutSurfaceMove);
          window.addEventListener("touchmove", handlePopoutSurfaceMove);

          function handlePopoutStorageEvent(event) {
            if (event.key !== POPUP_TOOLBAR_PLACEMENT_KEY) return;
            applyToolbarPlacement(event.newValue || "bottom");
          }

          window.addEventListener("storage", handlePopoutStorageEvent);

          function resolveOpenerNextBtn() {
            if (!window.opener || window.opener.closed) return null;
            try {
              return window.opener.document ? window.opener.document.getElementById("nextBtn") : null;
            } catch (err) {
              return null;
            }
          }

          function updatePopNextVisibility() {
            if (!popNextBtn) return;
            const openerNext = resolveOpenerNextBtn();
            if (!openerNext) {
              popNextBtn.style.display = "none";
              return;
            }
            try {
              const computed = window.opener.getComputedStyle(openerNext);
              const show = computed && computed.display !== "none" && computed.visibility !== "hidden";
              popNextBtn.style.display = show ? "" : "none";
            } catch (err) {
              popNextBtn.style.display = "none";
            }
          }

          function startNextVisibilityTracking() {
            updatePopNextVisibility();
            if (nextButtonPoll) clearInterval(nextButtonPoll);
            nextButtonPoll = setInterval(updatePopNextVisibility, 1200);
          }

          function stopNextVisibilityTracking() {
            if (nextButtonPoll) {
              clearInterval(nextButtonPoll);
              nextButtonPoll = null;
            }
          }

          if (popBackBtn) {
            popBackBtn.addEventListener("click", () => {
              seekPopoutBy(-KEY_SHORTCUT_SEEK_DELTA);
            });
          }
          if (popNextBtn) {
            popNextBtn.addEventListener("click", () => {
              const openerNext = resolveOpenerNextBtn();
              if (openerNext && typeof openerNext.click === "function") {
                openerNext.click();
              }
            });
          }
          if (popForwardBtn) {
            popForwardBtn.addEventListener("click", () => {
              seekPopoutBy(KEY_SHORTCUT_SEEK_DELTA);
            });
          }
          if (popExitBtn) {
            popExitBtn.addEventListener("click", () => {
              stopNextVisibilityTracking();
              window.close();
            });
          }
          startNextVisibilityTracking();
          const SEEK_DELTA = 5;
          const KEY_SHORTCUT_SEEK_DELTA = SEEK_DELTA;
          const KEY_SHORTCUT_VOLUME_DELTA = 0.05;
          const GAMEPAD_SHORTCUT_SEEK_DELTA = SEEK_DELTA;
          const GAMEPAD_SHORTCUT_VOLUME_DELTA = 0.1;

          function clampPopoutVolume(value) {
            return Math.max(0, Math.min(1, value));
          }

          function togglePopoutPlayPause() {
            if (!v) return;
            if (v.paused) {
              const playPromise = v.play();
              if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
              }
            } else {
              v.pause();
            }
          }

          function togglePopoutMute() {
            if (!v) return;
            v.muted = !v.muted;
          }

          function seekPopoutBy(delta) {
            if (!v) return;
            let target = (Number.isFinite(v.currentTime) && v.currentTime >= 0) ? v.currentTime : 0;
            target += Number(delta) || 0;
            const duration = (Number.isFinite(v.duration) && v.duration > 0) ? v.duration : null;
            if (duration !== null) {
              target = Math.min(duration, Math.max(0, target));
            } else {
              target = Math.max(0, target);
            }
            try {
              v.currentTime = target;
            } catch {}
          }

          function changePopoutVolume(delta) {
            if (!v) return;
            const current = Number.isFinite(v.volume) ? v.volume : 0;
            const next = clampPopoutVolume(current + (Number(delta) || 0));
            if (next > 0 && v.muted) {
              v.muted = false;
            }
            v.volume = next;
          }

          function togglePopoutFullscreen() {
            if (!v) return;
            const doc = document;
            const fullscreenElement =
              doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
            if (fullscreenElement) {
              const exitFullscreen =
                doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
              if (typeof exitFullscreen === "function") {
                exitFullscreen.call(doc);
              }
              return;
            }
            const requestFullscreen =
              v.requestFullscreen || v.webkitRequestFullscreen || v.mozRequestFullScreen || v.msRequestFullscreen;
            if (typeof requestFullscreen === "function") {
              requestFullscreen.call(v);
            }
          }

          function handlePopoutKeydown(event) {
            if (!v) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key || "";
            const lowerKey = key.toLowerCase();
            if (key === " " || event.code === "Space" || lowerKey === "k") {
              event.preventDefault();
              togglePopoutPlayPause();
              return;
            }
            if (lowerKey === "m") {
              event.preventDefault();
              togglePopoutMute();
              return;
            }
            if (lowerKey === "f") {
              event.preventDefault();
              togglePopoutFullscreen();
              return;
            }
            if (key === "ArrowRight" || lowerKey === "l") {
              event.preventDefault();
              seekPopoutBy(KEY_SHORTCUT_SEEK_DELTA);
              return;
            }
            if (key === "ArrowLeft" || lowerKey === "j") {
              event.preventDefault();
              seekPopoutBy(-KEY_SHORTCUT_SEEK_DELTA);
              return;
            }
            if (key === "ArrowUp") {
              event.preventDefault();
              changePopoutVolume(KEY_SHORTCUT_VOLUME_DELTA);
              return;
            }
            if (key === "ArrowDown") {
              event.preventDefault();
              changePopoutVolume(-KEY_SHORTCUT_VOLUME_DELTA);
            }
          }
          window.addEventListener("keydown", handlePopoutKeydown);

          const GAMEPAD_BUTTON_ACTIONS = {
            0: () => togglePopoutPlayPause(),
            1: () => togglePopoutMute(),
            2: () => togglePopoutFullscreen(),
            12: () => changePopoutVolume(GAMEPAD_SHORTCUT_VOLUME_DELTA),
            13: () => changePopoutVolume(-GAMEPAD_SHORTCUT_VOLUME_DELTA),
            14: () => seekPopoutBy(-GAMEPAD_SHORTCUT_SEEK_DELTA),
            15: () => seekPopoutBy(GAMEPAD_SHORTCUT_SEEK_DELTA)
          };
          const gamepadPrevStates = new Map();
          let gamepadRequestId = null;

          function handlePopoutGamepadButtonPress(buttonIndex) {
            const action = GAMEPAD_BUTTON_ACTIONS[buttonIndex];
            if (typeof action === "function") {
              action();
            }
          }

          function popoutPollGamepads() {
            if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
            const pads = navigator.getGamepads();
            if (!pads) {
              gamepadPrevStates.clear();
              return;
            }
            let anyConnected = false;
            for (const pad of pads) {
              if (!pad || !pad.connected) continue;
              anyConnected = true;
              const previous = gamepadPrevStates.get(pad.index) || [];
              pad.buttons.forEach((button, idx) => {
                const wasPressed = !!previous[idx];
                if (button && button.pressed && !wasPressed) {
                  handlePopoutGamepadButtonPress(idx);
                }
              });
              const nextStates = pad.buttons.map(btn => !!(btn && btn.pressed));
              gamepadPrevStates.set(pad.index, nextStates);
            }
            if (!anyConnected) {
              gamepadPrevStates.clear();
            }
          }

          function popoutGamepadLoop() {
            popoutPollGamepads();
            if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
            gamepadRequestId = window.requestAnimationFrame(popoutGamepadLoop);
          }

          function startPopoutGamepadPolling() {
            if (gamepadRequestId !== null) return;
            if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
            popoutGamepadLoop();
          }

          function stopPopoutGamepadPolling() {
            if (gamepadRequestId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
              window.cancelAnimationFrame(gamepadRequestId);
            }
            gamepadRequestId = null;
            gamepadPrevStates.clear();
          }

          if (typeof navigator !== "undefined" && (typeof navigator.getGamepads === "function" || "getGamepads" in navigator)) {
            startPopoutGamepadPolling();
            window.addEventListener("gamepadconnected", startPopoutGamepadPolling);
            window.addEventListener("gamepaddisconnected", () => {
              if (typeof navigator.getGamepads !== "function") return;
              const padsSnapshot = navigator.getGamepads();
              if (!padsSnapshot) {
                stopPopoutGamepadPolling();
                return;
              }
              const connected = Array.from(padsSnapshot).some(p => p && p.connected);
              if (!connected) {
                stopPopoutGamepadPolling();
              }
            });
          }
          hideControls();
          v.addEventListener("loadstart", () => { popSpinner.style.display = "block"; });
          v.addEventListener("waiting", () => { popSpinner.style.display = "block"; });
          v.addEventListener("canplay", () => { popSpinner.style.display = "none"; });
          v.addEventListener("playing", () => { popSpinner.style.display = "none"; });
          popSpinner.style.display = "block";
          v.currentTime = ${currentTime};
          window.addEventListener("beforeunload", () => {
            stopNextVisibilityTracking();
            window.removeEventListener("storage", handlePopoutStorageEvent);
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
