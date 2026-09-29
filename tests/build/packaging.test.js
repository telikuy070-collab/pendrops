import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SW_CACHE_VERSION_LITERAL,
  createReleaseManifest,
  describeScheduleSnapshot,
  readPackageVersion,
  readScheduleSnapshot,
  resolveSourceSha,
  stampServiceWorker,
  validateScheduleSnapshot,
} from '../../scripts/build-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('version single source of truth', () => {
  it('reads the semantic version from package.json', () => {
    expect(readPackageVersion(root)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('keeps the runtime version constant in sync with package.json', async () => {
    const constants = readFileSync(resolve(root, 'src/constants.js'), 'utf8');
    // No hand-maintained version literal is allowed next to the define.
    expect(constants).toContain('__APP_VERSION__');
    expect(constants).not.toMatch(/APP_VERSION\s*=\s*'\d+\.\d+\.\d+'/);
  });
});

describe('schedule snapshot validation (fail closed)', () => {
  const valid = {
    exists: true,
    fileSize: 100,
    fileSha256: 'a'.repeat(64),
    snapshot: { version: 'W37', updated: '2026-09-12T20:50:16.582Z', size: 100 },
  };

  it('accepts a consistent snapshot', () => {
    expect(validateScheduleSnapshot(valid)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a missing workbook', () => {
    const result = validateScheduleSnapshot({ ...valid, exists: false });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/missing/);
  });

  it('rejects a missing or invalid version.json', () => {
    expect(validateScheduleSnapshot({ ...valid, snapshot: null }).ok).toBe(false);
  });

  it('rejects a version.json without version or updated fields', () => {
    expect(validateScheduleSnapshot({ ...valid, snapshot: { size: 100 } }).ok).toBe(false);
    expect(validateScheduleSnapshot({ ...valid, snapshot: { version: 'W37', size: 100 } }).ok).toBe(
      false
    );
  });

  it('rejects a size that does not match the workbook', () => {
    const result = validateScheduleSnapshot({
      ...valid,
      snapshot: { ...valid.snapshot, size: 99 },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/does not match/);
  });

  it('validates the snapshot that is actually tracked in the repository', () => {
    const read = readScheduleSnapshot(root);
    expect(validateScheduleSnapshot(read)).toEqual({ ok: true, errors: [] });
  });
});

describe('release manifest', () => {
  it('records version, build stamp, source SHA and snapshot metadata only', () => {
    const manifest = createReleaseManifest({
      appVersion: '1.7.0',
      buildTimestamp: 1758134400000,
      sourceSha: 'b'.repeat(40),
      schedule: {
        version: 'W37',
        updated: '2026-09-12T20:50:16.582Z',
        size: 10,
        sha256: 'c'.repeat(64),
      },
    });

    expect(manifest.appVersion).toBe('1.7.0');
    expect(manifest.builtAt).toBe(new Date(1758134400000).toISOString());
    expect(manifest.sourceSha).toBe('b'.repeat(40));
    expect(manifest.schedule).toEqual({
      version: 'W37',
      updated: '2026-09-12T20:50:16.582Z',
      size: 10,
      sha256: 'c'.repeat(64),
    });
    // Metadata only: no nested payload, no keys, no tokens.
    expect(Object.keys(manifest).sort()).toEqual([
      'appVersion',
      'buildTimestamp',
      'builtAt',
      'schedule',
      'schemaVersion',
      'sourceSha',
    ]);
  });

  it('tolerates a build without git metadata instead of failing', () => {
    const sha = resolveSourceSha(root);
    expect(sha === null || /^[0-9a-f]{40}$/.test(sha)).toBe(true);
  });

  it('never prints schedule contents in its summary', () => {
    const read = readScheduleSnapshot(root);
    const description = describeScheduleSnapshot(read);
    expect(description).toMatch(/^schedule snapshot: version=/);
    expect(description).toContain('sha256=');
  });
});

describe('service worker build stamp', () => {
  const source = readFileSync(resolve(root, 'public/sw.js'), 'utf8');

  it('keeps the build-time placeholder in the source worker', () => {
    expect(source).toContain(SW_CACHE_VERSION_LITERAL);
  });

  it('replaces the placeholder with the build stamp', () => {
    const stamped = stampServiceWorker(source, 1758134400000);
    expect(stamped).toContain("const CACHE_VERSION = 'schedule-pwa-1758134400000';");
    expect(stamped).not.toContain('BUILDSTAMP');
  });

  it('fails closed when the worker has no cache-version declaration', () => {
    expect(() => stampServiceWorker('// no worker here', 1)).toThrow(/CACHE_VERSION/);
  });

  it('derives every asset URL from an absolute base', () => {
    // A pathname-based base used to throw "Invalid base URL" at module
    // evaluation, which prevented the worker from installing at all.
    expect(source).toMatch(/const BASE_URL = SCOPE_URL\.href/);
    expect(source).not.toMatch(/return url\.pathname\.endsWith/);
  });
});
