"use strict";

// Variables (top)
const STATUS_URL = 'https://files.catbox.moe/6gkiu0.png';
window.MM_BLOCKED = true; // gate auto-polling until health checks complete
window.MM_POLL_TIMER = null; // holds auto-upload polling interval id
if (typeof window !== 'undefined') {
  if (!window.MM_DEFAULT_GITHUB_WORKER_URL) {
    window.MM_DEFAULT_GITHUB_WORKER_URL = 'https://mmback.littlehacker303.workers.dev/gh';
  }
  if (!window.MM_DEFAULT_CATBOX_UPLOAD_URL) {
    window.MM_DEFAULT_CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';
  }
}
