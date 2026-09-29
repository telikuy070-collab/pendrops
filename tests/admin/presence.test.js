import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countOnline, createPresenceService } from '../../src/admin/presence.ts';

/**
 * Presence counting and the admin-only channel lifecycle.
 *
 * The Supabase channel is replaced by a double, so these tests never open a
 * socket: they pin the two things that must not regress — how many devices a
 * presence state means, and that a dead channel reports "no number" instead of
 * a zero.
 */

function makeChannel() {
  const handlers = [];
  const channel = {
    handlers,
    state: {},
    tracked: null,
    untracked: false,
    statusHandler: null,
    on(event, filter, callback) {
      handlers.push({ event, filter, callback });
      return channel;
    },
    subscribe(callback) {
      channel.statusHandler = callback;
      return channel;
    },
    presenceState() {
      return channel.state;
    },
    track(payload) {
      channel.tracked = payload;
      return Promise.resolve('ok');
    },
    untrack() {
      channel.untracked = true;
      return Promise.resolve('ok');
    },
  };
  return channel;
}

/** Presence state as supabase-js hands it over: one array per connection. */
function presenceStateOf(...devices) {
  const state = {};
  devices.forEach((deviceId, index) => {
    state[`ref-${index}`] = [{ presence_ref: `ref-${index}`, deviceId }];
  });
  return state;
}

function makeService(overrides = {}) {
  const channels = [];
  const listeners = [];
  const service = createPresenceService({
    deviceId: 'device-a',
    createChannel: () => {
      const channel = makeChannel();
      channels.push(channel);
      return channel;
    },
    removeChannel: (channel) => {
      channel.removed = true;
    },
    ...overrides,
  });
  return { service, channels, listeners };
}

/** Lets the queued promise continuations of `track()` settle. */
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('presence counting', () => {
  it('reports nothing for an empty or absent state', () => {
    expect(countOnline({})).toBe(0);
    expect(countOnline(null)).toBe(0);
    expect(countOnline(undefined)).toBe(0);
  });

  it('counts one device per connection', () => {
    expect(countOnline(presenceStateOf('a', 'b', 'c'))).toBe(3);
  });

  it('counts one student with two open tabs as one device', () => {
    // The state is keyed per connection, not per device: two tabs of the same
    // browser are two keys carrying the same anonymous id.
    expect(countOnline(presenceStateOf('a', 'a'))).toBe(1);
  });

  it('never merges a connection whose id cannot be read into another one', () => {
    const state = { one: [{ presence_ref: 'one' }], two: [{ presence_ref: 'two', deviceId: 'x' }] };
    expect(countOnline(state)).toBe(2);
  });

  it('ignores a state that is not a map of arrays', () => {
    expect(countOnline({ broken: 'nope' })).toBe(0);
  });
});

describe('presence service: the admin channel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one channel, subscribes and announces itself by device id', async () => {
    const { service, channels } = makeService();
    const seen = [];
    service.subscribe((snapshot) => seen.push(snapshot));

    expect(service.isRunning()).toBe(false);
    service.start();
    await flush();

    expect(service.isRunning()).toBe(true);
    expect(channels).toHaveLength(1);
    expect(channels[0].statusHandler).toBeTypeOf('function');

    channels[0].state = presenceStateOf('device-a', 'device-b');
    channels[0].statusHandler('SUBSCRIBED');
    await flush();

    // Only the anonymous device id leaves this device.
    expect(channels[0].tracked).toEqual({ deviceId: 'device-a' });
    expect(service.getSnapshot()).toEqual({ status: 'connected', online: 2 });
    expect(seen.at(-1)).toEqual({ status: 'connected', online: 2 });
  });

  it('re-counts on every presence event without asking the database', async () => {
    const { service, channels } = makeService();
    service.start();
    await flush();
    channels[0].state = presenceStateOf('device-a', 'device-b');
    channels[0].statusHandler('SUBSCRIBED');

    const events = channels[0].handlers.map((h) => h.filter.event);
    expect(events).toEqual(expect.arrayContaining(['sync', 'join', 'leave']));

    const seen = [];
    service.subscribe((snapshot) => seen.push(snapshot.online));

    channels[0].state = presenceStateOf('device-a', 'device-b', 'device-c');
    for (const handler of channels[0].handlers) handler.callback({});

    // Three events, but the number is read from the channel's own state each
    // time: no request, no re-render of the schedule.
    expect(seen).toEqual([2, 3, 3, 3]);
  });

  it('gives a subscriber the current snapshot without waiting for the channel', () => {
    const { service } = makeService();
    const seen = [];
    service.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toEqual([{ status: 'idle', online: null }]);
  });

  it('shows no number while the channel is still connecting', async () => {
    const { service, channels } = makeService();
    service.start();
    await flush();

    expect(service.getSnapshot()).toEqual({ status: 'connecting', online: null });
    expect(channels[0].tracked).toBeNull();
  });

  it('does not answer 0 for the moment before this device is counted', async () => {
    // Right after SUBSCRIBED the channel is open but this device has not landed
    // in the state yet. An empty state there means "not counted yet", and 0
    // would be a claim about the students that is not true.
    const { service, channels } = makeService();
    service.start();
    await flush();

    channels[0].statusHandler('SUBSCRIBED');
    await flush();
    expect(service.getSnapshot()).toEqual({ status: 'connecting', online: null });

    // The join event the server sends back for our own track fills it in.
    channels[0].state = presenceStateOf('device-a');
    channels[0].handlers[0].callback({});
    expect(service.getSnapshot()).toEqual({ status: 'connected', online: 1 });
  });

  it('reports the loss of the channel instead of claiming nobody is online', async () => {
    vi.useFakeTimers();
    const { service, channels } = makeService();
    service.start();
    await flush();
    channels[0].state = presenceStateOf('device-a');
    channels[0].statusHandler('SUBSCRIBED');
    expect(service.getSnapshot().online).toBe(1);

    channels[0].state = {};
    channels[0].statusHandler('CHANNEL_ERROR');
    await flush();

    // null, not 0: "the connection is down" is not "nobody is online".
    expect(service.getSnapshot()).toEqual({ status: 'error', online: null });

    service.stop();
    vi.clearAllTimers();
  });

  it('detaches a channel that failed, so retries cannot pile them up', async () => {
    vi.useFakeTimers();
    const { service, channels } = makeService();
    service.start();
    await flush();

    channels[0].statusHandler('CHANNEL_ERROR');
    await flush();

    expect(channels[0].untracked).toBe(true);
    expect(channels[0].removed).toBe(true);

    service.stop();
    vi.clearAllTimers();
  });

  it('reconnects with a fresh channel instead of reviving a dead one', async () => {
    vi.useFakeTimers();
    const { service, channels } = makeService();
    service.start();
    await flush();
    channels[0].statusHandler('CHANNEL_ERROR');
    await flush();

    // withRetry backs off first, then the reconnect loop takes over.
    await vi.advanceTimersByTimeAsync(3000);

    expect(channels.length).toBeGreaterThan(1);
    // A dead RealtimeChannel cannot be reused; the retry must be a new object.
    expect(channels[1]).not.toBe(channels[0]);

    service.stop();
    vi.clearAllTimers();
  });

  it('closes the channel when the admin dialog closes', async () => {
    const { service, channels } = makeService();
    service.start();
    await flush();
    channels[0].statusHandler('SUBSCRIBED');
    await flush();

    service.stop();
    await flush();

    expect(service.isRunning()).toBe(false);
    expect(channels[0].untracked).toBe(true);
    expect(channels[0].removed).toBe(true);
    // Nothing may keep a stale number on screen after the dialog is gone.
    expect(service.getSnapshot()).toEqual({ status: 'idle', online: null });
  });

  it('does not start twice and can be started again afterwards', async () => {
    const { service, channels } = makeService();
    service.start();
    service.start();
    await flush();
    expect(channels).toHaveLength(1);

    service.stop();
    service.start();
    await flush();
    expect(channels).toHaveLength(2);
    service.stop();
  });

  it('keeps the panel alive when a listener throws', async () => {
    const { service, channels } = makeService();
    const seen = [];
    service.subscribe(() => {
      throw new Error('взрыв в панели');
    });
    service.subscribe((snapshot) => seen.push(snapshot.status));
    service.start();
    await flush();
    channels[0].state = presenceStateOf('device-a');
    channels[0].statusHandler('SUBSCRIBED');
    await flush();

    expect(seen.at(-1)).toBe('connected');
    service.stop();
  });
});
