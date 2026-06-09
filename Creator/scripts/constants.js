"use strict";

// Variables (top)
window.MM_BLOCKED = true; // gate auto-polling until health checks complete
window.MM_POLL_TIMER = null; // holds auto-upload polling interval id
if (typeof window !== 'undefined') {
  if (!window.MM_DEFAULT_GITHUB_WORKER_URL) {
    window.MM_DEFAULT_GITHUB_WORKER_URL = 'https://mm.littlehacker303.workers.dev/gh';
  }
  if (!window.MM_DEFAULT_CATBOX_UPLOAD_URL) {
    window.MM_DEFAULT_CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';
  }
  if (!window.MM_DIRECT_CATBOX_UPLOAD_URL) {
    window.MM_DIRECT_CATBOX_UPLOAD_URL = 'https://catbox.moe/user/api.php';
  }
  if (!window.MM_PROXY_CATBOX_UPLOAD_URL) {
    window.MM_PROXY_CATBOX_UPLOAD_URL = 'https://mm.littlehacker303.workers.dev/catbox/user/api.php';
  }
}
