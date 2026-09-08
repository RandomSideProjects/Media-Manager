import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/graphql") {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({
      errors: [{ message: "The AniList API has been temporarily disabled due to severe stability issues.", status: 403 }],
      data: null,
    }));
    return;
  }
  if (req.method === "GET" && String(req.url).startsWith("/api/collections/entries/records?")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [{ id: "release-1", alID: 123, updated: "2026-09-08T00:00:00Z", expand: { trs: [] } }], totalPages: 1, totalItems: 1 }));
    return;
  }
  if (req.method === "GET" && String(req.url).startsWith("/api/edge/mappings?")) {
    res.writeHead(200, { "content-type": "application/vnd.api+json" });
    res.end(JSON.stringify({
      data: [{
        id: "mapping-1",
        type: "mappings",
        attributes: { externalSite: "anilist/anime", externalId: "123" },
        relationships: { item: { data: { type: "anime", id: "kitsu-1" } } },
      }],
      included: [{
        id: "kitsu-1",
        type: "anime",
        attributes: {
          canonicalTitle: "Fallback Show",
          titles: { en: "Fallback Show", en_jp: "Fallback Show" },
          subtype: "TV",
          status: "finished",
          episodeCount: 12,
          posterImage: { large: "https://example.test/poster.jpg" },
        },
      }],
    }));
    return;
  }
  if (req.method === "GET" && String(req.url).startsWith("/api/edge/anime?")) {
    res.writeHead(200, { "content-type": "application/vnd.api+json" });
    res.end(JSON.stringify({
      data: [{
        id: "50117",
        type: "anime",
        attributes: {
          canonicalTitle: "Isekai Nonbiri Nouka 2",
          titles: { en: "Farming Life in Another World 2", en_jp: "Isekai Nonbiri Nouka 2" },
          abbreviatedTitles: [],
          subtype: "TV",
          status: "finished",
          episodeCount: 12,
        },
      }],
      meta: { count: 1 },
    }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.ANILIST_API_URL = `http://127.0.0.1:${port}/graphql`;
process.env.KITSU_API_URL = `http://127.0.0.1:${port}/api/edge`;
process.env.ANILIST_CACHE_FILE = join(tmpdir(), `media-manager-kitsu-anilist-${process.pid}.json`);
process.env.KITSU_CACHE_FILE = join(tmpdir(), `media-manager-kitsu-${process.pid}.json`);
process.env.KITSU_CATALOG_CACHE_FILE = join(tmpdir(), `media-manager-kitsu-catalog-${process.pid}.json`);
process.env.MEDIA_MANAGER_CATALOG_STATE_FILE = join(tmpdir(), `media-manager-kitsu-catalog-state-${process.pid}.json`);
process.env.RELEASES_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANILIST_REQUEST_INTERVAL_MS = "1";
process.env.KITSU_REQUEST_INTERVAL_MS = "250";

const service = await import(`./torrent-job-service.mjs?kitsu-test=${Date.now()}`);

test.after(async () => {
  server.close();
  await once(server, "close").catch(() => {});
});

test("falls back to Kitsu when AniList is unavailable", async () => {
  const planned = await service.buildMaintenanceWork([{
    title: "Farming Life in Another World",
    malTitle: "",
    anilistTitle: "",
    path: "Sources/Files/Anime/Farming_Life_In_Another_World.json",
    file: "Farming_Life_In_Another_World.json",
    categories: [{
      category: "Season 2",
      episodeCount: 11,
      latestEpisode: 11,
      episodeNumbers: Array.from({ length: 11 }, (_, index) => index + 1),
    }],
  }], { anilistCheck: true, addNewSeasons: false });

  assert.equal(planned.work.length, 1);
  assert.equal(planned.work[0].state, "queued");
  assert.deepEqual(planned.work[0].missingEpisodes, [12]);
  assert.equal(planned.work[0].anilist.metadataProvider, "kitsu");
  assert.equal(planned.work[0].anilist.kitsuId, "50117");
  assert.equal(planned.work[0].anilist.episodeCountSource, "kitsu-total");
});

test("uses Kitsu AniList-ID mappings for catalog scans", async () => {
  const summary = await service.scanCatalog();
  assert.equal(summary.lastScanProvider, "kitsu");
  assert.equal(summary.total, 1);
  assert.equal(summary.tv, 1);
  assert.match(summary.lastScanError, /AniList unavailable; Kitsu fallback mapped 1 of 1/);
});
