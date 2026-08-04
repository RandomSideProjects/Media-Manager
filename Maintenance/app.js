"use strict";

(function initMaintenanceApp() {
  const SERVICE = window.MAINTENANCE_SERVICE || "http://127.0.0.1:41723";
  const $ = (id) => document.getElementById(id);
  const state = {
    sources: [],
    addRelease: null,
    jobId: null,
    jobKind: null,
    pollTimer: null,
    pollInFlight: false,
    seenEventCount: 0,
  };

  function appendLog(line) {
    const log = $("jobLog");
    if (!log || !line) return;
    log.textContent = `${log.textContent ? `${log.textContent}\n` : ""}${line}`;
    log.scrollTop = log.scrollHeight;
  }

  async function request(path, options) {
    const response = await fetch(`${SERVICE}${path}`, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function formatPersistedLog(entry) {
    const timestamp = entry.at ? new Date(entry.at) : null;
    const when = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleTimeString() : "--:--:--";
    const scope = entry.scope ? `[${entry.scope}]` : "[service]";
    let message = entry.message || entry.phase || entry.event || "log";
    if (entry.event === "progress" && entry.totalBytes) {
      const percent = Math.min(100, (Number(entry.transferredBytes || 0) / Number(entry.totalBytes)) * 100).toFixed(1);
      message = `${entry.phase || "progress"} ${percent}%${entry.remotePath ? ` · ${entry.remotePath}` : ""}`;
    } else if (entry.remotePath) {
      message = `${message} · ${entry.remotePath}`;
    }
    return `${when} ${scope} ${message}`;
  }

  async function reloadPersistedLog() {
    const params = new URLSearchParams({ limit: "500" });
    if (state.jobKind === "run" && state.jobId) params.set("runId", state.jobId);
    if (state.jobKind === "job" && state.jobId) params.set("jobId", state.jobId);
    try {
      const data = await request(`/api/maintenance/logs?${params}`);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const log = $("jobLog");
      log.textContent = entries.map(formatPersistedLog).join("\n");
      log.scrollTop = log.scrollHeight;
      $("logState").textContent = `${entries.length} saved log entr${entries.length === 1 ? "y" : "ies"}`;
    } catch (error) {
      $("logState").textContent = `Saved log unavailable: ${error.message}`;
    }
  }

  function setServiceState(text, error = false) {
    const element = $("serviceState");
    element.textContent = text;
    element.style.color = error ? "#ff9da5" : "";
  }

  function formatDate(value) {
    if (!value) return "No update timestamp";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }

  function folderFor(title, category) {
    return `${String(title || "Show").trim() || "Show"}/${String(category || "Season 1").trim() || "Season 1"}`;
  }

  function renderLibrary() {
    const filter = $("libraryFilter").value.trim().toLowerCase();
    const visible = state.sources.filter((source) => !filter || `${source.title} ${source.file}`.toLowerCase().includes(filter));
    $("librarySummary").textContent = `${visible.length} of ${state.sources.length} shows · latest season checked automatically`;
    const list = $("libraryList");
    list.innerHTML = "";
    for (const source of visible) {
      const row = document.createElement("div");
      row.className = "library-row";
      const details = document.createElement("div");
      const title = document.createElement("div");
      title.className = "library-title";
      title.textContent = source.title;
      const meta = document.createElement("div");
      meta.className = "library-meta";
      const categoryText = (source.categories || []).map((category) => `${category.category}: ${category.episodeCount}`).join(" · ") || "No categories";
      meta.textContent = `${categoryText} · ${formatDate(source.latestTime)}${source.hidden ? " · hidden" : ""}`;
      details.append(title, meta);
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Maintain automatically";
      button.title = `Automatically search, process, and update ${source.title}`;
      button.addEventListener("click", () => startAutomatedMaintenance([source.path], source.title).catch((error) => {
        setJobBusy(false);
        appendLog(`Start failed: ${error.message}`);
      }));
      row.append(details, button);
      list.appendChild(row);
    }
    if (!list.children.length) list.textContent = "No matching shows.";
  }

  async function refreshLibrary() {
    const button = $("refreshLibraryBtn");
    button.disabled = true;
    try {
      const data = await request("/api/library");
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      renderLibrary();
      setServiceState(`${state.sources.length} shows loaded`);
      if (data.errors?.length) appendLog(`Skipped ${data.errors.length} unreadable source file(s).`);
    } catch (error) {
      setServiceState(`Service unavailable: ${error.message}`, true);
      appendLog(`Library scan failed: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  }

  function renderResults(container, items, selectRelease) {
    container.innerHTML = "";
    for (const item of Array.isArray(items) ? items : []) {
      const row = document.createElement("div");
      row.className = "search-result";
      const title = document.createElement("div");
      title.className = "search-result-title";
      title.textContent = item.title;
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Select";
      button.addEventListener("click", () => selectRelease(item));
      row.append(title, button);
      container.appendChild(row);
    }
    if (!container.children.length) container.textContent = "No Nyaa results.";
  }

  async function searchNyaa(queryInput, results, selectRelease) {
    const query = queryInput.value.trim();
    if (!query) throw new Error("enter a show or release search term");
    results.textContent = "Searching Nyaa…";
    const data = await request(`/api/nyaa/search?q=${encodeURIComponent(query)}`);
    renderResults(results, data.items, selectRelease);
  }

  function selectAddRelease(release) {
    state.addRelease = release;
    $("addSelectedTitle").textContent = release.title;
    $("addSelection").hidden = false;
    appendLog(`Selected new-show release: ${release.title}`);
  }

  function setJobBusy(busy) {
    document.querySelectorAll(".maintenance-pane button, .maintenance-pane input, .maintenance-pane select").forEach((element) => {
      if (element.id !== "cancelJobBtn") element.disabled = busy;
    });
    $("cancelJobBtn").hidden = !busy;
  }

  function addPayload() {
    const title = $("addTitle").value.trim();
    if (!title) throw new Error("enter a title for the new show");
    return {
      action: "new",
      title,
      fileName: $("addFile").value.trim(),
      categoryName: $("addCategory").value.trim() || "Season 1",
      image: $("addImage").value.trim(),
    };
  }

  function resetJobPanel() {
    clearInterval(state.pollTimer);
    state.seenEventCount = 0;
    $("jobProgress").value = 0;
    $("jobProgressText").textContent = "Starting…";
    $("jobResult").textContent = "";
    $("jobLog").textContent = "";
    $("logState").textContent = "Waiting for persisted events…";
  }

  function handleEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(state.seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message) $("jobProgressText").textContent = message;
      if (event.event === "progress" && event.totalBytes) {
        $("jobProgress").value = Math.min(1, event.transferredBytes / event.totalBytes);
      }
      if (event.event === "link" && event.url) appendLog(`${event.remotePath || "file"} → ${event.url}`);
      if (event.event === "run") appendLog(message);
    }
    state.seenEventCount = events.length;
  }

  function renderRunProgress(run) {
    if (run.state === "checking") {
      const checked = Number(run.preflightCompleted) || 0;
      const checkTotal = Number(run.preflightTotal) || 0;
      $("jobProgress").value = checkTotal ? Math.min(1, checked / checkTotal) : 0;
      $("jobProgressText").textContent = `Checking MyAnimeList for missing episodes${checkTotal ? ` (${checked}/${checkTotal})` : "…"}`;
      $("automationSummary").textContent = "MAL preflight is deciding which categories actually need maintenance.";
      return;
    }
    const total = Number(run.total) || 0;
    const completed = Number(run.completed) || 0;
    $("jobProgress").value = total ? Math.min(1, completed / total) : 1;
    const current = (run.items || []).find((item) => item.id === run.current);
    if (current) {
      $("jobProgressText").textContent = `${current.state === "searching" ? "Searching Nyaa" : "Processing"}: ${current.title} · ${current.category} (${completed}/${total})`;
      $("automationSummary").textContent = `Automatic run in progress: ${completed} of ${total} categories finished.`;
    } else {
      $("jobProgressText").textContent = `Automatic maintenance: ${completed}/${total} categories finished.`;
    }
  }

  function renderRunResult(run) {
    const items = Array.isArray(run.items) ? run.items : [];
    if (run.planOnly === true) {
      const queued = items.filter((item) => item.state === "queued");
      const skipped = items.filter((item) => item.state === "skipped").length;
      $("automationSummary").textContent = `Plan ready: ${queued.length} categor${queued.length === 1 ? "y" : "ies"} need maintenance, ${skipped} skipped.`;
      $("jobResult").textContent = queued.map((item) => `${item.title} · ${item.category}${item.missingEpisodes?.length ? ` (missing ${item.missingEpisodes.join(", ")})` : ""}`).join("\n") || "No categories need maintenance.";
      return;
    }
    const updated = items.filter((item) => item.state === "complete").length;
    const failed = items.filter((item) => item.state === "failed").length;
    const skipped = items.filter((item) => item.state === "skipped").length;
    const cancelled = items.filter((item) => item.state === "cancelled").length;
    const errors = items.filter((item) => item.error).slice(0, 5).map((item) => `${item.title} · ${item.category}: ${item.error}`);
    $("automationSummary").textContent = `Automatic run finished: ${updated} updated, ${failed} failed, ${skipped} skipped${cancelled ? `, ${cancelled} cancelled` : ""}.`;
    $("jobResult").textContent = $("automationSummary").textContent;
    for (const error of errors) appendLog(error);
  }

  async function pollJob() {
    if (!state.jobId || state.pollInFlight) return;
    state.pollInFlight = true;
    try {
      const endpoint = state.jobKind === "run"
        ? `/api/maintenance/runs/${encodeURIComponent(state.jobId)}`
        : `/api/maintenance/jobs/${encodeURIComponent(state.jobId)}`;
      const job = await request(endpoint);
      handleEvents(job);
      if (state.jobKind === "run") {
        renderRunProgress(job);
        const done = ["complete", "complete_with_errors", "failed", "cancelled"].includes(job.state);
        if (done) {
          clearInterval(state.pollTimer);
          setJobBusy(false);
          renderRunResult(job);
          if (job.items?.some((item) => item.state === "complete")) await refreshLibrary();
        }
      } else if (job.state === "complete") {
        clearInterval(state.pollTimer);
        setJobBusy(false);
        const manifest = job.manifest;
        $("jobProgressText").textContent = "Completed.";
        if (manifest) {
          const summary = `${manifest.title}: ${manifest.added || 0} added, ${manifest.replaced || 0} replaced${manifest.skipped ? `, ${manifest.skipped} skipped` : ""}.`;
          $("jobResult").textContent = `${summary} Wrote ${manifest.path}. Commit and push that JSON to publish it.`;
          appendLog(summary);
        } else {
          $("jobResult").textContent = `Uploaded ${job.links?.length || 0} ordered links.`;
        }
        await refreshLibrary();
      } else if (["failed", "cancelled"].includes(job.state)) {
        clearInterval(state.pollTimer);
        setJobBusy(false);
        $("jobProgressText").textContent = `Job ${job.state}.`;
        $("jobResult").textContent = job.events?.at(-1)?.message || `Exit code: ${job.exitCode ?? "?"}`;
      }
    } catch (error) {
      appendLog(`Status check failed: ${error.message}`);
    } finally {
      state.pollInFlight = false;
    }
  }

  async function startAutomatedMaintenance(sourcePaths = [], title = "the library") {
    if (!state.sources.length) throw new Error("the library is empty or has not loaded yet");
    setJobBusy(true);
    resetJobPanel();
    $("automationSummary").textContent = `Queuing automatic maintenance for ${title}…`;
    const run = await request("/api/maintenance/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourcePaths,
        replaceExisting: $("updateReplace").checked,
        addMissing: $("updateAdd").checked,
        allCategories: $("updateAllCategories").checked,
      }),
    });
    state.jobId = run.id;
    state.jobKind = "run";
    appendLog(`Started automated maintenance run ${run.id}`);
    void reloadPersistedLog();
    state.pollTimer = setInterval(() => { void pollJob(); }, 2000);
    await pollJob();
  }

  async function startAddJob() {
    if (!state.addRelease) throw new Error("select a Nyaa release first");
    const maintenance = addPayload();
    const title = $("addTitle").value.trim();
    const category = $("addCategory").value.trim() || "Season 1";
    const destination = $("addDestination").value.trim() || folderFor(title, category);
    setJobBusy(true);
    resetJobPanel();
    const job = await request("/api/maintenance/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ torrentUrl: state.addRelease.torrentUrl, magnet: state.addRelease.magnet, destination, maintenance }),
    });
    state.jobId = job.id;
    state.jobKind = "job";
    appendLog(`Started new-show job ${job.id}`);
    void reloadPersistedLog();
    state.pollTimer = setInterval(() => { void pollJob(); }, 2000);
    await pollJob();
  }

  function setTab(active) {
    const add = active === "add";
    $("maintenancePane").hidden = add;
    $("addPane").hidden = !add;
    $("maintenanceTab").classList.toggle("is-active", !add);
    $("addTab").classList.toggle("is-active", add);
    $("maintenanceTab").setAttribute("aria-selected", String(!add));
    $("addTab").setAttribute("aria-selected", String(add));
  }

  $("maintenanceTab").addEventListener("click", () => setTab("maintenance"));
  $("addTab").addEventListener("click", () => setTab("add"));
  $("refreshLibraryBtn").addEventListener("click", () => { void refreshLibrary(); });
  $("refreshLogBtn").addEventListener("click", () => { void reloadPersistedLog(); });
  $("libraryFilter").addEventListener("input", renderLibrary);
  $("updateStartBtn").addEventListener("click", () => startAutomatedMaintenance().catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("addSearchBtn").addEventListener("click", () => searchNyaa($("addQuery"), $("addResults"), selectAddRelease).catch((error) => { $("addResults").textContent = `Search failed: ${error.message}`; }));
  $("addTitle").addEventListener("input", () => {
    if (!$("addQuery").value.trim() || $("addQuery").value === $("addTitle").dataset.previousTitle) $("addQuery").value = $("addTitle").value;
    if (!$("addDestination").value.trim()) $("addDestination").value = folderFor($("addTitle").value, $("addCategory").value);
    $("addTitle").dataset.previousTitle = $("addTitle").value;
  });
  $("addStartBtn").addEventListener("click", () => startAddJob().catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("cancelJobBtn").addEventListener("click", async () => {
    if (state.jobId) {
      const endpoint = state.jobKind === "run"
        ? `/api/maintenance/runs/${encodeURIComponent(state.jobId)}`
        : `/api/maintenance/jobs/${encodeURIComponent(state.jobId)}`;
      await request(endpoint, { method: "DELETE" }).catch(() => {});
    }
    clearInterval(state.pollTimer);
    setJobBusy(false);
    $("jobProgressText").textContent = "Cancelled.";
    appendLog("Cancelled.");
  });

  setTab("maintenance");
  void refreshLibrary();
  void reloadPersistedLog();
})();
