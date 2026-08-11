import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const stateRoot = await mkdtemp(join(tmpdir(), "media-manager-catalog-test-"));
const stateFile = join(stateRoot, "catalog-state.json");
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/graphql") {
    for await (const _chunk of req) { /* consume the request body */ }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      data: {
        Page: {
          media: [{
            id: 100,
            title: { romaji: "Example Show", english: "Example Show", native: "", userPreferred: "Example Show" },
            format: "TV",
            episodes: 2,
            season: "WINTER",
            seasonYear: 2026,
            coverImage: { large: "https://img.example/show.jpg", extraLarge: "" },
            relations: { edges: [] },
          }],
        },
      },
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/collections/entries/records") {
    const page = Number(url.searchParams.get("page")) || 1;
    res.writeHead(200, { "content-type": "application/json" });
    if (page > 1) {
      res.end(JSON.stringify({ page, perPage: 500, totalItems: 1, totalPages: 1, items: [] }));
      return;
    }
    res.end(JSON.stringify({
      page: 1,
      perPage: 500,
      totalItems: 1,
      totalPages: 1,
      items: [{
        id: "entry-100",
        alID: 100,
        updated: "2026-08-08T00:00:00.000Z",
        expand: {
          trs: [
            {
              infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              tracker: "Nyaa",
              isBest: true,
              dualAudio: false,
              releaseGroup: "Single",
              updated: "2026-08-08T00:00:00.000Z",
              files: [
                { name: "Example.Show.S01E01.mkv", length: 100 },
                { name: "Example.Show.S01E02.mkv", length: 200 },
              ],
            },
            {
              infoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              tracker: "Nyaa",
              isBest: false,
              dualAudio: true,
              releaseGroup: "Dual",
              updated: "2026-08-07T00:00:00.000Z",
              files: [
                { name: "Example.Show.S01E01.mkv", length: 300 },
                { name: "Example.Show.S01E02.mkv", length: 400 },
              ],
            },
          ],
        },
      }],
    }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
process.env.MEDIA_MANAGER_TEST = "1";
process.env.MEDIA_MANAGER_ROOT = stateRoot;
process.env.MEDIA_MANAGER_CATALOG_STATE_FILE = stateFile;
process.env.RELEASES_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANILIST_API_URL = `http://127.0.0.1:${port}/graphql`;

const service = await import(`./torrent-job-service.mjs?catalog-test=${process.pid}`);

const movieSourcePath = "Sources/Files/Anime/Movie_Show.json";
await mkdir(join(stateRoot, "Sources", "Files", "Anime"), { recursive: true });
await writeFile(join(stateRoot, movieSourcePath), `${JSON.stringify({
  title: "Movie Show",
  categories: [{ category: "Movie", episodes: [{ title: "Movie", src: "https://old/movie.mp4", dualAudio: false }] }],
}, null, 2)}\n`);

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(stateRoot, { recursive: true, force: true });
});

test("catalog scan prefers dual audio over an isBest single-audio release", async () => {
  const summary = await service.scanCatalog();
  assert.equal(summary.total, 1);
  assert.equal(summary.dualAudio, 1);
  const stored = JSON.parse(await readFile(stateFile, "utf8"));
  const entry = stored.entries["al:100"];
  assert.equal(entry.preferredReleaseHash, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(entry.preferredDualAudio, true);
  assert.deepEqual(entry.preferredRelease.episodes, [1, 2]);
});

test("catalog work targets only non-dual episodes of an existing season", async () => {
  const sources = [{
    file: "Example_Show.json",
    path: "Sources/Files/Anime/Example_Show.json",
    title: "Example Show",
    malTitle: "Example Show",
    anilistIds: [100],
    categories: [{
      category: "Season 1",
      episodeNumbers: [1, 2],
      nonDualEpisodeNumbers: [1],
      dualAudio: false,
    }],
  }];
  const planned = await service.buildCatalogMaintenanceWork(sources, {});
  assert.equal(planned.items.length, 1);
  assert.equal(planned.items[0].maintenanceAction, "update");
  assert.deepEqual(planned.items[0].missingEpisodes, [1]);
  assert.deepEqual(planned.items[0].release.targetEpisodes, [1]);
  assert.equal(planned.items[0].catalog.preferredDualAudio, true);
});

test("catalog work never replaces a fully dual-audio season", async () => {
  const sources = [{
    file: "Example_Show.json",
    path: "Sources/Files/Anime/Example_Show.json",
    title: "Example Show",
    malTitle: "Example Show",
    anilistIds: [100],
    categories: [{
      category: "Season 1",
      episodeNumbers: [1, 2],
      nonDualEpisodeNumbers: [],
      dualAudio: true,
    }],
  }];
  const planned = await service.buildCatalogMaintenanceWork(sources, {});
  assert.equal(planned.items.length, 0);
});

test("new-show mode ignores catalog entries already attached to a source", async () => {
  const sources = [{
    file: "Example_Show.json",
    path: "Sources/Files/Anime/Example_Show.json",
    title: "Example Show",
    anilistIds: [100],
    categories: [{ category: "Season 1", episodeNumbers: [], nonDualEpisodeNumbers: [] }],
  }];
  const planned = await service.buildCatalogMaintenanceWork(sources, { newShowsOnly: true });
  assert.equal(planned.items.length, 0);
});

test("movie promotions replace the existing item and never downgrade confirmed dual audio", async () => {
  const replacement = await service.applyMaintenance({
    action: "update",
    sourcePath: movieSourcePath,
    categoryName: "Movie",
    mediaFormat: "MOVIE",
    targetEpisodes: [1],
    replaceExisting: true,
    addMissing: true,
    dualAudio: true,
  }, [{ remotePath: "Movie Show.mp4", url: "https://new/movie.mp4", sizeBytes: 200, durationSeconds: 90 }]);
  assert.equal(replacement.replaced, 1);
  assert.equal(replacement.added, 0);
  let manifest = JSON.parse(await readFile(join(stateRoot, movieSourcePath), "utf8"));
  assert.equal(manifest.categories[0].episodes.length, 1);
  assert.equal(manifest.categories[0].episodes[0].src, "https://new/movie.mp4");
  assert.equal(manifest.categories[0].episodes[0].dualAudio, true);

  const downgrade = await service.applyMaintenance({
    action: "update",
    sourcePath: movieSourcePath,
    categoryName: "Movie",
    mediaFormat: "MOVIE",
    targetEpisodes: [1],
    replaceExisting: true,
    addMissing: true,
    dualAudio: false,
  }, [{ remotePath: "Movie Show.mp4", url: "https://single/movie.mp4" }]);
  assert.equal(downgrade.replaced, 0);
  assert.equal(downgrade.skipped, 1);
  manifest = JSON.parse(await readFile(join(stateRoot, movieSourcePath), "utf8"));
  assert.equal(manifest.categories[0].episodes[0].src, "https://new/movie.mp4");
  assert.equal(manifest.categories[0].episodes[0].dualAudio, true);
});
