"use strict";

// Variables (top)
const STATUS_URL = 'https://files.catbox.moe/6gkiu0.png';
window.MM_BLOCKED = false; // true when server check fails until user continues
window.MM_POLL_TIMER = null; // holds auto-upload polling interval id
if (typeof window !== 'undefined' && !window.MM_DEFAULT_GITHUB_WORKER_URL) {
  window.MM_DEFAULT_GITHUB_WORKER_URL = 'https://mmback.littlehacker303.workers.dev';
}
