/**
 * PenDrops Service Worker — single production source of truth.
 *
 * This file is the only Service Worker source in the repository. Vite copies
 * `public/` verbatim into `dist/`, so the built worker is `dist/sw.js` and the
 * build replaces the `CACHE_VERSION` placeholder below with a build stamp.
 *
 * Invariants:
 * - every URL helper returns an absolute URL and every path comparison uses a
 *   pathname; full URLs and pathnames are never mixed;
 * - the base URL is an absolute URL derived from the registration scope, so the
 *   same worker works at `/` and at `/pendrops/`;
 * - only same-origin GET responses are ever cached (never Supabase);
 * - precaching is fail-closed: if a critical asset cannot be precached the
 *   install fails instead of activating a half-populated worker.
 */

const CACHE_VERSION = 'schedule-pwa-BUILDSTAMP';
const CACHE = CACHE_VERSION;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const REMOTE_SCHEDULE_CACHE = `${CACHE_VERSION}-schedule`;

/**
 * The shared file is user data pending import, not a build artifact: it must
 * survive a cache-version bump, so this cache is deliberately not versioned.
 */
const SHARED_CACHE = 'pendrops-shared';

const VERSION_PATH = 'data/version.json';
const SCHEDULE_PATH = 'data/schedule.xls';
const SHARE_HANDLER_PATH = 'share-handler.html';
const SHARED_FILE_KEY = '__shared_schedule__';

/** Caches owned by the current worker version; never deleted on activate. */
const KEEP_CACHES = Object.freeze([CACHE, RUNTIME_CACHE, REMOTE_SCHEDULE_CACHE, SHARED_CACHE]);

/** Flat cache names of retired worker versions that prefix matching misses. */
const LEGACY_CACHES = Object.freeze(['shared-files', 'remote-schedule-v1']);

/**
 * Hashed entry assets (JS/CSS/icons) of the current build.
 *
 * The build replaces this empty array with the real, content-hashed files from
 * `dist/.vite/manifest.json` (see vite.config.js and scripts/build-core.mjs).
 * They are precached because the very first visit loads them before the worker
 * is activated, which would otherwise leave offline support empty.
 */
const BUILD_ENTRY_ASSETS = [];

/* -------------------------------------------------------------------------- */
/* URL helpers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Absolute URL of the worker scope.
 * `/pendrops/` on GitHub Pages, `/` on localhost and custom domains.
 */
function resolveScopeUrl() {
  const scope = self.registration && self.registration.scope;
  if (scope) {
    try {
      const parsed = new URL(scope);
      // A scope from another origin must never be trusted for asset resolution.
      if (parsed.origin === self.location.origin) return parsed;
    } catch {
      // fall through to the worker location
    }
  }
  return new URL('./', self.location.href);
}

const SCOPE_URL = resolveScopeUrl();
const BASE_URL = SCOPE_URL.href.endsWith('/') ? SCOPE_URL.href : `${SCOPE_URL.href}/`;

/** Absolute URL for a scope-relative asset path. */
function assetUrl(path) {
  return new URL(path, BASE_URL).href;
}

/** Pathname (no origin) for a scope-relative asset path — for comparisons. */
function assetPath(path) {
  return new URL(path, BASE_URL).pathname;
}

const INDEX_URL = assetUrl('index.html');
const SHARE_HANDLER_PATH_ABS = assetPath(SHARE_HANDLER_PATH);

/* -------------------------------------------------------------------------- */
/* Precache                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Assets without which the PWA cannot start, render or show a schedule.
 * `cache.addAll` rejects when any entry fails, which fails the install.
 */
const CRITICAL_ASSETS = Object.freeze([
  BASE_URL,
  INDEX_URL,
  assetUrl('manifest.json'),
  assetUrl('xlsx.full.min.js'),
  assetUrl('icons/icon.svg'),
  assetUrl('icons/icon-192.png'),
  assetUrl('icons/icon-512.png'),
  assetUrl(VERSION_PATH),
  assetUrl(SCHEDULE_PATH),
  ...BUILD_ENTRY_ASSETS.map((path) => assetUrl(path)),
]);

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Fail closed: a partially precached worker is worse than no worker.
      await cache.addAll(CRITICAL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // A previous build's caches are disposable...
          .filter(
            (key) =>
              (key.startsWith('schedule-pwa-') || LEGACY_CACHES.includes(key)) &&
              !KEEP_CACHES.includes(key)
          )
          // ...but the shared file handed over by the OS is not.
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

/* -------------------------------------------------------------------------- */
/* Fetch                                                                       */
/* -------------------------------------------------------------------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Cross-origin (Supabase REST/Realtime, CDNs) is never intercepted or cached.
  if (url.origin !== self.location.origin) return;

  if (request.method === 'POST') {
    if (url.pathname === SHARE_HANDLER_PATH_ABS) {
      event.respondWith(handleShare(event));
    }
    // Other POSTs are left to the network untouched.
    return;
  }

  if (request.method !== 'GET') return;

  if (url.pathname === assetPath(VERSION_PATH) || url.pathname === assetPath(SCHEDULE_PATH)) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(INDEX_URL).then((cached) => cached || Response.error())
      )
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstWithCache(request) {
  const cache = await caches.open(REMOTE_SCHEDULE_CACHE);
  // Cache under a stable, same-origin key: the query string is a cache-buster
  // and must not fragment the cached snapshot.
  const key = new URL(request.url);
  key.search = '';
  try {
    // Bypass the HTTP cache: the schedule is versioned through version.json.
    const fresh = await fetch(new Request(key.href, { cache: 'no-store', credentials: 'omit' }));
    if (fresh && fresh.status === 200) {
      await cache.put(key.href, fresh.clone());
    }
    return fresh;
  } catch (error) {
    // Fall back to any cached copy, including the precached snapshot: a failed
    // refresh must never remove data the device already has.
    const cached = (await cache.match(key.href)) || (await caches.match(key.href));
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(RUNTIME_CACHE);
  // Precache and runtime caches are separate buckets, so the lookup must span
  // all of them: an asset precached at install time is served offline even
  // though it was never seen by a request the worker could intercept.
  const cached = (await runtime.match(request)) || (await caches.match(request));
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        await runtime.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    // Refresh in the background; the cached copy is returned immediately.
    void network;
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return Response.error();
}

/* -------------------------------------------------------------------------- */
/* Share target                                                                */
/* -------------------------------------------------------------------------- */

async function handleShare(event) {
  try {
    const formData = await event.request.formData();
    const file = formData.get('file');
    if (file && typeof file === 'object' && 'stream' in file) {
      const name = file.name || 'shared.xls';
      const lower = name.toLowerCase();
      let type = file.type;
      if (!type || type === 'application/octet-stream') {
        if (lower.endsWith('.xlsx')) {
          type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        } else if (lower.endsWith('.xls')) {
          type = 'application/vnd.ms-excel';
        } else if (lower.endsWith('.csv')) {
          type = 'text/csv';
        }
      }
      const headers = new Headers();
      headers.set('Content-Type', type);
      headers.set('X-File-Name', encodeURIComponent(name));
      const response = new Response(file.stream(), { status: 200, headers });
      const cache = await caches.open(SHARED_CACHE);
      await cache.put(SHARED_FILE_KEY, response);
    }
    return Response.redirect(assetUrl(SHARE_HANDLER_PATH), 303);
  } catch (error) {
    console.warn('[SW] share target failed', error);
    return Response.redirect(INDEX_URL, 303);
  }
}

/* -------------------------------------------------------------------------- */
/* Schedule update messaging                                                   */
/* -------------------------------------------------------------------------- */

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-schedule') {
    event.waitUntil(checkScheduleUpdate());
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'check-schedule') {
    const port = event.ports && event.ports[0];
    const work = checkScheduleUpdate();
    if (port) {
      event.waitUntil(
        work.then(
          (result) => port.postMessage({ type: 'check-schedule-result', ...result }),
          () => port.postMessage({ type: 'check-schedule-result', status: 'error' })
        )
      );
    } else {
      event.waitUntil(work);
    }
    return;
  }
  if (data.type === 'skip-waiting') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'get-schedule-version') {
    const port = event.ports && event.ports[0];
    if (port) {
      event.waitUntil(
        readCachedVersion().then((version) =>
          port.postMessage({ type: 'schedule-version', version })
        )
      );
    }
  }
});

async function readCachedVersion() {
  const cache = await caches.open(REMOTE_SCHEDULE_CACHE);
  const response = await cache.match(assetUrl(VERSION_PATH));
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Downloads a newer schedule snapshot into the schedule cache and notifies
 * clients exactly once per version. Never deletes or clears cached data.
 */
async function checkScheduleUpdate() {
  try {
    const cache = await caches.open(REMOTE_SCHEDULE_CACHE);
    const versionResponse = await fetch(assetUrl(VERSION_PATH), {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!versionResponse.ok) return { status: 'unavailable' };

    const version = await versionResponse.json();
    if (!version || typeof version.updated !== 'string') return { status: 'invalid-version' };

    const cached = await readCachedVersion();
    if (cached && cached.updated === version.updated && cached.version === version.version) {
      return { status: 'up-to-date', version: version.version, updated: version.updated };
    }

    const scheduleResponse = await fetch(assetUrl(SCHEDULE_PATH), {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!scheduleResponse.ok) return { status: 'unavailable' };

    const body = await scheduleResponse.clone().arrayBuffer();
    await cache.put(
      assetUrl(VERSION_PATH),
      new Response(JSON.stringify(version), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await cache.put(
      assetUrl(SCHEDULE_PATH),
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/vnd.ms-excel' } })
    );

    await notifyClients({
      type: 'schedule-updated',
      version: version.version || '',
      updated: version.updated,
    });
    return { status: 'updated', version: version.version || '', updated: version.updated };
  } catch (error) {
    console.warn('[SW] checkScheduleUpdate failed', error);
    return { status: 'error' };
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(message);
  }
}
