import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

let episodeFailure = false;
const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/anime.php") {
    const query = url.searchParams.get("q") || "";
    const failure = /failure/i.test(query);
    const discovery = /discovery/i.test(query);
    if (discovery) {
      const rows = /discovery\s+show/i.test(query)
        ? [[789, "Discovery Show", 12, "discovery-show"]]
        : [[789, "Discovery Show", 12, "discovery-show"], [790, "Discovery Show 2nd Season", 10, "discovery-show-2nd-season"]];
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<table><tbody>${rows.map(([id, title, episodes, slug]) => `<tr><td></td><td><strong>${title}</strong></td><td>TV</td><td>${episodes}</td><td><a href="/anime/${id}/${slug}">open</a></td></tr>`).join("")}</tbody></table>`);
      return;
    }
    const title = failure ? "Failure Show Season 3" : "Example Show Season 3";
    const id = failure ? 456 : 123;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<table><tbody><tr><td></td><td><strong>${title}</strong></td><td>TV</td><td>Unknown</td><td><a href="/anime/${id}/${failure ? "failure-show-season-3" : "example-show-season-3"}">open</a></td></tr></tbody></table>`);
    return;
  }
  if (url.pathname.endsWith("/episode")) {
    if (episodeFailure) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("episode page unavailable");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const finalDiscoverySeason = /\/anime\/790\//.test(url.pathname);
    const aired = finalDiscoverySeason ? 10 : 5;
    const total = finalDiscoverySeason ? 10 : "Unknown";
    res.end(`<h2>Episodes</h2><span>(${aired}/${total})</span><table><tbody>${Array.from({ length: aired }, (_, index) => index + 1).map((episode) => `<tr class="episode-list-data"><td class="episode-number nowrap" data-raw="${episode}">${episode}</td></tr>`).join("")}</tbody></table>`);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.MAL_HTML_BASE_URL = `http://127.0.0.1:${port}`;
process.env.MAL_API_BASE_URL = `http://127.0.0.1:${port}/v4`;
process.env.MAL_CACHE_FILE = join(tmpdir(), `media-manager-mal-test-${process.pid}.json`);
process.env.MAL_REQUEST_INTERVAL_MS = "250";
process.env.MAL_REQUEST_TIMEOUT_MS = "2000";

const service = await import(`./torrent-job-service.mjs?mal-test=${Date.now()}`);

function source(title, episodes) {
  return {
    title,
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

test("queues the exact missing episode from MAL's airing episode list", async () => {
  const planned = await service.buildMaintenanceWork([source("Example Show", [1, 2, 3, 4])], {
    malCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work.length, 1);
  assert.equal(planned.work[0].state, "queued");
  assert.deepEqual(planned.work[0].missingEpisodes, [5]);
  assert.deepEqual(planned.work[0].mal.knownEpisodeNumbers, [1, 2, 3, 4, 5]);
  assert.equal(planned.work[0].mal.episodeCountSource, "mal-episode-list");
});

test("does not create a torrent job for a complete airing library", async () => {
  const planned = await service.buildMaintenanceWork([source("Example Show", [1, 2, 3, 4, 5])], {
    malCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work[0].state, "skipped");
  assert.match(planned.work[0].reason, /library is complete/);
});

test("reports an explicit skip when MAL's episode page fails", async () => {
  episodeFailure = true;
  const planned = await service.buildMaintenanceWork([source("Failure Show", [1, 2, 3, 4])], {
    malCheck: true,
    addNewSeasons: false,
  });
  assert.equal(planned.work[0].state, "skipped");
  assert.match(planned.work[0].reason, /MAL aired episode list unavailable/);
  episodeFailure = false;
});

test("discovers a later MAL season from the broader title query", async () => {
  const episodes = Array.from({ length: 12 }, (_, index) => index + 1);
  const planned = await service.buildMaintenanceWork([{
    title: "Discovery Show",
    malTitle: "",
    path: "Sources/Files/Anime/Discovery.json",
    file: "Discovery.json",
    categories: [{ category: "Season 1", episodeCount: episodes.length, latestEpisode: episodes.length, episodeNumbers: episodes }],
  }], {
    malCheck: true,
    addNewSeasons: true,
  });
  const newSeason = planned.work.find((item) => item.newSeason === true);
  assert.ok(newSeason);
  assert.equal(newSeason.category, "Season 2");
  assert.deepEqual(newSeason.missingEpisodes, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.equal(newSeason.mal.malId, 790);
});
