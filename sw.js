const CACHE = 'schedule-pwa-v14';
const RUNTIME_CACHE = 'schedule-runtime-v14';
const SHARED_CACHE = 'shared-files';
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
        Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME_CACHE && k !== SHARED_CACHE).map(k => caches.delete(k)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== location.origin) return;

  // Share Target: Android Share Sheet шлёт POST multipart/form-data на share-handler.html
  if (req.method === 'POST' && url.pathname.endsWith('/share-handler.html')) {
    e.respondWith(handleShare(req));
    return;
  }

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

/**
 * Android Share Target: получаем multipart/form-data, достаём файл и кладём
 * в SHARED_CACHE. share-handler.html затем прочитает его и сохранит в IDB.
 */
async function handleShare(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (file && typeof file === 'object' && 'stream' in file) {
      const name = file.name || 'shared.xls';
      // Определяем тип из имени файла если браузер не передал
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
    // 303 See Other — share-handler.html
    return Response.redirect(new URL('./share-handler.html', req.url).href, 303);
  } catch (err) {
    console.error('[SW] share error:', err);
    return Response.redirect(new URL('./index.html', req.url).href, 303);
  }
}
