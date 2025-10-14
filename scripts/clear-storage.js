"use strict";

(function () {
  const DEV_ONLY_KEYS = new Set(['rsp_dev_mode']);
  const CATBOX_UPLOAD_ENDPOINT = 'https://catbox.moe/user/api.php';
  const EXPORT_SCHEMA = 'rsp-media-manager-settings';
  const ESCAPE_KEY = 'Escape';
  const NOTICE_STACK_ID = 'storageNoticeStack';
  const NOTICE_TONES = new Set(['success', 'error', 'warning', 'info']);
  const DEFAULT_NOTICE_TIMEOUT_MS = 8000;

  let clearOverlayVisible = false;
  let importOverlayVisible = false;

  function ensureNoticeStack() {
    let stack = document.getElementById(NOTICE_STACK_ID);
    if (!stack) {
      stack = document.createElement('div');
      stack.id = NOTICE_STACK_ID;
      stack.className = 'storage-notice-stack';
      stack.setAttribute('aria-live', 'polite');
      stack.setAttribute('aria-atomic', 'true');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function showStorageNotice({ title, message, tone = 'info', copyText = null, copyLabel = 'Copy', autoCloseMs = DEFAULT_NOTICE_TIMEOUT_MS, onClose } = {}) {
    if (!message) return null;
    const stack = ensureNoticeStack();
    const normalizedTone = NOTICE_TONES.has(tone) ? tone : 'info';
    const notice = document.createElement('div');
    notice.className = `storage-notice storage-notice--${normalizedTone}`;

    if (title) {
      const titleEl = document.createElement('p');
      titleEl.className = 'storage-notice__title';
      titleEl.textContent = title;
      notice.appendChild(titleEl);
    }

    const messageEl = document.createElement('p');
    messageEl.className = 'storage-notice__message';
    messageEl.textContent = message;
    notice.appendChild(messageEl);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'storage-notice__actions';

    const removeNotice = () => {
      if (!notice.parentNode) return;
      try { notice.parentNode.removeChild(notice); } catch {}
      if (typeof onClose === 'function') {
        try { onClose(); } catch {}
      }
    };

    if (copyText) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'storage-notice__btn';
      copyBtn.textContent = copyLabel || 'Copy';
      copyBtn.addEventListener('click', async () => {
        const original = copyBtn.textContent;
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(copyText);
            copyBtn.textContent = 'Copied!';
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = copyText;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            copyBtn.textContent = 'Copied!';
          }
        } catch (err) {
          console.error('[Storage] Clipboard copy failed', err);
          copyBtn.textContent = 'Copy failed';
        } finally {
          setTimeout(() => { copyBtn.textContent = original; }, 1600);
        }
      });
      actionsRow.appendChild(copyBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'storage-notice__btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', removeNotice);
    actionsRow.appendChild(closeBtn);

    notice.appendChild(actionsRow);
    stack.insertBefore(notice, stack.firstChild || null);

    if (Number.isFinite(autoCloseMs) && autoCloseMs > 0) {
      setTimeout(removeNotice, autoCloseMs);
    }

    return { notice, close: removeNotice };
  }

  function isDevOnlyKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (DEV_ONLY_KEYS.has(key)) return true;
    const lower = key.toLowerCase();
    return lower.startsWith('dev:') || lower.startsWith('dev_') || lower.startsWith('rsp_dev_');
  }

  function collectSettingsData() {
    const data = {};
    let count = 0;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        let key;
        try {
          key = localStorage.key(i);
        } catch (err) {
          console.warn('[Storage] Skipped key at index', i, err);
          continue;
        }
        if (!key || isDevOnlyKey(key)) continue;
        try {
          const value = localStorage.getItem(key);
          if (value === null || typeof value === 'undefined') continue;
          data[key] = value;
          count += 1;
        } catch (err) {
          console.warn('[Storage] Failed to read key', key, err);
        }
      }
    } catch (err) {
      console.error('[Storage] Enumerating settings failed', err);
    }
    return { data, count };
  }

  function makeFileName() {
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    return `rsp-settings-${iso}.json`;
  }

  function buildExportPayload() {
    const { data, count } = collectSettingsData();
    const payload = {
      schema: EXPORT_SCHEMA,
      version: 1,
      exportedAt: new Date().toISOString(),
      count,
      data
    };
    return { json: JSON.stringify(payload, null, 2), fileName: makeFileName(), count };
  }

  async function uploadJsonToCatbox(json, fileName) {
    const blob = new Blob([json], { type: 'application/json' });
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', blob, fileName);
    const response = await fetch(CATBOX_UPLOAD_ENDPOINT, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      throw new Error(`Catbox upload failed (${response.status})`);
    }
    const text = (await response.text()).trim();
    if (!/^https?:\/\//i.test(text)) {
      throw new Error('Catbox did not return a valid URL.');
    }
    return text;
  }

  function triggerDownload(json, fileName) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'settings.json';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function resolveCatboxUrl(rawInput) {
    if (typeof rawInput !== 'string') return null;
    const trimmed = rawInput.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const sanitized = trimmed.replace(/[^A-Za-z0-9_-]/g, '');
    if (!sanitized) return null;
    return `https://files.catbox.moe/${sanitized}.json`;
  }

  function extractCatboxCode(url) {
    if (typeof url !== 'string' || !url.trim()) return '';
    const trimmed = url.trim();
    try {
      const parsed = new URL(trimmed);
      const segment = parsed.pathname.split('/').pop() || '';
      const cleaned = segment.replace(/\.[A-Za-z0-9]{1,8}$/g, '');
      return cleaned || segment || trimmed;
    } catch {
      const segment = trimmed.split('/').pop() || trimmed;
      const cleaned = segment.replace(/\.[A-Za-z0-9]{1,8}$/g, '');
      return cleaned || segment || trimmed;
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Unable to read file.'));
      reader.onload = () => {
        try {
          resolve(String(reader.result || ''));
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }

  function extractDataFromImportPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Imported JSON must be an object.');
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
      return payload.data;
    }
    return payload;
  }

  function applyImportedSettings(data) {
    const entries = Object.entries(data || {}).filter(([key]) => typeof key === 'string' && key);
    try {
      localStorage.clear();
    } catch (err) {
      throw new Error('Unable to clear existing settings.');
    }
    const failed = [];
    entries.forEach(([key, value]) => {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      try {
        localStorage.setItem(key, serialized);
      } catch (err) {
        console.error('[Storage] Failed to store key', key, err);
        failed.push(key);
      }
    });
    if (failed.length) {
      throw new Error(`Failed to store some settings: ${failed.join(', ')}`);
    }
  }

  function closeStorageMenu(panel, button) {
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function openStorageMenu(panel, button) {
    if (!panel) return;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (button) button.setAttribute('aria-expanded', 'true');
  }

  function wireUp() {
    const storageMenuBtn = document.getElementById('storageMenuBtn');
    const storageMenuPanel = document.getElementById('storageMenuPanel');
    const storageDeleteBtn = document.getElementById('storageDeleteBtn');
    const storageExportBtn = document.getElementById('storageExportBtn');
    const storageImportBtn = document.getElementById('storageImportBtn');

    const clearOverlay = document.getElementById('clearStorageOverlay');
    const clearConfirmBtn = document.getElementById('clearStorageConfirmBtn');
    const clearCancelBtn = document.getElementById('clearStorageCancelBtn');
    const clearCloseBtn = document.getElementById('clearStorageCloseBtn');

    const importOverlay = document.getElementById('storageImportOverlay');
    const importCloseBtn = document.getElementById('storageImportCloseBtn');
    const importCancelBtn = document.getElementById('storageImportCancelBtn');
    const importConfirmBtn = document.getElementById('storageImportConfirmBtn');
    const importCodeInput = document.getElementById('storageImportCodeInput');
    const importFileInput = document.getElementById('storageImportFileInput');

    const closeMenu = () => closeStorageMenu(storageMenuPanel, storageMenuBtn);
    const openMenu = () => openStorageMenu(storageMenuPanel, storageMenuBtn);

    const openClearOverlay = () => {
      if (!clearOverlay) return;
      clearOverlay.style.display = 'flex';
      clearOverlayVisible = true;
    };
    const closeClearOverlay = () => {
      if (!clearOverlay) return;
      clearOverlay.style.display = 'none';
      clearOverlayVisible = false;
    };

    const resetImportInputs = () => {
      if (importCodeInput) importCodeInput.value = '';
      if (importFileInput) importFileInput.value = '';
    };

    const openImportOverlay = () => {
      if (!importOverlay) return;
      importOverlay.style.display = 'flex';
      importOverlayVisible = true;
      setTimeout(() => {
        try {
          if (importCodeInput) importCodeInput.focus();
        } catch {}
      }, 50);
    };
    const closeImportOverlay = () => {
      if (!importOverlay) return;
      importOverlay.style.display = 'none';
      importOverlayVisible = false;
      resetImportInputs();
    };

    if (storageMenuBtn && storageMenuPanel) {
      storageMenuBtn.setAttribute('aria-haspopup', 'true');
      storageMenuBtn.setAttribute('aria-expanded', 'false');
      storageMenuBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (storageMenuPanel.classList.contains('open')) {
          closeMenu();
        } else {
          openMenu();
        }
      });
      document.addEventListener('click', (event) => {
        if (!storageMenuPanel.classList.contains('open')) return;
        if (storageMenuPanel.contains(event.target) || storageMenuBtn.contains(event.target)) return;
        closeMenu();
      });
    }

    if (storageDeleteBtn) {
      storageDeleteBtn.addEventListener('click', () => {
        closeMenu();
        openClearOverlay();
      });
    }

    if (storageExportBtn) {
      storageExportBtn.addEventListener('click', async () => {
        closeMenu();
        storageExportBtn.disabled = true;
        try {
          const { json, fileName } = buildExportPayload();
          try {
            const url = await uploadJsonToCatbox(json, fileName);
            const code = extractCatboxCode(url);
            let copied = false;
            if (code && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
              try {
                await navigator.clipboard.writeText(code);
                copied = true;
              } catch {}
            }
            showStorageNotice({
              title: 'Export complete',
              message: copied
                ? (code ? `Catbox code copied to clipboard: ${code}` : 'Catbox export succeeded. Code copied to clipboard.')
                : (code ? `Catbox code: ${code}` : 'Catbox export succeeded.'),
              tone: 'success',
              copyText: (!copied && code) ? code : null,
              copyLabel: code ? 'Copy code' : 'Copy'
            });
          } catch (err) {
            console.error('[Storage] Catbox upload failed, initiating download fallback.', err);
            triggerDownload(json, fileName);
            showStorageNotice({
              title: 'Export ready',
              message: 'Upload to Catbox failed. Started a download of your settings instead.',
              tone: 'warning'
            });
          }
        } catch (err) {
          console.error('[Storage] Export failed', err);
          showStorageNotice({
            title: 'Export failed',
            message: err && err.message ? err.message : 'Unexpected export error.',
            tone: 'error'
          });
        } finally {
          storageExportBtn.disabled = false;
        }
      });
    }

    if (storageImportBtn) {
      storageImportBtn.addEventListener('click', () => {
        closeMenu();
        openImportOverlay();
      });
    }

    if (clearOverlay) {
      clearOverlay.addEventListener('click', (event) => {
        if (event.target === clearOverlay) closeClearOverlay();
      });
    }
    if (clearCancelBtn) clearCancelBtn.addEventListener('click', closeClearOverlay);
    if (clearCloseBtn) clearCloseBtn.addEventListener('click', closeClearOverlay);

    if (clearConfirmBtn) {
      clearConfirmBtn.addEventListener('click', () => {
        let cleared = false;
        try {
          localStorage.clear();
          cleared = true;
        } catch (err) {
          console.error('Failed to clear localStorage:', err);
          showStorageNotice({
            title: 'Clear failed',
            message: 'We could not clear local storage. Please check browser settings and try again.',
            tone: 'error'
          });
        }
        closeClearOverlay();
        if (cleared) {
          showStorageNotice({
            title: 'Storage cleared',
            message: 'Reloading to apply changes…',
            tone: 'success',
            autoCloseMs: 2000
          });
          setTimeout(() => {
            try { window.location.reload(); } catch {}
          }, 900);
        }
      });
    }

    if (importOverlay) {
      importOverlay.addEventListener('click', (event) => {
        if (event.target === importOverlay) closeImportOverlay();
      });
    }
    if (importCloseBtn) importCloseBtn.addEventListener('click', closeImportOverlay);
    if (importCancelBtn) importCancelBtn.addEventListener('click', closeImportOverlay);

    if (importConfirmBtn) {
      importConfirmBtn.addEventListener('click', async () => {
        importConfirmBtn.disabled = true;
        try {
          const catboxInput = importCodeInput ? importCodeInput.value.trim() : '';
          const file = importFileInput && importFileInput.files && importFileInput.files.length ? importFileInput.files[0] : null;
          if (!catboxInput && !file) {
            showStorageNotice({
              title: 'Import needed',
              message: 'Provide a Catbox code or choose a JSON file to import.',
              tone: 'warning'
            });
            return;
          }
          let jsonText = '';
          if (file) {
            jsonText = await readFileAsText(file);
          } else {
            const url = resolveCatboxUrl(catboxInput);
            if (!url) throw new Error('Enter a valid Catbox code or URL.');
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Unable to download settings (${response.status}).`);
            jsonText = await response.text();
          }
          let payload;
          try {
            payload = JSON.parse(jsonText);
          } catch {
            throw new Error('Imported file is not valid JSON.');
          }
          const data = extractDataFromImportPayload(payload);
          applyImportedSettings(data);
          closeImportOverlay();
          showStorageNotice({
            title: 'Import complete',
            message: 'New settings applied. Reloading to finish up…',
            tone: 'success',
            autoCloseMs: 2000
          });
          setTimeout(() => {
            try { window.location.reload(); } catch {}
          }, 900);
        } catch (err) {
          console.error('[Storage] Import failed', err);
          showStorageNotice({
            title: 'Import failed',
            message: err && err.message ? err.message : String(err),
            tone: 'error'
          });
        } finally {
          importConfirmBtn.disabled = false;
        }
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== ESCAPE_KEY) return;
      let handled = false;
      if (storageMenuPanel && storageMenuPanel.classList.contains('open')) {
        closeMenu();
        handled = true;
      }
      if (importOverlayVisible) {
        closeImportOverlay();
        handled = true;
      }
      if (clearOverlayVisible) {
        closeClearOverlay();
        handled = true;
      }
      if (handled) {
        try { event.preventDefault(); } catch {}
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUp, { once: true });
  } else {
    wireUp();
  }
})();
