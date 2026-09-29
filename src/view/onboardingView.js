/**
 * First-run chooser: "Выбери свою группу один раз".
 *
 * Shown only when a schedule is available and the student has no remembered
 * group. It is a short two-step list — department, then group — and every
 * button is derived from the loaded schedule, so nothing about the college is
 * hard-coded here.
 */
import { escapeHtml } from '../text.js';

const plural = (n, one, few, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const lessonWord = (n) => plural(n, 'пара', 'пары', 'пар');

/**
 * @param {{
 *   root: HTMLElement,
 *   list: HTMLElement,
 *   title: HTMLElement,
 *   hint: HTMLElement,
 *   skip?: HTMLElement | null,
 *   onSelect: (selection: {sheetId: string, group: string}) => void | Promise<void>,
 *   onSkip: () => void,
 * }} options
 */
export function createOnboardingView({ root, list, title, hint, skip, onSelect, onSkip }) {
  let data = null;
  let stage = 'sheet';
  let sheetId = '';

  function setStage(next, nextSheetId) {
    stage = next;
    sheetId = nextSheetId ?? sheetId;
    render();
  }

  function render() {
    if (!data) return;
    if (stage === 'sheet') {
      hint.textContent = 'Шаг 1 из 2 · отделение. Дальше запомним и сразу откроем твои пары';
      list.innerHTML = data.sheetsMeta
        .map((sheet) => {
          const count = data.sheets.get(sheet.id)?.length || 0;
          return `<button type="button" class="ob-item" data-sheet="${escapeHtml(sheet.id)}">
            <span class="ob-item-title">${escapeHtml(sheet.name)}</span>
            <span class="ob-item-meta">${count} ${lessonWord(count)}</span>
          </button>`;
        })
        .join('');
      list.querySelectorAll('.ob-item').forEach((btn) => {
        btn.addEventListener('click', () => setStage('group', btn.dataset.sheet));
      });
      return;
    }

    title.textContent = 'Выбери свою группу';
    hint.textContent = 'Шаг 2 из 2 · группа. Дальше запомним и сразу откроем твои пары';
    const groups = Array.from(data.groups.values())
      .filter((group) => group.sheetId === sheetId)
      .sort((a, b) => a.code.localeCompare(b.code, 'ru'));

    list.innerHTML =
      `<button type="button" class="ob-back" data-back="1">← Другое отделение</button>` +
      groups
        .map(
          (group) => `<button type="button" class="ob-item" data-group="${escapeHtml(group.code)}">
            <span class="ob-item-title">${escapeHtml(group.code)}</span>
            <span class="ob-item-meta">${group.lessonCount} ${lessonWord(group.lessonCount)}</span>
          </button>`
        )
        .join('');

    list.querySelector('[data-back]')?.addEventListener('click', () => setStage('sheet', ''));
    list.querySelectorAll('.ob-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        void onSelect({ sheetId, group: btn.dataset.group });
      });
    });
  }

  skip?.addEventListener('click', () => onSkip());

  return {
    /**
     * @param {import('@core/domain/entities/types').ScheduleData} scheduleData
     * @param {'hidden'|'visible'} visibility
     */
    show(scheduleData, visibility = 'visible') {
      data = scheduleData;
      root.hidden = visibility === 'hidden';
      root.classList.toggle('hidden', visibility === 'hidden');
      if (visibility === 'visible') render();
    },
    reset() {
      stage = 'sheet';
      sheetId = '';
    },
  };
}
