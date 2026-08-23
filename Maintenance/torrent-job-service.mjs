#!/usr/bin/env node
// Local service for the Maintenance UI. Browser code cannot safely run
// libtorrent or spawn ffmpeg, so this service owns SeaDex release lookup, the
// td pipeline, and the optional source-manifest maintenance step.
// Run from the repository with: node Maintenance/torrent-job-service.mjs

import { createServer } from "node:http";
import { appendFile, chmod, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CREATOR_TORRENT_PORT || process.env.MAINTENANCE_PORT || 6968);
const HOST = String(process.env.CREATOR_TORRENT_HOST || process.env.MAINTENANCE_HOST || "0.0.0.0").trim() || "0.0.0.0";
const SERVICE_PROTOCOL_VERSION = "maintenance-v6";
const TD_BIN = process.env.TD_BIN || join(homedir(), ".deno/bin/td");
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const BROWSER_COMPATIBILITY_ENABLED = process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY !== "0";
const TOODRIVE_BASE_URL = process.env.TOODRIVE_BASE_URL || "https://toodrive.xpbliss.fyi";
const TOODRIVE_PUBLIC_BASE_URL = String(process.env.TOODRIVE_PUBLIC_BASE_URL || "https://toodrive.xpbliss.fyi").replace(/\/$/, "");
const TOODRIVE_USERNAME = String(
  process.env.MEDIA_MANAGER_TOODRIVE_USERNAME || process.env.TOODRIVE_USERNAME || "",
).trim();
const TOODRIVE_PASSWORD = String(
  process.env.MEDIA_MANAGER_TOODRIVE_PASSWORD || process.env.TOODRIVE_PASSWORD || "",
);
const TOODRIVE_KEYCHAIN_SERVICE = String(
  process.env.MEDIA_MANAGER_TOODRIVE_KEYCHAIN_SERVICE || "media-manager-toodrive",
).trim();
const TOODRIVE_AUTO_LOGIN = process.env.MEDIA_MANAGER_TOODRIVE_AUTO_LOGIN !== "0";
const TOODRIVE_CONFIG_DIR = resolve(process.env.TOODRIVE_CONFIG_DIR || join(homedir(), ".config/toodrive"));
const TOODRIVE_CONFIG_FILE = join(TOODRIVE_CONFIG_DIR, "config.json");
const TOODRIVE_SESSION_FILE = join(TOODRIVE_CONFIG_DIR, "session.json");
const LEGACY_TOODRIVE_HOSTS = new Set([
  "localhost:16169",
  "127.0.0.1:16169",
  "0.0.0.0:16169",
  "[::1]:16169",
]);
const RELEASES_BASE_URL = String(process.env.RELEASES_BASE_URL || "https://releases.moe").replace(/\/$/, "");
const RELEASES_API_URL = `${RELEASES_BASE_URL}/api/collections/entries/records`;
const ANILIST_API_URL = String(process.env.ANILIST_API_URL || "https://graphql.anilist.co").replace(/\/$/, "");
const NYAA_BASE_URLS = [
  process.env.NYAA_BASE_URL || "https://nyaa.si",
  process.env.NYAA_FALLBACK_URL || "https://nyaa.net",
].filter((base, index, all) => base && all.indexOf(base) === index)
  .map((base) => String(base).replace(/\/$/, ""));
const SERVICE_DIR = dirname(fileURLToPath(import.meta.url));
const BROWSER_COMPATIBILITY_SCRIPT = resolve(process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY_SCRIPT || join(SERVICE_DIR, "browser-compatible-reencode.sh"));
const REPO_ROOT = resolve(process.env.MEDIA_MANAGER_ROOT || join(SERVICE_DIR, ".."));
const SOURCE_DIR = resolve(REPO_ROOT, "Sources/Files/Anime");
const SOURCE_PREFIX = "Sources/Files/Anime/";
const SOURCE_LIST_FILE = resolve(REPO_ROOT, "Sources/AnimeSourceList.json");
const SOURCE_LIST_PATH = "Sources/AnimeSourceList.json";
const GITHUB_API_BASE_URL = String(process.env.MEDIA_MANAGER_GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const GITHUB_REPOSITORY = String(
  process.env.MEDIA_MANAGER_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || "RandomSideProjects/Media-Manager",
).trim();
const GITHUB_BRANCH = String(process.env.MEDIA_MANAGER_GITHUB_BRANCH || process.env.GITHUB_BRANCH || "main").trim() || "main";
const GITHUB_TOKEN = String(
  process.env.MEDIA_MANAGER_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
).trim();
const GITHUB_PUBLISH_ENABLED = process.env.MEDIA_MANAGER_GITHUB_PUBLISH !== "0";
const GITHUB_TEST_PUBLISH = process.env.MEDIA_MANAGER_TEST_GITHUB === "1";
const DEFAULT_CACHE = join(homedir(), ".local/share/toodrive-job/creator-cache");
const LOG_FILE = resolve(process.env.MEDIA_MANAGER_LOG_FILE || join(homedir(), ".local/share/media-manager-maintenance/maintenance.log"));
const RESUME_FILE = resolve(process.env.MEDIA_MANAGER_RESUME_FILE || join(homedir(), ".local/share/media-manager-maintenance/resume-state.json"));
const CANCELLED_RUNS_FILE = resolve(process.env.MEDIA_MANAGER_CANCELLED_RUNS_FILE || join(dirname(RESUME_FILE), "cancelled-runs.json"));
const CATALOG_STATE_FILE = resolve(process.env.MEDIA_MANAGER_CATALOG_STATE_FILE || join(homedir(), ".local/share/media-manager-maintenance/catalog-state.json"));
const CATALOG_STATE_VERSION = 1;
const MAINTENANCE_ROLE = String(process.env.MEDIA_MANAGER_MAINTENANCE_ROLE || "all").trim().toLowerCase() === "general"
  ? "general"
  : "all";
const CATALOG_PAGE_SIZE = Math.min(500, Math.max(50, Number(process.env.MEDIA_MANAGER_CATALOG_PAGE_SIZE) || 500));
const CATALOG_ANILIST_BATCH_SIZE = Math.min(50, Math.max(1, Number(process.env.MEDIA_MANAGER_CATALOG_ANILIST_BATCH_SIZE) || 50));
const CATALOG_ANILIST_INTERVAL_MS = Math.max(0, Number(process.env.MEDIA_MANAGER_CATALOG_ANILIST_INTERVAL_MS) || 2_200);
const CATALOG_SCAN_ENABLED = process.env.MEDIA_MANAGER_CATALOG_SCAN !== "0";
// General maintenance uses AniList's public GraphQL API as its preflight
// check. AniList exposes the aired schedule and next episode directly, so a
// releasing season can be checked without scraping a second site. The cache
// and request gate keep recurring runs below AniList's public rate limit.
const ANILIST_CACHE_FILE = resolve(process.env.ANILIST_CACHE_FILE || join(homedir(), ".local/share/media-manager-maintenance/anilist-cache.json"));
const ANILIST_CACHE_TTL_MS = Math.max(60_000, Number(process.env.ANILIST_CACHE_TTL_MS) || 30 * 60_000);
const ANILIST_ERROR_CACHE_TTL_MS = Math.max(15_000, Number(process.env.ANILIST_ERROR_CACHE_TTL_MS) || 2 * 60_000);
const ANILIST_REQUEST_TIMEOUT_MS = Math.max(2_000, Number(process.env.ANILIST_REQUEST_TIMEOUT_MS) || 12_000);
const ANILIST_REQUEST_INTERVAL_MS = Math.max(0, Number(process.env.ANILIST_REQUEST_INTERVAL_MS) || 700);
const ANILIST_CACHE_VERSION = 1;
const LOG_PROGRESS_INTERVAL_MS = 30_000;
const LEGACY_RECOVERY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const LEGACY_RECOVERY_LOG_BYTES = 16 * 1024 * 1024;
// Failure notifications are deliberately opt-in. Keep the endpoint in the
// service environment (never in the repository or the UI) and leave the
// maintenance worker fully functional when it is not configured.
const FAILURE_WEBHOOK_URL = String(
  process.env.MEDIA_MANAGER_WEBHOOK_URL
    || process.env.MEDIA_MANAGER_FAILURE_WEBHOOK_URL
    || process.env.MAINTENANCE_FAILURE_WEBHOOK_URL
    || process.env.MEDIA_MANAGER_DISCORD_WEBHOOK_URL
    || "",
).trim();
const FAILURE_WEBHOOK_ENABLED = Boolean(FAILURE_WEBHOOK_URL) && process.env.MEDIA_MANAGER_FAILURE_WEBHOOK !== "0";
const FAILURE_WEBHOOK_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.MEDIA_MANAGER_FAILURE_WEBHOOK_TIMEOUT_MS) || 10_000,
);
// The activity endpoint only needs recent milestones. Reading the entire
// lifetime JSONL file can exceed V8's maximum string length before the caller's
// entry limit is applied.
const LOG_READ_BYTES = 8 * 1024 * 1024;
// Keep the persisted activity log useful and bounded by default. The live job
// object still retains its recent events for progress/debugging, while raw
// ffmpeg/libav lines stay out of the long-lived JSONL file and the frontend.
// Set MEDIA_MANAGER_PERSIST_VERBOSE_LOGS=1 only when a full process trace is
// needed for a targeted diagnosis.
const PERSIST_VERBOSE_PROCESS_LOGS = process.env.MEDIA_MANAGER_PERSIST_VERBOSE_LOGS === "1";
const IMPORTANT_PERSISTED_STATUS_PHASES = new Set([
  "starting",
  "fetching_metadata",
  "overwrite",
  "processing",
  "uploading",
  "finalizing",
  "complete",
]);
const DEFAULT_TD_REPAIR_ATTEMPTS = 20;
const MAINTENANCE_TD_REPAIR_ATTEMPTS = 3;
// A Toodrive session can expire during a long maintenance run even when the
// preflight check succeeded. Retry the same cached torrent after refreshing
// the session, but cap it so a genuinely broken credential does not loop
// forever or hold a transfer slot indefinitely.
const MAX_TOODRIVE_AUTH_RETRIES = Math.max(
  0,
  Math.min(5, Number(process.env.MEDIA_MANAGER_TOODRIVE_AUTH_RETRIES) || 2),
);
// td already retries individual upload chunks, but a whole pipeline can still
// exit after a transient Toodrive/Cloudflare failure (notably HTTP 530). A
// bounded service-level retry resumes the same cache instead of marking the
// episode dead after the CLI's internal attempts are exhausted.
const MAX_TD_TRANSIENT_RETRIES = Math.max(
  0,
  Math.min(5, Number(process.env.MEDIA_MANAGER_TD_TRANSIENT_RETRIES) || 3),
);
const TD_TRANSIENT_RETRY_BASE_MS = Math.max(
  1_000,
  Number(process.env.MEDIA_MANAGER_TD_TRANSIENT_RETRY_DELAY_MS) || 10_000,
);
// A torrent with peers but no byte movement is allowed to warm up briefly;
// after this window, stop the child and let the normal retry/research path
// choose another release instead of occupying a transfer slot forever.
const TORRENT_STALL_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MEDIA_MANAGER_TORRENT_STALL_TIMEOUT_MS) || 5 * 60_000,
);
const TORRENT_STALL_CHECK_INTERVAL_MS = Math.min(30_000, Math.max(5_000, Math.floor(TORRENT_STALL_TIMEOUT_MS / 6)));
const DEFAULT_MAINTENANCE_CONCURRENCY = 1;
const MAX_MAINTENANCE_CONCURRENCY = 1;
// Keep the default conservative while allowing the UI to raise the number of
// independent td processes when the machine has enough resources. Each process
// still owns one transfer; this is job-level concurrency, not parallel chunks.
const DEFAULT_TORRENT_CONCURRENCY = 2;
const MAX_TORRENT_CONCURRENCY = 20;
const MEDIA_PROBE_TIMEOUT_MS = Math.max(5_000, Number(process.env.MEDIA_PROBE_TIMEOUT_MS) || 45_000);
const jobs = new Map();
const maintenanceRuns = new Map();
const maintenanceManifestQueues = new Map();
const pipelineQueue = [];
let activePipelineJob = null;
const activePipelineJobs = new Set();
const logProgressAt = new Map();
let logQueue = Promise.resolve();
let aniListCache = null;
let aniListCacheLoad = null;
let aniListCacheWrite = Promise.resolve();
let aniListRequestQueue = Promise.resolve();
let aniListLastRequestAt = 0;
let resumeWriteQueue = Promise.resolve();
let cancelledRunsWriteQueue = Promise.resolve();
let cancelledRunIds = new Set();
let catalogState = null;
let catalogStateLoad = null;
let catalogWriteQueue = Promise.resolve();
let catalogScanPromise = null;
let catalogRunId = null;
let catalogAniListLastRequestAt = 0;
let failureWebhookQueue = Promise.resolve();

function emptyCatalogState() {
  return {
    version: CATALOG_STATE_VERSION,
    updatedAt: null,
    lastScanAt: null,
    lastScanError: "",
    lastError: "",
    sourceListPending: false,
    scanning: false,
    entries: {},
  };
}

async function loadCatalogState() {
  if (catalogState) return catalogState;
  if (catalogStateLoad) return catalogStateLoad;
  catalogStateLoad = readFile(CATALOG_STATE_FILE, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || parsed.version !== CATALOG_STATE_VERSION) {
        catalogState = emptyCatalogState();
      } else {
        catalogState = {
          ...emptyCatalogState(),
          ...parsed,
          entries: parsed.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries) ? parsed.entries : {},
        };
      }
      return catalogState;
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") console.error(`[catalog-state] ${error instanceof Error ? error.message : String(error)}`);
      catalogState = emptyCatalogState();
      return catalogState;
    });
  return catalogStateLoad;
}

function persistCatalogState() {
  const state = catalogState || emptyCatalogState();
  const snapshot = JSON.stringify({
    ...state,
    version: CATALOG_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    scanning: Boolean(state.scanning),
  }, null, 2) + "\n";
  const temporary = `${CATALOG_STATE_FILE}.${process.pid}.tmp`;
  catalogWriteQueue = catalogWriteQueue.then(async () => {
    await mkdir(dirname(CATALOG_STATE_FILE), { recursive: true });
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, CATALOG_STATE_FILE);
  }).catch((error) => {
    console.error(`[catalog-state] ${error instanceof Error ? error.message : String(error)}`);
  });
  return catalogWriteQueue;
}

function catalogKey(alID) {
  const id = Number(alID);
  return Number.isInteger(id) && id > 0 ? `al:${id}` : "";
}

function resumableRun(run) {
  return {
    id: run.id,
    operation: String(run.payload?.operation || "update"),
    state: run.state,
    phase: run.phase,
    total: run.total,
    completed: run.completed,
    failed: run.failed,
    skipped: run.skipped,
    preflightCompleted: run.preflightCompleted,
    preflightTotal: run.preflightTotal,
    preflightCurrent: run.preflightCurrent,
    current: run.current,
    currentJobId: run.currentJobId,
    active: run.active || [],
    activeJobIds: run.activeJobIds || [],
    concurrency: run.concurrency || maintenanceConcurrency(run.payload || {}),
    torrentConcurrency: run.torrentConcurrency || torrentConcurrency(run.payload || {}),
    items: run.items,
    events: run.events,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    paused: run.paused === true,
    pauseRequested: run.pauseRequested === true,
    pauseDraining: run.pauseDraining === true,
    cancelled: run.cancelled === true,
    planOnly: run.planOnly === true,
    payload: run.payload || {},
  };
}

function resumableJob(job) {
  return {
    id: job.id,
    runId: job.runId,
    state: job.state,
    pid: job.pid,
    source: job.source,
    destination: job.destination,
    maintenance: job.maintenance,
    cacheDir: job.cacheDir,
    cleanup: job.cleanup || null,
    adaptiveFallback: job.adaptiveFallback === true,
    fallbackAttempted: job.fallbackAttempted === true,
    metadataSeen: job.metadataSeen === true,
    hasTransferProgress: job.hasTransferProgress === true,
    stopRequested: job.stopRequested === true,
    cancelled: job.cancelled === true,
    attempt: job.attempt || 0,
    downloadAll: job.downloadAll !== false,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    exitCode: job.exitCode ?? null,
  };
}

function persistResumeState() {
  const activeRuns = [...maintenanceRuns.values()]
    .filter((run) => !run.finishedAt && !["complete", "failed", "cancelled"].includes(run.state));
  const activeRunIds = new Set(activeRuns.map((run) => run.id));
  const referencedJobIds = new Set(activeRuns.flatMap((run) => [
    run.currentJobId,
    ...(run.activeJobIds || []),
    ...(run.items || []).flatMap((item) => [
      item.jobId,
      ...(Array.isArray(item.jobIds) ? item.jobIds : []),
      ...(Array.isArray(item.releaseStates) ? item.releaseStates.map((release) => release?.jobId) : []),
    ]),
  ].filter(Boolean)));
  const activeJobs = [...jobs.values()]
    .filter((job) => job.maintenance && (activeRunIds.has(job.runId) || !job.finishedAt || referencedJobIds.has(job.id)));
  const snapshot = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: activeRuns.map(resumableRun),
    jobs: activeJobs.map(resumableJob),
  }, null, 2) + "\n";
  const temporary = `${RESUME_FILE}.${process.pid}.tmp`;
  resumeWriteQueue = resumeWriteQueue.then(async () => {
    await mkdir(dirname(RESUME_FILE), { recursive: true });
    await writeFile(temporary, snapshot, "utf8");
    await rename(temporary, RESUME_FILE);
  }).catch((error) => {
    console.error(`[maintenance-resume] ${error instanceof Error ? error.message : String(error)}`);
  });
  return resumeWriteQueue;
}

async function loadCancelledRunIds() {
  try {
    const parsed = JSON.parse(await readFile(CANCELLED_RUNS_FILE, "utf8"));
    cancelledRunIds = new Set(Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : []);
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`[maintenance-cancelled-runs] ${error instanceof Error ? error.message : String(error)}`);
    cancelledRunIds = new Set();
  }
}

function rememberCancelledRun(runId) {
  const id = String(runId || "").trim();
  if (!id) return cancelledRunsWriteQueue;
  cancelledRunIds.add(id);
  const snapshot = JSON.stringify([...cancelledRunIds].slice(-1000), null, 2) + "\n";
  cancelledRunsWriteQueue = cancelledRunsWriteQueue.then(async () => {
    await mkdir(dirname(CANCELLED_RUNS_FILE), { recursive: true });
    await writeFile(CANCELLED_RUNS_FILE, snapshot, "utf8");
  }).catch((error) => {
    console.error(`[maintenance-cancelled-runs] ${error instanceof Error ? error.message : String(error)}`);
  });
  return cancelledRunsWriteQueue;
}

function persistLog(entry) {
  if (!PERSIST_VERBOSE_PROCESS_LOGS) {
    const event = String(entry?.event || "").trim().toLowerCase();
    if (event === "log") return;
    if (event === "status" && !IMPORTANT_PERSISTED_STATUS_PHASES.has(String(entry?.phase || "").trim().toLowerCase())) return;
  }
  const timestamp = Date.parse(entry.at || "") || Date.now();
  if (entry.event === "progress") {
    const key = `${entry.jobId || entry.runId || "service"}:${entry.remotePath || ""}:${entry.phase || ""}`;
    const previous = logProgressAt.get(key) || 0;
    if (timestamp - previous < LOG_PROGRESS_INTERVAL_MS) return;
    logProgressAt.set(key, timestamp);
  }
  const line = `${JSON.stringify({ at: new Date(timestamp).toISOString(), ...entry })}\n`;
  logQueue = logQueue.then(async () => {
    try {
      await mkdir(dirname(LOG_FILE), { recursive: true });
      await appendFile(LOG_FILE, line, "utf8");
    } catch (error) {
      console.error(`[maintenance-log] ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function webhookText(value, limit = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function failureWebhookContent(payload = {}) {
  const title = webhookText(payload.title || payload.name || "Maintenance task", 240);
  const category = webhookText(payload.category || payload.categoryName, 160);
  const message = webhookText(payload.message || payload.error || "Unknown failure", 900);
  const lines = ["🚨 Media Manager maintenance failure", `Task: ${title}${category ? ` · ${category}` : ""}`];
  if (payload.scope) lines.push(`Scope: ${webhookText(payload.scope, 80)}`);
  if (payload.runId) lines.push(`Run: ${webhookText(payload.runId, 100)}`);
  if (payload.jobId) lines.push(`Job: ${webhookText(payload.jobId, 100)}`);
  if (payload.provider) lines.push(`Source: ${webhookText(payload.provider, 120)}`);
  if (Number.isFinite(Number(payload.failed)) && Number.isFinite(Number(payload.total))) {
    lines.push(`Run failures: ${Number(payload.failed)} / ${Number(payload.total)}`);
  }
  lines.push(`Error: ${message}`);
  // Discord-compatible webhooks cap content at 2,000 characters. Keeping a
  // little room below that limit also makes the payload usable by other
  // webhook receivers that impose a smaller text limit.
  return lines.join("\n").slice(0, 1_900);
}

async function sendFailureWebhook(payload = {}) {
  if (!FAILURE_WEBHOOK_ENABLED) return { enabled: false, skipped: "not_configured" };
  const content = failureWebhookContent(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAILURE_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(FAILURE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Media-Manager-Maintenance/1.0",
      },
      // `content` is accepted by Discord and keeps the integration useful for
      // generic JSON receivers without exposing the webhook URL in the body.
      body: JSON.stringify({ content, username: "Media Manager Maintenance" }),
      signal: controller.signal,
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      const detail = webhookText(responseText, 180);
      throw new Error(`webhook returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    persistLog({
      scope: "service",
      event: "failure_webhook_sent",
      status: response.status,
      title: webhookText(payload.title || payload.name || "Maintenance task", 240),
      runId: payload.runId || undefined,
      jobId: payload.jobId || undefined,
    });
    return { enabled: true, sent: true, status: response.status };
  } catch (error) {
    // A notification outage must never stop or change the maintenance job
    // that caused it. Persist only the safe error summary; never log the URL.
    persistLog({
      scope: "service",
      event: "failure_webhook_failed",
      message: webhookText(error?.name === "AbortError" ? "webhook request timed out" : error?.message || error, 300),
    });
    return { enabled: true, sent: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function queueFailureWebhook(payload = {}) {
  if (!FAILURE_WEBHOOK_ENABLED) return Promise.resolve({ enabled: false, skipped: "not_configured" });
  const next = failureWebhookQueue.then(() => sendFailureWebhook(payload));
  failureWebhookQueue = next.catch(() => {});
  return next;
}

async function readPersistedLogs({ runId = "", jobId = "", limit = 500 } = {}) {
  await logQueue;
  let raw;
  let handle;
  try {
    handle = await open(LOG_FILE, "r");
    const { size } = await handle.stat();
    const start = Math.max(0, Number(size) - LOG_READ_BYTES);
    const buffer = Buffer.alloc(Math.max(0, Number(size) - start));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    raw = buffer.subarray(0, bytesRead).toString("utf8");
    // The first line in a bounded tail may be partial; discard it.
    if (start > 0) {
      const firstNewline = raw.indexOf("\n");
      raw = firstNewline >= 0 ? raw.slice(firstNewline + 1) : "";
    }
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
  const max = Math.min(2_000, Math.max(1, Number(limit) || 500));
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { at: "", event: "log", message: line }; }
  }).filter((entry) => (!runId || entry.runId === runId) && (!jobId || entry.jobId === jobId)).slice(-max);
}

async function clearStalePipelineLock(cachePath) {
  const lockPath = join(cachePath, ".td-pipeline.lock");
  let lockPid;
  try {
    lockPid = Number((await readFile(lockPath, "utf8")).trim());
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (lockPid > 0) {
    try {
      process.kill(lockPid, 0);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") return;
    }
  }
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function githubConfiguration() {
  return {
    enabled: GITHUB_PUBLISH_ENABLED,
    configured: Boolean(GITHUB_TOKEN),
    repository: GITHUB_REPOSITORY,
    branch: GITHUB_BRANCH,
    apiBaseUrl: GITHUB_API_BASE_URL,
  };
}

function githubRepositoryParts() {
  const match = GITHUB_REPOSITORY.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("GitHub repository must be in owner/name form");
  return { owner: match[1], name: match[2] };
}

function githubManifestPath(sourcePath) {
  // Reuse the source-path validation so the Contents API cannot be pointed at
  // an arbitrary file outside the anime manifest directory.
  return sourceFileFromInput(sourcePath).path;
}

function githubContentsUrl(sourcePath) {
  const path = githubManifestPath(sourcePath);
  return githubContentsUrlForPath(path);
}

function githubContentsUrlForPath(path) {
  const normalized = String(path || "").replace(/^\.\//, "");
  if (!normalized || normalized.includes("..") || !normalized.startsWith("Sources/") || normalized.includes("\\")) {
    throw new Error("GitHub content path must stay inside Sources");
  }
  const { owner, name } = githubRepositoryParts();
  const encodedPath = normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}`;
}

function githubRequestHeaders() {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${GITHUB_TOKEN}`,
    "content-type": "application/json",
    "user-agent": "Media-Manager-Maintenance/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubRequest(method, url, body = undefined) {
  const response = await fetch(url, {
    method,
    headers: githubRequestHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const message = String(data?.message || raw || "request failed").replace(/[\r\n]+/g, " ").slice(0, 240);
    const error = new Error(`GitHub ${method} returned HTTP ${response.status}: ${message}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function githubManifestSha(sourcePath) {
  const url = new URL(githubContentsUrl(sourcePath));
  url.searchParams.set("ref", GITHUB_BRANCH);
  try {
    const body = await githubRequest("GET", url);
    return String(body?.sha || "") || null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function githubFileSha(path) {
  const url = new URL(githubContentsUrlForPath(path));
  url.searchParams.set("ref", GITHUB_BRANCH);
  try {
    const body = await githubRequest("GET", url);
    return String(body?.sha || "") || null;
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

function githubCommitMessage(sourcePath, metadata = {}) {
  const label = [metadata.title, metadata.category].filter(Boolean).join(" · ") || sourcePath;
  return `maintenance: update ${String(label).replace(/[\r\n]+/g, " ").slice(0, 180)}`;
}

async function publishSourceToGithub(sourcePath, content, metadata = {}) {
  const path = githubManifestPath(sourcePath);
  const base = {
    provider: "github",
    repository: GITHUB_REPOSITORY,
    branch: GITHUB_BRANCH,
    path,
  };
  if (!GITHUB_PUBLISH_ENABLED) return { ...base, skipped: true, reason: "disabled" };
  if (process.env.MEDIA_MANAGER_TEST === "1" && !GITHUB_TEST_PUBLISH) {
    return { ...base, skipped: true, reason: "test" };
  }
  if (!GITHUB_TOKEN) {
    throw new Error(
      "GitHub publishing is not configured. Set MEDIA_MANAGER_GITHUB_TOKEN (or GITHUB_TOKEN), or explicitly set MEDIA_MANAGER_GITHUB_PUBLISH=0 for local-only mode.",
    );
  }

  const endpoint = githubContentsUrl(path);
  const payloadBase = {
    message: githubCommitMessage(path, metadata),
    content: Buffer.from(String(content), "utf8").toString("base64"),
    branch: GITHUB_BRANCH,
  };
  let sha = await githubManifestSha(path);
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await githubRequest("PUT", endpoint, sha ? { ...payloadBase, sha } : payloadBase);
      break;
    } catch (error) {
      if (error?.status !== 409 || attempt !== 0) throw error;
      // Another maintenance process may have committed this manifest between
      // our GET and PUT. Refresh the blob SHA once before surfacing the error.
      sha = await githubManifestSha(path);
    }
  }
  return {
    ...base,
    skipped: false,
    commitSha: String(response?.commit?.sha || ""),
    commitUrl: String(response?.commit?.html_url || ""),
    contentSha: String(response?.content?.sha || ""),
  };
}

function sourceListEntryFromData(file, data) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  let categoryCount = 0;
  let separatedCategoryCount = 0;
  let episodeCount = 0;
  let movieCount = 0;
  let itemCount = 0;
  let separatedItemCount = 0;
  let dualAudioCount = 0;
  for (const category of categories) {
    const categoryName = String(category?.category || "");
    const isMovie = /\bmovies?\b/i.test(categoryName);
    const separated = Number(category?.separated) === 1;
    const entries = Array.isArray(category?.episodes) ? category.episodes : Array.isArray(category?.items) ? category.items : [];
    if (isMovie) movieCount += entries.length;
    else if (separated) separatedCategoryCount += 1;
    else categoryCount += 1;
    if (isMovie) itemCount += entries.length;
    else if (separated) {
      separatedItemCount += entries.length;
      itemCount += entries.length;
    } else {
      episodeCount += entries.length;
      itemCount += entries.length;
    }
    dualAudioCount += entries.filter((entry) => entry?.dualAudio === true).length;
  }
  const totalFileSizeBytes = Math.round(totalSize(data));
  const totalDurationSeconds = hasCompleteDurations(data) ? Math.round(totalDuration(data)) : 0;
  const anilistIds = [...new Set([
    data?.anilistId,
    data?.rootAnilistId,
    ...(Array.isArray(data?.anilistIds) ? data.anilistIds : []),
    ...categories.flatMap((category) => [category?.anilistId, category?.rootAnilistId]),
  ].map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const mediaFormat = String(data?.mediaFormat || (movieCount && !episodeCount ? "MOVIE" : "TV")).toUpperCase();
  const posterValue = data?.Image || data?.image || data?.poster || null;
  // The source index is consumed from the repository root, while manifests
  // conventionally store poster paths with a `./Sources/` prefix. Preserve
  // the index's existing relative-path contract when regenerating it.
  const poster = typeof posterValue === "string" && posterValue.startsWith("./Sources/")
    ? `./${posterValue.slice("./Sources/".length)}`
    : posterValue;
  return {
    file,
    path: `./Files/Anime/${file}`,
    title: String(data?.title || file.replace(/\.json$/i, "")),
    poster,
    categoryCount,
    separatedCategoryCount,
    episodeCount,
    itemCount,
    movieCount: movieCount || undefined,
    separatedItemCount,
    totalFileSizeBytes,
    totalDurationSeconds: totalDurationSeconds || undefined,
    LatestTime: data?.LatestTime || data?.latestTime || "",
    anilistIds,
    mediaFormat,
    dualAudioCount,
    dualAudio: itemCount > 0 && dualAudioCount === itemCount,
  };
}

async function buildSourceListContent() {
  let previousOrder = new Map();
  try {
    const previous = JSON.parse(await readFile(SOURCE_LIST_FILE, "utf8"));
    previousOrder = new Map((Array.isArray(previous?.sources) ? previous.sources : []).map((entry, index) => [String(entry?.file || ""), index]));
  } catch {}
  const names = (await readdir(SOURCE_DIR))
    .filter((name) => name.toLowerCase().endsWith(".json") && name.toLowerCase() !== "exampledir.json");
  const entries = [];
  for (const file of names) {
    try {
      const data = JSON.parse(await readFile(resolve(SOURCE_DIR, file), "utf8"));
      if (data.hidden === true || data.Hidden === true || data.maintainerHidden === true) continue;
      entries.push(sourceListEntryFromData(file, data));
    } catch (error) {
      persistLog({ scope: "source-list", event: "manifest_skipped", file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  entries.sort((a, b) => (previousOrder.get(a.file) ?? Number.MAX_SAFE_INTEGER) - (previousOrder.get(b.file) ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title));
  return `${JSON.stringify({ sources: entries }, null, 2)}\n`;
}

async function publishSourceListToGithub(content) {
  const base = { provider: "github", repository: GITHUB_REPOSITORY, branch: GITHUB_BRANCH, path: SOURCE_LIST_PATH };
  if (!GITHUB_PUBLISH_ENABLED) return { ...base, skipped: true, reason: "disabled" };
  if (process.env.MEDIA_MANAGER_TEST === "1" && !GITHUB_TEST_PUBLISH) return { ...base, skipped: true, reason: "test" };
  if (!GITHUB_TOKEN) throw new Error("GitHub publishing is not configured for the source list");
  const endpoint = githubContentsUrlForPath(SOURCE_LIST_PATH);
  const payloadBase = {
    message: "maintenance: refresh AnimeSourceList",
    content: Buffer.from(String(content), "utf8").toString("base64"),
    branch: GITHUB_BRANCH,
  };
  let sha = await githubFileSha(SOURCE_LIST_PATH);
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await githubRequest("PUT", endpoint, sha ? { ...payloadBase, sha } : payloadBase);
      break;
    } catch (error) {
      if (error?.status !== 409 || attempt !== 0) throw error;
      sha = await githubFileSha(SOURCE_LIST_PATH);
    }
  }
  return {
    ...base,
    skipped: false,
    commitSha: String(response?.commit?.sha || ""),
    commitUrl: String(response?.commit?.html_url || ""),
    contentSha: String(response?.content?.sha || ""),
  };
}

async function refreshSourceListPublication() {
  if (process.env.MEDIA_MANAGER_TEST === "1") return { skipped: true, reason: "test" };
  const content = await buildSourceListContent();
  const state = await loadCatalogState();
  try {
    if (!state.sourceListPending && await readFile(SOURCE_LIST_FILE, "utf8") === content) return { skipped: true, reason: "unchanged" };
  } catch {}
  await writeFile(SOURCE_LIST_FILE, content, "utf8");
  try {
    const github = await publishSourceListToGithub(content);
    state.sourceListPending = false;
    state.lastError = "";
    await persistCatalogState();
    return github;
  } catch (error) {
    const state = await loadCatalogState();
    state.sourceListPending = true;
    state.lastError = error instanceof Error ? error.message : String(error);
    await persistCatalogState();
    persistLog({ scope: "source-list", event: "publication_failed", message: error instanceof Error ? error.message : String(error) });
    void queueFailureWebhook({
      scope: "source-list",
      title: "Source list publication",
      message: error instanceof Error ? error.message : String(error),
    });
    return { provider: "github", path: SOURCE_LIST_PATH, skipped: false, pending: true, error: error instanceof Error ? error.message : String(error) };
  }
}

function cacheScopedPath(job, value) {
  const raw = String(value || "").trim();
  const root = String(job?.cacheDir || "").trim();
  if (!raw || !root) return null;
  const cacheRoot = resolve(root);
  const candidate = isAbsolute(raw) ? resolve(raw) : resolve(cacheRoot, raw);
  if (candidate === cacheRoot || !candidate.startsWith(`${cacheRoot}${sep}`)) return null;
  return candidate;
}

function normalizedBasename(value) {
  return basename(String(value || "").replaceAll("\\", "/"));
}

function normalizeToodriveUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  let parsed;
  let publicBase;
  try {
    parsed = new URL(raw);
    publicBase = new URL(TOODRIVE_PUBLIC_BASE_URL);
  } catch {
    return raw;
  }
  if (!LEGACY_TOODRIVE_HOSTS.has(parsed.host.toLowerCase())) return raw;
  parsed.protocol = publicBase.protocol;
  parsed.host = publicBase.host;
  parsed.port = publicBase.port;
  return parsed.toString();
}

function normalizeManifestSourceUrls(value) {
  if (Array.isArray(value)) {
    for (const item of value) normalizeManifestSourceUrls(item);
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (typeof value.src === "string") value.src = normalizeToodriveUrl(value.src);
  for (const child of Object.values(value)) normalizeManifestSourceUrls(child);
  return value;
}

async function cleanupUploadedArtifact(job, artifact) {
  const durationProbe = job?.durationProbePromises?.get(artifact);
  if (durationProbe) await durationProbe.catch(() => 0);
  const localPath = String(artifact?.localPath || "").replaceAll("\\", "/");
  const localName = normalizedBasename(artifact?.localPath);
  const remoteName = normalizedBasename(artifact?.remotePath);
  const paths = new Set([
    cacheScopedPath(job, artifact?.localPath),
    cacheScopedPath(job, localName),
    cacheScopedPath(job, remoteName),
  ].filter(Boolean));
  const localExtension = extname(localPath);
  const localStem = localExtension ? localPath.slice(0, -localExtension.length) : localPath;
  if (localStem) {
    for (const extension of [".mp4", ".mkv", ".m4v", ".mov"]) {
      const candidate = cacheScopedPath(job, `${localStem}${extension}`);
      if (candidate) paths.add(candidate);
    }
  }
  const removed = [];
  const errors = [];
  for (const path of paths) {
    try {
      await unlink(path);
      removed.push(path);
    } catch (error) {
      if (error?.code !== "ENOENT") errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  artifact.localCleanup = {
    state: errors.length ? "failed" : "removed",
    removed,
    errors,
    at: new Date().toISOString(),
  };
  persistLog({
    scope: "job",
    event: errors.length ? "file_cleanup_failed" : "file_cleaned",
    jobId: job.id,
    runId: job.runId,
    remotePath: artifact.remotePath,
    localPath: artifact.localPath,
    removed,
    errors: errors.length ? errors : undefined,
  });
}

function queueUploadedArtifactCleanup(job, artifact) {
  if (!artifact?.localPath || artifact.fileCleanupQueued) return;
  artifact.fileCleanupQueued = true;
  // The td process reports an uploaded artifact before the local conversion
  // result has necessarily been audio-inspected. Wait for the audio probe
  // before deleting the cache file, otherwise dual-audio validation races the
  // cleanup and incorrectly sees zero streams for every episode.
  const inspections = [job.audioProbePromises?.get(artifact)].filter(Boolean);
  const promise = Promise.allSettled(inspections).then(() => cleanupUploadedArtifact(job, artifact));
  job.fileCleanupPromises ||= new Set();
  job.fileCleanupPromises.add(promise);
  void promise.finally(() => job.fileCleanupPromises.delete(promise)).catch(() => {});
}

async function cleanupJobCache(job) {
  const cachePath = String(job?.cacheDir || "").trim();
  if (!cachePath) {
    const cleanup = { state: "not_configured", at: new Date().toISOString() };
    if (job) job.cleanup = cleanup;
    return cleanup;
  }
  try {
    if (job?.fileCleanupPromises?.size) await Promise.allSettled([...job.fileCleanupPromises]);
    await rm(cachePath, { recursive: true, force: true });
    const cleanup = { state: "removed", path: cachePath, at: new Date().toISOString() };
    job.cleanup = cleanup;
    persistLog({
      scope: "job",
      event: "cache_cleaned",
      jobId: job.id,
      runId: job.runId,
      cachePath,
    });
    return cleanup;
  } catch (error) {
    const cleanup = {
      state: "failed",
      path: cachePath,
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    job.cleanup = cleanup;
    persistLog({
      scope: "job",
      event: "cache_cleanup_failed",
      jobId: job.id,
      runId: job.runId,
      cachePath,
      message: cleanup.error,
    });
    return cleanup;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try { resolveBody(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${label} returned HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after")) || 0;
    throw error;
  }
  return body;
}

async function fetchText(url, options, label) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return body;
}

function seaDexSearchTitle(query) {
  return String(query || "")
    .replace(/\b(?:season|series|cour|part|s)\s*\d{1,2}\b/gi, " ")
    .replace(/\b(?:batch|complete|collection|1080p|720p|web[- .]?dl|bd(?:rip)?|dual[- .]?audio)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function seaDexCategoryFromQuery(query) {
  const match = String(query || "").match(/\b(?:season|series|cour|part|s)\s*0*(\d{1,2})\b/i)
    || String(query || "").match(/\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  return match ? `Season ${Number(match[1])}` : "";
}

function mediaTitleText(media) {
  return media?.title?.english || media?.title?.userPreferred || media?.title?.romaji || media?.title?.native || "";
}

function mediaSeasonScore(media, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  if (!requestedSeason) return 0;
  const title = Object.values(media?.title || {}).filter(Boolean).join(" ");
  const seasonMatch = title.match(/\b(?:season|series|cour|part)\s*0*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  const season = Number(seasonMatch?.[1] || seasonMatch?.[2] || 0);
  if (season === requestedSeason) return 100;
  if (!season && requestedSeason === 1) return 30;
  if (season) return -100;
  return 0;
}

function mediaMatchesRequestedSeason(media, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  if (!requestedSeason) return true;
  const title = Object.values(media?.title || {}).filter(Boolean).join(" ");
  const seasonMatch = title.match(/\b(?:season|series|cour|part)\s*0*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  const explicitSeason = Number(seasonMatch?.[1] || seasonMatch?.[2] || 0);
  if (explicitSeason) return explicitSeason === requestedSeason;
  return requestedSeason === 1;
}

async function searchAniListMedia(query, categoryName = "") {
  const titleQuery = seaDexSearchTitle(query);
  if (!titleQuery) return [];
  const body = await fetchAniListGraphql(`query ($search: String!) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: ANIME) {
        id
        idMal
        title { romaji english native userPreferred }
        synonyms
        format
        season
        seasonYear
        episodes
        status
        nextAiringEpisode { airingAt episode }
        airingSchedule(notYetAired: false, perPage: 50) { nodes { airingAt episode } }
        siteUrl
      }
    }
  }`, { search: titleQuery }, "AniList title search");
  const queryTokens = searchTokens(titleQuery);
  return (body?.data?.Page?.media || [])
    .map((media, index) => {
      const mediaTokens = searchTokens(Object.values(media.title || {}).join(" "));
      const overlap = [...queryTokens].filter((token) => mediaTokens.has(token)).length;
      return { media, index, score: overlap * 20 + mediaSeasonScore(media, categoryName) };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ media }) => media);
}

function catalogMediaTitle(media) {
  return mediaTitleText(media) || `AniList ${media?.id || "title"}`;
}

function catalogMediaAliases(media) {
  return [...new Set(Object.values(media?.title || {}).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function catalogPrequelId(media) {
  const edge = (media?.relations?.edges || []).find((candidate) => String(candidate?.relationType || "").toUpperCase() === "PREQUEL");
  const id = Number(edge?.node?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function catalogExplicitSeasonNumber(media) {
  const title = Object.values(media?.title || {}).filter(Boolean).join(" ");
  const match = title.match(/\b(?:season|series|cour|part)\s*0*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  const season = Number(match?.[1] || match?.[2] || 0);
  return Number.isInteger(season) && season > 0 ? season : null;
}

function catalogSeasonNumbers(mediaById) {
  const result = new Map();
  for (const media of mediaById.values()) {
    const explicit = catalogExplicitSeasonNumber(media);
    if (explicit) {
      result.set(Number(media.id), explicit);
      continue;
    }
    let current = media;
    let season = 1;
    const seen = new Set();
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      const prequelId = catalogPrequelId(current);
      if (!prequelId || !mediaById.has(prequelId)) break;
      season += 1;
      current = mediaById.get(prequelId);
    }
    result.set(Number(media.id), season);
  }
  return result;
}

function catalogRootId(media, mediaById) {
  let current = media;
  const seen = new Set();
  while (current && !seen.has(Number(current.id))) {
    seen.add(Number(current.id));
    const prequelId = catalogPrequelId(current);
    if (!prequelId || !mediaById.has(prequelId)) break;
    current = mediaById.get(prequelId);
  }
  const id = Number(current?.id || media?.id);
  return Number.isInteger(id) && id > 0 ? id : Number(media?.id) || null;
}

function catalogFileEpisodeNumbers(files = []) {
  return [...new Set(files.map((file) => {
    const name = String(file?.name || file?.path || "");
    if (!name || /(?:^|[\\/])(?:sample|trailer|preview|ncop|nced|opening|ending)[^\\/]*$/i.test(name)) return null;
    return episodeInfo(name).episode;
  }).filter((episode) => Number.isInteger(episode) && episode > 0))].sort((a, b) => a - b);
}

function catalogTorrentToRelease(torrent, record) {
  const hash = String(torrent?.infoHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/i.test(hash)) return null;
  const files = Array.isArray(torrent?.files) ? torrent.files.map((file) => ({
    name: String(file?.name || file?.path || ""),
    length: Number(file?.length) > 0 ? Number(file.length) : 0,
  })).filter((file) => file.name) : [];
  const mediaFiles = files.filter((file) => /\.(?:mkv|mp4|m4v|mov|webm|avi|ts|m2ts)$/i.test(file.name));
  const episodes = catalogFileEpisodeNumbers(mediaFiles);
  const updatedAt = String(torrent?.updated || record?.updated || "");
  const releaseGroup = String(torrent?.releaseGroup || "").trim();
  const title = releaseGroup ? `[${releaseGroup}] ${releaseGroup}` : "releases.moe release";
  return {
    hash,
    magnet: `magnet:?xt=urn:btih:${hash}`,
    trackerUrl: String(torrent?.url || ""),
    tracker: String(torrent?.tracker || ""),
    title,
    releaseGroup,
    isBest: torrent?.isBest === true,
    dualAudio: torrent?.dualAudio === true,
    updatedAt,
    availabilityScore: (torrent?.url ? 2 : 0) + (mediaFiles.length ? 1 : 0) + (record?.incomplete === true ? 0 : 1),
    releaseConfidence: (releaseGroup ? 1 : 0) + (mediaFiles.length ? 1 : 0) + (torrent?.url ? 1 : 0),
    files,
    episodes,
    estimatedBytes: mediaFiles.reduce((sum, file) => sum + file.length, 0),
  };
}

function compareCatalogReleases(a, b) {
  if (a.dualAudio !== b.dualAudio) return a.dualAudio ? -1 : 1;
  if (a.isBest !== b.isBest) return a.isBest ? -1 : 1;
  if (a.availabilityScore !== b.availabilityScore) return b.availabilityScore - a.availabilityScore;
  if (a.releaseConfidence !== b.releaseConfidence) return b.releaseConfidence - a.releaseConfidence;
  const aUpdated = Date.parse(a.updatedAt || "") || 0;
  const bUpdated = Date.parse(b.updatedAt || "") || 0;
  if (aUpdated !== bUpdated) return bUpdated - aUpdated;
  if (a.estimatedBytes !== b.estimatedBytes) return b.estimatedBytes - a.estimatedBytes;
  return String(a.hash).localeCompare(String(b.hash));
}

async function fetchCatalogReleaseRecords({ onProgress } = {}) {
  const records = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({ page: String(page), perPage: String(CATALOG_PAGE_SIZE), expand: "trs" });
    const body = await fetchJson(`${RELEASES_API_URL}?${params}`, {
      headers: { accept: "application/json", "user-agent": "Media-Manager-Maintenance/1.0" },
    }, "releases.moe catalog lookup");
    const items = Array.isArray(body?.items) ? body.items : [];
    records.push(...items);
    totalPages = Math.max(page, Number(body?.totalPages) || Math.ceil(Number(body?.totalItems || records.length) / CATALOG_PAGE_SIZE));
    onProgress?.({ page, totalPages, records: records.length, totalItems: Number(body?.totalItems) || null });
    page += 1;
    if (!items.length) break;
  } while (page <= totalPages && page <= 200);
  return records;
}

async function fetchAniListCatalogMedia(ids, { onProgress } = {}) {
  const mediaById = new Map();
  const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const pending = new Set(uniqueIds);
  const requested = new Set();
  let completed = 0;
  while (pending.size) {
    const batch = [...pending].slice(0, CATALOG_ANILIST_BATCH_SIZE);
    for (const id of batch) pending.delete(id);
    batch.forEach((id) => requested.add(id));
    const request = {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Media-Manager-Maintenance/1.0" },
      body: JSON.stringify({
        query: `query ($ids: [Int!]!) {
          Page(page: 1, perPage: 50) {
            media(id_in: $ids, type: ANIME) {
              id
              title { romaji english native userPreferred }
              format
              episodes
              season
              seasonYear
              coverImage { large extraLarge }
              relations {
                edges {
                  relationType
                  node { id format title { romaji english native userPreferred } }
                }
              }
            }
          }
        }`,
        variables: { ids: batch },
      }),
    };
    let body;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const waitMs = Math.max(0, CATALOG_ANILIST_INTERVAL_MS - (Date.now() - catalogAniListLastRequestAt));
      if (waitMs) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      catalogAniListLastRequestAt = Date.now();
      try {
        body = await fetchJson(ANILIST_API_URL, request, "AniList catalog lookup");
        break;
      } catch (error) {
        const retryable = Number(error?.status) === 429 || Number(error?.status) >= 500;
        if (!retryable || attempt === 3) throw error;
        const retryMs = Math.max(5_000, Number(error?.retryAfter || 0) * 1_000, 2_500 * (attempt + 1));
        await new Promise((resolveWait) => setTimeout(resolveWait, retryMs));
      }
    }
    for (const media of body?.data?.Page?.media || []) {
      const id = Number(media?.id);
      if (Number.isInteger(id) && id > 0) mediaById.set(id, media);
      for (const relation of media?.relations?.edges || []) {
        if (String(relation?.relationType || "").toUpperCase() !== "PREQUEL") continue;
        const prequelId = Number(relation?.node?.id);
        if (Number.isInteger(prequelId) && prequelId > 0 && !requested.has(prequelId)) pending.add(prequelId);
      }
    }
    completed += batch.length;
    onProgress?.({ completed, total: completed + pending.size });
  }
  return mediaById;
}

function catalogEntryFromRecord(record, mediaById, seasonNumbers, previous = {}) {
  const alID = Number(record?.alID);
  const media = mediaById.get(alID);
  const format = String(media?.format || "").toUpperCase();
  if (!media || !["TV", "MOVIE"].includes(format)) return null;
  const rootAlID = catalogRootId(media, mediaById);
  const rootMedia = mediaById.get(rootAlID) || media;
  const releases = (record?.expand?.trs || record?.expand?.torrents || record?.trs || [])
    .map((torrent) => catalogTorrentToRelease(torrent, record))
    .filter(Boolean)
    .sort(compareCatalogReleases);
  const preferred = releases[0] || null;
  const preferredHashChanged = Boolean(previous.preferredReleaseHash && preferred?.hash
    && String(previous.preferredReleaseHash).toLowerCase() !== String(preferred.hash).toLowerCase());
  const trackerChanged = preferredHashChanged || Boolean(previous.trackerUpdatedAt && record?.updated
    && String(previous.trackerUpdatedAt) !== String(record.updated));
  const season = format === "TV" ? (seasonNumbers.get(alID) || 1) : null;
  return {
    ...previous,
    key: catalogKey(alID),
    alID,
    rootAlID,
    title: catalogMediaTitle(rootMedia),
    mediaTitle: catalogMediaTitle(media),
    aliases: [...new Set([...catalogMediaAliases(rootMedia), ...catalogMediaAliases(media)])],
    image: media?.coverImage?.extraLarge || media?.coverImage?.large || rootMedia?.coverImage?.extraLarge || rootMedia?.coverImage?.large || "",
    format,
    category: format === "MOVIE" ? "Movie" : `Season ${season}`,
    seasonNumber: season,
    episodes: Number(media?.episodes) > 0 ? Number(media.episodes) : null,
    trackerEntryId: String(record?.id || ""),
    trackerUpdatedAt: String(record?.updated || ""),
    releases: releases.slice(0, 20),
    preferredRelease: preferred,
    preferredReleaseHash: preferred?.hash || "",
    preferredDualAudio: preferred?.dualAudio === true,
    estimatedBytes: preferred?.estimatedBytes || 0,
    discoveredAt: previous.discoveredAt || new Date().toISOString(),
    state: trackerChanged && previous.state === "failed"
      ? "discovered"
      : previous.state || (preferred ? "discovered" : "unavailable"),
    attempts: trackerChanged ? 0 : Number(previous.attempts) || 0,
    nextRetryAt: trackerChanged ? null : (previous.nextRetryAt || null),
    lastError: String(previous.lastError || ""),
    sourcePath: previous.sourcePath || "",
    publishedHash: String(previous.publishedHash || ""),
    publishedDualAudio: previous.publishedDualAudio === true,
    publishedAt: previous.publishedAt || null,
    upgradeEligible: previous.upgradeEligible === true,
    unconfirmedEpisodes: normalizedEpisodeNumbers(previous.unconfirmedEpisodes),
    upgradeEpisodes: normalizedEpisodeNumbers(previous.upgradeEpisodes),
    history: Array.isArray(previous.history) ? previous.history.slice(-20) : [],
  };
}

function catalogSummary(state = catalogState || emptyCatalogState()) {
  const entries = Object.values(state.entries || {});
  const summary = {
    file: CATALOG_STATE_FILE,
    version: CATALOG_STATE_VERSION,
    scanning: state.scanning === true,
    lastScanAt: state.lastScanAt || null,
    lastScanError: state.lastScanError || "",
    sourceListPending: state.sourceListPending === true,
    total: entries.length,
    tv: entries.filter((entry) => entry.format === "TV").length,
    movies: entries.filter((entry) => entry.format === "MOVIE").length,
    published: entries.filter((entry) => entry.state === "published").length,
    queued: entries.filter((entry) => ["discovered", "queued", "upgrade_queued"].includes(entry.state)).length,
    active: entries.filter((entry) => entry.state === "active").length,
    unavailable: entries.filter((entry) => entry.state === "unavailable").length,
    review: entries.filter((entry) => entry.state === "review").length,
    failed: entries.filter((entry) => entry.state === "failed").length,
    dualAudio: entries.filter((entry) => entry.preferredDualAudio === true).length,
    upgradeEligible: entries.filter((entry) => entry.upgradeEligible === true).length,
    unconfirmedEpisodes: entries.reduce((sum, entry) => sum + normalizedEpisodeNumbers(entry.unconfirmedEpisodes).length, 0),
    upgradeEpisodes: entries.reduce((sum, entry) => sum + normalizedEpisodeNumbers(entry.upgradeEpisodes).length, 0),
    estimatedBytes: entries.reduce((sum, entry) => sum + (Number(entry.estimatedBytes) || 0), 0),
    current: null,
  };
  if (catalogRunId) {
    const run = maintenanceRuns.get(catalogRunId);
    const current = run?.items?.find((item) => ["searching", "downloading", "processing", "uploading"].includes(item.state));
    if (current) summary.current = { title: current.title, category: current.category, state: current.state, id: current.id };
  }
  return summary;
}

async function scanCatalog({ onProgress } = {}) {
  if (catalogScanPromise) return catalogScanPromise;
  catalogScanPromise = (async () => {
    const state = await loadCatalogState();
    if (state.scanning) state.scanning = false;
    state.scanning = true;
    state.lastScanError = "";
    await persistCatalogState();
    try {
      const records = await fetchCatalogReleaseRecords({ onProgress });
      const ids = records.map((record) => Number(record?.alID)).filter((id) => Number.isInteger(id) && id > 0);
      const mediaById = await fetchAniListCatalogMedia(ids, { onProgress: (progress) => onProgress?.({ ...progress, stage: "anilist" }) });
      const seasonNumbers = catalogSeasonNumbers(mediaById);
      const nextEntries = {};
      for (const record of records) {
        const key = catalogKey(record?.alID);
        if (!key) continue;
        const previous = state.entries[key] || {};
        const entry = catalogEntryFromRecord(record, mediaById, seasonNumbers, previous);
        if (!entry) continue;
        nextEntries[key] = entry;
      }
      state.entries = nextEntries;
      state.lastScanAt = new Date().toISOString();
      state.lastScanError = "";
      return catalogSummary(state);
    } catch (error) {
      state.lastScanError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      state.scanning = false;
      await persistCatalogState();
      catalogScanPromise = null;
    }
  })();
  return catalogScanPromise;
}

function torrentFileSeasonNumbers(torrent) {
  const seasons = new Set();
  for (const file of Array.isArray(torrent?.files) ? torrent.files : []) {
    const name = String(file?.name || file?.path || "");
    const folderSeason = name.match(/(?:^|[\\/])Season\s*0*(\d{1,2})(?=[\\/]|$)/i);
    if (folderSeason) seasons.add(Number(folderSeason[1]));
    for (const match of name.matchAll(/\bS\s*0*(\d{1,2})\s*E\s*0*\d{1,3}\b/gi)) {
      seasons.add(Number(match[1]));
    }
  }
  return [...seasons].filter((season) => Number.isInteger(season) && season > 0).sort((a, b) => a - b);
}

function seaDexTorrentToItem(torrent, entry, media, categoryName = "") {
  const hash = String(torrent?.infoHash || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(hash)) return null;
  const requestedSeason = categorySeasonNumber(categoryName);
  const fileSeasons = torrentFileSeasonNumbers(torrent);
  if (requestedSeason && fileSeasons.length && !fileSeasons.includes(requestedSeason)) return null;
  const title = mediaTitleText(media);
  const releaseGroup = String(torrent.releaseGroup || "SeaDex").trim() || "SeaDex";
  const releaseTitle = `[${releaseGroup}] ${title}${categoryName ? ` ${categoryName}` : ""} batch`;
  return {
    provider: "seadex",
    title: releaseTitle,
    viewUrl: `${RELEASES_BASE_URL}/${entry.alID}/`,
    trackerUrl: torrent.url || "",
    torrentUrl: "",
    magnet: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(releaseTitle)}`,
    hash,
    seeders: 0,
    downloads: 0,
    publishedAt: torrent.updated || entry.updated || "",
    releaseGroup,
    isBest: torrent.isBest === true,
    dualAudio: torrent.dualAudio === true,
    seaDex: true,
  };
}

async function seaDexSearch(query, categoryName = "") {
  const requestedCategory = categoryName || seaDexCategoryFromQuery(query);
  const mediaCandidates = (await searchAniListMedia(query, requestedCategory))
    .filter((media) => mediaMatchesRequestedSeason(media, requestedCategory));
  const items = [];
  let lastError = null;
  for (const media of mediaCandidates) {
    try {
      const params = new URLSearchParams({ filter: `alID=${media.id}`, perPage: "1", expand: "trs" });
      const body = await fetchJson(`${RELEASES_API_URL}?${params}`, {
        headers: { "accept": "application/json", "user-agent": "Media-Manager-Maintenance/1.0" },
      }, "SeaDex release lookup");
      const entry = body?.items?.[0];
      if (!entry) continue;
      for (const torrent of entry.expand?.trs || []) {
        const item = seaDexTorrentToItem(torrent, entry, media, requestedCategory);
        if (item) items.push(item);
      }
      if (items.length) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!items.length && lastError) throw lastError;
  return items
    .map((item, index) => ({ item, index, audioScore: releaseAudioPreferenceScore(item.title) + (item.dualAudio ? 20 : 0) }))
    .sort((a, b) => Number(b.item.dualAudio) - Number(a.item.dualAudio)
      || Number(b.item.isBest) - Number(a.item.isBest)
      || b.audioScore - a.audioScore
      || a.index - b.index)
    .map(({ item }) => item);
}

function parseRssItems(xml) {
  const items = [];
  for (const match of String(xml || "").matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const get = (name) => {
      const escapedName = String(name).replace(/:/g, "\\:");
      const found = block.match(new RegExp(`<${escapedName}[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
      return found ? decodeHtml(found[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : "";
    };
    const title = get("title");
    if (!title) continue;
    const viewUrl = get("link");
    const hash = get("nyaa:infoHash") || get("infoHash");
    const enclosure = block.match(/<enclosure\b[^>]+url=["']([^"']+)["']/i)?.[1] || "";
    const torrentUrl = enclosure || (viewUrl.includes("/download/")
      ? viewUrl
      : viewUrl.includes("/view/") ? `${viewUrl.replace("/view/", "/download/")}.torrent` : "");
    const magnet = hash
      ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
      : "";
    items.push({
      provider: "nyaa",
      title,
      viewUrl,
      torrentUrl,
      magnet,
      hash,
      seeders: Number(get("nyaa:seeders")) || 0,
      downloads: Number(get("nyaa:downloads")) || 0,
      publishedAt: get("pubDate"),
      dualAudio: releaseHasDualAudio({ title }),
      nyaa: true,
    });
  }
  return items;
}

async function nyaaSearch(query) {
  let lastError = null;
  for (const base of NYAA_BASE_URLS) {
    try {
      const url = `${base}/?page=rss&q=${encodeURIComponent(query)}`;
      const xml = await fetchText(url, {
        headers: { "accept": "application/rss+xml, application/xml, text/xml", "user-agent": "Media-Manager-Maintenance/1.0" },
      }, "Nyaa search");
      const items = parseRssItems(xml);
      if (items.length) return items;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function releaseSearch(query, categoryName = "") {
  let seaDexItems = [];
  let nyaaItems = [];
  const errors = [];
  try {
    seaDexItems = await seaDexSearch(query, categoryName);
  } catch (error) {
    errors.push(`SeaDex: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    nyaaItems = await nyaaSearch(query);
  } catch (error) {
    errors.push(`Nyaa: ${error instanceof Error ? error.message : String(error)}`);
  }
  const merged = new Map();
  for (const item of [...seaDexItems, ...nyaaItems]) {
    const key = String(item.hash || item.magnet || `${item.provider}|${item.title}`).toLowerCase();
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...item });
      continue;
    }
    previous.seeders = Math.max(Number(previous.seeders) || 0, Number(item.seeders) || 0);
    previous.downloads = Math.max(Number(previous.downloads) || 0, Number(item.downloads) || 0);
    previous.dualAudio = releaseHasDualAudio(previous) || releaseHasDualAudio(item);
    previous.providers = [...new Set([...(previous.providers || [previous.provider]), item.provider].filter(Boolean))];
  }
  const results = [...merged.values()];
  if (results.length || !errors.length) return results;
  throw new Error(errors.join("; "));
}

function releaseAudioPreferenceScore(title) {
  const text = String(title || "").replace(/[()[\]{}]/g, " ");
  let score = 0;
  if (/\b(?:dual|multi)[\s._-]*audio\b/i.test(text) || /\b(?:dual|multi)[\s._-]*language(?:s)?\b/i.test(text)) score += 60;
  if (/\b(?:2|two)[\s._-]*audio\b/i.test(text)) score += 45;
  if (/\b(?:english|eng)[\s._-]*(?:audio|dub(?:bed)?)\b/i.test(text)) score += 20;
  if (/\b(?:best|seadex)\b/i.test(text)) score += 8;
  return score;
}

function releaseHasDualAudio(item) {
  if (item?.dualAudio === true) return true;
  const text = String(item?.title || "").replace(/[()[\]{}]/g, " ");
  return /\b(?:dual|multi)[\s._-]*audio\b/i.test(text)
    || /\b(?:dual|multi)[\s._-]*language(?:s)?\b/i.test(text)
    || /\b(?:2|two)[\s._-]*audio\b/i.test(text);
}

function releaseAvailabilityScore(item) {
  const seeders = Math.max(0, Number(item?.seeders) || 0);
  const downloads = Math.max(0, Number(item?.downloads) || 0);
  return Math.log10(seeders + 1) * 10 + Math.log10(downloads + 1) * 2;
}

// Availability is a selection gate, not merely a score.  A Nyaa result with
// zero seeders can be a perfectly named release and still never transfer a
// byte.  SeaDex magnets are kept as a lower-confidence fallback because their
// tracker seeder count is often unavailable; zero-seeder tracker results are
// never preferred when a seeded candidate covers the same work.
function releaseAvailabilityTier(item) {
  const seeders = Math.max(0, Number(item?.seeders) || 0);
  if (seeders > 0) return 2;
  const provider = String(item?.provider || item?.providers?.[0] || "").trim().toLowerCase();
  return provider === "seadex" ? 1 : 0;
}

function releaseHasUsableAvailability(item) {
  return releaseAvailabilityTier(item) > 0;
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
}

// AniList maintenance lookup. All maintenance planning uses this API and
// never calls the former MAL endpoints.
function aniListCacheKey(title) {
  return normalizeTitle(title) || String(title || "").trim().toLowerCase();
}

async function loadAniListCache() {
  if (aniListCache) return aniListCache;
  if (aniListCacheLoad) return aniListCacheLoad;
  aniListCacheLoad = readFile(ANILIST_CACHE_FILE, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw);
      aniListCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      return aniListCache;
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") console.error(`[anilist-cache] ${error instanceof Error ? error.message : String(error)}`);
      aniListCache = {};
      return aniListCache;
    });
  return aniListCacheLoad;
}

function queueAniListCacheWrite() {
  const snapshot = JSON.stringify(aniListCache || {}, null, 2);
  aniListCacheWrite = aniListCacheWrite.then(async () => {
    try {
      await mkdir(dirname(ANILIST_CACHE_FILE), { recursive: true });
      await writeFile(ANILIST_CACHE_FILE, `${snapshot}\n`, "utf8");
    } catch (error) {
      console.error(`[anilist-cache] ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return aniListCacheWrite;
}

function queueAniListRequest(task) {
  const next = aniListRequestQueue.then(async () => {
    const waitMs = Math.max(0, ANILIST_REQUEST_INTERVAL_MS - (Date.now() - aniListLastRequestAt));
    if (waitMs) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    aniListLastRequestAt = Date.now();
    return task();
  }, async () => task());
  aniListRequestQueue = next.catch(() => {});
  return next;
}

async function fetchAniListGraphql(query, variables = {}, label = "AniList query") {
  return queueAniListRequest(async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ANILIST_REQUEST_TIMEOUT_MS);
      try {
        const body = await fetchJson(ANILIST_API_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "Media-Manager-Maintenance/1.0" },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        }, label);
        if (Array.isArray(body?.errors) && body.errors.length) {
          const error = new Error(`${label}: ${body.errors.map((entry) => entry?.message || "GraphQL error").join("; ")}`);
          error.status = Number(body?.errors?.[0]?.status) || 0;
          throw error;
        }
        return body;
      } catch (error) {
        lastError = error;
        const retryable = Number(error?.status) === 429 || Number(error?.status) >= 500 || error?.name === "AbortError";
        if (!retryable || attempt === 3) break;
        const retryMs = Math.max(2_000, Number(error?.retryAfter || 0) * 1_000, 1_500 * (attempt + 1));
        await new Promise((resolveWait) => setTimeout(resolveWait, retryMs));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error(`${label} failed`);
  });
}

function aniListTitles(item) {
  const title = item?.title && typeof item.title === "object" ? Object.values(item.title) : [];
  return [
    ...title,
    item?.title,
    item?.titleEnglish,
    item?.title_english,
    item?.titleJapanese,
    item?.title_japanese,
    ...(Array.isArray(item?.synonyms) ? item.synonyms : []),
    ...(Array.isArray(item?.titles) ? item.titles.map((entry) => entry?.title || entry) : []),
  ].filter(Boolean).map(String);
}

function aniListTitleQueries(source) {
  const title = String(source?.anilistTitle || source?.malTitle || source?.title || "").trim();
  const fileTitle = String(source?.file || "")
    .replace(/\.json$/i, "")
    .replace(/[._-]+/g, " ")
    .trim();
  return [title, fileTitle]
    .filter(Boolean)
    .filter((query, index, all) => all.findIndex((candidate) => normalizeTitle(candidate) === normalizeTitle(query)) === index);
}

function aniListSeasonMarker(item) {
  const text = aniListTitles(item).join(" ");
  const numbered = text.match(/\b(?:season|series|cour|part|s)\s*0*(\d{1,2})\b/i);
  if (numbered) return Number(numbered[1]);
  const ordinal = text.match(/\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  return ordinal ? Number(ordinal[1]) : null;
}

function aniListCandidateScore(item, source, categoryName) {
  const sourceTokens = aniListSearchTokens(source?.anilistTitle || source?.malTitle || source?.title);
  const titleTokens = aniListSearchTokens(aniListTitles(item).join(" "));
  const overlap = [...sourceTokens].filter((token) => titleTokens.has(token)).length;
  if (!overlap) return Number.NEGATIVE_INFINITY;
  const requestedSeason = categorySeasonNumber(categoryName);
  const marker = aniListSeasonMarker(item);
  let score = overlap * 20;
  if (sourceTokens.size && overlap === sourceTokens.size) score += 35;
  if (requestedSeason && marker === requestedSeason) score += 55;
  else if (requestedSeason > 1 && marker && marker !== requestedSeason) score -= 70;
  else if (requestedSeason === 1 && marker && marker > 1) score -= 50;
  if (String(item?.format || item?.type || "").toUpperCase() === "TV") score += 8;
  if (/\b(?:movie|special|ona|ova)\b/i.test(String(item?.format || item?.type || ""))) score -= 15;
  if (Number(item?.episodes) > 0) score += 3;
  return score;
}

function aniListAiringProgress(item) {
  const now = Math.floor(Date.now() / 1000);
  const schedule = Array.isArray(item?.airingSchedule?.nodes) ? item.airingSchedule.nodes : [];
  const knownEpisodeNumbers = [...new Set(schedule
    .filter((entry) => Number(entry?.episode) > 0 && (!Number(entry?.airingAt) || Number(entry.airingAt) <= now))
    .map((entry) => Number(entry.episode)))].sort((a, b) => a - b);
  const nextEpisode = Number(item?.nextAiringEpisode?.episode) || null;
  const airedEpisodes = knownEpisodeNumbers.length
    ? Math.max(...knownEpisodeNumbers)
    : nextEpisode && nextEpisode > 1 ? nextEpisode - 1 : null;
  const status = String(item?.status || "").toUpperCase();
  const airing = status === "RELEASING" || Boolean(nextEpisode);
  const totalEpisodes = Number(item?.episodes) > 0 ? Number(item.episodes) : null;
  const episodeCountSource = knownEpisodeNumbers.length
    ? "anilist-airing-schedule"
    : (!airing && totalEpisodes ? "anilist-total" : "unknown");
  return {
    airedEpisodes,
    knownEpisodeNumbers,
    episodeCountSource,
    airing,
    episodeProgressError: episodeCountSource === "unknown"
      ? "AniList did not expose an aired episode schedule"
      : "",
  };
}

function summarizeAniListCandidate(item, score) {
  const progress = aniListAiringProgress(item);
  const status = String(item?.status || "").toUpperCase();
  const statusLabel = status === "RELEASING" ? "Currently Airing"
    : status === "FINISHED" ? "Finished Airing"
      : status === "NOT_YET_RELEASED" ? "Not Yet Aired" : status;
  return {
    anilistId: Number(item?.id) || null,
    anilistUrl: String(item?.siteUrl || (Number(item?.id) ? `https://anilist.co/anime/${Number(item.id)}` : "")).trim(),
    malId: Number(item?.idMal) || null,
    malUrl: Number(item?.idMal) ? `https://myanimelist.net/anime/${Number(item.idMal)}` : "",
    title: String(mediaTitleText(item) || aniListTitles(item)[0] || "").trim(),
    titleEnglish: String(item?.title?.english || "").trim(),
    type: String(item?.format || ""),
    episodes: Number(item?.episodes) > 0 ? Number(item.episodes) : null,
    airedEpisodes: Number(progress.airedEpisodes) > 0 ? Number(progress.airedEpisodes) : null,
    knownEpisodeNumbers: progress.knownEpisodeNumbers,
    episodeCountSource: progress.episodeCountSource,
    episodeProgressCheckedAt: Date.now(),
    episodeProgressError: progress.episodeProgressError,
    status: statusLabel,
    airing: progress.airing,
    seasonMarker: aniListSeasonMarker(item),
    score,
  };
}

function aniListCandidateIsCurrentlyAiring(candidate) {
  const status = String(candidate?.status || "").trim();
  return candidate?.airing === true || /currently\s+airing/i.test(status);
}

function aniListTitleConfidence(candidate, source) {
  const sourceTokens = aniListSearchTokens(source?.anilistTitle || source?.malTitle || source?.title);
  const titleTokens = aniListSearchTokens(aniListTitles(candidate).join(" "));
  const overlap = [...sourceTokens].filter((token) => titleTokens.has(token)).length;
  if (!sourceTokens.size) return false;
  const required = sourceTokens.size === 1 ? 1 : sourceTokens.size === 2 ? 1 : Math.max(2, Math.ceil(sourceTokens.size * 0.6));
  if (overlap < required) return false;
  if (sourceTokens.size === 2 && overlap === 1) return [...sourceTokens][0] === [...titleTokens][0];
  return true;
}

function aniListCandidateStartsWithSource(candidate, source) {
  const sourceFirst = [...aniListSearchTokens(source?.anilistTitle || source?.malTitle || source?.title)][0];
  if (!sourceFirst) return false;
  return aniListTitles(candidate).some((title) => [...aniListSearchTokens(title)][0] === sourceFirst);
}

function chooseAniListCandidate(candidates, source, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, score: aniListCandidateScore(candidate, source, categoryName) }))
    .filter((entry) => {
      if (!Number.isFinite(entry.score) || !aniListTitleConfidence(entry.candidate, source) || !aniListCandidateStartsWithSource(entry.candidate, source)) return false;
      const marker = Number(entry.candidate?.seasonMarker) || aniListSeasonMarker(entry.candidate);
      if (requestedSeason > 1 && marker !== requestedSeason) return false;
      if (requestedSeason === 1 && marker && marker > 1) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

async function hydrateAniListCandidateProgress(aniListResult, source, categoryName) {
  const candidate = chooseAniListCandidate(aniListResult?.candidates, source, categoryName);
  return candidate || null;
}

async function findAniListAnime(source, categoryName) {
  const cache = await loadAniListCache();
  const key = aniListCacheKey(source?.anilistTitle || source?.malTitle || source?.title);
  const cached = cache[key];
  const now = Date.now();
  const cacheTtl = cached?.error ? ANILIST_ERROR_CACHE_TTL_MS : ANILIST_CACHE_TTL_MS;
  if (cached?.version === ANILIST_CACHE_VERSION && Number.isFinite(Number(cached.checkedAt)) && now - Number(cached.checkedAt) < cacheTtl) {
    const candidate = chooseAniListCandidate(cached.candidates, source, categoryName);
    return { ...cached, candidate: candidate ? { ...candidate } : null, cached: true };
  }

  const candidatesById = new Map();
  let lastError = null;
  const queries = aniListTitleQueries(source);
  for (const query of queries) {
    try {
      const body = await fetchAniListGraphql(`query ($search: String!) {
        Page(page: 1, perPage: 10) {
          media(search: $search, type: ANIME) {
            id
            idMal
            title { romaji english native userPreferred }
            synonyms
            format
            status
            episodes
            nextAiringEpisode { airingAt episode }
            airingSchedule(notYetAired: false, perPage: 50) { nodes { airingAt episode } }
            siteUrl
          }
        }
      }`, { search: query }, "AniList maintenance lookup");
      for (const media of body?.data?.Page?.media || []) {
        const score = aniListCandidateScore(media, source, categoryName);
        if (!Number.isFinite(score)) continue;
        const candidate = summarizeAniListCandidate(media, score);
        const candidateKey = candidate.anilistId || `${candidate.title}|${candidate.titleEnglish}`;
        const previous = candidatesById.get(candidateKey);
        if (!previous || candidate.score > previous.score) candidatesById.set(candidateKey, candidate);
      }
    } catch (error) {
      lastError = error;
    }
  }
  const candidates = [...candidatesById.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  const record = {
    version: ANILIST_CACHE_VERSION,
    checkedAt: now,
    query: queries[0] || "",
    candidates,
    error: candidates.length ? "" : (lastError ? (lastError instanceof Error ? lastError.message : String(lastError)) : ""),
  };
  cache[key] = record;
  queueAniListCacheWrite();
  return { ...record, candidate: chooseAniListCandidate(candidates, source, categoryName), cached: false };
}

function discoverAniListSeasons(source, existingCategories, aniListResult) {
  const knownSeasons = new Set((Array.isArray(existingCategories) ? existingCategories : [])
    .map((category) => categorySeasonNumber(category?.category))
    .filter((season) => Number.isInteger(season) && season > 0));
  const latestKnownSeason = Math.max(0, ...knownSeasons);
  const candidates = Array.isArray(aniListResult?.candidates) ? aniListResult.candidates : [];
  const bestBySeason = new Map();
  for (const candidate of candidates) {
    if (String(candidate?.type || "").toUpperCase() !== "TV") continue;
    const episodes = Number(candidate?.episodes);
    if ((!Number.isInteger(episodes) || episodes <= 0) && !aniListCandidateIsCurrentlyAiring(candidate)) continue;
    if (!aniListTitleConfidence(candidate, source) || !aniListCandidateStartsWithSource(candidate, source)) continue;
    const season = Number(candidate?.seasonMarker) || aniListSeasonMarker(candidate) || 1;
    if (knownSeasons.has(season) || season <= latestKnownSeason) continue;
    const previous = bestBySeason.get(season);
    if (!previous || Number(candidate?.score || 0) > Number(previous?.score || 0)) bestBySeason.set(season, candidate);
  }
  return [...bestBySeason.entries()].sort(([a], [b]) => a - b).map(([season, candidate]) => ({ season, candidate }));
}

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "by", "for", "in", "is", "of", "on", "or", "the", "to", "with",
  "production",
  "world", "season", "complete", "batch", "collection",
]);

function searchTokens(value) {
  return new Set(String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token)));
}

const ANILIST_GENERIC_TOKENS = new Set([
  ...SEARCH_STOP_WORDS,
  "gals", "girl", "girls", "hotel", "love", "lovely", "night", "stories", "story", "super",
]);

function aniListSearchTokens(value) {
  return new Set(String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !ANILIST_GENERIC_TOKENS.has(token)));
}

function categorySeasonNumber(categoryName) {
  const parsed = episodeInfo(categoryName);
  return parsed.season || null;
}

function automaticReleaseScore(item, source, categoryName) {
  const sourceTokens = searchTokens(source.title);
  const releaseTokens = searchTokens(item.title);
  const overlap = [...sourceTokens].filter((token) => releaseTokens.has(token)).length;
  if (!overlap || !item.torrentUrl && !item.magnet) return Number.NEGATIVE_INFINITY;

  const requestedSeason = categorySeasonNumber(categoryName);
  const releaseInfo = episodeInfo(item.title);
  let score = overlap * 20;
  if (overlap === sourceTokens.size && sourceTokens.size > 1) score += 12;
  if (requestedSeason && releaseInfo.season === requestedSeason) score += 42;
  else if (requestedSeason && releaseInfo.season && releaseInfo.season !== requestedSeason) score -= 55;
  if (/\b(?:batch|complete|collection|全集|season)\b/i.test(item.title)) score += 14;
  if (/\bremux\b/i.test(item.title)) score += 25;
  if (/\b(?:bd|bdmv|bluray|bdrip)\b/i.test(item.title)) score += 8;
  if (/\b(?:1080p|720p|web[- .]?dl|dual audio|multi audio|multi[- .]?subs)\b/i.test(item.title)) score += 5;
  if (item.isBest) score += 45;
  score += releaseAudioPreferenceScore(item.title);
  score += Math.min(14, Math.log10(Math.max(1, item.seeders || 0) + 1) * 4);
  score += Math.min(6, Math.log10(Math.max(1, item.downloads || 0) + 1) * 1.2);
  return score;
}

function standaloneReleaseEpisodeNumber(title) {
  const text = String(title || "");
  const patterns = [
    /\b(?:episode|ep)\s*0*(\d{1,3})\b/i,
    /(?:^|\s)[-–—]\s*0*(\d{1,3})(?=\s*(?:\(|\[|$))/i,
    /(?:^|\s)#\s*0*(\d{1,3})(?=\s*(?:\(|\[|$))/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const episode = Number(match?.[1]);
    if (Number.isInteger(episode) && episode > 0) return episode;
  }
  return null;
}

function releaseLooksLikeSingleEpisode(item) {
  const title = String(item?.title || "");
  const parsed = episodeInfo(title);
  if (!parsed.episode && !standaloneReleaseEpisodeNumber(title)) return false;
  if (/\b(?:batch|complete|collection|全集)\b/i.test(title)) return false;
  if (/\b(?:S\s*\d{1,2}\s*)?E?\s*\d{1,3}\s*[-~]\s*(?:S\s*\d{1,2}\s*)?E?\s*\d{1,3}\b/i.test(title)) return false;
  if ((title.match(/\bS\s*\d{1,2}\s*E\s*\d{1,3}\b/gi) || []).length > 1) return false;
  return true;
}

function releaseCoverage(item, categoryName) {
  const text = String(item?.title || "");
  const requestedSeason = categorySeasonNumber(categoryName);
  const episodes = new Set();
  let season = null;
  for (const match of text.matchAll(/\bS\s*0*(\d{1,2})\s*E\s*0*(\d{1,3})\s*[-~]\s*(?:(?:S\s*0*(\d{1,2})\s*)?E?\s*0*(\d{1,3}))\b/gi)) {
    const startSeason = Number(match[1]);
    const endSeason = Number(match[3] || startSeason);
    const start = Number(match[2]);
    const end = Number(match[4]);
    if (season === null) season = startSeason;
    if (startSeason !== endSeason || end < start || end - start > 1000) continue;
    for (let episode = start; episode <= end; episode += 1) episodes.add(episode);
  }
  for (const match of text.matchAll(/\bS\s*0*(\d{1,2})\s*E\s*0*(\d{1,3})\b/gi)) {
    if (season === null) season = Number(match[1]);
    episodes.add(Number(match[2]));
  }
  const parsed = episodeInfo(text);
  if (parsed.season && season === null) season = parsed.season;
  if (parsed.episode && (!parsed.season || !requestedSeason || parsed.season === requestedSeason)) episodes.add(parsed.episode);
  if (!parsed.episode) {
    const standaloneEpisode = standaloneReleaseEpisodeNumber(text);
    if (standaloneEpisode) episodes.add(standaloneEpisode);
  }
  const volumeOnly = /\b(?:vol(?:ume)?|disc|part)\s*\.?\s*0*\d{1,3}\b/i.test(text)
    && !/\b(?:batch|complete|collection|全集)\b/i.test(text);
  const explicitBatch = !volumeOnly && (/\b(?:batch|complete|collection|全集)\b/i.test(text)
    || (/\bseason\s*0*\d{1,2}\b/i.test(text) && !/\bS\s*0*\d{1,2}\s*E\s*0*\d{1,3}\b/i.test(text)));
  return {
    season,
    episodes: [...episodes].filter((episode) => Number.isInteger(episode) && episode > 0).sort((a, b) => a - b),
    batchLike: explicitBatch,
  };
}

function releaseMatchesMissing(item, categoryName, missingEpisodes) {
  const missing = [...new Set((Array.isArray(missingEpisodes) ? missingEpisodes : [])
    .map((episode) => Number(episode))
    .filter((episode) => Number.isInteger(episode) && episode > 0))];
  if (!missing.length) return true;
  const coverage = releaseCoverage(item, categoryName);
  const requestedSeason = categorySeasonNumber(categoryName);
  if (coverage.season && requestedSeason && coverage.season !== requestedSeason) return false;
  const covered = missing.filter((episode) => coverage.episodes.includes(episode));
  if (covered.length === missing.length) return true;
  return coverage.batchLike && !coverage.episodes.length;
}

function releaseSearchQueries(source, categoryName, missingEpisodes = []) {
  const title = String(source.malTitle || source.title || "").trim();
  const season = categorySeasonNumber(categoryName);
  const seasonLabel = season ? `Season ${season}` : String(categoryName || "").trim();
  const compactWords = title
    .replace(/[’']s\b/gi, "")
    .replace(/\*+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !new Set(["a", "an", "and", "are", "the", "is", "of", "on", "or", "to", "with", "s"]).has(word.toLowerCase()));
  const compactTitle = [...new Set(compactWords)].slice(0, 2).join(" ");
  const queries = [
    seasonLabel ? `${title} ${seasonLabel}` : title,
    title,
  ];
  if (compactTitle && normalizeTitle(compactTitle) !== normalizeTitle(title)) {
    queries.push(seasonLabel ? `${compactTitle} ${seasonLabel}` : compactTitle);
  }
  for (const episode of [...new Set(missingEpisodes.map((number) => Number(number)))].filter((number) => Number.isInteger(number) && number > 0).slice(0, 12)) {
    const episodeLabel = `S${String(season || 1).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    queries.push(`${title} ${episodeLabel}`);
    if (compactTitle) queries.push(`${compactTitle} ${episodeLabel}`);
  }
  return queries.filter((query, index, all) => query && all.indexOf(query) === index);
}

function rankReleaseCandidate(item, source, categoryName, missingEpisodes) {
  if (!releaseMatchesMissing(item, categoryName, missingEpisodes)) return null;
  const coverage = releaseCoverage(item, categoryName);
  const baseScore = automaticReleaseScore(item, source, categoryName);
  if (!Number.isFinite(baseScore)) return null;
  const coveredEpisodes = coverage.episodes.length
    ? missingEpisodes.filter((episode) => coverage.episodes.includes(Number(episode)))
    : coverage.batchLike ? [...missingEpisodes] : [];
  const covered = coveredEpisodes.length;
  let score = baseScore + covered * 45;
  if (covered === missingEpisodes.length && missingEpisodes.length > 1) score += 45;
  if (coverage.batchLike) score += 15;
  return {
    item,
    score,
    dualAudio: releaseHasDualAudio(item),
    availabilityScore: releaseAvailabilityScore(item),
    coverage,
    coveredEpisodes,
  };
}

function rankIndividualReleaseCandidate(item, source, categoryName, episode) {
  const candidate = rankReleaseCandidate(item, source, categoryName, [episode]);
  if (!candidate || !releaseLooksLikeSingleEpisode(item)) return null;
  if (candidate.coverage.episodes.length !== 1 || candidate.coverage.episodes[0] !== Number(episode)) return null;
  return candidate;
}

function betterReleaseCandidate(candidate, current) {
  if (!current) return true;
  if (candidate.dualAudio !== current.dualAudio) return candidate.dualAudio;
  const candidateAvailability = releaseAvailabilityTier(candidate.item);
  const currentAvailability = releaseAvailabilityTier(current.item);
  if (candidateAvailability !== currentAvailability) return candidateAvailability > currentAvailability;
  const candidateSeeders = Math.max(0, Number(candidate.item?.seeders) || 0);
  const currentSeeders = Math.max(0, Number(current.item?.seeders) || 0);
  if (candidateSeeders !== currentSeeders) return candidateSeeders > currentSeeders;
  const candidateDownloads = Math.max(0, Number(candidate.item?.downloads) || 0);
  const currentDownloads = Math.max(0, Number(current.item?.downloads) || 0);
  if (candidateDownloads !== currentDownloads) return candidateDownloads > currentDownloads;
  if (candidate.score !== current.score) return candidate.score > current.score;
  return candidate.availabilityScore > current.availabilityScore;
}

function normalizedEpisodeNumbers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((episode) => Number(episode))
    .filter((episode) => Number.isInteger(episode) && episode > 0))].sort((a, b) => a - b);
}

function releaseTargetEpisodes(release, categoryName, missingEpisodes = []) {
  const explicit = normalizedEpisodeNumbers(release?.targetEpisodes);
  if (explicit.length) return explicit;
  const missing = normalizedEpisodeNumbers(missingEpisodes);
  const coverage = releaseCoverage(release, categoryName);
  return coverage.batchLike || missing.length === 1 ? missing : [];
}

function releasePlanEntry(candidate, query, missingEpisodes, categoryName = "") {
  const targetEpisodes = releaseTargetEpisodes({ ...candidate.item, targetEpisodes: candidate.coveredEpisodes }, categoryName, missingEpisodes);
  return {
    ...candidate.item,
    score: candidate.score,
    query,
    targetEpisodes,
  };
}

function splitReleasePlanByEpisode(candidate, query, missingEpisodes, categoryName = "") {
  return normalizedEpisodeNumbers(missingEpisodes).map((episode) => releasePlanEntry(
    { ...candidate, coveredEpisodes: [episode] },
    query,
    [episode],
    categoryName,
  ));
}

async function findIndividualReleasePlan(source, categoryName, missingEpisodes = []) {
  const missing = normalizedEpisodeNumbers(missingEpisodes);
  if (!missing.length) return { releases: [], unresolved: [] };
  const releases = [];
  const unresolved = [];
  for (const episode of missing) {
    let selected = null;
    const queries = releaseSearchQueries(source, categoryName, [episode]).reverse();
    for (const query of queries) {
      try {
        const items = await releaseSearch(query, categoryName);
        const candidates = items
          .map((item) => rankIndividualReleaseCandidate(item, source, categoryName, episode))
          .filter(Boolean);
        const availableCandidates = candidates.filter((candidate) => releaseHasUsableAvailability(candidate.item));
        const consideredCandidates = availableCandidates.length ? availableCandidates : candidates;
        const preferredCandidates = consideredCandidates.some((candidate) => candidate.dualAudio)
          ? consideredCandidates.filter((candidate) => candidate.dualAudio)
          : consideredCandidates;
        for (const candidate of preferredCandidates) {
          if (!betterReleaseCandidate(candidate, selected)) continue;
          selected = { ...candidate, query };
        }
        if (selected?.dualAudio && selected.score >= 22) break;
      } catch {
        // A failed provider/query is not enough to abandon the other release sources.
      }
    }
    if (selected) releases.push(releasePlanEntry(selected, selected.query, [episode], categoryName));
    else unresolved.push(episode);
  }
  return { releases, unresolved };
}

async function findBestHealthyBatchRelease(source, categoryName, missingEpisodes = []) {
  const missing = normalizedEpisodeNumbers(missingEpisodes);
  if (missing.length < 2) return null;
  let best = null;
  for (const query of releaseSearchQueries(source, categoryName, missing)) {
    try {
      const items = await releaseSearch(query, categoryName);
      for (const item of items) {
        const candidate = rankReleaseCandidate(item, source, categoryName, missing);
        if (!candidate?.dualAudio || !releaseHasUsableAvailability(item)) continue;
        if (!candidate.coverage.batchLike && candidate.coveredEpisodes.length < 2) continue;
        if (!best || betterReleaseCandidate(candidate, best)
          || (candidate.coveredEpisodes.length > best.coveredEpisodes.length
            && releaseAvailabilityTier(candidate.item) >= releaseAvailabilityTier(best.item))) {
          best = { ...candidate, query };
        }
      }
    } catch {
      // Keep searching other providers and query forms.
    }
  }
  return best;
}

async function findAutomaticReleasePlan(source, categoryName, missingEpisodes = []) {
  const missing = [...new Set(missingEpisodes.map((episode) => Number(episode)))].filter((episode) => Number.isInteger(episode) && episode > 0);
  const individualPlan = await findIndividualReleasePlan(source, categoryName, missing);
  let individualReleases = individualPlan?.releases || [];
  const healthyBatch = await findBestHealthyBatchRelease(source, categoryName, missing);
  if (healthyBatch) {
    const coveredByBatch = missing.filter((episode) => healthyBatch.coveredEpisodes.includes(episode));
    const batchSeeders = Math.max(0, Number(healthyBatch.item?.seeders) || 0);
    const individualSeeders = Math.max(0, ...individualReleases
      .filter((release) => releaseTargetEpisodes(release, categoryName, missing).some((episode) => coveredByBatch.includes(episode)))
      .map((release) => Number(release.seeders) || 0));
    const batchIsBetter = coveredByBatch.length > 1
      && (batchSeeders >= individualSeeders || individualSeeders === 0);
    if (batchIsBetter) {
      const coveredSet = new Set(coveredByBatch);
      individualReleases = [
        releasePlanEntry({ ...healthyBatch, coveredEpisodes: coveredByBatch }, healthyBatch.query, coveredByBatch, categoryName),
        ...individualReleases.filter((release) => !releaseTargetEpisodes(release, categoryName, missing)
          .some((episode) => coveredSet.has(episode))),
      ];
    }
  }
  const nonDualEpisodes = normalizedEpisodeNumbers(individualReleases
    .filter((release) => !releaseHasDualAudio(release))
    .flatMap((release) => releaseTargetEpisodes(release, categoryName, missing)));
  if (nonDualEpisodes.length) {
    let bestDualBatch = null;
    for (const query of releaseSearchQueries(source, categoryName, missing)) {
      try {
        const items = await releaseSearch(query, categoryName);
        for (const item of items) {
          const candidate = rankReleaseCandidate(item, source, categoryName, missing);
          if (!candidate?.dualAudio || !candidate.coveredEpisodes.some((episode) => nonDualEpisodes.includes(episode))) continue;
          if (!bestDualBatch || betterReleaseCandidate(candidate, bestDualBatch)) bestDualBatch = { ...candidate, query };
        }
      } catch {
        // Keep the individual results if the broader season search is unavailable.
      }
    }
    if (bestDualBatch) {
      const covered = new Set(bestDualBatch.coveredEpisodes.length ? bestDualBatch.coveredEpisodes : missing);
      const replaceEpisodes = nonDualEpisodes.filter((episode) => covered.has(episode));
      if (replaceEpisodes.length) {
        const replaceSet = new Set(replaceEpisodes);
        individualReleases = [
          ...individualReleases.filter((release) => !releaseTargetEpisodes(release, categoryName, missing)
            .some((episode) => replaceSet.has(episode))),
          ...splitReleasePlanByEpisode(bestDualBatch, bestDualBatch.query, replaceEpisodes, categoryName),
        ];
      }
    }
  }
  const pending = individualPlan?.unresolved?.length ? individualPlan.unresolved : [];
  if (!pending.length) return individualReleases;
  const queries = releaseSearchQueries(source, categoryName, pending);
  let best = null;
  let lastError = null;
  for (const query of queries) {
    try {
      const items = await releaseSearch(query, categoryName);
      for (const item of items) {
        const candidate = rankReleaseCandidate(item, source, categoryName, pending);
        if (!candidate || !betterReleaseCandidate(candidate, best)) continue;
        best = { ...candidate, query };
      }
      if (best && best.dualAudio && best.coveredEpisodes.length === pending.length && best.score >= 32) {
        return [...individualReleases, ...splitReleasePlanByEpisode(best, best.query, pending, categoryName)];
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (best && best.coveredEpisodes.length === pending.length && best.score >= 22) {
    return [...individualReleases, ...splitReleasePlanByEpisode(best, best.query, pending, categoryName)];
  }

  if (pending.length > 1) {
    const individual = [];
    for (const episode of pending) {
      let selected = null;
      for (const query of releaseSearchQueries(source, categoryName, [episode])) {
        try {
          const items = await releaseSearch(query, categoryName);
          const candidates = items
            .map((item) => rankIndividualReleaseCandidate(item, source, categoryName, episode))
            .filter(Boolean);
          const availableCandidates = candidates.filter((candidate) => releaseHasUsableAvailability(candidate.item));
          const consideredCandidates = availableCandidates.length ? availableCandidates : candidates;
          const preferredCandidates = consideredCandidates.some((candidate) => candidate.dualAudio)
            ? consideredCandidates.filter((candidate) => candidate.dualAudio)
            : consideredCandidates;
          for (const candidate of preferredCandidates) {
            if (!betterReleaseCandidate(candidate, selected)) continue;
            selected = { ...candidate, query };
          }
          if (selected && selected.dualAudio && selected.coveredEpisodes.includes(episode) && selected.score >= 22) break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!selected || !selected.coveredEpisodes.includes(episode)) {
        throw new Error(`no confident release found for ${source.title} · ${categoryName} · Episode ${episode}${lastError ? ` (${lastError.message})` : ""}`);
      }
      individual.push(releasePlanEntry(selected, selected.query, [episode], categoryName));
    }
    return [...individualReleases, ...individual];
  }

  if (lastError) throw lastError;
  throw new Error(`no confident release found for ${source.title} · ${categoryName}${pending.length ? ` · Episode ${pending[0]}` : ""}`);
}

function episodeInfo(value) {
  const text = String(value || "");
  const seasonMatch = text.match(/\bS(?:eason)?\s*0*(\d{1,2})(?=E|\b)/i);
  const seasonEpisode = text.match(/\bS\s*0*(\d{1,2})\s*[-_. ]*E\s*0*(\d{1,3})(?=\D|$)/i);
  const explicitEpisode = text.match(/(?:^|[\s._\-[\]()])(?:EP(?:ISODE)?|E)[\s._-]*0*(\d{1,3})(?!\d)/i);
  const bracketEpisode = text.match(/[\[(]\s*0*(\d{1,3})(?:v\d+)?\s*[\])]/i);
  const standaloneEpisode = text.match(/(?:^|[\s._-])0*(\d{1,3})(?=\s*(?:[\[(.]|$))/i);
  const rawEpisode = seasonEpisode?.[2] || explicitEpisode?.[1] || bracketEpisode?.[1] || standaloneEpisode?.[1];
  const episode = rawEpisode ? Number(rawEpisode) : null;
  const season = seasonEpisode?.[1] || (seasonMatch ? seasonMatch[1] : null);
  return {
    season: Number.isInteger(Number(season)) && Number(season) > 0 ? Number(season) : null,
    episode: Number.isInteger(episode) && episode > 0 && episode < 1000 ? episode : null,
  };
}

function getEntries(category) {
  if (Array.isArray(category?.episodes)) return { key: "episodes", entries: category.episodes };
  if (Array.isArray(category?.items)) return { key: "items", entries: category.items };
  if (category && typeof category === "object") {
    category.episodes = [];
    return { key: "episodes", entries: category.episodes };
  }
  return { key: "episodes", entries: [] };
}

function sourceFileFromInput(input) {
  let file = String(input || "").trim().replace(/^\.\//, "");
  if (file.startsWith(SOURCE_PREFIX)) file = file.slice(SOURCE_PREFIX.length);
  if (!file || file.includes("/") || extname(file).toLowerCase() !== ".json") {
    throw new Error("sourcePath must be an anime JSON filename");
  }
  const absolute = resolve(SOURCE_DIR, file);
  if (!absolute.startsWith(`${SOURCE_DIR}${sep}`)) throw new Error("sourcePath is outside the anime source directory");
  return { file, absolute, path: `${SOURCE_PREFIX}${file}` };
}

function slugFileName(title) {
  const slug = String(title || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "New_Show";
  return `${slug}.json`;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function durationValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function probeMediaDurationSeconds(filePath) {
  const input = String(filePath || "").trim();
  if (!input) return Promise.reject(new Error("media path is empty"));
  return new Promise((resolveDuration, reject) => {
    let output = "";
    let errors = "";
    let settled = false;
    const child = spawn(FFPROBE_BIN, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`ffprobe timed out after ${MEDIA_PROBE_TIMEOUT_MS}ms`));
    }, MEDIA_PROBE_TIMEOUT_MS);
    const finish = (error, value = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveDuration(value);
    };
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      const duration = durationValue(output.trim().split(/\s+/)[0]);
      if (code === 0 && duration > 0) {
        finish(null, duration);
      } else {
        const detail = errors.trim().replace(/\s+/g, " ").slice(-240);
        finish(new Error(`ffprobe exited with code ${code ?? 1}${detail ? `: ${detail}` : ""}`));
      }
    });
  });
}

function probeMediaAudioStreamCount(filePath) {
  const input = String(filePath || "").trim();
  if (!input) return Promise.reject(new Error("media path is empty"));
  return new Promise((resolveCount, reject) => {
    let output = "";
    let errors = "";
    let settled = false;
    const child = spawn(FFPROBE_BIN, [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`ffprobe audio inspection timed out after ${MEDIA_PROBE_TIMEOUT_MS}ms`));
    }, MEDIA_PROBE_TIMEOUT_MS);
    const finish = (error, value = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolveCount(value);
    };
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errors += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      const count = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
      if (code === 0) finish(null, count);
      else {
        const detail = errors.trim().replace(/\s+/g, " ").slice(-240);
        finish(new Error(`ffprobe audio inspection exited with code ${code ?? 1}${detail ? `: ${detail}` : ""}`));
      }
    });
  });
}

function scheduleArtifactDurationProbe(job, artifact, event = {}) {
  if (!artifact || typeof artifact !== "object") return;
  const reported = durationValue(event.durationSeconds ?? event.duration ?? artifact.durationSeconds);
  if (reported > 0) {
    artifact.durationSeconds = reported;
    return;
  }
  const input = cacheScopedPath(job, artifact.localPath) || (isAbsolute(String(artifact.localPath || "").trim()) ? String(artifact.localPath).trim() : "");
  if (!input) return;
  job.durationProbePromises ||= new Map();
  if (job.durationProbePromises.has(artifact)) return;
  const promise = probeMediaDurationSeconds(input).then((duration) => {
    if (duration > 0) artifact.durationSeconds = duration;
    persistLog({
      scope: "job",
      event: duration > 0 ? "duration_probed" : "duration_probe_empty",
      jobId: job.id,
      runId: job.runId,
      remotePath: artifact.remotePath,
      localPath: artifact.localPath,
      durationSeconds: duration || undefined,
    });
    return duration;
  }).catch((error) => {
    persistLog({
      scope: "job",
      event: "duration_probe_failed",
      jobId: job.id,
      runId: job.runId,
      remotePath: artifact.remotePath,
      localPath: artifact.localPath,
      message: error instanceof Error ? error.message : String(error),
    });
    return 0;
  });
  job.durationProbePromises.set(artifact, promise);
}

function scheduleArtifactAudioProbe(job, artifact) {
  if (!artifact || typeof artifact !== "object") return;
  // Newer td builds report the verified post-hook audio count before they
  // delete their local upload artifact. Trust that value instead of starting
  // a second probe that could race cleanup and overwrite it with zero.
  if (Number.isInteger(Number(artifact.audioStreamCount)) && Number(artifact.audioStreamCount) >= 0) return;
  const input = cacheScopedPath(job, artifact.localPath) || (isAbsolute(String(artifact.localPath || "").trim()) ? String(artifact.localPath).trim() : "");
  if (!input) return;
  job.audioProbePromises ||= new Map();
  if (job.audioProbePromises.has(artifact)) return;
  const promise = probeMediaAudioStreamCount(input).then((count) => {
    artifact.audioStreamCount = count;
    persistLog({ scope: "job", event: "audio_streams_probed", jobId: job.id, runId: job.runId, remotePath: artifact.remotePath, localPath: artifact.localPath, audioStreamCount: count });
    return count;
  }).catch((error) => {
    artifact.audioStreamCount = 0;
    persistLog({ scope: "job", event: "audio_stream_probe_failed", jobId: job.id, runId: job.runId, remotePath: artifact.remotePath, localPath: artifact.localPath, message: error instanceof Error ? error.message : String(error) });
    return 0;
  });
  job.audioProbePromises.set(artifact, promise);
}

function entrySize(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if (Array.isArray(entry.sources)) return entry.sources.reduce((sum, part) => sum + entrySize(part), 0);
  if (Array.isArray(entry.parts)) return entry.parts.reduce((sum, part) => sum + entrySize(part), 0);
  return numericValue(entry.fileSizeBytes || entry.sizeBytes || entry.FileSizeBytes);
}

function entryDuration(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if (Array.isArray(entry.sources)) return entry.sources.reduce((sum, part) => sum + entryDuration(part), 0);
  if (Array.isArray(entry.parts)) return entry.parts.reduce((sum, part) => sum + entryDuration(part), 0);
  return durationValue(entry.durationSeconds || entry.DurationSeconds);
}

function totalSize(data) {
  return (Array.isArray(data?.categories) ? data.categories : []).reduce((sum, category) => {
    const { entries } = getEntries(category);
    return sum + entries.reduce((entrySum, entry) => entrySum + entrySize(entry), 0);
  }, 0);
}

function totalDuration(data) {
  return (Array.isArray(data?.categories) ? data.categories : []).reduce((sum, category) => {
    const { entries } = getEntries(category);
    return sum + entries.reduce((entrySum, entry) => entrySum + entryDuration(entry), 0);
  }, 0);
}

function hasCompleteDurations(data) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  return categories.every((category) => {
    const { entries } = getEntries(category);
    return entries.every((entry) => entryDuration(entry) > 0);
  });
}

function audioClassification(entry) {
  if (entry?.dualAudio === true || String(entry?.audioStatus || "").toLowerCase() === "dual") return "dual";
  if (entry?.dualAudio === false || String(entry?.audioStatus || "").toLowerCase() === "single") return "single";
  return "unconfirmed";
}

function categorySummary(category, index) {
  const { entries } = getEntries(category);
  const categoryName = String(category?.category || `Season ${index + 1}`);
  const isMovie = /\bmovies?\b/i.test(categoryName);
  // Movie manifests historically store a single item under a `Movie`
  // category without an episode number. Give those items a stable synthetic
  // number so the catalog can target a dual-audio replacement without
  // appending a duplicate entry.
  const numberedEntries = isMovie
    ? entries.map((entry, entryIndex) => ({ entry, episode: entryIndex + 1 }))
    : entries.map((entry) => ({ entry, episode: episodeInfo(entry?.title).episode }));
  const parsed = numberedEntries.filter((item) => item.episode).map((item) => ({ episode: item.episode }));
  const episodeNumbers = [...new Set(parsed.map((info) => info.episode))].sort((a, b) => a - b);
  const dualAudioEpisodeNumbers = [...new Set(numberedEntries
    .map(({ entry, episode }) => ({ episode, status: audioClassification(entry) }))
    .filter((entry) => entry.episode && entry.status === "dual")
    .map((entry) => entry.episode))].sort((a, b) => a - b);
  const nonDualEpisodeNumbers = [...new Set(numberedEntries
    .map(({ entry, episode }) => ({ episode, status: audioClassification(entry) }))
    .filter((entry) => entry.episode && entry.status === "single")
    .map((entry) => entry.episode))].sort((a, b) => a - b);
  const unconfirmedAudioEpisodeNumbers = [...new Set(numberedEntries
    .map(({ entry, episode }) => ({ episode, status: audioClassification(entry) }))
    .filter((entry) => entry.episode && entry.status === "unconfirmed")
    .map((entry) => entry.episode))].sort((a, b) => a - b);
  return {
    index,
    category: categoryName,
    episodeCount: entries.length,
    latestEpisode: parsed.length ? Math.max(...parsed.map((info) => info.episode)) : null,
    episodeNumbers,
    dualAudio: entries.length > 0 && entries.every((entry) => entry?.dualAudio === true),
    dualAudioEpisodeNumbers,
    nonDualEpisodeNumbers,
    dualAudioCount: dualAudioEpisodeNumbers.length,
    singleAudioCount: nonDualEpisodeNumbers.length,
    unconfirmedAudioEpisodeNumbers,
    unconfirmedAudioCount: unconfirmedAudioEpisodeNumbers.length,
  };
}

async function listLibrary() {
  const names = await readdir(SOURCE_DIR);
  const sources = [];
  const errors = [];
  for (const file of names.filter((name) => name.toLowerCase().endsWith(".json") && name.toLowerCase() !== "exampledir.json").sort()) {
    try {
      const data = JSON.parse(await readFile(resolve(SOURCE_DIR, file), "utf8"));
      const categories = Array.isArray(data.categories) ? data.categories : [];
      sources.push({
        file,
        path: `${SOURCE_PREFIX}${file}`,
        title: String(data.title || file.replace(/\.json$/i, "")),
        malTitle: String(data.malTitle || data.MALTitle || "").trim(),
        anilistTitle: String(data.anilistTitle || data.AniListTitle || "").trim(),
        anilistIds: [...new Set([
          data.anilistId,
          data.rootAnilistId,
          ...(Array.isArray(data.anilistIds) ? data.anilistIds : []),
          ...categories.flatMap((category) => [category?.anilistId, ...(Array.isArray(category?.anilistIds) ? category.anilistIds : [])]),
        ].map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))],
        image: data.Image || data.image || data.poster || "",
        hidden: data.hidden === true || data.Hidden === true || data.maintainerHidden === true,
        dualAudio: categories.some((category) => categorySummary(category, 0).dualAudio === true),
        dualAudioCount: categories.reduce((sum, category) => sum + categorySummary(category, 0).dualAudioCount, 0),
        singleAudioCount: categories.reduce((sum, category) => sum + categorySummary(category, 0).singleAudioCount, 0),
        unconfirmedAudioCount: categories.reduce((sum, category) => sum + categorySummary(category, 0).unconfirmedAudioCount, 0),
        latestTime: data.LatestTime || data.latestTime || "",
        categories: categories.map(categorySummary),
      });
    } catch (error) {
      errors.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sources, errors };
}

function automaticCategories(source, allCategories = false) {
  const categories = Array.isArray(source?.categories) ? source.categories : [];
  const usable = categories.filter((category) => !/\bmovies?\b/i.test(String(category.category || "")));
  const seasonal = usable.filter((category) => categorySeasonNumber(category.category));
  // Maintenance is episode/season based.  Non-season categories such as
  // Shorts, Specials, OVAs, and custom movie collections must not be mapped
  // onto a regular AniList TV entry just because the source also has a season.
  if (!seasonal.length) return [];
  if (allCategories) return seasonal;
  const latest = Math.max(...seasonal.map((category) => categorySeasonNumber(category.category)));
  return seasonal.filter((category) => categorySeasonNumber(category.category) === latest);
}

function maintenanceFolder(title, category) {
  return `${String(title || "Show").trim() || "Show"}/${String(category || "Season 1").trim() || "Season 1"}`;
}

function runEvent(run, message, extra = {}) {
  const event = { at: new Date().toISOString(), event: "run", message, ...extra };
  run.events.push(event);
  if (run.events.length > 2000) run.events.shift();
  persistLog({ scope: "run", runId: run.id, ...event });
  void persistResumeState();
}

function maintenanceConcurrency(payload = {}) {
  const requested = Number(payload?.concurrency ?? process.env.MAINTENANCE_CONCURRENCY ?? DEFAULT_MAINTENANCE_CONCURRENCY);
  if (!Number.isFinite(requested)) return DEFAULT_MAINTENANCE_CONCURRENCY;
  return Math.min(MAX_MAINTENANCE_CONCURRENCY, Math.max(1, Math.floor(requested)));
}

function torrentConcurrency(payload = {}) {
  const requested = Number(payload?.torrentConcurrency ?? process.env.MAINTENANCE_TORRENT_CONCURRENCY ?? DEFAULT_TORRENT_CONCURRENCY);
  if (!Number.isFinite(requested)) return DEFAULT_TORRENT_CONCURRENCY;
  return Math.min(MAX_TORRENT_CONCURRENCY, Math.max(1, Math.floor(requested)));
}

function syncRunActivity(run) {
  const activeStates = new Set(["searching", "downloading", "processing", "uploading"]);
  const active = (run.items || [])
    .filter((item) => activeStates.has(item.state))
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      state: item.state,
      jobId: item.jobId || null,
      jobIds: Array.isArray(item.jobIds) ? item.jobIds : (item.jobId ? [item.jobId] : []),
      newSeason: item.newSeason === true,
      missingEpisodes: item.missingEpisodes || [],
      provider: item.candidate?.provider || item.release?.provider || null,
    }));
  run.active = active;
  run.activeJobIds = active.flatMap((item) => item.jobIds || []).filter(Boolean);
  run.current = active[0]?.id || null;
  run.currentJobId = active[0]?.jobId || null;
}

function maintenanceRunIsTerminal(run) {
  return Boolean(run?.finishedAt) || ["complete", "complete_with_errors", "failed", "cancelled"].includes(run?.state);
}

function maintenanceRunSourcePaths(runOrPayload) {
  const paths = Array.isArray(runOrPayload?.payload?.sourcePaths)
    ? runOrPayload.payload.sourcePaths
    : Array.isArray(runOrPayload?.sourcePaths) ? runOrPayload.sourcePaths : [];
  return new Set(paths.map((path) => String(path).trim()).filter(Boolean));
}

function maintenanceRunsOverlap(left, right) {
  const leftPaths = maintenanceRunSourcePaths(left);
  const rightPaths = maintenanceRunSourcePaths(right);
  // A whole-library run overlaps every source-specific run.  This keeps the
  // scheduler from creating duplicate torrent work through a second browser
  // tab, automatic recovery, or a repeated button press.
  if (!leftPaths.size || !rightPaths.size) return true;
  return [...leftPaths].some((path) => rightPaths.has(path));
}

function findOverlappingMaintenanceRun(payload = {}) {
  const operation = String(payload.operation || "").trim().toLowerCase();
  if (operation === "add") return null;
  return [...maintenanceRuns.values()]
    .filter((run) => !maintenanceRunIsTerminal(run))
    .filter((run) => String(run.payload?.operation || "update").trim().toLowerCase() !== "add")
    .filter((run) => maintenanceRunsOverlap(run, payload))
    .sort((left, right) => Date.parse(right.startedAt || "") - Date.parse(left.startedAt || ""))[0] || null;
}

function deduplicateMaintenanceRuns() {
  const active = [...maintenanceRuns.values()]
    .filter((run) => !maintenanceRunIsTerminal(run))
    .sort((left, right) => Date.parse(right.startedAt || "") - Date.parse(left.startedAt || ""));
  const kept = [];
  for (const run of active) {
    if (kept.some((candidate) => maintenanceRunsOverlap(candidate, run))) {
      runEvent(run, "Cancelled as an overlapping maintenance run; the newest run owns this library work.");
      run.stop?.();
      run.state = "cancelled";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      continue;
    }
    kept.push(run);
  }
  return kept;
}

function markMaintenanceRunPaused(run, message = "Maintenance paused. Active transfer work has finished; update settings and resume when ready.") {
  run.paused = true;
  run.pauseRequested = false;
  run.pauseDraining = false;
  run.state = "paused";
  run.phase = "paused";
  syncRunActivity(run);
  runEvent(run, message);
}

function requestMaintenancePause(run) {
  if (maintenanceRunIsTerminal(run)) throw new Error("maintenance run is already finished");
  if (run.paused || run.state === "paused") return run;
  run.pauseRequested = true;
  run.paused = true;
  run.pauseDraining = Boolean(run.planningActive || run.executionActive);
  run.state = "paused";
  run.phase = "pausing";
  runEvent(run, run.pauseDraining
    ? "Pause requested. The current operation is finishing; no new maintenance work will be scheduled."
    : "Maintenance paused. Update settings and resume when ready.");
  if (!run.pauseDraining) markMaintenanceRunPaused(run);
  void persistResumeState();
  return run;
}

function updateMaintenanceRunSettings(run, settings = {}) {
  if (!settings || typeof settings !== "object") return;
  const next = { ...(run.payload || {}) };
  for (const key of ["torrentConcurrency", "replaceExisting", "addMissing", "allCategories"]) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = settings[key];
  }
  run.payload = next;
  run.concurrency = maintenanceConcurrency(next);
  run.torrentConcurrency = torrentConcurrency(next);
}

async function resumePausedMaintenanceRun(run, settings = {}) {
  if (maintenanceRunIsTerminal(run)) throw new Error("maintenance run is already finished");
  if (!run.paused || run.state !== "paused") throw new Error("maintenance run is not paused yet");
  if (run.pauseDraining) throw new Error("maintenance run is still finishing its current operation");
  updateMaintenanceRunSettings(run, settings);
  // Stopping child jobs is how a pause drains in-flight work.  Those children
  // report `cancelled` while the parent run is deliberately paused, so never
  // carry that transient cancellation marker into the resumed execution.
  run.cancelled = false;
  run.paused = false;
  run.pauseRequested = false;
  run.state = "running";
  run.phase = "maintenance";
  runEvent(run, `Resuming maintenance with up to ${run.torrentConcurrency} torrent job${run.torrentConcurrency === 1 ? "" : "s"} at a time.`);
  await persistResumeState();
  startExecuteMaintenanceRun(run, run.payload);
  return run;
}

async function resetFailedMaintenanceRun(run) {
  if (maintenanceRunIsTerminal(run)) throw new Error("maintenance run is already finished");
  if (!run.paused || run.state !== "paused") throw new Error("pause the maintenance run before resetting failures");
  if (run.pauseDraining || run.executionActive || run.planningActive) {
    throw new Error("maintenance run is still finishing its current operation");
  }

  const catalogState = await loadCatalogState();
  let resetItems = 0;
  let resetReleases = 0;
  for (const item of run.items || []) {
    const catalogEntry = item.catalogKey ? catalogState.entries[item.catalogKey] : null;
    // An interrupted item can have been marked active just before the pause;
    // clear that stale catalog marker even when its release states were
    // already converted back to queued during recovery.
    if (catalogEntry && catalogEntry.state === "active" && item.state !== "downloading") {
      catalogEntry.state = "queued";
      catalogEntry.lastError = "";
      catalogEntry.nextRetryAt = null;
    }
    const failedStates = (Array.isArray(item.releaseStates) ? item.releaseStates : [])
      .filter((release) => release.state === "failed" || release.state === "cancelled");
    // A paused run can contain cancelled items when an in-flight transfer was
    // stopped to drain the pause. Treat those as interrupted work, not as
    // permanently finished items, so reset-failed can safely queue them too.
    if (item.state !== "failed" && item.state !== "cancelled" && !failedStates.length) continue;
    for (const release of failedStates) {
      release.state = "queued";
      release.jobId = null;
      release.links = 0;
      release.manifest = null;
      release.error = "";
      resetReleases += 1;
    }
    item.state = "queued";
    item.error = "";
    item.counted = false;
    item.jobId = null;
    item.jobIds = [];
    syncMaintenanceReleaseSummary(item);
    resetItems += 1;
    if (catalogEntry) {
      const entry = catalogEntry;
      if (entry.state === "failed") entry.state = "queued";
      entry.lastError = "";
      entry.nextRetryAt = null;
      entry.attempts = 0;
    }
  }
  await persistCatalogState();
  // A paused run may have cancelled its in-flight child jobs while draining;
  // reset-failed turns that interrupted work back into queued work and must
  // also clear the parent's transient cancellation marker before resume.
  run.cancelled = false;
  run.failed = 0;
  run.skipped = (run.items || []).filter((item) => item.state === "skipped").length;
  run.completed = (run.items || []).filter((item) => ["complete", "skipped", "cancelled"].includes(item.state)).length;
  run.current = null;
  run.currentJobId = null;
  run.active = [];
  run.activeJobIds = [];
  syncRunActivity(run);
  runEvent(run, `Reset ${resetItems} failed or interrupted maintenance item${resetItems === 1 ? "" : "s"} and queued ${resetReleases} unfinished release${resetReleases === 1 ? "" : "s"}. Maintenance remains paused until you resume it.`);
  await persistResumeState();
  return run;
}

function stopMaintenanceChildren(run) {
  const activeItemJobs = (run.items || [])
    .filter((item) => ["searching", "downloading", "processing", "uploading"].includes(item.state))
    .flatMap((item) => [item.jobId, ...(Array.isArray(item.jobIds) ? item.jobIds : [])]);
  const jobIds = new Set([
    run.currentJobId,
    ...(run.activeJobIds || []),
    ...activeItemJobs,
  ].filter(Boolean));
  for (const job of jobs.values()) {
    if (job.runId === run.id && !job.finishedAt) jobIds.add(job.id);
  }
  const stopping = [];
  for (const jobId of jobIds) {
    const job = jobs.get(jobId);
    const result = job?.stop?.();
    if (result?.then) stopping.push(result.catch(() => job));
  }
  return Promise.all(stopping);
}

function publicRun(run) {
  return {
    id: run.id,
    state: run.state,
    phase: run.phase,
    total: run.total,
    completed: run.completed,
    failed: run.failed,
    skipped: run.skipped,
    preflightCompleted: run.preflightCompleted,
    preflightTotal: run.preflightTotal,
    preflightCurrent: run.preflightCurrent,
    planOnly: run.planOnly === true,
    current: run.current,
    currentJobId: run.currentJobId,
    active: run.active || [],
    activeJobIds: run.activeJobIds || [],
    concurrency: run.concurrency || maintenanceConcurrency(run.payload || {}),
    torrentConcurrency: run.torrentConcurrency || torrentConcurrency(run.payload || {}),
    items: run.items,
    events: run.events,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    paused: run.paused === true,
    pauseRequested: run.pauseRequested === true,
    pauseDraining: run.pauseDraining === true,
  };
}

function maintenanceAniListEnabled(payload) {
  return process.env.ANILIST_CHECK !== "0" && payload?.anilistCheck !== false && payload?.malCheck !== false;
}

function runTdInfo() {
  return new Promise((resolveCheck) => {
    let settled = false;
    let output = "";
    const child = spawn(TD_BIN, ["--base-url", TOODRIVE_BASE_URL, "--json", "info"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, message: "td info timed out" });
    }, 15_000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveCheck(result);
    };
    const consume = (chunk) => { output += String(chunk); };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      finish({ ok: false, message: error instanceof Error ? error.message : String(error) });
    });
    child.on("close", (code) => {
      const events = output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const errorEvent = events.find((event) => event?.event === "error");
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      finish({
        ok: false,
        code: errorEvent?.code || `exit_${code ?? 1}`,
        message: errorEvent?.message || "td could not validate the Toodrive session",
      });
    });
  });
}

function readCommandSecret(command, args) {
  return new Promise((resolveSecret) => {
    let output = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const finish = (value = "") => resolveSecret(String(value || "").trim());
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => finish());
    child.on("close", (code) => finish(code === 0 ? output : ""));
  });
}

async function toodriveCredentials() {
  if (!TOODRIVE_USERNAME) return { username: "", password: "" };
  if (TOODRIVE_PASSWORD) return { username: TOODRIVE_USERNAME, password: TOODRIVE_PASSWORD };
  if (process.platform === "darwin") {
    const password = await readCommandSecret("/usr/bin/security", [
      "find-generic-password",
      "-s", TOODRIVE_KEYCHAIN_SERVICE,
      "-a", TOODRIVE_USERNAME,
      "-w",
    ]);
    if (password) return { username: TOODRIVE_USERNAME, password };
  }
  return { username: TOODRIVE_USERNAME, password: "" };
}

function responseSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

async function saveToodriveFileSession(jwt) {
  await mkdir(TOODRIVE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(TOODRIVE_SESSION_FILE, `${JSON.stringify({ jwt })}\n`, { mode: 0o600 });
  await chmod(TOODRIVE_SESSION_FILE, 0o600);
  await writeFile(TOODRIVE_CONFIG_FILE, `${JSON.stringify({ baseUrl: TOODRIVE_BASE_URL, authBackend: "file" }, null, 2)}\n`, { mode: 0o600 });
  await chmod(TOODRIVE_CONFIG_FILE, 0o600);
}

async function loginToodrive() {
  const credentials = await toodriveCredentials();
  if (!credentials.username || !credentials.password) {
    return {
      ok: false,
      code: "credentials_unavailable",
      message: "Automatic Toodrive login needs MEDIA_MANAGER_TOODRIVE_USERNAME and a password in the OS keychain or MEDIA_MANAGER_TOODRIVE_PASSWORD.",
    };
  }
  let response;
  try {
    response = await fetch(`${TOODRIVE_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: TOODRIVE_BASE_URL },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { ok: false, code: "login_network_error", message: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) {
    return { ok: false, code: `login_http_${response.status}`, message: `Toodrive login returned HTTP ${response.status}.` };
  }
  const cookie = responseSetCookies(response).find((value) => /^toodrive_jwt=/.test(value));
  const jwt = cookie ? /^toodrive_jwt=([^;]+)/.exec(cookie)?.[1] : "";
  if (!jwt) return { ok: false, code: "missing_session_cookie", message: "Toodrive login did not return a session cookie." };
  try {
    await saveToodriveFileSession(jwt);
  } catch (error) {
    return { ok: false, code: "session_save_failed", message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, relogged: true };
}

let toodriveReloginPromise = null;
function reloginToodrive() {
  if (!toodriveReloginPromise) {
    toodriveReloginPromise = loginToodrive().finally(() => { toodriveReloginPromise = null; });
  }
  return toodriveReloginPromise;
}

async function checkTdSession() {
  const initial = await runTdInfo();
  if (initial.ok || !TOODRIVE_AUTO_LOGIN || !["session_expired", "not_logged_in"].includes(initial.code)) return initial;
  const login = await reloginToodrive();
  if (!login.ok) return { ...initial, relogin: login };
  const verified = await runTdInfo();
  return verified.ok ? { ...verified, relogged: true } : verified;
}

function maintenanceToodriveAuditEnabled(payload = {}) {
  if (payload?.toodriveAudit === false) return false;
  if (process.env.MAINTENANCE_TOODRIVE_AUDIT === "0") return false;
  return process.env.MEDIA_MANAGER_TEST !== "1";
}

function listToodriveFolder(remotePath) {
  return new Promise((resolveList) => {
    let settled = false;
    let output = "";
    const child = spawn(TD_BIN, ["--base-url", TOODRIVE_BASE_URL, "--json", "ls", remotePath], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, code: "timeout", error: "td ls timed out" });
    }, 15_000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveList(result);
    };
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => finish({ ok: false, code: "spawn", error: error instanceof Error ? error.message : String(error) }));
    child.on("close", (code) => {
      const events = output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const event = events.find((candidate) => candidate?.event === "result" || candidate?.event === "error");
      if (event?.event === "result" && Array.isArray(event.entries)) {
        finish({ ok: true, entries: event.entries, path: event.path || remotePath });
        return;
      }
      finish({
        ok: false,
        code: event?.code || `exit_${code ?? 1}`,
        error: event?.message || "td could not inspect the Toodrive folder",
      });
    });
  });
}

async function auditToodriveCategory(title, category) {
  const remotePath = maintenanceFolder(title, category);
  const result = await listToodriveFolder(remotePath);
  if (!result.ok) return { ok: false, remotePath, error: result.error, code: result.code };
  const files = result.entries.filter((entry) => entry?.kind === "file");
  const readyEpisodeNumbers = new Set();
  const incompleteEpisodeNumbers = new Set();
  for (const file of files) {
    const episode = episodeInfo(file.name || file.path).episode;
    if (!episode) continue;
    if (String(file.status || "").toLowerCase() === "ready") readyEpisodeNumbers.add(episode);
    else incompleteEpisodeNumbers.add(episode);
  }
  return {
    ok: true,
    remotePath,
    fileCount: files.length,
    readyEpisodeNumbers: [...readyEpisodeNumbers].sort((a, b) => a - b),
    incompleteEpisodeNumbers: [...incompleteEpisodeNumbers].sort((a, b) => a - b),
  };
}

function missingEpisodesForCategory(category, expectedEpisodes, expectedEpisodeNumbers = []) {
  const expected = Number(expectedEpisodes);
  const expectedNumbers = [...new Set((Array.isArray(expectedEpisodeNumbers) ? expectedEpisodeNumbers : [])
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number) && number > 0))].sort((a, b) => a - b);
  if ((!Number.isInteger(expected) || expected <= 0) && !expectedNumbers.length) return { known: false, missing: [] };
  const numbers = Array.isArray(category?.episodeNumbers)
    ? category.episodeNumbers.filter((number) => Number.isInteger(number) && number > 0)
    : [];
  if (expectedNumbers.length) {
    const present = new Set(numbers);
    return { known: true, missing: expectedNumbers.filter((episode) => !present.has(episode)) };
  }
  if (!numbers.length) {
    return {
      known: true,
      missing: Number(category?.episodeCount) < expected ? Array.from({ length: Math.max(0, expected - Number(category?.episodeCount || 0)) }, (_, index) => Number(category?.episodeCount || 0) + index + 1) : [],
    };
  }
  const present = new Set(numbers);
  const missing = [];
  for (let episode = 1; episode <= expected; episode += 1) {
    if (!present.has(episode)) missing.push(episode);
  }
  return { known: true, missing };
}

function skippedMaintenanceItem(source, category, reason, anilist = null) {
  return {
    id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "", anilistTitle: source.anilistTitle || "",
    category: category?.category || "", state: "skipped", reason, anilist,
  };
}

function catalogSourceMatchScore(source, entry) {
  if (!source || !entry) return 0;
  const ids = new Set((source.anilistIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
  if (ids.has(Number(entry.alID)) || ids.has(Number(entry.rootAlID))) return 1000;
  const sourceTitles = [source.title, source.malTitle, source.anilistTitle].filter(Boolean).map(normalizeTitle);
  const entryTitles = [entry.title, entry.mediaTitle, ...(entry.aliases || [])].filter(Boolean).map(normalizeTitle);
  if (sourceTitles.some((title) => title && entryTitles.includes(title))) return 900;
  const sourceTokens = searchTokens([source.title, source.malTitle, source.anilistTitle].filter(Boolean).join(" "));
  if (!sourceTokens.size) return 0;
  let best = 0;
  for (const title of entryTitles) {
    const entryTokens = searchTokens(title);
    const overlap = [...sourceTokens].filter((token) => entryTokens.has(token)).length;
    const ratio = overlap / Math.max(sourceTokens.size, entryTokens.size || 1);
    best = Math.max(best, overlap * 20 + ratio * 100);
  }
  return best >= 55 ? best : 0;
}

function findCatalogSource(sources, entry) {
  const candidates = sources
    .map((source) => ({ source, score: catalogSourceMatchScore(source, entry) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.source.file).localeCompare(String(b.source.file)));
  const best = candidates[0];
  const next = candidates[1];
  // An ID or exact title match is deterministic. For fuzzy matches, avoid
  // silently attaching a tracker entry to the wrong similarly named source.
  if (best && next && ((best.score < 900 && best.score - next.score < 10)
    || (best.score === next.score && best.score >= 900))) {
    return { ambiguous: true, candidates: candidates.slice(0, 3) };
  }
  return best?.source || null;
}

function catalogReleaseForMaintenance(entry) {
  const release = entry?.preferredRelease;
  if (!release) return null;
  const title = `[${release.releaseGroup || "SeaDex"}] ${entry.mediaTitle || entry.title}${entry.category ? ` ${entry.category}` : ""}`;
  const trackerUrl = String(release.trackerUrl || "").trim();
  const nyaaMatch = trackerUrl.match(/^https?:\/\/(?:www\.)?nyaa\.si\/view\/(\d+)(?:[/?#]|$)/i);
  return {
    provider: "seadex",
    title,
    viewUrl: `${RELEASES_BASE_URL}/${entry.alID}/`,
    trackerUrl,
    torrentUrl: nyaaMatch ? `https://nyaa.si/download/${nyaaMatch[1]}.torrent` : "",
    magnet: release.magnet || "",
    hash: release.hash || "",
    seeders: 0,
    downloads: 0,
    publishedAt: release.updatedAt || entry.trackerUpdatedAt || "",
    releaseGroup: release.releaseGroup || "",
    isBest: release.isBest === true,
    dualAudio: release.dualAudio === true,
    seaDex: true,
    targetEpisodes: release.episodes || [],
  };
}

function catalogEpisodeTargets(entry, category, release) {
  const releaseEpisodes = normalizedEpisodeNumbers(release?.episodes);
  const expectedEpisodes = Number(entry?.episodes) > 0
    ? Array.from({ length: Math.min(1000, Number(entry.episodes)) }, (_, index) => index + 1)
    : [];
  const coverage = releaseEpisodes.length ? releaseEpisodes : expectedEpisodes;
  if (entry?.format === "MOVIE") {
    if (!category) return [1];
    if (!category.episodeNumbers?.length) return [1];
    return entry.preferredDualAudio === true
      ? normalizedEpisodeNumbers(category.nonDualEpisodeNumbers)
      : [];
  }
  if (!category) return coverage;
  const present = new Set(category.episodeNumbers || []);
  const nonDual = new Set(category.nonDualEpisodeNumbers || []);
  const dualCandidate = entry.preferredDualAudio === true;
  return coverage.filter((episode) => !present.has(episode) || (dualCandidate && nonDual.has(episode)));
}

function catalogItemAlreadyQueued(key) {
  if (!key) return false;
  for (const run of maintenanceRuns.values()) {
    if (run.finishedAt || ["complete", "failed", "cancelled"].includes(run.state)) continue;
    if ((run.items || []).some((item) => item.catalogKey === key && !["complete", "failed", "cancelled", "skipped"].includes(item.state))) return true;
  }
  return false;
}

async function buildCatalogMaintenanceWork(sources, payload = {}) {
  const state = await loadCatalogState();
  const now = Date.now();
  const sourcePaths = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  const items = [];
  const entries = Object.values(state.entries || {})
    .filter((entry) => ["TV", "MOVIE"].includes(entry.format))
    .sort((a, b) => {
      const aUpgrade = a.preferredDualAudio && a.upgradeEligible ? 0 : 1;
      const bUpgrade = b.preferredDualAudio && b.upgradeEligible ? 0 : 1;
      if (aUpgrade !== bUpgrade) return aUpgrade - bUpgrade;
      return (Date.parse(b.trackerUpdatedAt || "") || 0) - (Date.parse(a.trackerUpdatedAt || "") || 0);
    });
  const plannedGroups = new Map();
  for (const entry of entries) {
    if (catalogItemAlreadyQueued(entry.key)) continue;
    if (entry.nextRetryAt && Date.parse(entry.nextRetryAt) > now) continue;
    const source = findCatalogSource(sources, entry);
    if (source?.ambiguous) {
      entry.state = "review";
      entry.lastError = `ambiguous source match: ${source.candidates.map((candidate) => candidate.source.file).join(", ")}`;
      continue;
    }
    if (payload?.newShowsOnly === true && source) continue;
    if (payload?.existingSourcesOnly === true && !source) continue;
    const groupKey = `${entry.format}:${entry.rootAlID || entry.alID}`;
    const plannedPath = plannedGroups.get(groupKey) || `${SOURCE_PREFIX}${slugFileName(entry.title)}`;
    const sourcePath = source?.path || plannedPath;
    if (sourcePaths && !sourcePaths.has(sourcePath) && !sourcePaths.has(source?.file || "")) continue;
    const category = source?.categories?.find((candidate) => candidate.category === entry.category)
      || (entry.format === "TV"
        ? source?.categories?.find((candidate) => categorySeasonNumber(candidate.category) === Number(entry.seasonNumber))
        : source?.categories?.find((candidate) => /\bmovies?\b/i.test(String(candidate.category || ""))))
      || null;
    const release = catalogReleaseForMaintenance(entry);
    if (!release) {
      entry.state = "unavailable";
      continue;
    }
    const targetEpisodes = catalogEpisodeTargets(entry, category, release);
    // Keep a batch release as one maintenance item, but narrow the td
    // selection to the missing/unconfirmed episodes for an existing season.
    // This prevents a dual batch from reprocessing already confirmed episodes.
    release.targetEpisodes = targetEpisodes;
    const unconfirmedEpisodes = normalizedEpisodeNumbers(category?.nonDualEpisodeNumbers);
    entry.unconfirmedEpisodes = unconfirmedEpisodes;
    entry.upgradeEpisodes = targetEpisodes;
    if (source) entry.upgradeEligible = entry.publishedDualAudio !== true && unconfirmedEpisodes.length > 0;
    const isNewShow = !source && !plannedGroups.has(groupKey);
    const categoryMissing = Boolean((source && !category) || (!source && !isNewShow));
    const needsNew = isNewShow;
    const needsCategory = categoryMissing;
    const needsEpisodes = targetEpisodes.length > 0;
    const canReplaceExisting = Boolean(source && category && entry.preferredDualAudio === true && targetEpisodes.length > 0);
    if (!needsNew && !needsCategory && !needsEpisodes) {
      entry.upgradeEligible = Boolean(source && entry.publishedDualAudio !== true && unconfirmedEpisodes.length);
      if (source) {
        entry.sourcePath = source.path;
        entry.state = "published";
        entry.publishedHash = entry.preferredReleaseHash || entry.publishedHash || "";
        entry.publishedDualAudio = category?.dualAudio === true;
      }
      continue;
    }
    const action = isNewShow ? "new" : "update";
    const item = {
      id: randomUUID(),
      catalogKey: entry.key,
      sourcePath: action === "new" ? "" : sourcePath,
      sourceFile: source?.file || basename(sourcePath),
      title: entry.title,
      malTitle: entry.mediaTitle || entry.title,
      category: category?.category || entry.category,
      state: "queued",
      query: "",
      candidate: { provider: "seadex", title: release.title, viewUrl: release.viewUrl },
      release,
      releases: [],
      releaseStates: [],
      jobId: null,
      manifest: null,
      links: 0,
      error: "",
      missingEpisodes: action === "new" ? [] : targetEpisodes,
      createCategory: needsCategory,
      newSeason: needsCategory,
      maintenanceAction: action,
      fileName: action === "new" ? slugFileName(entry.title) : "",
      image: entry.image || "",
      anilistId: entry.alID,
      rootAnilistId: entry.rootAlID,
      mediaFormat: entry.format,
      catalog: {
        preferredReleaseHash: entry.preferredReleaseHash,
        preferredDualAudio: entry.preferredDualAudio === true,
        targetEpisodes,
        upgrade: canReplaceExisting,
      },
      mal: { status: "catalog", catalogKey: entry.key },
      priority: canReplaceExisting ? 1 : action === "new" ? 3 : 2,
    };
    entry.state = canReplaceExisting ? "upgrade_queued" : "queued";
    entry.upgradeEligible = canReplaceExisting || unconfirmedEpisodes.length > 0;
    entry.sourcePath = sourcePath;
    plannedGroups.set(groupKey, sourcePath);
    items.push(item);
  }
  await persistCatalogState();
  return { items, preflightTotal: entries.length };
}

async function markCatalogItem(item, result, error = null) {
  if (!item?.catalogKey) return;
  const state = await loadCatalogState();
  const entry = state.entries[item.catalogKey];
  if (!entry) return;
  if (error) {
    const attempts = (Number(entry.attempts) || 0) + 1;
    const delayMs = Math.min(7 * 24 * 60 * 60 * 1000, 15 * 60 * 1000 * (2 ** Math.min(attempts - 1, 6)));
    entry.state = "failed";
    entry.attempts = attempts;
    entry.lastError = error instanceof Error ? error.message : String(error);
    entry.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  } else {
    const previousHash = entry.publishedHash || "";
    const previousDualAudio = entry.publishedDualAudio === true;
    entry.state = "published";
    entry.attempts = 0;
    entry.nextRetryAt = null;
    entry.lastError = "";
    entry.sourcePath = result?.path || entry.sourcePath || item.sourcePath || "";
    entry.publishedHash = item.catalog?.preferredReleaseHash || entry.publishedHash || "";
    entry.publishedDualAudio = item.catalog?.preferredDualAudio === true;
    entry.publishedAt = new Date().toISOString();
    // A single-audio publication is usable, but remains eligible for a later
    // dual-audio promotion. Confirmed dual output closes that loop.
    entry.upgradeEligible = item.catalog?.preferredDualAudio !== true;
    entry.history = [...(Array.isArray(entry.history) ? entry.history : []), {
      at: entry.publishedAt,
      action: item.catalog?.upgrade ? "dual-audio-promotion" : "publication",
      hash: entry.publishedHash,
      dualAudio: entry.publishedDualAudio,
      previousHash,
      previousDualAudio,
      targetEpisodes: normalizedEpisodeNumbers(item.catalog?.targetEpisodes),
    }].slice(-20);
  }
  await persistCatalogState();
}

async function markCatalogActive(item) {
  if (!item?.catalogKey) return;
  const state = await loadCatalogState();
  const entry = state.entries[item.catalogKey];
  if (!entry) return;
  entry.state = "active";
  entry.lastError = "";
  await persistCatalogState();
}

async function buildMaintenanceWork(sources, payload, { onProgress } = {}) {
  const sourcePaths = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  const work = [];
  const toodriveAuditCache = new Map();
  const selectedSources = sources.filter((source) => !sourcePaths || sourcePaths.has(source.path) || sourcePaths.has(source.file));
  let preflightCompleted = 0;
  const aniListEnabled = maintenanceAniListEnabled(payload);
  let catalogWork = { items: [], preflightTotal: 0 };
  if (payload?.discoverCatalog === true) {
    if (payload?.catalogScan !== false) {
      await scanCatalog({ onProgress: (progress) => onProgress?.({ title: "releases.moe catalog", state: progress.stage || "scanning_catalog", ...progress }) });
    }
    catalogWork = await buildCatalogMaintenanceWork(sources, payload);
    if (payload?.catalogOnly === true) {
      return { work: catalogWork.items, preflightCompleted: catalogWork.items.length, preflightTotal: catalogWork.preflightTotal, aniListEnabled: false };
    }
  }
  if (payload?.catalogOnly !== true) {
  for (const source of selectedSources) {
    if (sourcePaths && !sourcePaths.has(source.path) && !sourcePaths.has(source.file)) continue;
    const existingCategories = Array.isArray(source?.categories) ? source.categories : [];
    const categories = automaticCategories(source, payload?.allCategories === true);
    if (!categories.length) {
      work.push(skippedMaintenanceItem(source, null, "no maintainable season category"));
      continue;
    }

    let aniListResult = null;
    if (aniListEnabled) {
      try {
        onProgress?.({ title: source.title, state: "checking_anilist" });
        aniListResult = await findAniListAnime(source, categories[0].category);
      } catch (error) {
        aniListResult = { candidate: null, candidates: [], error: error instanceof Error ? error.message : String(error) };
      }
    }
    for (const category of categories) {
      preflightCompleted += 1;
      onProgress?.({ title: source.title, category: category.category, completed: preflightCompleted });
      if (aniListEnabled) {
        let aniListCandidate = chooseAniListCandidate(aniListResult?.candidates, source, category.category);
        if (!aniListCandidate) {
          const reason = aniListResult?.error
            ? `AniList check unavailable: ${aniListResult.error}`
            : "AniList did not return a confident matching anime";
          work.push(skippedMaintenanceItem(source, category, reason, { status: "unavailable", error: aniListResult?.error || "" }));
          continue;
        }
        aniListCandidate = await hydrateAniListCandidateProgress(aniListResult, source, category.category);
        const expectedEpisodeNumbers = Array.isArray(aniListCandidate?.knownEpisodeNumbers)
          ? aniListCandidate.knownEpisodeNumbers
          : [];
        const currentlyAiring = aniListCandidateIsCurrentlyAiring(aniListCandidate);
        const expectedEpisodes = expectedEpisodeNumbers.length
          ? Math.max(...expectedEpisodeNumbers)
          : currentlyAiring
            ? Number(aniListCandidate?.airedEpisodes) > 0 ? Number(aniListCandidate.airedEpisodes) : null
            : Number(aniListCandidate?.episodes) > 0
              ? Number(aniListCandidate.episodes)
              : Number(aniListCandidate?.airedEpisodes) > 0 ? Number(aniListCandidate.airedEpisodes) : null;
        if ((!Number.isInteger(expectedEpisodes) || expectedEpisodes <= 0) && !expectedEpisodeNumbers.length) {
          const progressReason = aniListCandidate?.episodeProgressError
            ? `AniList aired episode schedule unavailable: ${aniListCandidate.episodeProgressError}`
            : "AniList episode count is not available yet";
          work.push(skippedMaintenanceItem(source, category, progressReason, { status: "unknown", ...aniListCandidate }));
          continue;
        }
        let toodriveAudit = null;
        if (maintenanceToodriveAuditEnabled(payload)) {
          const auditKey = maintenanceFolder(source.title, category.category);
          toodriveAudit = toodriveAuditCache.get(auditKey);
          if (!toodriveAudit) {
            toodriveAudit = await auditToodriveCategory(source.title, category.category);
            toodriveAuditCache.set(auditKey, toodriveAudit);
          }
        }
        const auditedCategory = toodriveAudit?.ok
          ? { ...category, episodeCount: toodriveAudit.readyEpisodeNumbers.length, episodeNumbers: toodriveAudit.readyEpisodeNumbers }
          : category;
        const missing = missingEpisodesForCategory(auditedCategory, expectedEpisodes, expectedEpisodeNumbers);
        if (!missing.known) {
          work.push(skippedMaintenanceItem(source, category, "library episode numbering is not readable", { status: "unknown", ...aniListCandidate }));
          continue;
        }
        const refreshEpisodes = payload?.refreshExisting === true
          ? [...new Set((category.episodeNumbers || []).filter((episode) => Number.isInteger(episode) && episode > 0))].sort((a, b) => a - b)
          : [];
        const targetEpisodes = [...new Set([...missing.missing, ...refreshEpisodes])].sort((a, b) => a - b);
        if (!targetEpisodes.length) {
          const countLabel = expectedEpisodeNumbers.length
            ? `${expectedEpisodeNumbers.length} aired episode${expectedEpisodeNumbers.length === 1 ? "" : "s"}`
            : `${expectedEpisodes} episodes`;
          work.push(skippedMaintenanceItem(source, category, `AniList reports ${countLabel} and the library is complete`, {
            status: "complete",
            ...aniListCandidate,
            toodriveAudit: toodriveAudit || undefined,
          }));
          continue;
        }
        work.push({
          id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "", anilistTitle: source.anilistTitle || "",
          category: category.category, state: "queued", query: "", candidate: null,
          jobId: null, manifest: null, links: 0, error: "", missingEpisodes: targetEpisodes,
          anilist: { status: refreshEpisodes.length ? "refresh" : "missing", ...aniListCandidate, toodriveAudit: toodriveAudit || undefined },
        });
        continue;
      }
      work.push({
        id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "", anilistTitle: source.anilistTitle || "",
        category: category.category, state: "queued", query: "", candidate: null,
        jobId: null, manifest: null, links: 0, error: "", missingEpisodes: [],
        anilist: { status: "disabled" },
      });
    }

    if (aniListEnabled && payload?.addNewSeasons !== false && payload?.addMissing !== false) {
      for (const { season, candidate } of discoverAniListSeasons(source, existingCategories, aniListResult)) {
        const categoryName = `Season ${season}`;
        const hydratedCandidate = await hydrateAniListCandidateProgress(aniListResult, source, categoryName) || candidate;
        const currentlyAiring = aniListCandidateIsCurrentlyAiring(hydratedCandidate);
        const knownEpisodeNumbers = Array.isArray(hydratedCandidate?.knownEpisodeNumbers)
          ? hydratedCandidate.knownEpisodeNumbers.filter((number) => Number.isInteger(number) && number > 0)
          : [];
        const airedEpisodes = Number(hydratedCandidate?.airedEpisodes) > 0 ? Number(hydratedCandidate.airedEpisodes) : null;
        const totalEpisodes = Number(hydratedCandidate?.episodes) > 0 ? Number(hydratedCandidate.episodes) : null;
        const episodes = currentlyAiring
          ? (knownEpisodeNumbers.length ? knownEpisodeNumbers : airedEpisodes ? Array.from({ length: airedEpisodes }, (_, index) => index + 1) : [])
          : totalEpisodes ? Array.from({ length: Math.min(1000, totalEpisodes) }, (_, index) => index + 1) : [];
        if (!episodes.length) {
          work.push(skippedMaintenanceItem(
            source,
            { category: categoryName },
            hydratedCandidate?.episodeProgressError
              ? `AniList aired episode schedule unavailable: ${hydratedCandidate.episodeProgressError}`
              : "AniList episode count is not available yet",
            { status: "unknown", ...hydratedCandidate, seasonMarker: season },
          ));
          continue;
        }
        work.push({
          id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "", anilistTitle: source.anilistTitle || "",
          category: categoryName, state: "queued", query: aniListResult?.query || "", candidate: null,
          jobId: null, manifest: null, links: 0, error: "", missingEpisodes: Array.from(
            { length: episodes.length }, (_, index) => episodes[index],
          ), createCategory: true, newSeason: true,
          anilist: { status: "new_season", ...hydratedCandidate, seasonMarker: season },
        });
      }
    }
  }
  }
  work.push(...catalogWork.items);
  return {
    work,
    preflightCompleted: preflightCompleted + catalogWork.items.length,
    preflightTotal: selectedSources.reduce((sum, source) => sum + automaticCategories(source, payload?.allCategories === true).length, 0) + catalogWork.preflightTotal,
    aniListEnabled,
  };
}

function normalizeMaintenanceReleaseStates(item) {
  const releases = Array.isArray(item.releases) ? item.releases : [];
  const existing = Array.isArray(item.releaseStates) ? item.releaseStates : [];
  const hadStates = Array.isArray(item.releaseStates);
  const releaseIndex = Math.max(0, Math.min(releases.length, Number(item.releaseIndex) || 0));
  const states = releases.map((release, index) => {
    const previous = existing[index] && typeof existing[index] === "object" ? existing[index] : {};
    let jobId = String(previous.jobId || "").trim() || null;
    if (jobId && !jobs.has(jobId)) jobId = null;
    let state = String(previous.state || (index < releaseIndex ? "complete" : "queued"));
    if (!["queued", "downloading", "complete", "failed", "cancelled"].includes(state)) state = "queued";
    if (state === "downloading" && !jobId) state = "queued";
    if (state === "complete") jobId = null;
    return {
      index,
      state,
      jobId,
      links: Number(previous.links) || 0,
      manifest: previous.manifest || null,
      error: String(previous.error || ""),
      provider: release.provider || "unknown",
      targetEpisodes: releaseTargetEpisodes(release, item.category, item.missingEpisodes || []),
    };
  });
  // Migrate a pre-concurrency snapshot, which had one item-level jobId.
  if (!hadStates && item.jobId && states[releaseIndex] && !states[releaseIndex].jobId) {
    states[releaseIndex].jobId = jobs.has(item.jobId) ? item.jobId : null;
    if (states[releaseIndex].jobId && states[releaseIndex].state !== "complete") states[releaseIndex].state = "downloading";
  }
  item.releaseStates = states;
  return syncMaintenanceReleaseSummary(item);
}

function syncMaintenanceReleaseSummary(item) {
  const states = Array.isArray(item.releaseStates) ? item.releaseStates : [];
  item.releaseIndex = states.findIndex((release) => release.state !== "complete");
  if (item.releaseIndex < 0) item.releaseIndex = states.length;
  item.jobIds = states.map((release) => release.jobId).filter(Boolean);
  item.jobId = item.jobIds[0] || null;
  item.links = states.reduce((sum, release) => sum + (Number(release.links) || 0), 0);
  return states;
}

async function runMaintenanceRelease(run, item, releaseState, payload) {
  const release = item.releases[releaseState.index];
  const savedTargetEpisodes = normalizedEpisodeNumbers(releaseState.targetEpisodes);
  const targetEpisodes = savedTargetEpisodes.length
    ? savedTargetEpisodes
    : releaseTargetEpisodes(release, item.category, item.missingEpisodes || []);
  let child = releaseState.jobId ? jobs.get(releaseState.jobId) : null;
  if (releaseState.jobId && !child) {
    releaseState.jobId = null;
    releaseState.state = "queued";
  }
  if (!child) {
    item.release = release;
    item.query = release.query || "";
    item.candidate = {
      provider: release.provider || "unknown",
      title: release.title,
      score: release.score,
      viewUrl: release.viewUrl || "",
    };
    item.state = "downloading";
    releaseState.state = "downloading";
    syncRunActivity(run);
    runEvent(run, `Selected [${release.provider || "release source"}] ${release.title} for ${item.title} · ${item.category}${targetEpisodes.length ? ` · Episodes ${targetEpisodes.join(", ")}` : ""}.`);
    try {
      child = await startJob({
        torrentUrl: release.torrentUrl,
        magnet: release.magnet,
        destination: maintenanceFolder(item.title, item.category),
        runId: run.id,
        maintenance: {
          action: item.maintenanceAction || "update",
          sourcePath: item.maintenanceAction === "new" ? "" : item.sourcePath,
          fileName: item.fileName || undefined,
          title: item.title,
          image: item.image || undefined,
          anilistId: item.anilistId || undefined,
          rootAnilistId: item.rootAnilistId || undefined,
          mediaFormat: item.mediaFormat || undefined,
          categoryName: item.category,
          seasonNumber: categorySeasonNumber(item.category) || undefined,
          targetEpisodes,
          replaceExisting: payload?.replaceExisting !== false,
          addMissing: payload?.addMissing !== false,
          createCategory: item.createCategory === true,
          dualAudio: releaseHasDualAudio(release),
        },
      });
      releaseState.jobId = child.id;
      syncMaintenanceReleaseSummary(item);
      syncRunActivity(run);
      await persistResumeState();
    } catch (error) {
      releaseState.state = "failed";
      releaseState.error = error instanceof Error ? error.message : String(error);
      syncMaintenanceReleaseSummary(item);
      syncRunActivity(run);
      await persistResumeState();
      throw error;
    }
  } else {
    item.state = "downloading";
    releaseState.state = "downloading";
    syncMaintenanceReleaseSummary(item);
    syncRunActivity(run);
    runEvent(run, `Resuming [${release.provider || "release source"}] ${release.title} for ${item.title} · ${item.category} from its preserved download cache.`);
  }

  const result = await child.done;
  releaseState.jobId = null;
  releaseState.links = result.links?.length || 0;
  releaseState.manifest = result.manifest || releaseState.manifest || null;
  if (result.state === "cancelled") {
    releaseState.state = "cancelled";
    syncMaintenanceReleaseSummary(item);
    run.cancelled = true;
    stopMaintenanceChildren(run);
    syncRunActivity(run);
    runEvent(run, `Cancelled ${item.title} · ${item.category}.`);
    await persistResumeState();
    return { cancelled: true };
  }
  if (result.state !== "complete") {
    // The child job has already emitted the immediate failure notification.
    // Mark the item so its broader catch handler does not send a duplicate.
    item.failureWebhookNotified = true;
    releaseState.state = "failed";
    releaseState.error = result.events?.at(-1)?.message || `td exited with code ${result.exitCode ?? "?"}`;
    syncMaintenanceReleaseSummary(item);
    syncRunActivity(run);
    await persistResumeState();
    throw new Error(releaseState.error);
  }
  releaseState.state = "complete";
  item.manifest = result.manifest || item.manifest || null;
  syncMaintenanceReleaseSummary(item);
  syncRunActivity(run);
  await persistResumeState();
  return { cancelled: false };
}

async function processMaintenanceItem(run, item, payload = {}) {
  if (run.cancelled || ["complete", "failed", "cancelled"].includes(item.state)) return;
  if (item.state === "skipped") {
    if (!item.counted) {
      run.skipped += 1;
      run.completed += 1;
      item.counted = true;
      runEvent(run, `Skipped ${item.title}${item.category ? ` · ${item.category}` : ""}: ${item.reason}.`);
    }
    syncRunActivity(run);
    await persistResumeState();
    return;
  }

  const source = { title: item.title, malTitle: item.malTitle || "", anilistTitle: item.anilistTitle || "" };
  try {
    await markCatalogActive(item);
    if (!Array.isArray(item.releases) || !item.releases.length) {
      item.state = "searching";
      syncRunActivity(run);
      runEvent(run, `Searching release sources automatically for ${item.title} · ${item.category}.`);
      const releasePlan = item.release?.torrentUrl || item.release?.magnet
        ? [item.release]
        : await findAutomaticReleasePlan(source, item.category, item.missingEpisodes || []);
      item.releases = releasePlan.map((release) => ({
        provider: release.provider || "unknown",
        title: release.title || "Selected release",
        viewUrl: release.viewUrl || "",
        torrentUrl: release.torrentUrl || "",
        magnet: release.magnet || "",
        score: release.score,
        seeders: Number(release.seeders) || 0,
        downloads: Number(release.downloads) || 0,
        availabilityScore: Number(release.availabilityScore) || releaseAvailabilityScore(release),
        isBest: release.isBest === true,
        dualAudio: release.dualAudio === true,
        query: release.query || "",
        targetEpisodes: releaseTargetEpisodes(release, item.category, item.missingEpisodes || []),
      }));
      item.releaseIndex = Number.isInteger(Number(item.releaseIndex)) ? Number(item.releaseIndex) : 0;
      item.jobId = item.jobId || null;
      normalizeMaintenanceReleaseStates(item);
      await persistResumeState();
    } else {
      normalizeMaintenanceReleaseStates(item);
    }

    // A release plan can survive for a while in resume-state.  Re-check any
    // pending non-dual release before starting it, because a dual-audio Nyaa
    // result may have appeared after the original plan was saved.  Completed
    // releases remain untouched; only the unresolved episode targets are
    // replaced, and the old worker is stopped before the replacement starts.
    const savedStates = item.releaseStates || [];
    const pendingStates = savedStates.filter((release) => !["complete", "failed", "cancelled"].includes(release.state));
    const failedStates = savedStates.filter((release) => release.state === "failed");
    const refreshStates = [...pendingStates, ...failedStates];
    const pendingEpisodes = normalizedEpisodeNumbers(refreshStates.flatMap((release) => release.targetEpisodes || []));
    const pendingHasNonDual = refreshStates.some((release) => !releaseHasDualAudio(item.releases[release.index]));
    const pendingHasLowAvailability = refreshStates.some((release) => {
      const candidate = item.releases[release.index];
      // A SeaDex magnet commonly has no tracker seeder count. Keep that
      // release when it is otherwise eligible instead of replacing it with a
      // weaker Nyaa result during the pre-download refresh.
      return !candidate?.magnet
        && (!Number.isFinite(Number(candidate?.seeders)) || Number(candidate?.seeders) <= 0);
    });
    if (pendingEpisodes.length && (pendingHasNonDual || pendingHasLowAvailability)) {
      try {
        const refreshed = await findAutomaticReleasePlan(source, item.category, pendingEpisodes);
        const candidatesByEpisode = new Map();
        for (const release of refreshed) {
          for (const episode of releaseTargetEpisodes(release, item.category, pendingEpisodes)) {
            const candidates = candidatesByEpisode.get(episode) || [];
            candidates.push(release);
            candidatesByEpisode.set(episode, candidates);
          }
        }
        const replacementByEpisode = new Map();
        for (const [episode, candidates] of candidatesByEpisode) {
          const preferred = candidates.some((candidate) => releaseHasDualAudio(candidate))
            ? candidates.filter((candidate) => releaseHasDualAudio(candidate))
            : candidates;
          if (preferred[0]) replacementByEpisode.set(episode, preferred[0]);
        }
        const replaceEpisodes = pendingEpisodes.filter((episode) => replacementByEpisode.has(episode));
        if (replaceEpisodes.length) {
          const replaceSet = new Set(replaceEpisodes);
          const retained = item.releases
            .map((release, index) => ({ release, state: savedStates[index] }))
            .filter(({ state, release }) => {
              if (state?.state === "complete") return true;
              const targets = normalizedEpisodeNumbers(state?.targetEpisodes || releaseTargetEpisodes(release, item.category, pendingEpisodes));
              return !targets.some((episode) => replaceSet.has(episode));
            });
          for (const releaseState of pendingStates) {
            const targets = normalizedEpisodeNumbers(releaseState.targetEpisodes);
            if (targets.some((episode) => replaceSet.has(episode)) && releaseState.jobId) {
              jobs.get(releaseState.jobId)?.stop?.();
            }
          }
          const completedStates = retained.map(({ release, state }) => ({
            state: state?.state === "complete" ? "complete" : "queued",
            jobId: null,
            links: state?.state === "complete" ? Number(state.links) || 0 : 0,
            manifest: state?.state === "complete" ? state.manifest || null : null,
            error: "",
            provider: release.provider || "unknown",
            targetEpisodes: releaseTargetEpisodes(release, item.category, item.missingEpisodes || []),
          }));
          const replacements = replaceEpisodes.map((episode) => replacementByEpisode.get(episode));
          item.releases = [...retained.map(({ release }) => release), ...replacements];
          item.releaseStates = [...completedStates, ...replacements.map((release) => ({
            state: "queued",
            jobId: null,
            links: 0,
            manifest: null,
            error: "",
            provider: release.provider || "unknown",
            targetEpisodes: releaseTargetEpisodes(release, item.category, item.missingEpisodes || []),
          }))];
          normalizeMaintenanceReleaseStates(item);
          runEvent(run, `Refreshed Episodes ${replaceEpisodes.join(", ")} for ${item.title} · ${item.category} to current eligible release candidates before downloading.`);
          await persistResumeState();
        }
      } catch (error) {
        runEvent(run, `Could not refresh pending release candidates for ${item.title} · ${item.category}: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }

    const states = item.releaseStates;
    const pending = states.filter((release) => !["complete", "failed", "cancelled"].includes(release.state));
    const failures = [];
    let cancelled = run.cancelled;
    let cursor = 0;
    const workerCount = Math.min(torrentConcurrency(payload), Math.max(1, pending.length));
    const worker = async () => {
      while (!run.cancelled) {
        const releaseState = pending[cursor++];
        if (!releaseState) return;
        try {
          const result = await runMaintenanceRelease(run, item, releaseState, payload);
          if (result.cancelled) cancelled = true;
        } catch (error) {
          failures.push(error);
        }
      }
    };
    item.state = "downloading";
    syncMaintenanceReleaseSummary(item);
    syncRunActivity(run);
    runEvent(run, `Running up to ${workerCount} torrent job${workerCount === 1 ? "" : "s"} at a time for ${item.title} · ${item.category}; ${pending.length} release${pending.length === 1 ? "" : "s"} queued.`);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const finalStates = syncMaintenanceReleaseSummary(item);
    if (cancelled || run.cancelled || finalStates.some((release) => release.state === "cancelled")) {
      item.state = "cancelled";
      syncRunActivity(run);
      await persistResumeState();
    } else if (failures.length || finalStates.some((release) => release.state === "failed")) {
      throw failures[0] || new Error(finalStates.find((release) => release.state === "failed")?.error || "one or more torrent jobs failed");
    } else {
      item.state = "complete";
      syncRunActivity(run);
      runEvent(run, `Updated ${item.title} · ${item.category} (${item.links} links from ${item.releases.length} release${item.releases.length === 1 ? "" : "s"}).`);
      await markCatalogItem(item, item.manifest);
    }
  } catch (error) {
    item.state = "failed";
    item.error = error instanceof Error ? error.message : String(error);
    run.failed += 1;
    syncRunActivity(run);
    runEvent(run, `Failed ${item.title} · ${item.category}: ${item.error}.`);
    if (!item.failureWebhookNotified) {
      item.failureWebhookNotified = true;
      void queueFailureWebhook({
        scope: "item",
        title: item.title,
        category: item.category,
        runId: run.id,
        message: item.error,
        provider: item.candidate?.provider || item.release?.provider || "release search",
        failed: run.failed,
        total: run.total,
      });
    }
    await markCatalogItem(item, null, error);
  }
  if (!item.counted && ["complete", "failed", "cancelled"].includes(item.state)) {
    item.counted = true;
    run.completed += 1;
  }
  syncRunActivity(run);
  await persistResumeState();
}

function startExecuteMaintenanceRun(run, payload = run.payload || {}) {
  run.executionActive = true;
  const promise = executeMaintenanceRun(run, payload);
  run.executionPromise = promise;
  promise.then(
    () => { if (run.executionPromise === promise) run.executionPromise = null; },
    () => { if (run.executionPromise === promise) run.executionPromise = null; },
  );
  return promise;
}

async function executeMaintenanceRun(run, payload = run.payload || {}) {
  try {
    syncRunActivity(run);
    const maintenancePayload = { ...payload, torrentConcurrency: run.torrentConcurrency || torrentConcurrency(payload) };
    const groups = new Map();
    for (const item of run.items) {
      const key = item.sourcePath || item.sourceFile || item.title || item.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const groupList = [...groups.values()];
    const concurrency = maintenanceConcurrency(payload);
    const workerCount = Math.min(concurrency, Math.max(1, groupList.length));
    runEvent(run, `Running one show job at a time and up to ${maintenancePayload.torrentConcurrency} torrent job${maintenancePayload.torrentConcurrency === 1 ? "" : "s"} at a time; ${groupList.length} show group${groupList.length === 1 ? "" : "s"} queued. Seasons from the same source stay ordered.`);
    let nextGroup = 0;
    const worker = async () => {
      while (!run.cancelled && !run.pauseRequested) {
        const groupIndex = nextGroup;
        nextGroup += 1;
        if (groupIndex >= groupList.length) return;
        for (const item of groupList[groupIndex]) {
          if (run.cancelled || run.pauseRequested) break;
          await processMaintenanceItem(run, item, maintenancePayload);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (run.cancelled) {
      for (const item of run.items.filter((candidate) => candidate.state === "queued" || candidate.state === "searching")) {
        item.state = "cancelled";
      }
      run.state = "cancelled";
    } else if (run.pauseRequested) {
      markMaintenanceRunPaused(run);
    } else {
      run.state = run.failed ? "complete_with_errors" : "complete";
    }
  } catch (error) {
    run.failed += 1;
    run.state = "failed";
    runEvent(run, error instanceof Error ? error.message : String(error));
    void queueFailureWebhook({
      scope: "run",
      title: "Maintenance run",
      runId: run.id,
      message: error instanceof Error ? error.message : String(error),
      failed: run.failed,
      total: run.total,
    });
  } finally {
    run.executionActive = false;
    if (run.pauseRequested || run.pauseDraining) {
      markMaintenanceRunPaused(run, "Maintenance is paused and ready to resume with updated settings.");
    }
    syncRunActivity(run);
    if (!run.paused && !run.pauseRequested) {
      run.phase = "complete";
      if (catalogRunId === run.id) catalogRunId = null;
      run.finishedAt = new Date().toISOString();
      persistLog({
        scope: "run",
        event: "run_finished",
        runId: run.id,
        state: run.state,
        completed: run.completed,
        total: run.total,
        failed: run.failed,
        skipped: run.skipped,
      });
    }
    await persistResumeState();
  }
}

async function startMaintenanceRun(payload = {}) {
  payload = payload && typeof payload === "object" ? payload : {};
  const operation = String(payload.operation || "").trim().toLowerCase();
  if (MAINTENANCE_ROLE === "general" && operation !== "add") {
    // The general worker owns upkeep for manifests that already exist. Keep
    // catalog planning enabled here so it can promote single-audio episodes
    // when SeaDex has a preferred dual-audio release, but never create new
    // shows on this worker. The catalog planner skips entries without an
    // existing source when existingSourcesOnly is set.
    const catalogRequested = payload.discoverCatalog === true && payload.catalogScan !== false;
    payload = {
      ...payload,
      discoverCatalog: catalogRequested,
      catalogScan: catalogRequested,
      catalogOnly: false,
      newShowsOnly: false,
      existingSourcesOnly: true,
      addNewSeasons: false,
    };
  }
  const overlappingRun = findOverlappingMaintenanceRun(payload);
  if (overlappingRun) {
    runEvent(overlappingRun, "Ignored a duplicate maintenance request; an existing run already owns this work.");
    await persistResumeState();
    return overlappingRun;
  }
  const library = await listLibrary();
  const run = {
    id: randomUUID(), state: "checking", phase: maintenanceAniListEnabled(payload) ? "anilist" : "planning",
    total: 0, completed: 0, failed: 0, skipped: 0, preflightCompleted: 0, preflightTotal: 0, preflightCurrent: null,
    current: null, currentJobId: null, active: [], activeJobIds: [], concurrency: maintenanceConcurrency(payload), torrentConcurrency: torrentConcurrency(payload), items: [], events: [], startedAt: new Date().toISOString(),
    finishedAt: null, cancelled: false, paused: false, pauseRequested: false, pauseDraining: false, planningActive: true, executionActive: false, planOnly: payload?.dryRun === true || payload?.planOnly === true,
    payload,
  };
  const requestedSources = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  run.preflightTotal = payload?.catalogOnly === true
    ? 0
    : library.sources
      .filter((source) => !requestedSources || requestedSources.has(source.path) || requestedSources.has(source.file))
      .reduce((sum, source) => sum + automaticCategories(source, payload?.allCategories === true).length, 0);
  maintenanceRuns.set(run.id, run);
  if (payload?.discoverCatalog === true) catalogRunId = run.id;
  run.stop = () => {
    run.pauseRequested = false;
    run.paused = false;
    run.cancelled = true;
    const stopping = stopMaintenanceChildren(run);
    syncRunActivity(run);
    void persistResumeState();
    return stopping;
  };
  persistLog({ scope: "run", event: "run_started", runId: run.id, state: run.state, phase: run.phase });
  void persistResumeState();
  void (async () => {
    try {
      runEvent(run, maintenanceAniListEnabled(payload)
        ? "Checking AniList for missing episodes before searching release sources."
        : "AniList preflight disabled; planning all selected categories.");
      const planned = await buildMaintenanceWork(library.sources, payload, {
        onProgress: (progress) => {
          if (progress?.completed) run.preflightCompleted = progress.completed;
          if (progress?.title) {
            run.preflightCurrent = { title: progress.title, category: progress.category || "" };
          }
        },
      });
      run.items = planned.work;
      run.preflightCurrent = null;
      run.total = run.items.length;
      run.preflightCompleted = planned.preflightCompleted;
      run.preflightTotal = planned.preflightTotal;
      await persistResumeState();
      if (run.cancelled) {
        run.state = "cancelled";
        run.phase = "complete";
        if (catalogRunId === run.id) catalogRunId = null;
        await persistResumeState();
      } else if (run.pauseRequested) {
        markMaintenanceRunPaused(run, "Maintenance paused after planning. Update settings and resume when ready.");
        await persistResumeState();
      } else if (run.planOnly) {
        run.state = "complete";
        run.phase = "plan";
        run.finishedAt = new Date().toISOString();
        if (catalogRunId === run.id) catalogRunId = null;
        runEvent(run, `Plan ready: ${run.items.filter((item) => item.state === "queued").length} category(s) need maintenance.`);
      } else if (!run.total) {
        run.state = "complete";
        run.phase = "complete";
        run.finishedAt = new Date().toISOString();
        if (catalogRunId === run.id) catalogRunId = null;
        await persistResumeState();
      } else {
        const hasQueuedWork = run.items.some((item) => item.state === "queued");
        if (hasQueuedWork && payload?.tdPreflight !== false) {
          run.phase = "auth";
          runEvent(run, "Checking the Toodrive session before starting maintenance jobs.");
          const tdSession = await checkTdSession();
          if (tdSession.relogged) runEvent(run, "Toodrive session expired; logged in again automatically.");
          if (!tdSession.ok) {
            const loginHint = /\btd login\b/.test(String(tdSession.message || ""))
              ? ""
              : " Run: td login --auth-backend=file";
            throw new Error(
              `Toodrive authentication failed (${tdSession.code || "unknown"}): ${tdSession.message}.${loginHint}`,
            );
          }
        }
        if (run.pauseRequested) {
          markMaintenanceRunPaused(run, "Maintenance paused before starting transfers. Update settings and resume when ready.");
          await persistResumeState();
        } else {
          run.planningActive = false;
          run.state = "running";
          run.phase = "maintenance";
          await persistResumeState();
          startExecuteMaintenanceRun(run, payload);
        }
      }
    } catch (error) {
      run.failed += 1;
      run.state = run.cancelled ? "cancelled" : "failed";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      if (catalogRunId === run.id) catalogRunId = null;
      runEvent(run, error instanceof Error ? error.message : String(error));
      void queueFailureWebhook({
        scope: "run",
        title: "Maintenance planning",
        runId: run.id,
        message: error instanceof Error ? error.message : String(error),
        failed: run.failed,
        total: run.total,
      });
      await persistResumeState();
    } finally {
      run.planningActive = false;
      if (run.paused && run.pauseDraining && !run.executionActive) {
        run.pauseDraining = false;
        run.state = "paused";
        run.phase = "paused";
        runEvent(run, "Maintenance is paused and ready to resume with updated settings.");
        await persistResumeState();
      }
    }
  })();
  return run;
}

function artifactInfo(artifact) {
  const parsed = episodeInfo(artifact.remotePath || artifact.localPath || "");
  return { ...artifact, season: parsed.season, episode: parsed.episode };
}

function selectArtifacts(artifacts, maintenance, existingEntries = []) {
  const usable = artifacts.filter((artifact) => artifact && artifact.url);
  const requestedSeason = Number(maintenance.seasonNumber) || episodeInfo(maintenance.categoryName).season;
  const artifactSeason = (artifact) => {
    const path = String(artifact?.remotePath || artifact?.localPath || "");
    const destinationSeason = path.match(/(?:^|[\\/])Season\s*0*(\d{1,2})(?=[\\/]|$)/i);
    return destinationSeason ? Number(destinationSeason[1]) : episodeInfo(path).season;
  };
  const parsedSeasons = usable.map((artifact) => artifactSeason(artifact)).filter(Boolean);
  const seasonFiltered = requestedSeason && parsedSeasons.length
    ? usable.filter((artifact) => !artifactSeason(artifact) || artifactSeason(artifact) === requestedSeason)
    : usable;
  const targetEpisodes = [...new Set((Array.isArray(maintenance.targetEpisodes) ? maintenance.targetEpisodes : [])
    .map((episode) => Number(episode))
    .filter((episode) => Number.isInteger(episode) && episode > 0))].sort((a, b) => a - b);
  const targetSet = new Set(targetEpisodes);
  const targetFiltered = targetEpisodes.length
    ? seasonFiltered.filter((artifact) => {
      const episode = episodeInfo(artifact.remotePath || artifact.localPath || "").episode;
      return !episode || targetSet.has(episode);
    })
    : seasonFiltered;
  let targetIndex = 0;
  let nextEpisode = Math.max(0, ...existingEntries.map((entry) => episodeInfo(entry?.title).episode || 0)) + 1;
  const assignedEpisodes = new Set();
  const nextTargetEpisode = () => {
    while (targetIndex < targetEpisodes.length && assignedEpisodes.has(targetEpisodes[targetIndex])) targetIndex += 1;
    return targetIndex < targetEpisodes.length ? targetEpisodes[targetIndex++] : null;
  };
  return targetFiltered
    .sort((a, b) => {
      const aHasEpisode = episodeInfo(a.remotePath || a.localPath || "").episode ? 0 : 1;
      const bHasEpisode = episodeInfo(b.remotePath || b.localPath || "").episode ? 0 : 1;
      return aHasEpisode - bHasEpisode || String(a.remotePath || "").localeCompare(String(b.remotePath || ""));
    })
    .map((artifact) => {
      const parsed = artifactInfo(artifact);
      if (parsed.episode) {
        assignedEpisodes.add(parsed.episode);
      } else {
        const targetEpisode = nextTargetEpisode();
        if (targetEpisode) parsed.episode = targetEpisode;
        else {
          while (assignedEpisodes.has(nextEpisode)) nextEpisode += 1;
          parsed.episode = nextEpisode++;
        }
        assignedEpisodes.add(parsed.episode);
      }
      return parsed;
    })
    .sort((a, b) => (a.episode || 0) - (b.episode || 0) || String(a.remotePath || "").localeCompare(String(b.remotePath || "")));
}

function makeEpisodeEntry(artifact, existing, maintenance = {}) {
  const entry = existing && typeof existing === "object" ? { ...existing } : {};
  const number = artifact.episode;
  if (!entry.title) entry.title = String(maintenance.mediaFormat || "").toUpperCase() === "MOVIE"
    ? "Movie"
    : `Episode ${String(number).padStart(2, "0")}`;
  entry.src = normalizeToodriveUrl(artifact.url);
  if (numericValue(artifact.sizeBytes)) entry.fileSizeBytes = numericValue(artifact.sizeBytes);
  if (durationValue(artifact.durationSeconds)) entry.durationSeconds = durationValue(artifact.durationSeconds);
  if (typeof maintenance.dualAudio === "boolean") entry.dualAudio = maintenance.dualAudio;
  return entry;
}

async function applyMaintenance(maintenance, artifacts) {
  const action = maintenance?.action === "new" ? "new" : "update";
  const now = new Date().toISOString();
  if (action === "new") {
    if (String(maintenance.sourcePath || "").trim()) {
      throw new Error("action=new is only for a brand-new show; use update with createCategory for a new season");
    }
    const title = String(maintenance.title || "").trim();
    if (!title) throw new Error("new show title is required");
    const file = String(maintenance.fileName || slugFileName(title)).trim();
    const target = sourceFileFromInput(file);
    const existingNames = await listLibrary();
    if (existingNames.sources.some((source) => source.file.toLowerCase() === target.file.toLowerCase() || source.title.toLowerCase() === title.toLowerCase())) {
      throw new Error(`a source for ${title} already exists`);
    }
    const categoryName = String(maintenance.categoryName || "Season 1").trim() || "Season 1";
    const incoming = selectArtifacts(artifacts, maintenance);
    if (!incoming.length) throw new Error("the torrent produced no video links");
    const episodes = incoming.map((artifact) => makeEpisodeEntry(artifact, null, maintenance));
    const category = { category: categoryName, episodes };
    if (Number.isInteger(Number(maintenance.anilistId)) && Number(maintenance.anilistId) > 0) category.anilistId = Number(maintenance.anilistId);
    if (Number.isInteger(Number(maintenance.rootAnilistId)) && Number(maintenance.rootAnilistId) > 0) category.rootAnilistId = Number(maintenance.rootAnilistId);
    if (String(maintenance.mediaFormat || "").trim()) category.mediaFormat = String(maintenance.mediaFormat).trim().toUpperCase();
    const data = {
      title,
      categories: [category],
      LatestTime: now,
      totalFileSizeBytes: totalSize({ categories: [category] }),
    };
    if (Number.isInteger(Number(maintenance.anilistId)) && Number(maintenance.anilistId) > 0) data.anilistId = Number(maintenance.anilistId);
    if (Number.isInteger(Number(maintenance.rootAnilistId)) && Number(maintenance.rootAnilistId) > 0) data.rootAnilistId = Number(maintenance.rootAnilistId);
    if (String(maintenance.mediaFormat || "").trim()) data.mediaFormat = String(maintenance.mediaFormat).trim().toUpperCase();
    data.anilistIds = [...new Set([data.anilistId, data.rootAnilistId].filter((id) => Number.isInteger(id) && id > 0))];
    normalizeManifestSourceUrls(data);
    const duration = totalDuration(data);
    if (duration > 0 && hasCompleteDurations(data)) data.totalDurationSeconds = duration;
    if (String(maintenance.image || "").trim()) data.Image = String(maintenance.image).trim();
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const github = await publishSourceToGithub(target.path, content, { title, category: categoryName });
    await writeFile(target.absolute, content);
    const sourceList = await refreshSourceListPublication();
    return { action, path: target.path, file: target.file, title, category: categoryName, added: episodes.length, replaced: 0, skipped: 0, github, sourceList };
  }

  const target = sourceFileFromInput(maintenance.sourcePath);
  const data = JSON.parse(await readFile(target.absolute, "utf8"));
  if (!Array.isArray(data.categories)) data.categories = [];
  const categoryName = String(maintenance.categoryName || "").trim();
  let category = data.categories.find((candidate) => String(candidate?.category || "").trim() === categoryName);
  if (!category && maintenance.createCategory) {
    category = { category: categoryName || "Season 1", episodes: [] };
    data.categories.push(category);
  }
  if (!category) throw new Error(`category not found: ${categoryName}`);
  if (Number.isInteger(Number(maintenance.anilistId)) && Number(maintenance.anilistId) > 0) category.anilistId = Number(maintenance.anilistId);
  if (Number.isInteger(Number(maintenance.rootAnilistId)) && Number(maintenance.rootAnilistId) > 0) category.rootAnilistId = Number(maintenance.rootAnilistId);
  if (String(maintenance.mediaFormat || "").trim()) category.mediaFormat = String(maintenance.mediaFormat).trim().toUpperCase();
  const existingAnilistIds = Array.isArray(data.anilistIds) ? data.anilistIds : [];
  data.anilistIds = [...new Set([
    data.anilistId,
    data.rootAnilistId,
    ...existingAnilistIds,
    maintenance.anilistId,
    maintenance.rootAnilistId,
  ].map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!data.anilistId && Number.isInteger(Number(maintenance.anilistId)) && Number(maintenance.anilistId) > 0) data.anilistId = Number(maintenance.anilistId);
  if (!data.rootAnilistId && Number.isInteger(Number(maintenance.rootAnilistId)) && Number(maintenance.rootAnilistId) > 0) data.rootAnilistId = Number(maintenance.rootAnilistId);
  if (!data.mediaFormat && String(maintenance.mediaFormat || "").trim()) data.mediaFormat = String(maintenance.mediaFormat).trim().toUpperCase();
  const { key, entries } = getEntries(category);
  const incoming = selectArtifacts(artifacts, maintenance, entries);
  if (!incoming.length) throw new Error("the torrent produced no matching video links");
  const replaceExisting = maintenance.replaceExisting !== false;
  const addMissing = maintenance.addMissing !== false;
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const changed = [];
  const isMovieCategory = /\bmovies?\b/i.test(String(category.category || ""));
  for (const artifact of incoming) {
    let index = artifact.episode ? entries.findIndex((entry) => episodeInfo(entry?.title).episode === artifact.episode) : -1;
    if (index < 0 && isMovieCategory && entries.length === 1) index = 0;
    if (index >= 0) {
      if (entries[index]?.dualAudio === true && maintenance.dualAudio !== true && maintenance.allowAudioDowngrade !== true) {
        skipped += 1;
        continue;
      }
      if (!replaceExisting) { skipped += 1; continue; }
      entries[index] = makeEpisodeEntry(artifact, entries[index], maintenance);
      replaced += 1;
      changed.push(entries[index].title);
      continue;
    }
    if (!addMissing) { skipped += 1; continue; }
    const entry = makeEpisodeEntry(artifact, null, maintenance);
    entries.push(entry);
    added += 1;
    changed.push(entry.title);
  }
  entries.sort((a, b) => (episodeInfo(a?.title).episode || Number.MAX_SAFE_INTEGER) - (episodeInfo(b?.title).episode || Number.MAX_SAFE_INTEGER));
  normalizeManifestSourceUrls(data);
  data.LatestTime = now;
  const size = totalSize(data);
  if (size > 0) data.totalFileSizeBytes = size;
  const duration = totalDuration(data);
  if (duration > 0 && hasCompleteDurations(data)) data.totalDurationSeconds = duration;
  else delete data.totalDurationSeconds;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const title = data.title || target.file;
  const github = await publishSourceToGithub(target.path, content, { title, category: category.category });
  await writeFile(target.absolute, content);
  const sourceList = await refreshSourceListPublication();
  return { action, path: target.path, file: target.file, title, category: category.category, added, replaced, skipped, changed, github, sourceList };
}

async function applyMaintenanceSerially(maintenance, artifacts) {
  const key = String(maintenance?.sourcePath || maintenance?.sourceFile || maintenance?.title || "maintenance");
  const previous = maintenanceManifestQueues.get(key) || Promise.resolve();
  const next = previous.then(() => applyMaintenance(maintenance, artifacts), () => applyMaintenance(maintenance, artifacts));
  const tracked = next.catch(() => {});
  maintenanceManifestQueues.set(key, tracked);
  try {
    return await next;
  } finally {
    if (maintenanceManifestQueues.get(key) === tracked) maintenanceManifestQueues.delete(key);
  }
}

async function finishJob(job, code, error, { cancelled = false } = {}) {
  if (job.finishedAt || job.finishing) return;
  job.finishing = true;
  clearTorrentStallWatch(job);
  let finalCode = code;
  let wasCancelled = cancelled || job.cancelled === true || job.stopRequested === true;
  if (finalCode === 0 && job.maintenance && !wasCancelled) {
    job.state = "finalizing";
    if (job.durationProbePromises?.size) {
      await Promise.allSettled([...job.durationProbePromises.values()]);
    }
    if (job.audioProbePromises?.size) {
      await Promise.allSettled([...job.audioProbePromises.values()]);
    }
    if (job.maintenance.dualAudio === true) {
      const probedArtifacts = job.artifacts.filter((artifact) => artifact?.remotePath || artifact?.localPath || artifact?.url);
      if (!probedArtifacts.length || probedArtifacts.some((artifact) => !Number.isInteger(Number(artifact.audioStreamCount)) || Number(artifact.audioStreamCount) < 2)) {
        finalCode = 1;
        error = new Error("dual-audio release failed post-conversion audio validation (every artifact must contain at least two audio streams)");
      }
    }
    try {
      if (finalCode === 0) job.manifest = await applyMaintenanceSerially(job.maintenance, job.artifacts);
    } catch (maintenanceError) {
      finalCode = 1;
      error = maintenanceError;
    }
  }
  if (job.cancelled === true || job.stopRequested === true) {
    wasCancelled = true;
    finalCode = finalCode === 0 ? 1 : finalCode;
    error ||= new Error("Job stopped.");
  }
  if (job.cacheDir) await clearStalePipelineLock(job.cacheDir).catch(() => {});
  if (job.cacheDir) await cleanupJobCache(job);
  job.finishedAt = new Date().toISOString();
  job.exitCode = finalCode;
  job.state = wasCancelled ? "cancelled" : finalCode === 0 ? "complete" : "failed";
  if (error) job.events.push({ at: new Date().toISOString(), event: "error", message: error instanceof Error ? error.message : String(error) });
  persistLog({
    scope: "job",
    event: wasCancelled ? "job_cancelled" : finalCode === 0 ? "job_complete" : "job_failed",
    jobId: job.id,
    runId: job.runId,
    state: job.state,
    exitCode: finalCode,
    cleanup: job.cleanup?.state || undefined,
    manifestProvider: job.manifest?.github?.provider || undefined,
    manifestCommitSha: job.manifest?.github?.commitSha || undefined,
    message: error ? (error instanceof Error ? error.message : String(error)) : undefined,
  });
  if (!wasCancelled && finalCode !== 0) {
    job.failureWebhookNotified = true;
    void queueFailureWebhook({
      scope: "job",
      title: job.maintenance?.title || job.destination || "Torrent job",
      category: job.maintenance?.categoryName || "",
      provider: job.maintenance?.provider || "torrent",
      runId: job.runId,
      jobId: job.id,
      message: error ? (error instanceof Error ? error.message : String(error)) : `td exited with code ${finalCode}`,
    });
  }
  if (job.maintenance) await persistResumeState();
  delete job.finishing;
  job.resolveDone?.(job);
}

function recordEvent(job, event, stream) {
  const normalizedEvent = event?.url
    ? { ...event, url: normalizeToodriveUrl(event.url) }
    : event;
  if (normalizedEvent.event === "log") {
    const message = String(normalizedEvent.message || "");
    if (/\b(?:converting|normalizing audio)\b/i.test(message)) job.lastTransferPhase = "processing";
    else if (/\b(?:uploading|uploaded)\b/i.test(message)) job.lastTransferPhase = "uploading";
  }
  if (normalizedEvent.event === "metadata") job.metadataSeen = true;
  if (normalizedEvent.event === "progress") {
    const transferredBytes = Math.max(0, Number(normalizedEvent.transferredBytes) || 0);
    const totalBytes = Math.max(0, Number(normalizedEvent.totalBytes) || 0);
    if (transferredBytes > 0) job.hasTransferProgress = true;
    if (normalizedEvent.phase === "disk_download") {
      job.lastTransferPhase = "disk_download";
      job.lastTransferTotal = totalBytes;
      job.currentRemotePath = normalizedEvent.remotePath || job.currentRemotePath || "";
      if (!job.lastTransferAt || transferredBytes > job.lastTransferBytes) {
        job.lastTransferAt = Date.now();
        job.lastTransferBytes = transferredBytes;
      }
      job.lastPeerCount = Number(normalizedEvent.numPeers) || 0;
      job.lastSeedCount = Number(normalizedEvent.numSeeds) || 0;
    } else if (normalizedEvent.phase) {
      job.lastTransferPhase = String(normalizedEvent.phase);
    }
  }
  if (normalizedEvent.event === "link" && normalizedEvent.url) {
    if (!job.links.includes(normalizedEvent.url)) job.links.push(normalizedEvent.url);
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === normalizedEvent.remotePath);
    if (artifact) artifact.url = normalizedEvent.url;
    else job.artifacts.push({ remotePath: normalizedEvent.remotePath || "", url: normalizedEvent.url });
  }
  if (normalizedEvent.event === "file_result" && normalizedEvent.remotePath) {
    job.lastTransferPhase = "finalizing";
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === normalizedEvent.remotePath);
    const reportedAudioStreamCount = Number(normalizedEvent.audioStreamCount);
    const audioFields = Number.isInteger(reportedAudioStreamCount) && reportedAudioStreamCount >= 0
      ? { audioStreamCount: reportedAudioStreamCount }
      : {};
    const target = artifact || {
      remotePath: normalizedEvent.remotePath,
      sizeBytes: normalizedEvent.sizeBytes,
      localPath: normalizedEvent.localPath,
      ...audioFields,
    };
    if (artifact) Object.assign(target, {
      sizeBytes: normalizedEvent.sizeBytes,
      localPath: normalizedEvent.localPath,
      ...audioFields,
    });
    else job.artifacts.push(target);
    scheduleArtifactDurationProbe(job, target, normalizedEvent);
    if (job.maintenance?.dualAudio === true) scheduleArtifactAudioProbe(job, target);
    const uploaded = String(normalizedEvent.outcome || "").toLowerCase() === "uploaded";
    if (uploaded) queueUploadedArtifactCleanup(job, target);
  }
  if (normalizedEvent.event === "link" && normalizedEvent.remotePath) {
    queueUploadedArtifactCleanup(job, job.artifacts.find((candidate) => candidate.remotePath === normalizedEvent.remotePath));
  }
  job.events.push({ at: new Date().toISOString(), stream, ...normalizedEvent });
  if (job.events.length > 5000) job.events.shift();
  persistLog({ scope: "job", jobId: job.id, runId: job.runId, stream, ...normalizedEvent });
}

function maintenanceTargetEpisodes(job) {
  return normalizedEpisodeNumbers(job.maintenance?.targetEpisodes);
}

function jobDownloadMode(job, downloadAll) {
  if (maintenanceTargetEpisodes(job).length) return "selected_episodes";
  return downloadAll ? "download_all" : "sequential";
}

function queuePosition(job) {
  const index = pipelineQueue.findIndex((entry) => entry.job === job);
  return index >= 0 ? index + 1 : 0;
}

function removeQueuedJob(job) {
  const index = pipelineQueue.findIndex((entry) => entry.job === job);
  if (index < 0) return false;
  pipelineQueue.splice(index, 1);
  job.queueEntry = null;
  return true;
}

function releasePipelineSlot(job) {
  if (!activePipelineJobs.delete(job)) return;
  if (activePipelineJob === job) activePipelineJob = activePipelineJobs.values().next().value || null;
  drainPipelineQueue();
}

function drainPipelineQueue() {
  while (activePipelineJobs.size < MAX_TORRENT_CONCURRENCY && pipelineQueue.length) {
    const entry = pipelineQueue.shift();
    const job = entry.job;
    job.queueEntry = null;
    if (job.finishedAt) continue;
    if (job.stopRequested || job.cancelled) {
      void finishJob(job, 1, new Error("Job stopped before it started."), { cancelled: true })
        .finally(() => drainPipelineQueue());
      continue;
    }
    activePipelineJobs.add(job);
    activePipelineJob ||= job;
    try {
      spawnTdAttempt(job, entry.options, () => releasePipelineSlot(job));
    } catch (error) {
      void finishJob(job, 1, error).finally(() => releasePipelineSlot(job));
    }
  }
}

function enqueueTdAttempt(job, options) {
  job.state = "queued";
  const entry = { job, options };
  job.queueEntry = entry;
  pipelineQueue.push(entry);
  persistLog({
    scope: "job",
    event: "job_queued",
    jobId: job.id,
    runId: job.runId,
    position: queuePosition(job),
    mode: jobDownloadMode(job, options.downloadAll),
  });
  drainPipelineQueue();
}

function requestJobStop(job) {
  if (!job || job.finishedAt) return Promise.resolve(job);
  job.stopRequested = true;
  job.cancelled = true;
  if (removeQueuedJob(job)) {
    void finishJob(job, 1, new Error("Job stopped before it started."), { cancelled: true })
      .finally(() => drainPipelineQueue());
    return job.done;
  }
  if (job.child) {
    terminateTdProcess(job, "SIGTERM");
    return job.done;
  }
  if (!job.finishing) {
    void finishJob(job, 1, new Error("Job stopped."), { cancelled: true })
      .finally(() => releasePipelineSlot(job));
  }
  return job.done;
}

function tdAttemptArgs(job, { downloadAll, repairAttempts }) {
  const args = [
    "--base-url", TOODRIVE_BASE_URL,
    "torrent", job.source, job.destination,
    "--video-pipeline",
  ];
  const targetEpisodes = maintenanceTargetEpisodes(job);
  if (targetEpisodes.length) args.push("--only-episodes", targetEpisodes.join(","));
  if (downloadAll && !targetEpisodes.length) args.push("--download-all");
  args.push(
    "--repair",
    "--repair-attempts", String(repairAttempts),
    "--json",
    "--cache-dir", job.cacheDir,
  );
  if (BROWSER_COMPATIBILITY_ENABLED && job.maintenance) {
    args.push("--cmd-after-dl", BROWSER_COMPATIBILITY_SCRIPT, "--cmd-exit", "fail");
  }
  if (job.maintenance?.replaceExisting) args.push("--exist=overwrite");
  return args;
}

function shouldFallbackToSequential(job, code) {
  return code !== 0
    && job.adaptiveFallback
    && !job.fallbackAttempted
    && !job.stopRequested
    && job.metadataSeen
    && !job.hasTransferProgress
    && job.links.length === 0
    && job.artifacts.length === 0;
}

function toodriveAuthenticationFailure(job, attemptError, eventStart = 0) {
  const events = Array.isArray(job?.events) ? job.events.slice(eventStart) : [];
  const eventFailure = events.find((event) => {
    const code = String(event?.code || event?.errorCode || "").toLowerCase();
    const message = String(event?.message || event?.error || "").toLowerCase();
    return code === "session_expired"
      || code === "not_logged_in"
      || code === "unauthorized"
      || /session\s+expired|session\s+invalid|not\s+logged\s+in|authentication\s+failed|unauthenticated/.test(message);
  });
  if (eventFailure) return eventFailure;
  const message = String(attemptError?.message || "").toLowerCase();
  return /session\s+expired|session\s+invalid|not\s+logged\s+in|authentication\s+failed|unauthenticated/.test(message)
    ? { message: attemptError.message }
    : null;
}

function toodriveTransientFailure(job, attemptError, eventStart = 0) {
  const events = Array.isArray(job?.events) ? job.events.slice(eventStart) : [];
  const eventFailure = events.find((event) => {
    const code = String(event?.code || event?.errorCode || "").toLowerCase();
    const message = String(event?.message || event?.error || "").toLowerCase();
    return code === "upload_failed"
      || code === "http_530"
      || code === "network_error"
      || code === "upload_retry"
      || /failed\s+to\s+upload\s+chunk|http\s*5\d{2}|status\s*5\d{2}|econnreset|etimedout|temporarily\s+unavailable|connection\s+(?:reset|closed)/.test(message);
  });
  if (eventFailure) return eventFailure;
  const message = String(attemptError?.message || "").toLowerCase();
  return /http\s*5\d{2}|status\s*5\d{2}|econnreset|etimedout|temporarily\s+unavailable|connection\s+(?:reset|closed)/.test(message)
    ? { message: attemptError.message }
    : null;
}

function emitSequentialFallback(job, reason) {
  job.fallbackAttempted = true;
  const event = {
    event: "pipeline_fallback",
    code: "download_all_fallback",
    message: "Concurrent download-all failed before transfer; retrying sequentially from the preserved cache.",
    reason,
    mode: "sequential",
  };
  recordEvent(job, event, "service");
}

function terminateTdProcess(job, signal = "SIGTERM") {
  const child = job?.child;
  if (!child) return;
  const pid = Number(child.pid);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      // td launches ffmpeg and the post-download shell hook. It is started
      // detached so the whole process group can be stopped together instead
      // of leaving orphaned encoders behind when a torrent is stalled.
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if (!['ESRCH', 'EINVAL'].includes(String(error?.code || ""))) throw error;
    }
  }
  child.kill(signal);
}

function clearTorrentStallWatch(job) {
  if (job?.stallTimer) clearInterval(job.stallTimer);
  if (job) job.stallTimer = null;
}

function startTorrentStallWatch(job) {
  clearTorrentStallWatch(job);
  if (!job?.maintenance) return;
  job.lastTransferAt = 0;
  job.lastTransferBytes = 0;
  job.lastTransferTotal = 0;
  job.lastTransferPhase = "";
  job.stallRequested = false;
  job.stallError = null;
  job.stallTimer = setInterval(() => {
    if (job.finishedAt || job.stopRequested || job.cancelled || !job.child) {
      clearTorrentStallWatch(job);
      return;
    }
    if (job.lastTransferPhase !== "disk_download" || !job.lastTransferAt) return;
    if (Date.now() - job.lastTransferAt < TORRENT_STALL_TIMEOUT_MS) return;
    if (job.stallRequested) return;
    job.stallRequested = true;
    job.stallError = new Error(`Torrent stalled for ${Math.round(TORRENT_STALL_TIMEOUT_MS / 60_000)} minutes with no byte movement`);
    recordEvent(job, {
      event: "warning",
      code: "torrent_stalled",
      message: `${job.stallError.message}; stopping this release so maintenance can retry or choose another candidate`,
      phase: "disk_download",
      remotePath: job.currentRemotePath || undefined,
      transferredBytes: job.lastTransferBytes,
      totalBytes: job.lastTransferTotal,
    }, "service");
    terminateTdProcess(job, "SIGTERM");
  }, TORRENT_STALL_CHECK_INTERVAL_MS);
}

function spawnTdAttempt(job, { downloadAll, repairAttempts, retry = false }, releaseSlot = () => {}) {
  const attemptEventStart = job.events.length;
  const args = tdAttemptArgs(job, { downloadAll, repairAttempts });
  const child = spawn(TD_BIN, args, {
    detached: true,
    env: {
      ...process.env,
      // One upload stream avoids losing an entire file when a concurrent HTTP/2
      // chunk request fails. Operators can override this for non-maintenance use.
      TOODRIVE_UPLOAD_CONCURRENCY: process.env.TOODRIVE_UPLOAD_CONCURRENCY || "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  job.pid = child.pid;
  startTorrentStallWatch(job);
  job.state = "running";
  job.downloadAll = downloadAll;
  job.attempt = (job.attempt || 0) + 1;
  if (retry) {
    persistLog({
      scope: "job",
      event: "job_retry",
      jobId: job.id,
      runId: job.runId,
      pid: child.pid,
      mode: jobDownloadMode(job, downloadAll),
      attempt: job.attempt,
    });
  } else {
    persistLog({
      scope: "job",
      event: "job_started",
      jobId: job.id,
      runId: job.runId,
      pid: child.pid,
      source: job.source,
      destination: job.destination,
      mode: jobDownloadMode(job, downloadAll),
    });
  }

  const buffers = { stdout: "", stderr: "" };
  const consume = (chunk, stream) => {
    buffers[stream] += String(chunk);
    const lines = buffers[stream].split(/\r?\n/);
    buffers[stream] = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      let event;
      try { event = JSON.parse(line); } catch { event = { event: "log", message: line }; }
      recordEvent(job, event, stream);
    }
  };
  const flush = () => {
    for (const stream of ["stdout", "stderr"]) {
      if (!buffers[stream]) continue;
      let event;
      try { event = JSON.parse(buffers[stream]); } catch { event = { event: "log", message: buffers[stream] }; }
      recordEvent(job, event, stream);
      buffers[stream] = "";
    }
  };
  let attemptError = null;
  let settled = false;
  const settle = (code) => {
    if (settled) return;
    settled = true;
    clearTorrentStallWatch(job);
    flush();
    job.child = null;
    if (job.stallError) attemptError ||= job.stallError;
    const exitCode = code ?? 1;
    const authFailure = toodriveAuthenticationFailure(job, attemptError, attemptEventStart);
    if (exitCode !== 0 && authFailure && TOODRIVE_AUTO_LOGIN && !job.stopRequested && job.authRetryCount < MAX_TOODRIVE_AUTH_RETRIES) {
      job.authRetryCount += 1;
      job.state = "authenticating";
      persistLog({
        scope: "job",
        event: "td_auth_retry",
        jobId: job.id,
        runId: job.runId,
        attempt: job.attempt,
        retry: job.authRetryCount,
      });
      void (async () => {
        let login;
        try {
          login = await reloginToodrive();
        } catch (error) {
          login = { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
        if (login?.ok && !job.stopRequested && !job.cancelled) {
          persistLog({
            scope: "job",
            event: "td_auth_relogged",
            jobId: job.id,
            runId: job.runId,
            retry: job.authRetryCount,
          });
          await clearStalePipelineLock(job.cacheDir).catch(() => {});
          spawnTdAttempt(job, { downloadAll, repairAttempts, retry: true }, releaseSlot);
          return;
        }
        const message = login?.message || "Toodrive automatic login failed.";
        void finishJob(job, exitCode, new Error(message), {
          cancelled: job.stopRequested || job.cancelled,
        }).finally(releaseSlot);
      })();
      return;
    }
    const transientFailure = job.stallRequested
      ? { code: "torrent_stalled", message: job.stallError?.message || "torrent stalled" }
      : toodriveTransientFailure(job, attemptError, attemptEventStart);
    if (exitCode !== 0 && transientFailure && !job.stopRequested && !job.cancelled && job.transientRetryCount < MAX_TD_TRANSIENT_RETRIES) {
      job.transientRetryCount += 1;
      job.stallRequested = false;
      job.stallError = null;
      const retryNumber = job.transientRetryCount;
      const delay = Math.min(120_000, TD_TRANSIENT_RETRY_BASE_MS * (2 ** (retryNumber - 1)));
      job.state = "retrying";
      persistLog({
        scope: "job",
        event: "td_transient_retry",
        jobId: job.id,
        runId: job.runId,
        attempt: job.attempt,
        retry: retryNumber,
        delayMs: delay,
      });
      void (async () => {
        await new Promise((resolveWait) => setTimeout(resolveWait, delay));
        if (job.stopRequested || job.cancelled) {
          void finishJob(job, exitCode, new Error("Job stopped."), { cancelled: true }).finally(releaseSlot);
          return;
        }
        await clearStalePipelineLock(job.cacheDir).catch(() => {});
        spawnTdAttempt(job, { downloadAll, repairAttempts, retry: true }, releaseSlot);
      })().catch((error) => {
        void finishJob(job, exitCode, error).finally(releaseSlot);
      });
      return;
    }
    if (shouldFallbackToSequential(job, exitCode)) {
      emitSequentialFallback(job, attemptError?.message || `td exited with code ${exitCode}`);
      void clearStalePipelineLock(job.cacheDir).catch(() => {}).finally(() => {
        spawnTdAttempt(job, {
          downloadAll: false,
          repairAttempts: MAINTENANCE_TD_REPAIR_ATTEMPTS,
          retry: true,
        }, releaseSlot);
      });
      return;
    }
    void finishJob(job, exitCode, attemptError).finally(releaseSlot);
  };
  child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
  child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
  child.on("error", (error) => { attemptError = error; });
  child.on("close", settle);
  job.stop = () => requestJobStop(job);
}

async function startJob({ torrentUrl, magnet, destination, cacheDir, runId, maintenance }) {
  if (!torrentUrl && !magnet) throw new Error("torrentUrl or magnet is required");
  if (!destination || typeof destination !== "string") throw new Error("destination is required");
  const normalizedMaintenance = maintenance
    ? {
      ...maintenance,
      targetEpisodes: Array.isArray(maintenance.targetEpisodes) ? [...maintenance.targetEpisodes] : maintenance.targetEpisodes,
    }
    : null;
  if (normalizedMaintenance?.title && normalizedMaintenance?.categoryName) {
    const expectedDestination = maintenanceFolder(normalizedMaintenance.title, normalizedMaintenance.categoryName);
    if (expectedDestination !== destination) {
      throw new Error(`maintenance job destination mismatch: expected ${expectedDestination}, received ${destination}`);
    }
  }
  const id = randomUUID();
  let resolveDone;
  const source = torrentUrl || magnet;
  const job = {
    id, state: "starting", events: [], links: [], artifacts: [], manifest: null,
    runId: runId || normalizedMaintenance?.runId || null, maintenance: normalizedMaintenance, cacheDir: null, startedAt: new Date().toISOString(),
    source, destination, adaptiveFallback: Boolean(normalizedMaintenance), fallbackAttempted: false,
    metadataSeen: false, hasTransferProgress: false, stopRequested: false, cancelled: false, attempt: 0,
    stallTimer: null, stallRequested: false, stallError: null, lastTransferAt: 0, lastTransferBytes: 0, lastTransferTotal: 0, lastTransferPhase: "",
    authRetryCount: 0, transientRetryCount: 0,
    fileCleanupPromises: new Set(),
    durationProbePromises: new Map(),
    audioProbePromises: new Map(),
    done: new Promise((resolveDonePromise) => { resolveDone = resolveDonePromise; }),
  };
  job.resolveDone = resolveDone;
  job.stop = () => requestJobStop(job);
  jobs.set(id, job);
  const cacheRoot = resolve(cacheDir || DEFAULT_CACHE);
  const cache = join(cacheRoot, id);
  await mkdir(cache, { recursive: true });
  job.cacheDir = cache;
  await clearStalePipelineLock(cache);
  const repairAttempts = normalizedMaintenance ? MAINTENANCE_TD_REPAIR_ATTEMPTS : DEFAULT_TD_REPAIR_ATTEMPTS;
  const downloadAll = !normalizedMaintenance || normalizedMaintenance.action === "new";
  if (normalizedMaintenance) await persistResumeState();
  await ensureToodriveCompatibility();
  enqueueTdAttempt(job, { downloadAll, repairAttempts });
  if (normalizedMaintenance) await persistResumeState();
  return job;
}

function restoreJob(saved) {
  let resolveDone;
  const job = {
    ...saved,
    events: [],
    links: [],
    artifacts: [],
    manifest: null,
    finishing: false,
    stopRequested: saved.stopRequested === true,
    cancelled: saved.cancelled === true,
    stallTimer: null,
    stallRequested: false,
    stallError: null,
    lastTransferAt: 0,
    lastTransferBytes: 0,
    lastTransferTotal: 0,
    lastTransferPhase: "",
    fileCleanupPromises: new Set(),
    durationProbePromises: new Map(),
    audioProbePromises: new Map(),
    done: new Promise((resolveDonePromise) => { resolveDone = resolveDonePromise; }),
  };
  job.resolveDone = resolveDone;
  job.stop = () => requestJobStop(job);
  jobs.set(job.id, job);
  if (job.finishedAt) job.resolveDone(job);
  return job;
}

function normalizePausedRunAfterRestart(run) {
  if (!run?.paused) return false;
  let changed = false;
  const activeStates = new Set(["searching", "downloading", "processing", "uploading"]);
  for (const item of run.items || []) {
    if (activeStates.has(item.state)) {
      item.state = "queued";
      item.error = "";
      item.jobId = null;
      item.jobIds = [];
      changed = true;
    }
    for (const release of item.releaseStates || []) {
      if (["complete", "failed", "cancelled"].includes(release.state)) continue;
      release.state = "queued";
      release.jobId = null;
      changed = true;
    }
    syncMaintenanceReleaseSummary(item);
  }
  for (const job of jobs.values()) {
    if (job.runId !== run.id || job.finishedAt) continue;
    // The parent service has already stopped; these restored records must not
    // appear as live transfers or block the paused run from resuming.
    job.stopRequested = true;
    job.cancelled = true;
    job.state = "cancelled";
    job.finishedAt = job.finishedAt || new Date().toISOString();
    changed = true;
  }
  if (run.pauseDraining || run.current || run.currentJobId || (run.active || []).length || (run.activeJobIds || []).length) {
    run.pauseDraining = false;
    run.current = null;
    run.currentJobId = null;
    run.active = [];
    run.activeJobIds = [];
    changed = true;
  }
  run.state = "paused";
  run.phase = "paused";
  return changed;
}

async function resumeMaintenanceRun(run) {
  if (run.paused || run.state === "paused" || run.pauseRequested) {
    run.paused = true;
    run.pauseRequested = false;
    run.state = "paused";
    run.phase = "paused";
    syncRunActivity(run);
    await persistResumeState();
    return;
  }
  const payload = run.payload || {};
  if (payload.discoverCatalog === true) catalogRunId = run.id;
  if (run.items.length && run.state !== "checking") {
    run.state = "running";
    run.phase = "maintenance";
    await persistResumeState();
    startExecuteMaintenanceRun(run, payload);
    return;
  }

  const library = await listLibrary();
  run.state = "checking";
  run.phase = maintenanceAniListEnabled(payload) ? "anilist" : "planning";
  runEvent(run, "Resuming maintenance planning after a service restart.");
  const planned = await buildMaintenanceWork(library.sources, payload, {
    onProgress: (progress) => {
      if (progress?.completed) run.preflightCompleted = progress.completed;
      if (progress?.title) run.preflightCurrent = { title: progress.title, category: progress.category || "" };
    },
  });
  run.items = planned.work;
  run.preflightCurrent = null;
  run.total = run.items.length;
  run.preflightCompleted = planned.preflightCompleted;
  run.preflightTotal = planned.preflightTotal;
  run.completed = 0;
  run.failed = 0;
  run.skipped = 0;
  await persistResumeState();
  if (run.planOnly) {
    run.state = "complete";
    run.phase = "plan";
    run.finishedAt = new Date().toISOString();
    if (catalogRunId === run.id) catalogRunId = null;
    runEvent(run, `Plan ready: ${run.items.filter((item) => item.state === "queued").length} category(s) need maintenance.`);
    return;
  }
  if (!run.total) {
    run.state = "complete";
    run.phase = "complete";
    run.finishedAt = new Date().toISOString();
    if (catalogRunId === run.id) catalogRunId = null;
    await persistResumeState();
    return;
  }
  const hasQueuedWork = run.items.some((item) => item.state === "queued");
  if (hasQueuedWork && payload?.tdPreflight !== false) {
    run.phase = "auth";
    runEvent(run, "Checking the Toodrive session before resuming maintenance jobs.");
    const tdSession = await checkTdSession();
    if (tdSession.relogged) runEvent(run, "Toodrive session expired; logged in again automatically.");
    if (!tdSession.ok) {
      const loginHint = /\btd login\b/.test(String(tdSession.message || ""))
        ? ""
        : " Run: td login --auth-backend=file";
      throw new Error(`Toodrive authentication failed (${tdSession.code || "unknown"}): ${tdSession.message}.${loginHint}`);
    }
  }
  run.state = "running";
  run.phase = "maintenance";
  await persistResumeState();
  startExecuteMaintenanceRun(run, payload);
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function recoverLegacyMaintenanceWork(knownRunIds, knownJobIds) {
  let raw;
  try {
    const handle = await open(LOG_FILE, "r");
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - LEGACY_RECOVERY_LOG_BYTES);
      const buffer = Buffer.alloc(Number(size - start));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      // If the tail starts in the middle of a JSON line, split/filter below
      // safely discards that one partial line.
      raw = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const entries = raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const started = new Map();
  const completedJobs = new Set();
  const jobMetadata = new Map();
  const runEntries = new Map();
  for (const entry of entries) {
    if (entry.scope === "job" && entry.jobId) {
      if (entry.event === "job_started" && entry.runId) started.set(entry.jobId, entry);
      if (entry.event === "job_complete") completedJobs.add(entry.jobId);
      if (entry.event === "metadata" && entry.cachePath) jobMetadata.set(entry.jobId, entry);
    }
    if (entry.scope === "run" && entry.runId) {
      if (!runEntries.has(entry.runId)) runEntries.set(entry.runId, []);
      runEntries.get(entry.runId).push(entry);
    }
  }
  const library = await listLibrary();
  for (const [jobId, jobStart] of started) {
    const startedAt = Date.parse(jobStart.at || "");
    if (Number.isFinite(startedAt) && Date.now() - startedAt > LEGACY_RECOVERY_MAX_AGE_MS) continue;
    if (knownJobIds.has(jobId) || completedJobs.has(jobId) || processIsAlive(jobStart.pid)) continue;
    const runId = jobStart.runId;
    if (!runId || cancelledRunIds.has(String(runId)) || knownRunIds.has(runId)) continue;
    const events = runEntries.get(runId) || [];
    // Older recovery used the first "Searching" event in a run. A run can
    // contain several shows, so that paired an unrelated torrent with the
    // first title after a restart. Resolve the item from the job's persisted
    // destination first; the torrent destination is the authoritative pair.
    const destination = String(jobStart.destination || "").trim();
    let source = null;
    let category = "";
    for (const candidate of library.sources) {
      const matchedCategory = (candidate.categories || []).find((entry) => maintenanceFolder(candidate.title, entry.category) === destination);
      if (matchedCategory) {
        source = candidate;
        category = matchedCategory.category;
        break;
      }
    }
    if (!source) {
      const searching = events.find((entry) => /Searching (?:Nyaa|SeaDex|release sources) automatically for /i.test(entry.message || ""));
      const match = String(searching?.message || "").match(/^Searching (?:Nyaa|SeaDex|release sources) automatically for (.+?) · (.+)\.$/);
      if (!match) continue;
      const [, title, searchedCategory] = match;
      source = library.sources.find((candidate) => candidate.title === title);
      category = searchedCategory;
    }
    if (!source || !source.categories.some((candidate) => candidate.category === category)) continue;
    const title = source.title;
    const cacheDir = jobMetadata.get(jobId)?.cachePath;
    if (!cacheDir) continue;
    const selectedPrefix = `for ${title} · ${category}`;
    const selected = events.find((entry) => /^Selected .+ for /i.test(entry.message || "") && String(entry.message).includes(selectedPrefix));
    const selectedTitle = String(selected?.message || "").match(/^Selected (.+?) for /)?.[1] || "";
    const itemId = `recovered-${jobId}`;
    const run = {
      id: runId,
      state: "running",
      phase: "maintenance",
      total: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      preflightCompleted: 1,
      preflightTotal: 1,
      preflightCurrent: null,
      current: itemId,
      currentJobId: jobId,
      active: [{ id: itemId, title, category, state: "downloading", jobId }],
      activeJobIds: [jobId],
      items: [{
        id: itemId,
        sourcePath: source.path,
        sourceFile: source.file,
        title,
        category,
        state: "downloading",
        query: "",
        candidate: selectedTitle ? { title: selectedTitle } : null,
        release: { torrentUrl: jobStart.source || "", magnet: "" },
        jobId,
        manifest: null,
        links: 0,
        error: "",
        missingEpisodes: [],
        counted: false,
      }],
      events,
      startedAt: jobStart.at || new Date().toISOString(),
      finishedAt: null,
      cancelled: false,
      planOnly: false,
      payload: { malCheck: false, replaceExisting: true, addMissing: true, tdPreflight: false },
    };
    run.stop = () => {
      run.cancelled = true;
      const stopping = stopMaintenanceChildren(run);
      syncRunActivity(run);
      void persistResumeState();
      return stopping;
    };
    maintenanceRuns.set(run.id, run);
    restoreJob({
      id: jobId,
      runId,
      state: "running",
      source: jobStart.source,
      destination: jobStart.destination,
      maintenance: {
        action: "update",
        sourcePath: source.path,
        categoryName: category,
        title,
        image: source.image || undefined,
        seasonNumber: categorySeasonNumber(category) || undefined,
        replaceExisting: true,
        addMissing: true,
      },
      cacheDir,
      adaptiveFallback: true,
      fallbackAttempted: false,
      metadataSeen: true,
      hasTransferProgress: true,
      stopRequested: false,
      attempt: 1,
      downloadAll: false,
      startedAt: jobStart.at || new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
    });
    knownRunIds.add(runId);
    knownJobIds.add(jobId);
  }
}

async function restorePersistedWork() {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(RESUME_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") snapshot = { version: 1, runs: [], jobs: [] };
    else {
      console.error(`[maintenance-resume] could not read resume state: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  if (snapshot?.version !== 1) return;
  await loadCancelledRunIds();

  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
  const savedJobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  for (const saved of runs) {
    if (!saved?.id || cancelledRunIds.has(String(saved.id)) || saved.finishedAt || ["complete", "failed", "cancelled"].includes(saved.state)) continue;
    const run = {
      ...saved,
      events: Array.isArray(saved.events) ? saved.events : [],
      items: Array.isArray(saved.items) ? saved.items : [],
      active: Array.isArray(saved.active) ? saved.active : [],
      activeJobIds: Array.isArray(saved.activeJobIds) ? saved.activeJobIds : [],
      // Older snapshots may contain the former parallel settings. Recompute
      // them through the current hard one-job limits on every restart.
      concurrency: maintenanceConcurrency(saved.payload || {}),
      torrentConcurrency: torrentConcurrency(saved.payload || {}),
      payload: saved.payload || {},
      cancelled: saved.cancelled === true,
      paused: saved.paused === true || saved.pauseRequested === true || ["paused", "pausing"].includes(saved.state),
      pauseRequested: false,
    };
    run.stop = () => {
      run.pauseRequested = false;
      run.paused = false;
      run.cancelled = true;
      const stopping = stopMaintenanceChildren(run);
      syncRunActivity(run);
      void persistResumeState();
      return stopping;
    };
    maintenanceRuns.set(run.id, run);
  }
  for (const saved of savedJobs) {
    if (!saved?.id || !saved.maintenance || !saved.cacheDir) continue;
    if (saved.runId && !maintenanceRuns.has(saved.runId)) continue;
    restoreJob(saved);
  }
  for (const run of maintenanceRuns.values()) syncRunActivity(run);
  deduplicateMaintenanceRuns();

  for (const run of maintenanceRuns.values()) {
    if (!run.paused) continue;
    if (normalizePausedRunAfterRestart(run)) {
      runEvent(run, "Recovered paused maintenance work after service restart; unfinished transfers remain queued until resume.");
    }
  }
  await persistResumeState();

  await recoverLegacyMaintenanceWork(
    new Set(maintenanceRuns.keys()),
    new Set(jobs.keys()),
  );

  for (const job of jobs.values()) {
    if (!job.maintenance || job.finishedAt) continue;
    if (job.runId && maintenanceRuns.get(job.runId)?.paused) continue;
    await mkdir(job.cacheDir, { recursive: true });
    await clearStalePipelineLock(job.cacheDir);
    const downloadAll = job.maintenance.action === "new" && job.downloadAll !== false;
    enqueueTdAttempt(job, {
      downloadAll,
      repairAttempts: MAINTENANCE_TD_REPAIR_ATTEMPTS,
      retry: job.attempt > 0,
    });
  }
  for (const run of maintenanceRuns.values()) {
    if (run.paused) {
      run.state = "paused";
      run.phase = "paused";
      syncRunActivity(run);
      continue;
    }
    runEvent(run, "Found unfinished maintenance work after service restart.");
    void resumeMaintenanceRun(run).catch(async (error) => {
      run.failed += 1;
      run.state = "failed";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      if (catalogRunId === run.id) catalogRunId = null;
      runEvent(run, error instanceof Error ? error.message : String(error));
      void queueFailureWebhook({
        scope: "run",
        title: "Maintenance resume",
        runId: run.id,
        message: error instanceof Error ? error.message : String(error),
        failed: run.failed,
        total: run.total,
      });
      await persistResumeState();
    });
  }
}

async function startAutomaticCatalogRun(reason = "automatic") {
  if (!CATALOG_SCAN_ENABLED || MAINTENANCE_ROLE === "general") return null;
  if (catalogRunId) {
    const existing = maintenanceRuns.get(catalogRunId);
    if (existing && !existing.finishedAt && !["complete", "failed", "cancelled"].includes(existing.state)) return existing;
    catalogRunId = null;
  }
  const state = await loadCatalogState();
  if (state.sourceListPending === true) await refreshSourceListPublication();
  const run = await startMaintenanceRun({
    discoverCatalog: true,
    catalogScan: true,
    catalogOnly: true,
    catalogReason: reason,
    malCheck: false,
    replaceExisting: true,
    addMissing: true,
    tdPreflight: true,
  });
  catalogRunId = run.id;
  return run;
}

function publicJob(job) {
  return {
    id: job.id,
    runId: job.runId,
    state: job.state,
    pid: job.pid,
    links: job.links,
    artifacts: job.artifacts,
    manifest: job.manifest,
    cleanup: job.cleanup || null,
    queuePosition: queuePosition(job),
    events: job.events,
    maintenance: job.maintenance ? {
      action: job.maintenance.action || "update",
      categoryName: job.maintenance.categoryName || "",
      targetEpisodes: normalizedEpisodeNumbers(job.maintenance.targetEpisodes),
    } : null,
    downloadAll: job.downloadAll !== false,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
  };
}

function publicJobSummary(job) {
  return {
    id: job.id,
    runId: job.runId,
    state: job.state,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    queuePosition: queuePosition(job),
    maintenance: job.maintenance ? {
      action: job.maintenance.action || "update",
      title: job.maintenance.title || "",
      categoryName: job.maintenance.categoryName || "",
      sourcePath: job.maintenance.sourcePath || "",
      targetEpisodes: normalizedEpisodeNumbers(job.maintenance.targetEpisodes),
    } : null,
  };
}

function publicActiveWork() {
  const terminalStates = new Set(["complete", "complete_with_errors", "failed", "cancelled"]);
  const runs = [...maintenanceRuns.values()]
    .filter((run) => !run.finishedAt && !terminalStates.has(run.state))
    .sort((a, b) => {
      const aOwnsSlot = activePipelineJob?.runId && a.id === activePipelineJob.runId;
      const bOwnsSlot = activePipelineJob?.runId && b.id === activePipelineJob.runId;
      if (aOwnsSlot !== bOwnsSlot) return aOwnsSlot ? -1 : 1;
      const aPosition = Math.min(...(a.activeJobIds || []).map((id) => queuePosition(jobs.get(id)) || Number.MAX_SAFE_INTEGER));
      const bPosition = Math.min(...(b.activeJobIds || []).map((id) => queuePosition(jobs.get(id)) || Number.MAX_SAFE_INTEGER));
      if (aPosition !== bPosition) return aPosition - bPosition;
      return Date.parse(b.startedAt || "") - Date.parse(a.startedAt || "");
    })
    .map(publicRun);
  const activeRunIds = new Set(runs.map((run) => run.id));
  const activeJobs = [...jobs.values()]
    .filter((job) => !job.finishedAt && !terminalStates.has(job.state)
      && (!job.runId || activeRunIds.has(job.runId) || Boolean(job.maintenance)))
    .sort((a, b) => {
      const aPosition = a === activePipelineJob ? 0 : queuePosition(a) || Number.MAX_SAFE_INTEGER;
      const bPosition = b === activePipelineJob ? 0 : queuePosition(b) || Number.MAX_SAFE_INTEGER;
      if (aPosition !== bPosition) return aPosition - bPosition;
      return Date.parse(b.startedAt || "") - Date.parse(a.startedAt || "");
    })
    .map(publicJobSummary);
  return {
    runs,
    jobs: activeJobs,
    scheduler: {
      concurrency: MAX_TORRENT_CONCURRENCY,
      activeJobId: activePipelineJob?.id || null,
      activeJobIds: [...activePipelineJobs].map((job) => job.id),
      queuedJobs: pipelineQueue.length,
    },
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" });
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || HOST}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        protocol: SERVICE_PROTOCOL_VERSION,
        providers: ["seadex", "nyaa"],
        repository: REPO_ROOT,
        host: HOST,
        port: PORT,
        address: `http://${HOST}:${PORT}`,
        manifestPublisher: "github-contents-api",
        role: MAINTENANCE_ROLE,
        catalog: catalogSummary(await loadCatalogState()),
        github: githubConfiguration(),
        failureWebhook: {
          enabled: FAILURE_WEBHOOK_ENABLED,
          configured: Boolean(FAILURE_WEBHOOK_URL),
        },
        scheduler: {
          concurrency: MAX_TORRENT_CONCURRENCY,
          activeJobId: activePipelineJob?.id || null,
          activeJobIds: [...activePipelineJobs].map((job) => job.id),
          queuedJobs: pipelineQueue.length,
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/maintenance/active") {
      return json(res, 200, publicActiveWork());
    }
    if (req.method === "GET" && url.pathname === "/api/catalog/status") {
      return json(res, 200, catalogSummary(await loadCatalogState()));
    }
    if (req.method === "GET" && url.pathname === "/api/catalog/items") {
      const state = await loadCatalogState();
      const requestedState = String(url.searchParams.get("state") || "").trim();
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const items = Object.values(state.entries || {})
        .filter((entry) => !requestedState || entry.state === requestedState)
        .sort((a, b) => (Date.parse(b.trackerUpdatedAt || "") || 0) - (Date.parse(a.trackerUpdatedAt || "") || 0))
        .slice(0, limit)
        .map((entry) => ({
          key: entry.key,
          alID: entry.alID,
          title: entry.title,
          mediaTitle: entry.mediaTitle,
          format: entry.format,
          category: entry.category,
          state: entry.state,
          sourcePath: entry.sourcePath || "",
          preferredReleaseHash: entry.preferredReleaseHash || "",
          preferredDualAudio: entry.preferredDualAudio === true,
          publishedHash: entry.publishedHash || "",
          publishedDualAudio: entry.publishedDualAudio === true,
          upgradeEligible: entry.upgradeEligible === true,
          unconfirmedEpisodes: normalizedEpisodeNumbers(entry.unconfirmedEpisodes),
          upgradeEpisodes: normalizedEpisodeNumbers(entry.upgradeEpisodes),
          attempts: Number(entry.attempts) || 0,
          nextRetryAt: entry.nextRetryAt || null,
          lastError: entry.lastError || "",
        }));
      return json(res, 200, { items, total: Object.values(state.entries || {}).filter((entry) => !requestedState || entry.state === requestedState).length });
    }
    if (req.method === "GET" && ["/api/releases/search", "/api/seadex/search"].includes(url.pathname)) {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return json(res, 400, { error: "q is required" });
      const category = url.searchParams.get("category")?.trim() || "";
      return json(res, 200, { items: await releaseSearch(query, category) });
    }
    if (req.method === "GET" && url.pathname === "/api/library") return json(res, 200, await listLibrary());
    if (req.method === "GET" && url.pathname === "/api/maintenance/logs") {
      const entries = await readPersistedLogs({
        runId: url.searchParams.get("runId") || url.searchParams.get("run") || "",
        jobId: url.searchParams.get("jobId") || url.searchParams.get("job") || "",
        limit: url.searchParams.get("limit") || 500,
      });
      return json(res, 200, { file: LOG_FILE, entries });
    }
    if (req.method === "POST" && (url.pathname === "/api/maintenance/runs" || url.pathname === "/api/maintenance/scan")) {
      return json(res, 202, publicRun(await startMaintenanceRun(await readBody(req))));
    }
    if (req.method === "POST" && url.pathname === "/api/catalog/scan") {
      const payload = await readBody(req);
      const run = await startMaintenanceRun({
        ...payload,
        discoverCatalog: true,
        catalogScan: true,
        catalogOnly: true,
        malCheck: false,
      });
      return json(res, 202, publicRun(run));
    }
    const runActionMatch = url.pathname.match(/^\/api\/maintenance\/runs\/([^/]+)\/(pause|resume|reset-failed)$/);
    if (runActionMatch && req.method === "POST") {
      const run = maintenanceRuns.get(runActionMatch[1]);
      if (!run) return json(res, 404, { error: "maintenance run not found" });
      if (runActionMatch[2] === "pause") {
        try {
          return json(res, 202, publicRun(requestMaintenancePause(run)));
        } catch (error) {
          return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (runActionMatch[2] === "reset-failed") {
        try {
          return json(res, 202, publicRun(await resetFailedMaintenanceRun(run)));
        } catch (error) {
          return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      try {
        return json(res, 202, publicRun(await resumePausedMaintenanceRun(run, await readBody(req))));
      } catch (error) {
        return json(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    const runMatch = url.pathname.match(/^\/api\/maintenance\/runs\/([^/]+)$/);
    if (runMatch && req.method === "GET") {
      const run = maintenanceRuns.get(runMatch[1]);
      return run ? json(res, 200, publicRun(run)) : json(res, 404, { error: "maintenance run not found" });
    }
    if (runMatch && req.method === "DELETE") {
      const run = maintenanceRuns.get(runMatch[1]);
      if (!run) return json(res, 404, { error: "maintenance run not found" });
      if (!run.finishedAt) {
        await run.stop?.();
        run.state = "cancelled";
        run.phase = "complete";
        run.finishedAt = new Date().toISOString();
        if (catalogRunId === run.id) catalogRunId = null;
        await persistResumeState();
      }
      return json(res, 200, publicRun(run));
    }
    if (req.method === "POST" && (url.pathname === "/api/torrent/jobs" || url.pathname === "/api/maintenance/jobs")) {
      return json(res, 202, publicJob(await startJob(await readBody(req))));
    }
    const jobMatch = url.pathname.match(/^\/(?:api\/torrent|api\/maintenance)\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const job = jobs.get(jobMatch[1]);
      return job ? json(res, 200, publicJob(job)) : json(res, 404, { error: "job not found" });
    }
    if (jobMatch && req.method === "DELETE") {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json(res, 404, { error: "job not found" });
      if (!job.finishedAt) {
        await job.stop?.();
        await persistResumeState();
      }
      return json(res, 200, publicJob(job));
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

async function ensureToodriveCompatibility() {
  if (process.env.MEDIA_MANAGER_TEST === "1") return;
  const compatibilityScript = resolve(join(SERVICE_DIR, "apply-toodrive-compatibility.sh"));
  try {
    await new Promise((resolveCompatibility, rejectCompatibility) => {
      const child = spawn("bash", [compatibilityScript], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", rejectCompatibility);
      child.on("close", (code) => {
        if (code === 0) resolveCompatibility();
        else rejectCompatibility(new Error(`td compatibility patch exited with code ${code ?? 1}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      });
    });
  } catch (error) {
    // A td update should not take the API down, but leave a visible record so
    // an operator can repair the installation before starting video work.
    console.warn(`[maintenance-td] ${error instanceof Error ? error.message : String(error)}`);
    persistLog({ scope: "service", event: "td_compatibility_patch_failed", message: error instanceof Error ? error.message : String(error) });
  }
}

async function startServer() {
  await ensureToodriveCompatibility();
  await restorePersistedWork();
  server.listen(PORT, HOST, () => {
    console.log(`Library maintenance service listening on http://${HOST}:${PORT}`);
    console.log(`Repository: ${REPO_ROOT}`);
    console.log(`Using td: ${TD_BIN}`);
    console.log(`Using Toodrive: ${TOODRIVE_BASE_URL}`);
    persistLog({ scope: "service", event: "service_started", port: PORT, repository: REPO_ROOT, td: TD_BIN });
    const hasPausedRun = [...maintenanceRuns.values()].some((run) => run.paused && !run.finishedAt);
    if (CATALOG_SCAN_ENABLED && !catalogRunId && !hasPausedRun) {
      void startAutomaticCatalogRun("startup").catch((error) => {
        persistLog({ scope: "service", event: "catalog_start_failed", message: error instanceof Error ? error.message : String(error) });
        void queueFailureWebhook({
          scope: "catalog",
          title: "Automatic catalog scan",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}

export {
  buildMaintenanceWork,
  buildCatalogMaintenanceWork,
  catalogEntryFromRecord,
  catalogSummary,
  fetchAniListCatalogMedia,
  fetchCatalogReleaseRecords,
  scanCatalog,
  maintenanceConcurrency,
  aniListAiringProgress,
  parseRssItems,
  releaseSearch,
  releaseSearchQueries,
  mediaMatchesRequestedSeason,
  seaDexTorrentToItem,
  findAutomaticReleasePlan,
  missingEpisodesForCategory,
  releaseCoverage,
  releaseMatchesMissing,
  rankReleaseCandidate,
  rankIndividualReleaseCandidate,
  releaseAvailabilityTier,
  releaseHasUsableAvailability,
  maintenanceRunsOverlap,
  splitReleasePlanByEpisode,
  releaseHasDualAudio,
  betterReleaseCandidate,
  selectArtifacts,
  applyMaintenance,
  probeMediaDurationSeconds,
  probeMediaAudioStreamCount,
  totalDuration,
  normalizeToodriveUrl,
  processMaintenanceItem,
  startJob,
  torrentConcurrency,
  publishSourceToGithub,
  publishSourceListToGithub,
  buildSourceListContent,
  refreshSourceListPublication,
  cleanupJobCache,
  checkTdSession,
  loginToodrive,
  failureWebhookContent,
  sendFailureWebhook,
};

if (process.env.MEDIA_MANAGER_TEST !== "1") {
  startServer().catch((error) => {
    console.error(`Maintenance service failed to start: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exitCode = 1;
  });
}
