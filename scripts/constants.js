"use strict";

// Globals
let videoList = [];
let sourceKey = '';
let flatList = [];
let currentIndex = 0;
let sourceImageUrl = '';

// Utils
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0; let v = num;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatBytesDecimalMaxUnit(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const base = 1000;
  let i = 0; let v = num;
  while (v >= base && i < units.length - 1) { v /= base; i++; }
  if (v < 1 && i > 0) { v *= base; i -= 1; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
