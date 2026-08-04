#!/usr/bin/env node
// Local companion for Creator. Browser code cannot safely run libtorrent or
// spawn ffmpeg, so this service owns Nyaa search, the td pipeline, and the
// optional source-manifest maintenance step.
// Run from the repository with: node Creator/scripts/torrent-job-service.mjs

import { createServer } from "node:http";
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";

const PORT = Number(process.env.CREATOR_TORRENT_PORT || 41723);
const TD_BIN = process.env.TD_BIN || join(homedir(), ".deno/bin/td");
const TOODRIVE_BASE_URL = process.env.TOODRIVE_BASE_URL || "https://toodrive.xpbliss.fyi";
const NYAA_BASE_URLS = [
  process.env.NYAA_BASE_URL || "https://nyaa.si",
  process.env.NYAA_FALLBACK_URL || "https://nyaa.net",
].filter((base, index, all) => base && all.indexOf(base) === index);
const REPO_ROOT = resolve(process.env.MEDIA_MANAGER_ROOT || process.cwd());
const SOURCE_DIR = resolve(REPO_ROOT, "Sources/Files/Anime");
const SOURCE_PREFIX = "Sources/Files/Anime/";
const DEFAULT_CACHE = join(homedir(), ".local/share/toodrive-job/creator-cache");
const LOG_FILE = resolve(process.env.MEDIA_MANAGER_LOG_FILE || join(homedir(), ".local/share/media-manager-maintenance/maintenance.log"));
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
const MAL_CACHE_VERSION = 8;
const LOG_PROGRESS_INTERVAL_MS = 30_000;
const jobs = new Map();
const maintenanceRuns = new Map();
const logProgressAt = new Map();
let logQueue = Promise.resolve();
let malCache = null;
let malCacheLoad = null;
let malCacheWrite = Promise.resolve();
let malRequestQueue = Promise.resolve();
let malLastRequestAt = 0;

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
    const seeders = Number(get("nyaa:seeders")) || 0;
    const downloads = Number(get("nyaa:downloads")) || 0;
    const publishedAt = get("pubDate");
    const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] ||
      (viewUrl.includes("/download/") ? viewUrl :
        (viewUrl.includes("/view/") ? viewUrl.replace("/view/", "/download/") + ".torrent" : ""));
    const magnet = hash
      ? `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`
      : "";
    if (title) items.push({ title, viewUrl, torrentUrl: enclosure, magnet, hash, seeders, downloads, publishedAt });
  }
  return items;
}

async function nyaaSearch(query) {
  let lastError = null;
  for (const baseUrl of NYAA_BASE_URLS) {
    const url = `${baseUrl.replace(/\/$/, "")}/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`;
    try {
      const response = await fetch(url, { headers: { "user-agent": "Media-Manager-Creator/1.0" } });
      if (!response.ok) throw new Error(`Nyaa returned HTTP ${response.status}`);
      return parseItems(await response.text());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Nyaa search failed");
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
    const titleMatch = row.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (!idMatch || !titleMatch) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripHtml(cell[1]));
    const type = cells[2] || "";
    const episodeMatch = String(cells[3] || "").match(/\d+/);
    items.push({
      mal_id: Number(idMatch[1]),
      title: stripHtml(titleMatch[1]),
      url: `${MAL_HTML_BASE_URL}/anime/${Number(idMatch[1])}`,
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

async function enrichMalCandidates(items, source, categoryName) {
  const requestedSeason = categorySeasonNumber(categoryName);
  const isUsable = (item) => malTitleConfidence(item, source) && malCandidateStartsWithSource(item, source)
    && (!requestedSeason || malSeasonMarker(item) === requestedSeason || requestedSeason === 1 && !malSeasonMarker(item));
  if (items.some(isUsable)) return items;
  // MAL's search table uses the native title only.  Resolve at most the first
  // three result pages to obtain the English title, which handles translated
  // library names without turning a preflight into dozens of requests.
  const enriched = [];
  for (const item of items.slice(0, 5)) {
    if (!item?.mal_id) {
      enriched.push(item);
      continue;
    }
    try {
      const detail = await fetchMalText(`${MAL_HTML_BASE_URL}/anime/${item.mal_id}`);
      const candidate = applyMalDetail(item, detail);
      enriched.push(candidate);
      if (isUsable(candidate)) break;
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
    title: String(item?.title || item?.title_english || "").trim(),
    titleEnglish: String(item?.title_english || "").trim(),
    type: String(item?.type || ""),
    episodes: Number(item?.episodes) > 0 ? Number(item.episodes) : null,
    status: String(item?.status || ""),
    airing: item?.airing === true,
    seasonMarker: malSeasonMarker(item),
    score,
  };
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
  const candidates = [];
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
      if (Number.isFinite(score)) candidates.push(summarizeMalCandidate(item, score));
    }
    if (candidates.length) break;
  }
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
  score += Math.min(10, Math.log10(Math.max(1, item.seeders || 0) + 1) * 3);
  score += Math.min(5, Math.log10(Math.max(1, item.downloads || 0) + 1));
  return score;
}

async function findAutomaticRelease(source, categoryName) {
  const titleTokens = [...searchTokens(source.title)];
  const tokenFallbacks = titleTokens.length > 1
    ? [`${titleTokens.slice(-2).join(" ")} ${categoryName}`, titleTokens.at(-1)]
    : titleTokens;
  const queries = [`${source.title} ${categoryName}`, source.title, ...tokenFallbacks]
    .map((query) => query.trim())
    .filter((query, index, all) => query && all.indexOf(query) === index);
  let best = null;
  let lastError = null;
  for (const query of queries) {
    try {
      const items = await nyaaSearch(query);
      const ranked = items
        .map((item) => ({ item, score: automaticReleaseScore(item, source, categoryName) }))
        .filter((candidate) => Number.isFinite(candidate.score))
        .sort((a, b) => b.score - a.score);
      if (ranked[0] && (!best || ranked[0].score > best.score)) best = { ...ranked[0], query };
      if (ranked[0] && ranked[0].score >= 32) {
        return { ...ranked[0].item, score: ranked[0].score, query };
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (best && best.score >= 22) return { ...best.item, score: best.score, query: best.query };
  if (lastError) throw lastError;
  throw new Error(`no confident Nyaa release found for ${source.title} · ${categoryName}`);
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
  if (allCategories) return usable;
  const seasonal = usable.filter((category) => categorySeasonNumber(category.category));
  if (seasonal.length) {
    const latest = Math.max(...seasonal.map((category) => categorySeasonNumber(category.category)));
    return seasonal.filter((category) => categorySeasonNumber(category.category) === latest);
  }
  return usable.length ? [usable[usable.length - 1]] : [];
}

function maintenanceFolder(title, category) {
  return `${String(title || "Show").trim() || "Show"}/${String(category || "Season 1").trim() || "Season 1"}`;
}

function runEvent(run, message, extra = {}) {
  const event = { at: new Date().toISOString(), event: "run", message, ...extra };
  run.events.push(event);
  if (run.events.length > 2000) run.events.shift();
  persistLog({ scope: "run", runId: run.id, ...event });
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
    planOnly: run.planOnly === true,
    current: run.current,
    currentJobId: run.currentJobId,
    items: run.items,
    events: run.events,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function maintenanceMalEnabled(payload) {
  return process.env.MAL_CHECK !== "0" && payload?.malCheck !== false;
}

function missingEpisodesForCategory(category, expectedEpisodes) {
  const expected = Number(expectedEpisodes);
  if (!Number.isInteger(expected) || expected <= 0) return { known: false, missing: [] };
  const numbers = Array.isArray(category?.episodeNumbers)
    ? category.episodeNumbers.filter((number) => Number.isInteger(number) && number > 0)
    : [];
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
    id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title,
    category: category?.category || "", state: "skipped", reason, mal,
  };
}

async function buildMaintenanceWork(sources, payload, { onProgress } = {}) {
  const sourcePaths = Array.isArray(payload?.sourcePaths) && payload.sourcePaths.length
    ? new Set(payload.sourcePaths.map((path) => String(path)))
    : null;
  const work = [];
  const selectedSources = sources.filter((source) => !sourcePaths || sourcePaths.has(source.path) || sourcePaths.has(source.file));
  let preflightCompleted = 0;
  const malEnabled = maintenanceMalEnabled(payload);
  for (const source of selectedSources) {
    if (sourcePaths && !sourcePaths.has(source.path) && !sourcePaths.has(source.file)) continue;
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
        const malCandidate = chooseMalCandidate(malResult?.candidates, source, category.category);
        if (!malCandidate) {
          const reason = malResult?.error
            ? `MAL check unavailable: ${malResult.error}`
            : "MAL did not return a confident matching anime";
          work.push(skippedMaintenanceItem(source, category, reason, { status: "unavailable", error: malResult?.error || "" }));
          continue;
        }
        if (!Number.isInteger(Number(malCandidate.episodes)) || Number(malCandidate.episodes) <= 0) {
          work.push(skippedMaintenanceItem(source, category, "MAL episode count is not available yet", { status: "unknown", ...malCandidate }));
          continue;
        }
        const missing = missingEpisodesForCategory(category, malCandidate.episodes);
        if (!missing.known) {
          work.push(skippedMaintenanceItem(source, category, "library episode numbering is not readable", { status: "unknown", ...malCandidate }));
          continue;
        }
        if (!missing.missing.length) {
          work.push(skippedMaintenanceItem(source, category, `MAL reports ${malCandidate.episodes} episodes and the library is complete`, { status: "complete", ...malCandidate }));
          continue;
        }
        work.push({
          id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title,
          category: category.category, state: "queued", query: "", candidate: null,
          jobId: null, manifest: null, links: 0, error: "", missingEpisodes: missing.missing,
          mal: { status: "missing", ...malCandidate },
        });
        continue;
      }
      work.push({
        id: randomUUID(), sourcePath: source.path, sourceFile: source.file, title: source.title,
        category: category.category, state: "queued", query: "", candidate: null,
        jobId: null, manifest: null, links: 0, error: "", missingEpisodes: [],
        mal: { status: "disabled" },
      });
    }
  }
  return { work, preflightCompleted, preflightTotal: selectedSources.reduce((sum, source) => sum + automaticCategories(source, payload?.allCategories === true).length, 0), malEnabled };
}

async function executeMaintenanceRun(run, payload) {
  try {
    for (const item of run.items) {
      if (run.cancelled) break;
      run.current = item.id;
      if (item.state === "skipped") {
        run.skipped += 1;
        run.completed += 1;
        runEvent(run, `Skipped ${item.title}${item.category ? ` · ${item.category}` : ""}: ${item.reason}.`);
        continue;
      }

      const source = { title: item.title };
      item.state = "searching";
      runEvent(run, `Searching Nyaa automatically for ${item.title} · ${item.category}.`);
      try {
        const release = await findAutomaticRelease(source, item.category);
        item.query = release.query;
        item.candidate = { title: release.title, score: release.score, viewUrl: release.viewUrl };
        item.state = "downloading";
        runEvent(run, `Selected ${release.title} for ${item.title} · ${item.category}.`);
        const child = await startJob({
          torrentUrl: release.torrentUrl,
          magnet: release.magnet,
          destination: maintenanceFolder(item.title, item.category),
          runId: run.id,
          maintenance: {
            action: "update",
            sourcePath: item.sourcePath,
            categoryName: item.category,
            seasonNumber: categorySeasonNumber(item.category) || undefined,
            replaceExisting: payload?.replaceExisting !== false,
            addMissing: payload?.addMissing !== false,
          },
        });
        item.jobId = child.id;
        run.currentJobId = child.id;
        const result = await child.done;
        item.links = result.links?.length || 0;
        item.manifest = result.manifest || null;
        if (result.state === "complete") {
          item.state = "complete";
          runEvent(run, `Updated ${item.title} · ${item.category} (${item.links} links).`);
        } else if (result.state === "cancelled") {
          item.state = "cancelled";
          run.cancelled = true;
          runEvent(run, `Cancelled ${item.title} · ${item.category}.`);
        } else {
          item.state = "failed";
          item.error = result.events?.at(-1)?.message || `td exited with code ${result.exitCode ?? "?"}`;
          run.failed += 1;
          runEvent(run, `Failed ${item.title} · ${item.category}: ${item.error}.`);
        }
      } catch (error) {
        item.state = "failed";
        item.error = error instanceof Error ? error.message : String(error);
        run.failed += 1;
        runEvent(run, `Skipped ${item.title} · ${item.category}: ${item.error}.`);
      }
      run.completed += 1;
    }
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
    run.current = null;
    run.currentJobId = null;
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
  }
}

async function startMaintenanceRun(payload = {}) {
  const library = await listLibrary();
  const run = {
    id: randomUUID(), state: "checking", phase: maintenanceMalEnabled(payload) ? "mal" : "planning",
    total: 0, completed: 0, failed: 0, skipped: 0, preflightCompleted: 0, preflightTotal: 0,
    current: null, currentJobId: null, items: [], events: [], startedAt: new Date().toISOString(),
    finishedAt: null, cancelled: false, planOnly: payload?.dryRun === true || payload?.planOnly === true,
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
    run.currentJobId && jobs.get(run.currentJobId)?.stop?.();
  };
  persistLog({ scope: "run", event: "run_started", runId: run.id, state: run.state, phase: run.phase });
  void (async () => {
    try {
      runEvent(run, maintenanceMalEnabled(payload)
        ? "Checking MyAnimeList for missing episodes before searching Nyaa."
        : "MAL preflight disabled; planning all selected categories.");
      const planned = await buildMaintenanceWork(library.sources, payload, {
        onProgress: (progress) => {
          if (progress?.completed) run.preflightCompleted = progress.completed;
          if (progress?.state === "checking_mal") run.current = null;
        },
      });
      run.items = planned.work;
      run.total = run.items.length;
      run.preflightCompleted = planned.preflightCompleted;
      run.preflightTotal = planned.preflightTotal;
      if (run.cancelled) {
        run.state = "cancelled";
        run.phase = "complete";
      } else if (run.planOnly) {
        run.state = "complete";
        run.phase = "plan";
        run.finishedAt = new Date().toISOString();
        runEvent(run, `Plan ready: ${run.items.filter((item) => item.state === "queued").length} category(s) need maintenance.`);
      } else if (!run.total) {
        run.state = "complete";
        run.phase = "complete";
        run.finishedAt = new Date().toISOString();
      } else {
        run.state = "running";
        run.phase = "maintenance";
        void executeMaintenanceRun(run, payload);
      }
    } catch (error) {
      run.failed += 1;
      run.state = run.cancelled ? "cancelled" : "failed";
      run.phase = "complete";
      run.finishedAt = new Date().toISOString();
      runEvent(run, error instanceof Error ? error.message : String(error));
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
  if (job.cacheDir) await clearStalePipelineLock(job.cacheDir).catch(() => {});
  persistLog({
    scope: "job",
    event: finalCode === 0 ? "job_complete" : "job_failed",
    jobId: job.id,
    runId: job.runId,
    state: job.state,
    exitCode: finalCode,
    message: error ? (error instanceof Error ? error.message : String(error)) : undefined,
  });
  delete job.finishing;
  job.resolveDone?.(job);
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
  persistLog({ scope: "job", jobId: job.id, runId: job.runId, stream, ...event });
}

async function startJob({ torrentUrl, magnet, destination, cacheDir, runId, maintenance }) {
  if (!torrentUrl && !magnet) throw new Error("torrentUrl or magnet is required");
  if (!destination || typeof destination !== "string") throw new Error("destination is required");
  const id = randomUUID();
  let resolveDone;
  const job = {
    id, state: "starting", events: [], links: [], artifacts: [], manifest: null,
    runId: runId || maintenance?.runId || null, maintenance: maintenance || null, cacheDir: null, startedAt: new Date().toISOString(),
    done: new Promise((resolveDonePromise) => { resolveDone = resolveDonePromise; }),
  };
  job.resolveDone = resolveDone;
  jobs.set(id, job);
  const source = torrentUrl || magnet;
  const cacheRoot = resolve(cacheDir || DEFAULT_CACHE);
  const cache = join(cacheRoot, id);
  await mkdir(cache, { recursive: true });
  job.cacheDir = cache;
  await clearStalePipelineLock(cache);
  const args = ["--base-url", TOODRIVE_BASE_URL, "torrent", source, destination, "--video-pipeline", "--download-all", "--repair", "--json", "--cache-dir", cache];
  if (maintenance?.replaceExisting) args.push("--exist=overwrite");
  const child = spawn(TD_BIN, args, { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  job.pid = child.pid;
  job.state = "running";
  persistLog({ scope: "job", event: "job_started", jobId: job.id, runId: job.runId, pid: job.pid, source, destination });
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
    runId: job.runId,
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
        run.stop?.();
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
        job.stop?.();
        job.finishedAt = new Date().toISOString();
        job.exitCode = null;
        job.state = "cancelled";
        job.resolveDone?.(job);
      }
      return json(res, 200, publicJob(job));
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Library maintenance service listening on http://127.0.0.1:${PORT}`);
  console.log(`Repository: ${REPO_ROOT}`);
  console.log(`Using td: ${TD_BIN}`);
  console.log(`Using Toodrive: ${TOODRIVE_BASE_URL}`);
  persistLog({ scope: "service", event: "service_started", port: PORT, repository: REPO_ROOT, td: TD_BIN });
});
