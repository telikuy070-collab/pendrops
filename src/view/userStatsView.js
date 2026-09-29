/**
 * Блок «Пользователи» в админке.
 *
 * Показывает три разные вещи и не путает их между собой:
 *
 *  - «Сейчас онлайн» — точный счётчик в реальном времени из Realtime Presence;
 *  - «устройств за 7/30 дней и всего» — накопительные числа из таблицы
 *    `app_visits`, которой может не быть;
 *  - ничего похожего на «сколько учеников учатся»: без авторизации такая цифра
 *    не считается в принципе, и её здесь нет.
 *
 * Числа идут текстом, а не списком устройств: список из полусотни анонимных
 * идентификаторов ничего админу не скажет.
 *
 * Модуль ничего не знает про Supabase — он получает готовые сервисы, поэтому
 * проверяется без сети.
 */
import { formatCount } from '../admin/preview.ts';

/** @typedef {import('../admin/presence.ts').PresenceSnapshot} PresenceSnapshot */
/** @typedef {import('../admin/visits.ts').VisitStats} VisitStats */
/** @typedef {import('../admin/presence.ts').PresenceService} PresenceService */
/** @typedef {import('../admin/visits.ts').VisitStore} VisitStore */

export const ONLINE_UNAVAILABLE_TEXT = 'Счётчик онлайн недоступен';
export const PERIOD_UNAVAILABLE_TEXT =
  'Статистика за период требует установки таблицы (см. инструкцию)';

/** `12` → `12 устройств`, `1` → `1 устройство`. */
function pluralDevices(value) {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'устройств';
  if (mod10 === 1) return 'устройство';
  if (mod10 >= 2 && mod10 <= 4) return 'устройства';
  return 'устройств';
}

/** A detached element with text set as text, never as markup. */
function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Builds the block. Nothing is requested until `start()` is called, so an
 * ordinary student never opens the presence channel.
 *
 * @param {{presence: PresenceService, visits: VisitStore}} services
 * @returns {{node: HTMLElement, start: function(): void, stop: function(): void,
 *   renderOnline: function(PresenceSnapshot): void, renderStats: function(VisitStats): void}}
 */
export function createUserStatsView({ presence, visits }) {
  const node = document.createElement('section');
  node.className = 'admin-users';
  node.innerHTML = `
    <div class="admin-users-head">👥 Пользователи</div>
    <div class="admin-users-online">
      <div class="admin-users-online-value" data-online-value>—</div>
      <div class="admin-users-online-label">Сейчас онлайн</div>
    </div>
    <div class="admin-sub" data-online-note></div>
    <div class="admin-users-stats" data-stats></div>
  `;

  const onlineValue = node.querySelector('[data-online-value]');
  const onlineNote = node.querySelector('[data-online-note]');
  const stats = node.querySelector('[data-stats]');

  let unsubscribe = null;

  /**
   * The online number, or a plain refusal.
   *
   * When the channel is down the value becomes a dash rather than a zero: nobody
   * online and nobody counting are different facts, and only one of them is a
   * statement about the students.
   */
  function renderOnline(snapshot) {
    if (!snapshot || typeof snapshot.online !== 'number') {
      onlineValue.textContent = '—';
      onlineValue.classList.add('is-unavailable');
      onlineNote.textContent =
        snapshot && snapshot.status === 'connecting'
          ? `${ONLINE_UNAVAILABLE_TEXT}: подключение…`
          : ONLINE_UNAVAILABLE_TEXT;
      return;
    }
    onlineValue.textContent = formatCount(snapshot.online);
    onlineValue.classList.remove('is-unavailable');
    onlineNote.textContent = 'обновляется в реальном времени, без запросов к базе';
  }

  function renderStats(next) {
    clear(stats);
    if (!next || !next.available) {
      stats.append(makeEl('div', 'admin-users-unavailable', PERIOD_UNAVAILABLE_TEXT));
      if (next && next.reason) {
        stats.append(makeEl('div', 'admin-sub', next.reason));
      }
      return;
    }
    const rows = [
      ['за 7 дней', next.devices7d],
      ['за 30 дней', next.devices30d],
      ['всего', next.devicesTotal],
    ];
    for (const [label, value] of rows) {
      if (typeof value !== 'number') continue;
      const count = Math.round(value);
      const row = makeEl('div', 'admin-users-row');
      row.append(makeEl('span', 'admin-users-row-label', `Устройств ${label}:`));
      row.append(makeEl('span', 'admin-users-row-value', formatCount(count)));
      row.append(makeEl('span', 'admin-users-row-unit', pluralDevices(count)));
      stats.append(row);
    }
  }

  async function loadPeriodStats() {
    try {
      renderStats(await visits.load());
    } catch (err) {
      // `load()` is contracted not to reject; this keeps a broken service from
      // turning into an unhandled rejection inside the admin dialog.
      renderStats({ available: false, reason: String(err) });
    }
  }

  return {
    node,
    renderOnline,
    renderStats,

    start() {
      if (unsubscribe) return;
      renderOnline(presence.getSnapshot());
      unsubscribe = presence.subscribe(renderOnline);
      presence.start();
      void loadPeriodStats();
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      presence.stop();
      // Nothing on screen may keep claiming a number nobody is counting, and
      // the period numbers are dropped so a reopened dialog fetches them again.
      renderOnline(presence.getSnapshot());
      clear(stats);
    },
  };
}
