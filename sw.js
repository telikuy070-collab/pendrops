const CACHE = 'schedule-pwa-v13';
const RUNTIME_CACHE = 'schedule-runtime-v13';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './xlsx.full.min.js',
  './src/app.js',
  './src/sheet.js',
  './src/cell.js',
  './src/day.js',
  './src/timing.js',
  './src/text.js',
  './src/store.js',
  './src/picker.js',
  './src/constants.js',
  './src/view/scheduleView.js',
  './src/view/toast.js',
  './src/view/dom.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== location.origin) return;

  // Navigation requests → network first, fallback to cached index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first с обновлением в фоне (stale-while-revalidate)
  e.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
