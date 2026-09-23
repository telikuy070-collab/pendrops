/**
 * PenDrops Service Worker — production-ready
 * - Dynamic base path via registration.scope (no hardcoded /pendrops/)
 * - Caches static assets (manifest, icons, version.json, schedule.xls)
 * - Runtime-caches JS/CSS/HTML on first fetch
 * - Auto-incrementing cache version via build-time timestamp
 * - Cross-origin check preserved for Supabase requests
 */

// Cache version: updated at build time (inject via build script or CI)
// Format: 'schedule-pwa-<timestamp>'
const CACHE_VERSION = 'schedule-pwa-1758134400000'; // TODO: replace with build timestamp at build time
const CACHE = CACHE_VERSION;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SHARED_CACHE = 'shared-files';
const REMOTE_SCHEDULE_CACHE = 'remote-schedule-v1';
const LAST_VERSION_KEY = 'data/version.json';

/**
 * Resolve base path from registration.scope.
 * Examples:
 *   - https://user.github.io/pendrops/  -> '/pendrops/'
 *   - https://user.github.io/           -> '/'
 *   - http://localhost:8080/            -> '/'
 */
function getBasePath() {
  const scope = self.registration?.scope || self.location.href;
  const url = new URL(scope);
  return url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
}

const BASE = getBasePath();

/**
 * Build absolute URL from relative path using BASE.
 */
function asset(path) {
  return new URL(path, BASE).href;
}

/**
 * Static assets to precache on install.
 * These are files in public/ that don't change between builds (no hashes).
 * Main JS/CSS are intentionally NOT here — they're hashed and cached on first fetch.
 */
const PRECACHE_ASSETS = [
  BASE,                           // '/' (scope root)
  asset('index.html'),
  asset('manifest.json'),
  asset('xlsx.full.min.js'),
  asset('icons/icon.svg'),
  asset('icons/icon-192.png'),
  asset('icons/icon-512.png'),
  // styles.css and share-handler.html are processed by Vite and hashed in dist/,
  // so they're not in PRECACHE_ASSETS — they'll be cached on first fetch via runtime caching.
  asset('data/version.json'),
  asset('data/schedule.xls'),
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Precaching failed for', url, err);
            return null;
          })
        )
      );
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

  // Cross-origin check: skip Supabase and other external requests
  if (url.origin !== location.origin) return;

  // Share handler POST
  if (req.method === 'POST' && url.pathname === asset('share-handler.html')) {
    e.respondWith(handleShare(req));
    return;
  }

  // data/* — network-first with cache fallback
  const isDataPath =
    url.pathname.startsWith(asset('data/')) ||
    url.pathname.endsWith('/data/schedule.xls') ||
    url.pathname.endsWith('/data/version.json');

  if (isDataPath) {
    e.respondWith(networkFirstWithCache(req));
    return;
  }

  // Navigation requests: network-first, fallback to cached index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match(asset('index.html')))
    );
    return;
  }

  // All other requests: stale-while-revalidate (cache-first, then network)
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
    return Response.redirect(asset('share-handler.html'), 303);
  } catch (err) {
    console.error('[SW] share error:', err);
    return Response.redirect(asset('index.html'), 303);
  }
}

/**
 * Periodic background sync (Chrome/Edge/Opera).
 * Registered by client via registration.periodicSync.register('check-schedule', {minInterval: 5*60*1000}).
 * Requires user gesture for permission. Fallback: client ticks every 5 min while PWA open.
 */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'check-schedule') {
    e.waitUntil(checkScheduleUpdate());
  }
});

/**
 * Client sends "check-schedule" message — we check and download updates.
 * Fallback if periodicSync not supported.
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
 * Checks version.json. If newer — downloads schedule.xls to cache, notifies clients "schedule-updated".
 * Does not notify self — only clients.
 */
async function checkScheduleUpdate() {
  try {
    const verUrl = asset(LAST_VERSION_KEY) + '?t=' + Date.now();
    const verRes = await fetch(verUrl, { cache: 'no-store' });
    if (!verRes.ok) return;
    const verJson = await verRes.json();
    const newStamp = verJson && verJson.updated;
    if (!newStamp) return;

    const cache = await caches.open(REMOTE_SCHEDULE_CACHE);
    const lastKnown = (await cache.match(asset(LAST_VERSION_KEY))) || null;
    let lastStamp = null;
    if (lastKnown) {
      try {
        const lastJson = await lastKnown.clone().json();
        lastStamp = lastJson && lastJson.updated;
      } catch {
        // intentionally ignored: stale cached version.json parse failure
      }
    }

    if (lastStamp === newStamp) return; // nothing changed

    // Download new schedule.xls
    const xlsUrl = asset('data/schedule.xls') + '?t=' + Date.now();
    const xlsRes = await fetch(xlsUrl, { cache: 'no-store' });
    if (!xlsRes.ok) return;
    const xlsBuf = await xlsRes.arrayBuffer();

    // Store in cache
    await cache.put(
      asset(LAST_VERSION_KEY),
      new Response(JSON.stringify(verJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await cache.put(
      asset('data/schedule.xls'),
      new Response(xlsBuf.slice(0), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.ms-excel' },
      })
    );

    // Notify all clients
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