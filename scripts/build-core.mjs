/**
 * Build & release packaging core.
 *
 * Pure helpers shared by the Vite build, the `verify:data` CLI and the unit
 * tests. Nothing in this module prints file contents or credentials: only
 * metadata (version, byte size, SHA-256 digest) is ever produced.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Placeholder replaced in `public/sw.js` at build time. */
export const SW_CACHE_VERSION_PATTERN = /const CACHE_VERSION = 'schedule-pwa-[^']*';/;

/** The exact literal the Service Worker source must still contain. */
export const SW_CACHE_VERSION_LITERAL = "const CACHE_VERSION = 'schedule-pwa-BUILDSTAMP';";

/** The exact literal the build replaces with the hashed entry assets. */
export const SW_ENTRY_ASSETS_LITERAL = 'const BUILD_ENTRY_ASSETS = [];';

/**
 * @param {string} root repository root
 * @returns {string} semantic version from package.json
 */
export function readPackageVersion(root) {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = packageJson && packageJson.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('package.json has no valid semantic version');
  }
  return version;
}

/**
 * Source SHA of the build, when the build runs inside a git checkout.
 * Returns null instead of failing: a source-less build is reported, not hidden.
 *
 * @param {string} root repository root
 * @returns {string|null}
 */
export function resolveSourceSha(root) {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Reads the canonical schedule snapshot metadata.
 * `data/schedule.xls` and `data/version.json` are the only tracked sources.
 *
 * @param {string} root repository root
 * @returns {{schedulePath: string, versionPath: string, snapshot: object|null,
 *            fileSize: number|null, fileSha256: string|null, exists: boolean}}
 */
export function readScheduleSnapshot(root) {
  const schedulePath = resolve(root, 'data', 'schedule.xls');
  const versionPath = resolve(root, 'data', 'version.json');
  const exists = existsSync(schedulePath);

  if (!exists) {
    return {
      schedulePath,
      versionPath,
      snapshot: null,
      fileSize: null,
      fileSha256: null,
      exists: false,
    };
  }

  const bytes = readFileSync(schedulePath);
  let snapshot = null;
  if (existsSync(versionPath)) {
    try {
      snapshot = JSON.parse(readFileSync(versionPath, 'utf8'));
    } catch {
      snapshot = null;
    }
  }

  return {
    schedulePath,
    versionPath,
    snapshot,
    fileSize: statSync(schedulePath).size,
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    exists: true,
  };
}

/**
 * Fail-closed validation of the tracked schedule snapshot.
 *
 * @param {{snapshot: object|null, fileSize: number|null, exists: boolean}} read
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateScheduleSnapshot(read) {
  const errors = [];

  if (!read.exists) {
    errors.push('data/schedule.xls is missing: the offline snapshot cannot be packaged');
    return { ok: false, errors };
  }
  if (!read.fileSize || read.fileSize <= 0) {
    errors.push('data/schedule.xls is empty');
  }
  const snapshot = read.snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    errors.push('data/version.json is missing or not valid JSON');
    return { ok: false, errors };
  }
  if (typeof snapshot.version !== 'string' || !snapshot.version.trim()) {
    errors.push('data/version.json has no "version"');
  }
  if (typeof snapshot.updated !== 'string' || !snapshot.version?.length) {
    errors.push('data/version.json has no "updated" timestamp');
  } else if (Number.isNaN(Date.parse(snapshot.updated))) {
    errors.push('data/version.json "updated" is not an ISO timestamp');
  }
  if (typeof snapshot.size === 'number' && snapshot.size !== read.fileSize) {
    errors.push(
      `data/version.json "size" (${snapshot.size}) does not match data/schedule.xls (${read.fileSize})`
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Release manifest written to `dist/release-manifest.json`.
 * Contains metadata only — never credentials and never schedule contents.
 *
 * @param {{appVersion: string, buildTimestamp: number, sourceSha: string|null,
 *          schedule: {version: string, updated: string, size: number, sha256: string}}} input
 */
export function createReleaseManifest(input) {
  return {
    schemaVersion: 1,
    appVersion: input.appVersion,
    buildTimestamp: input.buildTimestamp,
    builtAt: new Date(input.buildTimestamp).toISOString(),
    sourceSha: input.sourceSha,
    schedule: {
      version: input.schedule.version,
      updated: input.schedule.updated,
      size: input.schedule.size,
      sha256: input.schedule.sha256,
    },
  };
}

/**
 * Content-hashed entry assets of a Vite build, derived from the build manifest.
 *
 * These are the files a first visit downloads before the Service Worker is
 * activated; without them the offline shell is empty.
 *
 * @param {Record<string, {file?: string, css?: string[], assets?: string[]}>} manifest
 * @returns {string[]} sorted, de-duplicated dist-relative paths
 */
export function collectEntryAssets(manifest) {
  const assets = new Set();
  for (const entry of Object.values(manifest || {})) {
    if (entry && typeof entry.file === 'string') assets.add(entry.file);
    for (const group of ['css', 'assets']) {
      const list = entry && entry[group];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === 'string') assets.add(item);
      }
    }
  }
  return [...assets].sort();
}

/**
 * Replaces the empty `BUILD_ENTRY_ASSETS` literal with the built asset list.
 *
 * @param {string} source contents of the built public/sw.js
 * @param {string[]} entries dist-relative asset paths
 * @returns {string}
 */
export function injectEntryAssets(source, entries) {
  if (!source.includes(SW_ENTRY_ASSETS_LITERAL)) {
    throw new Error('public/sw.js does not contain the BUILD_ENTRY_ASSETS placeholder');
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Refusing to build: no entry assets were found in the build manifest');
  }
  for (const entry of entries) {
    // Only same-origin, dist-relative paths may be injected.
    if (
      typeof entry !== 'string' ||
      entry.startsWith('/') ||
      entry.includes('..') ||
      /^[a-z]+:/i.test(entry)
    ) {
      throw new Error(`Refusing to inject a non-relative entry asset: ${String(entry)}`);
    }
  }
  return source.replace(
    SW_ENTRY_ASSETS_LITERAL,
    `const BUILD_ENTRY_ASSETS = ${JSON.stringify(entries)};`
  );
}

/**
 * Replaces the Service Worker cache placeholder with a build stamp.
 *
 * @param {string} source contents of public/sw.js
 * @param {number} buildTimestamp
 * @returns {string}
 */
export function stampServiceWorker(source, buildTimestamp) {
  if (!SW_CACHE_VERSION_PATTERN.test(source)) {
    throw new Error('public/sw.js does not contain a recognisable CACHE_VERSION declaration');
  }
  return source.replace(
    SW_CACHE_VERSION_PATTERN,
    `const CACHE_VERSION = 'schedule-pwa-${buildTimestamp}';`
  );
}

/**
 * Safe console summary of a validated snapshot (no contents, no secrets).
 *
 * @param {ReturnType<typeof readScheduleSnapshot>} read
 */
export function describeScheduleSnapshot(read) {
  if (!read.exists) return 'schedule snapshot: missing';
  const version = read.snapshot?.version ?? 'unknown';
  const updated = read.snapshot?.updated ?? 'unknown';
  return `schedule snapshot: version=${version} updated=${updated} size=${read.fileSize} sha256=${read.fileSha256}`;
}
