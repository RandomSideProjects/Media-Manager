"use strict";

(function initMaintenanceApp() {
  const serviceFromUrl = new URLSearchParams(window.location.search).get("service");
  const SERVICE = window.MAINTENANCE_SERVICE || serviceFromUrl || "http://127.0.0.1:6968";
  const $ = (id) => document.getElementById(id);
  const state = {
    sources: [],
    addRelease: null,
    jobId: null,
    jobKind: null,
    pollTimer: null,
    pollInFlight: false,
    seenEventCount: 0,
    seenChildEventCount: 0,
    childEventJobId: null,
    childEventCounts: {},
  };

  function appendLog(line) {
    const log = $("jobLog");
    if (!log || !line) return;
    log.textContent = `${log.textContent ? `${log.textContent}\n` : ""}${line}`;
    log.scrollTop = log.scrollHeight;
  }

  function setProgressCount(value) {
    const element = $("jobProgressCount");
    if (element) element.textContent = String(value || "0/0");
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let size = bytes;
    let index = -1;
    do { size /= 1024; index += 1; } while (size >= 1024 && index < units.length - 1);
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
  }

  const TORRENT_STALLED_AFTER_SECONDS = 20;

  function formatRate(value) {
    if (value === null || value === undefined || value === "") return "—";
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 ? `${formatBytes(rate)}/s` : "—";
  }

  function formatDuration(value) {
    const rawSeconds = Number(value);
    if (!Number.isFinite(rawSeconds) || rawSeconds < 0) return "—";
    const seconds = Math.ceil(rawSeconds);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function formatAge(value) {
    const timestamp = Date.parse(value || "");
    if (!Number.isFinite(timestamp)) return "unknown";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  }

  function phaseLabel(value) {
    return String(value || "transfer").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function formatEpisodeList(numbers) {
    const values = [...new Set((Array.isArray(numbers) ? numbers : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
    if (!values.length) return "Full selected release";
    const ranges = [];
    let start = values[0];
    let end = values[0];
    for (const value of values.slice(1)) {
      if (value === end + 1) {
        end = value;
        continue;
      }
      ranges.push(start === end ? String(start) : `${start}–${end}`);
      start = value;
      end = value;
    }
    ranges.push(start === end ? String(start) : `${start}–${end}`);
    return ranges.join(", ");
  }

  function displayRemotePath(value) {
    const path = String(value || "").trim();
    if (!path) return "Waiting for file";
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || path;
  }

  function setTorrentDetail(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value ?? "—");
  }

  function clearTorrentProgress(message = "No torrent transfer active.") {
    const details = $("torrentProgressDetails");
    if (!details) return;
    details.classList.remove("is-stalled");
    setTorrentDetail("torrentProgressPrimary", message);
    setTorrentDetail("torrentProgressFile", "—");
    setTorrentDetail("torrentProgressPercent", "—");
    setTorrentDetail("torrentProgressBytes", "—");
    setTorrentDetail("torrentProgressSpeed", "—");
    setTorrentDetail("torrentProgressSwarmSpeed", "—");
    setTorrentDetail("torrentProgressPeers", "—");
    setTorrentDetail("torrentProgressEta", "—");
    setTorrentDetail("torrentProgressTarget", "—");
    setTorrentDetail("torrentProgressLastUpdate", "—");
    const file = $("torrentProgressFile");
    if (file) file.title = "";
    const jobs = $("torrentProgressJobs");
    if (jobs) jobs.replaceChildren();
  }

  function torrentProgressSnapshot(job, run) {
    const active = Array.isArray(run?.active) ? run.active : [];
    const item = active.find((candidate) => candidate.jobId === job.id || candidate.jobIds?.includes(job.id)) || null;
    const events = Array.isArray(job?.events) ? job.events : [];
    let event = null;
    for (const candidate of events) {
      const totalBytes = Number(candidate?.totalBytes);
      if (candidate?.event === "progress" && Number.isFinite(totalBytes) && totalBytes > 0) event = candidate;
    }
    if (!event) return { job, item, event: null, observedAt: 0 };
    const totalBytes = Number(event.totalBytes);
    const transferredBytes = Math.max(0, Number(event.transferredBytes) || 0);
    const phase = String(event.phase || "");
    const isUpload = /upload/i.test(phase);
    const path = String(event.remotePath || "");
    const phaseEvents = events.filter((candidate) => candidate?.event === "progress"
      && String(candidate.remotePath || "") === path
      && String(candidate.phase || "") === phase
      && Number.isFinite(Number(candidate.transferredBytes)));
    let previous = null;
    let lastMovement = null;
    for (const candidate of phaseEvents) {
      const bytes = Math.max(0, Number(candidate.transferredBytes) || 0);
      const at = Date.parse(candidate.at || "");
      if (previous && bytes > previous.bytes && Number.isFinite(at) && Number.isFinite(previous.at)) {
        lastMovement = { at, bytes, previous };
      }
      previous = { at, bytes };
    }
    const lastByteAt = lastMovement?.at || Date.parse(phaseEvents[0]?.at || event.at || job.startedAt || "");
    const byteAgeSeconds = Number.isFinite(lastByteAt) ? Math.max(0, (Date.now() - lastByteAt) / 1000) : null;
    const movementSeconds = lastMovement ? (lastMovement.at - lastMovement.previous.at) / 1000 : 0;
    const measuredFileRate = lastMovement && movementSeconds > 0
      ? (lastMovement.bytes - lastMovement.previous.bytes) / movementSeconds
      : 0;
    const reportedUploadRate = Math.max(0, Number(event.uploadBytesPerSecond) || 0);
    const fileBytesPerSecond = isUpload && reportedUploadRate > 0
      ? reportedUploadRate
      : byteAgeSeconds !== null && byteAgeSeconds >= TORRENT_STALLED_AFTER_SECONDS ? 0 : Math.max(0, measuredFileRate);
    const swarmBytesPerSecond = isUpload ? null : Math.max(0, Number(event.downloadBytesPerSecond) || 0);
    const observedAt = Date.parse(event.at || job.startedAt || "");
    const percent = Math.min(100, Math.max(0, (transferredBytes / totalBytes) * 100));
    const stalled = job.state === "running" && !isUpload && byteAgeSeconds !== null && byteAgeSeconds >= TORRENT_STALLED_AFTER_SECONDS;
    const targetEpisodes = item?.missingEpisodes?.length
      ? item.missingEpisodes
      : job?.maintenance?.targetEpisodes || [];
    return {
      job,
      item,
      event,
      observedAt: Number.isFinite(observedAt) ? observedAt : 0,
      byteAgeSeconds,
      lastByteAt: Number.isFinite(lastByteAt) ? new Date(lastByteAt).toISOString() : "",
      stalled,
      totalBytes,
      transferredBytes,
      phase,
      fileBytesPerSecond,
      swarmBytesPerSecond,
      percent,
      targetEpisodes,
      file: displayRemotePath(path),
    };
  }

  function renderTorrentProgress(childJobs = [], run = null) {
    const details = $("torrentProgressDetails");
    if (!details) return;
    const jobs = Array.isArray(childJobs) ? childJobs.filter(Boolean) : [];
    if (!jobs.length) {
      clearTorrentProgress();
      return;
    }
    const snapshots = jobs.map((job) => torrentProgressSnapshot(job, run));
    const transfers = snapshots.filter((snapshot) => snapshot.event);
    const primary = [...transfers].sort((a, b) => a.observedAt - b.observedAt).at(-1) || snapshots[0];
    const activeCount = jobs.length;
    const queuedCount = jobs.filter((job) => job.state === "queued").length;
    const activeLabel = queuedCount
      ? `${queuedCount} torrent job${queuedCount === 1 ? "" : "s"} queued behind the current job`
      : `${activeCount} torrent job${activeCount === 1 ? "" : "s"} active`;
    const targetLabel = formatEpisodeList(primary.targetEpisodes);
    const primaryMessage = primary.event
      ? `${activeLabel} · ${phaseLabel(primary.phase)} · ${primary.percent.toFixed(1)}% · file ${formatRate(primary.fileBytesPerSecond)} · swarm ${formatRate(primary.swarmBytesPerSecond)}`
      : `${activeLabel} · waiting for transfer statistics…`;
    details.classList.toggle("is-stalled", Boolean(primary.stalled));
    setTorrentDetail("torrentProgressPrimary", primary.job.state === "queued"
      ? `${activeLabel}${primary.job.queuePosition > 1 ? ` · queue position ${primary.job.queuePosition}` : ""} · waiting for the single torrent slot.`
      : primary.stalled
      ? `${activeLabel} · ${phaseLabel(primary.phase)} · no file-byte movement for ${formatDuration(primary.byteAgeSeconds)} — waiting on a piece. Swarm ${formatRate(primary.swarmBytesPerSecond)}.`
      : primaryMessage);
    setTorrentDetail("torrentProgressFile", primary.file || "—");
    setTorrentDetail("torrentProgressPercent", primary.event ? `${primary.percent.toFixed(1)}%` : "—");
    setTorrentDetail("torrentProgressBytes", primary.event ? `${formatBytes(primary.transferredBytes)} / ${formatBytes(primary.totalBytes)}` : "—");
    setTorrentDetail("torrentProgressSpeed", primary.event ? formatRate(primary.fileBytesPerSecond) : "—");
    setTorrentDetail("torrentProgressSwarmSpeed", primary.event ? formatRate(primary.swarmBytesPerSecond) : "—");
    const peers = Number(primary.event?.numPeers);
    const seeds = Number(primary.event?.numSeeds);
    setTorrentDetail("torrentProgressPeers", Number.isFinite(peers) && peers >= 0
      ? `${peers} peers${Number.isFinite(seeds) && seeds >= 0 ? ` · ${seeds} seeds` : ""}`
      : "—");
    setTorrentDetail("torrentProgressEta", primary.event && primary.fileBytesPerSecond > 0
      ? formatDuration(Math.max(0, primary.totalBytes - primary.transferredBytes) / primary.fileBytesPerSecond)
      : "—");
    setTorrentDetail("torrentProgressTarget", primary.event ? targetLabel : "—");
    setTorrentDetail("torrentProgressLastUpdate", primary.event ? formatAge(primary.lastByteAt) : "—");
    const file = $("torrentProgressFile");
    if (file) file.title = primary.event?.remotePath || "";

    const jobList = $("torrentProgressJobs");
    if (!jobList) return;
    jobList.replaceChildren();
    for (const snapshot of snapshots) {
      const row = document.createElement("div");
      row.className = "torrent-progress-job";
      const title = document.createElement("span");
      title.className = "torrent-progress-job-title";
      const context = snapshot.item
        ? `${snapshot.item.title} · ${snapshot.item.category}`
        : `Torrent ${String(snapshot.job.id || "").slice(0, 8)}`;
      title.textContent = snapshot.event ? `${context} · ${snapshot.file}` : context;
      title.title = title.textContent;
      const meta = document.createElement("span");
      meta.className = "torrent-progress-job-meta";
      meta.textContent = snapshot.job.state === "queued"
        ? `queue position ${snapshot.job.queuePosition || "?"} · waiting for the single torrent slot`
        : snapshot.event
        ? `${snapshot.percent.toFixed(1)}% · file ${formatRate(snapshot.fileBytesPerSecond)} · swarm ${formatRate(snapshot.swarmBytesPerSecond)} · ${snapshot.stalled ? `STALLED (${formatDuration(snapshot.byteAgeSeconds)})` : formatAge(snapshot.lastByteAt)}`
        : "waiting for transfer stats";
      row.append(title, meta);
      jobList.appendChild(row);
    }
  }

  function updateCurrentJob(stateText, title, meta) {
    if ($("currentJobState")) $("currentJobState").textContent = stateText || "Idle";
    if ($("currentJobTitle")) $("currentJobTitle").textContent = title || "Nothing running";
    if ($("currentJobMeta")) $("currentJobMeta").textContent = meta || "Start maintenance to see the active show, season, and step here.";
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
      title.textContent = `${item.title}${item.provider ? ` · ${item.provider}` : ""}`;
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Select";
      button.addEventListener("click", () => selectRelease(item));
      row.append(title, button);
      container.appendChild(row);
    }
    if (!container.children.length) container.textContent = "No releases found.";
  }

  async function searchReleases(queryInput, results, selectRelease) {
    const query = queryInput.value.trim();
    if (!query) throw new Error("enter a show or release search term");
    results.textContent = "Searching release sources…";
    const category = $("addCategory")?.value.trim() || "";
    const categoryQuery = category ? `&category=${encodeURIComponent(category)}` : "";
    const data = await request(`/api/releases/search?q=${encodeURIComponent(query)}${categoryQuery}`);
    renderResults(results, data.items, selectRelease);
  }

  function selectAddRelease(release) {
    state.addRelease = release;
    $("addSelectedTitle").textContent = `${release.title}${release.provider ? ` · ${release.provider}` : ""}`;
    $("addSelection").hidden = false;
    appendLog(`Selected new-show release${release.provider ? ` [${release.provider}]` : ""}: ${release.title}`);
  }

  function setJobBusy(busy) {
    document.querySelectorAll("#maintenanceWorkspace button, #maintenanceWorkspace input, #maintenanceWorkspace select").forEach((element) => {
      if (!["cancelJobBtn", "refreshLogBtn"].includes(element.id)) element.disabled = busy;
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
    state.seenChildEventCount = 0;
    state.childEventJobId = null;
    state.childEventCounts = {};
    state.currentChildJob = null;
    $("jobProgress").value = 0;
    $("jobProgressText").textContent = "Starting…";
    setProgressCount("0/0");
    clearTorrentProgress();
    $("jobResult").textContent = "";
    $("jobLog").textContent = "";
    $("logState").textContent = "Waiting for persisted events…";
    updateCurrentJob("Starting", "Preparing maintenance", "Waiting for the local service to create a run.");
  }

  function handleEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(state.seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message) $("jobProgressText").textContent = message;
      if (event.event === "progress" && event.totalBytes) {
        $("jobProgress").value = Math.min(1, event.transferredBytes / event.totalBytes);
        setProgressCount(`${formatBytes(event.transferredBytes)} / ${formatBytes(event.totalBytes)}`);
      }
      if (message && event.event !== "progress") appendLog(event.event === "link" && event.url
        ? `${event.remotePath || "file"} → ${event.url}`
        : message);
      if (message && event.event !== "progress") updateCurrentJob(job.state === "running" ? "Working" : job.state, "Direct new-show job", message);
    }
    state.seenEventCount = events.length;
  }

  function handleChildEvents(job) {
    if (!job) return;
    const events = Array.isArray(job.events) ? job.events : [];
    const seen = Number(state.childEventCounts[job.id]) || 0;
    for (const event of events.slice(seen)) {
      const message = event.message || event.phase || event.event;
      if (event.event === "progress" && event.totalBytes) {
        setProgressCount(`${formatBytes(event.transferredBytes)} / ${formatBytes(event.totalBytes)}`);
      } else if (message) {
        appendLog(message);
      }
    }
    state.childEventCounts[job.id] = events.length;
  }

  function renderRunProgress(run, childJobs = []) {
    if (run.state === "checking") {
      clearTorrentProgress("MAL preflight in progress — no torrent transfer yet.");
      const checked = Number(run.preflightCompleted) || 0;
      const checkTotal = Number(run.preflightTotal) || 0;
      $("jobProgress").value = checkTotal ? Math.min(1, checked / checkTotal) : 0;
      setProgressCount(`${checked}/${checkTotal || "?"}`);
      const current = run.preflightCurrent || {};
      const latest = run.events?.at(-1)?.message || "Looking up episode counts…";
      updateCurrentJob("Checking MAL", current.title || "Scanning the library", current.category ? `${current.category} · ${latest}` : latest);
      $("jobProgressText").textContent = "Checking MyAnimeList for missing episodes…";
      $("automationSummary").textContent = "MAL preflight is deciding which categories actually need maintenance.";
      return;
    }
    renderTorrentProgress(childJobs, run);
    const total = Number(run.total) || 0;
    const completed = Number(run.completed) || 0;
    const active = Array.isArray(run.active) ? run.active : [];
    const activeSuffix = active.length > 1 ? ` · ${active.length} jobs active` : "";
    $("jobProgress").value = total ? Math.min(1, completed / total) : 1;
    setProgressCount(`${completed}/${total}`);
    const current = active.find((item) => item.id === run.current)
      || (run.items || []).find((item) => item.id === run.current);
    if (current) {
      const stateLabels = { searching: "Searching release sources", downloading: "Downloading torrent", processing: "Processing video", uploading: "Uploading", complete: "Complete" };
      const childQueued = childJobs.some((job) => job?.state === "queued");
      const label = childQueued
        ? "Queued for torrent slot"
        : current.newSeason
        ? ({ searching: "Searching release sources for season", downloading: "Downloading new season", processing: "Processing new season", uploading: "Uploading new season", complete: "Season added" }[current.state] || "Adding season")
        : (stateLabels[current.state] || "Processing");
      const childJob = Array.isArray(childJobs) ? childJobs.find((job) => job) : null;
      const childEvent = childJob?.events?.at(-1);
      const queuedChild = childJobs.find((job) => job?.state === "queued");
      const childMessage = childQueued
        ? `Waiting for the current torrent job${queuedChild?.queuePosition > 1 ? ` (queue position ${queuedChild.queuePosition})` : ""}`
        : childEvent?.message || (childEvent?.event === "progress" ? phaseLabel(childEvent.phase) : "");
      const provider = current.provider ? ` · via ${current.provider}` : "";
      const detail = `${childMessage || `${current.category}${current.missingEpisodes?.length ? ` · downloading episodes ${formatEpisodeList(current.missingEpisodes)}` : ""}`}${provider}`;
      updateCurrentJob(label, current.title, detail);
      $("jobProgressText").textContent = `${label}: ${current.title} · ${current.category}`;
      $("automationSummary").textContent = `Automatic run in progress: ${completed} of ${total} categories finished${activeSuffix}.`;
    } else {
      const latest = run.events?.at(-1)?.message || "Preparing the next category…";
      updateCurrentJob("Working", "Automatic maintenance", latest);
      $("jobProgressText").textContent = `Automatic maintenance: ${completed}/${total} categories finished${activeSuffix}.`;
    }
  }

  function renderRunResult(run) {
    const items = Array.isArray(run.items) ? run.items : [];
    if (run.planOnly === true) {
      const queued = items.filter((item) => item.state === "queued");
      const skipped = items.filter((item) => item.state === "skipped").length;
      $("automationSummary").textContent = `Plan ready: ${queued.length} categor${queued.length === 1 ? "y" : "ies"} need maintenance, ${skipped} skipped.`;
      $("jobResult").textContent = queued.map((item) => `${item.title} · ${item.category}${item.missingEpisodes?.length ? ` (missing ${formatEpisodeList(item.missingEpisodes)})` : ""}`).join("\n") || "No categories need maintenance.";
      setProgressCount(`${run.preflightCompleted || 0}/${run.preflightTotal || 0}`);
      updateCurrentJob("Plan ready", "Automatic maintenance", $("automationSummary").textContent);
      return;
    }
    const updated = items.filter((item) => item.state === "complete").length;
    const failed = items.filter((item) => item.state === "failed").length;
    const skipped = items.filter((item) => item.state === "skipped").length;
    const cancelled = items.filter((item) => item.state === "cancelled").length;
    const errors = items.filter((item) => item.error).slice(0, 5).map((item) => `${item.title} · ${item.category}: ${item.error}`);
    $("automationSummary").textContent = `Automatic run finished: ${updated} updated, ${failed} failed, ${skipped} skipped${cancelled ? `, ${cancelled} cancelled` : ""}.`;
    $("jobResult").textContent = $("automationSummary").textContent;
    setProgressCount(`${run.completed || 0}/${run.total || 0}`);
    updateCurrentJob(run.state === "complete" ? "Complete" : run.state, "Automatic maintenance", $("automationSummary").textContent);
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
        const activeJobIds = Array.isArray(job.activeJobIds) && job.activeJobIds.length
          ? job.activeJobIds
          : (job.currentJobId ? [job.currentJobId] : []);
        const childJobs = await Promise.all(activeJobIds.map((jobId) => request(`/api/maintenance/jobs/${encodeURIComponent(jobId)}`).catch(() => null)));
        childJobs.filter(Boolean).forEach(handleChildEvents);
        renderRunProgress(job, childJobs.filter(Boolean));
        const done = ["complete", "complete_with_errors", "failed", "cancelled"].includes(job.state);
        if (done) {
          clearInterval(state.pollTimer);
          setJobBusy(false);
          renderRunResult(job);
          if (job.items?.some((item) => item.state === "complete")) await refreshLibrary();
        }
      } else {
        renderTorrentProgress([job]);
        if (job.state === "complete") {
          clearInterval(state.pollTimer);
          setJobBusy(false);
          const manifest = job.manifest;
          $("jobProgressText").textContent = "Completed.";
          $("jobProgress").value = 1;
          setProgressCount("1/1");
          updateCurrentJob("Complete", "New-show job", "Upload and source generation finished.");
          if (manifest) {
            const summary = `${manifest.title}: ${manifest.added || 0} added, ${manifest.replaced || 0} replaced${manifest.skipped ? `, ${manifest.skipped} skipped` : ""}.`;
            const publication = manifest.github?.skipped
              ? " GitHub publication was skipped."
              : manifest.github?.commitSha
                ? ` Published through the GitHub API (${manifest.github.repository}/${manifest.github.branch}).`
                : " Published through the GitHub API.";
            const cleanup = job.cleanup?.state === "removed"
              ? " Temporary download and re-encode files were removed."
              : job.cleanup?.state === "failed"
                ? " Temporary-file cleanup needs attention."
                : "";
            $("jobResult").textContent = `${summary} Wrote ${manifest.path}.${publication}${cleanup}`;
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
          updateCurrentJob(job.state, "New-show job", $("jobResult").textContent);
        }
      }
    } catch (error) {
      appendLog(`Status check failed: ${error.message}`);
    } finally {
      state.pollInFlight = false;
    }
  }

  async function reconnectToActiveWork() {
    try {
      const active = await discoverActiveWork();
      const run = Array.isArray(active.runs) ? active.runs[0] : null;
      const job = !run && Array.isArray(active.jobs) ? active.jobs[0] : null;
      if (!run && !job) {
        await reloadPersistedLog();
        return;
      }
      state.jobId = run?.id || job.id;
      state.jobKind = run ? "run" : "job";
      setJobBusy(true);
      resetJobPanel();
      const label = run ? `maintenance run ${run.id}` : `job ${job.id}`;
      appendLog(`Reconnected to active ${label}.`);
      $("automationSummary").textContent = `Reconnected to the active ${run ? "maintenance run" : "job"}; the service continued while this page was closed.`;
      void reloadPersistedLog();
      state.pollTimer = setInterval(() => { void pollJob(); }, 2000);
      await pollJob();
    } catch (error) {
      appendLog(`Active-work reconnect unavailable: ${error.message}`);
      await reloadPersistedLog();
    }
  }

  async function discoverActiveWork() {
    try {
      return await request("/api/maintenance/active");
    } catch {
      // Compatible with a service started before the active-work endpoint.
      const data = await request("/api/maintenance/logs?limit=2000");
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const jobIds = [];
      const seenJobIds = new Set();
      for (const entry of [...entries].reverse()) {
        if (!entry.jobId || entry.scope !== "job" || seenJobIds.has(entry.jobId)) continue;
        if (["job_complete", "job_failed"].includes(entry.event)) continue;
        seenJobIds.add(entry.jobId);
        jobIds.push(entry.jobId);
      }
      for (const jobId of jobIds) {
        const job = await request(`/api/maintenance/jobs/${encodeURIComponent(jobId)}`).catch(() => null);
        if (!job || job.finishedAt || ["complete", "failed", "cancelled"].includes(job.state)) continue;
        if (job.runId) {
          const run = await request(`/api/maintenance/runs/${encodeURIComponent(job.runId)}`).catch(() => null);
          if (run && !run.finishedAt && !["complete", "complete_with_errors", "failed", "cancelled"].includes(run.state)) {
            return { runs: [run], jobs: [] };
          }
        } else {
          return { runs: [], jobs: [{ id: job.id }] };
        }
      }
      const runIds = [];
      const seenRunIds = new Set();
      for (const entry of [...entries].reverse()) {
        if (!entry.runId || seenRunIds.has(entry.runId)) continue;
        if (entry.event !== "run_started" && entry.scope !== "run") continue;
        seenRunIds.add(entry.runId);
        runIds.push(entry.runId);
      }
      for (const runId of runIds) {
        const run = await request(`/api/maintenance/runs/${encodeURIComponent(runId)}`).catch(() => null);
        if (run && !run.finishedAt && !["complete", "complete_with_errors", "failed", "cancelled"].includes(run.state)) {
          return { runs: [run], jobs: [] };
        }
      }
      return { runs: [], jobs: [] };
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
        concurrency: 1,
        torrentConcurrency: 1,
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
    if (!state.addRelease) throw new Error("select a release first");
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
    if ($("maintenancePane")) $("maintenancePane").hidden = add;
    const addPane = $("addPane");
    if (addPane && !addPane.closest("details")) addPane.hidden = !add;
    if ($("maintenanceTab")) {
      $("maintenanceTab").classList.toggle("is-active", !add);
      $("maintenanceTab").setAttribute("aria-selected", String(!add));
    }
    if ($("addTab")) {
      $("addTab").classList.toggle("is-active", add);
      $("addTab").setAttribute("aria-selected", String(add));
    }
  }

  $("maintenanceTab")?.addEventListener("click", () => setTab("maintenance"));
  $("addTab")?.addEventListener("click", () => setTab("add"));
  $("refreshLibraryBtn")?.addEventListener("click", () => { void refreshLibrary(); });
  $("refreshLogBtn")?.addEventListener("click", () => { void reloadPersistedLog(); });
  $("libraryFilter")?.addEventListener("input", renderLibrary);
  $("updateStartBtn")?.addEventListener("click", () => startAutomatedMaintenance().catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("addSearchBtn")?.addEventListener("click", () => searchReleases($("addQuery"), $("addResults"), selectAddRelease).catch((error) => { $("addResults").textContent = `Search failed: ${error.message}`; }));
  $("addTitle")?.addEventListener("input", () => {
    if (!$("addQuery").value.trim() || $("addQuery").value === $("addTitle").dataset.previousTitle) $("addQuery").value = $("addTitle").value;
    if (!$("addDestination").value.trim()) $("addDestination").value = folderFor($("addTitle").value, $("addCategory").value);
    $("addTitle").dataset.previousTitle = $("addTitle").value;
  });
  $("addStartBtn")?.addEventListener("click", () => startAddJob().catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("cancelJobBtn")?.addEventListener("click", async () => {
    if (state.jobId) {
      const endpoint = state.jobKind === "run"
        ? `/api/maintenance/runs/${encodeURIComponent(state.jobId)}`
        : `/api/maintenance/jobs/${encodeURIComponent(state.jobId)}`;
      await request(endpoint, { method: "DELETE" }).catch(() => {});
    }
    clearInterval(state.pollTimer);
    setJobBusy(false);
    $("jobProgressText").textContent = "Cancelled.";
    updateCurrentJob("Cancelled", "Maintenance", "The current run was cancelled.");
    appendLog("Cancelled.");
  });

  void refreshLibrary();
  void reconnectToActiveWork();
})();
