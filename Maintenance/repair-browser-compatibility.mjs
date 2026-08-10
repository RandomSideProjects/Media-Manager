#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function envFromFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

envFromFile(process.env.MEDIA_MANAGER_ENV_FILE || join(process.env.HOME || "/tmp", ".config", "media-manager", "maintenance.env"));

const ROOT = resolve(process.env.MEDIA_MANAGER_ROOT || dirname(dirname(new URL(import.meta.url).pathname)));
const TD_BIN = process.env.TD_BIN || "td";
const TD_BASE_URL = process.env.TD_BASE_URL || "https://toodrive.xpbliss.fyi";
const STATE_FILE = process.env.MEDIA_MANAGER_BROWSER_REPAIR_STATE || join(process.env.XDG_STATE_HOME || join(process.env.HOME || "/tmp", ".local", "state"), "media-manager-browser-repair.json");
const WORK_DIR = process.env.MEDIA_MANAGER_BROWSER_REPAIR_WORK || join(process.env.TMPDIR || "/tmp", "media-manager-browser-repair");
const HELPER = resolve(process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY_SCRIPT || join(ROOT, "Maintenance", "browser-compatible-reencode.sh"));
const HEALTH_URL = process.env.MEDIA_MANAGER_HEALTH_URL || "http://127.0.0.1:6968/api/health";
const DRY_RUN = process.env.MEDIA_MANAGER_BROWSER_REPAIR_DRY_RUN === "1";
const RISKY_NAME = /x265|h\.?265|hevc|10[- ]?bit|\bav1\b|flac|e-?ac-?3|\bac3\b|\bddp(?:2\.0)?\b|\bopus\b|truehd|dts/i;

async function command(args, options = {}) {
  const result = await execFileAsync(TD_BIN, ["--base-url", TD_BASE_URL, ...args], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  return result.stdout;
}

async function listPath(remotePath = "") {
  const text = await command(["ls", "--json", remotePath]);
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const result = JSON.parse(lines.at(-1));
  return result.entries || [];
}

async function listAll() {
  const queue = [""];
  const seen = new Set();
  const files = [];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const entry of await listPath(current)) {
      if (entry.kind === "directory") queue.push(entry.path);
      else if (entry.kind === "file" && entry.status === "ready") files.push(entry);
    }
  }
  return files;
}

async function waitForMaintainer() {
  if (process.env.MEDIA_MANAGER_BROWSER_REPAIR_WAIT === "0") return;
  for (;;) {
    try {
      const health = await fetch(HEALTH_URL).then((response) => response.json());
      const scheduler = health.scheduler || {};
      if (!scheduler.activeJobId && Number(scheduler.queuedJobs || 0) === 0) return;
      console.log(`waiting for maintainer: active=${scheduler.activeJobId || "none"} queued=${scheduler.queuedJobs || 0}`);
    } catch (error) {
      console.log(`waiting for maintainer health: ${error.message}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30_000));
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { replacements: {}, failed: {} };
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function findDownloadedFile(directory, expectedName) {
  const exact = join(directory, expectedName);
  if (existsSync(exact)) return exact;
  const pending = [directory];
  while (pending.length) {
    const current = pending.shift();
    for (const name of await readdir(current, { withFileTypes: true })) {
      const full = join(current, name.name);
      if (name.isDirectory()) pending.push(full);
      else if (name.name === expectedName || /\.(mp4|mkv|webm)$/i.test(name.name)) return full;
    }
  }
  throw new Error(`download did not produce ${expectedName}`);
}

async function runHelper(input) {
  await execFileAsync("bash", [HELPER], {
    cwd: ROOT,
    env: { ...process.env, TD_LOCAL_PATH: input },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function uploadReplacement(localFile, remotePath) {
  await command(["upload", "--json", "--exist", "overwrite", localFile, remotePath], { maxBuffer: 64 * 1024 * 1024 });
  const refreshed = await listPath(dirname(remotePath));
  const replacement = refreshed.find((entry) => entry.kind === "file" && entry.status === "ready" && entry.path === remotePath);
  if (!replacement) throw new Error(`uploaded file was not visible at ${remotePath}`);
  return replacement;
}

async function githubRequest(pathname, options = {}) {
  const token = process.env.MEDIA_MANAGER_GITHUB_TOKEN;
  if (!token) throw new Error("MEDIA_MANAGER_GITHUB_TOKEN is not configured");
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

async function publishManifestChanges(replacements) {
  const repository = process.env.MEDIA_MANAGER_GITHUB_REPOSITORY || "RandomSideProjects/Media-Manager";
  const branch = process.env.MEDIA_MANAGER_GITHUB_BRANCH || "main";
  const grouped = new Map();
  for (const replacement of replacements) {
    for (const file of replacement.manifestFiles || []) {
      if (!grouped.has(file)) grouped.set(file, []);
      grouped.get(file).push(replacement);
    }
  }
  for (const [file, changes] of grouped) {
    const apiPath = `/repos/${repository}/contents/${file}?ref=${encodeURIComponent(branch)}`;
    const current = await githubRequest(apiPath);
    let content = Buffer.from(current.content.replace(/\s/g, ""), "base64").toString("utf8");
    let changed = false;
    for (const change of changes) {
      const oldUrl = `${TD_BASE_URL}/dl/${change.oldId}/raw`;
      const newUrl = `${TD_BASE_URL}/dl/${change.newId}/raw`;
      if (content.includes(oldUrl)) {
        content = content.split(oldUrl).join(newUrl);
        changed = true;
      }
    }
    if (!changed) continue;
    await githubRequest(`/repos/${repository}/contents/${file}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Repair browser-incompatible Toodrive videos in ${basename(file)}`,
        content: Buffer.from(content).toString("base64"),
        branch,
        sha: current.sha,
      }),
    });
    console.log(`published ${file}`);
  }
}

const state = await readState();
await waitForMaintainer();
await mkdir(WORK_DIR, { recursive: true });
const files = (await listAll()).filter((entry) => /\.mp4$/i.test(entry.name) && RISKY_NAME.test(entry.name));
console.log(`candidate files: ${files.length}`);
const replacements = [];

for (const entry of files) {
  if (state.replacements[entry.id]) continue;
  const work = join(WORK_DIR, entry.id);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    console.log(`checking ${entry.path}`);
    const downloaded = await command(["download", "--json", entry.path, work], { maxBuffer: 64 * 1024 * 1024 });
    const lines = downloaded.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) throw new Error("download produced no output");
    const localFile = await findDownloadedFile(work, entry.name);
    const probe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", localFile], { maxBuffer: 2 * 1024 * 1024 });
    const streams = JSON.parse(probe.stdout).streams || [];
    const video = streams.find((stream) => stream.codec_type === "video") || {};
    const audio = streams.filter((stream) => stream.codec_type === "audio");
    const browserSafe = video.codec_name === "h264"
      && video.pix_fmt === "yuv420p"
      && audio.every((stream) => ["aac", "mp3"].includes(String(stream.codec_name || "").toLowerCase()));
    if (browserSafe) {
      console.log(`already browser-safe: ${entry.name}`);
      state.replacements[entry.id] = { skipped: true, checkedAt: new Date().toISOString() };
      await saveState(state);
      continue;
    }
    if (DRY_RUN) {
      console.log(`dry-run would repair ${entry.name}: ${video.codec_name || "unknown"}/${video.pix_fmt || "unknown"} audio=${audio.map((stream) => stream.codec_name).join(",") || "none"}`);
      continue;
    }
    await runHelper(localFile);
    const replacement = await uploadReplacement(localFile, entry.path);
    const manifestFiles = [];
    for (const file of await readdir(join(ROOT, "Sources", "Files", "Anime"))) {
      if (!file.endsWith(".json")) continue;
      const text = await readFile(join(ROOT, "Sources", "Files", "Anime", file), "utf8");
      if (text.includes(`/dl/${entry.id}/raw`)) manifestFiles.push(`Sources/Files/Anime/${file}`);
    }
    const result = { oldId: entry.id, newId: replacement.id, path: entry.path, manifestFiles, finishedAt: new Date().toISOString() };
    state.replacements[entry.id] = result;
    replacements.push(result);
    await saveState(state);
    await rm(work, { recursive: true, force: true });
  } catch (error) {
    state.failed[entry.id] = { path: entry.path, error: error.message, at: new Date().toISOString() };
    await saveState(state);
    console.error(`FAILED ${entry.path}: ${error.message}`);
  }
}

if (!DRY_RUN && replacements.length) await publishManifestChanges(replacements);
console.log(`completed replacements: ${replacements.length}; state: ${STATE_FILE}`);
