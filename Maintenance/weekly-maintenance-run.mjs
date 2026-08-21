#!/usr/bin/env node

const backendUrl = String(process.env.MAINTENANCE_BACKEND_URL || "http://127.0.0.1:6968").replace(/\/+$/, "");
const payload = JSON.stringify({
  operation: "update",
  discoverCatalog: false,
  catalogScan: false,
  anilistCheck: true,
  replaceExisting: true,
  addMissing: true,
  addNewSeasons: false,
  allCategories: false,
  concurrency: 1,
  torrentConcurrency: 20,
});
let lastError = null;
for (let attempt = 1; attempt <= 6; attempt += 1) {
  try {
    const response = await fetch(`${backendUrl}/api/maintenance/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      console.log(`Queued maintenance run ${body.id || "without an id"} at ${backendUrl}`);
      process.exit(0);
    }
    if (response.status < 500) throw new Error(body.error || `maintenance API returned HTTP ${response.status}`);
    lastError = new Error(body.error || `maintenance API returned HTTP ${response.status}`);
  } catch (error) {
    lastError = error;
  }
  if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5000));
}
throw lastError || new Error("maintenance API request failed");
