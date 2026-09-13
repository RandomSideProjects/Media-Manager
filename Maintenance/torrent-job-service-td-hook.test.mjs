import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "media-manager-td-hook-"));
const fakeBin = join(root, "bin");
const inputPath = join(root, "sample file's name.mkv");
await mkdir(fakeBin, { recursive: true });
await writeFile(inputPath, "media");

// The compatibility script should be able to run without invoking ffmpeg when
// ffprobe reports a browser-compatible file. Keep this test independent of the
// host's installed media tool versions.
const fakeFfprobe = join(fakeBin, "ffprobe");
await writeFile(fakeFfprobe, `#!/bin/sh
case "$*" in
  *"-select_streams v:0"*) printf 'codec_name=h264\\npix_fmt=yuv420p\\n' ;;
  *"-select_streams a"*) printf 'aac\\n' ;;
  *) : ;;
esac
`);
await chmod(fakeFfprobe, 0o755);

process.env.MEDIA_MANAGER_TEST = "1";
process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY = "1";
process.env.MEDIA_MANAGER_BROWSER_COMPATIBILITY_SCRIPT = "/tmp/reencode'script with spaces.sh";
const service = await import(`./torrent-job-service.mjs?td-hook-test=${Date.now()}`);

test.after(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("td after-download hook passes td's {local} path to the compatibility script", () => {
  const args = service.tdAttemptArgs({
    source: "magnet:?xt=urn:btih:test",
    destination: "Example Show/Season 1",
    cacheDir: "/tmp/media-manager-cache",
    maintenance: {},
  }, {});
  const hookIndex = args.indexOf("--cmd-after-dl");
  assert.notEqual(hookIndex, -1);
  assert.equal(args[hookIndex + 1], "bash '/tmp/reencode'\\''script with spaces.sh' \"{local}\"");
  assert.equal(args[hookIndex + 2], "--exit-behavior-after");
  assert.equal(args[hookIndex + 3], "err");
});

test("browser compatibility hook accepts a local path containing shell characters", async () => {
  const result = await execFile("bash", [
    join(process.cwd(), "Maintenance", "browser-compatible-reencode.sh"),
    inputPath,
  ], {
    env: {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`,
    },
  });
  assert.equal(result.stderr, "");
});
