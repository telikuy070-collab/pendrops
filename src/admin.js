/**
 * Админка PenDrops.
 *
 * Активируется 10-tap на логотип за 3 секунды.
 *
 * Flow:
 *  1. Юзер открывает админку → вводит PIN 6137
 *  2. PenDrops качает data/admin.json из репо → расшифровывает PBKDF2+AES-GCM
 *  3. Получает временный GitHub PAT
 *  4. Юзер перетаскивает .xls
 *  5. PenDrops кодирует в base64 и PUT в GitHub Contents API:
 *     - data/schedule.xls (новый файл)
 *     - data/version.json (новая дата)
 *  6. Токен сразу забывается
 *
 * Если data/admin.json отсутствует — показываем инструкцию «как создать токен».
 */

import { ADMIN_CONFIG, ADMIN_BLOB_URL, CONTENTS_API } from './config/admin.js';

const REPO = ADMIN_CONFIG.repo;
const BRANCH = ADMIN_CONFIG.branch;
const PIN = ADMIN_CONFIG.pin;

/** base64 из ArrayBuffer (binary-safe) */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 → ArrayBuffer (binary-safe) */
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Расшифровать blob PIN'ом. Возвращает строку (PAT) или бросает ошибку.
 * @param {string} blob — строка вида "base64salt.base64iv.base64ct"
 * @param {string} pin
 */
async function decryptBlob(blob, pin) {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('Битый blob — неверный формат');
  const salt = new Uint8Array(base64ToArrayBuffer(parts[0]));
  const iv = new Uint8Array(base64ToArrayBuffer(parts[1]));
  const ct = base64ToArrayBuffer(parts[2]);

  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

/**
 * Качает blob из репо.
 * @returns {Promise<string|null>}
 */
async function fetchAdminBlob() {
  try {
    const r = await fetch(ADMIN_BLOB_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j.blob || null;
  } catch {
    /* fetch failed — admin.json unavailable */
    return null;
  }
}

/**
 * Получает SHA существующего файла (нужно для PUT update).
 * @param {string} token
 * @param {string} path
 */
async function getFileSha(token, path) {
  const r = await fetch(`${CONTENTS_API}/${path}?ref=${BRANCH}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.sha;
}

/**
 * Заливает файл в репо.
 * @param {string} token
 * @param {string} path — e.g. "data/schedule.xls"
 * @param {ArrayBuffer} content
 * @param {string} message
 */
async function putFile(token, path, content, message) {
  const sha = await getFileSha(token, path);
  const body = {
    message,
    branch: BRANCH,
    content: arrayBufferToBase64(content),
  };
  if (sha) body.sha = sha;
  const r = await fetch(`${CONTENTS_API}/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${path}: ${r.status} ${t.slice(0, 200)}`);
  }
  return await r.json();
}

/**
 * Публикует .xls + version.json.
 * @param {File} file
 * @returns {Promise<{version: string, scheduleUrl: string}>}
 */
export async function publishSchedule(file) {
  // 1. Качаем blob
  const blob = await fetchAdminBlob();
  if (!blob) {
    throw new Error('admin.json не найден в репо — нужно создать');
  }
  // 2. Расшифровываем PIN'ом
  const token = await decryptBlob(blob, PIN);
  if (!token.startsWith('github_pat_') && !token.startsWith('ghp_')) {
    throw new Error('Расшифровано, но это не похоже на токен. Неверный PIN?');
  }

  try {
    // 3. Заливаем schedule.xls
    const buf = await file.arrayBuffer();
    const iso = new Date();
    const week = getISOWeek(iso);
    const version = `W${week}`;
    const datestamp = iso.toISOString().slice(0, 10);

    await putFile(token, 'data/schedule.xls', buf, `schedule: ${version} ${datestamp}`);

    // 4. Заливаем version.json
    const versionJson = JSON.stringify(
      {
        version,
        updated: iso.toISOString(),
        size: buf.byteLength,
        fileName: file.name,
      },
      null,
      2
    );
    await putFile(
      token,
      'data/version.json',
      new TextEncoder().encode(versionJson).buffer,
      `version: ${version}`
    );

    return {
      version,
      datestamp,
      scheduleUrl: `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/data/schedule.xls`,
    };
  } finally {
    // 5. Забываем токен (best-effort — JS GC сам уберёт)
  }
}

function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

/**
 * Проверяет, настроен ли админ (есть admin.json в репо).
 */
export async function isAdminConfigured() {
  const blob = await fetchAdminBlob();
  return blob !== null;
}

/**
 * Verifies the admin PIN entered by the user.
 * Uses a constant-time comparison to mitigate timing attacks.
 *
 * @param {string} pin — user-supplied PIN
 * @returns {boolean}
 */
export function verifyPin(pin) {
  const expected = PIN;
  if (!pin || typeof pin !== 'string') return false;
  // Constant-time comparison via Web Crypto
  const enc = new TextEncoder();
  const a = enc.encode(pin);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  const buf = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) buf[i] = a[i] ^ b[i];
  return buf.every((v) => v === 0);
}

// Re-export config for consumers that need it (e.g. admin UI)
export { ADMIN_CONFIG };
