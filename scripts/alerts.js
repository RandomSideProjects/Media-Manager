"use strict";

(function () {
  const OVERLAY_ID = 'mmNoticeOverlay';
  const STACK_ID = 'mmNoticeStack';
  const NOTICE_TONES = new Set(['success', 'error', 'warning', 'info']);
  const DEFAULT_NOTICE_TIMEOUT_MS = 8000;
  const activeNotices = new Set();
  const noticeTimeouts = new WeakMap();
  const noticeMetadata = new WeakMap();

  let overlayEl = null;
  let stackEl = null;

  function ensureOverlay() {
    if (!overlayEl) {
      overlayEl = document.getElementById(OVERLAY_ID);
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.id = OVERLAY_ID;
        overlayEl.className = 'storage-notice-overlay';
        overlayEl.setAttribute('aria-hidden', 'true');
        overlayEl.setAttribute('role', 'presentation');

        const stack = document.createElement('div');
        stack.id = STACK_ID;
        stack.className = 'storage-notice-stack';
        overlayEl.appendChild(stack);
        stackEl = stack;

        overlayEl.addEventListener('click', (event) => {
          if (event.target === overlayEl) {
            hideAllNotices();
          }
        });

        document.body.appendChild(overlayEl);
      }
    }

    if (!stackEl || !stackEl.parentNode) {
      stackEl = overlayEl.querySelector(`#${STACK_ID}`);
      if (!stackEl) {
        stackEl = document.createElement('div');
        stackEl.id = STACK_ID;
        stackEl.className = 'storage-notice-stack';
        overlayEl.appendChild(stackEl);
      }
    }

    return { overlay: overlayEl, stack: stackEl };
  }

  function updateOverlayVisibility() {
    if (!overlayEl) return;
    const shouldShow = activeNotices.size > 0;
    overlayEl.classList.toggle('is-visible', shouldShow);
    overlayEl.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    document.body.classList.toggle('mm-notice-open', shouldShow);
  }

  function removeNotice(notice, onClose) {
    if (!notice) return;
    const meta = noticeMetadata.get(notice);
    const closeHandler = typeof onClose === 'function'
      ? onClose
      : (meta && typeof meta.onClose === 'function' ? meta.onClose : null);
    if (noticeTimeouts.has(notice)) {
      const timeoutId = noticeTimeouts.get(notice);
      noticeTimeouts.delete(notice);
      if (timeoutId) clearTimeout(timeoutId);
    }
    if (notice.parentNode) {
      notice.parentNode.removeChild(notice);
    }
    if (activeNotices.has(notice)) {
      activeNotices.delete(notice);
    }
    noticeMetadata.delete(notice);
    try {
      if (typeof closeHandler === 'function') closeHandler();
    } catch (err) {
      console.error('[Alerts] onClose handler failed', err);
    }
    if (activeNotices.size === 0) {
      updateOverlayVisibility();
    }
  }

  function hideAllNotices() {
    if (!overlayEl) return;
    const notices = Array.from(activeNotices);
    for (const notice of notices) {
      removeNotice(notice);
    }
    activeNotices.clear();
    updateOverlayVisibility();
  }

  function makeCopyButton(copyText, copyLabel) {
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
        console.error('[Alerts] Clipboard copy failed', err);
        copyBtn.textContent = 'Copy failed';
      } finally {
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 1600);
      }
    });
    return copyBtn;
  }

  function showNotice({
    title,
    message,
    tone = 'info',
    copyText = null,
    copyLabel = 'Copy',
    qrValue = null,
    autoCloseMs,
    persistent = false,
    onClose,
    actions = [],
    dismissLabel = 'Close'
  } = {}) {
    const resolvedAutoCloseMs = (typeof autoCloseMs === 'undefined')
      ? (persistent ? null : DEFAULT_NOTICE_TIMEOUT_MS)
      : autoCloseMs;
    if (!message) return null;
    const { overlay, stack } = ensureOverlay();
    const normalizedTone = NOTICE_TONES.has(tone) ? tone : 'info';

    const notice = document.createElement('div');
    notice.className = `storage-notice storage-notice--${normalizedTone}`;
    notice.setAttribute('role', 'alertdialog');
    notice.setAttribute('aria-live', 'assertive');
    notice.setAttribute('aria-modal', 'true');

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

    if (qrValue) {
      const qrWrapper = document.createElement('div');
      qrWrapper.className = 'storage-notice__qr';
      const qrTarget = document.createElement('div');
      qrTarget.setAttribute('aria-hidden', 'true');
      qrWrapper.appendChild(qrTarget);
      const caption = document.createElement('p');
      caption.className = 'storage-notice__qr-caption';
      caption.textContent = 'Scan to import settings';
      qrWrapper.appendChild(caption);
      notice.appendChild(qrWrapper);

      if (typeof window !== 'undefined' && typeof window.QRCode === 'function') {
        try {
          new QRCode(qrTarget, {
            text: qrValue,
            width: 160,
            height: 160,
            colorDark: '#000000',
            colorLight: '#f8fafc',
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch (err) {
          console.error('[Alerts] QR code render failed', err);
          qrTarget.textContent = qrValue;
        }
      } else {
        qrTarget.textContent = qrValue;
      }
    }

    const actionsRow = document.createElement('div');
    actionsRow.className = 'storage-notice__actions';
    let hasActionButtons = false;
    if (copyText) {
      actionsRow.appendChild(makeCopyButton(copyText, copyLabel));
      hasActionButtons = true;
    }

    if (Array.isArray(actions)) {
      actions.forEach((action) => {
        if (!action || !action.label) return;
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'storage-notice__btn';
        if (typeof action.className === 'string' && action.className.trim()) {
          action.className.trim().split(/\s+/).forEach((cls) => {
            if (cls) actionBtn.classList.add(cls);
          });
        }
        actionBtn.textContent = action.label;
        actionBtn.addEventListener('click', async () => {
          if (typeof action.onClick === 'function') {
            try {
              const result = action.onClick();
              if (result && typeof result.then === 'function') await result;
            } catch (err) {
              console.error('[Alerts] action handler failed', err);
            }
          }
          if (action.closeOnClick !== false) {
            removeNotice(notice, onClose);
          }
        });
        actionsRow.appendChild(actionBtn);
        hasActionButtons = true;
      });
    }

    if (dismissLabel !== null && dismissLabel !== false) {
      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'storage-notice__btn';
      dismissBtn.textContent = dismissLabel || 'Close';
      dismissBtn.addEventListener('click', () => removeNotice(notice, onClose));
      actionsRow.appendChild(dismissBtn);
      hasActionButtons = true;
    }

    if (hasActionButtons) {
      notice.appendChild(actionsRow);
    }

    stack.appendChild(notice);
    activeNotices.add(notice);
    noticeMetadata.set(notice, { onClose, persistent: Boolean(persistent) });
    updateOverlayVisibility();

    if (Number.isFinite(resolvedAutoCloseMs) && resolvedAutoCloseMs > 0) {
      const timeoutId = setTimeout(() => {
        removeNotice(notice, onClose);
      }, resolvedAutoCloseMs);
      noticeTimeouts.set(notice, timeoutId);
    }

    return {
      notice,
      close: () => removeNotice(notice, onClose)
    };
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!activeNotices.size) return;
    event.preventDefault();
    const notices = Array.from(activeNotices);
    const lastNotice = notices[notices.length - 1];
    const meta = noticeMetadata.get(lastNotice);
    if (meta && meta.persistent) return;
    removeNotice(lastNotice);
  });

  window.mmNotices = {
    show: showNotice,
    closeAll: hideAllNotices
  };

  window.showAppNotice = showNotice;
  window.showStorageNotice = showNotice;
})();
