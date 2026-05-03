"use strict";

// Minimal up2k client for the Creator page (standalone, no Copyparty UI deps).
// Exposes: window.mm_up2k_uploadFile({ uploadUrl, pw, file, subdir, onProgress, signal }) -> Promise<url>
//
// Protocol notes (mirrors Copyparty up2k.js):
// - chunk hash = SHA-512, take first 33 bytes, encode base64url (no padding)
// - handshake: POST JSON {name,size,lmod,hash:[...]} to remoteDir
// - upload: POST application/octet-stream to file URL with headers:
//     X-Up2k-Hash: <hash>
//     X-Up2k-Wark: <wark>
//   plus PW header for CORS auth if configured on server.

(function () {
  const CSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function createAbortError() {
    if (typeof DOMException === "function") return new DOMException("Upload aborted", "AbortError");
    const err = new Error("Upload aborted");
    err.name = "AbortError";
    return err;
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw createAbortError();
  }

  function b64url(u8) {
    let out = "";
    const nbytes = u8.byteLength;
    const byteRem = nbytes % 3;
    const mainLen = nbytes - byteRem;

    for (let i = 0; i < mainLen; i += 3) {
      const chunk = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      const a = (chunk & 16515072) >> 18;
      const b = (chunk & 258048) >> 12;
      const c = (chunk & 4032) >> 6;
      const d = chunk & 63;
      out += CSET[a] + CSET[b] + CSET[c] + CSET[d];
    }

    if (byteRem === 1) {
      const chunk = u8[mainLen];
      const a = (chunk & 252) >> 2;
      const b = (chunk & 3) << 4;
      out += CSET[a] + CSET[b];
    } else if (byteRem === 2) {
      const chunk = (u8[mainLen] << 8) | u8[mainLen + 1];
      const a = (chunk & 64512) >> 10;
      const b = (chunk & 1008) >> 4;
      const c = (chunk & 15) << 2;
      out += CSET[a] + CSET[b] + CSET[c];
    }

    return out;
  }

  function getChunkSize(filesize) {
    // Copyparty algorithm
    let chunksize = 1024 * 1024;
    let stepsize = 512 * 1024;
    while (true) {
      for (let mul = 1; mul <= 2; mul++) {
        const nchunks = Math.ceil(filesize / chunksize);
        if (nchunks <= 256 || (chunksize >= 32 * 1024 * 1024 && nchunks <= 4096)) return chunksize;
        chunksize += stepsize;
        stepsize *= mul;
      }
    }
  }

  function readBlobWithProgress(blob, { signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;

      const cleanup = () => {
        if (signal && typeof signal.removeEventListener === "function") {
          try { signal.removeEventListener("abort", onAbort); } catch {}
        }
      };
      const finalizeResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finalizeReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        try { reader.abort(); } catch {}
        finalizeReject(createAbortError());
      };

      reader.onload = () => finalizeResolve(reader.result);
      reader.onerror = () => finalizeReject(reader.error || new Error("Failed to read file chunk"));
      reader.onabort = () => finalizeReject(createAbortError());
      reader.onprogress = (event) => {
        if (!event || typeof onProgress !== "function") return;
        try {
          onProgress({
            loaded: Number(event.loaded) || 0,
            total: Number(event.total) || blob.size || 0,
          });
        } catch {}
      };

      if (signal && typeof signal.addEventListener === "function") {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      reader.readAsArrayBuffer(blob);
    });
  }

  async function hashChunk33(file, car, cdr, { signal, onProgress } = {}) {
    const buf = await readBlobWithProgress(file.slice(car, cdr), { signal, onProgress });
    throwIfAborted(signal);
    const dig = await crypto.subtle.digest("SHA-512", buf);
    const u8 = new Uint8Array(dig).subarray(0, 33);
    return b64url(u8);
  }

  function parseUploadUrl(uploadUrl) {
    // Accept full URL like https://cpr.example.com/pub/MM/foo/
    const u = new URL(uploadUrl);
    const baseUrl = u.origin;
    let remoteDir = u.pathname;
    if (u.hostname === "cpr.xpbliss.fyi" && (!remoteDir || remoteDir === "/")) {
      remoteDir = "/pub/MM/";
    }
    if (!remoteDir.startsWith('/')) remoteDir = '/' + remoteDir;
    if (!remoteDir.endsWith('/')) remoteDir += '/';
    return { baseUrl, remoteDir };
  }

  function appendSubdir(remoteDir, subdir) {
    const trimmed = (typeof subdir === "string") ? subdir.trim() : "";
    if (!trimmed) return remoteDir;
    const cleaned = trimmed.replace(/^\/+|\/+$/g, "");
    if (!cleaned) return remoteDir;
    return `${remoteDir}${encodeURIComponent(cleaned)}/`;
  }

  async function doFetch(url, init, pw, signal) {
    const headers = Object.assign({}, init && init.headers ? init.headers : {});
    if (pw) headers.PW = pw;
    return fetch(url, Object.assign({}, init, { headers, signal }));
  }

  function buildFileUrl(baseUrl, remoteDir, name, fk) {
    let url = baseUrl + remoteDir + encodeURIComponent(name);
    if (fk) url += `?k=${encodeURIComponent(fk)}`;
    return url;
  }

  async function handshake({ baseUrl, remoteDir, file, hashes, pw, signal }) {
    throwIfAborted(signal);
    const url = baseUrl + remoteDir;
    const req = {
      name: file.name,
      size: file.size,
      lmod: file.lastModified ? file.lastModified / 1000 : 0,
      hash: hashes,
    };

    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }, pw, signal);

    const txt = await res.text();
    throwIfAborted(signal);
    if (!res.ok) {
      throw new Error(`Copyparty handshake failed HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }

    let j;
    try {
      j = JSON.parse(txt);
    } catch (e) {
      throw new Error('Copyparty handshake returned non-JSON (likely CORS/auth/html): ' + txt.slice(0, 120));
    }

    if (!j || !j.name) {
      throw new Error('Copyparty handshake returned no name');
    }

    const serverPurl = (j.purl ? (j.purl.startsWith('/') ? j.purl : '/' + j.purl) : remoteDir);
    const purl = serverPurl.endsWith('/') ? serverPurl : (serverPurl + '/');

    const missing = Array.isArray(j.hash) ? j.hash : [];
    const missingIdx = missing.map((h) => {
      const idx = hashes.indexOf(h);
      if (idx < 0) throw new Error(`Server requested unknown hash '${h}'`);
      return idx;
    });

    return {
      purl,
      name: j.name,
      wark: j.wark,
      fk: j.fk,
      missingIdx,
    };
  }

  function uploadChunk({ baseUrl, purl, name, wark, hash, blob, pw, signal, onProgress }) {
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);

      const xhr = new XMLHttpRequest();
      const url = baseUrl + purl + encodeURIComponent(name);
      let settled = false;

      const cleanup = () => {
        if (signal && typeof signal.removeEventListener === "function") {
          try { signal.removeEventListener("abort", onAbort); } catch {}
        }
      };
      const finalizeResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finalizeReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => {
        try { xhr.abort(); } catch {}
        finalizeReject(createAbortError());
      };

      xhr.open("POST", url, true);
      try { xhr.setRequestHeader("Content-Type", "application/octet-stream"); } catch {}
      try { xhr.setRequestHeader("X-Up2k-Hash", hash); } catch {}
      try { xhr.setRequestHeader("X-Up2k-Wark", String(wark || "")); } catch {}
      if (pw) {
        try { xhr.setRequestHeader("PW", pw); } catch {}
      }

      if (xhr.upload && typeof onProgress === "function") {
        xhr.upload.onprogress = (event) => {
          if (!event || !event.lengthComputable) return;
          try {
            onProgress({
              loaded: Number(event.loaded) || 0,
              total: Number(event.total) || blob.size || 0,
            });
          } catch {}
        };
      }

      xhr.onload = () => {
        const txt = typeof xhr.responseText === "string" ? xhr.responseText : "";
        if (xhr.status >= 200 && xhr.status < 300) {
          finalizeResolve(txt);
          return;
        }
        finalizeReject(new Error(`Copyparty chunk upload failed HTTP ${xhr.status}: ${txt.slice(0, 200)}`));
      };
      xhr.onerror = () => finalizeReject(new Error("Copyparty chunk upload failed: network error"));
      xhr.onabort = () => finalizeReject(createAbortError());

      if (signal && typeof signal.addEventListener === "function") {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      xhr.send(blob);
    });
  }

  function createProgressReporter(file, onProgress) {
    const fileSize = Math.max(0, Number(file && file.size) || 0);
    const finalizeBytes = Math.max(1, Math.min(Math.ceil(fileSize * 0.01), 256 * 1024));
    let totalUploadBytes = fileSize;
    let hashLoadedBytes = 0;
    let uploadLoadedBytes = 0;
    let stage = "hashing";
    let stageLoadedBytes = 0;
    let stageTotalBytes = fileSize;
    let lastMs = 0;
    let lastOverallLoaded = 0;

    const getTotalWorkBytes = () => fileSize + totalUploadBytes + finalizeBytes;

    return {
      setUploadBytes(totalBytes) {
        totalUploadBytes = Math.max(0, Number(totalBytes) || 0);
      },
      report(nextStage, nextStageLoadedBytes, nextStageTotalBytes) {
        if (typeof onProgress !== "function") return;
        stage = nextStage || stage;
        stageLoadedBytes = Math.max(0, Number(nextStageLoadedBytes) || 0);
        stageTotalBytes = Math.max(0, Number(nextStageTotalBytes) || 0);

        if (stage === "hashing") {
          hashLoadedBytes = Math.min(fileSize, stageLoadedBytes);
        } else if (stage === "uploading") {
          uploadLoadedBytes = Math.min(totalUploadBytes, stageLoadedBytes);
        } else if (stage === "finalizing") {
          hashLoadedBytes = fileSize;
          uploadLoadedBytes = totalUploadBytes;
        } else if (stage === "complete") {
          hashLoadedBytes = fileSize;
          uploadLoadedBytes = totalUploadBytes;
          stageLoadedBytes = finalizeBytes;
          stageTotalBytes = finalizeBytes;
        }

        const overallLoadedBytes = (stage === "complete")
          ? getTotalWorkBytes()
          : Math.min(getTotalWorkBytes(), hashLoadedBytes + uploadLoadedBytes);
        const totalWorkBytes = getTotalWorkBytes();
        const percent = totalWorkBytes > 0
          ? Math.max(0, Math.min(100, (overallLoadedBytes / totalWorkBytes) * 100))
          : (stage === "complete" ? 100 : 0);
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const dt = lastMs ? Math.max(0.001, (now - lastMs) / 1000) : 0;
        const deltaBytes = lastMs ? Math.max(0, overallLoadedBytes - lastOverallLoaded) : 0;
        const bps = dt > 0 ? (deltaBytes / dt) : 0;
        lastMs = now;
        lastOverallLoaded = overallLoadedBytes;

        try {
          onProgress(percent, {
            loadedBytes: overallLoadedBytes,
            totalBytes: totalWorkBytes,
            stage,
            stageLoadedBytes,
            stageTotalBytes,
            bps,
          });
        } catch {}
      },
    };
  }

  async function mm_up2k_uploadFile({ uploadUrl, pw, file, subdir, onProgress, signal }) {
    assert(uploadUrl, 'Copyparty upload URL missing');
    assert(file, 'file missing');
    assert(crypto && crypto.subtle, 'WebCrypto unavailable (needs HTTPS or localhost)');
    throwIfAborted(signal);

    const { baseUrl, remoteDir: rootRemoteDir } = parseUploadUrl(uploadUrl);
    const remoteDir = appendSubdir(rootRemoteDir, subdir);

    const chunkSize = getChunkSize(file.size);
    const nchunks = Math.ceil(file.size / chunkSize);
    const reporter = createProgressReporter(file, onProgress);
    reporter.report("hashing", 0, file.size);

    const hashes = [];
    let hashedBytes = 0;
    for (let i = 0; i < nchunks; i++) {
      throwIfAborted(signal);
      const car = i * chunkSize;
      const cdr = Math.min(file.size, car + chunkSize);
      const baseHashedBytes = hashedBytes;
      hashes.push(await hashChunk33(file, car, cdr, {
        signal,
        onProgress: ({ loaded, total }) => {
          reporter.report("hashing", Math.min(file.size, baseHashedBytes + Math.min(loaded, total || loaded)), file.size);
        },
      }));
      hashedBytes = cdr;
      reporter.report("hashing", hashedBytes, file.size);
    }

    const hs = await handshake({ baseUrl, remoteDir, file, hashes, pw, signal });
    const uploadSizes = hs.missingIdx.map((idx) => {
      const car = idx * chunkSize;
      const cdr = Math.min(file.size, car + chunkSize);
      return Math.max(0, cdr - car);
    });
    const totalUploadBytes = uploadSizes.reduce((sum, size) => sum + size, 0);
    reporter.setUploadBytes(totalUploadBytes);
    reporter.report("uploading", 0, totalUploadBytes);

    // Upload missing chunks, 1 chunk per request
    let uploadedBytes = 0;
    for (let i = 0; i < hs.missingIdx.length; i += 1) {
      throwIfAborted(signal);
      const idx = hs.missingIdx[i];
      const car = idx * chunkSize;
      const cdr = Math.min(file.size, car + chunkSize);
      const chunkBytes = Math.max(0, cdr - car);
      await uploadChunk({
        baseUrl,
        purl: hs.purl,
        name: hs.name,
        wark: hs.wark,
        hash: hashes[idx],
        blob: file.slice(car, cdr),
        pw,
        signal,
        onProgress: ({ loaded, total }) => {
          const safeTotal = Math.max(1, Number(total) || chunkBytes || 1);
          const safeLoaded = Math.max(0, Math.min(safeTotal, Number(loaded) || 0));
          reporter.report("uploading", uploadedBytes + safeLoaded, totalUploadBytes);
        },
      });
      uploadedBytes += chunkBytes;
      reporter.report("uploading", uploadedBytes, totalUploadBytes);
    }

    // Final handshake to verify / let server finalize
    reporter.report("finalizing", 0, 1);
    await handshake({ baseUrl, remoteDir, file, hashes, pw, signal });
    reporter.report("complete", 1, 1);

    return buildFileUrl(baseUrl, hs.purl, hs.name, hs.fk);
  }

  window.mm_up2k_uploadFile = mm_up2k_uploadFile;
})();
