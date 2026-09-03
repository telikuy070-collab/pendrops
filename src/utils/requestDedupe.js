/**
 * Request deduplication utility.
 *
 * Prevents identical concurrent network requests from racing to complete.
 * The first call with a given key executes the function; subsequent calls
 * with the same key while the first is in-flight receive the same promise.
 * Once the promise settles, the entry is removed from the map.
 *
 * This is especially useful for the periodic sync / pull-to-refresh paths
 * where multiple components might trigger `fetchRemoteVersion()` simultaneously.
 */
const pending = new Map();

/**
 * @template T
 * @param {string} key - deduplication key (e.g. URL or operation name)
 * @param {() => Promise<T>} fn - the async operation to dedupe
 * @returns {Promise<T>} - the result of fn (shared across concurrent callers)
 */
export async function dedupe(key, fn) {
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = fn().finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

/**
 * Check how many dedupe keys are currently in flight (for diagnostics).
 * @returns {number}
 */
export function pendingRequestCount() {
  return pending.size;
}
