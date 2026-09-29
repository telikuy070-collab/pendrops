import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const swSource = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

/**
 * These checks are static on purpose: the worker needs a real Service Worker
 * global to execute, but the regressions they guard (pathname/URL mixing,
 * silent precache failures, cross-origin caching) are all decidable from the
 * source.
 */
describe('service worker url handling', () => {
  it('has exactly one production worker source in the repository', () => {
    // The legacy root-level duplicate was unreferenced and is removed; a
    // second worker source would silently diverge again.
    expect(() => readFileSync(resolve(root, 'sw.js'), 'utf8')).toThrow();
    expect(swSource).toContain('PenDrops Service Worker');
  });

  it('resolves an absolute base URL from the registration scope', () => {
    expect(swSource).toContain('self.registration && self.registration.scope');
    expect(swSource).toMatch(/const BASE_URL = SCOPE_URL\.href/);
  });

  it('never compares a pathname against a full URL', () => {
    // url.pathname === asset(...) is always false and silently disabled both
    // the share handler and the schedule data path.
    const pathnameAssignments = [...swSource.matchAll(/url\.pathname\s*={2,3}\s*([^;\n]+)/g)].map(
      (match) => match[1].trim()
    );
    expect(pathnameAssignments.length).toBeGreaterThan(0);
    for (const expression of pathnameAssignments) {
      expect(expression).not.toMatch(/assetUrl\(/);
      expect(expression).toMatch(/assetPath\(|SHARE_HANDLER_PATH_ABS/);
    }
  });

  it('uses one absolute-URL helper and one pathname helper', () => {
    expect(swSource).toMatch(
      /function assetUrl\(path\) \{\s*return new URL\(path, BASE_URL\)\.href;/
    );
    expect(swSource).toMatch(
      /function assetPath\(path\) \{\s*return new URL\(path, BASE_URL\)\.pathname;/
    );
  });
});

describe('service worker caching policy', () => {
  it('never intercepts or caches cross-origin requests', () => {
    expect(swSource).toMatch(/if \(url\.origin !== self\.location\.origin\) return;/);
    // Every cache write is keyed by a same-origin URL produced by a helper.
    for (const match of swSource.matchAll(/cache\.put\(([^,]+),/g)) {
      expect(match[1].trim()).not.toMatch(/request\.url/);
    }
  });

  it('fails closed when a critical precache asset is missing', () => {
    expect(swSource).toContain('await cache.addAll(CRITICAL_ASSETS);');
    expect(swSource).not.toMatch(/Promise\.allSettled\(\s*PRECACHE_ASSETS/);
  });

  it('precaches the schedule snapshot and the app shell', () => {
    for (const asset of [
      'manifest.json',
      'xlsx.full.min.js',
      'icons/icon-192.png',
      'icons/icon-512.png',
      'icons/icon.svg',
      'VERSION_PATH',
      'SCHEDULE_PATH',
    ]) {
      expect(swSource).toContain(asset);
    }
  });

  it('keeps cached schedule data when an update check fails', () => {
    const check = swSource.slice(swSource.indexOf('async function checkScheduleUpdate'));
    expect(check).not.toMatch(/caches\.delete/);
    expect(check).toContain("type: 'schedule-updated'");
  });

  it('never derives the cache version from a hardcoded timestamp', () => {
    // A committed `Date.now()` stamp freezes the cache name forever; the version
    // is a build placeholder replaced by scripts/build-core.mjs instead.
    expect(swSource).not.toMatch(/Date\.now|Math\.floor\(Date/);
    expect(swSource).toContain("const CACHE_VERSION = 'schedule-pwa-BUILDSTAMP';");
  });

  it('deletes caches of previous builds, including the retired flat names', () => {
    // Prefix matching alone missed the unversioned names of older workers.
    for (const legacy of ['shared-files', 'remote-schedule-v1']) {
      expect(swSource).toContain(`'${legacy}'`);
    }
    const activate = swSource.slice(swSource.indexOf("self.addEventListener('activate'"));
    expect(activate).toContain('KEEP_CACHES');
  });

  it('does not version the shared-file cache', () => {
    // A file handed over by the OS is user data, not a build artifact: it must
    // survive the cache-version bump that follows every deploy.
    expect(swSource).toMatch(/const SHARED_CACHE = 'pendrops-shared';/);
    expect(swSource).toMatch(/const KEEP_CACHES = Object\.freeze\(\[CACHE, RUNTIME_CACHE/);
  });
});

describe('service worker share target contract', () => {
  it('redirects to the same page the manifest declares', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'));
    const action = new URL(manifest.share_target.action, 'https://host/').pathname.split('/').pop();
    const swPath = /const SHARE_HANDLER_PATH = '([^']+)'/.exec(swSource);
    expect(swPath).not.toBeNull();
    expect(action).toBe(swPath[1]);
    expect(swSource).toContain('Response.redirect(assetUrl(SHARE_HANDLER_PATH), 303)');
  });
});

describe('service worker update messaging', () => {
  it('handles check-schedule, skip-waiting and version queries', () => {
    for (const type of ['check-schedule', 'skip-waiting', 'get-schedule-version']) {
      expect(swSource).toContain(`data.type === '${type}'`);
    }
    expect(swSource).toContain("event.tag === 'check-schedule'");
  });
});
