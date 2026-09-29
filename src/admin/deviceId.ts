/**
 * Анонимный идентификатор устройства.
 *
 * Приложение не знает, кто перед ним: аккаунтов нет, авторизации нет. Единственное,
 * что можно честно назвать «пользователем», — это конкретное устройство, поэтому и
 * счётчик онлайна, и статистика за период считают устройства, а не людей.
 *
 * Идентификатор — случайный UUID, который живёт в localStorage и не связан ни с
 * чем, кроме этого браузера. Персональных данных в нём нет, и он не покидает
 * устройство, пока таблица `app_visits` не установлена.
 *
 * localStorage может быть недоступен (приватный режим, запрет на хранилище).
 * Тогда идентификатор живёт только в памяти вкладки: статистика по нему бессмысленна,
 * но приложение работает ровно так же, как при доступном хранилище.
 */

const STORAGE_KEY = 'pendrops.device_id.v1';

/** Cached so a blocked localStorage cannot hand out a new id on every call. */
let cachedId: string | null = null;

/** UUID v4 from the platform CSPRNG, with a Math.random fallback. */
export function newDeviceId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** localStorage if it is actually usable, otherwise null. */
function readStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Safari in private mode exposes the object but throws on write.
    const probe = `${STORAGE_KEY}.probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * The stable id of this device, generating and persisting one on first use.
 *
 * Never throws: a device without a usable localStorage still gets a working,
 * session-scoped id so nothing downstream has to special-case it.
 */
export function getDeviceId(storage: Storage | null = readStorage()): string {
  if (cachedId) return cachedId;

  if (storage) {
    try {
      const stored = storage.getItem(STORAGE_KEY);
      if (stored && isUuid(stored)) {
        cachedId = stored;
        return cachedId;
      }
      const fresh = newDeviceId();
      storage.setItem(STORAGE_KEY, fresh);
      cachedId = fresh;
      return cachedId;
    } catch {
      // Fall through to the in-memory id below.
    }
  }

  cachedId = newDeviceId();
  return cachedId;
}

/** The column is `uuid`, so anything else must never reach the database. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Test seam: forgets the memoized id. */
export function resetDeviceIdCache(): void {
  cachedId = null;
}
