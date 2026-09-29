// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserStatsView } from '../../src/view/userStatsView.js';
import { createAdminView } from '../../src/view/adminView.js';

/**
 * The «Пользователи» block of the admin dialog.
 *
 * Two things must never regress: the admin is never shown a number the app
 * cannot back up, and the presence channel is opened only after the PIN and
 * closed with the dialog.
 */

const UUID = '3f2b1a44-9c8d-4e17-9a55-0b6d2f7c81ab';
const NBSP = '\u00a0';

function makeServices(
  stats = { available: true, devices7d: 40, devices30d: 95, devicesTotal: 120 }
) {
  const presence = {
    started: 0,
    stopped: 0,
    snapshot: { status: 'connected', online: 7 },
    listeners: new Set(),
    start() {
      this.started++;
      this.emit();
    },
    stop() {
      this.stopped++;
      this.snapshot = { status: 'idle', online: null };
      this.emit();
    },
    getSnapshot() {
      return this.snapshot;
    },
    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.snapshot);
      return () => this.listeners.delete(listener);
    },
    emit() {
      for (const listener of this.listeners) listener(this.snapshot);
    },
  };
  const visits = { load: vi.fn(async () => stats) };
  return { presence, visits };
}

/** The lines the admin actually reads. */
function read() {
  const q = (selector) => document.querySelector(selector);
  const stats = q('[data-stats]');
  return {
    block: q('.admin-users'),
    value: q('[data-online-value]'),
    onlineNote: q('[data-online-note]'),
    stats,
    rows: Array.from(stats?.querySelectorAll('.admin-users-row') ?? []),
    units: Array.from(stats?.querySelectorAll('.admin-users-row-unit') ?? []),
    text: q('.admin-users').textContent,
  };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('«Пользователи»: the online counter', () => {
  it('shows the live number once the channel is up', () => {
    const { presence, visits } = makeServices();
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();

    expect(read().value.textContent).toBe('7');
    expect(read().value.classList.contains('is-unavailable')).toBe(false);
    expect(read().text).toContain('Сейчас онлайн');
  });

  it('groups thousands the way the rest of the admin does', async () => {
    const { presence, visits } = makeServices();
    presence.snapshot = { status: 'connected', online: 1234 };
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();

    expect(read().value.textContent).toBe(`1${NBSP}234`);
  });

  it('refuses to show a number while the channel is down', () => {
    const { presence, visits } = makeServices();
    presence.snapshot = { status: 'error', online: null };
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();

    const { value, text } = read();
    expect(value.textContent).toBe('—');
    expect(value.classList.contains('is-unavailable')).toBe(true);
    expect(text).toContain('Счётчик онлайн недоступен');
    // A zero would be a claim about the students; nothing is claimed here.
    expect(text).not.toContain('Сейчас онлайн: 0');
  });

  it('says the same while the connection is still being established', () => {
    const { presence, visits } = makeServices();
    presence.snapshot = { status: 'connecting', online: null };
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();

    expect(read().text).toContain('Счётчик онлайн недоступен');
  });

  it('paints every change the channel reports', async () => {
    const { presence, visits } = makeServices();
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);
    view.start();

    presence.snapshot = { status: 'connected', online: 8 };
    presence.emit();
    expect(read().value.textContent).toBe('8');

    presence.snapshot = { status: 'error', online: null };
    presence.emit();
    expect(read().value.textContent).toBe('—');
  });
});

describe('«Пользователи»: devices over a period', () => {
  it('shows the three counts when the table is installed', async () => {
    const { presence, visits } = makeServices({
      available: true,
      devices7d: 41,
      devices30d: 142,
      devicesTotal: 120,
    });
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();
    await flush();

    const text = read().stats.textContent;
    expect(text).toContain('Устройств за 7 дней:');
    expect(text).toContain('Устройств за 30 дней:');
    expect(text).toContain('Устройств всего:');
    // Three lines, no list of devices: ids would tell the admin nothing.
    expect(read().rows).toHaveLength(3);
    expect(
      read().rows.map((row) => row.querySelector('.admin-users-row-value').textContent)
    ).toEqual(['41', '142', '120']);
    expect(read().units.map((node) => node.textContent)).toEqual([
      'устройство',
      'устройства',
      'устройств',
    ]);
  });

  it('says the table has to be installed when it is missing', async () => {
    const { presence, visits } = makeServices({
      available: false,
      devices7d: null,
      devices30d: null,
      devicesTotal: null,
      reason: 'таблица app_visits не установлена',
    });
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();
    await flush();

    const text = read().stats.textContent;
    expect(text).toContain('Статистика за период требует установки таблицы');
    expect(text).toContain('не установлена');
    // No zeros: they would look like measurements.
    expect(text).not.toContain('Устройств за 7 дней');
  });

  it('keeps the online counter alive when the period read fails', async () => {
    const { presence, visits } = makeServices();
    visits.load = vi.fn(async () => {
      throw new Error('сеть упала');
    });
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);

    view.start();
    await flush();

    expect(read().value.textContent).toBe('7');
    expect(read().stats.textContent).toContain('требует установки таблицы');
  });

  it('drops every claim on screen when the dialog closes', async () => {
    const { presence, visits } = makeServices();
    const view = createUserStatsView({ presence, visits });
    document.body.append(view.node);
    view.start();
    await flush();
    expect(read().value.textContent).toBe('7');

    view.stop();

    expect(presence.stopped).toBe(1);
    expect(read().value.textContent).toBe('—');
    expect(read().stats.textContent).toBe('');
  });
});

describe('«Пользователи» inside the admin dialog', () => {
  function setup(services, { pinOk = true } = {}) {
    const authService = { verifyPin: vi.fn(async () => pinOk) };
    const adminService = {
      previewFromExcel: vi.fn(async () => ({})),
      clearPreview: vi.fn(),
      publishPreview: vi.fn(),
    };
    const view = createAdminView(authService, adminService, undefined, undefined, {
      presence: services.presence,
      visits: services.visits,
      snapshots: null,
    });
    return { view, authService };
  }

  it('stays closed until the PIN is accepted', async () => {
    const services = makeServices();
    const { view } = setup(services);

    view.show();
    expect(document.querySelector('#adminUsersHost').classList.contains('hidden')).toBe(true);
    expect(services.presence.started).toBe(0);

    document.querySelector('#adminPin').value = '1234';
    document.querySelector('#adminPinBtn').click();
    await flush();

    expect(document.querySelector('#adminUsersHost').classList.contains('hidden')).toBe(false);
    expect(services.presence.started).toBe(1);
  });

  it('is never opened for a wrong PIN', async () => {
    const services = makeServices();
    const { view } = setup(services, { pinOk: false });

    view.show();
    document.querySelector('#adminPin').value = '0000';
    document.querySelector('#adminPinBtn').click();
    await flush();

    expect(services.presence.started).toBe(0);
    expect(services.visits.load).not.toHaveBeenCalled();
    expect(document.querySelector('#adminUsersHost').classList.contains('hidden')).toBe(true);
  });

  it('closes the presence channel with the dialog', async () => {
    const services = makeServices();
    const { view } = setup(services);

    view.show();
    document.querySelector('#adminPin').value = '1234';
    document.querySelector('#adminPinBtn').click();
    await flush();
    expect(services.presence.started).toBe(1);

    view.close();

    expect(services.presence.stopped).toBe(1);
    expect(document.querySelector('#adminUsersHost').classList.contains('hidden')).toBe(true);
  });

  it('reopens the block from scratch after a close', async () => {
    const services = makeServices();
    const { view } = setup(services);

    view.show();
    document.querySelector('#adminPin').value = '1234';
    document.querySelector('#adminPinBtn').click();
    await flush();
    view.close();

    // The channel is reopened from scratch, not resumed: the second session
    // subscribes again and reports whatever the channel says now.
    services.presence.snapshot = { status: 'connected', online: 9 };
    view.show();
    document.querySelector('#adminPin').value = '1234';
    document.querySelector('#adminPinBtn').click();
    await flush();

    expect(services.presence.started).toBe(2);
    expect(services.visits.load).toHaveBeenCalledTimes(2);
    expect(read().value.textContent).toBe('9');
  });

  it('leaves the dialog usable when no services are wired in', async () => {
    const authService = { verifyPin: vi.fn(async () => true) };
    const adminService = { previewFromExcel: vi.fn(), clearPreview: vi.fn() };
    const view = createAdminView(authService, adminService, undefined, undefined, {
      snapshots: null,
    });

    view.show();
    document.querySelector('#adminPin').value = '1234';
    document.querySelector('#adminPinBtn').click();
    await flush();
    view.close();

    expect(document.querySelector('#adminUsersHost').innerHTML).toBe('');
  });
});
