"use strict";

// Minimal up2k client for the Creator page (standalone, no Copyparty UI deps).
// Exposes: window.mm_up2k_uploadFile({ uploadUrl, pw, file, subdir }) -> Promise<url>
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

  async function hashChunk33(file, car, cdr) {
    const buf = await file.slice(car, cdr).arrayBuffer();
    const dig = await crypto.subtle.digest("SHA-512", buf);
    const u8 = new Uint8Array(dig).subarray(0, 33);
    return b64url(u8);
  }

  function parseUploadUrl(uploadUrl) {
    // Accept full URL like https://cpr.example.com/pub/MM/foo/
    const u = new URL(uploadUrl);
    const baseUrl = u.origin;
    let remoteDir = u.pathname;
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

  async function doFetch(url, init, pw) {
    const headers = Object.assign({}, init && init.headers ? init.headers : {});
    if (pw) headers.PW = pw;
    return fetch(url, Object.assign({}, init, { headers }));
  }

  function buildFileUrl(baseUrl, remoteDir, name, fk) {
    let url = baseUrl + remoteDir + encodeURIComponent(name);
    if (fk) url += `?k=${encodeURIComponent(fk)}`;
    return url;
  }

  async function handshake({ baseUrl, remoteDir, file, hashes, pw }) {
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
    }, pw);

    const txt = await res.text();
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

  async function uploadChunk({ baseUrl, purl, name, wark, hash, blob, pw }) {
    const url = baseUrl + purl + encodeURIComponent(name);
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Up2k-Hash': hash,
        'X-Up2k-Wark': String(wark || ''),
      },
      body: blob,
    }, pw);

    const txt = await res.text();
    if (!res.ok) {
      throw new Error(`Copyparty chunk upload failed HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
  }

  async function mm_up2k_uploadFile({ uploadUrl, pw, file, subdir }) {
    assert(uploadUrl, 'Copyparty upload URL missing');
    assert(file, 'file missing');
    assert(crypto && crypto.subtle, 'WebCrypto unavailable (needs HTTPS or localhost)');

    const { baseUrl, remoteDir: rootRemoteDir } = parseUploadUrl(uploadUrl);
    const remoteDir = appendSubdir(rootRemoteDir, subdir);

    const chunkSize = getChunkSize(file.size);
    const nchunks = Math.ceil(file.size / chunkSize);

    const hashes = [];
    for (let i = 0; i < nchunks; i++) {
      const car = i * chunkSize;
      const cdr = Math.min(file.size, car + chunkSize);
      hashes.push(await hashChunk33(file, car, cdr));
    }

    const hs = await handshake({ baseUrl, remoteDir, file, hashes, pw });

    // Upload missing chunks, 1 chunk per request
    for (const idx of hs.missingIdx) {
      const car = idx * chunkSize;
      const cdr = Math.min(file.size, car + chunkSize);
      await uploadChunk({
        baseUrl,
        purl: hs.purl,
        name: hs.name,
        wark: hs.wark,
        hash: hashes[idx],
        blob: file.slice(car, cdr),
        pw,
      });
    }

    // Final handshake to verify / let server finalize
    await handshake({ baseUrl, remoteDir, file, hashes, pw });

    return buildFileUrl(baseUrl, hs.purl, hs.name, hs.fk);
  }

  window.mm_up2k_uploadFile = mm_up2k_uploadFile;
})();
