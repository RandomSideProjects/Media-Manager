"use strict";

// Variables (top)
// none

function showHostFailure(container, codeText) {
  let overlay = document.getElementById('serverFailOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'serverFailOverlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.zIndex = '10050';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.innerHTML = `
      <div style="background:#1a1a1a; color:#f1f1f1; border:1px solid #333; border-radius:12px; padding:18px 22px; max-width:720px; width:92%; text-align:center; box-shadow:0 16px 40px rgba(0,0,0,.6);">
        <div style="font-weight:800; font-size:1.25rem; line-height:1.35; white-space:pre-line;">
          Unfortunately, our public source host is currently unavailable.\nPlease try again.
        </div>
        <div style="margin-top:10px;">
          <code style="background:#000; display:inline-block; padding:0.6em 0.8em; border-radius:8px; color:#fff;">HTTP Code : ${codeText}</code>
        </div>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center;">
          <button id="serverContinueBtn" style="padding:8px 14px; border:none; border-radius:8px; background:#007bff; color:#fff; cursor:pointer;">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    const codeEl = overlay.querySelector('code');
    if (codeEl) codeEl.textContent = `HTTP Code : ${codeText}`;
  }

  // Block functionality until user continues
  window.MM_BLOCKED = true;

  const btn = document.getElementById('serverContinueBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      window.MM_BLOCKED = false;
      if (typeof startAutoUploadPolling === 'function' && !window.MM_POLL_TIMER) {
        startAutoUploadPolling();
      }
      const ov = document.getElementById('serverFailOverlay');
      if (ov) ov.remove();
    });
  }
}

async function checkHostAndLoadCreator() {
  const container = document.querySelector('.container') || document.body;
  // Create status box (hidden until success)
  let statusBox = document.getElementById('serverStatusBox');
  if (!statusBox) {
    statusBox = document.createElement('div');
    statusBox.id = 'serverStatusBox';
    document.body.appendChild(statusBox);
  }

  // Create loading box
  let checkBox = document.getElementById('serverCheckBox');
  if (!checkBox) {
    checkBox = document.createElement('div');
    checkBox.id = 'serverCheckBox';
    checkBox.innerHTML = `
      <div class="spinner" aria-hidden="true"></div>
      <div class="serverCheckText" id="serverCheckText">Checking if server is responsive\nTime Elapsed : 00:00</div>
    `;
    document.body.appendChild(checkBox);
  }
  const checkText = document.getElementById('serverCheckText');
  checkBox.style.display = 'flex';

  const started = Date.now();
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };
  const tick = () => {
    if (checkText) checkText.textContent = `Checking if server is responsive\nTime Elapsed : ${fmt(Date.now() - started)}`;
  };
  tick();
  const timer = setInterval(tick, 250);

  const stop = () => {
    clearInterval(timer);
    if (checkBox) checkBox.remove();
  };

  let resp;
  try {
    resp = await fetch(STATUS_URL, { cache: 'no-store' });
  } catch (err) {
    stop();
    showHostFailure(container, err && err.message ? err.message : 'Network error');
    return;
  }

  if (!resp || !resp.ok) {
    const codeText = resp ? `${resp.status} ${resp.statusText || ''}`.trim() : 'Unknown error';
    stop();
    showHostFailure(container, codeText);
    return;
  }

  // Success path: show status code box and continue
  stop();
  statusBox.textContent = `Server status code\n${resp.status}`;
  statusBox.style.display = 'block';
}

// Run on load
checkHostAndLoadCreator();

