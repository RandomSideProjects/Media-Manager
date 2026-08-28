#!/usr/bin/env node

// Keeps the new-show catalog worker alive. The daily/general worker takes
// precedence: when an update run is active, pause the add run; resume it or
// create a fresh add run as soon as the update run finishes.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const backendUrl = String(process.env.MAINTENANCE_BACKEND_URL || "http://127.0.0.1:6968").replace(/\/+$/, "");
const pollMs = Math.max(5_000, Number(process.env.MEDIA_MANAGER_NEW_SHOW_POLL_MS) || 30_000);
const torrentConcurrency = Math.min(20, Math.max(1, Number(process.env.MEDIA_MANAGER_TORRENT_CONCURRENCY) || 20));
const backoffBaseMs = Math.max(30_000, Number(process.env.MEDIA_MANAGER_NEW_SHOW_BACKOFF_MS) || 60_000);
const backoffMaxMs = Math.max(backoffBaseMs, Number(process.env.MEDIA_MANAGER_NEW_SHOW_BACKOFF_MAX_MS) || 30 * 60_000);
const stateFile = String(process.env.MEDIA_MANAGER_NEW_SHOW_STATE_FILE || join(homedir(), ".local/share/media-manager-maintenance/new-show-worker.json"));
const terminalStates = new Set(["complete", "complete_with_errors", "failed", "cancelled"]);

async function request(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `maintenance API returned HTTP ${response.status}`);
  return body;
}

function active(run) {
  return run && !run.finishedAt && !terminalStates.has(run.state);
}

function operation(run) {
  return String(run?.operation || "update").toLowerCase();
}

let lastRunId = "";
let failureCount = 0;
let backoffUntil = 0;

async function loadWorkerState() {
  try {
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    lastRunId = String(saved?.lastRunId || "").trim();
    failureCount = Math.max(0, Number(saved?.failureCount) || 0);
    backoffUntil = Math.max(0, Number(saved?.backoffUntil) || 0);
  } catch (error) {
    if (error?.code !== "ENOENT") report(`could not read worker state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveWorkerState() {
  try {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, `${JSON.stringify({ version: 1, lastRunId, failureCount, backoffUntil })}\n`, { mode: 0o600 });
  } catch (error) {
    report(`could not save worker state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function failureBackoff() {
  return Math.min(backoffMaxMs, backoffBaseMs * (2 ** Math.min(Math.max(0, failureCount - 1), 8)));
}

async function observeLastRun() {
  if (!lastRunId) return;
  const run = await request(`/api/maintenance/runs/${encodeURIComponent(lastRunId)}`).catch(() => null);
  if (!run || !run.finishedAt || !terminalStates.has(String(run.state || ""))) return;
  const failed = run.state === "failed" || (run.state === "complete_with_errors" && Number(run.failed) > 0);
  if (failed) {
    failureCount = Math.min(20, failureCount + 1);
    const delay = failureBackoff();
    backoffUntil = Date.now() + delay;
    report(`new-show run ${lastRunId} failed; retrying after ${Math.ceil(delay / 60_000)}m backoff`);
  } else {
    failureCount = 0;
    backoffUntil = 0;
  }
  lastRunId = "";
  await saveWorkerState();
}

async function startNewShowRun() {
  return request("/api/maintenance/runs", {
    method: "POST",
    body: JSON.stringify({
      operation: "add",
      discoverCatalog: true,
      catalogScan: true,
      catalogOnly: false,
      newShowsOnly: true,
      existingSourcesOnly: false,
      anilistCheck: false,
      replaceExisting: false,
      addMissing: true,
      addNewSeasons: false,
      allCategories: false,
      concurrency: 1,
      torrentConcurrency,
    }),
  });
}

async function pauseRun(run) {
  if (!active(run) || run.state === "paused" || run.state === "pausing") return run;
  return request(`/api/maintenance/runs/${encodeURIComponent(run.id)}/pause`, { method: "POST" });
}

async function resumeRun(run) {
  if (!active(run) || run.state !== "paused") return run;
  return request(`/api/maintenance/runs/${encodeURIComponent(run.id)}/resume`, {
    method: "POST",
    body: JSON.stringify({ torrentConcurrency }),
  });
}

let lastMessage = "";
function report(message) {
  if (message === lastMessage) return;
  lastMessage = message;
  console.log(`[new-show-maintenance] ${message}`);
}

await loadWorkerState();

while (true) {
  try {
    await observeLastRun();
    const snapshot = await request("/api/maintenance/active");
    const runs = Array.isArray(snapshot.runs) ? snapshot.runs.filter(active) : [];
    const general = runs.find((run) => operation(run) !== "add");
    const add = runs.find((run) => operation(run) === "add");
    if (general) {
      if (add && add.state !== "paused" && add.state !== "pausing") {
        await pauseRun(add);
        report(`paused new-show run ${add.id} for general maintenance`);
      } else {
        report(`general maintenance ${general.id} is active; new-show work is paused`);
      }
    } else if (add?.state === "paused") {
      await resumeRun(add);
      report(`resumed new-show run ${add.id}`);
    } else if (!add) {
      if (Date.now() < backoffUntil) {
        report(`provider outage backoff active for ${Math.ceil((backoffUntil - Date.now()) / 60_000)}m`);
      } else {
        const run = await startNewShowRun();
        lastRunId = String(run.id || "").trim();
        await saveWorkerState();
        report(`started new-show run ${run.id}`);
      }
    } else {
      report(`new-show run ${add.id} is active`);
    }
  } catch (error) {
    report(`waiting for maintenance service: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
