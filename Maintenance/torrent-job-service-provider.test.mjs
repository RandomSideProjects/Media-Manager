import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel><item>
    <title><![CDATA[Example Show S03E05 1080p Dual Audio]]></title>
    <link>http://nyaa.test/view/123</link>
    <nyaa:infoHash>0123456789abcdef0123456789abcdef01234567</nyaa:infoHash>
    <nyaa:seeders>12</nyaa:seeders>
    <nyaa:downloads>34</nyaa:downloads>
    <enclosure url="http://nyaa.test/download/123.torrent" />
    <pubDate>Wed, 05 Aug 2026 12:00:00 GMT</pubDate>
  </item></channel></rss>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "POST" && url.pathname === "/graphql") {
    for await (const _chunk of req) { /* consume the request body */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      data: {
        Page: {
          media: [{
            id: 9001,
            title: { romaji: "Example Show Season 3", english: "Example Show Season 3", native: "", userPreferred: "Example Show Season 3" },
            format: "TV",
            season: "SUMMER",
            seasonYear: 2026,
            episodes: 12,
          }],
        },
      },
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/releases/api/collections/entries/records") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [] }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/nyaa/") {
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(rss);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.ANILIST_API_URL = `http://127.0.0.1:${port}/graphql`;
process.env.RELEASES_BASE_URL = `http://127.0.0.1:${port}/releases`;
process.env.NYAA_BASE_URL = `http://127.0.0.1:${port}/nyaa`;
process.env.NYAA_FALLBACK_URL = `http://127.0.0.1:${port}/nyaa`;

const service = await import(`./torrent-job-service.mjs?provider-test=${Date.now()}`);

test.after(async () => {
  server.close();
  await once(server, "close").catch(() => {});
});

test("falls back from an empty SeaDex result to Nyaa RSS", async () => {
  const items = await service.releaseSearch("Example Show Season 3", "Season 3");
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, "nyaa");
  assert.equal(items[0].dualAudio, true);
  assert.equal(items[0].seeders, 12);
  assert.match(items[0].torrentUrl, /download\/123\.torrent$/);
});
