"use strict";

// Variables (top)
const feedbackBtn = document.getElementById('openFeedback');
const fbOverlay = document.getElementById('feedbackOverlay');
const fbPanel = document.getElementById('feedbackPanel');
const fbSubject = document.getElementById('fbSubject');
const fbMessage = document.getElementById('fbMessage');
const fbCount = document.getElementById('fbCount');
const fbSend = document.getElementById('fbSend');
const fbCancel = document.getElementById('fbCancel');
const fbStatus = document.getElementById('fbStatus');

// Encrypted Discord webhook (AES‑GCM)
const WH_KEY_B64 = 'aJB+40k8AaWDi1xFQdEk5g==';
const WH_IV_B64  = 'vlPG0OOvVmnKNG15';
const WH_CT_B64  = 't5v0smddP9dkGZ8fs/4AI0zVO0M1PQsT4OmxAq42GPeNRbRQdYkIfzFAEVrEyEavXwcHT34Hz7G/dLN95Qt7RQMrFlcNpHiKC1yQOcsPONnGN55fCrQnwyQiVFdPbgZsZ7ddpbLcZNW8HnA3DEEqToVKBMHwdlOM0yK8Uy8yLBSCREeVQa7bZIM=';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function getWebhook() {
  try {
    const keyBytes = b64ToBytes(WH_KEY_B64);
    const ivBytes = b64ToBytes(WH_IV_B64);
    const ctBytes = b64ToBytes(WH_CT_B64); // ciphertext || authTag
    const cryptoObj = (window && window.crypto) ? window.crypto : self.crypto;
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Crypto not available');
    const key = await cryptoObj.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plainBuf = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, tagLength: 128 }, key, ctBytes);
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.warn('Webhook decryption failed:', e);
    return '';
  }
}

// Behavior
function openFeedback(){ if (fbOverlay) fbOverlay.style.display = 'flex'; }
function closeFeedback(){ if (fbOverlay) fbOverlay.style.display = 'none'; if (fbStatus) fbStatus.textContent=''; }

if (feedbackBtn) feedbackBtn.addEventListener('click', openFeedback);
if (fbOverlay) fbOverlay.addEventListener('click', (e)=>{ if (e.target === fbOverlay) closeFeedback(); });
if (fbCancel) fbCancel.addEventListener('click', closeFeedback);
if (fbMessage && fbCount) fbMessage.addEventListener('input', ()=>{ fbCount.textContent = `${fbMessage.value.length} / 240`; });
if (fbSubject) fbSubject.addEventListener('input', () => {
  const words = fbSubject.value.trim().split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    fbSubject.value = words.slice(0,10).join(' ');
  }
});

if (fbSend) fbSend.addEventListener('click', async () => {
  const subject = (fbSubject && fbSubject.value || '').trim();
  const message = (fbMessage && fbMessage.value || '').trim();
  if (!subject || !message) { if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = 'Please enter both subject and message.'; } return; }
  const words = subject.split(/\s+/).filter(Boolean).slice(0,10);
  const subjectFinal = words.join(' ');
  const content = `New message!\n\n# ${subjectFinal}\n\n\n\nMessage\n\n${message}\n\n\n\n\n\nSent using RSP Media Manager`;

  const webhook = await getWebhook();
  if (!webhook) {
    if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = 'Unable to send (decrypt failed).'; }
    return;
  }
  if (fbSend) { fbSend.disabled = true; fbSend.textContent = 'Sending…'; }
  if (fbStatus) { fbStatus.style.color = '#9ecbff'; fbStatus.textContent = 'Sending…'; }
  try {
    let ok = false;
    try {
      const resp = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      ok = !!resp && (resp.ok || resp.status === 204);
    } catch (e) {
      // Fallback attempt with no-cors (cannot read status)
      try { await fetch(webhook, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ content }) }); ok = true; } catch {}
    }
    if (ok) {
      if (fbStatus) { fbStatus.style.color = '#7dff7a'; fbStatus.textContent = 'Sent. Thank you!'; }
      if (fbSubject) fbSubject.value = '';
      if (fbMessage) { fbMessage.value = ''; if (fbCount) fbCount.textContent = '0 / 240'; }
      setTimeout(closeFeedback, 1200);
    } else {
      if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = 'Failed to send. Please try again later.'; }
    }
  } finally {
    if (fbSend) { fbSend.disabled = false; fbSend.textContent = 'Send'; }
  }
});

