# [RSP Media Manager](https://randomsideprojects.github.io/Media-Manager/)
![RSP Media Manager logo](https://github.com/RandomSideProjects/Media-Manager/blob/main/Assets/Favicon.png?raw=true)

Browser-only player for video libraries and CBZ manga archives. Point it at a JSON manifest—from Catbox, GitHub Pages, or a local folder—and it handles playback, progress, downloads, clipping, and manga reading without any backend.

## Why use it
- Runs completely client-side; open `index.html` locally or use the [hosted build](https://randomsideprojects.github.io/Media-Manager/).
- Accepts JSON URLs, 6-character Catbox IDs, pasted JSON/data URIs, or a local folder containing `index.json` + media.
- Remembers progress, resumes automatically, and can jump straight to the next episode/volume.
- Built-in download manager with size estimates, selective season/episode downloads, concurrency control, and StreamSaver for large archives.
- Optional clip recorder that uploads to Catbox (or lets you download the WebM) with preview and a quick on/off toggle.
- Integrated CBZ reader with progress overlay and page tracking.
- Theme toggle, theater mode, and a persistent settings panel with a storage reset.

## Quick start
1) Clone: `git clone https://github.com/RandomSideProjects/Media-Manager.git && cd Media-Manager`  
2) Open `index.html` directly, or serve the folder:  
   - `python Tools/HostServer.py` (rooted at the repo; defaults to port 8000)  
   - or `python -m http.server 8000`  
3) Load a source (URL, Catbox ID, inline JSON, or a folder with `index.json`). The app works offline after the first load because all logic runs in the browser.

## Loading sources
- **Direct URL:** Paste any reachable JSON manifest (`https://…/Series.json`).
- **Catbox ID:** Enter the 6-character ID; the app expands to `https://files.catbox.moe/<id>.json`.
- **Relative path:** Use bundled examples like `Sources/Files/Anime/Quintuplets.json`.
- **Inline JSON:** Paste raw JSON or a `data:application/json,…` URI for quick ad-hoc catalogs.
- **Local folder:** `Select Folder` expects `index.json` and matching media/CBZ files. Works best in Chromium with `webkitdirectory`.
- **Deep link:** Append `?source=<value>&item=<episode-number>` to `index.html` to open a specific source/item.

## Player basics
- Resume banner highlights where you left off or skips ahead if the last item was nearly finished.
- `≡` returns to the list, `⤴` toggles theater mode, `H` opens a pop-out window, and `Next` advances manually.
- Manga/CBZ volumes show a page counter and overlay while archives unpack.
- Settings pane toggles clipping, selective downloads, download concurrency, and a `CLEAR STORAGE` action to wipe local data.
- Version badge in the corner reads `Assets/LastUpdated.txt` (update alongside releases).

## Downloads & clipping
- `Download Source` saves the entire directory; enable **Selective downloads** in Settings to pick seasons/episodes with live size estimates.
- StreamSaver streams large downloads without exhausting memory; tune concurrency in Settings to balance speed vs network load.
- Enable **Clipping** (and **Clip preview** if desired) to record short segments. Success paths upload to Catbox; failures still offer a local WebM download.

## Creator web app
Launch `Creator/index.html` for a guided editor that can import existing manifests, convert folders full of media/CBZ files, upload posters/assets to Catbox, and manage manga options like CBZ expansion. Upload settings (library type, anonymous mode, concurrency) persist locally so you can fine-tune workflows. Uploads randomize filenames by default; Creator item uploads use `S##E##_Title` when the category is `Season #`, otherwise `##_Title`.

## Maintenance app

The maintenance app is available from the normal navigation and directly at
`Maintenance/index.html`. The page keeps the automated run, current-job
progress, and persistent log visible while manual release searching stays
collapsed until you choose **Add a show manually**.
The page applies a simple mode to the active maintenance service: **Update
current ones** is the default and checks existing sources for missing episodes
and dual-audio upgrades; **Add new shows** runs catalog-only discovery for
playable tracker titles that are not in the library yet. The selected mode is
saved for the active service in the browser; connection settings remain
available when the service address needs to change.
The default General maintenance view runs an automated upkeep pass: it searches
SeaDex first and falls back to Nyaa/RSS mirrors when no suitable curated release
exists, selects the strongest release for each show’s latest season or missing
episode range, downloads it from the returned torrent or info-hash magnet,
processes it, uploads ordered links, and updates the existing manifest. “Add a
show” is the only workflow with manual release search. SeaDex title matching
uses AniList; `RELEASES_BASE_URL` and `ANILIST_API_URL` can override the service
defaults, while `NYAA_BASE_URL` and `NYAA_FALLBACK_URL` override the Nyaa mirrors.

The self-starting launcher starts both local servers and opens the UI for you:

```sh
node Maintenance/standalone.mjs
```

On macOS, you can double-click `Maintenance/Library Maintenance.command` instead.
Use `--no-open` when you want to start the servers without opening a browser.
`node Maintenance/service.mjs` remains available as the direct API-service
entrypoint for advanced/manual setups. The automated pass skips movie-only
sources and lets you choose one to twenty active torrent jobs in the
maintenance run options. The default is two. Queued work waits for an
available slot, while seasons within a
manifest remain sequential, and
can optionally check every season. An active maintenance run can be paused so
you can adjust its run options and resume after current transfers finish. It
can replace matching episode links and/or append missing episodes. New shows are written as a new
`Sources/Files/Anime/*.json` manifest. Episode numbers are read from the
uploaded torrent paths, and each release is processed by
`td --video-pipeline --download-all --repair` before links are saved. Manifest
writes are serialized so queued work cannot overwrite another update. After a
successful job, the backend publishes the changed JSON through the GitHub
Contents API and also updates the local checkout used by the service. Set
`MEDIA_MANAGER_GITHUB_TOKEN` (or `GITHUB_TOKEN`) to a token with Contents
read/write access, and optionally set `MEDIA_MANAGER_GITHUB_REPOSITORY` and
`MEDIA_MANAGER_GITHUB_BRANCH` (default: `RandomSideProjects/Media-Manager`
and `main`). If GitHub publication is not configured, manifest finalization
fails instead of silently leaving a local-only update; set
`MEDIA_MANAGER_GITHUB_PUBLISH=0` only when local-only behavior is intentional.
Each uploaded file's torrent source and re-encoded file are removed as soon as
that upload succeeds. Cancelling a run or job stops its `td` process, waits for
that stop to settle, and removes its cache; every completed or failed job also
removes the rest of its temporary cache. A service crash before a job reaches a
terminal state can still leave a cache for restart recovery.

### Linux API-only server

To install only the Maintenance API as a user-level systemd service on a Linux
machine, run:

```sh
curl -fsSL https://raw.githubusercontent.com/RandomSideProjects/Media-Manager/main/Maintenance/install-linux.sh | bash
```

The installer creates a shallow checkout, installs no player or static web
server, and starts only `Maintenance/service.mjs`. It listens on port `6968`
and binds to `0.0.0.0` by default so a separate browser/UI machine can reach
it. Set `MAINTENANCE_HOST=127.0.0.1` or edit the generated environment file if
it should remain private, and allow port `6968` only through a trusted LAN or
VPN firewall. For a checkout that already exists, run
`bash Maintenance/install-linux.sh` from that checkout instead.

Before a General maintenance run searches release sources, it checks each
selected season against AniList. The service uses AniList's public GraphQL API,
including the aired episode schedule and next airing episode, to queue only
missing aired episode numbers and never guess future episodes. A successful
lookup is cached for 30 minutes at
`~/.local/share/media-manager-maintenance/anilist-cache.json` (override with
`ANILIST_CACHE_FILE`); an unavailable lookup is reported and skipped rather than
guessing. Add `"anilistTitle": "..."` to a manifest when its display title is an
abbreviation or typo that AniList cannot match automatically. A dry planning pass
is available to API callers with `{ "dryRun": true }`; it returns the skipped
and queued categories without starting torrent jobs.

The local video-pipeline conversion maps every audio and compatible text-
subtitle stream into the MP4 output, converts text subtitles to `mov_text`, and
preserves container metadata and chapters. English audio is mapped first and
explicitly marked as the default track when an English language/title tag is
present; existing MP4 inputs with a non-default English track are normalized
before upload as well. Bitmap-only subtitles such as PGS cannot be embedded in
an MP4 container and require a sidecar or MKV output.

The service uses `~/.deno/bin/td` by default. Override `TD_BIN`,
`MEDIA_MANAGER_ROOT`, `TOODRIVE_BASE_URL`, `TOODRIVE_PUBLIC_BASE_URL`, `CREATOR_TORRENT_HOST`,
`CREATOR_TORRENT_PORT` (default `6968`), `MEDIA_MANAGER_LOG_FILE`, or the
`MEDIA_MANAGER_GITHUB_*` settings when needed. Maintenance events are persisted as
JSONL at `~/.local/share/media-manager-maintenance/maintenance.log` by default;
the app’s **Reload log** button reads the saved entries through
`/api/maintenance/logs`. General runs validate the `td` session before starting
any queued torrent; if it is expired, run `td login --auth-backend=file` and
start the run again.
Unfinished maintenance runs are also checkpointed at
`~/.local/share/media-manager-maintenance/resume-state.json`. When the service
starts again, it rehydrates the run and relaunches `td` with the same cache
directory, allowing completed downloads and pipeline work to be reused.
Override that location with `MEDIA_MANAGER_RESUME_FILE` when needed.

### Native macOS app (Tauri)

The native build owns the window and starts/stops the maintenance service for
you. Build it from the repository with:

```sh
cd Maintenance/src-tauri
npx @tauri-apps/cli@2.11.4 build --bundles app
open "target/release/bundle/macos/Media Manager Maintenance.app"
```

The app bundles the maintenance service, torrent-job service, and source
manifests, so no browser or local static server is needed. On first launch it
copies the manifests into the app’s writable Application Support data folder;
maintenance updates are stored there across launches. Node.js is still
required to run the bundled service, and `td` plus FFmpeg are required when a
maintenance job actually downloads or remixes media.

## JSON schema (abridged)
```json
{
  "title": "Series Title",
  "Image": "https://files.catbox.moe/example.jpg",
  "LatestTime": "2025-09-18T20:19:19",
  "categories": [
    {
      "category": "Season 1",
      "episodes": [
        {
          "title": "Episode 1",
          "src": "https://files.catbox.moe/example.mp4",
          "fileSizeBytes": 150235590,
          "durationSeconds": 1511
        }
      ]
    }
  ],
  "totalFileSizeBytes": 150235590,
  "totalDurationSeconds": 1511
}
```
Required: `title`, `categories[].category`, `categories[].episodes[].title`, `categories[].episodes[].src`.  
Recommended: `Image`/`image`, `LatestTime`, `fileSizeBytes` + `totalFileSizeBytes`, `durationSeconds` + `totalDurationSeconds`, `VolumePageCount` for CBZ, and `progressKey` for locally hosted items.
Optional unavailable-item fields: `isPlaceholder: true`, `unavailableReason: string`, and `unavailableCheckedAt: "YYYY-MM-DD"` for items that should remain visible but not playable.

## Tooling
- `Assets/LastUpdated.txt` feeds the in-app version badge.
- `Sources/index.html` lists curated example sources.
- `Tools/CBZcompress.py` converts `.cbr` to `.cbz` and re-zips pages for cleaner uploads.
- `Tools/MediaTool.py` splits large videos into size-capped chunks using FFmpeg (CLI prompt + optional Tk GUI).
- `Tools/HostServer.py` starts a threaded HTTP server rooted at the repo for quick local testing.

## Requirements & notes
- Modern Chromium, Firefox, or Safari. Clipping relies on MediaRecorder + captureStream (best in Chromium-based browsers).
- For `file://` usage, some browsers block `fetch` for local JSON—toggle that setting if needed.
- Local-folder ingestion depends on `webkitdirectory` support (Chromium recommended).

## License
Apache 2.0, see `LICENSE`.

---

Last updated: 2026-04-27
