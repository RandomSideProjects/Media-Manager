import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

let episodeFailure = false;
const schedule = (count) => Array.from({ length: count }, (_, index) => ({ airingAt: 1, episode: index + 1 }));
const media = (id, title, {
  status = "FINISHED", episodes = null, season = null, idMal = null, aired = 0,
} = {}) => ({
  id,
  idMal,
  title: { romaji: title, english: title, native: title, userPreferred: title },
  synonyms: [],
  format: "TV",
  status,
  episodes,
  nextAiringEpisode: status === "RELEASING" ? { airingAt: 2, episode: aired + 1 } : null,
  airingSchedule: { nodes: schedule(aired) },
  siteUrl: `https://anilist.co/anime/${id}`,
});

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/graphql") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  const query = String(body?.variables?.search || "");
  if (/failure/i.test(query) || episodeFailure) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "AniList unavailable" }));
    return;
  }
  let results;
  if (/discovery/i.test(query)) {
    results = [
      media(789, "Discovery Show", { episodes: 12, aired: 12, idMal: 7890 }),
      media(790, "Discovery Show 2nd Season", { episodes: 10, season: 2, aired: 10, idMal: 7900 }),
    ];
  } else {
    results = [media(123, "Example Show Season 3", { status: "RELEASING", aired: 5, idMal: 1230 })];
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { Page: { media: results } } }));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.ANILIST_API_URL = `http://127.0.0.1:${port}/graphql`;
process.env.ANILIST_CACHE_FILE = join(tmpdir(), `media-manager-anilist-test-${process.pid}.json`);
process.env.ANILIST_REQUEST_INTERVAL_MS = "1";
process.env.ANILIST_REQUEST_TIMEOUT_MS = "2000";

const service = await import(`./torrent-job-service.mjs?anilist-test=${Date.now()}`);

function source(title, episodes) {
  return {
    title,
    anilistTitle: "",
    malTitle: "",
    path: `Sources/Files/Anime/${title.replaceAll(" ", "_")}.json`,
    file: `${title.replaceAll(" ", "_")}.json`,
    categories: [{ category: "Season 3", episodeCount: episodes.length, latestEpisode: Math.max(...episodes), episodeNumbers: episodes }],
  };
}

test.after(async () => {
  server.close();
  await once(server, "close").catch(() => {});
});

test("queues the exact missing episode from AniList's aired schedule", async () => {
  const planned = await service.buildMaintenanceWork([source("Example Show", [1, 2, 3, 4])], {
    anilistCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work.length, 1);
  assert.equal(planned.work[0].state, "queued");
  assert.deepEqual(planned.work[0].missingEpisodes, [5]);
  assert.deepEqual(planned.work[0].anilist.knownEpisodeNumbers, [1, 2, 3, 4, 5]);
  assert.equal(planned.work[0].anilist.episodeCountSource, "anilist-airing-schedule");
  assert.equal(planned.work[0].anilist.anilistId, 123);
});

test("does not create a torrent job for a complete airing library", async () => {
  const planned = await service.buildMaintenanceWork([source("Example Show", [1, 2, 3, 4, 5])], {
    anilistCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work[0].state, "skipped");
  assert.match(planned.work[0].reason, /library is complete/);
});

test("reports an explicit skip when AniList is unavailable", async () => {
  episodeFailure = true;
  const planned = await service.buildMaintenanceWork([source("Failure Show", [1, 2, 3, 4])], {
    anilistCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work[0].state, "skipped");
  assert.match(planned.work[0].reason, /AniList check unavailable/);
  episodeFailure = false;
});

test("discovers a later AniList season from the broader title query", async () => {
  const episodes = Array.from({ length: 12 }, (_, index) => index + 1);
  const planned = await service.buildMaintenanceWork([{
    title: "Discovery Show",
    anilistTitle: "",
    malTitle: "",
    path: "Sources/Files/Anime/Discovery.json",
    file: "Discovery.json",
    categories: [{ category: "Season 1", episodeCount: episodes.length, latestEpisode: episodes.length, episodeNumbers: episodes }],
  }], {
    anilistCheck: true,
    addNewSeasons: true,
  });
  const newSeason = planned.work.find((item) => item.newSeason === true);
  assert.ok(newSeason);
  assert.equal(newSeason.category, "Season 2");
  assert.deepEqual(newSeason.missingEpisodes, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.equal(newSeason.anilist.anilistId, 790);
});
