"use strict";

(function () {
  const params = new URLSearchParams(window.location.search);
  const customMode = params.has('source') || params.get('custom') === '1' || params.get('embed') === '1';

  const publicScripts = [
    'scripts/alerts.js',
    'scripts/dev-core.js',
    'scripts/tags.js',
    'scripts/overlay-factory.js?v=20260725-settings',
    'scripts/account-sync.js',
    'scripts/storage.js',
    'Sources/scripts/constants.js',
    'Sources/scripts/utils.js',
    'Sources/scripts/render.js',
    'Sources/scripts/search.js',
    'Sources/scripts/ui-settings.js?v=20260725-settings',
    'Sources/scripts/feedback.js',
    'Sources/scripts/loader.js',
    'Sources/scripts/temp-sources.js'
  ];

  const customScripts = [
    'scripts/jszip/jszip.min.js',
    'scripts/constants.js',
    'scripts/alerts.js',
    'scripts/dev-core.js',
    'scripts/overlay-factory.js?v=20260725-settings',
    'scripts/dom.js',
    'scripts/theater.js',
    'scripts/tags.js',
    'scripts/recent-sources.js',
    'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',
    'scripts/player.js',
    'scripts/popout.js',
    'scripts/list.js',
    'scripts/downloads.js',
    'scripts/catbox.js',
    'scripts/clip.js',
    'scripts/settings.js',
    'scripts/dev-menu.js',
    'scripts/theme.js',
    'scripts/init.js',
    'scripts/local-folder.js',
    'scripts/zxing-lib.min.js',
    'scripts/jsqr.min.js',
    'scripts/qrcode.min.js',
    'scripts/account-sync.js',
    'scripts/storage.js',
    'scripts/version.js?v=20260725-layout'
  ];

  function loadScript(src) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', resolve, { once: true });
      document.body.appendChild(script);
    });
  }

  async function loadScripts(sources) {
    for (const src of sources) await loadScript(src);
  }

  function renderCustomShell() {
    document.getElementById('publicSourcesStyles')?.remove();
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'style.css?v=20260725-overlay';
    document.head.appendChild(stylesheet);
    document.title = 'Media Manager';
    document.documentElement.classList.add('custom-route');
    if (params.get('embed') === '1') document.documentElement.classList.add('custom-embed');

    document.body.innerHTML = `
      <div class="toolbar">
        <a class="toolbar-brand" href="./index.html" aria-label="RSP Media Manager home">
          <img src="Assets/Favicon.png" alt="">
          <span>RSP Media Manager</span>
        </a>
        <nav class="tabs" aria-label="Main navigation">
          <button type="button" data-route="./index.html" class="tab-button tab-button--icon" aria-label="Public sources" title="Public sources">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/></svg>
          </button>
          <button type="button" data-route="./index.html?custom=1" class="tab-button tab-button--icon is-active" aria-label="Custom view" title="Custom view" aria-current="page">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Zm9 3.5v2H9v2h3v3h2v-3h3v-2h-3v-2h-2Z"/></svg>
          </button>
          <button type="button" data-route="./Creator/index.html" class="tab-button tab-button--icon tab-button--secondary" aria-label="Create or modify a source" title="Create or modify">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15.7 4.3 4 4L9 19H5v-4L15.7 4.3Zm1.4-1.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8l-.8.8-4-4 .8-.8Z"/></svg>
          </button>
        </nav>
        <div class="toolbar-controls">
          <div class="toolbar-actions toolbar-actions--left">
            <button id="settingsBtn" title="Settings" aria-label="Open settings">⚙</button>
          </div>
          <div class="toolbar-actions toolbar-actions--right">
            <button id="themeToggle" title="Toggle Theme" aria-label="Toggle theme">☾</button>
          </div>
        </div>
      </div>
      <div id="accountHeaderLine" class="account-header-line" hidden></div>
      <div id="homeMainRegion">
        <section id="recentSourcesRail" class="recent-sources" aria-label="Recent sources" hidden></section>
        <div class="container" id="playerContainer">
          <div id="urlInputContainer">
            <div class="source-loader-heading">
              <span class="source-loader-kicker">Your library, your sources</span>
              <h1>Open a media source</h1>
              <p>Paste a source URL or Catbox ID, or choose a local folder to start watching.</p>
            </div>
            <div id="errorMessage">Unfortunately, there was no directory given. Please try again or enter directory below.</div>
            <div class="source-url-row">
              <input type="text" id="urlInput" placeholder="Paste source URL or Catbox ID">
              <button id="goBtn">Open source</button>
            </div>
            <div class="source-loader-divider"><span>or open from this device</span></div>
            <label for="folderInput" class="folder-button folder-button--large">
              <span aria-hidden="true">＋</span>
              Select local folder
            </label>
            <input type="file" id="folderInput" webkitdirectory multiple style="display:none">
          </div>
          <div id="directoryHeader" class="directory-header">
            <img id="directoryPoster" alt="Poster" referrerpolicy="no-referrer">
            <h2 id="directoryTitle"></h2>
          </div>
          <div id="selectorScreen" style="display:none">
            <div id="resumeMessage"></div>
            <div id="episodeList"></div>
            <button id="downloadBtn">⤓ Download Source</button>
          </div>
          <div id="playerScreen" style="display:none">
            <div id="loadingSpinner" class="spinner"></div>
            <button id="backBtn" title="Menu (Esc)" aria-label="Menu">≡</button>
            <button id="theaterBtn" title="Theater Mode (T)" aria-pressed="false">⤴</button>
            <button id="clipBtn">Clip</button>
            <h2 id="videoTitle">Loading...</h2>
            <div id="separatedPartsBar" class="separated-parts-bar" role="group" aria-label="Part selection"></div>
            <div class="mm-video-frame">
              <video id="videoPlayer" controls autoplay playsinline></video>
              <button id="nextBtn" type="button" aria-label="Next">Next</button>
            </div>
            <div id="cbzViewer" style="display:none">
              <div id="cbzControls" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75em;gap:0.5em">
                <button id="cbzPrevBtn" title="Previous Page">⟵ Prev</button>
                <span id="cbzPageInfo" style="font-weight:600">Page 1 / 1</span>
                <button id="cbzNextBtn" title="Next Page">Next ⟶</button>
              </div>
              <div id="cbzImageWrap" style="overflow:hidden;display:flex;justify-content:center;align-items:center">
                <img id="cbzImage" alt="Comic Page" style="max-height:80vh;max-width:100%;object-fit:contain;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,0.5)">
              </div>
            </div>
            <div id="placeholderNotice">To view this file, please download the respective category from the source and merge with the folders.</div>
          </div>
        </div>
      </div>
      <footer class="app-footer" id="appFooter">
        <a href="https://github.com/RandomSideProjects" target="_blank" rel="noopener" id="githubLink">
          <span>RandomSideProjects</span>
          <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub">
        </a>
      </footer>
    `;

    document.querySelectorAll('[data-route]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = button.dataset.route;
      });
    });
  }

  if (customMode) renderCustomShell();
  void loadScripts(customMode ? customScripts : publicScripts);
})();
