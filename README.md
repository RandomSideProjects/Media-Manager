# [RSP Media Manager](https://randomsideprojects.github.io/Media-Manager/)

A lightweight, browser-only video player that loads episode lists from small JSON directories.

## Overview

- Runs entirely client-side—open `index.html` and start watching.
- Load sources via URL parameter, 6-character code, or local folder.
- Resume playback, auto-advance to the next item, optional clipping/upload, theme toggle, and source download.

## Repository Structure

| Path / File | Purpose |
|-------------|---------|
| `index.html` | Main entry point and UI layout. |
| `style.css` | Global styles and dark/light theme definitions. |
| `script.js` | Core logic for loading sources, rendering episode menus, playback management, clipping, and downloads. |
| `creator.html` | Interactive tool for building or editing JSON directory files. |
| `Directorys/` | Example and public source files plus listing page (`index.html`, `AnimeSourceList.json`, `MangaSourceList.json`). |
| `Assets/` | Image assets used by the UI. |
| `.github/workflows/AnimeSourceMaintainer.yml` | GitHub Action that keeps `Directorys/AnimeSourceList.json` in sync. |
| `.github/workflows/MangaSourceMaintainer.yml` | GitHub Action that keeps `Directorys/MangaSourceList.json` in sync. |

## Getting Started

### Installation

1. Download the project files (`index.html`, `style.css`, `script.js`, and any JSON directory files`).
2. Open `index.html` directly in your browser or host it via GitHub Pages.

### Loading a Source

- **Local host:** `index.html?source=[url_or_code]`
- **Official host:** `https://randomsideprojects.github.io/Media-Manager/?source=[url_or_code]`

## Creating a Source JSON

Use the **creator** tool (found in `/Creator/`)

or 

craft the JSON manually using the schema below:

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
=======
-- **`title`**: The title shown at the top of the player.
-- **`categories`**: An array of category (e.g., season) objects.
  -- **`category`**: Name of the category.
  -- **`episodes`**: Array of episodes.
   -- **`title`**: Episode title shown in the menu.
    ---**`src`**: Public URL to the video file (must support CORS).

For reference, see Directorys/Files/ExampleDir.json

## Usage

To load a source, you can

Locally Hosted
`index.html?source=[source]` in your browser.

Offical Host 
`randomsideprojects.github.io/Media-Manager/?source=[source]` in your browser.






There might be more, but for now, that is all!
this is still slightly outdated

CURRENT DATE WHEN EDITTED : 9/15/25


