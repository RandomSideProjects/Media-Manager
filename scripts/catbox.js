"use strict";

(function () {
  const CATBOX_BACKEND_URL = "https://mm.littlehacker303.workers.dev/catbox/user/api.php";
  const LS_SETTINGS_KEY = "mm_upload_settings";

  if (typeof window === "undefined") return;

  function resolveStoredCatboxUrl() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && typeof parsed.catboxUploadUrl === "string") {
          const trimmed = parsed.catboxUploadUrl.trim();
          if (trimmed) return trimmed;
        }
      }
    } catch {
      // ignore
    }
    return CATBOX_BACKEND_URL;
  }

  function bootstrapCatboxDefaults() {
    const url = resolveStoredCatboxUrl();
    window.MM_DEFAULT_CATBOX_UPLOAD_URL = url;
    window.MM_ACTIVE_CATBOX_UPLOAD_URL = url;
  }

  bootstrapCatboxDefaults();

  async function ensureDetection() {
    return Promise.resolve();
  }

  async function getUploadUrl() {
    await ensureDetection();
    const active = (typeof window.MM_ACTIVE_CATBOX_UPLOAD_URL === "string")
      ? window.MM_ACTIVE_CATBOX_UPLOAD_URL.trim()
      : "";
    return active || window.MM_DEFAULT_CATBOX_UPLOAD_URL || CATBOX_BACKEND_URL;
  }

  window.MM_catbox = {
    ensure: ensureDetection,
    getUploadUrl,
    directUrl: CATBOX_BACKEND_URL,
    proxyUrl: CATBOX_BACKEND_URL,
    getLastResult: () => null
  };

  if (typeof window.mm_getCatboxUploadUrl !== "function") {
    window.mm_getCatboxUploadUrl = getUploadUrl;
  }
}());
