/**
 * "Изменения" — what the latest publish added and removed.
 *
 * Shown on demand from the toolbar, never as a permanent part of the screen,
 * and only when the diff is non-empty. A tap on a row jumps to the day the
 * change belongs to.
 */
import { escapeHtml } from '../text.js';
import { DAY_SHORT } from '../constants.js';

const dayLabel = (day) => DAY_SHORT[day] || day;

const rowHtml = (item, kind, index) => {
  const meta = [item.time, item.room, item.teacher].filter(Boolean).join(' · ');
  return `<button type="button" class="chg-row ${kind}" data-kind="${kind}" data-idx="${index}" data-day="${escapeHtml(item.day)}">
    <span class="chg-mark" aria-hidden="true">${kind === 'added' ? '+' : '−'}</span>
    <span class="find-body">
      <span class="find-subject">${escapeHtml(item.subject || '—')}</span>
      <span class="find-meta">${escapeHtml([dayLabel(item.day), meta].filter(Boolean).join(' · '))}</span>
    </span>
  </button>`;
};

const groupHtml = (title, items, kind) => {
  if (!items.length) return '';
  const rows = items.map((item, index) => rowHtml(item, kind, index)).join('');
  return `<section class="chg-group">
    <h3 class="chg-title">${title} · ${items.length}</h3>
    ${rows}
  </section>`;
};

/**
 * @param {HTMLElement | null} element
 * @param {import('@core/domain/scheduleDiff').ScheduleChanges | null} changes
 * @param {{onJump: (day: string) => void}} options
 */
export function renderChanges(element, changes, { onJump }) {
  if (!element) return;
  element.innerHTML = '';

  const body = document.createElement('div');
  body.className = 'chg-body';

  if (!changes) {
    element.hidden = true;
    element.classList.add('hidden');
    return;
  }

  const head = document.createElement('div');
  head.className = 'chg-head';
  const from = changes.fromVersion ? `${escapeHtml(changes.fromVersion)} → ` : '';
  head.textContent = `${from}${escapeHtml(changes.toVersion || 'новая версия')}`;
  body.appendChild(head);

  body.insertAdjacentHTML(
    'beforeend',
    groupHtml('Добавлено', changes.added, 'added') + groupHtml('Убрано', changes.removed, 'removed')
  );
  element.appendChild(body);

  element.hidden = false;
  element.classList.remove('hidden');

  element.querySelectorAll('.chg-row').forEach((row) => {
    row.addEventListener('click', () => onJump(row.dataset.day));
  });
}
