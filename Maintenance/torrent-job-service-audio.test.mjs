import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "media-manager-audio-test-"));
const sourcePath = "Sources/Files/Anime/Audio_Show.json";
const sourceDirectory = join(root, "Sources", "Files", "Anime");
const tdPath = join(root, "fake-td.mjs");
const ffprobePath = join(root, "fake-ffprobe.mjs");
await mkdir(sourceDirectory, { recursive: true });
await writeFile(join(root, sourcePath), `${JSON.stringify({
  title: "Audio Show",
  categories: [{ category: "Season 1", episodes: [{ title: "Episode 01", src: "https://old/episode-1.mp4", dualAudio: false }] }],
}, null, 2)}\n`);
await writeFile(tdPath, [
  "#!/usr/bin/env node",
  "import { mkdir, writeFile } from 'node:fs/promises';",
  "import { join } from 'node:path';",
  "const cacheDirectory = process.argv[process.argv.indexOf('--cache-dir') + 1];",
  "await mkdir(join(cacheDirectory, 'release'), { recursive: true });",
  "await writeFile(join(cacheDirectory, 'release', 'episode.mkv'), 'media');",
  "process.stdout.write(JSON.stringify({ event: 'metadata' }) + '\\n');",
  "process.stdout.write(JSON.stringify({ event: 'file_result', outcome: 'uploaded', remotePath: 'Audio Show/Season 1/S01E01.mp4', localPath: 'release/episode.mkv' }) + '\\n');",
  "process.stdout.write(JSON.stringify({ event: 'link', remotePath: 'Audio Show/Season 1/S01E01.mp4', url: 'https://new/episode-1.mp4' }) + '\\n');",
].join("\n"), { mode: 0o755 });
await chmod(tdPath, 0o755);
await writeFile(ffprobePath, [
  "#!/usr/bin/env node",
  "import { existsSync } from 'node:fs';",
  "const count = Math.max(0, Number(process.env.TEST_AUDIO_STREAMS || 0));",
  "const input = process.argv.at(-1);",
  "const available = existsSync(input) ? count : 0;",
  "process.stdout.write(Array.from({ length: available }, (_, index) => String(index)).join('\\n') + (available ? '\\n' : ''));",
].join("\n"), { mode: 0o755 });
await chmod(ffprobePath, 0o755);

process.env.MEDIA_MANAGER_TEST = "1";
process.env.MEDIA_MANAGER_ROOT = root;
process.env.TD_BIN = tdPath;
process.env.FFPROBE_BIN = ffprobePath;
process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY = "0";
process.env.MEDIA_MANAGER_LOG_FILE = join(root, "maintenance.log");
process.env.MEDIA_MANAGER_RESUME_FILE = join(root, "resume-state.json");
process.env.MEDIA_MANAGER_CATALOG_STATE_FILE = join(root, "catalog-state.json");

const service = await import(`./torrent-job-service.mjs?audio-test=${Date.now()}`);

test.after(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function runFor(itemId) {
  return {
    id: `run-${itemId}`,
    cancelled: false,
    items: [],
    active: [],
    activeJobIds: [],
    current: null,
    currentJobId: null,
    events: [],
    failed: 0,
    completed: 0,
    skipped: 0,
  };
}

function itemFor(id) {
  return {
    id,
    sourcePath,
    sourceFile: "Audio_Show.json",
    title: "Audio Show",
    category: "Season 1",
    state: "queued",
    missingEpisodes: [1],
    releases: [{
      provider: "seadex",
      title: "Audio Show Season 1 Dual Audio",
      magnet: "magnet:?xt=urn:btih:audio",
      targetEpisodes: [1],
      dualAudio: true,
    }],
  };
}

test("dual-audio publication requires two probed audio streams", async () => {
  process.env.TEST_AUDIO_STREAMS = "2";
  const item = itemFor("dual-success");
  const run = runFor(item.id);
  await service.processMaintenanceItem(run, item, { replaceExisting: true, addMissing: true, torrentConcurrency: 1 });
  assert.equal(item.state, "complete");
  const manifest = JSON.parse(await readFile(join(root, sourcePath), "utf8"));
  assert.equal(manifest.categories[0].episodes[0].dualAudio, true);
  assert.equal(manifest.categories[0].episodes[0].src, "https://new/episode-1.mp4");
});

test("a falsely labeled one-track dual release fails before manifest publication", async () => {
  process.env.TEST_AUDIO_STREAMS = "1";
  const item = itemFor("dual-failure");
  const run = runFor(item.id);
  await service.processMaintenanceItem(run, item, { replaceExisting: true, addMissing: true, torrentConcurrency: 1 });
  assert.equal(item.state, "failed");
  assert.equal(run.failed, 1);
  const manifest = JSON.parse(await readFile(join(root, sourcePath), "utf8"));
  assert.equal(manifest.categories[0].episodes[0].dualAudio, true);
  assert.equal(manifest.categories[0].episodes[0].src, "https://new/episode-1.mp4");
});
