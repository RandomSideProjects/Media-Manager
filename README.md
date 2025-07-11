# RSP Media Manager

A simple, modern web-based video player that loads episode lists from a remote JSON directory.

## Main Host 

To access RSP Media Manager without locally hosting, please use the public host provided below.

https://randomsideprojects.github.io/Media-Manager/?source=

## Features

- Category-based episode selection
- Resume playback using localStorage
- Next Episode auto-advance and manual controls
- Back to menu button

## Getting Started

### Installation

1. Download the project files (`index.html`, `style.css`, `script.js`, and any JSON directory files).
2. Open `index.html` directly in your browser.

## Creating a Source JSON

A “source” is a JSON file describing your episodes. It must follow this structure:

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
        },
        {
          "title": "Episode 2",
          "src": "https://example.com/videos/episode2.mp4"
        }
      ]
    }
  ]
}
```

- **`title`**: The title shown at the top of the player.
- **`categories`**: An array of category (e.g., season) objects.
  - **`category`**: Name of the category.
  - **`episodes`**: Array of episodes.
    - **`title`**: Episode title shown in the menu.
    - **`src`**: Public URL to the video file (must support CORS).

For refrence, see Directorys/ExampleDir.json

## Usage

To load a source, you can

Locally Hosted
`index.html?source=[source]` in your browser.

Offical Host 
`randomsideprojects.github.io/Media-Manager/?source=[source]` in your browser.



## Troubleshooting/Known Errors

- **CORS Errors**: Ensure your JSON host sends `Access-Control-Allow-Origin: *`.



