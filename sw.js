const CACHE = 'schedule-pwa-v17';
const RUNTIME_CACHE = 'schedule-runtime-v17';
const SHARED_CACHE = 'shared-files';
const REMOTE_SCHEDULE_CACHE = 'remote-schedule-v1';
const LAST_VERSION_KEY = '/data/version.json';

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
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await Promise.allSettled(ASSETS.map((u) => c.add(u).catch(() => null)));
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (k) =>
                  k !== CACHE &&
                  k !== RUNTIME_CACHE &&
                  k !== SHARED_CACHE &&
                  k !== REMOTE_SCHEDULE_CACHE
              )
              .map((k) => caches.delete(k))
          )
        ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.method === 'POST' && url.pathname.endsWith('/share-handler.html')) {
    e.respondWith(handleShare(req));
    return;
  }

  // data/* — network-first, fallback на cache
  if (
    url.pathname.startsWith('/pendrops/data/') ||
    url.pathname.startsWith('./data/') ||
    url.pathname.endsWith('/data/schedule.xls') ||
    url.pathname.endsWith('/data/version.json')
  ) {
    e.respondWith(networkFirstWithCache(req));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

async function networkFirstWithCache(req) {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(REMOTE_SCHEDULE_CACHE).then((c) => c.put(req, copy));
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
        if (lower.endsWith('.xlsx'))
          type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

/**
 * Периодическая фоновая синхронизация (Chrome/Edge/Opera).
 * Регистрируется клиентом через registration.periodicSync.register('check-schedule', {minInterval: 5*60*1000}).
 * ВАЖНО: periodicSync требует user gesture для permission. Fallback: клиент сам тикает по 5 мин пока PWA открыта.
 */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'check-schedule') {
    e.waitUntil(checkScheduleUpdate());
  }
});

/**
 * Клиент шлёт сообщение "check-schedule" — мы проверяем и качаем новое.
 * Используется как fallback если periodicSync не поддерживается.
 */
self.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'check-schedule') {
    e.waitUntil(checkScheduleUpdate());
  } else if (data.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

/**
 * Проверяет version.json. Если новее — качает schedule.xls в cache, шлёт клиентам "schedule-updated".
 * Не уведомляет сам себя — только клиентов.
 */
async function checkScheduleUpdate() {
  try {
    const verRes = await fetch(LAST_VERSION_KEY + '?t=' + Date.now(), { cache: 'no-store' });
    if (!verRes.ok) return;
    const verJson = await verRes.json();
    const newStamp = verJson && verJson.updated;
    if (!newStamp) return;

    const cache = await caches.open(REMOTE_SCHEDULE_CACHE);
    const lastKnown = (await cache.match(LAST_VERSION_KEY)) || null;
    let lastStamp = null;
    if (lastKnown) {
      try {
        const lastJson = await lastKnown.clone().json();
        lastStamp = lastJson && lastJson.updated;
      } catch {
        // intentionally ignored: stale cached version.json parse failure
      }
    }

    if (lastStamp === newStamp) return; // ничего не изменилось

    // Качаем новый schedule.xls
    const xlsRes = await fetch('./data/schedule.xls?t=' + Date.now(), { cache: 'no-store' });
    if (!xlsRes.ok) return;
    const xlsBuf = await xlsRes.arrayBuffer();

    // Кладём в cache
    await cache.put(
      LAST_VERSION_KEY,
      new Response(JSON.stringify(verJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await cache.put(
      './data/schedule.xls',
      new Response(xlsBuf.slice(0), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.ms-excel' },
      })
    );

    // Уведомляем всех клиентов
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) =>
      c.postMessage({
        type: 'schedule-updated',
        version: verJson.version || '',
        updated: newStamp,
      })
    );
  } catch (err) {
    console.warn('[SW] checkScheduleUpdate:', err);
  }
}
