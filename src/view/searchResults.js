/**
 * "Где у меня пара" — search results block.
 *
 * Rendered as its own block above the schedule so that searching never
 * narrows the day filter: the selected day stays selected, and a tap on a
 * result simply navigates to the day that match belongs to.
 */
import { escapeHtml } from '../text.js';
import { DAY_SHORT } from '../constants.js';
import { resultsNeedSubgroup } from '@core/domain/search';

const dayLabel = (day) => DAY_SHORT[day] || day;

/** Time, subgroup (only when it tells rows apart), room and teacher. */
function metaLine(lesson, showSubgroup) {
  const parts = [lesson.time];
  if (showSubgroup && lesson.subgroup) parts.push(`подгр. ${lesson.subgroup}`);
  parts.push(lesson.room, lesson.teacher);
  return parts.filter(Boolean).join(' · ');
}

/**
 * @param {HTMLElement | null} element
 * @param {import('@core/domain/entities/types').Lesson[]} results
 * @param {{query: string, onJump: (day: string) => void}} options
 */
export function renderSearchResults(element, results, { query, onJump }) {
  if (!element) return;
  const trimmed = String(query || '').trim();
  element.innerHTML = '';

  // The `hidden` attribute is the single source of truth for the hidden
  // state; the stylesheet keys on `.search-results[hidden]`.
  element.hidden = !trimmed;
  if (!trimmed) return;

  const head = document.createElement('div');
  head.className = 'find-head';
  head.textContent = results.length ? `Найдено: ${results.length}` : 'Ничего не найдено';
  element.appendChild(head);

  if (!results.length) {
    const hint = document.createElement('div');
    hint.className = 'find-empty';
    hint.textContent =
      'Проверь написание или попробуй часть названия предмета, аудитории или фамилии.';
    element.appendChild(hint);
    return;
  }

  const list = document.createElement('div');
  list.className = 'find-list';
  // Subgroups of one pair are otherwise identical rows, so the label appears
  // only when the results really do contain such a collision.
  const showSubgroup = resultsNeedSubgroup(results);
  list.innerHTML = results
    .map(
      (
        lesson,
        index
      ) => `<button type="button" class="find-row" data-idx="${index}" data-day="${escapeHtml(lesson.day)}">
        <span class="find-day">${escapeHtml(dayLabel(lesson.day))}</span>
        <span class="find-body">
          <span class="find-subject">${escapeHtml(lesson.subject || '—')}</span>
          <span class="find-meta">${escapeHtml(metaLine(lesson, showSubgroup))}</span>
        </span>
        <span class="find-arrow" aria-hidden="true">→</span>
      </button>`
    )
    .join('');
  element.appendChild(list);

  list.querySelectorAll('.find-row').forEach((row) => {
    row.addEventListener('click', () => onJump(row.dataset.day));
  });
}
