import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const requests = [];
const githubMock = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  requests.push({ method: req.method, url, authorization: req.headers.authorization, body: "" });
  const request = requests.at(-1);
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sha: "old-content-sha" }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  request.body = JSON.parse(body);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    content: { sha: "new-content-sha" },
    commit: { sha: "commit-sha", html_url: "https://github.com/owner/repo/commit/commit-sha" },
  }));
});

await new Promise((resolve) => githubMock.listen(0, "127.0.0.1", resolve));
const mockPort = githubMock.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.MEDIA_MANAGER_TEST_GITHUB = "1";
process.env.MEDIA_MANAGER_GITHUB_TOKEN = "test-token";
process.env.MEDIA_MANAGER_GITHUB_API_URL = `http://127.0.0.1:${mockPort}`;
process.env.MEDIA_MANAGER_GITHUB_REPOSITORY = "owner/repo";
process.env.MEDIA_MANAGER_GITHUB_BRANCH = "main";
process.env.MEDIA_MANAGER_LOG_FILE = join(tmpdir(), `media-manager-github-test-${process.pid}.log`);

const { cleanupJobCache, publishSourceToGithub } = await import(`./torrent-job-service.mjs?github-test=${process.pid}`);

after(async () => {
  await new Promise((resolve, reject) => githubMock.close((error) => error ? reject(error) : resolve()));
});

test("publishes a source manifest through the GitHub Contents API", async () => {
  const content = '{"title":"Example"}\n';
  const result = await publishSourceToGithub("Sources/Files/Anime/Example.json", content, {
    title: "Example",
    category: "Season 1",
  });

  assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT"]);
  assert.equal(requests[0].url.pathname, "/repos/owner/repo/contents/Sources/Files/Anime/Example.json");
  assert.equal(requests[0].url.searchParams.get("ref"), "main");
  assert.equal(requests[1].authorization, "Bearer test-token");
  assert.equal(requests[1].body.branch, "main");
  assert.equal(requests[1].body.sha, "old-content-sha");
  assert.equal(Buffer.from(requests[1].body.content, "base64").toString("utf8"), content);
  assert.match(requests[1].body.message, /^maintenance: update Example/);
  assert.equal(result.provider, "github");
  assert.equal(result.commitSha, "commit-sha");
  assert.equal(result.contentSha, "new-content-sha");
});

test("removes the complete per-job cache after success", async () => {
  const root = await mkdtemp(join(tmpdir(), "media-manager-cache-test-"));
  const cachePath = join(root, "job");
  await mkdir(cachePath, { recursive: true });
  await writeFile(join(cachePath, "source.mkv"), "temporary", "utf8");
  const job = { id: "job", runId: "run", cacheDir: cachePath };

  const result = await cleanupJobCache(job);

  assert.equal(result.state, "removed");
  assert.equal(job.cleanup.state, "removed");
  await assert.rejects(access(cachePath), { code: "ENOENT" });
});
