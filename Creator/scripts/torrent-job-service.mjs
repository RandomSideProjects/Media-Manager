#!/usr/bin/env node
// Local companion for Creator. Browser code cannot safely run libtorrent or
// spawn ffmpeg, so this small service owns Nyaa search and the td pipeline.
// Run from the repository with: node Creator/scripts/torrent-job-service.mjs

import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PORT = Number(process.env.CREATOR_TORRENT_PORT || 41723);
const TD_BIN = process.env.TD_BIN || join(homedir(), ".deno/bin/td");
const TOODRIVE_BASE_URL = process.env.TOODRIVE_BASE_URL || "https://toodrive.xpbliss.fyi";
const DEFAULT_CACHE = join(homedir(), ".local/share/toodrive-job/creator-cache");
const jobs = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(new Error("request too large")); });
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

function startJob({ torrentUrl, magnet, destination, cacheDir }) {
  if (!torrentUrl && !magnet) throw new Error("torrentUrl or magnet is required");
  if (!destination || typeof destination !== "string") throw new Error("destination is required");
  const id = randomUUID();
  const job = { id, state: "starting", events: [], links: [], startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const source = torrentUrl || magnet;
  const cache = resolve(cacheDir || DEFAULT_CACHE);
  const args = ["--base-url", TOODRIVE_BASE_URL, "torrent", source, destination, "--video-pipeline", "--download-all", "--repair", "--json", "--cache-dir", cache];
  mkdir(cache, { recursive: true }).catch((error) => finishJob(job, 1, error));
  const child = spawn(TD_BIN, args, { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  job.pid = child.pid;
  job.state = "running";
  const consume = (chunk, stream) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      let event;
      try { event = JSON.parse(line); } catch { event = { event: "log", stream, message: line }; }
      if (event.event === "link" && event.url && !job.links.includes(event.url)) job.links.push(event.url);
      job.events.push({ at: new Date().toISOString(), ...event });
      if (job.events.length > 5000) job.events.shift();
    }
  };
  child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
  child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
  child.on("error", (error) => finishJob(job, 1, error));
  child.on("close", (code) => finishJob(job, code ?? 1));
  job.stop = () => child.kill("SIGTERM");
  return job;
}

function finishJob(job, code, error) {
  if (job.finishedAt) return;
  job.finishedAt = new Date().toISOString();
  job.exitCode = code;
  job.state = code === 0 ? "complete" : "failed";
  if (error) job.events.push({ at: new Date().toISOString(), event: "error", message: error.message });
}

function publicJob(job) {
  return { id: job.id, state: job.state, pid: job.pid, links: job.links, events: job.events, startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); res.end(); return; }
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/nyaa/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return json(res, 400, { error: "q is required" });
      return json(res, 200, { items: await nyaaSearch(query) });
    }
    if (req.method === "POST" && url.pathname === "/api/torrent/jobs") {
      return json(res, 202, publicJob(startJob(await readBody(req))));
    }
    const jobMatch = url.pathname.match(/^\/api\/torrent\/jobs\/([^/]+)$/);
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
  console.log(`Creator torrent service listening on http://127.0.0.1:${PORT}`);
  console.log(`Using td: ${TD_BIN}`);
  console.log(`Using Toodrive: ${TOODRIVE_BASE_URL}`);
});
