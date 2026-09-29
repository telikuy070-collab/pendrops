import { escapeHtml } from '../text.js';
import { TYPE_LABELS, DAY_SHORT, DAY_ORDER } from '../constants.js';
import {
  lessonState,
  highlightIndex,
  dayStatus,
  getNextLesson,
  getNowMinutes,
  timeToMin,
  formatCountdown,
  getTomorrowName,
} from '../timing.js';

const dayWord = (n) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
};

const lessonWord = (n) => {
  const mod10 = n % 10,
    mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пара';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'пары';
  return 'пар';
};

/**
 * Подпись состояния.
 *
 * Возвращается ТОЛЬКО для занятия, которое действительно сейчас идёт или
 * является следующим: `lessonState()` помечает как «next» каждую будущую пару
 * дня, поэтому текст по умолчанию раньше печатался на всех карточках сразу и
 * переставал что-либо значить.
 */
const stateLabel = (s) =>
  ({
    now: { tag: 'now', text: 'Идёт сейчас' },
    next: { tag: 'next', text: 'Дальше' },
  })[s] || { tag: '', text: '' };

/**
 * Разделяет «08:00-09:20» на начало и конец.
 *
 * Время — главный ответ на вопрос «когда», поэтому начало показывается крупно,
 * а конец — приглушённо рядом с ним, а не отдельной плашкой.
 */
const splitTime = (time) => {
  const raw = String(time || '').trim();
  if (!raw) return { start: '', end: '' };
  const parts = raw
    .split(/[-–—]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return { start: parts[0] || '', end: parts[1] || '' };
};

/**
 * Убирает из предмета кусок, который в него попал из аудитории.
 *
 * Исходная ячейка иногда отдаёт «Кыргызстан географиясы №7 корпус 402» вместе
 * с аудиторией «№7 корпус 402». Правку данных здесь не делаем — это разбирает
 * парсер, — но показывать одно и то же дважды подряд нельзя.
 */
const subjectWithoutRoom = (subject, room) => {
  const text = String(subject || '');
  const place = String(room || '').trim();
  if (place.length < 4) return text;
  const at = text.toLocaleLowerCase('ru').indexOf(place.toLocaleLowerCase('ru'));
  if (at < 0) return text;
  return `${text.slice(0, at)}${text.slice(at + place.length)}`.replace(/[\s,;·|-]+$/, '').trim();
};

/**
 * Прогресс-бар для текущей пары (0..100).
 * Если нет end-времени или сейчас за пределами пары — 0.
 */
const cardProgress = (lesson) => {
  const t = lesson._parsed;
  if (!t || !t.end) return 0;
  const now = getNowMinutes();
  if (now < t.start) return 0;
  if (now > t.end) return 100;
  return Math.round(((now - t.start) / (t.end - t.start)) * 100);
};

/** Парсит время один раз для уроков — кешируем в _parsed чтобы не парсить каждую секунду. */
const ensureParsed = (lessons) => {
  for (const l of lessons) {
    if (l._parsed) continue;
    const m = (l.time || '').match(/(\d{1,2})[:.](\d{2})/g);
    if (m && m.length) {
      const start = timeToMin(m[0]);
      const end = m[1] ? timeToMin(m[1]) : null;
      l._parsed = { start, end };
    } else {
      l._parsed = null;
    }
  }
};

/**
 * Карточка одной пары.
 *
 * Порядок чтения за две секунды: время → предмет → где. Поэтому время стоит
 * первой строкой и крупнее всего, предмет — вторым, аудитория и преподаватель
 * третьим и мелко. Группа показывается только тогда, когда она отличается от
 * выбранной в шапке: повторять то, что студент и так уже выбрал, — шум.
 *
 * @param {any} lesson
 * @param {string} day
 * @param {number} idx
 * @param {{now: number, next: number}} highlight
 * @param {{enabled: boolean, on: boolean}|null} remind
 * @param {{group?: string, subgroup?: string}} [selected] выбор из шапки
 */
const cardHtml = (lesson, day, idx, highlight, remind, selected = {}) => {
  const tpLabel = TYPE_LABELS[lesson.type] ?? 'Занятие';
  const state = lessonState(lesson);
  const isNow = highlight.now === idx;
  const isNext = highlight.next === idx;
  const cls = ['card'];
  if (isNow) cls.push('is-now');
  else if (isNext) cls.push('is-next');
  else if (state === 'past') cls.push('is-past');
  if (lesson.isExam) cls.push('is-exam');

  // Плашка состояния — только для той пары, к которой она относится.
  const sl = isNow || isNext ? stateLabel(isNow ? 'now' : 'next') : { tag: '', text: '' };
  const stateBlock = sl.text ? `<span class="state-pill ${sl.tag}">${sl.text}</span>` : '';

  const { start, end } = splitTime(lesson.time);
  const timeBlock = start
    ? `<div class="card-when">
         <span class="card-time">${escapeHtml(start)}</span>
         ${end ? `<span class="card-time-end">–&nbsp;${escapeHtml(end)}</span>` : ''}
       </div>`
    : '';

  const subject = subjectWithoutRoom(lesson.subject || '—', lesson.room);

  // Группа дублирует выбор в шапке, если совпадает и по коду, и по подгруппе.
  const sameGroup = !selected.group || lesson.group === selected.group;
  const sameSubgroup =
    !selected.subgroup || String(lesson.subgroup || '') === String(selected.subgroup);
  const groupTag =
    lesson.group && !(sameGroup && sameSubgroup)
      ? `<span class="card-tag card-tag-group">${escapeHtml(lesson.group)}${
          lesson.subgroup ? ` (${escapeHtml(lesson.subgroup)})` : ''
        }</span>`
      : '';

  const meta = [];
  if (lesson.room)
    meta.push(
      `<span class="card-meta-item"><span class="card-meta-icon" aria-hidden="true">📍</span>${escapeHtml(lesson.room)}</span>`
    );
  if (lesson.teacher)
    meta.push(
      `<span class="card-meta-item"><span class="card-meta-icon" aria-hidden="true">👤</span>${escapeHtml(lesson.teacher)}</span>`
    );
  const metaBlock = meta.length ? `<div class="card-meta">${meta.join('')}</div>` : '';

  const examBadge = lesson.isExam ? `<span class="card-tag card-tag-exam">Экзамен</span>` : '';

  // Live-таймер и прогресс показываем ТОЛЬКО для is-now карточки
  const liveHtml = isNow
    ? `
    <div class="card-live">
      <div class="card-live-bar"><div class="card-live-fill"></div></div>
      <div class="card-live-text">До конца <b class="countdown">—</b></div>
    </div>`
    : '';

  // Кнопка напоминания рисуется только когда уведомления реально разрешены:
  // кнопка, которая ничего не делает, хуже её отсутствия. Живёт в строке
  // времени — колокольчик без подписи, привязанный к самому времени пары.
  const remindHtml =
    remind && remind.enabled
      ? `<button type="button" class="card-remind${remind.on ? ' is-set' : ''}" data-remind-day="${escapeHtml(day)}" data-remind-idx="${idx}" aria-pressed="${remind.on ? 'true' : 'false'}" title="${remind.on ? 'Напоминание включено' : 'Напомнить заранее'}">
        <span class="card-remind-icon" aria-hidden="true">${remind.on ? '🔔' : '🔕'}</span>
        <span class="sr-only">${remind.on ? 'Напоминание включено' : 'Напомнить заранее'}</span>
      </button>`
      : '';

  return `
    <div class="${cls.join(' ')}" data-day="${escapeHtml(day)}" data-card-idx="${idx}">
      <div class="card-head">
        ${timeBlock}
        <div class="card-flags">${stateBlock}${remindHtml}</div>
      </div>
      <div class="card-subject">${escapeHtml(subject)}</div>
      <div class="card-tags">
        <span class="card-tag card-tag-type ${lesson.type}">${escapeHtml(tpLabel)}</span>
        ${examBadge}
        ${groupTag}
      </div>
      ${metaBlock}
      ${liveHtml}
    </div>`;
};

/**
 * Hero-блок: что показываем между карточками.
 * Если isNow — НЕ показываем hero (карточка сама за себя говорит).
 * Если between (перемена) — показываем "Перемена N мин, дальше X в HH:MM".
 * Если before (до пар) — показываем "Первая пара через N мин".
 * Если after (всё прошло) — "Пары кончились".
 */
const heroHtml = (lessons, status) => {
  if (status === 'empty' || status === 'live') return '';
  const next = getNextLesson(lessons);
  if (status === 'between' && next && !next.isNow) {
    const n = next.lesson;
    return `
      <div class="hero hero-break">
        <div class="hero-icon">⏳</div>
        <div class="hero-body">
          <div class="hero-title">Перемена</div>
          <div class="hero-sub">Дальше: <b>${escapeHtml(n.subject || '—')}</b> в <b>${escapeHtml(n.time || '')}</b></div>
        </div>
        <div class="hero-countdown countdown">—</div>
      </div>`;
  }
  if (status === 'before' && next) {
    return `
      <div class="hero hero-before">
        <div class="hero-icon">🕐</div>
        <div class="hero-body">
          <div class="hero-title">Первая пара через <span class="countdown">—</span></div>
          <div class="hero-sub"><b>${escapeHtml(next.lesson.subject || '—')}</b> в <b>${escapeHtml(next.lesson.time || '')}</b></div>
        </div>
      </div>`;
  }
  if (status === 'after') {
    return `
      <div class="hero hero-after">
        <div class="hero-icon">🎉</div>
        <div class="hero-body">
          <div class="hero-title">Пары кончились</div>
          <div class="hero-sub">Отдыхай</div>
        </div>
      </div>`;
  }
  return '';
};

const dayBlockHtml = (day, items, isToday, _today, options = {}) => {
  const hl = highlightIndex(items);
  const status = dayStatus(items);
  const hero = heroHtml(items, status);
  const selected = { group: options.group || '', subgroup: options.subgroup || '' };
  const cards = items
    .map((it, i) => cardHtml(it, day, i, hl, options.remind ? options.remind(it) : null, selected))
    .join('');
  return `
    <section class="day ${isToday ? 'is-today' : ''}" data-day="${escapeHtml(day)}" data-status="${status}">
      <header class="day-header">
        <div class="day-title-block">
          <div class="day-title">${escapeHtml(day)}</div>
          ${isToday ? '<div class="day-badge">Сегодня</div>' : ''}
        </div>
        <div class="day-count">${items.length} ${dayWord(items.length)}</div>
      </header>
      ${hero}
      <div class="cards">${cards || `<div class="empty-day">${escapeHtml(options.emptyText || 'Пар нет')}</div>`}</div>
    </section>`;
};

/**
 * Компактная строка недели.
 *
 * Три колонки с разными ролями: время фиксированной ширины, предмет — что
 * студент ищет глазами, метаданные приглушены и прижаты вправо. Раньше всё шло
 * одной строкой через «·», из-за чего предмет не выделялся, а номер аудитории
 * дублировался, если он уже был вписан в название предмета.
 */
const weekRowHtml = (lesson, day) => {
  const subject = subjectWithoutRoom(lesson.subject || '—', lesson.room);
  const meta = [lesson.room, lesson.teacher].filter(Boolean).join(' · ');
  return `
  <button type="button" class="wk-row" data-day="${escapeHtml(day)}">
    <span class="wk-time">${escapeHtml(lesson.time || '—')}</span>
    <span class="wk-subject">${escapeHtml(subject)}</span>
    <span class="wk-meta">${escapeHtml(meta)}</span>
    <span class="wk-arrow" aria-hidden="true">→</span>
  </button>`;
};

const weekPlanHtml = (plan) => {
  const total = plan.reduce((sum, entry) => sum + entry.count, 0);
  const summary = total
    ? `<p class="wk-total">На неделе <b>${total}</b> ${lessonWord(total)}</p>`
    : '';
  return `${summary}${plan
    .map(
      (entry) => `
    <section class="wk-day ${entry.isToday ? 'is-today' : ''}" data-day="${escapeHtml(entry.day)}">
      <header class="wk-head">
        <span class="wk-day-name">${escapeHtml(entry.day)}</span>
        ${entry.isToday ? '<span class="wk-badge">сегодня</span>' : ''}
        <span class="wk-count">${entry.count} ${lessonWord(entry.count)}</span>
      </header>
      <div class="wk-rows">${entry.items.map((it) => weekRowHtml(it, entry.day)).join('')}</div>
    </section>`
    )
    .join('')}`;
};

const emptyHtml = (title, sub) => `
  <div class="empty">
    <div class="empty-illu">${title === 'Ничего не найдено' ? '🔍' : '🗓️'}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
  </div>`;

/**
 * Пустой экран должен отвечать на вопрос, а не выглядеть поломкой:
 * «расписания нет», «группа не выбрана», «на этот день пар нет» — это разные
 * ситуации с разными подсказками.
 */
const EMPTY_COPY = {
  'load-failed': [
    'Не удалось загрузить расписание',
    'Похоже, нет связи. Проверь интернет и нажми «Повторить» выше.',
  ],
  'no-schedule': [
    'Расписание ещё не опубликовано',
    'Как только колледж опубликует новую неделю, она появится здесь сама.',
  ],
  'no-group': [
    'Выбери свою группу',
    'Нажми «Группа» сверху — один раз запомним, и дальше сразу откроем твои пары.',
  ],
  'no-group-lessons': [
    'Для этой группы пока нет пар',
    'Проверь отделение или выбери другую группу — расписание берётся из файла.',
  ],
  'no-lessons-today': [
    'На этот день пар нет',
    'Посмотри неделю кнопкой «Неделя» или выбери другой день.',
  ],
  unknown: ['Ничего не найдено', 'Проверь выбранную группу или запрос поиска.'],
};

const emptyFor = (reason) => {
  const [title, sub] = EMPTY_COPY[reason] || EMPTY_COPY.unknown;
  return emptyHtml(title, sub);
};

/**
 * Виджет «Завтра» — показываем когда сегодня пар нет.
 * Приоритет: tomorrow (если в файле) → следующий день с парами.
 */
const tomorrowWidgetHtml = (lessons, todayName) => {
  // lessons — все уроки, разбитые по дням; ищем следующий день с >0 пар
  const byDay = new Map();
  for (const l of lessons) {
    if (!byDay.has(l.day)) byDay.set(l.day, []);
    byDay.get(l.day).push(l);
  }
  // Сначала ищем "завтра" по реальному дню недели
  const tomorrowName = getTomorrowName();
  let nextDay = null;
  if (tomorrowName && byDay.has(tomorrowName)) nextDay = tomorrowName;
  // Если в файле нет "завтра" — ищем ближайший день с парами после сегодня
  if (!nextDay) {
    const todayIdx = todayName ? DAY_ORDER.indexOf(todayName) : 0;
    for (let i = 1; i <= 7; i++) {
      const idx = (todayIdx + i) % 7;
      const name = DAY_ORDER[idx];
      if (byDay.has(name)) {
        nextDay = name;
        break;
      }
    }
  }
  if (!nextDay) return '';
  const nextLessons = byDay
    .get(nextDay)
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const first = nextLessons[0];
  if (!first) return '';
  return `
    <div class="tomorrow-widget">
      <div class="tw-icon">📅</div>
      <div class="tw-body">
        <div class="tw-title">${escapeHtml(nextDay)}</div>
        <div class="tw-sub">${nextLessons.length} ${lessonWord(nextLessons.length)} · первая в <b>${escapeHtml(first.time || '—')}</b></div>
        <div class="tw-first">${escapeHtml(first.subject || '—')}</div>
      </div>
    </div>`;
};

/**
 * View.
 * Lifecycle: render(lessons, meta) → scheduleView вызывается каждый раз при изменении фильтров.
 *               start() → запускает live-таймер (каждую секунду обновляет countdown и прогресс-бар is-now карточки)
 *               stop() → останавливает таймер
 *
 * Re-render: каждый раз destroy старого и render нового. Внутри render мы НЕ запускаем таймер
 * автоматически — start() вызывается из app.js после refreshControls().
 */
export function createScheduleView(container) {
  /** @type {(d: string) => void} */
  let onDayChange = () => {};
  /** @type {(t: string) => void} */
  let onRefresh = () => {};
  /** @type {(lesson: any) => void} */
  let onRemind = () => {};
  /** @type {(day: string) => void} */
  let onOpenDay = () => {};
  /** @type {string} */
  let activeDay = '';
  /** @type {any[]} */
  let lastLessons = [];
  /** @type {Map<string, any[]>} */
  let renderedByDay = new Map();
  /** @type {any} */
  let lastMeta = null;
  let isMobile = window.matchMedia('(max-width: 768px)').matches;
  /** @type {(() => void) | null} */
  let rerender = null;
  /**
   * Поворот экрана и изменение ширины окна меняют `isMobile`, а значит и всю
   * разметку: на мобильном нужны пилюли дней и карусель, на десктопе — нет.
   * Поэтому пересчёт обязан перерисовать список, иначе пилюли появляются
   * только после смены дня, а на десктопе не появляются вовсе.
   */
  const syncViewport = () => {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    if (mobile === isMobile) return;
    isMobile = mobile;
    rerender?.();
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncViewport);
    ro.observe(document.documentElement);
  } else {
    window.addEventListener('resize', syncViewport);
  }

  // Live-таймер — обновляет только countdown-элементы и прогресс-бар is-now.
  // Безопасный к перерисовке: ищет DOM-узлы каждый тик, не хранит ссылки.
  let liveTimer = null;
  const tick = () => {
    // Обновляем все .countdown (hero + is-now card)
    const nowMs = Date.now();
    document.querySelectorAll('.countdown').forEach((el) => {
      const target = Number(el.dataset.target);
      if (!target) return;
      const delta = target - nowMs;
      el.textContent = formatCountdown(delta);
      // В hero "между" — если delta < 0 значит пора пересчитать highlight, перерисуем
      if (delta < -1000) el.classList.add('is-stale');
    });
    // Прогресс-бар is-now. Индекс карточки относится к её дню, а не ко всему
    // списку, поэтому ищем занятие через renderedByDay.
    const isNow = container.querySelector('.card.is-now');
    if (isNow) {
      const items = renderedByDay.get(isNow.dataset.day) || [];
      const lesson = items[Number(isNow.dataset.cardIdx)];
      if (lesson) {
        const fill = isNow.querySelector('.card-live-fill');
        if (fill) fill.style.width = cardProgress(lesson) + '%';
      }
    }
  };
  const start = () => {
    if (liveTimer) return;
    liveTimer = setInterval(tick, 1000);
    tick();
  };
  const stop = () => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  };

  // --- Pull-to-refresh (mobile) ---
  let pullStartY = 0,
    pulling = false,
    pullEl = null;
  const attachPull = () => {
    if (pullEl) pullEl.remove();
    pullEl = document.createElement('div');
    pullEl.className = 'pull-indicator';
    pullEl.innerHTML = `<div class="pull-spinner"></div><span>Потяните для обновления</span>`;
    document.body.appendChild(pullEl);
    const onTouchStart = (e) => {
      if (window.scrollY > 5) return;
      pullStartY = e.touches[0].clientY;
      pulling = true;
    };
    const onTouchMove = (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - pullStartY;
      if (dy > 60 && window.scrollY < 5) pullEl.classList.add('is-ready');
      if (dy > 0 && window.scrollY < 5)
        pullEl.style.transform = `translateY(${Math.min(dy, 120)}px)`;
    };
    const onTouchEnd = (e) => {
      if (!pulling) return;
      pulling = false;
      const dy = (e.changedTouches[0]?.clientY || pullStartY) - pullStartY;
      pullEl.classList.remove('is-ready');
      if (dy > 80) {
        pullEl.classList.add('is-loading');
        onRefresh();
        setTimeout(() => pullEl.classList.remove('is-loading'), 1500);
      }
      pullEl.style.transform = '';
    };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
  };

  /**
   * @param {any[]} lessons все занятия выбранной группы (без фильтра по дню)
   * @param {{
   *   today: string,
   *   mode?: 'day'|'week',
   *   plan?: {day: string, items: any[], count: number, isToday: boolean}[],
   *   selectedDay?: string,
   *   emptyReason?: string,
   *   canRemind?: boolean,
   *   isReminded?: (lesson: any) => boolean,
   *   group?: string,
   *   subgroup?: string,
   * }} meta
   */
  const render = (lessons, meta) => {
    // Сохраняем для live-таймера, для "завтра" и для перерисовки при смене
    // вьюпорта: последняя должна повторить ровно этот вызов.
    lastLessons = lessons;
    lastMeta = meta;
    rerender = () => {
      if (!lastMeta) return;
      render(lastLessons, lastMeta);
    };
    const today = meta.today || '';

    if (!lessons.length) {
      // Ничего не показать нельзя молча: объясняем, что именно пусто.
      container.innerHTML = emptyFor(meta.emptyReason || 'unknown');
      activeDay = '';
      renderedByDay = new Map();
      return;
    }

    const byDay = new Map();
    for (const it of lessons) {
      const k = it.day || 'Без дня';
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(it);
    }
    // Парсим время заранее для live-таймера
    for (const list of byDay.values()) ensureParsed(list);

    const itemsOf = (day) =>
      (byDay.get(day) || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const ordered = [...byDay.keys()].sort((a, b) => {
      const ia = DAY_ORDER.indexOf(a),
        ib = DAY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const remind = meta.canRemind
      ? (lesson) => ({ enabled: true, on: Boolean(meta.isReminded && meta.isReminded(lesson)) })
      : null;

    renderedByDay = new Map(ordered.map((d) => [d, itemsOf(d)]));

    // --- Режим «Неделя»: все дни списком, одинаковый стиль, но компактнее. ---
    if (meta.mode === 'week') {
      const plan = (meta.plan || []).filter((entry) => byDay.has(entry.day));
      activeDay = '';
      container.innerHTML = plan.length
        ? weekPlanHtml(plan)
        : emptyFor(meta.emptyReason || 'unknown');
      container.querySelectorAll('.wk-row').forEach((row) => {
        row.addEventListener('click', () => onOpenDay(row.dataset.day));
      });
      return;
    }

    // --- Режим «День» (по умолчанию). ---
    // Явно выбранный день wins; иначе — сегодня, иначе первый день с парами.
    if (meta.selectedDay) {
      activeDay = meta.selectedDay;
    } else if (!ordered.includes(activeDay)) {
      activeDay = today && ordered.includes(today) ? today : ordered[0] || '';
    }
    const dayList = ordered.includes(activeDay) ? ordered : [activeDay, ...ordered].filter(Boolean);
    const dayOptions = {
      remind,
      emptyText: 'На этот день пар нет',
      // Карточка не повторяет то, что уже написано в шапке.
      group: meta.group || '',
      subgroup: meta.subgroup || '',
    };

    if (!isMobile) {
      container.innerHTML = dayBlockHtml(
        activeDay,
        itemsOf(activeDay),
        activeDay === today,
        today,
        dayOptions
      );
    } else {
      // Сегодня — особый случай: если сегодня пар нет, показываем "завтра"
      // поверх пустого дня.
      const todayItems = today ? byDay.get(today) || [] : [];
      const todayIsEmpty = !todayItems.length;
      const tomorrowWidget =
        todayIsEmpty && activeDay === today ? tomorrowWidgetHtml(lessons, today) : '';

      const pillsHtml = `<div class="day-pills" role="tablist">
        ${ordered
          .map((d) => {
            const isActive = d === activeDay;
            return `<button type="button" class="day-pill ${isActive ? 'active' : ''} ${d === today ? 'is-today' : ''}" data-day="${escapeHtml(d)}">
            ${DAY_SHORT[d] || escapeHtml(d)}
          </button>`;
          })
          .join('')}
      </div>`;

      const slidesHtml = dayList
        .map((d) => {
          const isActive = d === activeDay;
          return `<div class="day-slide ${isActive ? 'active' : ''}" data-day="${escapeHtml(d)}">${dayBlockHtml(
            d,
            itemsOf(d),
            d === today,
            today,
            dayOptions
          )}</div>`;
        })
        .join('');

      container.innerHTML =
        tomorrowWidget + pillsHtml + `<div class="day-carousel">${slidesHtml}</div>`;

      container.querySelectorAll('.day-pill').forEach((tab) => {
        tab.addEventListener('click', () => showDay(tab.dataset.day));
      });

      attachSwipe(container, ordered, (d) => showDay(d));
    }

    // После render: обновить live-таймер и countdown targets
    updateCountdownTargets();
  };

  /** Устанавливает data-target на .countdown элементы. */
  const updateCountdownTargets = () => {
    // is-now card countdown: target = end-time сегодня (миллисекунды)
    const isNow = container.querySelector('.card.is-now');
    if (isNow) {
      const items = renderedByDay.get(isNow.dataset.day) || [];
      const lesson = items[Number(isNow.dataset.cardIdx)];
      if (lesson && lesson._parsed && lesson._parsed.end) {
        const target = todayTimeToMs(lesson._parsed.end);
        const cd = isNow.querySelector('.countdown');
        if (cd) cd.dataset.target = String(target);
      }
    }
    // Hero "before" — первая пара сегодня
    const before = container.querySelector('.hero-before .countdown');
    if (before) {
      const hero = container.querySelector('.hero-before');
      const day = hero?.closest('.day');
      const dayName = day?.dataset.day;
      const items = dayName ? currentDayLessons(dayName) : [];
      const next = getNextLesson(items);
      if (next?.lesson?._parsed?.start) {
        before.dataset.target = String(todayTimeToMs(next.lesson._parsed.start));
      }
    }
    // Hero "between" — следующая пара
    const between = container.querySelector('.hero-break .countdown');
    if (between) {
      const hero = container.querySelector('.hero-break');
      const day = hero?.closest('.day');
      const dayName = day?.dataset.day;
      const items = dayName ? currentDayLessons(dayName) : [];
      const next = getNextLesson(items);
      if (next?.lesson?._parsed?.start) {
        between.dataset.target = String(todayTimeToMs(next.lesson._parsed.start));
      }
    }
  };

  const currentDayLessons = (dayName) => lastLessons.filter((l) => l.day === dayName);

  /** "HH:MM" (сегодняшние минуты) → абсолютный timestamp в ms. */
  const todayTimeToMs = (min) => {
    const d = new Date();
    d.setHours(Math.floor(min / 60), min % 60, 0, 0);
    return d.getTime();
  };

  function showDay(day) {
    activeDay = day;
    const slides = container.querySelectorAll('.day-slide');
    const pills = container.querySelectorAll('.day-pill');
    slides.forEach((s) => s.classList.toggle('active', s.dataset.day === day));
    pills.forEach((t) => {
      t.classList.toggle('active', t.dataset.day === day);
      if (t.dataset.day === day)
        t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    const activeSlide = container.querySelector('.day-slide.active');
    if (activeSlide) activeSlide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onDayChange(day);
  }

  function attachSwipe(root, days, cb) {
    let startX = 0,
      startY = 0,
      dx = 0,
      dy = 0,
      locked = false,
      _touchStartTime = 0;
    const slidesRoot = root.querySelector('.day-carousel');
    if (!slidesRoot) return;
    slidesRoot.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        dx = 0;
        dy = 0;
        locked = false;
        _touchStartTime = Date.now();
      },
      { passive: true }
    );
    slidesRoot.addEventListener(
      'touchmove',
      (e) => {
        const t = e.touches[0];
        dx = t.clientX - startX;
        dy = t.clientY - startY;
        if (!locked) {
          if (Math.abs(dx) > Math.abs(dy) * 1.4) locked = 'h';
          else if (Math.abs(dy) > Math.abs(dx) * 1.4) locked = 'v';
        }
      },
      { passive: true }
    );
    slidesRoot.addEventListener(
      'touchend',
      () => {
        if (locked !== 'h' || Math.abs(dx) < 50) return;
        const idx = days.indexOf(activeDay);
        if (dx < 0 && idx < days.length - 1) cb(days[idx + 1]);
        else if (dx > 0 && idx > 0) cb(days[idx - 1]);
      },
      { passive: true }
    );
  }

  // Привязываем pull-to-refresh при первом render на mobile
  let pullAttached = false;
  const ensurePull = () => {
    if (!isMobile || pullAttached) return;
    attachPull();
    pullAttached = true;
  };

  // Вибрация при тапе на карточку
  const attachCardVibrate = () => {
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card && navigator.vibrate) navigator.vibrate(10);
    });
  };

  /**
   * Тап по «Напомнить» на карточке. Делегирование, а не обработчик на каждой
   * кнопке: карточки перерисовываются на каждое изменение состояния.
   */
  const attachRemindTap = () => {
    container.addEventListener('click', (e) => {
      const button = e.target.closest('.card-remind');
      if (!button) return;
      // Кнопка не должна дёргать карточку и не должна вести себя как её тап.
      e.stopPropagation();
      e.preventDefault();
      const items = renderedByDay.get(button.dataset.remindDay) || [];
      const lesson = items[Number(button.dataset.remindIdx)];
      if (lesson) onRemind(lesson);
    });
  };

  return {
    render,
    start() {
      start();
      ensurePull();
      attachCardVibrate();
      attachRemindTap();
    },
    stop,
    showDay,
    setOnDayChange: (cb) => {
      onDayChange = cb;
    },
    setOnRefresh: (cb) => {
      onRefresh = cb;
    },
    setOnRemind: (cb) => {
      onRemind = cb;
    },
    setOnOpenDay: (cb) => {
      onOpenDay = cb;
    },
  };
}
