import { STORAGE_KEY } from './constants.js';

/**
 * @typedef {{ day: string, time: string, para: string, group: string, subgroup: string,
 *             subject: string, type: string, teacher: string, room: string }} Lesson
 * @typedef {{ sheets: Record<string, Lesson[]>, current: string, group: string,
 *             fileName?: string, loadedAt?: number }} WorkbookState
 */

const IDB_NAME = 'pendrops-store';
const IDB_STORE = 'state';
const IDB_HANDLES = 'handles';
const IDB_KEY = STORAGE_KEY;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(IDB_HANDLES)) db.createObjectStore(IDB_HANDLES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  try {
    const db = await openIDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(value) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export function emptyState() {
  return { sheets: {}, current: '', group: '' };
}

/**
 * Загружает state. Сначала пробует localStorage (быстрее), затем IndexedDB
 * (если localStorage заблокирован / quota exceeded). Возвращает дефолт при ошибке.
 *
 * @returns {Promise<WorkbookState>}
 */
export async function loadState() {
  // 1. localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const valid = validateState(parsed);
      if (valid) return valid;
    }
  } catch { /* fallback ниже */ }

  // 2. IndexedDB fallback
  const fromIdb = await idbGet();
  if (fromIdb) {
    const valid = validateState(fromIdb);
    if (valid) return valid;
  }

  return emptyState();
}

/**
 * Сохраняет state. Сначала в localStorage, при quota ошибке — в IndexedDB.
 * Возвращает 'ls' | 'idb' | 'none' — caller может предупредить пользователя.
 *
 * @param {WorkbookState} state
 * @returns {Promise<'ls'|'idb'|'none'>}
 */
export async function saveState(state) {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, json);
    return 'ls';
  } catch (e) {
    const ok = await idbSet(json);
    return ok ? 'idb' : 'none';
  }
}

function validateState(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.sheets || typeof parsed.sheets !== 'object' || Array.isArray(parsed.sheets)) return null;
  return {
    sheets: parsed.sheets,
    current: parsed.current || Object.keys(parsed.sheets)[0] || '',
    group: parsed.group || '',
    fileName: parsed.fileName || '',
    loadedAt: parsed.loadedAt || 0
  };
}

export async function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  try {
    const db = await openIDB();
    await new Promise((resolve) => {
      const tx = db.transaction([IDB_STORE, IDB_HANDLES], 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.objectStore(IDB_HANDLES).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {}
}

/**
 * Сохраняет FileSystemFileHandle в IDB, чтобы потом открыть файл одной кнопкой
 * без повторного поиска. Поддерживается только в браузерах с File System Access API.
 * @param {string} name — имя handle (например, последний открытый файл)
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<boolean>}
 */
export async function saveHandle(name, handle) {
  if (!handle || typeof indexedDB === 'undefined') return false;
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_HANDLES, 'readwrite');
      tx.objectStore(IDB_HANDLES).put(handle, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Загружает FileSystemFileHandle по имени.
 * @param {string} name
 * @returns {Promise<FileSystemFileHandle|null>}
 */
export async function loadHandle(name) {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_HANDLES, 'readonly');
      const req = tx.objectStore(IDB_HANDLES).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
