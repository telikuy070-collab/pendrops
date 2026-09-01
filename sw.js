const CACHE = 'schedule-pwa-v10';
const RUNTIME_CACHE = 'schedule-runtime-v10';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/app.js',
  './src/sheet.js',
  './src/cell.js',
  './src/day.js',
  './src/timing.js',
  './src/text.js',
  './src/store.js',
  './src/constants.js',
  './src/view/scheduleView.js',
  './src/view/toast.js',
  './src/view/dom.js',
  './manifest.json',
  './xlsx.full.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Only handle same-origin requests; let everything else go to network.
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // For navigation requests, fall back to cached index.html (SPA-like behavior).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for static assets (immutable), then runtime cache for new ones.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline: try runtime cache as last resort.
        return caches.match(req).then(r => r || new Response('', { status: 504, statusText: 'Offline' }));
      });
    })
  );
});