import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("failure webhook sends a Discord-compatible JSON notification", async () => {
  const received = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      received.push({
        method: request.method,
        contentType: request.headers["content-type"],
        body: JSON.parse(raw),
      });
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const logDirectory = await mkdtemp(join(tmpdir(), "media-manager-webhook-test-"));
  process.env.MEDIA_MANAGER_TEST = "1";
  process.env.MEDIA_MANAGER_FAILURE_WEBHOOK_URL = `http://127.0.0.1:${address.port}/hook`;
  process.env.MEDIA_MANAGER_LOG_FILE = join(logDirectory, "maintenance.log");

  try {
    const service = await import(`./torrent-job-service.mjs?webhook-test=${randomUUID()}`);
    const result = await service.sendFailureWebhook({
      scope: "job",
      title: "Example Show",
      category: "Season 1",
      runId: "run-123",
      jobId: "job-456",
      provider: "seadex",
      message: "dual-audio validation failed",
    });
    assert.deepEqual(result, { enabled: true, sent: true, status: 204 });
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].contentType, "application/json");
    assert.equal(received[0].body.username, "Media Manager Maintenance");
    assert.match(received[0].body.content, /Example Show · Season 1/);
    assert.match(received[0].body.content, /dual-audio validation failed/);
    assert.doesNotMatch(received[0].body.content, /hook/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const log = await readFile(join(logDirectory, "maintenance.log"), "utf8");
    assert.match(log, /failure_webhook_sent/);
    assert.doesNotMatch(log, /127\.0\.0\.1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(logDirectory, { recursive: true, force: true });
  }
});

test("failure webhook content is bounded and strips control characters", async () => {
  process.env.MEDIA_MANAGER_TEST = "1";
  const service = await import(`./torrent-job-service.mjs?webhook-content-test=${randomUUID()}`);
  const content = service.failureWebhookContent({
    title: "Show\nName",
    category: "Season\t1",
    message: "x".repeat(5_000),
  });
  assert.ok(content.length <= 1_900);
  assert.doesNotMatch(content, /[\u0000-\u0008\u000b-\u001f\u007f]/);
  assert.match(content, /Show Name/);
  assert.match(content, /Season 1/);
});
