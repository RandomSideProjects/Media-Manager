import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "Sources", "Files");
const DEST_BASE = "https://cpr.xpbliss.fyi/pub/MM/4-23-26_Transfer";
const PW = process.env.COPY_PARTY_PW;
const SEGMENTS = Number.parseInt(process.env.CATBOX_TRANSFER_SEGMENTS ?? "8", 10);
const DEFAULT_U2C = path.join(ROOT, ".deps", "copyparty-pkg", "copyparty", "web", "a", "u2c.py");
const U2C = process.env.U2C_PATH ?? DEFAULT_U2C;
const VIDEO_RE = /^https:\/\/files\.catbox\.moe\/[^\s"']+\.(?:mp4|webm|mkv|mov|m4v|avi)$/i;
const DEST_RE = /^https:\/\/cpr\.xpbliss\.fyi\/pub\/MM\/4-23-26_Transfer\/[^/]+\/\d+\.(?:mp4|webm|mkv|mov|m4v|avi)$/i;

if (!PW) {
  console.error("Set COPY_PARTY_PW before running this script.");
  process.exit(2);
}

const encodeSegment = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const runCurl = async (args, options = {}) => {
  const { stdout, stderr } = await execFileAsync("curl", args, {
    maxBuffer: 1024 * 1024 * 16,
    ...options,
  });
  return { stdout, stderr };
};

const listJsonFiles = async () => {
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        found.push(fullPath);
      }
    }
  };
  visit(SOURCE_ROOT);
  return found.sort();
};

const extFromUrl = (url) => path.extname(new URL(url).pathname).slice(1).toLowerCase();

const appendFile = (source, targetStream) =>
  new Promise((resolve, reject) => {
    const input = fs.createReadStream(source);
    input.on("error", reject);
    input.on("end", resolve);
    input.pipe(targetStream, { end: false });
  });

const makeTarget = (jsonFile, itemIndex, srcUrl) => {
  const jsonName = path.basename(jsonFile, ".json");
  const ext = extFromUrl(srcUrl);
  return `${DEST_BASE}/${encodeSegment(jsonName)}/${itemIndex}.${ext}`;
};

const collectOccurrences = (value, jsonFile, state, setter) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectOccurrences(item, jsonFile, state, (replacement) => {
        value[index] = replacement;
      }),
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      collectOccurrences(value[key], jsonFile, state, (replacement) => {
        value[key] = replacement;
      });
    }
    return;
  }

  if (typeof value !== "string") return;
  if (!VIDEO_RE.test(value) && !DEST_RE.test(value)) return;

  state.itemIndex += 1;
  if (VIDEO_RE.test(value)) {
    state.pending.push({
      src: value,
      target: makeTarget(jsonFile, state.itemIndex, value),
      itemIndex: state.itemIndex,
      set: setter,
    });
  }
};

const headStatus = async (url) => {
  try {
    const { stdout } = await runCurl([
      "-sS",
      "-I",
      "--max-time",
      "30",
      "-H",
      `PW: ${PW}`,
      "-w",
      "\n%{http_code}",
      url,
    ]);
    const lines = stdout.trim().split(/\r?\n/);
    return lines.at(-1) ?? "";
  } catch {
    return "";
  }
};

const remoteSize = async (url) => {
  const { stdout } = await runCurl([
    "-sS",
    "-fL",
    "-r",
    "0-0",
    "-D",
    "-",
    "-o",
    os.devNull,
    url,
  ]);
  const match = stdout.match(/content-range:\s*bytes\s+0-0\/(\d+)/i);
  if (!match) {
    throw new Error("could not determine remote size from Content-Range");
  }
  return Number.parseInt(match[1], 10);
};

const curlRange = async (url, dest, start, end) => {
  await runCurl([
    "-sS",
    "-fL",
    "--retry",
    "5",
    "--connect-timeout",
    "30",
    "--speed-time",
    "90",
    "--speed-limit",
    "1024",
    "-r",
    `${start}-${end}`,
    "-o",
    dest,
    url,
  ]);
};

const download = async (url, dest) => {
  const size = await remoteSize(url);
  const segmentCount = Math.max(1, Math.min(Number.isFinite(SEGMENTS) ? SEGMENTS : 8, size));
  const chunkSize = Math.ceil(size / segmentCount);
  const parts = [];

  await Promise.all(
    Array.from({ length: segmentCount }, async (_, index) => {
      const start = index * chunkSize;
      const end = Math.min(size - 1, start + chunkSize - 1);
      const part = `${dest}.part-${index}`;
      parts.push({ path: part, start, end });
      await curlRange(url, part, start, end);
      const expected = end - start + 1;
      const actual = fs.statSync(part).size;
      if (actual !== expected) {
        throw new Error(`range ${start}-${end} downloaded ${actual} bytes, expected ${expected}`);
      }
    }),
  );

  parts.sort((a, b) => a.start - b.start);
  const output = fs.createWriteStream(dest);
  for (const part of parts) {
    await appendFile(part.path, output);
    fs.rmSync(part.path, { force: true });
  }
  await new Promise((resolve, reject) => {
    output.on("error", reject);
    output.end(resolve);
  });

  const actual = fs.statSync(dest).size;
  if (actual !== size) {
    throw new Error(`combined download is ${actual} bytes, expected ${size}`);
  }
};

const upload = async (file, url, tempDir) => {
  const passwordFile = path.join(tempDir, ".copyparty-pw");
  fs.writeFileSync(passwordFile, PW, { mode: 0o600 });
  const destinationFolder = url.slice(0, url.lastIndexOf("/") + 1);
  try {
    await execFileAsync(
      "python3",
      [
        U2C,
        "-td",
        "-a",
        `$${passwordFile}`,
        "--ow",
        "-j",
        "4",
        "--sz",
        "32",
        "--szm",
        "64",
        "-ns",
        "-ud",
        destinationFolder,
        file,
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );
  } finally {
    fs.rmSync(passwordFile, { force: true });
  }
};

const writeJson = (file, data) => {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

const ensureU2C = async () => {
  if (fs.existsSync(U2C)) return;
  if (process.env.U2C_PATH) {
    throw new Error(`U2C_PATH does not exist: ${U2C}`);
  }

  const target = path.join(ROOT, ".deps", "copyparty-pkg");
  fs.mkdirSync(target, { recursive: true });
  console.log(`Installing copyparty upload client into ${path.relative(ROOT, target)}`);
  await execFileAsync(
    "python3",
    ["-m", "pip", "install", "--quiet", "--upgrade", "--target", target, "copyparty"],
    { maxBuffer: 1024 * 1024 * 16 },
  );

  if (!fs.existsSync(U2C)) {
    throw new Error(`copyparty installed, but u2c.py was not found at ${U2C}`);
  }
};

const main = async () => {
  await ensureU2C();

  const files = await listJsonFiles();
  let totalPending = 0;
  const work = [];

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const state = { itemIndex: 0, pending: [] };
    collectOccurrences(data, file, state);
    if (state.pending.length) {
      totalPending += state.pending.length;
      work.push({ file, data, pending: state.pending });
    }
  }

  console.log(`Found ${totalPending} Catbox video URL(s) to transfer in ${work.length} JSON file(s).`);
  let done = 0;
  const failures = [];

  for (const entry of work) {
    const rel = path.relative(ROOT, entry.file);
    console.log(`\n${rel}: ${entry.pending.length} pending`);

    for (const item of entry.pending) {
      const label = `${rel} #${item.itemIndex}`;
      const existingStatus = await headStatus(item.target);
      if (/^2\d\d$/.test(existingStatus)) {
        item.set(item.target);
        writeJson(entry.file, entry.data);
        done += 1;
        console.log(`[${done}/${totalPending}] already uploaded, rewrote ${label}`);
        continue;
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "catbox-transfer-"));
      const tempFile = path.join(tempDir, `${item.itemIndex}.${extFromUrl(item.src)}`);

      try {
        console.log(`[${done + 1}/${totalPending}] downloading ${label}`);
        await download(item.src, tempFile);
        const size = fs.statSync(tempFile).size;
        if (size === 0) throw new Error("download produced an empty file");

        console.log(`[${done + 1}/${totalPending}] uploading ${label} (${size} bytes)`);
        await upload(tempFile, item.target, tempDir);

        const status = await headStatus(item.target);
        if (!/^2\d\d$/.test(status)) {
          throw new Error(`uploaded file did not verify with HEAD; got HTTP ${status || "unknown"}`);
        }

        fs.rmSync(tempFile, { force: true });
        fs.rmdirSync(tempDir);
        item.set(item.target);
        writeJson(entry.file, entry.data);
        done += 1;
        console.log(`[${done}/${totalPending}] uploaded, verified, deleted temp, rewrote ${label}`);
      } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        failures.push({
          file: rel,
          itemIndex: item.itemIndex,
          source: item.src,
          target: item.target,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`Failed on ${label}`);
        console.error(`Source: ${item.src}`);
        console.error(`Target: ${item.target}`);
        console.error(error instanceof Error ? error.message : String(error));
      }
    }
  }

  console.log(`\nDone. Transferred ${done} URL(s).`);
  if (failures.length) {
    console.error(`Failed ${failures.length} URL(s):`);
    for (const failure of failures) {
      console.error(
        `${failure.file} #${failure.itemIndex}: ${failure.source} -> ${failure.error}`,
      );
    }
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
