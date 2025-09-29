# [RSP Media Manager](https://randomsideprojects.github.io/Media-Manager/)
## ![img](https://github.com/RandomSideProjects/Media-Manager/blob/main/Assets/Favicon.png?raw=true)

RSP Media Manager is a browser-only library viewer for video and manga catalogs. Load a JSON directory from Catbox, GitHub Pages, or your own filesystem and the app handles playback, progress tracking, downloads, clipping, and a CBZ reader—no server required.

## Highlights

- Runs entirely client-side: open `index.html` locally or visit the [hosted build](https://randomsideprojects.github.io/Media-Manager/).
- Accepts JSON URLs, 6-character Catbox IDs, pasted JSON, or a local folder containing `index.json` + media.
- Remembers progress, resumes automatically, and can jump straight to the next episode/volume.
- Built-in download manager with optional season/episode selection, size estimates, and configurable concurrency.
- Optional clip recorder that uploads to Catbox (or lets you download the WebM) with an on/off toggle and preview mode.
- Integrated CBZ viewer with progress overlay, page tracking, and StreamSaver-based downloads for large archives.
- Theme toggle, pop-out/theater mode, and a persistent settings panel that lets you clear the app’s storage when needed.

## Project Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Main player UI (video + manga) and script entrypoints. |
| `style.css` | Global styling, themes, and CBZ-specific layout. |
| `scripts/` | Modular front-end logic (source loading, player controls, downloads, clipping, local-folder support, settings, pop-out, version badge). |
| `Assets/` | Images, favicons, and `LastUpdated.txt` (drives the in-app “Version YYYY-MM-DD” badge). |
| `Creator/` | Standalone web app for creating/editing directory JSON, uploading to Catbox, and managing posters/CBZ options. |
| `Directorys/` | Public source listings (`index.html`, curated JSON files, posters, and supporting scripts). |
| `Tools/CBZcompress.py` | Helper script for batch recompressing `.cbz/.cbr` archives before publishing. |
| `LICENSE` | Apache 2.0 license for the project. |

## Requirements

- A modern Chromium, Firefox, or Safari build. Clipping relies on MediaRecorder + captureStream, so the latest Chromium-based browsers offer the best experience.
- For local-folder ingestion (`Select Folder`), use a browser that supports the `webkitdirectory` file input attribute (Chromium-based recommended).
- When opening via `file://`, some browsers block `fetch` for local JSON. This is usually a setting and can be turned off.

## Installation

```bash
git clone https://github.com/randomsideprojects/Media-Manager.git
cd Media-Manager
```

You can open `index.html` directly or serve the folder with your favorite static host. The site works offline once loaded because all logic is client-side.

### Updating Your Clone

```bash
git pull
```

## Using the Player

### Launching

- Double-click `index.html`, or run a local server and browse to `http://localhost:8000/index.html`.
- To deep-link to a source, append `?source=<value>` (and optionally `&item=<episode-number>`).

### Loading a Source

- **URL:** Paste any reachable JSON manifest (`https://…/Series.json`).
- **Catbox ID:** Enter the 6-character ID (e.g. `abc123`) and the app expands it to `https://files.catbox.moe/abc123.json`.
- **Relative path:** Provide `Directorys/Files/Anime/Series.json` to load included examples.
- **Inline JSON:** Paste raw JSON or a `data:application/json,…` URI to render an ad-hoc directory without hosting it.
- **Local folder:** Click `Select Folder`, choose a directory with `index.json`, and the player wires up matching media/CBZ files automatically.

### Playback & Navigation

- Resume banner highlights where you left off or jumps to the next episode if the last one was nearly finished.
- `≡` returns to the episode list, `⤴` opens the current item in a pop-out window, and `Next Item` advances manually.
- Manga/CBZ volumes show a page counter and use an overlay while the archive is unpacked.

### Downloads

Click `Download Source` to save the entire directory. If **Selective downloads** are enabled in Settings, a picker lets you choose specific seasons or episodes with live size estimates. StreamSaver streams large archives without exhausting memory; adjust the concurrency slider in Settings to balance speed vs. network load.

### Clipping

Enable **Clipping** (and **Clip preview** if desired) in the Settings overlay. When active, `Clip` records a short segment around the current timestamp, shows progress, then uploads to Catbox. If the upload fails you can still download the WebM locally.

### Theme, Settings, and Storage

- `☾` toggles the theme.
- The gear icon opens Settings: clipping toggles, selective downloads, download concurrency, and a `CLEAR STORAGE` action to wipe saved progress/preferences.
- Version badge in the bottom-right reads `Assets/LastUpdated.txt`; update that file when you ship updates.

## Creating & Maintaining Directories

### Creator Web App

- Launch `Creator/index.html` for a guided editor that can import an existing JSON, upload assets/posters to Catbox, convert folders full of media/CBZ files, and manage manga-specific options like CBZ expansion for uploads.
- Upload settings (library type, anonymous mode, concurrency) persist locally so you can fine-tune Catbox workflows.

### Manual JSON Schema

Each directory JSON should resemble:

```json
{
  "title": "Your Series Title",
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

**Required**: `title`, `categories[].category`, `categories[].episodes[].title`, `categories[].episodes[].src`.

**Optional but recommended**:
- `Image` or `image`: Poster art shown above the episode list.
- `LatestTime`: ISO 8601 timestamp to signal freshness.
- `fileSizeBytes`, `totalFileSizeBytes`: Powers size estimates in the download picker.
- `durationSeconds`, `totalDurationSeconds`: Used for runtime displays.
- `VolumePageCount`: For CBZ volumes, informs the page counter.
- `progressKey`: Stable identifier for locally hosted items (auto-added by the folder loader).

Host the JSON and media on a CORS-accessible service (Catbox, GitHub Pages, Cloudflare R2, etc.).

## Tooling & Maintenance

- `Assets/LastUpdated.txt` feeds the in-app version badge. Update it alongside releases.
- `Tools/CBZcompress.py` converts `.cbr` archives to `.cbz` and re-zips images to help keep manga libraries consistent before uploading.
- `Directorys/index.html` provides curated source lists that point back into the main player.

## License

Licensed under the [Apache License 2.0](LICENSE).

---

Last updated: 2025-09-20
