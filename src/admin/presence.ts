/**
 * «Сейчас онлайн» через Supabase Realtime Presence.
 *
 * Это единственная из трёх возможных цифр, которую можно назвать точной: каждое
 * устройство, открывшее приложение, держит открытым один Realtime-канал и
 * отдаёт своё присутствие. Сколько каналов подключено — столько устройств
 * онлайн прямо сейчас.
 *
 * Что это НЕ меняет: схему базы. Presence живёт в Realtime-сервере, а не в
 * таблице, поэтому никакого SQL для счётчика онлайна не нужно. Канал открытый
 * (не private), читается анонимным ключом приложения — тем же клиентом, который
 * уже подписан на `postgres_changes` в schedule-репозитории.
 *
 * Канал поднимается ТОЛЬКО в админке и после PIN. Обычный ученик не должен
 * тратить соединение и батарею на счётчик, который смотрит только админ.
 *
 * Переподключение и circuit breaker — те же, что у schedule-репозитория: одна
 * подсистема на весь проект, а не две копии с разным поведением.
 */
import { CircuitBreaker } from '@shared/circuitBreaker';
import { withRetry } from '@shared/retry';
import { logger } from '@shared/logger';
import { getSupabaseClient } from '../infrastructure/supabase/client';

/** Имя канала. Версия в имени — чтобы сменить протокол, не ломая старые вкладки. */
export const PRESENCE_CHANNEL_NAME = 'pendrops:presence:v1';

export type PresenceStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface PresenceSnapshot {
  status: PresenceStatus;
  /**
   * Distinct devices currently on the channel, or null when it is not up.
   *
   * null, а не 0: «соединения нет» и «никого нет онлайн» — разные вещи, и
   * показывать ноль вместо отсутствия данных было бы враньём.
   */
  online: number | null;
}

/** Structural slice of a supabase-js RealtimeChannel, so tests can substitute it. */
export interface PresenceChannel {
  on(
    event: 'presence',
    filter: { event: string },
    callback: (payload: unknown) => void
  ): PresenceChannel;
  subscribe(callback: (status: string) => void): PresenceChannel;
  presenceState<T = unknown>(): Record<string, T[]>;
  track(payload: Record<string, unknown>): unknown;
  untrack(): unknown;
}

export interface PresenceService {
  /** Opens the channel and keeps it open until `stop()`. Safe to call twice. */
  start(): void;
  /** Closes the channel and cancels any pending reconnect. */
  stop(): void;
  /** Notified immediately with the current snapshot, then on every change. */
  subscribe(listener: (snapshot: PresenceSnapshot) => void): () => void;
  getSnapshot(): PresenceSnapshot;
  isRunning(): boolean;
}

export interface PresenceServiceOptions {
  /** Creates a fresh channel per attempt; a dead channel cannot be revived. */
  createChannel: () => PresenceChannel;
  removeChannel: (channel: PresenceChannel) => void;
  /** Anonymous id of this device; travels as the presence payload. */
  deviceId: string;
  /** Failures in a row before the breaker stops the reconnect loop for a while. */
  breakerThreshold?: number;
  breakerTimeoutMs?: number;
  maxReconnectDelayMs?: number;
}

const FAILED_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

/**
 * How many devices are on the channel right now.
 *
 * Keys of the presence state are per-connection, so one student with two open
 * tabs would otherwise be counted twice. The payload carries the device id
 * precisely to collapse that: distinct ids are counted, and an entry without a
 * readable id is counted on its own rather than silently merged with another.
 */
export function countOnline<T extends { deviceId?: unknown }>(
  state: Record<string, T[]> | null | undefined
): number {
  if (!state) return 0;
  const devices = new Set<string>();
  let unidentified = 0;
  for (const entries of Object.values(state)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const id = entry && typeof entry === 'object' ? entry.deviceId : null;
      if (typeof id === 'string' && id) devices.add(id);
      else unidentified++;
    }
  }
  return devices.size + unidentified;
}

export function createPresenceService(options: PresenceServiceOptions): PresenceService {
  const {
    createChannel,
    removeChannel,
    deviceId,
    breakerThreshold = 5,
    breakerTimeoutMs = 60000,
    maxReconnectDelayMs = 30000,
  } = options;

  let channel: PresenceChannel | null = null;
  let running = false;
  let destroyed = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const breaker = new CircuitBreaker(breakerThreshold, breakerTimeoutMs);
  const listeners = new Set<(snapshot: PresenceSnapshot) => void>();
  let snapshot: PresenceSnapshot = { status: 'idle', online: null };

  const emit = (next: Partial<PresenceSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        logger.warn('[Presence] listener failed', { error: err as Error });
      }
    }
  };

  /**
   * Publish the count the channel currently reports.
   *
   * `untilCounted` is for the moment right after SUBSCRIBED: the channel is up
   * but this device is not in the state yet, so an empty state means "not
   * counted", not "nobody is online". Publishing that as 0 would be a false
   * claim; the join event that follows fills the number in.
   */
  const refreshOnline = (options: { untilCounted?: boolean } = {}): void => {
    if (!channel) {
      emit({ status: 'connecting', online: null });
      return;
    }
    let online: number;
    try {
      online = countOnline(channel.presenceState<{ deviceId?: string }>());
    } catch (err) {
      logger.debug('[Presence] presenceState unreadable', { error: err as Error });
      emit({ status: 'error', online: null });
      return;
    }
    if (online === 0 && options.untilCounted) {
      emit({ status: 'connecting', online: null });
      return;
    }
    emit({ status: 'connected', online });
  };

  const scheduleReconnect = (): void => {
    if (!running || destroyed) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxReconnectDelayMs);
    reconnectAttempt++;
    logger.info('[Presence] Reconnecting', { delay, attempt: reconnectAttempt });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (running && !destroyed) setup();
    }, delay);
  };

  /**
   * Untrack and detach a channel from the client.
   *
   * A channel that failed stays registered on the client unless it is removed,
   * so without this a long admin session offline would pile up dead channels.
   * Every failure therefore detaches its own attempt before the next one.
   */
  const dropChannel = (target: PresenceChannel): void => {
    try {
      void target.untrack();
    } catch (err) {
      logger.debug('[Presence] untrack failed', { error: err as Error });
    }
    try {
      removeChannel(target);
    } catch (err) {
      logger.debug('[Presence] removeChannel failed', { error: err as Error });
    }
    if (channel === target) channel = null;
  };

  const doSubscribe = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const next = createChannel();
      channel = next;

      // 'sync' carries the whole state, 'join'/'leave' only the delta. All three
      // re-read the state, so one code path renders the number and a reconnect
      // that only emits 'sync' still paints a correct count.
      for (const event of ['sync', 'join', 'leave']) {
        next.on('presence', { event }, () => refreshOnline());
      }

      next.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.info('[Presence] Subscribed');
          reconnectAttempt = 0;
          // The payload is the anonymous device id and nothing else.
          void Promise.resolve(next.track({ deviceId })).catch((err) => {
            logger.warn('[Presence] track failed', { error: err as Error });
          });
          refreshOnline({ untilCounted: true });
          resolve();
          return;
        }
        if (FAILED_STATUSES.has(status)) {
          logger.warn('[Presence] Channel status', { status });
          emit({ status: 'error', online: null });
          dropChannel(next);
          reject(new Error(`Realtime presence failed: ${status}`));
        }
      });
    });
  };

  const setup = (): void => {
    if (!running || destroyed) return;
    emit({ status: 'connecting', online: null });

    breaker
      .execute(() =>
        withRetry(doSubscribe, {
          retries: 5,
          baseDelay: 2000,
          retryable: (e) => e.message.includes('Realtime presence failed'),
        })
      )
      .catch((err) => {
        logger.error('[Presence] Failed to setup channel', { error: err as Error });
        if (!destroyed) scheduleReconnect();
      });
  };

  return {
    start(): void {
      destroyed = false;
      if (running) return;
      running = true;
      setup();
    },

    stop(): void {
      running = false;
      destroyed = true;
      reconnectAttempt = 0;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (channel) {
        dropChannel(channel);
      }
      // The admin closed: whatever number was on screen is no longer true.
      emit({ status: 'idle', online: null });
    },

    subscribe(listener: (snapshot: PresenceSnapshot) => void): () => void {
      listeners.add(listener);
      try {
        listener(snapshot);
      } catch (err) {
        logger.warn('[Presence] listener failed', { error: err as Error });
      }
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): PresenceSnapshot {
      return snapshot;
    },

    isRunning(): boolean {
      return running;
    },
  };
}

/**
 * The production wiring: the same singleton client the schedule repository uses.
 *
 * The cast is confined to this one function. supabase-js types its channel as a
 * concrete class, and pinning that class here would drag the whole realtime type
 * surface into every test that touches a presence channel.
 */
export function createSupabasePresenceService(deviceId: string): PresenceService {
  return createPresenceService({
    deviceId,
    createChannel: () =>
      getSupabaseClient().channel(PRESENCE_CHANNEL_NAME) as unknown as PresenceChannel,
    removeChannel: (channel) => {
      void getSupabaseClient().removeChannel(channel as never);
    },
  });
}
