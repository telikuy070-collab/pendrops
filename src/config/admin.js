/**
 * Centralized admin configuration.
 *
 * This module reads sensitive values from environment variables (via Vite's
 * import.meta.env at build time, or process.env in Node/test contexts) and
 * provides sensible dev fallbacks. In production, the env vars must be set
 * externally — they can not be truly "hidden" in client-side JS, but moving
 * them to config means the values aren't littered in source code and can be
 * changed per-environment without code edits.
 *
 * Security note: The PIN and GitHub token are *client-side secrets* — they
 * are visible to anyone who opens DevTools. The real protection is the
 * encrypted admin.json blob fetched from the repo. This config merely centralizes
 * the values so they're not hardcoded in business logic.
 */

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

/** @type {Record<string, string | undefined>} */
const _env =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : typeof process !== 'undefined' && process.env
      ? process.env
      : {};

/**
 * Get an environment variable with an optional fallback.
 * Falls back to the default only in dev mode — in production a missing
 * required var throws so the misconfiguration is caught at build/runtime.
 *
 * @param {string} key
 * @param {string} fallback
 * @param {boolean} [required=false]
 */
function getEnv(key, fallback, required = false) {
  const val = _env[key];
  if (val !== undefined && val !== '') return val;
  if (isDev) return fallback;
  if (required) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        'Set it in your .env file or deployment environment.'
    );
  }
  return fallback;
}

export const ADMIN_CONFIG = Object.freeze({
  /** Admin PIN for the local unlock step */
  pin: getEnv('VITE_ADMIN_PIN', '6137'),
  /** GitHub repository in "owner/repo" format */
  repo: getEnv('VITE_GITHUB_REPO', 'telikuy070-collab/pendrops'),
  /** Git branch to publish to */
  branch: getEnv('VITE_GITHUB_BRANCH', 'main'),
});

/** Split "owner/repo" into parts. */
export const REPO_PARTS = ADMIN_CONFIG.repo.split('/');

export const ADMIN_BLOB_URL = Object.freeze(
  `https://raw.githubusercontent.com/${ADMIN_CONFIG.repo}/${ADMIN_CONFIG.branch}/data/admin.json`
);

export const CONTENTS_API = Object.freeze(
  `https://api.github.com/repos/${ADMIN_CONFIG.repo}/contents`
);
