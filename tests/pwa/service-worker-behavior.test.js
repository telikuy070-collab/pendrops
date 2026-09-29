import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

/**
 * The worker is executed in a minimal Service Worker sandbox: real `caches`
 * semantics, a controllable `fetch`, and the same globals a browser provides.
 * This turns the URL/scope/caching rules into executable assertions instead of
 * source-pattern checks.
 */
function createWorker({ scope = 'https://user.github.io/pendrops/' } = {}) {
  const origin = new URL(scope).origin;
  const listeners = new Map();
  const stores = new Map();
  const requests = [];

  const keyOf = (request) => (typeof request === 'string' ? request : request.url);

  const makeCache = (name) => ({
    async addAll(urls) {
      const store = stores.get(name);
      for (const url of urls) {
        const response = await globalThis.__fetch__(url, { precache: true });
        // Real Cache.addAll rejects on a non-ok response; the worker relies on
        // that to fail closed.
        if (!response || !response.ok) throw new Error('precache failed: ' + url);
        store.set(url, { response });
      }
    },
    async match(request) {
      const key = keyOf(request);
      const entry = stores.get(name).get(key);
      return entry ? entry.response.clone() : undefined;
    },
    async put(request, response) {
      stores.get(name).set(keyOf(request), { response });
    },
    async keys() {
      return [...stores.get(name).keys()].map((url) => ({ url }));
    },
    async delete(key) {
      return stores.get(name).delete(key);
    },
  });

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeCache(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(request) {
      for (const name of stores.keys()) {
        const hit = await makeCache(name).match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  let skipped = false;
  let claimed = false;
  const self = {
    location: { href: new URL('sw.js', scope).href, origin },
    registration: { scope },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    clients: {
      async matchAll() {
        return [{ postMessage: (message) => self.__posted.push(message) }];
      },
      async claim() {
        claimed = true;
      },
    },
    async skipWaiting() {
      skipped = true;
    },
    __posted: [],
  };

  const context = vm.createContext({
    self,
    caches,
    Response,
    Request,
    Headers,
    URL,
    Promise,
    JSON,
    Object,
    Date,
    console: { warn() {}, error() {}, log() {} },
    // Bound late so tests can swap the network behaviour.
    fetch: (...args) => globalThis.__fetch__(...args),
  });
  globalThis.__fetch__ = async () => {
    throw new Error('network unavailable');
  };
  vm.runInContext(source, context, { filename: 'sw.js' });

  async function dispatch(type, event) {
    const handler = listeners.get(type);
    if (!handler) throw new Error(`no listener for ${type}`);
    const pending = [];
    const dispatched = {
      ...event,
      waitUntil: (promise) => pending.push(Promise.resolve(promise)),
      respondWith: (promise) => {
        dispatched.__responded = true;
        dispatched.__response = Promise.resolve(promise);
      },
    };
    handler(dispatched);
    await Promise.all(pending);
    // `__response` stays a promise so tests can await it themselves; `null`
    // means the worker did not intercept the request.
    return dispatched.__responded ? dispatched : null;
  }

  return {
    self,
    stores,
    requests,
    dispatch,
    responded: (result) => Boolean(result && result.__responded),
    skipped: () => skipped,
    claimed: () => claimed,
    online(fetchImpl) {
      globalThis.__fetch__ = fetchImpl;
    },
    offline() {
      globalThis.__fetch__ = async () => {
        throw new Error('offline');
      };
    },
  };
}

/** Network stub that serves the precache set and records what was requested. */
function network(requests, base = 'https://user.github.io/pendrops/') {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    requests.push(url);
    if (!url.startsWith(base)) throw new Error('unexpected origin: ' + url);
    return new Response(`body:${new URL(url).pathname}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  };
}

describe('service worker install', () => {
  it('precaches the critical assets and takes over immediately', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached.length).toBeGreaterThanOrEqual(9);
    expect(cached).toContain('https://user.github.io/pendrops/');
    expect(cached).toContain('https://user.github.io/pendrops/index.html');
    expect(cached).toContain('https://user.github.io/pendrops/data/schedule.xls');
    expect(cached).toContain('https://user.github.io/pendrops/data/version.json');
    expect(worker.skipped()).toBe(true);
  });

  it('fails closed when a critical asset cannot be precached', async () => {
    const worker = createWorker();
    worker.online(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('data/schedule.xls')) return new Response('', { status: 404 });
      return new Response('ok', { status: 200 });
    });
    await expect(worker.dispatch('install', {})).rejects.toThrow();
  });
});

describe('service worker fetch routing', () => {
  it('never intercepts cross-origin requests', async () => {
    const worker = createWorker();
    worker.online(network([]));
    const result = await worker.dispatch('fetch', {
      request: new Request('https://bnzcfhtmzvxxiwfkdryn.supabase.co/rest/v1/lessons'),
    });
    expect(result).toBeNull();
  });

  it('serves a precached asset offline (precache and runtime are different buckets)', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    worker.offline();
    const event = await worker.dispatch('fetch', {
      request: new Request('https://user.github.io/pendrops/icons/icon.svg'),
    });
    const response = await event.__response;
    expect(await response.text()).toBe('body:/pendrops/icons/icon.svg');
  });

  it('falls back to the cached schedule data when the network fails', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    worker.offline();
    const event = await worker.dispatch('fetch', {
      request: new Request('https://user.github.io/pendrops/data/version.json'),
    });
    const response = await event.__response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('body:/pendrops/data/version.json');
  });

  it('recognises the share handler POST by pathname', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    const body = new FormData();
    body.set('file', new Blob(['a,b,c'], { type: 'text/csv' }), 'schedule.csv');
    const event = await worker.dispatch('fetch', {
      request: new Request('https://user.github.io/pendrops/share-handler.html', {
        method: 'POST',
        body,
      }),
    });
    const response = await event.__response;
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://user.github.io/pendrops/share-handler.html'
    );
  });

  it('keeps a shared file under a version-independent key with a derived type', async () => {
    const worker = createWorker();
    worker.online(network([]));
    await worker.dispatch('install', {});

    const body = new FormData();
    // An untyped blob: the MIME type has to come from the file extension.
    body.set('file', new Blob(['a,b,c']), 'week-38.xls');
    const event = await worker.dispatch('fetch', {
      request: new Request('https://user.github.io/pendrops/share-handler.html', {
        method: 'POST',
        body,
      }),
    });
    await event.__response;

    const store = worker.stores.get('pendrops-shared');
    expect(store).toBeDefined();
    const entry = store.get('__shared_schedule__');
    expect(entry).toBeDefined();
    expect(entry.response.headers.get('Content-Type')).toBe('application/vnd.ms-excel');
    expect(entry.response.headers.get('X-File-Name')).toBe(encodeURIComponent('week-38.xls'));
  });

  it('serves the data route from the network under a query-free cache key', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    // The app appends a cache-buster; the route must still match by pathname.
    const event = await worker.dispatch('fetch', {
      request: new Request('https://user.github.io/pendrops/data/version.json?t=1758000000000'),
    });
    expect((await event.__response).status).toBe(200);
    expect(requests).toContain('https://user.github.io/pendrops/data/version.json');

    const store = worker.stores.get('schedule-pwa-BUILDSTAMP-schedule');
    expect(store.get('https://user.github.io/pendrops/data/version.json')).toBeDefined();
    expect([...store.keys()].some((key) => key.includes('t=1758000000000'))).toBe(false);
  });

  it('does not intercept cross-origin POSTs (Supabase RPC, Edge Functions)', async () => {
    const worker = createWorker();
    worker.online(network([]));
    await worker.dispatch('install', {});

    const result = await worker.dispatch('fetch', {
      request: new Request(
        'https://bnzcfhtmzvxxiwfkdryn.supabase.co/functions/v1/publish-schedule',
        { method: 'POST', body: '{}' }
      ),
    });
    expect(result).toBeNull();
  });

  it('serves the cached shell for an offline navigation', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    worker.offline();
    const event = await worker.dispatch('fetch', {
      // `mode: navigate` cannot be constructed with Node's Request.
      request: { url: 'https://user.github.io/pendrops/', method: 'GET', mode: 'navigate' },
    });
    const response = await event.__response;
    expect(response.status).toBe(200);
  });
});

describe('service worker scope handling', () => {
  it('works unchanged at the site root', async () => {
    const requests = [];
    const worker = createWorker({ scope: 'https://user.github.io/' });
    worker.online(network(requests, 'https://user.github.io/'));
    await worker.dispatch('install', {});
    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached).toContain('https://user.github.io/');
    expect(cached).toContain('https://user.github.io/data/schedule.xls');
  });

  it('ignores a cross-origin scope and falls back to the worker location', async () => {
    const requests = [];
    const worker = createWorker({ scope: 'https://user.github.io/pendrops/' });
    worker.self.registration.scope = 'https://evil.example/';
    worker.online(network(requests));
    await worker.dispatch('install', {});
    const cached = [...worker.stores.values()].flatMap((store) => [...store.keys()]);
    expect(cached.some((url) => url.startsWith('https://evil.example'))).toBe(false);
    expect(cached).toContain('https://user.github.io/pendrops/index.html');
  });
});

describe('service worker cache lifecycle', () => {
  it('deletes retired caches, keeps current ones and claims clients', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    // A previous build's caches: versioned, plus the flat names of the retired
    // worker versions, plus a cache that belongs to another app.
    worker.stores.set('schedule-pwa-1758134400000', new Map());
    worker.stores.set('schedule-pwa-1758134400000-runtime', new Map());
    worker.stores.set('shared-files', new Map());
    worker.stores.set('remote-schedule-v1', new Map());
    worker.stores.set('someone-elses-cache', new Map());
    worker.stores.set('pendrops-shared', new Map([['__shared_schedule__', { response: 'kept' }]]));

    await worker.dispatch('activate', {});

    expect([...worker.stores.keys()].sort()).toEqual([
      'pendrops-shared',
      'schedule-pwa-BUILDSTAMP',
      'someone-elses-cache',
    ]);
    expect(worker.claimed()).toBe(true);
  });
});

describe('service worker update messaging', () => {
  it('answers check-schedule and notifies clients on a new version', async () => {
    const requests = [];
    const worker = createWorker();
    worker.online(network(requests));
    await worker.dispatch('install', {});

    const posted = [];
    const port = { postMessage: (message) => posted.push(message) };
    // The worker compares the network version with its cached copy; a changed
    // timestamp triggers a download and a single client notification.
    worker.online(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      requests.push(url);
      if (url.includes('version.json?') || url.includes('data/version.json')) {
        return new Response(JSON.stringify({ version: 'W38', updated: '2026-09-26T00:00:00Z' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('snapshot', { status: 200 });
    });

    await worker.dispatch('message', { data: { type: 'check-schedule' }, ports: [port] });
    await new Promise((r) => setTimeout(r, 0));

    const results = posted.filter((message) => message.type === 'check-schedule-result');
    expect(results.length).toBe(1);
    expect(results[0].status).toBe('updated');
    expect(results[0].version).toBe('W38');
    expect(worker.self.__posted.filter((m) => m.type === 'schedule-updated')).toHaveLength(1);

    // A second check with the same version is a no-op: one toast per version.
    await worker.dispatch('message', { data: { type: 'check-schedule' }, ports: [port] });
    await new Promise((r) => setTimeout(r, 0));
    expect(worker.self.__posted.filter((m) => m.type === 'schedule-updated')).toHaveLength(1);
  });
});
