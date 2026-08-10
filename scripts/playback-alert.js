"use strict";

(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  function safeMarkdownUrl(value, allowMailto = false) {
    const candidate = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
    if (!candidate || /[\s<>]/.test(candidate)) return '';
    let parsed;
    try {
      parsed = new URL(candidate, document.baseURI || window.location.href);
    } catch {
      return '';
    }
    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol === 'http:' || protocol === 'https:') return parsed.href;
    if (allowMailto && protocol === 'mailto:') return parsed.href;
    return '';
  }

  function parseMarkdownDestination(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return { url: '', title: '' };
    if (trimmed[0] === '<') {
      const end = trimmed.indexOf('>');
      if (end < 0) return { url: '', title: '' };
      return { url: trimmed.slice(1, end), title: trimmed.slice(end + 1).trim().replace(/^(['"])(.*?)\1$/, '$2') };
    }
    const match = trimmed.match(/^(\S+?)(?:\s+(?:['"](.*?)['"]|\((.*?)\)))?$/);
    return match
      ? { url: match[1], title: match[2] || match[3] || '' }
      : { url: '', title: '' };
  }

  function findClosing(text, start, marker) {
    return text.indexOf(marker, start + marker.length);
  }

  function renderInlineMarkdown(value, depth = 0) {
    const text = String(value || '');
    if (!text) return '';
    if (depth > 5) return escapeHtml(text);
    let html = '';
    let index = 0;
    while (index < text.length) {
      if (text[index] === '`') {
        const end = text.indexOf('`', index + 1);
        if (end > index + 1) {
          html += `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
          index = end + 1;
          continue;
        }
      }

      const imageStart = text.startsWith('![', index) ? index : -1;
      if (imageStart >= 0) {
        const labelEnd = text.indexOf(']', index + 2);
        if (labelEnd >= 0 && text[labelEnd + 1] === '(') {
          const destinationEnd = text.indexOf(')', labelEnd + 2);
          if (destinationEnd >= 0) {
            const label = text.slice(index + 2, labelEnd).trim();
            const destination = parseMarkdownDestination(text.slice(labelEnd + 2, destinationEnd));
            const url = safeMarkdownUrl(destination.url);
            if (url) {
              const title = destination.title ? ` title="${escapeHtml(destination.title)}"` : '';
              html += `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer"${title}>`;
              index = destinationEnd + 1;
              continue;
            }
          }
        }
      }

      if (text[index] === '[') {
        const labelEnd = text.indexOf(']', index + 1);
        if (labelEnd >= 0 && text[labelEnd + 1] === '(') {
          const destinationEnd = text.indexOf(')', labelEnd + 2);
          if (destinationEnd >= 0) {
            const destination = parseMarkdownDestination(text.slice(labelEnd + 2, destinationEnd));
            const url = safeMarkdownUrl(destination.url, true);
            if (url) {
              const title = destination.title ? ` title="${escapeHtml(destination.title)}"` : '';
              html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title}>${renderInlineMarkdown(text.slice(index + 1, labelEnd), depth + 1)}</a>`;
              index = destinationEnd + 1;
              continue;
            }
          }
        }
      }

      let marker = '';
      if (text.startsWith('**', index) || text.startsWith('__', index)) marker = text.slice(index, index + 2);
      else if (text.startsWith('~~', index)) marker = '~~';
      if (marker) {
        const end = findClosing(text, index, marker);
        if (end > index + marker.length) {
          const tag = marker === '~~' ? 'del' : 'strong';
          html += `<${tag}>${renderInlineMarkdown(text.slice(index + marker.length, end), depth + 1)}</${tag}>`;
          index = end + marker.length;
          continue;
        }
      }
      if (text[index] === '*' || text[index] === '_') {
        const markerChar = text[index];
        const end = text.indexOf(markerChar, index + 1);
        if (end > index + 1 && !/\s/.test(text[index + 1])) {
          html += `<em>${renderInlineMarkdown(text.slice(index + 1, end), depth + 1)}</em>`;
          index = end + 1;
          continue;
        }
      }

      if (text[index] === '<') {
        const end = text.indexOf('>', index + 1);
        if (end > index + 1) {
          const angleValue = text.slice(index + 1, end).trim();
          const url = /^(?:https?:|mailto:)/i.test(angleValue)
            ? safeMarkdownUrl(angleValue, true)
            : '';
          if (url) {
            html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
            index = end + 1;
            continue;
          }
        }
      }

      html += escapeHtml(text[index]);
      index += 1;
    }
    return html;
  }

  function renderSafeMarkdown(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let listItems = [];
    let codeLines = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!listItems.length) return;
      output.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
      listItems = [];
      listType = '';
    };

    lines.forEach((line) => {
      if (codeLines) {
        if (/^\s*```/.test(line)) {
          output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          codeLines = null;
        } else {
          codeLines.push(line);
        }
        return;
      }
      if (/^\s*```/.test(line)) {
        flushParagraph();
        flushList();
        codeLines = [];
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = heading[1].length;
        output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }
      const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listItems.push((unordered || ordered)[1]);
        return;
      }
      flushList();
      const quote = line.match(/^\s{0,3}>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        output.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
        return;
      }
      paragraph.push(line);
    });

    if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    flushParagraph();
    flushList();
    return output.join('');
  }

  function parsePlaybackAlertAsset(source) {
    const text = String(source || '').replace(/^\uFEFF/, '');
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
    if (!match) return null;
    const expirationMatch = match[1].match(/^\s*expiresAt\s*:\s*(.*?)\s*$/m);
    if (!expirationMatch) return null;
    const expiresAt = expirationMatch[1].replace(/^(?:['"])(.*)\1$/, '$1').trim();
    const message = match[2].trim();
    const expirationMs = Date.parse(expiresAt);
    if (!message || !Number.isFinite(expirationMs) || expirationMs <= Date.now()) return null;
    return { message, expiresAt, expirationMs };
  }

  let loaded = false;
  let active = false;
  let message = '';
  let expirationMs = NaN;
  let releaseGate = null;
  const gatePromise = new Promise((resolve) => { releaseGate = resolve; });
  let noticeHandle = null;
  let expirationTimer = null;

  function resolveGate() {
    if (typeof releaseGate !== 'function') return;
    const resolve = releaseGate;
    releaseGate = null;
    resolve();
  }

  function scheduleExpiration() {
    if (!active || !Number.isFinite(expirationMs)) return;
    const remaining = expirationMs - Date.now();
    if (remaining <= 0) {
      expirePlaybackAlert();
      return;
    }
    expirationTimer = setTimeout(scheduleExpiration, Math.min(remaining, 2147483647));
  }

  function releasePlayback() {
    if (!active) return;
    active = false;
    if (expirationTimer) {
      clearTimeout(expirationTimer);
      expirationTimer = null;
    }
    if (noticeHandle && typeof noticeHandle.close === "function") {
      try { noticeHandle.close(); } catch {}
    }
    noticeHandle = null;
    resolveGate();
  }

  function expirePlaybackAlert() {
    if (!active) return;
    active = false;
    if (noticeHandle && typeof noticeHandle.close === "function") {
      try { noticeHandle.close(); } catch {}
    }
    noticeHandle = null;
    resolveGate();
  }

  window.MM_playbackAlert = {
    isActive: () => active,
    waitForRelease: () => (!loaded || active) ? gatePromise : Promise.resolve(),
    release: releasePlayback
  };
  window.MM_playbackAlertReady = window.MM_playbackAlert.waitForRelease;
  window.MM_renderPlaybackAlertMarkdown = renderSafeMarkdown;

  function guardMedia(media) {
    if (!active || !media) return;
    try {
      media.autoplay = false;
      media.removeAttribute('autoplay');
    } catch {}
  }

  if (typeof MutationObserver !== 'undefined') {
    try {
      new MutationObserver((mutations) => {
        if (!active) return;
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('video, audio')) guardMedia(node);
            if (node.querySelectorAll) node.querySelectorAll('video, audio').forEach(guardMedia);
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
  }

  if (typeof HTMLMediaElement !== "undefined" && HTMLMediaElement.prototype.play) {
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (loaded && !active) return nativePlay.apply(this, args);
      return gatePromise.then(() => nativePlay.apply(this, args));
    };
  }

  const assetPath = window.MM_PLAYBACK_ALERT_ASSET_PATH || 'Assets/playback-alert.md';
  fetch(assetPath, { cache: 'no-store' })
    .then((response) => response.ok ? response.text() : '')
    .then((source) => {
      const parsed = parsePlaybackAlertAsset(source);
      if (parsed) {
        message = parsed.message;
        expirationMs = parsed.expirationMs;
        active = true;
        try { document.querySelectorAll('video, audio').forEach(guardMedia); } catch {}
        scheduleExpiration();
        if (typeof window.showStorageNotice === 'function') {
          noticeHandle = window.showStorageNotice({
            title: 'Playback notice',
            messageHtml: renderSafeMarkdown(message),
            tone: 'warning',
            persistent: true,
            autoCloseMs: null,
            dismissLabel: null,
            actions: [{
              label: 'Continue to playback',
              className: 'primary',
              onClick: releasePlayback
            }]
          });
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      if (!active) resolveGate();
    });
})();
