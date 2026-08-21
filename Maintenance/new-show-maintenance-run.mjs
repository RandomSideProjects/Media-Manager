#!/usr/bin/env node

// Keeps the new-show catalog worker alive. The daily/general worker takes
// precedence: when an update run is active, pause the add run; resume it or
// create a fresh add run as soon as the update run finishes.

const backendUrl = String(process.env.MAINTENANCE_BACKEND_URL || "http://127.0.0.1:6968").replace(/\/+$/, "");
const pollMs = Math.max(5_000, Number(process.env.MEDIA_MANAGER_NEW_SHOW_POLL_MS) || 30_000);
const torrentConcurrency = Math.min(20, Math.max(1, Number(process.env.MEDIA_MANAGER_TORRENT_CONCURRENCY) || 20));
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

while (true) {
  try {
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
      const run = await startNewShowRun();
      report(`started new-show run ${run.id}`);
    } else {
      report(`new-show run ${add.id} is active`);
    }
  } catch (error) {
    report(`waiting for maintenance service: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
