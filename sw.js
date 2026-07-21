// Cache-first app shell so the demo works with no connectivity after the
// first load. Bump CACHE_NAME whenever the precached file list changes so
// returning visitors pick up the new version instead of a stale cache.
const CACHE_NAME = 'cbti-demo-v3';

const PRECACHE_URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/engine.js',
  './js/store.js',
  './js/i18n.js',
  './js/troubleshooter.js',
  './data/i18n.json',
  './data/sessions.json',
  './data/troubleshooter.json',
  './data/examples.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        });
    })
  );
});
