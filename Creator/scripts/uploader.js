"use strict";

// Variables (top)
// none

async function uploadToCatbox(file) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', file);

  // Pull current settings; anonymous defaults to true
  let st = { anonymous: true, userhash: '' };
  try { st = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}') || st; } catch {}
  const isAnon = (typeof st.anonymous === 'boolean') ? st.anonymous : true;
  const effectiveUserhash = ((st.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
  if (!isAnon) {
    form.append('userhash', effectiveUserhash);
  }

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form
  });
  if (!res.ok) throw new Error('Upload error');
  return await res.text();
}

function uploadToCatboxWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://catbox.moe/user/api.php');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', file);
    // Pull current settings; anonymous defaults to true
    let st = { anonymous: true, userhash: '' };
    try { st = JSON.parse(localStorage.getItem('mm_upload_settings')||'{}') || st; } catch {}
    const isAnon = (typeof st.anonymous === 'boolean') ? st.anonymous : true;
    const effectiveUserhash = ((st.userhash || '').trim()) || '2cdcc7754c86c2871ed2bde9d';
    if (!isAnon) {
      form.append('userhash', effectiveUserhash);
    }

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          onProgress(percent);
        }
      };
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        const ok = xhr.status >= 200 && xhr.status < 300;
        if (ok) {
          resolve(xhr.responseText.trim());
        } else {
          const err = new Error('Upload error: ' + xhr.status);
          reject(err);
        }
      }
    };
    xhr.onerror = () => {
      const err = new Error('Network error');
      reject(err);
    };

    xhr.send(form);
  });
}

