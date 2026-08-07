import test from "node:test";
import assert from "node:assert/strict";

process.env.MEDIA_MANAGER_TEST = "1";
const service = await import(`./torrent-job-service.mjs?test=${Date.now()}`);

test("parses MAL airing episode progress", () => {
  const html = `
    <h2 class="h2_overwrite">Episodes</h2><span class="di-ib pl4 fw-n fs10">(4/Unknown)</span>
    <table class="episode_list"><tbody>
      <tr class="episode-list-data"><td class="episode-number nowrap" data-raw="1">1</td></tr>
      <tr class="episode-list-data"><td class="episode-number nowrap" data-raw="2">2</td></tr>
      <tr class="episode-list-data"><td class="episode-number nowrap" data-raw="3">3</td></tr>
      <tr class="episode-list-data"><td class="episode-number nowrap" data-raw="4">4</td></tr>
    </tbody></table>`;
  assert.deepEqual(service.parseMalEpisodeProgress(html), {
    airedEpisodes: 4,
    knownEpisodeNumbers: [1, 2, 3, 4],
    episodeCountSource: "mal-episode-list",
    airing: true,
  });
});

test("recognizes a completed MAL episode list as final", () => {
  const html = `
    <h2>Episodes</h2><span>(19/19)</span>
    <table class="episode_list"><tbody>
      <tr class="episode-list-data"><td class="episode-number" data-raw="19">19</td></tr>
    </tbody></table>`;
  assert.equal(service.parseMalEpisodeProgress(html).airing, false);
});

test("computes only the MAL episodes missing from the library", () => {
  const category = { episodeNumbers: [1, 2, 3, 4], episodeCount: 4 };
  assert.deepEqual(service.missingEpisodesForCategory(category, 5), { known: true, missing: [5] });
  assert.deepEqual(service.missingEpisodesForCategory(category, null, [1, 2, 3, 4, 5]), { known: true, missing: [5] });
  assert.deepEqual(service.missingEpisodesForCategory(category, null, [1, 2, 3, 4]), { known: true, missing: [] });
});

test("prefers a matching season batch and rejects another season", () => {
  const source = { title: "The 100 Girlfriends Who Really Really Really Really Really Love You" };
  const batch = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "The 100 Girlfriends Who Really Really Really Really Really Love You Season 3 batch",
    magnet: "magnet:?xt=urn:btih:batch",
  }, source, "Season 3", [5, 6]);
  const wrongSeason = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "The 100 Girlfriends Who Really Really Really Really Really Love You S02E05",
    magnet: "magnet:?xt=urn:btih:wrong",
  }, source, "Season 3", [5]);
  assert.deepEqual(batch.coveredEpisodes, [5, 6]);
  assert.equal(wrongSeason, null);
});

test("rejects a standalone release with an unseasoned episode number", () => {
  const candidate = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "[SubsPlease] Re Zero kara Hajimeru Isekai Seikatsu - 77 (720p) [E00DF851].mkv",
    magnet: "magnet:?xt=urn:btih:wrong-episode",
  }, { title: "Re: Zero" }, "Season 4", [12]);
  assert.equal(candidate, null);
  assert.deepEqual(service.releaseCoverage(
    { title: "[SubsPlease] Re Zero kara Hajimeru Isekai Seikatsu - 77 (720p) [E00DF851].mkv" },
    "Season 4",
  ).episodes, [77]);
});

test("does not treat a season volume as a complete-season torrent", () => {
  const candidate = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "[PMR] Re ZERO Starting Life in Another World Season 4 Vol.1 JPN",
    magnet: "magnet:?xt=urn:btih:volume-1",
  }, { title: "Re: Zero" }, "Season 4", [12]);
  assert.equal(candidate, null);
  assert.equal(service.releaseCoverage({
    title: "[PMR] Re ZERO Starting Life in Another World Season 4 Vol.1 JPN",
  }, "Season 4").batchLike, false);
});

test("keeps SeaDex media and torrent seasons aligned", () => {
  assert.equal(service.mediaMatchesRequestedSeason({
    title: { english: "Re:ZERO -Starting Life in Another World-" },
  }, "Season 4"), false);
  assert.equal(service.mediaMatchesRequestedSeason({
    title: { english: "Re:ZERO -Starting Life in Another World- Season 4" },
  }, "Season 4"), true);
  assert.equal(service.seaDexTorrentToItem({
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    files: [{ name: "Re ZERO - S01E12.mkv" }],
  }, { alID: 189046 }, { title: { english: "Re:ZERO" } }, "Season 4"), null);
});

test("accepts a single torrent for one missing episode", () => {
  const candidate = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "The 100 Girlfriends Who Really Really Really Really Really Love You S03E05 1080p",
    magnet: "magnet:?xt=urn:btih:episode5",
  }, { title: "The 100 Girlfriends Who Really Really Really Really Really Love You" }, "Season 3", [5]);
  assert.deepEqual(candidate.coveredEpisodes, [5]);
});

test("recognizes dual-audio single episodes with a season suffix", () => {
  const candidate = service.rankIndividualReleaseCandidate({
    provider: "nyaa",
    title: "Example Show S03E05 1080p Dual Audio (Example Show Season 3)",
    dualAudio: true,
    magnet: "magnet:?xt=urn:btih:dual-season-suffix",
  }, { title: "Example Show" }, "Season 3", 5);
  assert.deepEqual(candidate?.coveredEpisodes, [5]);
});

test("requires dual audio when an eligible dual-audio release exists", () => {
  const source = { title: "Example Show" };
  const nonDual = service.rankReleaseCandidate({
    provider: "nyaa",
    title: "Example Show S03E05 1080p",
    seeders: 999,
    magnet: "magnet:?xt=urn:btih:nondual",
  }, source, "Season 3", [5]);
  const dual = service.rankReleaseCandidate({
    provider: "seadex",
    title: "Example Show S03E05 1080p Dual Audio",
    dualAudio: true,
    seeders: 1,
    magnet: "magnet:?xt=urn:btih:dual",
  }, source, "Season 3", [5]);
  assert.equal(nonDual?.dualAudio, false);
  assert.equal(dual?.dualAudio, true);
  assert.equal(service.betterReleaseCandidate(dual, nonDual), true);
  assert.equal(service.betterReleaseCandidate(nonDual, dual), false);
});

test("prefers the faster eligible dual-audio release", () => {
  const source = { title: "Example Show" };
  const slow = service.rankIndividualReleaseCandidate({
    provider: "nyaa",
    title: "Example Show S03E05 1080p Dual Audio",
    dualAudio: true,
    seeders: 0,
    magnet: "magnet:?xt=urn:btih:slow",
  }, source, "Season 3", 5);
  const fast = service.rankIndividualReleaseCandidate({
    provider: "nyaa",
    title: "Example Show S03E05 1080p Dual Audio",
    dualAudio: true,
    seeders: 8,
    magnet: "magnet:?xt=urn:btih:fast",
  }, source, "Season 3", 5);
  assert.equal(service.betterReleaseCandidate(fast, slow), true);
  assert.equal(service.betterReleaseCandidate(slow, fast), false);
});

test("adds a compact title query for censored release titles", () => {
  const queries = service.releaseSearchQueries(
    { title: "Watari-kun's ****** Is About To Collapse" },
    "Season 1",
    [15],
  );
  assert.ok(queries.includes("Watari-kun About S01E15"));
});

test("recognizes a standalone episode torrent and rejects a batch for per-episode mode", () => {
  const source = { title: "Example Show" };
  const single = service.rankIndividualReleaseCandidate({
    provider: "nyaa",
    title: "Example Show S03E05 1080p Dual Audio",
    dualAudio: true,
    magnet: "magnet:?xt=urn:btih:single",
  }, source, "Season 3", 5);
  const batch = service.rankIndividualReleaseCandidate({
    provider: "seadex",
    title: "Example Show Season 3 batch Dual Audio",
    dualAudio: true,
    magnet: "magnet:?xt=urn:btih:batch",
  }, source, "Season 3", 5);
  assert.deepEqual(single?.coveredEpisodes, [5]);
  assert.equal(batch, null);
});

test("splits a batch fallback into one target episode per torrent job", () => {
  const candidate = service.rankReleaseCandidate({
    provider: "seadex",
    title: "Example Show Season 3 batch Dual Audio",
    dualAudio: true,
    magnet: "magnet:?xt=urn:btih:batch",
  }, { title: "Example Show" }, "Season 3", [5, 6]);
  const plan = service.splitReleasePlanByEpisode(candidate, "Example Show Season 3", [5, 6], "Season 3");
  assert.deepEqual(plan.map((release) => release.targetEpisodes), [[5], [6]]);
  assert.deepEqual(plan.map((release) => release.magnet), ["magnet:?xt=urn:btih:batch", "magnet:?xt=urn:btih:batch"]);
});

test("limits manifest artifacts to the selected missing episode", () => {
  const artifacts = service.selectArtifacts([
    { remotePath: "Show/S03E04.mp4", url: "https://example.test/4.mp4" },
    { remotePath: "Show/S03E05.mp4", url: "https://example.test/5.mp4" },
  ], { categoryName: "Season 3", seasonNumber: 3, targetEpisodes: [5] }, [
    { title: "Episode 04" },
  ]);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].episode, 5);
});

test("accepts season-specific files that use S01 numbering inside a later-season folder", () => {
  const artifacts = service.selectArtifacts([
    { remotePath: "Show/Season 2/Show - S01E01.mp4", url: "https://example.test/season-2-episode-1.mp4" },
  ], { categoryName: "Season 2", seasonNumber: 2, targetEpisodes: [1] });
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].episode, 1);
});

test("assigns episode-less artifacts without duplicating an already parsed episode", () => {
  const artifacts = service.selectArtifacts([
    { remotePath: "Show/S03E05.mp4", url: "https://example.test/5.mp4" },
    { remotePath: "Show/part-without-number.mp4", url: "https://example.test/6.mp4" },
  ], { categoryName: "Season 3", seasonNumber: 3, targetEpisodes: [5, 6] });
  assert.deepEqual(artifacts.map((artifact) => artifact.episode), [5, 6]);
});

test("serializes the maintenance and torrent settings to one job", () => {
  assert.equal(service.maintenanceConcurrency({ concurrency: 1 }), 1);
  assert.equal(service.maintenanceConcurrency({ concurrency: 3 }), 1);
  assert.equal(service.maintenanceConcurrency({ concurrency: 99 }), 1);
  assert.equal(service.torrentConcurrency({ torrentConcurrency: 1 }), 1);
  assert.equal(service.torrentConcurrency({ torrentConcurrency: 3 }), 1);
  assert.equal(service.torrentConcurrency({ torrentConcurrency: 99 }), 1);
});

test("checks only seasonal categories when every season is selected", async () => {
  const planned = await service.buildMaintenanceWork([{
    title: "Example Show",
    malTitle: "",
    path: "Sources/Files/Anime/Example_Show.json",
    file: "Example_Show.json",
    categories: [
      { category: "Season 1", episodeCount: 12, episodeNumbers: Array.from({ length: 12 }, (_, index) => index + 1) },
      { category: "Special", episodeCount: 1, episodeNumbers: [1] },
      { category: "Shorts", episodeCount: 2, episodeNumbers: [1, 2] },
    ],
  }], { malCheck: false, allCategories: true, addNewSeasons: false });
  assert.deepEqual(planned.work.map((item) => item.category), ["Season 1"]);
});
