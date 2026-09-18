/**
 * Debug Logging Utility
 * Enables debug logging in development or via localStorage toggle
 */

const DEBUG = import.meta.env.DEV || localStorage.getItem('pendrops_debug') === 'true';

export function setDebug(enabled: boolean) {
  localStorage.setItem('pendrops_debug', enabled ? 'true' : 'false');
  location.reload();
}

export function isDebug(): boolean {
  return DEBUG;
}

export function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[DEBUG]', ...args);
}

export function debugWarn(...args: unknown[]) {
  if (DEBUG) console.warn('[DEBUG]', ...args);
}

export function debugError(...args: unknown[]) {
  if (DEBUG) console.error('[DEBUG]', ...args);
}