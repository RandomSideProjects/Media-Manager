import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "media-manager-concurrency-"));
const sourceDirectory = join(root, "Sources", "Files", "Anime");
const sourcePath = "Sources/Files/Anime/Example_Show.json";
const manifestPath = join(root, sourcePath);
const tracePath = join(root, "td-trace.log");
const tdPath = join(root, "fake-td.mjs");
await mkdir(sourceDirectory, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify({
  title: "Example Show",
  categories: [{
    category: "Season 3",
    episodes: [1, 2, 3, 4].map((episode) => ({ title: `Episode ${String(episode).padStart(2, "0")}`, src: `https://old/${episode}.mp4` })),
  }],
}, null, 2)}\n`);
const fakeTd = [
  "#!/usr/bin/env node",
  "import { access, appendFile, mkdir, writeFile } from \"node:fs/promises\";",
  "import { join } from \"node:path\";",
  "const source = process.argv.find((argument) => argument.includes(\"episode\")) || \"episode0\";",
  "const episode = Number(source.match(/episode(\\d+)/)?.[1] || 0);",
  "const cacheDirectory = process.argv[process.argv.indexOf(\"--cache-dir\") + 1];",
  "const localDirectory = join(cacheDirectory, \"release\");",
  "await mkdir(localDirectory, { recursive: true });",
  "await writeFile(join(localDirectory, \"episode\" + episode + \".mkv\"), \"source\");",
  "await writeFile(join(localDirectory, \"episode\" + episode + \".mp4\"), \"recode\");",
  "await appendFile(process.env.TEST_TRACE_FILE, \"args \" + process.argv.slice(2).join(\" \") + \"\\n\");",
  "await appendFile(process.env.TEST_TRACE_FILE, \"start \" + episode + \"\\n\");",
  "await new Promise((resolve) => setTimeout(resolve, 300));",
  "process.stdout.write(JSON.stringify({ event: \"metadata\" }) + \"\\n\");",
  "process.stdout.write(JSON.stringify({ event: \"file_result\", outcome: \"uploaded\", localPath: \"release/episode\" + episode + \".mkv\", remotePath: \"Example Show/Season 3/S03E\" + String(episode).padStart(2, \"0\") + \".mp4\" }) + \"\\n\");",
  "await new Promise((resolve) => setTimeout(resolve, 100));",
  "const sourceExists = await access(join(localDirectory, \"episode\" + episode + \".mkv\")).then(() => 1, () => 0);",
  "const recodeExists = await access(join(localDirectory, \"episode\" + episode + \".mp4\")).then(() => 1, () => 0);",
  "await appendFile(process.env.TEST_TRACE_FILE, \"after-upload \" + episode + \" source=\" + sourceExists + \" recode=\" + recodeExists + \"\\n\");",
  "process.stdout.write(JSON.stringify({ event: \"link\", remotePath: \"Example Show/Season 3/S03E\" + String(episode).padStart(2, \"0\") + \".mp4\", url: \"https://new/\" + episode + \".mp4\" }) + \"\\n\");",
  "await appendFile(process.env.TEST_TRACE_FILE, \"finish \" + episode + \"\\n\");",
  "",
].join("\n");
await writeFile(tdPath, fakeTd, { mode: 0o755 });
await chmod(tdPath, 0o755);

process.env.MEDIA_MANAGER_TEST = "1";
process.env.MEDIA_MANAGER_ROOT = root;
process.env.TD_BIN = tdPath;
process.env.TEST_TRACE_FILE = tracePath;
process.env.MEDIA_MANAGER_LOG_FILE = join(root, "maintenance.log");
process.env.MEDIA_MANAGER_RESUME_FILE = join(root, "resume-state.json");

const service = await import(`./torrent-job-service.mjs?concurrency-test=${Date.now()}`);

test.after(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("overlaps torrent transfers while serializing manifest writes", async () => {
  const item = {
    id: "maintenance-item",
    sourcePath,
    sourceFile: "Example_Show.json",
    title: "Example Show",
    malTitle: "",
    category: "Season 3",
    state: "queued",
    missingEpisodes: [5, 6, 7],
    releases: [5, 6, 7].map((episode) => ({
      provider: "nyaa",
      title: `Example Show S03E${String(episode).padStart(2, "0")}`,
      magnet: `magnet:?xt=urn:btih:episode${episode}`,
      targetEpisodes: [episode],
      dualAudio: false,
    })),
  };
  const run = {
    id: "maintenance-run",
    cancelled: false,
    items: [item],
    active: [],
    activeJobIds: [],
    current: null,
    currentJobId: null,
    events: [],
    failed: 0,
    completed: 0,
    skipped: 0,
  };

  await service.processMaintenanceItem(run, item, {
    replaceExisting: true,
    addMissing: true,
    torrentConcurrency: 3,
  });

  assert.equal(item.state, "complete");
  assert.equal(run.failed, 0);
  assert.equal(item.links, 3);
  assert.deepEqual(item.releaseStates.map((release) => release.state), ["complete", "complete", "complete"]);
  assert.deepEqual(item.jobIds, []);

  const trace = (await readFile(tracePath, "utf8")).trim().split(/\r?\n/);
  const args = trace.filter((line) => line.startsWith("args "));
  assert.equal(args.length, 3);
  assert.ok(args.every((line) => !line.includes("--download-all")));
  assert.ok(args.some((line) => line.includes("--only-episodes 5")));
  assert.ok(args.some((line) => line.includes("--only-episodes 6")));
  assert.ok(args.some((line) => line.includes("--only-episodes 7")));
  assert.deepEqual(trace.filter((line) => line.startsWith("after-upload ")).sort(), [
    "after-upload 5 source=0 recode=0",
    "after-upload 6 source=0 recode=0",
    "after-upload 7 source=0 recode=0",
  ]);
  const lifecycle = trace.filter((line) => /^(start|finish) /.test(line));
  assert.equal(lifecycle.filter((line) => line.startsWith("start ")).length, 3);
  assert.equal(lifecycle.filter((line) => line.startsWith("finish ")).length, 3);
  const firstFinish = lifecycle.findIndex((line) => line.startsWith("finish "));
  assert.equal(lifecycle.slice(0, firstFinish).filter((line) => line.startsWith("start ")).length, 3);
  assert.deepEqual(new Set(lifecycle), new Set([
    "start 5", "finish 5", "start 6", "finish 6", "start 7", "finish 7",
  ]));

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const episodes = manifest.categories[0].episodes.map((episode) => Number(episode.title.match(/\d+/)?.[0]));
  assert.deepEqual(episodes, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(manifest.categories[0].episodes.slice(-3).map((episode) => episode.src), [
    "https://new/5.mp4",
    "https://new/6.mp4",
    "https://new/7.mp4",
  ]);
});

test("allows manually submitted jobs to share the transfer slots and cleans stopped jobs", async () => {
  await writeFile(tracePath, "");
  const first = await service.startJob({
    magnet: "magnet:?xt=urn:btih:episode8",
    destination: "Example Show/Season 3",
  });
  const second = await service.startJob({
    magnet: "magnet:?xt=urn:btih:episode9",
    destination: "Example Show/Season 3",
  });
  const results = await Promise.all([first.done, second.done]);
  assert.deepEqual(results.map((job) => job.state), ["complete", "complete"]);
  const trace = (await readFile(tracePath, "utf8")).trim().split(/\r?\n/);
  const lifecycle = trace.filter((line) => /^(start|finish) /.test(line));
  assert.deepEqual(new Set(lifecycle), new Set(["start 8", "finish 8", "start 9", "finish 9"]));
  assert.equal(lifecycle.slice(0, lifecycle.findIndex((line) => line.startsWith("finish "))).filter((line) => line.startsWith("start ")).length, 2);
  assert.equal(first.cleanup.state, "removed");
  assert.equal(second.cleanup.state, "removed");
  await assert.rejects(access(first.cacheDir));
  await assert.rejects(access(second.cacheDir));

  const stopped = await service.startJob({
    magnet: "magnet:?xt=urn:btih:episode10",
    destination: "Example Show/Season 3",
  });
  stopped.stop();
  const stoppedResult = await stopped.done;
  assert.equal(stoppedResult.state, "cancelled");
  assert.equal(stoppedResult.cleanup.state, "removed");
  await assert.rejects(access(stopped.cacheDir));
});
