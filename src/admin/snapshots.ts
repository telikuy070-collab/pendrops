/**
 * Local snapshots of the published schedule, for a rollback that needs no
 * database access.
 *
 * The database has no history table and the project has no SQL access, so the
 * only place a pre-publish state can live is the device that publishes. A
 * snapshot is therefore useful on that device and nowhere else — the admin UI
 * says so in as many words rather than implying a safety net it cannot provide.
 *
 * Storage is IndexedDB behind a small backend interface: the store logic
 * (ordering, eviction, what a snapshot contains) is testable without a browser,
 * and the quota of localStorage is never a factor for a few thousand rows.
 */
import type { ScheduleData } from '../core/domain/entities/types';
import type { PublishableLesson } from '../parser/draft.ts';

/** How many snapshots are kept; the oldest is dropped beyond this. */
export const MAX_SNAPSHOTS = 3;

export interface SnapshotMeta {
  /** Creation timestamp in ISO form; also the primary key. */
  id: string;
  createdAt: string;
  /** Name of the file that was about to be published when the shot was taken. */
  fileName: string;
  /** Version that was published at the time. */
  version: string;
  count: number;
}

export interface ScheduleSnapshot extends SnapshotMeta {
  lessons: PublishableLesson[];
}

export interface SnapshotBackend {
  /** Newest first. */
  list(): Promise<SnapshotMeta[]>;
  read(id: string): Promise<ScheduleSnapshot | null>;
  write(snapshot: ScheduleSnapshot): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SnapshotStore {
  /** Newest first, already trimmed to the retention limit. */
  list(): Promise<SnapshotMeta[]>;
  save(snapshot: ScheduleSnapshot): Promise<void>;
  get(id: string): Promise<ScheduleSnapshot | null>;
}

/** Newest first; the ISO timestamp is the tie-breaker for same-millisecond saves. */
export function byNewestFirst(left: SnapshotMeta, right: SnapshotMeta): number {
  if (left.createdAt === right.createdAt) return right.id.localeCompare(left.id);
  return right.createdAt.localeCompare(left.createdAt);
}

/**
 * Retention policy: keep the newest `limit` snapshots and drop the rest.
 *
 * Saving the fourth snapshot evicts the oldest, so the storage a user can grow
 * is bounded without them having to delete anything.
 */
export function createSnapshotStore(
  backend: SnapshotBackend,
  limit: number = MAX_SNAPSHOTS
): SnapshotStore {
  return {
    async list(): Promise<SnapshotMeta[]> {
      const metas = (await backend.list()).slice().sort(byNewestFirst);
      const stale = metas.slice(limit);
      for (const meta of stale) await backend.remove(meta.id);
      return metas.slice(0, limit);
    },

    async save(snapshot: ScheduleSnapshot): Promise<void> {
      await backend.write(snapshot);
      const metas = (await backend.list()).slice().sort(byNewestFirst);
      for (const meta of metas.slice(limit)) await backend.remove(meta.id);
    },

    async get(id: string): Promise<ScheduleSnapshot | null> {
      return backend.read(id);
    },
  };
}

/**
 * The snapshot of the schedule the app is showing right now.
 *
 * Returns null when nothing is loaded: there is nothing to protect, and the
 * caller says so instead of writing an empty rollback point.
 */
export function snapshotFromSchedule(
  data: ScheduleData | null,
  fileName: string,
  now: Date = new Date()
): ScheduleSnapshot | null {
  if (!data) return null;
  const lessons: PublishableLesson[] = [];
  for (const sheetLessons of data.sheets.values()) {
    for (const lesson of sheetLessons) {
      lessons.push({
        sheetId: lesson.sheetId,
        day: lesson.day,
        dayOrder: lesson.dayOrder,
        time: lesson.time,
        para: lesson.para,
        group: lesson.group,
        subgroup: lesson.subgroup,
        subject: lesson.subject,
        type: lesson.type,
        teacher: lesson.teacher,
        room: lesson.room,
        isExam: lesson.isExam,
      });
    }
  }
  if (!lessons.length) return null;

  const createdAt = now.toISOString();
  return {
    id: createdAt,
    createdAt,
    fileName,
    version: data.version || '',
    count: lessons.length,
    lessons,
  };
}

/** `2026-09-29T18:10:11Z` → `29.09.2026 18:10`, in the admin's own timezone. */
export function formatSnapshotDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DB_NAME = 'pendrops-admin';
const DB_VERSION = 1;
const STORE_NAME = 'schedule_snapshots';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * The real, on-device snapshot backend.
 *
 * Failures propagate: the admin UI reports that rollback is unavailable rather
 * than showing an empty list that looks like "nothing to roll back to".
 */
export function createIndexedDbSnapshotBackend(): SnapshotBackend {
  return {
    async list(): Promise<SnapshotMeta[]> {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const stored = await promisify<ScheduleSnapshot[]>(tx.objectStore(STORE_NAME).getAll());
        return stored.map(({ lessons: _lessons, ...meta }) => meta);
      } finally {
        db.close();
      }
    },

    async read(id: string): Promise<ScheduleSnapshot | null> {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const stored = await promisify<ScheduleSnapshot | undefined>(
          tx.objectStore(STORE_NAME).get(id)
        );
        return stored ?? null;
      } finally {
        db.close();
      }
    },

    async write(snapshot: ScheduleSnapshot): Promise<void> {
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(snapshot);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        });
      } finally {
        db.close();
      }
    },

    async remove(id: string): Promise<void> {
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
        });
      } finally {
        db.close();
      }
    },
  };
}
