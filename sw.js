const CACHE = 'schedule-pwa-v16';
const RUNTIME_CACHE = 'schedule-runtime-v16';
const SHARED_CACHE = 'shared-files';
const REMOTE_SCHEDULE_CACHE = 'remote-schedule-v1';
// НЕ включаем data/schedule.xls в precache — это 3.6 МБ и блокирует install.
// data грузится network-first с fallback на cache.
const ASSETS = [
  './',
  './index.html',
  './share-handler.html',
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
  './src/admin.js',
  './src/constants.js',
  './src/view/scheduleView.js',
  './src/view/toast.js',
  './src/view/dom.js',
  './src/view/adminView.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await Promise.allSettled(ASSETS.map(u => c.add(u).catch(() => null)));
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME_CACHE && k !== SHARED_CACHE && k !== REMOTE_SCHEDULE_CACHE).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.method === 'POST' && url.pathname.endsWith('/share-handler.html')) {
    e.respondWith(handleShare(req));
    return;
  }

  // data/* — network-first, fallback на cache
  if (url.pathname.startsWith('/pendrops/data/') || url.pathname.startsWith('./data/') || url.pathname.endsWith('/data/schedule.xls') || url.pathname.endsWith('/data/version.json')) {
    e.respondWith(networkFirstWithCache(req));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // default: cache-first
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

async function networkFirstWithCache(req) {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(REMOTE_SCHEDULE_CACHE).then(c => c.put(req, copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function handleShare(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (file && typeof file === 'object' && 'stream' in file) {
      const name = file.name || 'shared.xls';
      const lower = name.toLowerCase();
      let type = file.type;
      if (!type || type === 'application/octet-stream') {
        if (lower.endsWith('.xlsx')) type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (lower.endsWith('.xls')) type = 'application/vnd.ms-excel';
        else if (lower.endsWith('.csv')) type = 'text/csv';
      }
      const headers = new Headers();
      headers.set('Content-Type', type);
      headers.set('X-File-Name', encodeURIComponent(name));
      const response = new Response(file.stream(), { status: 200, headers });
      const cache = await caches.open(SHARED_CACHE);
      await cache.put('/__shared__', response);
    }
    return Response.redirect(new URL('./share-handler.html', req.url).href, 303);
  } catch (err) {
    console.error('[SW] share error:', err);
    return Response.redirect(new URL('./index.html', req.url).href, 303);
  }
}
