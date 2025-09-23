const CACHE_NAME = 'rsp-media-manager-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './Assets/Favicon.png',
  './scripts/constants.js',
  './scripts/dom.js',
  './scripts/player.js',
  './scripts/popout.js',
  './scripts/list.js',
  './scripts/downloads.js',
  './scripts/clip.js',
  './scripts/settings.js',
  './scripts/theme.js',
  './scripts/init.js',
  './scripts/local-folder.js',
  './scripts/clear-storage.js',
  './scripts/version.js',
  './Creator/index.html',
  './Creator/styles.css',
  './Creator/scripts/constants.js',
  './Creator/scripts/uploader.js',
  './Creator/scripts/ui.js',
  './Creator/scripts/polling.js',
  './Creator/scripts/server.js',
  './Creator/scripts/settings.js',
  './Creator/scripts/folder-upload.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => cached);
    })
  );
});
