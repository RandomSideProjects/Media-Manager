#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the maintenance service's ffprobe behavior without starting its API.
process.env.MEDIA_MANAGER_TEST = "1";
const { probeMediaDurationSeconds } = await import(`../Maintenance/torrent-job-service.mjs?duration-backfill=${process.pid}`);

const execFile = promisify(execFileCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "Sources/Files/Anime");
const SOURCE_LIST_FILE = join(ROOT, "Sources/AnimeSourceList.json");

function option(name, fallback = "") {
  const index = process.argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return fallback;
  const value = process.argv[index].startsWith(`${name}=`)
    ? process.argv[index].slice(name.length + 1)
    : process.argv[index + 1];
  return value === undefined ? fallback : value;
}

function options(name) {
  return process.argv.flatMap((value, index) => {
    if (value.startsWith(`${name}=`)) return [value.slice(name.length + 1)];
    return value === name && process.argv[index + 1] !== undefined ? [process.argv[index + 1]] : [];
  });
}

function hasFlag(name) {
  return process.argv.includes(name) || process.argv.some((value) => value === `${name}=true`);
}

function sourceFileName(value) {
  let file = String(value || "").trim().replace(/^\.\//, "");
  if (file.startsWith("Sources/Files/Anime/")) file = file.slice("Sources/Files/Anime/".length);
  if (!file.toLowerCase().endsWith(".json") || file.includes("/")) throw new Error(`invalid anime source file: ${value}`);
  return file;
}

function episodesOf(data) {
  return (Array.isArray(data?.categories) ? data.categories : []).flatMap((category) => {
    const entries = Array.isArray(category?.episodes) ? category.episodes : Array.isArray(category?.items) ? category.items : [];
    return entries.map((entry) => ({ category: String(category?.category || ""), entry }));
  });
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function totalSize(data) {
  return episodesOf(data).reduce((sum, { entry }) => sum + positiveNumber(entry?.fileSizeBytes || entry?.sizeBytes || entry?.FileSizeBytes), 0);
}

function totalDuration(data) {
  return episodesOf(data).reduce((sum, { entry }) => sum + positiveNumber(entry?.durationSeconds || entry?.DurationSeconds), 0);
}

function hasCompleteDurations(data) {
  const episodes = episodesOf(data);
  return episodes.length > 0 && episodes.every(({ entry }) => positiveNumber(entry?.durationSeconds || entry?.DurationSeconds) > 0);
}

function syncManifestMetadata(data) {
  let changed = false;
  const size = Math.round(totalSize(data));
  if (size > 0 && data.totalFileSizeBytes !== size) {
    data.totalFileSizeBytes = size;
    changed = true;
  }
  if (hasCompleteDurations(data)) {
    const duration = Math.round(totalDuration(data));
    if (data.totalDurationSeconds !== duration) {
      data.totalDurationSeconds = duration;
      changed = true;
    }
  } else if (Object.prototype.hasOwnProperty.call(data, "totalDurationSeconds")) {
    // A partial aggregate is worse than an absent one: it looks complete to
    // the player even though one or more current URLs could not be probed.
    delete data.totalDurationSeconds;
    changed = true;
  }
  return changed;
}

function syncSourceListSummary(summary, data) {
  let changed = false;
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  const movieCategories = categories.filter((category) => /\bmovies?\b/i.test(String(category?.category || "")));
  const episodeCategories = categories.filter((category) => !movieCategories.includes(category));
  const episodeCount = episodeCategories.reduce((sum, category) => sum + (Array.isArray(category?.episodes) ? category.episodes.length : Array.isArray(category?.items) ? category.items.length : 0), 0);
  const movieCount = movieCategories.reduce((sum, category) => sum + (Array.isArray(category?.episodes) ? category.episodes.length : Array.isArray(category?.items) ? category.items.length : 0), 0);
  const itemCount = episodeCount + movieCount;
  for (const [key, value] of [["categoryCount", episodeCategories.length], ["episodeCount", episodeCount], ["itemCount", itemCount]]) {
    if (summary[key] !== value) {
      summary[key] = value;
      changed = true;
    }
  }
  if (movieCount > 0 && summary.movieCount !== movieCount) {
    summary.movieCount = movieCount;
    changed = true;
  } else if (!movieCount && Object.prototype.hasOwnProperty.call(summary, "movieCount")) {
    delete summary.movieCount;
    changed = true;
  }
  const size = Math.round(totalSize(data));
  if (size > 0 && summary.totalFileSizeBytes !== size) {
    summary.totalFileSizeBytes = size;
    changed = true;
  }
  if (hasCompleteDurations(data)) {
    const duration = Math.round(totalDuration(data));
    if (summary.totalDurationSeconds !== duration) {
      summary.totalDurationSeconds = duration;
      changed = true;
    }
  } else if (Object.prototype.hasOwnProperty.call(summary, "totalDurationSeconds")) {
    delete summary.totalDurationSeconds;
    changed = true;
  }
  return changed;
}

function episodeKey(category, entry) {
  return `${category}\u0000${String(entry?.title || "")}`;
}

async function gitOutput(args) {
  const result = await execFile("git", args, { cwd: ROOT, maxBuffer: 2 * 1024 * 1024 });
  return result.stdout;
}

async function changedSourceFiles(from, to, explicitFiles) {
  if (explicitFiles.length) return [...new Set(explicitFiles.map(sourceFileName))];
  if (!from) {
    const entries = await execFile("find", ["Sources/Files/Anime", "-maxdepth", "1", "-type", "f", "-name", "*.json"], { cwd: ROOT });
    return entries.stdout.split(/\r?\n/).filter(Boolean).map(sourceFileName);
  }
  const output = await gitOutput(["diff", "--name-only", from, to, "--", "Sources/Files/Anime"]);
  return [...new Set(output.split(/\r?\n/).filter(Boolean).map(sourceFileName))];
}

async function baseEpisodeMap(from, file) {
  if (!from) return new Map();
  try {
    const raw = await gitOutput(["show", `${from}:Sources/Files/Anime/${file}`]);
    const data = JSON.parse(raw);
    return new Map(episodesOf(data).map(({ category, entry }) => [episodeKey(category, entry), entry]));
  } catch {
    return new Map();
  }
}

const from = option("--from");
const to = option("--to", "HEAD");
const all = hasFlag("--all");
const missingOnly = hasFlag("--missing");
const explicitFiles = options("--file");
const concurrency = Math.max(1, Math.min(16, Number(option("--concurrency", "3")) || 3));
const retries = Math.max(1, Math.min(8, Number(option("--retries", "4")) || 4));
const files = await changedSourceFiles(from, to, explicitFiles);
if (!files.length) {
  console.log("No source manifests selected.");
  process.exit(0);
}

const manifests = new Map();
const targets = [];
for (const file of files) {
  const path = join(SOURCE_DIR, file);
  const data = JSON.parse(await readFile(path, "utf8"));
  manifests.set(file, { path, data, changed: false });
  const previous = await baseEpisodeMap(from, file);
  for (const { category, entry } of episodesOf(data)) {
    const currentDuration = positiveNumber(entry?.durationSeconds || entry?.DurationSeconds);
    const old = previous.get(episodeKey(category, entry));
    const changedSinceBase = Boolean(from) && (!old
      || String(old.src || "") !== String(entry.src || "")
      || positiveNumber(old.fileSizeBytes || old.sizeBytes || old.FileSizeBytes) !== positiveNumber(entry.fileSizeBytes || entry.sizeBytes || entry.FileSizeBytes));
    if (missingOnly && currentDuration > 0) continue;
    if (all || changedSinceBase || (!from && currentDuration <= 0)) {
      targets.push({ file, category, entry, source: String(entry?.src || "") });
    }
  }
}

console.log(`Probing ${targets.length} video(s) across ${files.length} manifest(s) with concurrency ${concurrency}.`);
let next = 0;
let successes = 0;
let failures = 0;
const failed = [];
async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= targets.length) return;
    const target = targets[index];
    try {
      let duration = 0;
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
          duration = await probeMediaDurationSeconds(target.source);
          break;
        } catch (error) {
          lastError = error;
          const permanent = /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error));
          if (attempt < retries && !permanent) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10_000, attempt * 1_500)));
          } else if (permanent) {
            break;
          }
        }
      }
      if (!duration) throw lastError || new Error("ffprobe returned no duration");
      target.entry.durationSeconds = duration;
      delete target.entry.DurationSeconds;
      manifests.get(target.file).changed = true;
      successes += 1;
      console.log(`[${successes + failures}/${targets.length}] ${target.file} · ${target.category} · ${target.entry.title}: ${duration}s`);
    } catch (error) {
      failures += 1;
      failed.push({ ...target, error: error instanceof Error ? error.message : String(error) });
      console.error(`[${successes + failures}/${targets.length}] FAILED ${target.file} · ${target.category} · ${target.entry.title}: ${failed.at(-1).error}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, targets.length || 1) }, () => worker()));

for (const [file, manifest] of manifests) {
  if (syncManifestMetadata(manifest.data)) manifest.changed = true;
  if (!manifest.changed) continue;
  await writeFile(manifest.path, `${JSON.stringify(manifest.data, null, 2)}\n`, "utf8");
}

const changedFilesWritten = [...manifests.entries()].filter(([, manifest]) => manifest.changed).map(([file]) => file);
if (files.length) {
  const list = JSON.parse(await readFile(SOURCE_LIST_FILE, "utf8"));
  let listChanged = false;
  for (const file of files) {
    const summary = (Array.isArray(list.sources) ? list.sources : []).find((source) => source?.file === file);
    if (!summary) continue;
    const data = manifests.get(file).data;
    if (syncSourceListSummary(summary, data)) listChanged = true;
  }
  if (listChanged) await writeFile(SOURCE_LIST_FILE, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

console.log(`Completed: ${successes} probed, ${failures} failed, ${changedFilesWritten.length} manifest(s) updated.`);
if (failed.length) {
  console.error(`Failed videos: ${failed.map(({ file, category, entry }) => `${file} · ${category} · ${entry.title}`).join(" | ")}`);
  process.exitCode = 1;
}
