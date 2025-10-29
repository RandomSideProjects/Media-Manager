"use strict";

(function () {
  const DEV_ONLY_KEYS = new Set(['rsp_dev_mode']);
  const EXPORT_SCHEMA = 'rsp-media-manager-settings';
  const ESCAPE_KEY = 'Escape';

  let clearOverlayVisible = false;
  let importOverlayVisible = false;
  let clearOverlayElement = null;
  let importOverlayElement = null;
  let pendingImportData = null;
  let pendingImportNotice = null;

  function ensureClearStorageOverlay() {
    if (!clearOverlayElement) {
      if (window.OverlayFactory && typeof window.OverlayFactory.createClearStorageOverlay === 'function') {
        clearOverlayElement = window.OverlayFactory.createClearStorageOverlay();
      }
    }
    return clearOverlayElement;
  }

  function ensureStorageImportOverlay() {
    if (!importOverlayElement) {
      if (window.OverlayFactory && typeof window.OverlayFactory.createStorageImportOverlay === 'function') {
        importOverlayElement = window.OverlayFactory.createStorageImportOverlay();
      }
    }
    return importOverlayElement;
  }

  function showStorageNotice(options = {}) {
    const hasNotifier = window.mmNotices && typeof window.mmNotices.show === 'function';
    if (hasNotifier) {
      return window.mmNotices.show(options);
    }
    const message = options && typeof options.message !== 'undefined'
      ? String(options.message)
      : '';
    if (message) {
      try { window.alert(message); } catch {}
    }
    return null;
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

  async function resolveCatboxUploadEndpoint() {
    if (typeof window !== 'undefined' && window.MM_catbox && typeof window.MM_catbox.getUploadUrl === 'function') {
      try {
        const resolved = await window.MM_catbox.getUploadUrl();
        if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
      } catch (err) {
        console.warn('[Storage] Falling back to direct Catbox endpoint', err);
      }
    }
    return 'https://catbox.moe/user/api.php';
  }

  async function uploadJsonToCatbox(json, fileName) {
    const blob = new Blob([json], { type: 'application/json' });
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', blob, fileName);
    const endpoint = await resolveCatboxUploadEndpoint();
    const response = await fetch(endpoint, {
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

  function parseTimeValue(raw) {
    if (raw === null || typeof raw === 'undefined') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const str = String(raw).trim();
    if (!str) return null;
    const numeric = Number(str);
    if (Number.isFinite(numeric)) return numeric;
    if (!/^\d+(?::\d{1,2}){1,2}$/.test(str)) return null;
    const parts = str.split(':').map((segment) => Number(segment));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    let seconds = 0;
    if (parts.length === 2) {
      seconds = (parts[0] * 60) + parts[1];
    } else if (parts.length === 3) {
      seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    } else {
      return null;
    }
    return seconds;
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

  function applyImportedSettings(data, mode = 'replace') {
    const normalizedMode = mode === 'merge' ? 'merge' : 'replace';
    const entries = Object.entries(data || {}).filter(([key]) => typeof key === 'string' && key);
    if (!entries.length) return;
    if (normalizedMode === 'replace') {
      try {
        localStorage.clear();
      } catch (err) {
        throw new Error('Unable to clear existing settings.');
      }
    }
    const failed = [];
    entries.forEach(([key, value]) => {
      if (isDevOnlyKey(key)) return;
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      if (normalizedMode === 'merge') {
        let existing;
        try {
          existing = localStorage.getItem(key);
        } catch (err) {
          console.error('[Storage] Failed to read existing key during merge', key, err);
          existing = null;
        }
        if (existing !== null && typeof existing !== 'undefined') {
          const existingTime = parseTimeValue(existing);
          const incomingTime = parseTimeValue(serialized);
          if (existingTime !== null && incomingTime !== null) {
            if (!(incomingTime > existingTime)) return;
          } else {
            if (existing === serialized) return;
            const trimmedIncoming = serialized.trim().toLowerCase();
            if (!trimmedIncoming || trimmedIncoming === 'null' || trimmedIncoming === 'undefined' || trimmedIncoming === 'nan') {
              return;
            }
          }
        }
      }
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

    let clearOverlay = null;
    let clearConfirmBtn = null;
    let clearCancelBtn = null;
    let importOverlay = null;
    let importCancelBtn = null;
    let importConfirmBtn = null;
    let importCodeInput = null;
    let importFileInput = null;

    const closeMenu = () => closeStorageMenu(storageMenuPanel, storageMenuBtn);
    const openMenu = () => openStorageMenu(storageMenuPanel, storageMenuBtn);

    const clearAppStorage = () => {
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
    };

    const clearPendingImportPrompt = () => {
      pendingImportData = null;
      if (pendingImportNotice && typeof pendingImportNotice.close === 'function') {
        try { pendingImportNotice.close(); }
        catch {}
      }
      pendingImportNotice = null;
    };

    const finalizePendingImport = (mode) => {
      if (!pendingImportData) {
        showStorageNotice({
          title: 'Import',
          message: 'No imported settings to apply.',
          tone: 'warning'
        });
        return;
      }
      const data = pendingImportData;
      clearPendingImportPrompt();
      try {
        applyImportedSettings(data, mode);
        closeImportOverlay();
        const successMessage = mode === 'merge'
          ? 'Settings merged. Newer progress wins. Reloading to apply changes…'
          : 'Settings replaced. Reloading to apply changes…';
        showStorageNotice({
          title: 'Import complete',
          message: successMessage,
          tone: 'success',
          autoCloseMs: 2000
        });
        setTimeout(() => {
          try { window.location.reload(); } catch {}
        }, 900);
      } catch (err) {
        console.error('[Storage] Import apply failed', err);
        showStorageNotice({
          title: 'Import failed',
          message: err && err.message ? err.message : String(err),
          tone: 'error'
        });
      }
    };

    const presentImportModePrompt = (data) => {
      clearPendingImportPrompt();
      pendingImportData = data;
      pendingImportNotice = showStorageNotice({
        title: 'Import ready',
        message: 'Choose Replace or Merge to apply these settings.',
        tone: 'info',
        autoCloseMs: null,
        dismissLabel: null,
        actions: [
          {
            label: 'Replace',
            className: 'storage-notice__btn--danger',
            closeOnClick: false,
            onClick: () => finalizePendingImport('replace')
          },
          {
            label: 'Merge',
            className: 'storage-notice__btn--primary',
            closeOnClick: false,
            onClick: () => finalizePendingImport('merge')
          },
          {
            label: 'Cancel',
            className: 'storage-notice__btn--secondary',
            onClick: () => { clearPendingImportPrompt(); }
          }
        ]
      });
    };

    const openClearOverlay = () => {
      clearOverlay = ensureClearStorageOverlay();
      if (!clearOverlay) return;
      clearOverlay.style.display = 'flex';
      clearOverlayVisible = true;
      
      // Ensure event handlers are attached
      if (!clearOverlay.dataset.bound) {
        clearConfirmBtn = document.getElementById('clearStorageConfirmBtn');
        clearCancelBtn = document.getElementById('clearStorageCancelBtn');
        
        if (clearConfirmBtn) {
          clearConfirmBtn.addEventListener('click', () => {
            closeClearOverlay();
            clearAppStorage();
          });
        }
        if (clearCancelBtn) {
          clearCancelBtn.addEventListener('click', () => {
            closeClearOverlay();
          });
        }
        clearOverlay.addEventListener('click', (event) => {
          if (event.target === clearOverlay) closeClearOverlay();
        });
        clearOverlay.dataset.bound = '1';
      }
    };
    const closeClearOverlay = () => {
      if (!clearOverlay) return;
      clearOverlay.style.display = 'none';
      clearOverlayVisible = false;
    };

    const resetImportInputs = () => {
      importCodeInput = document.getElementById('storageImportCodeInput');
      importFileInput = document.getElementById('storageImportFileInput');
      if (importCodeInput) importCodeInput.value = '';
      if (importFileInput) importFileInput.value = '';
      clearPendingImportPrompt();
    };

    const readImportFile = async (file) => {
      clearPendingImportPrompt();
      const importConfirmBtn = document.getElementById('storageImportConfirmBtn');
      if (importConfirmBtn) importConfirmBtn.disabled = true;
      try {
        const jsonText = await readFileAsText(file);
        let payload;
        try {
          payload = JSON.parse(jsonText);
        } catch {
          throw new Error('Imported file is not valid JSON.');
        }
        const data = extractDataFromImportPayload(payload);
        presentImportModePrompt(data);
      } catch (err) {
        clearPendingImportPrompt();
        console.error('[Storage] Import failed', err);
        showStorageNotice({
          title: 'Import failed',
          message: err && err.message ? err.message : String(err),
          tone: 'error'
        });
      } finally {
        if (importConfirmBtn) importConfirmBtn.disabled = false;
      }
    };

    const handleImportAction = async () => {
      clearPendingImportPrompt();
      importConfirmBtn = document.getElementById('storageImportConfirmBtn');
      importCodeInput = document.getElementById('storageImportCodeInput');
      importFileInput = document.getElementById('storageImportFileInput');
      
      if (importConfirmBtn) importConfirmBtn.disabled = true;
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
        presentImportModePrompt(data);
      } catch (err) {
        clearPendingImportPrompt();
        console.error('[Storage] Import failed', err);
        showStorageNotice({
          title: 'Import failed',
          message: err && err.message ? err.message : String(err),
          tone: 'error'
        });
      } finally {
        if (importConfirmBtn) importConfirmBtn.disabled = false;
      }
    };

    const openImportOverlay = () => {
      importOverlay = ensureStorageImportOverlay();
      if (!importOverlay) return;
      clearPendingImportPrompt();
      importOverlay.style.display = 'flex';
      importOverlayVisible = true;
      
      // Ensure event handlers are attached
      if (!importOverlay.dataset.bound) {
        importCancelBtn = document.getElementById('storageImportCancelBtn');
        importConfirmBtn = document.getElementById('storageImportConfirmBtn');
        importCodeInput = document.getElementById('storageImportCodeInput');
        importFileInput = document.getElementById('storageImportFileInput');
        
        if (importCancelBtn) {
          importCancelBtn.addEventListener('click', () => {
            closeImportOverlay();
          });
        }
        if (importConfirmBtn) {
          importConfirmBtn.addEventListener('click', () => {
            handleImportAction();
          });
        }
        if (importFileInput) {
          importFileInput.addEventListener('change', (event) => {
            const file = event.target?.files?.[0];
            if (file) {
              readImportFile(file);
            }
          });
        }
        importOverlay.addEventListener('click', (event) => {
          if (event.target === importOverlay) closeImportOverlay();
        });
        importOverlay.dataset.bound = '1';
      }
      
      setTimeout(() => {
        try {
          importCodeInput = document.getElementById('storageImportCodeInput');
          if (importCodeInput) importCodeInput.focus();
        } catch {}
      }, 50);
    };
    const closeImportOverlay = () => {
      if (!importOverlay) return;
      importOverlay.style.display = 'none';
      importOverlayVisible = false;
      clearPendingImportPrompt();
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
          const downloadAction = {
            label: 'Download',
            className: 'storage-notice__btn--primary',
            closeOnClick: false,
            onClick: () => {
              triggerDownload(json, fileName);
            }
          };
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
              copyLabel: code ? 'Copy code' : 'Copy',
              actions: [downloadAction]
            });
          } catch (err) {
            console.error('[Storage] Catbox upload failed, initiating download fallback.', err);
            triggerDownload(json, fileName);
            showStorageNotice({
              title: 'Export ready',
              message: 'Upload to Catbox failed. Started a download of your settings instead.',
              tone: 'warning',
              actions: [downloadAction]
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
