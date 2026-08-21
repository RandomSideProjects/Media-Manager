"use strict";

// Variables (top)
let feedbackBtn = null;
let fbOverlay = null;
let fbPanel = null;
let fbSubject = null;
let fbMessage = null;
let fbCount = null;
let fbSend = null;
let fbCancel = null;
let fbStatus = null;
let fbShareLocation = null;

// Ensure feedback overlay exists and query elements
function ensureFeedbackOverlay() {
  if (!fbOverlay) {
    if (window.OverlayFactory && typeof window.OverlayFactory.createFeedbackOverlay === 'function') {
      window.OverlayFactory.createFeedbackOverlay();
    }
    // Query all elements
    feedbackBtn = document.getElementById('openFeedback');
    fbOverlay = document.getElementById('feedbackOverlay');
    fbPanel = document.getElementById('feedbackPanel');
    fbSubject = document.getElementById('fbSubject');
    fbMessage = document.getElementById('fbMessage');
    fbCount = document.getElementById('fbCount');
    fbSend = document.getElementById('fbSend');
    fbCancel = document.getElementById('fbCancel');
    fbStatus = document.getElementById('fbStatus');
    fbShareLocation = document.getElementById('fbShareLocation');
    
    // Attach event listeners
    if (fbCancel) fbCancel.addEventListener('click', closeFeedback);
    if (fbOverlay) fbOverlay.addEventListener('click', (e)=>{ if (e.target === fbOverlay) closeFeedback(); });
    if (fbMessage && fbCount) fbMessage.addEventListener('input', ()=>{ fbCount.textContent = `${fbMessage.value.length} / 240`; });
    if (fbSubject) fbSubject.addEventListener('input', () => {
      const words = fbSubject.value.trim().split(/\s+/).filter(Boolean);
      if (words.length > 10) {
        fbSubject.value = words.slice(0, 10).join(' ');
      }
    });
    if (fbShareLocation) fbShareLocation.addEventListener('change', () => { updateShareLocation(fbShareLocation.checked); });
    if (fbSend) fbSend.addEventListener('click', handleSendFeedback);
  }
  return fbOverlay;
}
function getFeedbackUrl() {
  try {
    const root = window.MMAccountSync && typeof window.MMAccountSync.getBackendRoot === 'function'
      ? window.MMAccountSync.getBackendRoot()
      : '';
    if (root) return `${root}/feedback`;
  } catch {}
  return 'https://mm.alexspac.es/feedback';
}

function updateShareLocation(enabled) {
  SOURCES_SHARE_LOCATION = !!enabled;
  try { localStorage.setItem('sources_shareFeedbackLocation', SOURCES_SHARE_LOCATION ? '1':'0'); } catch {}
  if (fbShareLocation) fbShareLocation.checked = SOURCES_SHARE_LOCATION;
}

const FEEDBACK_COOLDOWN_MS = 10 * 60 * 1000;

function getLastFeedbackTimestamp() {
  try {
    const raw = localStorage.getItem('sources_lastFeedbackTs');
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function setLastFeedbackTimestamp(ts) {
  try { localStorage.setItem('sources_lastFeedbackTs', String(ts)); } catch {}
}

// Behavior
function openFeedback(){
  ensureFeedbackOverlay();
  if (fbShareLocation) {
    const desired = (typeof SOURCES_SHARE_LOCATION === 'undefined') ? true : !!SOURCES_SHARE_LOCATION;
    fbShareLocation.checked = desired;
  }
  if (fbOverlay) fbOverlay.style.display = 'flex';
}
function closeFeedback(){ if (fbOverlay) fbOverlay.style.display = 'none'; if (fbStatus) fbStatus.textContent=''; }

// Make openFeedback globally accessible
window.openFeedback = openFeedback;

// Handle send feedback - extracted to named function for reuse
async function handleSendFeedback() {
  const subject = (fbSubject && fbSubject.value || '').trim();
  const message = (fbMessage && fbMessage.value || '').trim();
  if (!subject || !message) { if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = 'Please enter both subject and message.'; } return; }
  const words = subject.split(/\s+/).filter(Boolean).slice(0,10);
  const subjectFinal = words.join(' ');
  const now = Date.now();
  const lastSent = getLastFeedbackTimestamp();
  if (lastSent && now - lastSent < FEEDBACK_COOLDOWN_MS) {
    const remainingMs = FEEDBACK_COOLDOWN_MS - (now - lastSent);
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    const waitText = remainingMinutes > 1 ? `${remainingMinutes} minutes` : '1 minute';
    if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = `Please wait ${waitText} before sending more feedback.`; }
    return;
  }

  if (fbSend) { fbSend.disabled = true; fbSend.textContent = 'Sending…'; }
  if (fbStatus) { fbStatus.style.color = '#9ecbff'; fbStatus.textContent = 'Sending…'; }

  if (fbShareLocation) updateShareLocation(fbShareLocation.checked);
  try {
    const response = await fetch(getFeedbackUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: subjectFinal,
        message,
        shareLocation: !!(fbShareLocation && fbShareLocation.checked)
      })
    });
    let responseBody = null;
    try { responseBody = await response.json(); } catch {}
    if (response.ok && responseBody && responseBody.ok === true) {
      if (fbStatus) { fbStatus.style.color = '#7dff7a'; fbStatus.textContent = 'Sent. Thank you!'; }
      if (fbSubject) fbSubject.value = '';
      if (fbMessage) { fbMessage.value = ''; if (fbCount) fbCount.textContent = '0 / 240'; }
      setLastFeedbackTimestamp(Date.now());
      setTimeout(closeFeedback, 1200);
    } else {
      if (fbStatus) { fbStatus.style.color = '#ff6b6b'; fbStatus.textContent = 'Failed to send. Please try again later.'; }
    }
  } finally {
    if (fbSend) { fbSend.disabled = false; fbSend.textContent = 'Send'; }
  }
}
