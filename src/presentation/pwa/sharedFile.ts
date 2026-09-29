/**
 * Receiving a workbook shared into the PWA.
 *
 * Flow, end to end:
 *  1. `public/manifest.json` declares a `share_target` pointing at
 *     `share-handler.html`.
 *  2. The Service Worker intercepts that multipart POST, stores the uploaded
 *     file in Cache Storage and answers with a 303 to the same URL.
 *  3. `public/share-handler.html` is a dumb landing page that forwards to
 *     `index.html?shared=1`.
 *  4. This module reads the stored workbook back and hands it to the admin
 *     dialog, which prefills it for publishing.
 *
 * The cache name and key below must stay identical to the constants in
 * `public/sw.js`; the Service Worker is a static file and cannot import them.
 */

/** Must match `SHARED_CACHE` in public/sw.js. */
const SHARED_CACHE = 'pendrops-shared';
/** Must match `SHARED_FILE_KEY` in public/sw.js. */
const SHARED_FILE_KEY = '__shared_schedule__';

/** Query flag the landing page appends. */
const SHARED_FLAG = 'shared';

export interface SharedWorkbook {
  file: File;
  name: string;
}

/** True when the app was opened through the share target. */
export function isSharedLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(SHARED_FLAG) === '1';
}

/**
 * Drops the `?shared=1` marker so a reload does not re-run the pickup and the
 * address bar stays clean once the file has been consumed.
 */
export function clearSharedLaunchFlag(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARED_FLAG)) return;
  url.searchParams.delete(SHARED_FLAG);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Takes the shared workbook out of Cache Storage.
 *
 * The entry is deleted on success: it is a one-shot handoff, and keeping it
 * around would silently re-publish a stale file on the next share.
 */
export async function takeSharedWorkbook(): Promise<SharedWorkbook | null> {
  if (typeof caches === 'undefined' || typeof File === 'undefined') return null;
  try {
    const cache = await caches.open(SHARED_CACHE);
    const hit = await cache.match(SHARED_FILE_KEY);
    if (!hit) return null;

    const rawName = hit.headers.get('X-File-Name');
    let name = 'schedule.xls';
    try {
      name = rawName ? decodeURIComponent(rawName) : name;
    } catch {
      // A malformed header must not lose the file: fall back to the default.
    }
    const type = hit.headers.get('Content-Type') || '';
    const blob = await hit.blob();
    await cache.delete(SHARED_FILE_KEY);

    return { file: new File([blob], name, { type }), name };
  } catch {
    // Cache Storage is unavailable in private mode: the user can still pick the
    // file by hand in the admin dialog, so this is a silent no-op.
    return null;
  }
}
