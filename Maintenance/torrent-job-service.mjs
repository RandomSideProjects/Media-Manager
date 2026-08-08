#!/usr/bin/env node
// Local service for the Maintenance UI. Browser code cannot safely run
// libtorrent or spawn ffmpeg, so this service owns SeaDex release lookup, the
// td pipeline, and the optional source-manifest maintenance step.
// Run from the repository with: node Maintenance/torrent-job-service.mjs

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CREATOR_TORRENT_PORT || process.env.MAINTENANCE_PORT || 6968);
const HOST = String(process.env.CREATOR_TORRENT_HOST || process.env.MAINTENANCE_HOST || "0.0.0.0").trim() || "0.0.0.0";
const SERVICE_PROTOCOL_VERSION = "maintenance-v5";
const TD_BIN = process.env.TD_BIN || join(homedir(), ".deno/bin/td");
const FFPROBE_BIN = process.env.FFPROBE_BIN || "ffprobe";
const TOODRIVE_BASE_URL = process.env.TOODRIVE_BASE_URL || "https://toodrive.xpbliss.fyi";
const TOODRIVE_PUBLIC_BASE_URL = String(process.env.TOODRIVE_PUBLIC_BASE_URL || "https://toodrive.xpbliss.fyi").replace(/\/$/, "");
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
const REPO_ROOT = resolve(process.env.MEDIA_MANAGER_ROOT || join(SERVICE_DIR, ".."));
const SOURCE_DIR = resolve(REPO_ROOT, "Sources/Files/Anime");
const SOURCE_PREFIX = "Sources/Files/Anime/";
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
// General maintenance uses Jikan's public MyAnimeList mirror as a preflight
// check.  The cache keeps recurring runs fast and the request gate stays below
// Jikan's public rate limit.  Set MAL_CHECK=0 (or malCheck:false in a request)
// only for an explicitly forced run.
const MAL_API_BASE_URL = String(process.env.MAL_API_BASE_URL || "https://api.jikan.moe/v4").replace(/\/$/, "");
const MAL_HTML_BASE_URL = String(process.env.MAL_HTML_BASE_URL || "https://myanimelist.net").replace(/\/$/, "");
const MAL_CACHE_FILE = resolve(process.env.MAL_CACHE_FILE || join(homedir(), ".local/share/media-manager-maintenance/mal-cache.json"));
const MAL_CACHE_TTL_MS = Math.max(60_000, Number(process.env.MAL_CACHE_TTL_MS) || 30 * 60_000);
const MAL_ERROR_CACHE_TTL_MS = Math.max(15_000, Number(process.env.MAL_ERROR_CACHE_TTL_MS) || 2 * 60_000);
const MAL_REQUEST_TIMEOUT_MS = Math.max(2_000, Number(process.env.MAL_REQUEST_TIMEOUT_MS) || 12_000);
const MAL_REQUEST_INTERVAL_MS = Math.max(250, Number(process.env.MAL_REQUEST_INTERVAL_MS) || 400);
const MAL_CACHE_VERSION = 13;
const LOG_PROGRESS_INTERVAL_MS = 30_000;
const DEFAULT_TD_REPAIR_ATTEMPTS = 20;
const MAINTENANCE_TD_REPAIR_ATTEMPTS = 3;
const DEFAULT_MAINTENANCE_CONCURRENCY = 1;
const MAX_MAINTENANCE_CONCURRENCY = 1;
const DEFAULT_TORRENT_CONCURRENCY = 1;
const MAX_TORRENT_CONCURRENCY = 1;
const MEDIA_PROBE_TIMEOUT_MS = Math.max(5_000, Number(process.env.MEDIA_PROBE_TIMEOUT_MS) || 45_000);
const jobs = new Map();
const maintenanceRuns = new Map();
const maintenanceManifestQueues = new Map();
const pipelineQueue = [];
let activePipelineJob = null;
const logProgressAt = new Map();
let logQueue = Promise.resolve();
let malCache = null;
let malCacheLoad = null;
let malCacheWrite = Promise.resolve();
let malRequestQueue = Promise.resolve();
let malLastRequestAt = 0;
let resumeWriteQueue = Promise.resolve();

function resumableRun(run) {
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

function persistLog(entry) {
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

async function readPersistedLogs({ runId = "", jobId = "", limit = 500 } = {}) {
  await logQueue;
  let raw;
  try {
    raw = await readFile(LOG_FILE, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
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
  const { owner, name } = githubRepositoryParts();
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
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
  const promise = cleanupUploadedArtifact(job, artifact);
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
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
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
  const body = await fetchJson(ANILIST_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Media-Manager-Maintenance/1.0" },
    body: JSON.stringify({
      query: `query ($search: String!) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME) {
            id
            title { romaji english native userPreferred }
            format
            season
            seasonYear
            episodes
          }
        }
      }`,
      variables: { search: titleQuery },
    }),
  }, "AniList title search");
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
    .sort((a, b) => Number(b.item.isBest) - Number(a.item.isBest) || b.audioScore - a.audioScore || a.index - b.index)
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

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function malCacheKey(title) {
  return normalizeTitle(title) || String(title || "").trim().toLowerCase();
}

async function loadMalCache() {
  if (malCache) return malCache;
  if (malCacheLoad) return malCacheLoad;
  malCacheLoad = readFile(MAL_CACHE_FILE, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw);
      malCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      return malCache;
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") console.error(`[mal-cache] ${error instanceof Error ? error.message : String(error)}`);
      malCache = {};
      return malCache;
    });
  return malCacheLoad;
}

function queueMalCacheWrite() {
  const snapshot = JSON.stringify(malCache || {}, null, 2);
  malCacheWrite = malCacheWrite.then(async () => {
    try {
      await mkdir(dirname(MAL_CACHE_FILE), { recursive: true });
      await writeFile(MAL_CACHE_FILE, `${snapshot}\n`, "utf8");
    } catch (error) {
      console.error(`[mal-cache] ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return malCacheWrite;
}

function queueMalRequest(task) {
  const next = malRequestQueue.then(async () => {
    const waitMs = Math.max(0, MAL_REQUEST_INTERVAL_MS - (Date.now() - malLastRequestAt));
    if (waitMs) await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    malLastRequestAt = Date.now();
    return task();
  }, async () => task());
  // A failed request must not poison the queue for every later show.
  malRequestQueue = next.catch(() => {});
  return next;
}

async function fetchMalText(url) {
  return queueMalRequest(async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), MAL_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: { "user-agent": "Media-Manager-Maintenance/1.0" },
          signal: controller.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after")) || 0;
          throw new Error(`MAL returned HTTP ${response.status}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`);
        }
        if (!response.ok) throw new Error(`MAL returned HTTP ${response.status}`);
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error("MAL request failed");
  });
}

async function fetchMalJson(url) {
  return JSON.parse(await fetchMalText(url));
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

function parseMalHtml(html) {
  const items = [];
  for (const match of String(html || "").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const row = match[0];
    const idMatch = row.match(/(?:https?:\/\/myanimelist\.net)?\/anime\/(\d+)\/[^"'\s<]+/i);
    const urlMatch = row.match(/(?:https?:\/\/myanimelist\.net)?(\/anime\/\d+\/[^"'\s<]+)/i);
    const titleMatch = row.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (!idMatch || !titleMatch) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripHtml(cell[1]));
    const type = cells[2] || "";
    const episodeMatch = String(cells[3] || "").match(/\d+/);
    items.push({
      mal_id: Number(idMatch[1]),
      title: stripHtml(titleMatch[1]),
      url: urlMatch?.[1] ? `${MAL_HTML_BASE_URL}${urlMatch[1]}` : `${MAL_HTML_BASE_URL}/anime/${Number(idMatch[1])}`,
      type,
      episodes: episodeMatch ? Number(episodeMatch[0]) : null,
      status: "",
      airing: false,
    });
  }
  return items;
}

function malDetailValue(html, label) {
  const match = String(html || "").match(new RegExp(`<span class=["']dark_text["']>${label}:<\\/span>([\\s\\S]*?)<\\/div>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function applyMalDetail(item, html) {
  const english = malDetailValue(html, "English");
  const japanese = malDetailValue(html, "Japanese");
  const synonyms = malDetailValue(html, "Synonyms");
  const episodes = malDetailValue(html, "Episodes").match(/\d+/)?.[0];
  const status = malDetailValue(html, "Status");
  const type = malDetailValue(html, "Type");
  return {
    ...item,
    title_english: english || item.title_english || "",
    title_japanese: japanese || item.title_japanese || "",
    titles: synonyms ? [{ title: synonyms }] : item.titles,
    episodes: episodes ? Number(episodes) : item.episodes,
    status: status || item.status || "",
    type: type || item.type || "",
  };
}

function parseMalEpisodeProgress(html) {
  const source = String(html || "");
  const progressMatch = source.match(/<h2\b[^>]*>\s*Episodes\s*<\/h2>\s*<span\b[^>]*>\s*\(\s*(\d+)\s*\/\s*([^)]*)\)/i);
  const knownEpisodeNumbers = [];
  for (const rowMatch of source.matchAll(/<tr\b[^>]*class=["'][^"']*\bepisode-list-data\b[^"']*["'][\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const numberCell = row.match(/<td\b[^>]*class=["'][^"']*\bepisode-number\b[^"']*["'][^>]*>[\s\S]*?<\/td>/i);
    if (!numberCell) continue;
    const raw = numberCell[0].match(/data-raw=["'](\d+)["']/i)?.[1]
      || stripHtml(numberCell[0]).match(/\d+/)?.[0];
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0) knownEpisodeNumbers.push(number);
  }
  const uniqueNumbers = [...new Set(knownEpisodeNumbers)].sort((a, b) => a - b);
  const progressCount = Number(progressMatch?.[1]);
  const airedEpisodes = Number.isInteger(progressCount) && progressCount > 0
    ? progressCount
    : (uniqueNumbers.length ? Math.max(...uniqueNumbers) : null);
  const knownTotal = Number(progressMatch?.[2]);
  const airing = Number.isInteger(knownTotal) && knownTotal > 0
    ? Number.isInteger(airedEpisodes) && airedEpisodes < knownTotal
    : Boolean(uniqueNumbers.length || airedEpisodes);
  return {
    airedEpisodes,
    knownEpisodeNumbers: uniqueNumbers,
    episodeCountSource: uniqueNumbers.length || airedEpisodes
      ? "mal-episode-list"
      : (Number.isInteger(knownTotal) && knownTotal > 0 ? "mal-total" : "unknown"),
    airing,
  };
}

async function enrichMalCandidates(items, source, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  const isUsable = (item) => malTitleConfidence(item, source) && malCandidateStartsWithSource(item, source)
    && (!requestedSeason || malSeasonMarker(item) === requestedSeason || requestedSeason === 1 && !malSeasonMarker(item));
  if (items.some(isUsable)) return items;
  // MAL's search table uses the native title only. Resolve the first five
  // results so translated titles can be scored without discarding later
  // seasons from the same search response.
  const enriched = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index >= 5) {
      enriched.push(item);
      continue;
    }
    if (!item?.mal_id) {
      enriched.push(item);
      continue;
    }
    try {
      const detail = await fetchMalText(`${MAL_HTML_BASE_URL}/anime/${item.mal_id}`);
      const candidate = applyMalDetail(item, detail);
      enriched.push(candidate);
    } catch {
      enriched.push(item);
    }
  }
  return enriched.length ? enriched : items;
}

async function searchMalHtml(query, source, categoryName) {
  const html = await fetchMalText(`${MAL_HTML_BASE_URL}/anime.php?q=${encodeURIComponent(query)}&cat=anime`);
  return enrichMalCandidates(parseMalHtml(html), source, categoryName);
}

function malTitles(item) {
  return [
    item?.title,
    item?.title_english,
    item?.titleEnglish,
    item?.title_japanese,
    item?.titleJapanese,
    ...(Array.isArray(item?.titles) ? item.titles.map((title) => title?.title) : []),
  ].filter(Boolean).map(String);
}

function malTitleQueries(source) {
  const title = String(source?.malTitle || source?.title || "").trim();
  const fileTitle = String(source?.file || "")
    .replace(/\.json$/i, "")
    .replace(/[._-]+/g, " ")
    .trim();
  return [title, fileTitle]
    .filter(Boolean)
    .filter((query, index, all) => all.findIndex((candidate) => normalizeTitle(candidate) === normalizeTitle(query)) === index);
}

function malSeasonMarker(item) {
  const text = malTitles(item).join(" ");
  const numbered = text.match(/\b(?:season|s)\s*0*(\d{1,2})\b/i);
  if (numbered) return Number(numbered[1]);
  const ordinal = text.match(/\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  if (ordinal) return Number(ordinal[1]);
  const suffix = text.match(/(?:^|[\s:])0*(\d{1,2})\s*$/i);
  return suffix ? Number(suffix[1]) : null;
}

function malCandidateScore(item, source, categoryName) {
  const sourceTokens = malSearchTokens(source?.malTitle || source?.title);
  const titleTokens = malSearchTokens(malTitles(item).join(" "));
  const overlap = [...sourceTokens].filter((token) => titleTokens.has(token)).length;
  if (!overlap) return Number.NEGATIVE_INFINITY;
  const requestedSeason = categorySeasonNumber(categoryName);
  const marker = malSeasonMarker(item);
  let score = overlap * 20;
  if (sourceTokens.size && overlap === sourceTokens.size) score += 35;
  if (requestedSeason && marker === requestedSeason) score += 55;
  else if (requestedSeason > 1 && marker && marker !== requestedSeason) score -= 70;
  else if (requestedSeason === 1 && marker && marker > 1) score -= 50;
  if (String(item?.type || "").toUpperCase() === "TV") score += 8;
  if (/\b(?:movie|special|ona|ova)\b/i.test(String(item?.type || ""))) score -= 15;
  if (Number(item?.episodes) > 0) score += 3;
  return score;
}

function summarizeMalCandidate(item, score) {
  return {
    malId: Number(item?.mal_id) || null,
    malUrl: String(item?.url || item?.malUrl || "").trim(),
    title: String(item?.title || item?.title_english || "").trim(),
    titleEnglish: String(item?.title_english || "").trim(),
    type: String(item?.type || ""),
    episodes: Number(item?.episodes) > 0 ? Number(item.episodes) : null,
    airedEpisodes: Number(item?.airedEpisodes) > 0 ? Number(item.airedEpisodes) : null,
    knownEpisodeNumbers: Array.isArray(item?.knownEpisodeNumbers)
      ? item.knownEpisodeNumbers.filter((number) => Number.isInteger(number) && number > 0)
      : [],
    episodeCountSource: String(item?.episodeCountSource || (Number(item?.episodes) > 0 ? "mal-total" : "unknown")),
    episodeProgressCheckedAt: Number(item?.episodeProgressCheckedAt) || 0,
    episodeProgressError: String(item?.episodeProgressError || ""),
    status: String(item?.status || ""),
    airing: item?.airing === true,
    seasonMarker: malSeasonMarker(item),
    score,
  };
}

function malCandidateIsCurrentlyAiring(candidate) {
  const status = String(candidate?.status || "").trim();
  return candidate?.airing === true || /\bcurrently\s+airing\b/i.test(status) || /^airing$/i.test(status);
}

function replaceCachedMalCandidate(source, candidate) {
  const key = malCacheKey(source?.malTitle || source?.title);
  const record = malCache?.[key];
  if (!record || !Array.isArray(record.candidates) || !candidate?.malId) return;
  const index = record.candidates.findIndex((entry) => Number(entry?.malId) === Number(candidate.malId));
  if (index >= 0) record.candidates[index] = candidate;
  queueMalCacheWrite();
}

async function hydrateMalCandidateProgress(malResult, source, categoryName) {
  const candidate = chooseMalCandidate(malResult?.candidates, source, categoryName);
  if (!candidate) return null;
  const currentlyAiring = malCandidateIsCurrentlyAiring(candidate);
  const statusKnown = /\b(?:currently\s+airing|finished\s+airing|finished|not\s+yet\s+aired)\b/i.test(String(candidate.status || ""));
  if (!currentlyAiring && statusKnown && (Number(candidate.episodes) > 0 || Array.isArray(candidate.knownEpisodeNumbers) && candidate.knownEpisodeNumbers.length)) return candidate;
  if (Number(candidate.episodeProgressCheckedAt) > 0) return candidate;

  const checkedAt = Date.now();
  let hydrated;
  try {
    if (!candidate.malId) throw new Error("MAL candidate has no id");
    const detailUrl = String(candidate.malUrl || `${MAL_HTML_BASE_URL}/anime/${candidate.malId}`).replace(/\/$/, "");
    const html = await fetchMalText(`${detailUrl}/episode`);
    const progress = parseMalEpisodeProgress(html);
    hydrated = {
      ...candidate,
      ...progress,
      airing: candidate.airing === true || progress.airing === true,
      episodeProgressCheckedAt: checkedAt,
      episodeProgressError: progress.episodeCountSource === "unknown"
        ? "MAL episode list did not expose aired episode numbers"
        : "",
    };
  } catch (error) {
    hydrated = {
      ...candidate,
      // If MAL did not provide a trusted status, do not turn a failed
      // episode-page request into a guessed final-season count.
      airing: candidate.airing === true || !statusKnown,
      episodeProgressCheckedAt: checkedAt,
      episodeProgressError: error instanceof Error ? error.message : String(error),
      episodeCountSource: "unknown",
    };
  }
  const index = Array.isArray(malResult?.candidates)
    ? malResult.candidates.findIndex((entry) => Number(entry?.malId) === Number(hydrated.malId))
    : -1;
  if (index >= 0) malResult.candidates[index] = hydrated;
  malResult.candidate = hydrated;
  replaceCachedMalCandidate(source, hydrated);
  return hydrated;
}

function malTitleConfidence(candidate, source) {
  const sourceTokens = malSearchTokens(source?.malTitle || source?.title);
  const titleTokens = malSearchTokens(malTitles(candidate).join(" "));
  const overlap = [...sourceTokens].filter((token) => titleTokens.has(token)).length;
  if (!sourceTokens.size) return false;
  // A one-token title can still be a distinctive show name (Aharen, Frieren).
  // Two-token titles may use a distinctive first token (Aharen-san) when the
  // English alias differs, but longer titles require at least 60% overlap;
  // this avoids matches such as "Ghost Stories" -> "Monster Hunter Stories"
  // or "Hazbin Hotel" -> "Sparrow's Hotel".
  const required = sourceTokens.size === 1
    ? 1
    : sourceTokens.size === 2
      ? 1
      : Math.max(2, Math.ceil(sourceTokens.size * 0.6));
  if (overlap < required) return false;
  if (sourceTokens.size === 2 && overlap === 1) {
    const firstSourceToken = [...sourceTokens][0];
    const firstTitleToken = [...titleTokens][0];
    return firstTitleToken === firstSourceToken;
  }
  return true;
}

function malCandidateStartsWithSource(candidate, source) {
  const sourceFirst = [...malSearchTokens(source?.malTitle || source?.title)][0];
  if (!sourceFirst) return false;
  const nativeFirst = [...malSearchTokens(candidate?.title)][0];
  if (nativeFirst === sourceFirst) return true;
  const aliases = [candidate?.title_english, candidate?.titleEnglish, candidate?.title_japanese, candidate?.titleJapanese]
    .filter(Boolean);
  return aliases.some((alias) => [...malSearchTokens(alias)][0] === sourceFirst);
}

function chooseMalCandidate(candidates, source, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({ candidate, score: malCandidateScore(candidate, source, categoryName) }))
    .filter((entry) => {
      if (!Number.isFinite(entry.score) || !malTitleConfidence(entry.candidate, source) || !malCandidateStartsWithSource(entry.candidate, source)) return false;
      const marker = malSeasonMarker(entry.candidate);
      // Never use a base/other-season MAL record to decide whether a later
      // season is complete. An unmarked result is safe only for Season 1.
      if (requestedSeason > 1 && marker !== requestedSeason) return false;
      if (requestedSeason === 1 && marker && marker > 1) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

async function findMalAnime(source, categoryName) {
  const cache = await loadMalCache();
  const key = malCacheKey(source?.malTitle || source?.title);
  const cached = cache[key];
  const now = Date.now();
  const cacheTtl = cached?.error ? MAL_ERROR_CACHE_TTL_MS : MAL_CACHE_TTL_MS;
  if (cached?.version === MAL_CACHE_VERSION && Number.isFinite(Number(cached.checkedAt)) && now - Number(cached.checkedAt) < cacheTtl) {
    const candidate = chooseMalCandidate(cached.candidates, source, categoryName);
    return { ...cached, candidate: candidate ? { ...candidate } : null, cached: true };
  }

  let lastError = null;
  const candidatesById = new Map();
  for (const query of malTitleQueries(source)) {
    let items = [];
    try {
      // MAL's HTML search is available without credentials and is used first;
      // Jikan remains a structured fallback when MAL changes its markup.
      items = await searchMalHtml(query, source, categoryName);
    } catch (error) {
      lastError = error;
    }
    if (!items.length) {
      try {
        const payload = await fetchMalJson(`${MAL_API_BASE_URL}/anime?q=${encodeURIComponent(query)}&limit=10`);
        items = Array.isArray(payload?.data) ? payload.data : [];
      } catch (error) {
        lastError = error;
      }
    }
    for (const item of items) {
      const score = malCandidateScore(item, source, categoryName);
      if (!Number.isFinite(score)) continue;
      const candidate = summarizeMalCandidate(item, score);
      const key = candidate.malId || `${candidate.title}|${candidate.titleEnglish}`;
      const previous = candidatesById.get(key);
      if (!previous || candidate.score > previous.score) candidatesById.set(key, candidate);
    }
  }
  const candidates = [...candidatesById.values()];
  candidates.sort((a, b) => b.score - a.score);
  const record = {
    version: MAL_CACHE_VERSION,
    checkedAt: now,
    query: malTitleQueries(source)[0] || "",
    candidates: candidates.slice(0, 10),
    error: candidates.length ? "" : (lastError ? (lastError instanceof Error ? lastError.message : String(lastError)) : ""),
  };
  cache[key] = record;
  queueMalCacheWrite();
  return { ...record, candidate: chooseMalCandidate(candidates, source, categoryName), cached: false };
}

function discoverMalSeasons(source, existingCategories, malResult) {
  const knownSeasons = new Set(
    (Array.isArray(existingCategories) ? existingCategories : [])
      .map((category) => categorySeasonNumber(category?.category))
      .filter((season) => Number.isInteger(season) && season > 0),
  );
  const latestKnownSeason = Math.max(0, ...knownSeasons);
  const candidates = Array.isArray(malResult?.candidates) ? malResult.candidates : [];
  const bestBySeason = new Map();
  for (const candidate of candidates) {
    if (String(candidate?.type || "").toUpperCase() !== "TV") continue;
    const episodes = Number(candidate?.episodes);
    if ((!Number.isInteger(episodes) || episodes <= 0) && !malCandidateIsCurrentlyAiring(candidate)) continue;
    if (!malTitleConfidence(candidate, source) || !malCandidateStartsWithSource(candidate, source)) continue;
    const season = malSeasonMarker(candidate) || 1;
    // General maintenance adds later seasons to an existing show. An
    // unmarked base MAL result is treated as Season 1, but is not allowed to
    // backfill an older season when the library already starts later.
    if (knownSeasons.has(season) || season <= latestKnownSeason) continue;
    const previous = bestBySeason.get(season);
    if (!previous || Number(candidate?.score || 0) > Number(previous?.score || 0)) {
      bestBySeason.set(season, candidate);
    }
  }
  return [...bestBySeason.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, candidate]) => ({ season, candidate }));
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

const MAL_GENERIC_TOKENS = new Set([
  ...SEARCH_STOP_WORDS,
  "gals", "girl", "girls", "hotel", "love", "lovely", "night", "stories", "story", "super",
]);

function malSearchTokens(value) {
  return new Set(String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !MAL_GENERIC_TOKENS.has(token)));
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
        const preferredCandidates = candidates.some((candidate) => candidate.dualAudio)
          ? candidates.filter((candidate) => candidate.dualAudio)
          : candidates;
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

async function findAutomaticReleasePlan(source, categoryName, missingEpisodes = []) {
  const missing = [...new Set(missingEpisodes.map((episode) => Number(episode)))].filter((episode) => Number.isInteger(episode) && episode > 0);
  const individualPlan = await findIndividualReleasePlan(source, categoryName, missing);
  let individualReleases = individualPlan?.releases || [];
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
          const preferredCandidates = candidates.some((candidate) => candidate.dualAudio)
            ? candidates.filter((candidate) => candidate.dualAudio)
            : candidates;
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

function scheduleArtifactDurationProbe(job, artifact, event = {}) {
  if (!artifact || typeof artifact !== "object") return;
  const reported = durationValue(event.durationSeconds ?? event.duration ?? artifact.durationSeconds);
  if (reported > 0) {
    artifact.durationSeconds = reported;
    return;
  }
  const input = String(artifact.localPath || "").trim();
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

function categorySummary(category, index) {
  const { entries } = getEntries(category);
  const parsed = entries.map((entry) => episodeInfo(entry?.title)).filter((info) => info.episode);
  const episodeNumbers = [...new Set(parsed.map((info) => info.episode))].sort((a, b) => a - b);
  return {
    index,
    category: String(category?.category || `Season ${index + 1}`),
    episodeCount: entries.length,
    latestEpisode: parsed.length ? Math.max(...parsed.map((info) => info.episode)) : null,
    episodeNumbers,
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
        image: data.Image || data.image || data.poster || "",
        hidden: data.hidden === true || data.Hidden === true || data.maintainerHidden === true,
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
  // onto a regular MAL TV entry just because the source also has a season.
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
  };
}

function maintenanceMalEnabled(payload) {
  return process.env.MAL_CHECK !== "0" && payload?.malCheck !== false;
}

function checkTdSession() {
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

function skippedMaintenanceItem(source, category, reason, mal = null) {
  return {
    id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "",
    category: category?.category || "", state: "skipped", reason, mal,
  };
}

async function buildMaintenanceWork(sources, payload, { onProgress } = {}) {
  const sourcePaths = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  const work = [];
  const toodriveAuditCache = new Map();
  const selectedSources = sources.filter((source) => !sourcePaths || sourcePaths.has(source.path) || sourcePaths.has(source.file));
  let preflightCompleted = 0;
  const malEnabled = maintenanceMalEnabled(payload);
  for (const source of selectedSources) {
    if (sourcePaths && !sourcePaths.has(source.path) && !sourcePaths.has(source.file)) continue;
    const existingCategories = Array.isArray(source?.categories) ? source.categories : [];
    const categories = automaticCategories(source, payload?.allCategories === true);
    if (!categories.length) {
      work.push(skippedMaintenanceItem(source, null, "no maintainable season category"));
      continue;
    }

    let malResult = null;
    if (malEnabled) {
      try {
        onProgress?.({ title: source.title, state: "checking_mal" });
        malResult = await findMalAnime(source, categories[0].category);
      } catch (error) {
        malResult = { candidate: null, candidates: [], error: error instanceof Error ? error.message : String(error) };
      }
    }
    for (const category of categories) {
      preflightCompleted += 1;
      onProgress?.({ title: source.title, category: category.category, completed: preflightCompleted });
      if (malEnabled) {
        let malCandidate = chooseMalCandidate(malResult?.candidates, source, category.category);
        if (!malCandidate) {
          const reason = malResult?.error
            ? `MAL check unavailable: ${malResult.error}`
            : "MAL did not return a confident matching anime";
          work.push(skippedMaintenanceItem(source, category, reason, { status: "unavailable", error: malResult?.error || "" }));
          continue;
        }
        malCandidate = await hydrateMalCandidateProgress(malResult, source, category.category);
        const expectedEpisodeNumbers = Array.isArray(malCandidate?.knownEpisodeNumbers)
          ? malCandidate.knownEpisodeNumbers
          : [];
        const currentlyAiring = malCandidateIsCurrentlyAiring(malCandidate);
        const expectedEpisodes = expectedEpisodeNumbers.length
          ? Math.max(...expectedEpisodeNumbers)
          : currentlyAiring
            ? Number(malCandidate?.airedEpisodes) > 0 ? Number(malCandidate.airedEpisodes) : null
            : Number(malCandidate?.episodes) > 0
              ? Number(malCandidate.episodes)
              : Number(malCandidate?.airedEpisodes) > 0 ? Number(malCandidate.airedEpisodes) : null;
        if ((!Number.isInteger(expectedEpisodes) || expectedEpisodes <= 0) && !expectedEpisodeNumbers.length) {
          const progressReason = malCandidate?.episodeProgressError
            ? `MAL aired episode list unavailable: ${malCandidate.episodeProgressError}`
            : "MAL episode count is not available yet";
          work.push(skippedMaintenanceItem(source, category, progressReason, { status: "unknown", ...malCandidate }));
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
          work.push(skippedMaintenanceItem(source, category, "library episode numbering is not readable", { status: "unknown", ...malCandidate }));
          continue;
        }
        if (!missing.missing.length) {
          const countLabel = expectedEpisodeNumbers.length
            ? `${expectedEpisodeNumbers.length} aired episode${expectedEpisodeNumbers.length === 1 ? "" : "s"}`
            : `${expectedEpisodes} episodes`;
          work.push(skippedMaintenanceItem(source, category, `MAL reports ${countLabel} and the library is complete`, {
            status: "complete",
            ...malCandidate,
            toodriveAudit: toodriveAudit || undefined,
          }));
          continue;
        }
        work.push({
          id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "",
          category: category.category, state: "queued", query: "", candidate: null,
          jobId: null, manifest: null, links: 0, error: "", missingEpisodes: missing.missing,
          mal: { status: "missing", ...malCandidate, toodriveAudit: toodriveAudit || undefined },
        });
        continue;
      }
      work.push({
        id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "",
        category: category.category, state: "queued", query: "", candidate: null,
        jobId: null, manifest: null, links: 0, error: "", missingEpisodes: [],
        mal: { status: "disabled" },
      });
    }

    if (malEnabled && payload?.addNewSeasons !== false && payload?.addMissing !== false) {
      for (const { season, candidate } of discoverMalSeasons(source, existingCategories, malResult)) {
        const categoryName = `Season ${season}`;
        const hydratedCandidate = await hydrateMalCandidateProgress(malResult, source, categoryName) || candidate;
        const currentlyAiring = malCandidateIsCurrentlyAiring(hydratedCandidate);
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
              ? `MAL aired episode list unavailable: ${hydratedCandidate.episodeProgressError}`
              : "MAL episode count is not available yet",
            { status: "unknown", ...hydratedCandidate, seasonMarker: season },
          ));
          continue;
        }
        work.push({
          id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title, malTitle: source.malTitle || "",
          category: categoryName, state: "queued", query: malResult?.query || "", candidate: null,
          jobId: null, manifest: null, links: 0, error: "", missingEpisodes: Array.from(
            { length: episodes.length }, (_, index) => episodes[index],
          ), createCategory: true, newSeason: true,
          mal: { status: "new_season", ...hydratedCandidate, seasonMarker: season },
        });
      }
    }
  }
  return { work, preflightCompleted, preflightTotal: selectedSources.reduce((sum, source) => sum + automaticCategories(source, payload?.allCategories === true).length, 0), malEnabled };
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
          action: "update",
          sourcePath: item.sourcePath,
          categoryName: item.category,
          seasonNumber: categorySeasonNumber(item.category) || undefined,
          targetEpisodes,
          replaceExisting: payload?.replaceExisting !== false,
          addMissing: payload?.addMissing !== false,
          createCategory: item.createCategory === true,
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

  const source = { title: item.title, malTitle: item.malTitle || "" };
  try {
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
    runEvent(run, `Running one torrent job at a time for ${item.title} · ${item.category}; ${pending.length} release${pending.length === 1 ? "" : "s"} queued.`);
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
    }
  } catch (error) {
    item.state = "failed";
    item.error = error instanceof Error ? error.message : String(error);
    run.failed += 1;
    syncRunActivity(run);
    runEvent(run, `Failed ${item.title} · ${item.category}: ${item.error}.`);
  }
  if (!item.counted && ["complete", "failed", "cancelled"].includes(item.state)) {
    item.counted = true;
    run.completed += 1;
  }
  syncRunActivity(run);
  await persistResumeState();
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
    runEvent(run, `Running one show job at a time and one torrent process at a time; ${groupList.length} show group${groupList.length === 1 ? "" : "s"} queued. Seasons from the same source stay ordered.`);
    let nextGroup = 0;
    const worker = async () => {
      while (!run.cancelled) {
        const groupIndex = nextGroup;
        nextGroup += 1;
        if (groupIndex >= groupList.length) return;
        for (const item of groupList[groupIndex]) {
          if (run.cancelled) break;
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
    } else {
      run.state = run.failed ? "complete_with_errors" : "complete";
    }
  } catch (error) {
    run.failed += 1;
    run.state = "failed";
    runEvent(run, error instanceof Error ? error.message : String(error));
  } finally {
    syncRunActivity(run);
    run.phase = "complete";
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
    await persistResumeState();
  }
}

async function startMaintenanceRun(payload = {}) {
  const library = await listLibrary();
  const run = {
    id: randomUUID(), state: "checking", phase: maintenanceMalEnabled(payload) ? "mal" : "planning",
    total: 0, completed: 0, failed: 0, skipped: 0, preflightCompleted: 0, preflightTotal: 0, preflightCurrent: null,
    current: null, currentJobId: null, active: [], activeJobIds: [], concurrency: maintenanceConcurrency(payload), torrentConcurrency: torrentConcurrency(payload), items: [], events: [], startedAt: new Date().toISOString(),
    finishedAt: null, cancelled: false, planOnly: payload?.dryRun === true || payload?.planOnly === true,
    payload,
  };
  const requestedSources = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  run.preflightTotal = library.sources
    .filter((source) => !requestedSources || requestedSources.has(source.path) || requestedSources.has(source.file))
    .reduce((sum, source) => sum + automaticCategories(source, payload?.allCategories === true).length, 0);
  maintenanceRuns.set(run.id, run);
  run.stop = () => {
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
      runEvent(run, maintenanceMalEnabled(payload)
        ? "Checking MyAnimeList for missing episodes before searching release sources."
        : "MAL preflight disabled; planning all selected categories.");
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
        await persistResumeState();
      } else if (run.planOnly) {
        run.state = "complete";
        run.phase = "plan";
        run.finishedAt = new Date().toISOString();
        runEvent(run, `Plan ready: ${run.items.filter((item) => item.state === "queued").length} category(s) need maintenance.`);
      } else if (!run.total) {
        run.state = "complete";
        run.phase = "complete";
        run.finishedAt = new Date().toISOString();
        await persistResumeState();
      } else {
        const hasQueuedWork = run.items.some((item) => item.state === "queued");
        if (hasQueuedWork && payload?.tdPreflight !== false) {
          run.phase = "auth";
          runEvent(run, "Checking the Toodrive session before starting maintenance jobs.");
          const tdSession = await checkTdSession();
          if (!tdSession.ok) {
            const loginHint = /\btd login\b/.test(String(tdSession.message || ""))
              ? ""
              : " Run: td login --auth-backend=file";
            throw new Error(
              `Toodrive authentication failed (${tdSession.code || "unknown"}): ${tdSession.message}.${loginHint}`,
            );
          }
        }
        run.state = "running";
        run.phase = "maintenance";
        await persistResumeState();
        void executeMaintenanceRun(run, payload);
      }
    } catch (error) {
      run.failed += 1;
      run.state = run.cancelled ? "cancelled" : "failed";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      runEvent(run, error instanceof Error ? error.message : String(error));
      await persistResumeState();
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

function makeEpisodeEntry(artifact, existing) {
  const entry = existing && typeof existing === "object" ? { ...existing } : {};
  const number = artifact.episode;
  if (!entry.title) entry.title = `Episode ${String(number).padStart(2, "0")}`;
  entry.src = normalizeToodriveUrl(artifact.url);
  if (numericValue(artifact.sizeBytes)) entry.fileSizeBytes = numericValue(artifact.sizeBytes);
  if (durationValue(artifact.durationSeconds)) entry.durationSeconds = durationValue(artifact.durationSeconds);
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
    const episodes = incoming.map((artifact) => makeEpisodeEntry(artifact));
    const data = {
      title,
      categories: [{ category: categoryName, episodes }],
      LatestTime: now,
      totalFileSizeBytes: totalSize({ categories: [{ episodes }] }),
    };
    normalizeManifestSourceUrls(data);
    const duration = totalDuration(data);
    if (duration > 0 && hasCompleteDurations(data)) data.totalDurationSeconds = duration;
    if (String(maintenance.image || "").trim()) data.Image = String(maintenance.image).trim();
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const github = await publishSourceToGithub(target.path, content, { title, category: categoryName });
    await writeFile(target.absolute, content);
    return { action, path: target.path, file: target.file, title, category: categoryName, added: episodes.length, replaced: 0, skipped: 0, github };
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
  const { key, entries } = getEntries(category);
  const incoming = selectArtifacts(artifacts, maintenance, entries);
  if (!incoming.length) throw new Error("the torrent produced no matching video links");
  const replaceExisting = maintenance.replaceExisting !== false;
  const addMissing = maintenance.addMissing !== false;
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const changed = [];
  for (const artifact of incoming) {
    const index = artifact.episode ? entries.findIndex((entry) => episodeInfo(entry?.title).episode === artifact.episode) : -1;
    if (index >= 0) {
      if (!replaceExisting) { skipped += 1; continue; }
      entries[index] = makeEpisodeEntry(artifact, entries[index]);
      replaced += 1;
      changed.push(entries[index].title);
      continue;
    }
    if (!addMissing) { skipped += 1; continue; }
    const entry = makeEpisodeEntry(artifact);
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
  return { action, path: target.path, file: target.file, title, category: category.category, added, replaced, skipped, changed, github };
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
  let finalCode = code;
  let wasCancelled = cancelled || job.cancelled === true || job.stopRequested === true;
  if (finalCode === 0 && job.maintenance && !wasCancelled) {
    job.state = "finalizing";
    if (job.durationProbePromises?.size) {
      await Promise.allSettled([...job.durationProbePromises.values()]);
    }
    try {
      job.manifest = await applyMaintenanceSerially(job.maintenance, job.artifacts);
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
  if (job.maintenance) await persistResumeState();
  delete job.finishing;
  job.resolveDone?.(job);
}

function recordEvent(job, event, stream) {
  const normalizedEvent = event?.url
    ? { ...event, url: normalizeToodriveUrl(event.url) }
    : event;
  if (normalizedEvent.event === "metadata") job.metadataSeen = true;
  if (normalizedEvent.event === "progress" && Number(normalizedEvent.transferredBytes) > 0) job.hasTransferProgress = true;
  if (normalizedEvent.event === "link" && normalizedEvent.url) {
    if (!job.links.includes(normalizedEvent.url)) job.links.push(normalizedEvent.url);
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === normalizedEvent.remotePath);
    if (artifact) artifact.url = normalizedEvent.url;
    else job.artifacts.push({ remotePath: normalizedEvent.remotePath || "", url: normalizedEvent.url });
  }
  if (normalizedEvent.event === "file_result" && normalizedEvent.remotePath) {
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === normalizedEvent.remotePath);
    const target = artifact || { remotePath: normalizedEvent.remotePath, sizeBytes: normalizedEvent.sizeBytes, localPath: normalizedEvent.localPath };
    if (artifact) Object.assign(target, { sizeBytes: normalizedEvent.sizeBytes, localPath: normalizedEvent.localPath });
    else job.artifacts.push(target);
    scheduleArtifactDurationProbe(job, target, normalizedEvent);
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
  if (activePipelineJob !== job) return;
  activePipelineJob = null;
  drainPipelineQueue();
}

function drainPipelineQueue() {
  if (activePipelineJob) return;
  const entry = pipelineQueue.shift();
  if (!entry) return;
  const job = entry.job;
  job.queueEntry = null;
  if (job.finishedAt) {
    drainPipelineQueue();
    return;
  }
  if (job.stopRequested || job.cancelled) {
    void finishJob(job, 1, new Error("Job stopped before it started."), { cancelled: true })
      .finally(() => drainPipelineQueue());
    return;
  }
  activePipelineJob = job;
  try {
    spawnTdAttempt(job, entry.options, () => releasePipelineSlot(job));
  } catch (error) {
    void finishJob(job, 1, error).finally(() => releasePipelineSlot(job));
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
    job.child.kill("SIGTERM");
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

function spawnTdAttempt(job, { downloadAll, repairAttempts, retry = false }, releaseSlot = () => {}) {
  const args = tdAttemptArgs(job, { downloadAll, repairAttempts });
  const child = spawn(TD_BIN, args, {
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
    flush();
    job.child = null;
    const exitCode = code ?? 1;
    if (shouldFallbackToSequential(job, exitCode)) {
      emitSequentialFallback(job, attemptError?.message || `td exited with code ${exitCode}`);
      spawnTdAttempt(job, {
        downloadAll: false,
        repairAttempts: MAINTENANCE_TD_REPAIR_ATTEMPTS,
        retry: true,
      }, releaseSlot);
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
  const id = randomUUID();
  let resolveDone;
  const source = torrentUrl || magnet;
  const job = {
    id, state: "starting", events: [], links: [], artifacts: [], manifest: null,
    runId: runId || maintenance?.runId || null, maintenance: maintenance || null, cacheDir: null, startedAt: new Date().toISOString(),
    source, destination, adaptiveFallback: Boolean(maintenance), fallbackAttempted: false,
    metadataSeen: false, hasTransferProgress: false, stopRequested: false, cancelled: false, attempt: 0,
    fileCleanupPromises: new Set(),
    durationProbePromises: new Map(),
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
  const repairAttempts = maintenance ? MAINTENANCE_TD_REPAIR_ATTEMPTS : DEFAULT_TD_REPAIR_ATTEMPTS;
  const downloadAll = !maintenance || maintenance.action === "new";
  if (maintenance) await persistResumeState();
  enqueueTdAttempt(job, { downloadAll, repairAttempts });
  if (maintenance) await persistResumeState();
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
    fileCleanupPromises: new Set(),
    durationProbePromises: new Map(),
    done: new Promise((resolveDonePromise) => { resolveDone = resolveDonePromise; }),
  };
  job.resolveDone = resolveDone;
  job.stop = () => requestJobStop(job);
  jobs.set(job.id, job);
  if (job.finishedAt) job.resolveDone(job);
  return job;
}

async function resumeMaintenanceRun(run) {
  const payload = run.payload || {};
  if (run.items.length && run.state !== "checking") {
    run.state = "running";
    run.phase = "maintenance";
    await persistResumeState();
    void executeMaintenanceRun(run, payload);
    return;
  }

  const library = await listLibrary();
  run.state = "checking";
  run.phase = maintenanceMalEnabled(payload) ? "mal" : "planning";
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
    runEvent(run, `Plan ready: ${run.items.filter((item) => item.state === "queued").length} category(s) need maintenance.`);
    return;
  }
  if (!run.total) {
    run.state = "complete";
    run.phase = "complete";
    run.finishedAt = new Date().toISOString();
    await persistResumeState();
    return;
  }
  const hasQueuedWork = run.items.some((item) => item.state === "queued");
  if (hasQueuedWork && payload?.tdPreflight !== false) {
    run.phase = "auth";
    runEvent(run, "Checking the Toodrive session before resuming maintenance jobs.");
    const tdSession = await checkTdSession();
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
  void executeMaintenanceRun(run, payload);
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
    raw = await readFile(LOG_FILE, "utf8");
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
    if (knownJobIds.has(jobId) || completedJobs.has(jobId) || processIsAlive(jobStart.pid)) continue;
    const runId = jobStart.runId;
    if (!runId || knownRunIds.has(runId)) continue;
    const events = runEntries.get(runId) || [];
    const searching = events.find((entry) => /Searching (?:Nyaa|SeaDex|release sources) automatically for /i.test(entry.message || ""));
    const match = String(searching?.message || "").match(/^Searching (?:Nyaa|SeaDex|release sources) automatically for (.+?) · (.+)\.$/);
    if (!match) continue;
    const [, title, category] = match;
    const source = library.sources.find((candidate) => candidate.title === title);
    if (!source || !source.categories.some((candidate) => candidate.category === category)) continue;
    const cacheDir = jobMetadata.get(jobId)?.cachePath;
    if (!cacheDir) continue;
    const selected = events.find((entry) => /Selected .+ for /i.test(entry.message || ""));
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

  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
  const savedJobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  for (const saved of runs) {
    if (!saved?.id || saved.finishedAt || ["complete", "failed", "cancelled"].includes(saved.state)) continue;
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
    };
    run.stop = () => {
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

  await recoverLegacyMaintenanceWork(
    new Set(maintenanceRuns.keys()),
    new Set(jobs.keys()),
  );

  for (const job of jobs.values()) {
    if (!job.maintenance || job.finishedAt) continue;
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
    runEvent(run, "Found unfinished maintenance work after service restart.");
    void resumeMaintenanceRun(run).catch(async (error) => {
      run.failed += 1;
      run.state = "failed";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      runEvent(run, error instanceof Error ? error.message : String(error));
      await persistResumeState();
    });
  }
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
      concurrency: 1,
      activeJobId: activePipelineJob?.id || null,
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
        github: githubConfiguration(),
        scheduler: {
          concurrency: 1,
          activeJobId: activePipelineJob?.id || null,
          queuedJobs: pipelineQueue.length,
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/maintenance/active") {
      return json(res, 200, publicActiveWork());
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

async function startServer() {
  await restorePersistedWork();
  server.listen(PORT, HOST, () => {
    console.log(`Library maintenance service listening on http://${HOST}:${PORT}`);
    console.log(`Repository: ${REPO_ROOT}`);
    console.log(`Using td: ${TD_BIN}`);
    console.log(`Using Toodrive: ${TOODRIVE_BASE_URL}`);
    persistLog({ scope: "service", event: "service_started", port: PORT, repository: REPO_ROOT, td: TD_BIN });
  });
}

export {
  buildMaintenanceWork,
  maintenanceConcurrency,
  parseMalEpisodeProgress,
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
  splitReleasePlanByEpisode,
  releaseHasDualAudio,
  betterReleaseCandidate,
  selectArtifacts,
  probeMediaDurationSeconds,
  totalDuration,
  normalizeToodriveUrl,
  processMaintenanceItem,
  startJob,
  torrentConcurrency,
  publishSourceToGithub,
  cleanupJobCache,
};

if (process.env.MEDIA_MANAGER_TEST !== "1") {
  startServer().catch((error) => {
    console.error(`Maintenance service failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
