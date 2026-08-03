#!/usr/bin/env node
// Local companion for Creator. Browser code cannot safely run libtorrent or
// spawn ffmpeg, so this service owns Nyaa search, the td pipeline, and the
// optional source-manifest maintenance step.
// Run from the repository with: node Creator/scripts/torrent-job-service.mjs

import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const PORT = Number(process.env.CREATOR_TORRENT_PORT || 41723);
const TD_BIN = process.env.TD_BIN || join(homedir(), ".deno/bin/td");
const TOODRIVE_BASE_URL = process.env.TOODRIVE_BASE_URL || "https://toodrive.xpbliss.fyi";
const REPO_ROOT = resolve(process.env.MEDIA_MANAGER_ROOT || process.cwd());
const SOURCE_DIR = resolve(REPO_ROOT, "Sources/Files/Anime");
const SOURCE_PREFIX = "Sources/Files/Anime/";
const DEFAULT_CACHE = join(homedir(), ".local/share/toodrive-job/creator-cache");
const jobs = new Map();

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

function parseItems(xml) {
  const items = [];
  for (const match of xml.matchAll(/<item[\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const get = (name) => {
      const found = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
      return found ? found[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
    };
    const title = get("title");
    const viewUrl = get("link");
    const hash = get("nyaa:infoHash") || get("infoHash");
    const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] ||
      (viewUrl.includes("/download/") ? viewUrl :
        (viewUrl.includes("/view/") ? viewUrl.replace("/view/", "/download/") + ".torrent" : ""));
    const magnet = hash
      ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
      : "";
    if (title) items.push({ title, viewUrl, torrentUrl: enclosure, magnet, hash });
  }
  return items;
}

async function nyaaSearch(query) {
  const url = `https://nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`;
  const response = await fetch(url, { headers: { "user-agent": "Media-Manager-Creator/1.0" } });
  if (!response.ok) throw new Error(`Nyaa returned HTTP ${response.status}`);
  return parseItems(await response.text());
}

function episodeInfo(value) {
  const text = String(value || "");
  const seasonMatch = text.match(/\bS(?:eason)?\s*0*(\d{1,2})(?=E|\b)/i);
  const seasonEpisode = text.match(/\bS\s*0*(\d{1,2})\s*[-_. ]*E\s*0*(\d{1,3})\b/i);
  const explicitEpisode = text.match(/(?:^|[\s._\-[\]()])(?:EP(?:ISODE)?|E)[\s._-]*0*(\d{1,3})(?!\d)/i);
  const bracketEpisode = text.match(/[\[(]\s*0*(\d{1,3})(?:v\d+)?\s*[\])]/i);
  const standaloneEpisode = text.match(/(?:^|[\s._-])0*(\d{1,3})(?=\s*(?:[\[(.]|$))/i);
  const rawEpisode = seasonEpisode?.[2] || explicitEpisode?.[1] || bracketEpisode?.[1] || standaloneEpisode?.[1];
  const episode = rawEpisode ? Number(rawEpisode) : null;
  const season = seasonEpisode?.[1] || (seasonMatch ? seasonMatch[1] : null);
  return {
    season: Number.isInteger(season) && season > 0 ? season : null,
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

function entrySize(entry) {
  if (!entry || typeof entry !== "object") return 0;
  if (Array.isArray(entry.sources)) return entry.sources.reduce((sum, part) => sum + entrySize(part), 0);
  if (Array.isArray(entry.parts)) return entry.parts.reduce((sum, part) => sum + entrySize(part), 0);
  return numericValue(entry.fileSizeBytes || entry.sizeBytes || entry.FileSizeBytes);
}

function totalSize(data) {
  return (Array.isArray(data?.categories) ? data.categories : []).reduce((sum, category) => {
    const { entries } = getEntries(category);
    return sum + entries.reduce((entrySum, entry) => entrySum + entrySize(entry), 0);
  }, 0);
}

function categorySummary(category, index) {
  const { entries } = getEntries(category);
  const parsed = entries.map((entry) => episodeInfo(entry?.title)).filter((info) => info.episode);
  return {
    index,
    category: String(category?.category || `Season ${index + 1}`),
    episodeCount: entries.length,
    latestEpisode: parsed.length ? Math.max(...parsed.map((info) => info.episode)) : null,
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

function artifactInfo(artifact) {
  const parsed = episodeInfo(artifact.remotePath || artifact.localPath || "");
  return { ...artifact, season: parsed.season, episode: parsed.episode };
}

function selectArtifacts(artifacts, maintenance, existingEntries = []) {
  const usable = artifacts.filter((artifact) => artifact && artifact.url);
  const requestedSeason = Number(maintenance.seasonNumber) || episodeInfo(maintenance.categoryName).season;
  const parsedSeasons = usable.map((artifact) => episodeInfo(artifact.remotePath)).filter((info) => info.season);
  const seasonFiltered = requestedSeason && parsedSeasons.length
    ? usable.filter((artifact) => !episodeInfo(artifact.remotePath).season || episodeInfo(artifact.remotePath).season === requestedSeason)
    : usable;
  let nextEpisode = Math.max(0, ...existingEntries.map((entry) => episodeInfo(entry?.title).episode || 0)) + 1;
  return seasonFiltered
    .sort((a, b) => String(a.remotePath || "").localeCompare(String(b.remotePath || "")))
    .map((artifact) => {
      const parsed = artifactInfo(artifact);
      if (!parsed.episode) parsed.episode = nextEpisode++;
      return parsed;
    })
    .sort((a, b) => (a.episode || 0) - (b.episode || 0) || String(a.remotePath || "").localeCompare(String(b.remotePath || "")));
}

function makeEpisodeEntry(artifact, existing) {
  const entry = existing && typeof existing === "object" ? { ...existing } : {};
  const number = artifact.episode;
  if (!entry.title) entry.title = `Episode ${String(number).padStart(2, "0")}`;
  entry.src = artifact.url;
  if (numericValue(artifact.sizeBytes)) entry.fileSizeBytes = numericValue(artifact.sizeBytes);
  return entry;
}

async function applyMaintenance(maintenance, artifacts) {
  const action = maintenance?.action === "new" ? "new" : "update";
  const now = new Date().toISOString();
  if (action === "new") {
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
    if (String(maintenance.image || "").trim()) data.Image = String(maintenance.image).trim();
    await writeFile(target.absolute, `${JSON.stringify(data, null, 2)}\n`);
    return { action, path: target.path, file: target.file, title, category: categoryName, added: episodes.length, replaced: 0, skipped: 0 };
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
  data.LatestTime = now;
  const size = totalSize(data);
  if (size > 0) data.totalFileSizeBytes = size;
  await writeFile(target.absolute, `${JSON.stringify(data, null, 2)}\n`);
  return { action, path: target.path, file: target.file, title: data.title || target.file, category: category.category, added, replaced, skipped, changed };
}

async function finishJob(job, code, error) {
  if (job.finishedAt || job.finishing) return;
  job.finishing = true;
  let finalCode = code;
  if (finalCode === 0 && job.maintenance) {
    job.state = "finalizing";
    try {
      job.manifest = await applyMaintenance(job.maintenance, job.artifacts);
    } catch (maintenanceError) {
      finalCode = 1;
      error = maintenanceError;
    }
  }
  job.finishedAt = new Date().toISOString();
  job.exitCode = finalCode;
  job.state = finalCode === 0 ? "complete" : "failed";
  if (error) job.events.push({ at: new Date().toISOString(), event: "error", message: error instanceof Error ? error.message : String(error) });
  delete job.finishing;
}

function recordEvent(job, event, stream) {
  if (event.event === "link" && event.url) {
    if (!job.links.includes(event.url)) job.links.push(event.url);
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === event.remotePath);
    if (artifact) artifact.url = event.url;
    else job.artifacts.push({ remotePath: event.remotePath || "", url: event.url });
  }
  if (event.event === "file_result" && event.remotePath) {
    const artifact = job.artifacts.find((candidate) => candidate.remotePath === event.remotePath);
    if (artifact) Object.assign(artifact, { sizeBytes: event.sizeBytes, localPath: event.localPath });
    else job.artifacts.push({ remotePath: event.remotePath, sizeBytes: event.sizeBytes, localPath: event.localPath });
  }
  job.events.push({ at: new Date().toISOString(), stream, ...event });
  if (job.events.length > 5000) job.events.shift();
}

async function startJob({ torrentUrl, magnet, destination, cacheDir, maintenance }) {
  if (!torrentUrl && !magnet) throw new Error("torrentUrl or magnet is required");
  if (!destination || typeof destination !== "string") throw new Error("destination is required");
  const id = randomUUID();
  const job = { id, state: "starting", events: [], links: [], artifacts: [], manifest: null, maintenance: maintenance || null, startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const source = torrentUrl || magnet;
  const cache = resolve(cacheDir || DEFAULT_CACHE);
  await mkdir(cache, { recursive: true });
  const args = ["--base-url", TOODRIVE_BASE_URL, "torrent", source, destination, "--video-pipeline", "--download-all", "--repair", "--json", "--cache-dir", cache];
  if (maintenance?.replaceExisting) args.push("--exist=overwrite");
  const child = spawn(TD_BIN, args, { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  job.pid = child.pid;
  job.state = "running";
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
  child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
  child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
  child.on("error", (error) => { void finishJob(job, 1, error); });
  child.on("close", (code) => { flush(); void finishJob(job, code ?? 1); });
  job.stop = () => child.kill("SIGTERM");
  return job;
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    pid: job.pid,
    links: job.links,
    artifacts: job.artifacts,
    manifest: job.manifest,
    events: job.events,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" });
    res.end();
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/nyaa/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return json(res, 400, { error: "q is required" });
      return json(res, 200, { items: await nyaaSearch(query) });
    }
    if (req.method === "GET" && url.pathname === "/api/library") return json(res, 200, await listLibrary());
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
        job.stop?.();
        job.finishedAt = new Date().toISOString();
        job.exitCode = null;
        job.state = "cancelled";
      }
      return json(res, 200, publicJob(job));
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Creator maintenance service listening on http://127.0.0.1:${PORT}`);
  console.log(`Repository: ${REPO_ROOT}`);
  console.log(`Using td: ${TD_BIN}`);
  console.log(`Using Toodrive: ${TOODRIVE_BASE_URL}`);
});

