/* ═══════════════════════════════════════════════════════
   Exam Trainer — Service Worker
   Strategy: precache the app shell, then serve everything
   stale-while-revalidate so updates land automatically on
   the next launch while the app keeps working fully offline.

   ⚠️  Bump CACHE_VERSION on every deploy (see DEPLOY.md) so
       old caches are cleaned up and clients pick up changes.
   ═══════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v9';
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

  // Stale-while-revalidate for everything else (same-origin shell + fonts).
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        const network = fetch(req).then(function (res) {
          // Only cache successful, cacheable responses.
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(function () {});
          }
          return res;
        }).catch(function () {
          // Offline and not cached: for navigations, fall back to the shell.
          if (req.mode === 'navigate') return cache.match('./index.html');
          return cached;
        });

        // Serve cache first if present; otherwise wait for the network.
        return cached || network;
      });
    })
  );
});
