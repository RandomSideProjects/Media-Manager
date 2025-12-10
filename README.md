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
- Theme toggle, pop-out/theater mode, and a persistent settings panel with a storage reset.

## Quick start
1) Clone: `git clone https://github.com/RandomSideProjects/Media-Manager.git && cd Media-Manager`  
2) Open `index.html` directly, or serve the folder:  
   - `python Tools/serve_parent.py --port 8000` (rooted at the repo)  
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
- `≡` returns to the list, `⤴` opens a pop-out window, and `Next Item` advances manually.
- Manga/CBZ volumes show a page counter and overlay while archives unpack.
- Settings pane toggles clipping, selective downloads, download concurrency, and a `CLEAR STORAGE` action to wipe local data.
- Version badge in the corner reads `Assets/LastUpdated.txt` (update alongside releases).

## Downloads & clipping
- `Download Source` saves the entire directory; enable **Selective downloads** in Settings to pick seasons/episodes with live size estimates.
- StreamSaver streams large downloads without exhausting memory; tune concurrency in Settings to balance speed vs network load.
- Enable **Clipping** (and **Clip preview** if desired) to record short segments. Success paths upload to Catbox; failures still offer a local WebM download.

## Creator web app
Launch `Creator/index.html` for a guided editor that can import existing manifests, convert folders full of media/CBZ files, upload posters/assets to Catbox, and manage manga options like CBZ expansion. Upload settings (library type, anonymous mode, concurrency) persist locally so you can fine-tune workflows.

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

## Tooling
- `Assets/LastUpdated.txt` feeds the in-app version badge.
- `Sources/index.html` lists curated example sources.
- `Tools/CBZcompress.py` converts `.cbr` to `.cbz` and re-zips pages for cleaner uploads.
- `Tools/MediaTool.py` splits large videos into size-capped chunks using FFmpeg (CLI prompt + optional Tk GUI).
- `Tools/serve_parent.py` starts a threaded HTTP server rooted at the repo for quick local testing.

## Requirements & notes
- Modern Chromium, Firefox, or Safari. Clipping relies on MediaRecorder + captureStream (best in Chromium-based browsers).
- For `file://` usage, some browsers block `fetch` for local JSON—toggle that setting if needed.
- Local-folder ingestion depends on `webkitdirectory` support (Chromium recommended).

## License
Apache 2.0, see `LICENSE`.

---

Last updated: 2025-12-08
