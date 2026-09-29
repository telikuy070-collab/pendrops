/**
 * Reminder settings inside the existing settings modal.
 *
 * Explains what the permission is for before asking for it, offers the lead
 * time, lists what is already scheduled, and states the honest limitation:
 * a web app cannot notify anyone after it has been closed.
 */
import { escapeHtml } from '../text.js';
import { DAY_SHORT } from '../constants.js';

const CLOCK = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

const dayLabel = (day) => DAY_SHORT[day] || day;

const formatMoment = (ms) => {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return `${dayLabel(dateToDayName(date))} в ${CLOCK.format(date)}`;
};

/** Weekday of a timestamp, in the same vocabulary the schedule uses. */
function dateToDayName(date) {
  return ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][
    date.getDay()
  ];
}

/**
 * @param {{
 *   store: import('@presentation/reminders').ReminderStore,
 *   section: HTMLElement | null,
 *   list: HTMLElement | null,
 *   leadRow: HTMLElement | null,
 *   enableButton: HTMLElement | null,
 *   status: HTMLElement | null,
 *   onRequest: () => void,
 * }} options
 */
export function createReminderSettings({
  store,
  section,
  list,
  leadRow,
  enableButton,
  status,
  onRequest,
}) {
  if (!section) return { render() {} };

  const unsubscribe = store.onChange(() => render());
  // Guards the same predicate the button visibility uses, so a hidden button
  // that is still reachable (synthetic click, a stale class) cannot produce
  // the misleading "notifications are impossible" toast.
  const mayEnable = () =>
    (typeof store.canAsk === 'function' ? store.canAsk() : true) &&
    store.permission() === 'default';
  enableButton?.addEventListener('click', () => {
    if (mayEnable()) onRequest();
  });

  function render() {
    if (!section) return;
    const permission = store.permission();
    const reminders = store.list();

    section.hidden = false;
    section.classList.remove('hidden');

    if (leadRow) {
      // The lead time is a real choice only while notifications can actually
      // fire. Offering "за сколько минут напомнить" to a browser that will
      // refuse the notification is one more control that does nothing.
      leadRow.hidden = permission !== 'granted';
      leadRow.innerHTML =
        '<span class="modal-hint">Напомнить за</span>' +
        store
          .leadOptions()
          .map(
            (minutes) =>
              `<button type="button" class="lead-chip ${
                store.lead() === minutes ? 'active' : ''
              }" data-lead="${minutes}">${minutes} мин</button>`
          )
          .join('');
      leadRow.querySelectorAll('.lead-chip').forEach((chip) => {
        chip.addEventListener('click', () => store.setLead(Number(chip.dataset.lead)));
      });
    }

    if (status) {
      // The status line is the only statement about the permission. It must
      // never read "включены" while the enable button is still on screen: two
      // opposite claims next to each other is worse than either alone.
      if (permission === 'unsupported') {
        status.textContent = 'Браузер не умеет показывать уведомления.';
      } else if (permission === 'denied') {
        status.textContent =
          'Уведомления запрещены в настройках браузера для этого сайта — включить их можно только там.';
      } else if (permission === 'default') {
        status.textContent =
          'Разрешение не запрошено — нажми «Включить напоминания», браузер спросит один раз.';
      } else {
        status.textContent =
          'Уведомления включены. Напомним за выбранное время до пары, пока PenDrops открыт.';
      }
    }

    if (enableButton) {
      // Only offer the button while asking the browser could still work.
      // Without the Notification API the click could only produce a toast
      // that says nothing can be done, so the button stays away.
      enableButton.hidden = !mayEnable();
    }

    if (list) {
      if (!reminders.length) {
        list.innerHTML =
          '<div class="find-empty">Напоминаний пока нет. Нажми на колокольчик у времени пары.</div>';
      } else {
        list.innerHTML = reminders
          .map(
            (reminder) => `<div class="rem-item">
              <span class="find-body">
                <span class="find-subject">${escapeHtml(reminder.subject || 'Занятие')}</span>
                <span class="find-meta">${escapeHtml(
                  `${formatMoment(reminder.fireAt)} · за ${reminder.leadMinutes} мин`
                )}</span>
              </span>
              <button type="button" class="btn ghost small" data-cancel="${escapeHtml(reminder.id)}">Отменить</button>
            </div>`
          )
          .join('');
        list.querySelectorAll('[data-cancel]').forEach((button) => {
          button.addEventListener('click', () => store.cancel(button.dataset.cancel));
        });
      }
    }
  }

  render();
  return { render, destroy: unsubscribe };
}
