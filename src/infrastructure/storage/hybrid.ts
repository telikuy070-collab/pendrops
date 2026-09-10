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

export class HybridStorage implements IStorage {
  async get<T>(key: string): Promise<T | null> {
    // Try localStorage first (synchronous, faster)
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      // Fall through to IndexedDB
    }

    // Try IndexedDB
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result as T | null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const json = JSON.stringify(value);
    
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