# [RSP Media Manager](https://randomsideprojects.github.io/Media-Manager/Main/)

A lightweight, browser-only video player that loads episode lists from small JSON directories.

## Overview

- Runs entirely client-side—open `Main/index.html` and start watching.
- Load sources via URL parameter, 6-character code, or local folder.
- Resume playback, auto-advance to the next item, optional clipping/upload, theme toggle, and source download.

## Repository Structure

| Path / File | Purpose |
|-------------|---------|
| `Main/index.html` | Main entry point and UI layout. |
| `Main/styles.css` | Global styles and dark/light theme definitions. |
| `Main/scripts/` | Core logic for loading sources, rendering episode menus, playback management, clipping, and downloads. |
| `Main/Creator/` | Interactive tool for building or editing JSON directory files. |
| `Directorys/` | Example and public source files plus listing page (`index.html`, `SourceList.json`). |
| `Assets/` | Image assets used by the UI. |
| `.github/workflows/SourceMaintainer.yml` | GitHub Action that keeps `Directorys/SourceList.json` in sync. |

## Key Concepts & Features

- **Source JSON format** with `title`, `categories`, and `episodes` entries.
- **Dynamic loading** of sources from URLs, codes, or local files.
- **Playback management** with resume data in `localStorage` and next-item auto advance.
- **Local folder import** and **source download** as a zip via JSZip.
- **Optional clipping** tool that can upload to Catbox.
- **Theme toggle** for dark or light mode.

## Getting Started

### Installation

1. Download the project files (`Main/index.html`, `Main/styles.css`, the `Main/scripts/` folder, and any JSON directory files`).
2. Open `Main/index.html` directly in your browser or host it via GitHub Pages.

### Loading a Source

- **Local host:** `Main/index.html?source=[url_or_code]`
- **Official host:** `https://randomsideprojects.github.io/Media-Manager/Main/?source=[url_or_code]`

## Creating a Source JSON

Use `Main/Creator/index.html` (works best when run locally due to CORS restrictions) or craft the JSON manually using the schema below:

```json
{
  "title": "Your Series Title",
  "categories": [
    {
      "category": "Season 1",
      "episodes": [
        {
          "title": "Episode 1",
          "src": "https://example.com/videos/episode1.mp4"
        }
      ]
    }
  ]
}
```


For a complete example, see `Directorys/Files/ExampleDir.json`.

## Usage

To load a source, you can

Locally Hosted
`Main/index.html?source=[source]` in your browser.

Offical Host
`randomsideprojects.github.io/Media-Manager/Main/?source=[source]` in your browser.


## Tips for Newcomers

1. Inspect the JSON schema to understand how sources are structured.
2. Follow the flow in `Main/scripts/core.js` (`init` → `renderEpisodeList` → `loadVideo`).
3. Look at `localStorage` keys to see how resume data is stored.
4. Explore the clipping logic near the end of `Main/scripts/extras.js`.
5. Review the Catbox upload helpers in `Main/Creator/script.js`.
6. Check the GitHub Action that maintains `Directorys/SourceList.json`.

## Where to Go Next

- Enhance source discovery with search or filters.
- Improve error handling for network or format issues.
- Expand clipping/upload options beyond Catbox.
- Add responsive and accessibility improvements.
- Modularize JavaScript into smaller components.

## Troubleshooting / Known Errors

- **CORS errors**: Ensure your JSON host sends `Access-Control-Allow-Origin: *`.

