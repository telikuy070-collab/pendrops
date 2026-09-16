/**
 * Hybrid Storage - localStorage first, IndexedDB fallback
 * Implements IStorage port
 */
import type { IStorage } from '@core/domain/repositories/ports';

const DB_NAME = 'pendrops-storage';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not available'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function serializeStorageValue<T>(value: T): string {
  return JSON.stringify(value, (_key, currentValue) => {
    if (currentValue instanceof Map) {
      return {
        __type: 'Map',
        value: Array.from(currentValue.entries()),
      };
    }
    if (currentValue instanceof Set) {
      return {
        __type: 'Set',
        value: Array.from(currentValue.values()),
      };
    }
    return currentValue;
  });
}

function deserializeStorageValue<T>(raw: string): T {
  return JSON.parse(raw, (_key, currentValue) => {
    if (currentValue && typeof currentValue === 'object' && '__type' in currentValue) {
      const typed = currentValue as { __type: string; value: unknown };
      if (typed.__type === 'Map') {
        return new Map(typed.value as Iterable<[unknown, unknown]>);
      }
      if (typed.__type === 'Set') {
        return new Set(typed.value as Iterable<unknown>);
      }
    }
    return currentValue;
  }) as T;
}

export class HybridStorage implements IStorage {
  async get<T>(key: string): Promise<T | null> {
    // Try localStorage first (synchronous, faster)
    try {
      const raw = localStorage.getItem(key);
      if (raw) return deserializeStorageValue<T>(raw);
    } catch {
      // Fall through to IndexedDB
    }

    // Try IndexedDB
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => {
          const result = request.result as string | null;
          resolve(result ? deserializeStorageValue<T>(result) : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const json = serializeStorageValue(value);

    // Try localStorage first
    try {
      localStorage.setItem(key, json);
      return;
    } catch {
      // Fall through to IndexedDB
    }

    // Try IndexedDB
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(json, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error('[Storage] Failed to save:', err);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore
    }

    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore
    }
  }
}
