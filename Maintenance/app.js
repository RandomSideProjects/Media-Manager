"use strict";

(function initMaintenanceApp() {
  const DEFAULT_LOCAL_SERVICE = "http://127.0.0.1:6968";
  const DEFAULT_REMOTE_SERVICE = "http://100.68.0.2:6968";
  const SERVER_STORAGE_KEY = "media-manager.maintenance.server.v1";
  const LOCAL_OPERATION_STORAGE_KEY = "media-manager.maintenance.operation.local.v1";
  const REMOTE_OPERATION_STORAGE_KEY = "media-manager.maintenance.operation.remote.v1";
  // Start the simplified UI at the requested 20-job setting instead of
  // carrying forward the older, lower per-server value.
  const LOCAL_TORRENT_CONCURRENCY_STORAGE_KEY = "media-manager.maintenance.torrent-concurrency.local.v2";
  const REMOTE_TORRENT_CONCURRENCY_STORAGE_KEY = "media-manager.maintenance.torrent-concurrency.remote.v2";
  const LOCAL_SERVICE_STORAGE_KEY = "media-manager.maintenance.local-service.v1";
  const REMOTE_SERVICE_STORAGE_KEY = "media-manager.maintenance.remote-service.v1";
  // Keep the old key readable so an existing browser selection is not lost
  // when it opens the new mode picker for the first time.
  const LEGACY_SERVICE_STORAGE_KEY = "media-manager.maintenance.backend.v2";
  const DEFAULT_TORRENT_CONCURRENCY = 20;
  const MAX_TORRENT_CONCURRENCY = 20;

  function normalizeServiceUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  function storedValue(key) {
    try {
      return String(window.localStorage.getItem(key) || "").trim();
    } catch {
      return "";
    }
  }

  function storedServiceUrl(key) {
    return normalizeServiceUrl(storedValue(key));
  }

  function storedServer() {
    const value = storedValue(SERVER_STORAGE_KEY).toLowerCase();
    return ["local", "remote"].includes(value) ? value : "";
  }

  function operationStorageKey(server) {
    return server === "remote" ? REMOTE_OPERATION_STORAGE_KEY : LOCAL_OPERATION_STORAGE_KEY;
  }

  function storedOperation(server) {
    const value = storedValue(operationStorageKey(server)).toLowerCase();
    return ["update", "add"].includes(value) ? value : "";
  }

  function torrentConcurrencyStorageKey(server) {
    return server === "remote" ? REMOTE_TORRENT_CONCURRENCY_STORAGE_KEY : LOCAL_TORRENT_CONCURRENCY_STORAGE_KEY;
  }

  function normalizeTorrentConcurrency(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return DEFAULT_TORRENT_CONCURRENCY;
    return Math.min(MAX_TORRENT_CONCURRENCY, Math.max(1, Math.floor(requested)));
  }

  function storedTorrentConcurrency(server) {
    const value = storedValue(torrentConcurrencyStorageKey(server));
    return value ? normalizeTorrentConcurrency(value) : DEFAULT_TORRENT_CONCURRENCY;
  }

  const serviceFromUrl = normalizeServiceUrl(new URLSearchParams(window.location.search).get("service"));
  const localService = storedServiceUrl(LOCAL_SERVICE_STORAGE_KEY)
    || normalizeServiceUrl(window.MAINTENANCE_SERVICE)
    || DEFAULT_LOCAL_SERVICE;
  const remoteService = storedServiceUrl(REMOTE_SERVICE_STORAGE_KEY)
    || normalizeServiceUrl(window.MAINTENANCE_REMOTE_SERVICE)
    || DEFAULT_REMOTE_SERVICE;
  const legacyService = storedServiceUrl(LEGACY_SERVICE_STORAGE_KEY);
  const initialServer = storedServer()
    || (serviceFromUrl && serviceFromUrl !== localService ? "remote" : "")
    || (legacyService && legacyService !== localService ? "remote" : "local");
  const initialOperation = storedOperation(initialServer) || "update";
  const initialTorrentConcurrency = storedTorrentConcurrency(initialServer);
  const initialService = serviceFromUrl || legacyService || (initialServer === "remote" ? remoteService : localService);
  const SERVER_CONFIG = {
    local: {
      label: "This Mac",
      service: localService,
      description: "Uses the maintenance service running on this Mac.",
    },
    remote: {
      label: "Remote",
      service: remoteService,
      description: "Uses the remote maintenance service.",
    },
  };
  const OPERATION_CONFIG = {
    update: {
      label: "Update current ones",
      description: "Check known sources for missing episodes and better dual-audio releases.",
      hint: "Existing sources only · AniList + release sources",
      startLabel: "Run",
    },
    add: {
      label: "Add new shows",
      description: "Scan the tracker catalog and add playable shows that are not in the library yet.",
      hint: "New shows only · Tracker catalog",
      startLabel: "Run",
    },
  };
  const $ = (id) => document.getElementById(id);
  const state = {
    server: initialServer,
    operation: initialOperation,
    torrentConcurrency: initialTorrentConcurrency,
    runPaused: false,
    serviceUrl: initialService,
    localService,
    remoteService,
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
    catalog: null,
    catalogTimer: null,
  };

  function serverConfig(server = state.server) {
    return SERVER_CONFIG[server] || SERVER_CONFIG.local;
  }

  function operationConfig(operation = state.operation) {
    return OPERATION_CONFIG[operation] || OPERATION_CONFIG.update;
  }

  function serviceForServer(server = state.server) {
    return server === "remote" ? state.remoteService : state.localService;
  }

  function saveStoredValue(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // A blocked storage area should not stop a run in the current tab.
    }
  }

  function renderSelection() {
    const operation = operationConfig();
    document.querySelectorAll("[data-server]").forEach((button) => {
      const selected = button.dataset.server === state.server;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("[data-operation]").forEach((button) => {
      const selected = button.dataset.operation === state.operation;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const description = $("modeDescription");
    if (description) description.textContent = operation.description;
    const start = $("updateStartBtn");
    if (start) start.textContent = operation.startLabel;
    const localInput = $("localServiceUrl");
    if (localInput && document.activeElement !== localInput) localInput.value = state.localService;
    const remoteInput = $("remoteServiceUrl");
    if (remoteInput && document.activeElement !== remoteInput) remoteInput.value = state.remoteService;
    const torrentInput = $("updateTorrentConcurrency");
    if (torrentInput && document.activeElement !== torrentInput) torrentInput.value = String(state.torrentConcurrency);
    renderCatalogStatus();
  }

  function resetIdlePanel() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.pollInFlight = false;
    state.jobId = null;
    state.jobKind = null;
    state.seenEventCount = 0;
    state.seenChildEventCount = 0;
    state.childEventCounts = {};
    state.runPaused = false;
    if ($("jobProgress")) $("jobProgress").value = 0;
    if ($("jobProgressText")) $("jobProgressText").textContent = "No job running.";
    setProgressCount("0/0");
    clearTorrentProgress();
    if ($("automationSummary")) $("automationSummary").textContent = "No automated run started.";
    if ($("jobResult")) $("jobResult").textContent = "";
    if ($("jobLog")) $("jobLog").textContent = "";
    if ($("logState")) $("logState").textContent = "Showing important milestones only; detailed process output stays in the local service log.";
    updateCurrentJob("Idle", "Nothing running", "Choose a mode, then start a check to see progress here.");
  }

  async function selectServer(server) {
    if (!SERVER_CONFIG[server] || server === state.server) return;
    state.server = server;
    state.operation = storedOperation(server) || "update";
    state.torrentConcurrency = storedTorrentConcurrency(server);
    state.serviceUrl = serviceForServer(server);
    saveStoredValue(SERVER_STORAGE_KEY, server);
    resetIdlePanel();
    state.sources = [];
    renderLibrary();
    renderSelection();
    setServiceState("Connecting…");
    await refreshLibrary();
    await refreshCatalogStatus();
    await reconnectToActiveWork();
  }

  function selectOperation(operation) {
    if (!OPERATION_CONFIG[operation] || operation === state.operation) return;
    state.operation = operation;
    saveStoredValue(operationStorageKey(state.server), operation);
    resetIdlePanel();
    renderSelection();
  }

  function saveTorrentConcurrency() {
    const input = $("updateTorrentConcurrency");
    state.torrentConcurrency = normalizeTorrentConcurrency(input?.value);
    saveStoredValue(torrentConcurrencyStorageKey(state.server), String(state.torrentConcurrency));
    renderSelection();
  }

  function saveConnections() {
    const local = normalizeServiceUrl($("localServiceUrl")?.value);
    const remote = normalizeServiceUrl($("remoteServiceUrl")?.value);
    if (!local || !remote) {
      window.alert("Enter a valid http:// or https:// address for both services.");
      return;
    }
    state.localService = local;
    state.remoteService = remote;
    state.serviceUrl = serviceForServer();
    saveStoredValue(LOCAL_SERVICE_STORAGE_KEY, local);
    saveStoredValue(REMOTE_SERVICE_STORAGE_KEY, remote);
    saveStoredValue(LEGACY_SERVICE_STORAGE_KEY, "");
    renderSelection();
    setServiceState("Connecting…");
    void refreshLibrary();
    void refreshCatalogStatus();
  }

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
      ? `${activeLabel}${primary.job.queuePosition > 1 ? ` · queue position ${primary.job.queuePosition}` : ""} · waiting for a transfer slot.`
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
        ? `queue position ${snapshot.job.queuePosition || "?"} · waiting for a transfer slot`
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
    const response = await fetch(`${state.serviceUrl}${path}`, options);
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

  // The service keeps the complete td/ffmpeg event stream for diagnostics, but
  // the activity panel should stay readable. Raw process logs and transfer
  // progress already have dedicated UI, so only show milestones and failures.
  const IMPORTANT_LOG_EVENTS = new Set([
    "run",
    "run_started",
    "run_finished",
    "job_started",
    "job_retry",
    "metadata",
    "link",
    "file_result",
    "error",
    "warning",
    "job_failed",
    "job_complete",
    "job_cancelled",
    "pipeline_fallback",
    "audio_stream_probe_failed",
    "duration_probe_failed",
    "manifest_skipped",
    "publication_failed",
    "catalog_start_failed",
    "service_started",
  ]);
  const IMPORTANT_STATUS_PHASES = new Set([
    "starting",
    "fetching_metadata",
    "overwrite",
    "processing",
    "uploading",
    "finalizing",
    "complete",
  ]);

  function isImportantLogEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    const event = String(entry.event || "").trim().toLowerCase();
    if (!event || event === "log" || event === "progress") return false;
    if (event === "status") return IMPORTANT_STATUS_PHASES.has(String(entry.phase || "").trim().toLowerCase());
    return IMPORTANT_LOG_EVENTS.has(event);
  }

  async function reloadPersistedLog() {
    // Keep the browser payload bounded; the service retains the full stream,
    // while this panel only needs recent milestones and failures.
    const params = new URLSearchParams({ limit: "300" });
    if (state.jobKind === "run" && state.jobId) params.set("runId", state.jobId);
    if (state.jobKind === "job" && state.jobId) params.set("jobId", state.jobId);
    try {
      const data = await request(`/api/maintenance/logs?${params}`);
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const importantEntries = entries.filter(isImportantLogEntry);
      const log = $("jobLog");
      log.textContent = importantEntries.map(formatPersistedLog).join("\n");
      log.scrollTop = log.scrollHeight;
      $("logState").textContent = `${importantEntries.length} important entr${importantEntries.length === 1 ? "y" : "ies"}${entries.length > importantEntries.length ? ` · ${entries.length - importantEntries.length} detailed entr${entries.length - importantEntries.length === 1 ? "y" : "ies"} hidden` : ""}`;
    } catch (error) {
      $("logState").textContent = `Saved log unavailable: ${error.message}`;
    }
  }

  function setServiceState(text, error = false) {
    const element = $("serviceState");
    if (!element) return;
    element.textContent = text;
    element.style.color = error ? "#ff9da5" : "";
    element.title = `${serverConfig().label} · ${state.serviceUrl}`;
  }

  function renderCatalogStatus() {
    const element = $("catalogStatus");
    if (!element) return;
    element.hidden = state.operation !== "add";
    if (state.operation === "update") {
      element.textContent = "Catalog discovery is off in this mode. Existing sources only; AniList checks missing episodes and dual-audio upgrades.";
      return;
    }
    const catalog = state.catalog;
    if (!catalog) {
      element.textContent = "Tracker catalog status is unavailable.";
      return;
    }
    const indexed = Number(catalog.total) || 0;
    const published = Number(catalog.published) || 0;
    const queued = Number(catalog.queued) || 0;
    const upgrades = Number(catalog.upgradeEligible) || 0;
    const upgradeEpisodes = Number(catalog.upgradeEpisodes) || 0;
    const unconfirmedEpisodes = Number(catalog.unconfirmedEpisodes) || 0;
    const unavailable = Number(catalog.unavailable) || 0;
    const scanning = catalog.scanning ? " Scanning releases.moe now." : "";
    const pending = catalog.sourceListPending ? " Source-list publication is pending retry." : "";
    element.textContent = `${indexed} tracker titles indexed · ${published} playable · ${queued} queued · ${upgrades} dual-audio upgrade${upgrades === 1 ? "" : "s"} (${upgradeEpisodes} episode${upgradeEpisodes === 1 ? "" : "s"})${unconfirmedEpisodes ? ` · ${unconfirmedEpisodes} unconfirmed` : ""}${unavailable ? ` · ${unavailable} unavailable` : ""}.${scanning}${pending}`;
  }

  async function refreshCatalogStatus() {
    try {
      state.catalog = await request("/api/catalog/status");
      renderCatalogStatus();
    } catch (error) {
      const element = $("catalogStatus");
      if (element) {
        element.hidden = state.operation !== "add";
        element.textContent = state.operation === "update"
          ? "Catalog discovery is off in this mode. Existing-source checks are still available when the selected server is online."
          : `Tracker catalog unavailable: ${error.message}`;
      }
    }
  }

  function configureMaintenanceBackend() {
    const entered = window.prompt(
      `${serverConfig().label} service URL (without /api).\nLeave blank to use the saved default.`,
      state.serviceUrl,
    );
    if (entered === null) return;
    const value = normalizeServiceUrl(entered);
    if (!value) {
      if (String(entered).trim()) {
        window.alert("Enter a valid http:// or https:// maintenance backend URL.");
        return;
      }
      state.serviceUrl = serviceForServer();
      renderSelection();
      void refreshLibrary();
      void refreshCatalogStatus();
      return;
    }
    if (state.server === "remote") {
      state.remoteService = value;
      saveStoredValue(REMOTE_SERVICE_STORAGE_KEY, value);
    } else {
      state.localService = value;
      saveStoredValue(LOCAL_SERVICE_STORAGE_KEY, value);
    }
    state.serviceUrl = value;
    saveStoredValue(LEGACY_SERVICE_STORAGE_KEY, "");
    renderSelection();
    void refreshLibrary();
    void refreshCatalogStatus();
  }

  function isTypingTarget(target) {
    return target instanceof HTMLElement
      && (target.matches("input, textarea, select, button, [contenteditable='true']") || target.isContentEditable);
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
      if (source.dualAudio) {
        const badge = document.createElement("span");
        badge.className = "dual-audio-badge";
        badge.textContent = "DUAL AUDIO";
        badge.title = "Every episode currently recorded for this source is marked dual audio.";
        title.append(" ", badge);
      } else if (Number(source.unconfirmedAudioCount) > 0) {
        const badge = document.createElement("span");
        badge.className = "dual-audio-badge dual-audio-badge--pending";
        badge.textContent = `${source.unconfirmedAudioCount} AUDIO UPGRADE${source.unconfirmedAudioCount === 1 ? "" : "S"}`;
        badge.title = "Single-audio or unconfirmed episodes will be promoted when a dual-audio release is found.";
        title.append(" ", badge);
      }
      const meta = document.createElement("div");
      meta.className = "library-meta";
      const categoryText = (source.categories || []).map((category) => `${category.category}: ${category.episodeCount}`).join(" · ") || "No categories";
      meta.textContent = `${categoryText} · ${formatDate(source.latestTime)}${source.hidden ? " · hidden" : ""}`;
      details.append(title, meta);
      const button = document.createElement("button");
      button.className = "button button-secondary";
      button.type = "button";
      button.textContent = "Check this show";
      button.title = `Search, process, and update ${source.title}`;
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
      setServiceState(`${serverConfig().label} · ${state.sources.length} shows`);
      await refreshCatalogStatus();
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

  function setJobBusy(busy, allowRunSettings = false) {
    const editableWhilePaused = new Set([
      "updateTorrentConcurrency",
      "updateReplace",
      "updateAdd",
      "updateAllCategories",
    ]);
    document.querySelectorAll("#maintenanceWorkspace button, #maintenanceWorkspace input, #maintenanceWorkspace select").forEach((element) => {
      if (["cancelJobBtn", "refreshLogBtn", "pauseJobBtn"].includes(element.id)) return;
      if (allowRunSettings && editableWhilePaused.has(element.id)) {
        element.disabled = false;
        return;
      }
      element.disabled = busy;
    });
    $("cancelJobBtn").hidden = !busy;
    const pauseButton = $("pauseJobBtn");
    if (pauseButton) {
      pauseButton.hidden = !busy || state.jobKind !== "run" || !state.jobId;
      pauseButton.disabled = false;
    }
  }

  function updateRunPauseButton(run) {
    const button = $("pauseJobBtn");
    if (!button) return;
    const stateName = String(run?.state || "");
    const isRun = state.jobKind === "run" && Boolean(state.jobId);
    button.hidden = !isRun || ["complete", "complete_with_errors", "failed", "cancelled"].includes(stateName);
    if (!isRun) return;
    if (stateName === "pausing") {
      button.textContent = "Pausing…";
      button.disabled = true;
    } else if (stateName === "paused" && run?.pauseDraining) {
      button.textContent = "Finishing…";
      button.disabled = true;
    } else if (stateName === "paused") {
      button.textContent = "Resume";
      button.disabled = false;
    } else {
      button.textContent = "Pause";
      button.disabled = false;
    }
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
    updateCurrentJob("Starting", "Preparing maintenance", `Waiting for the ${operationConfig().label.toLowerCase()} service to create a run.`);
  }

  function handleEvents(job) {
    const events = Array.isArray(job.events) ? job.events : [];
    for (const event of events.slice(state.seenEventCount)) {
      const message = event.message || event.phase || event.event;
      if (message && (event.event === "progress" || isImportantLogEntry(event))) $("jobProgressText").textContent = message;
      if (event.event === "progress" && event.totalBytes) {
        $("jobProgress").value = Math.min(1, event.transferredBytes / event.totalBytes);
        setProgressCount(`${formatBytes(event.transferredBytes)} / ${formatBytes(event.totalBytes)}`);
      }
      if (message && isImportantLogEntry(event)) appendLog(event.event === "link" && event.url
        ? `${event.remotePath || "file"} → ${event.url}`
        : message);
      if (message && isImportantLogEntry(event)) updateCurrentJob(job.state === "running" ? "Working" : job.state, "Direct new-show job", message);
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
      } else if (message && isImportantLogEntry(event)) {
        appendLog(message);
      }
    }
    state.childEventCounts[job.id] = events.length;
  }

  function renderRunProgress(run, childJobs = []) {
    updateRunPauseButton(run);
    if (run.state === "checking") {
      clearTorrentProgress("AniList preflight in progress — no torrent transfer yet.");
      const checked = Number(run.preflightCompleted) || 0;
      const checkTotal = Number(run.preflightTotal) || 0;
      $("jobProgress").value = checkTotal ? Math.min(1, checked / checkTotal) : 0;
      setProgressCount(`${checked}/${checkTotal || "?"}`);
      const current = run.preflightCurrent || {};
      const latest = run.events?.at(-1)?.message || "Looking up episode counts…";
      updateCurrentJob("Checking AniList", current.title || "Scanning the library", current.category ? `${current.category} · ${latest}` : latest);
      $("jobProgressText").textContent = "Checking AniList for missing episodes…";
      $("automationSummary").textContent = `${operationConfig().label} is checking AniList before searching release sources.`;
      return;
    }
    if (["pausing", "paused"].includes(run.state)) {
      if ($("advancedRunOptions")) $("advancedRunOptions").open = true;
      renderTorrentProgress(childJobs, run);
      const completed = Number(run.completed) || 0;
      const total = Number(run.total) || 0;
      const pausing = run.state === "pausing" || run.pauseDraining === true;
      const message = pausing
        ? "Current transfer work is finishing before the run pauses."
        : "Run paused. Change the maintenance settings above, then resume.";
      updateCurrentJob(pausing ? "Pausing" : "Paused", "Automatic maintenance", message);
      $("jobProgressText").textContent = pausing ? "Finishing current transfer work…" : "Paused — ready to resume.";
      $("automationSummary").textContent = `${operationConfig().label} ${pausing ? "pausing" : "paused"}: ${completed}/${total} categories finished.`;
      setProgressCount(`${completed}/${total}`);
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
      const childEvents = Array.isArray(childJob?.events) ? childJob.events : [];
      const childEvent = [...childEvents].reverse().find(isImportantLogEntry);
      const queuedChild = childJobs.find((job) => job?.state === "queued");
      const childMessage = childQueued
        ? `Waiting for the current torrent job${queuedChild?.queuePosition > 1 ? ` (queue position ${queuedChild.queuePosition})` : ""}`
        : childEvent?.message || childEvent?.phase || childEvent?.event || "";
      const provider = current.provider ? ` · via ${current.provider}` : "";
      const detail = `${childMessage || `${current.category}${current.missingEpisodes?.length ? ` · downloading episodes ${formatEpisodeList(current.missingEpisodes)}` : ""}`}${provider}`;
      updateCurrentJob(label, current.title, detail);
      $("jobProgressText").textContent = `${label}: ${current.title} · ${current.category}`;
      $("automationSummary").textContent = `${operationConfig().label} in progress: ${completed} of ${total} categories finished${activeSuffix}.`;
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
    $("automationSummary").textContent = `${operationConfig().label} finished: ${updated} updated, ${failed} failed, ${skipped} skipped${cancelled ? `, ${cancelled} cancelled` : ""}.`;
    $("jobResult").textContent = $("automationSummary").textContent;
    setProgressCount(`${run.completed || 0}/${run.total || 0}`);
    updateCurrentJob(run.state === "complete" ? "Complete" : run.state, "Automatic maintenance", $("automationSummary").textContent);
    for (const error of errors) appendLog(error);
  }

  function currentRunSettings() {
    const torrentConcurrency = normalizeTorrentConcurrency($("updateTorrentConcurrency")?.value || state.torrentConcurrency);
    state.torrentConcurrency = torrentConcurrency;
    saveStoredValue(torrentConcurrencyStorageKey(state.server), String(torrentConcurrency));
    const checked = (id, fallback) => {
      const input = $(id);
      return input ? Boolean(input.checked) : fallback;
    };
    return {
      torrentConcurrency,
      replaceExisting: checked("updateReplace", true),
      addMissing: checked("updateAdd", true),
      allCategories: checked("updateAllCategories", false),
    };
  }

  async function toggleRunPause() {
    if (!state.jobId || state.jobKind !== "run") return;
    const button = $("pauseJobBtn");
    if (button) button.disabled = true;
    const action = state.runPaused ? "resume" : "pause";
    const options = { method: "POST" };
    if (action === "resume") {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(currentRunSettings());
    }
    let succeeded = false;
    try {
      await request(`/api/maintenance/runs/${encodeURIComponent(state.jobId)}/${action}`, options);
      await pollJob();
      succeeded = true;
    } finally {
      if (!succeeded && button && !button.hidden) button.disabled = false;
    }
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
        state.runPaused = job.state === "paused";
        setJobBusy(true, job.state === "paused");
        renderRunProgress(job, childJobs.filter(Boolean));
        const done = ["complete", "complete_with_errors", "failed", "cancelled"].includes(job.state);
        if (done) {
          clearInterval(state.pollTimer);
          state.runPaused = false;
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
    const singleSource = sourcePaths.length > 0;
    const addNewShows = state.operation === "add" && !singleSource;
    const torrentConcurrency = normalizeTorrentConcurrency($("updateTorrentConcurrency")?.value || state.torrentConcurrency);
    state.torrentConcurrency = torrentConcurrency;
    saveStoredValue(torrentConcurrencyStorageKey(state.server), String(torrentConcurrency));
    state.jobId = null;
    state.jobKind = "run";
    state.runPaused = false;
    setJobBusy(true);
    resetJobPanel();
    $("automationSummary").textContent = `Queuing ${singleSource ? title : operationConfig().label.toLowerCase()}…`;
    const run = await request("/api/maintenance/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourcePaths,
        operation: singleSource ? "update" : state.operation,
        discoverCatalog: addNewShows,
        catalogScan: addNewShows,
        catalogOnly: addNewShows,
        newShowsOnly: addNewShows,
        anilistCheck: !addNewShows,
        replaceExisting: $("updateReplace")?.checked ?? true,
        addMissing: $("updateAdd")?.checked ?? true,
        addNewSeasons: false,
        allCategories: $("updateAllCategories")?.checked ?? false,
        concurrency: 1,
        torrentConcurrency,
      }),
    });
    state.jobId = run.id;
    state.jobKind = "run";
    setJobBusy(true);
    appendLog(`Started ${singleSource ? `single-show update for ${title}` : operationConfig().label.toLowerCase()} run ${run.id}`);
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
    state.jobId = null;
    state.jobKind = "job";
    state.runPaused = false;
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

  document.querySelectorAll("[data-server]").forEach((button) => {
    button.addEventListener("click", () => {
      void selectServer(button.dataset.server).catch((error) => {
        appendLog(`Server switch failed: ${error.message}`);
      });
    });
  });
  document.querySelectorAll("[data-operation]").forEach((button) => {
    button.addEventListener("click", () => selectOperation(button.dataset.operation));
  });
  $("saveConnectionBtn")?.addEventListener("click", saveConnections);
  $("updateTorrentConcurrency")?.addEventListener("change", saveTorrentConcurrency);
  $("maintenanceTab")?.addEventListener("click", () => setTab("maintenance"));
  $("addTab")?.addEventListener("click", () => setTab("add"));
  $("refreshLibraryBtn")?.addEventListener("click", () => { void refreshLibrary(); });
  $("refreshLogBtn")?.addEventListener("click", () => { void reloadPersistedLog(); });
  $("libraryFilter")?.addEventListener("input", renderLibrary);
  $("updateStartBtn")?.addEventListener("click", () => startAutomatedMaintenance().catch((error) => { setJobBusy(false); appendLog(`Start failed: ${error.message}`); }));
  $("pauseJobBtn")?.addEventListener("click", () => toggleRunPause().catch((error) => appendLog(`Pause/resume failed: ${error.message}`)));
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

  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "d") return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    configureMaintenanceBackend();
  });

  renderSelection();
  void refreshLibrary();
  void refreshCatalogStatus();
  state.catalogTimer = window.setInterval(() => { void refreshCatalogStatus(); }, 10000);
  void reconnectToActiveWork();
})();
