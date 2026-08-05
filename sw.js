/* ═══════════════════════════════════════════════════════
   Exam Trainer — Service Worker
   Strategy: precache the app shell, then serve our own files
   network-first so a launch always runs the current release,
   falling back to the cache when offline. Third-party assets
   stay stale-while-revalidate.

   ⚠️  Bump CACHE_VERSION on every deploy (see DEPLOY.md) so
       old caches are cleaned up and clients pick up changes.
   ═══════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v17';
const CACHE_NAME = 'examtrainer-' + CACHE_VERSION;

// Same-origin app shell. Relative paths keep this working under the
// GitHub Pages subpath (username.github.io/ExamTrainer/).
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './drive-sync.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

// Hosts whose responses must never be cached (auth + live Drive data).
const NO_CACHE_HOSTS = [
  'accounts.google.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
  'content.googleapis.com',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Resilient precache: one missing optional file must not abort install.
      return Promise.allSettled(
        APP_SHELL.map(function (url) { return cache.add(url); })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_NAME && k.indexOf('examtrainer-') === 0; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Let the page trigger an immediate activation after an update.
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept Google auth / Drive API traffic.
  if (NO_CACHE_HOSTS.indexOf(url.hostname) !== -1) return;

  // Our own code and markup go network-first. Serving them from cache first
  // means a launch always runs the *previous* release and only picks up the
  // new one on the launch after that, which makes every deploy look broken
  // until you happen to open the app twice. Offline still works: the fetch
  // rejects and we fall straight back to the cached copy.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
          return res;
        }).catch(function () {
          return cache.match(req).then(function (cached) {
            if (cached) return cached;
            // Offline on a deep link: fall back to the app shell.
            if (req.mode === 'navigate') return cache.match('./index.html');
            return Response.error();
          });
        });
      })
    );
    return;
  }

  // Third-party assets (fonts) never change under us, so they stay
  // stale-while-revalidate and never delay a launch.
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        const network = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(function () {});
          }
          return res;
        }).catch(function () {
          return cached;
        });

        return cached || network;
      });
    })
  );
});
