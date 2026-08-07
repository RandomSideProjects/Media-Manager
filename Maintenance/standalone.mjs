#!/usr/bin/env node

// Self-starting desktop launcher for the maintenance UI. It owns the local
// static server and the maintenance API process, so no separate hosting
// command is needed.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const DEFAULT_SERVICE_PORT = 6968;
const DEFAULT_WEB_PORT = 8000;
const SERVICE_PROTOCOL_VERSION = "maintenance-v4";
const serviceScript = join(ROOT, "Maintenance", "service.mjs");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function parseArgs(argv) {
  const options = { servicePort: null, webPort: null, open: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--no-open") options.open = false;
    else if (arg === "--service-port") options.servicePort = Number(argv[++index]);
    else if (arg.startsWith("--service-port=")) options.servicePort = Number(arg.slice("--service-port=".length));
    else if (arg === "--port") options.webPort = Number(argv[++index]);
    else if (arg.startsWith("--port=")) options.webPort = Number(arg.slice("--port=".length));
    else throw new Error(`unknown option: ${arg}`);
  }
  for (const key of ["servicePort", "webPort"]) {
    if (options[key] !== null && (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > 65535)) {
      throw new Error(`${key === "webPort" ? "--port" : "--service-port"} must be a valid TCP port`);
    }
  }
  return options;
}

function configuredPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function printHelp() {
  console.log(`Media Manager Maintenance launcher\n\nUsage: node Maintenance/standalone.mjs [options]\n\nOptions:\n  --no-open             Start the local servers without opening a browser\n  --port <port>         Static UI port (default: first free port from 8000)\n  --service-port <port> API port (default: first free port from 6968)\n  -h, --help            Show this help\n`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function isPortAvailable(port) {
  const probe = createServer();
  return new Promise((resolveAvailability) => {
    const finish = (available) => {
      probe.removeAllListeners();
      try { probe.close(); } catch {}
      resolveAvailability(available);
    };
    probe.once("error", () => finish(false));
    probe.listen(port, HOST, () => finish(true));
  });
}

async function existingService(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return response.ok && body.protocol === SERVICE_PROTOCOL_VERSION;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function selectPort(preferred, explicit, service = false) {
  if (explicit !== null) {
    if (service && await existingService(explicit)) return { port: explicit, owned: false };
    if (!await isPortAvailable(explicit)) {
      throw new Error(service
        ? `port ${explicit} is already in use by an incompatible maintenance service; stop it or omit --service-port`
        : `port ${explicit} is already in use`);
    }
    return { port: explicit, owned: true };
  }
  for (let port = preferred; port <= preferred + 20; port += 1) {
    if (service && await existingService(port)) return { port, owned: false };
    if (await isPortAvailable(port)) return { port, owned: true };
  }
  throw new Error(`no free port found near ${preferred}`);
}

function safeTarget(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw Object.assign(new Error("invalid URL path"), { statusCode: 400 }); }
  if (decoded.includes("\0")) throw Object.assign(new Error("invalid URL path"), { statusCode: 400 });
  const target = resolve(ROOT, `.${decoded === "/" ? "/index.html" : decoded}`);
  const relativeTarget = relative(ROOT, target);
  if (relativeTarget.startsWith("..") || relativeTarget.split(sep).includes(".git")) {
    throw Object.assign(new Error("forbidden"), { statusCode: 403 });
  }
  return target;
}

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || HOST}`);
      let target = safeTarget(url.pathname);
      let info = await stat(target);
      if (info.isDirectory()) {
        target = join(target, "index.html");
        info = await stat(target);
      }
      if (!info.isFile()) throw Object.assign(new Error("not found"), { statusCode: 404 });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": info.size,
        "content-type": MIME_TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      });
      if (request.method === "HEAD") return response.end();
      createReadStream(target).pipe(response);
    } catch (error) {
      const status = Number(error?.statusCode) || (error?.code === "ENOENT" ? 404 : 500);
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found\n" : `${error?.message || "Request failed"}\n`);
    }
  });
}

async function listen(server, port) {
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

async function waitForService(port, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`maintenance service exited with code ${child.exitCode}`);
    if (await existingService(port)) return;
    await delay(250);
  }
  throw new Error(`maintenance service did not become ready on port ${port}`);
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.once("error", (error) => console.error(`Could not open a browser automatically: ${error.message}`));
  opener.unref();
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configuredServicePort = configuredPort(process.env.CREATOR_TORRENT_PORT);
  const configuredWebPort = configuredPort(process.env.MAINTENANCE_WEB_PORT);
  if (options.help) return printHelp();

  const serviceSelection = await selectPort(
    configuredServicePort || DEFAULT_SERVICE_PORT,
    options.servicePort ?? configuredServicePort,
    true,
  );
  const webSelection = await selectPort(
    DEFAULT_WEB_PORT,
    options.webPort ?? configuredWebPort,
  );
  const staticServer = createStaticServer();
  let serviceChild = null;
  try {
    await listen(staticServer, webSelection.port);
    if (serviceSelection.owned) {
      serviceChild = spawn(process.execPath, [serviceScript], {
        cwd: ROOT,
        env: {
          ...process.env,
          CREATOR_TORRENT_PORT: String(serviceSelection.port),
          CREATOR_TORRENT_HOST: HOST,
          MEDIA_MANAGER_ROOT: ROOT,
        },
        stdio: "inherit",
      });
    }
    await waitForService(serviceSelection.port, serviceChild);
  } catch (error) {
    await closeServer(staticServer).catch(() => {});
    if (serviceChild && serviceChild.exitCode === null) serviceChild.kill("SIGTERM");
    throw error;
  }

  const page = new URL(`http://${HOST}:${webSelection.port}/Maintenance/index.html`);
  page.searchParams.set("service", `http://${HOST}:${serviceSelection.port}`);
  console.log(`Maintenance UI: ${page}`);
  console.log(`Repository: ${ROOT}`);
  console.log("Press Ctrl+C to stop the local servers.");
  if (options.open) openBrowser(page.toString());

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeServer(staticServer).catch(() => {});
    if (serviceChild && serviceChild.exitCode === null) {
      serviceChild.kill("SIGTERM");
      await Promise.race([once(serviceChild, "exit"), delay(2_000)]);
      if (serviceChild.exitCode === null) serviceChild.kill("SIGKILL");
    }
    process.exitCode = code;
  };
  process.once("SIGINT", () => { void shutdown(0); });
  process.once("SIGTERM", () => { void shutdown(0); });
  if (serviceChild) serviceChild.once("exit", (code) => {
    if (!shuttingDown) {
      console.error(`Maintenance service exited unexpectedly with code ${code ?? "unknown"}.`);
      void shutdown(1);
    }
  });
}

main().catch((error) => {
  console.error(`Maintenance launcher failed: ${error.message}`);
  process.exitCode = 1;
});
