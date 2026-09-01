import { escapeHtml } from '../text.js';
import { TYPE_LABELS, DAY_SHORT, DAY_ORDER } from '../constants.js';
import { lessonState, highlightIndex } from '../timing.js';

const dayWord = (n) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
};

const stateLabel = (s) => ({
  now:  { tag: 'now',  text: '● Сейчас' },
  next: { tag: 'next', text: 'Дальше' },
  past: { tag: 'past', text: 'Завершено' },
  idle: { tag: '',     text: '' }
}[s] || { tag: '', text: '' });

const cardHtml = (lesson, idx, highlight) => {
  const tpLabel = TYPE_LABELS[lesson.type] ?? 'Занятие';
  const state = lessonState(lesson);
  const isNow = highlight.now === idx;
  const isNext = highlight.next === idx;
  const cls = ['card'];
  if (isNow) cls.push('is-now');
  else if (isNext) cls.push('is-next');
  else if (state === 'past') cls.push('is-past');

  const meta = [];
  if (lesson.group) meta.push(`<span class="chip chip-group"><b>Группа:</b> ${escapeHtml(lesson.group)}${lesson.subgroup ? ` <sup>(${escapeHtml(lesson.subgroup)})</sup>` : ''}</span>`);
  if (lesson.teacher) meta.push(`<span class="chip chip-teacher"><b>Преподаватель:</b> ${escapeHtml(lesson.teacher)}</span>`);
  if (lesson.room) meta.push(`<span class="chip chip-room"><b>Аудитория:</b> ${escapeHtml(lesson.room)}</span>`);

  const sl = stateLabel(state);
  const stateBlock = sl.text ? `<span class="state-pill ${sl.tag}">${sl.text}</span>` : '';
  const timeBlock = lesson.time ? `<span class="time">🕒 ${escapeHtml(lesson.time)}</span>` : '';

  return `
    <div class="${cls.join(' ')}">
      <div class="card-top">
        ${timeBlock}
        <div class="card-tags">
          <span class="type-pill ${lesson.type}">${tpLabel}</span>
          ${stateBlock}
        </div>
      </div>
      <div class="subject">${escapeHtml(lesson.subject || '—')}</div>
      <div class="row-info">${meta.join('')}</div>
    </div>`;
};

const dayBlockHtml = (day, items, isToday) => {
  const hl = highlightIndex(items);
  const cards = items.map((it, i) => cardHtml(it, i, hl)).join('');
  return `
    <section class="day ${isToday ? 'is-today' : ''}" data-day="${escapeHtml(day)}">
      <header class="day-header">
        <div class="day-title-block">
          <div class="day-title">${escapeHtml(day)}</div>
          ${isToday ? '<div class="day-badge">Сегодня</div>' : ''}
        </div>
        <div class="day-count">${items.length} ${dayWord(items.length)}</div>
      </header>
      <div class="cards">${cards || '<div class="empty-day">Пар нет</div>'}</div>
    </section>`;
};

const emptyHtml = (title, sub) => `
  <div class="empty">
    <div class="empty-illu">${title === 'Ничего не найдено' ? '🔍' : '🗓️'}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
  </div>`;

/**
 * View supports two modes:
 *  - swipe mode (default on mobile): one day visible at a time, swipe between days, tab bar at bottom
 *  - list mode (desktop): all days stacked vertically
 */
export function createScheduleView(container) {
  /** @type {(d: string) => void} */
  let onDayChange = () => {};
  /** @type {string} */
  let activeDay = '';
  // Кешируем результат matchMedia, обновляем только при resize — иначе
  // matchMedia вызывался бы на каждое нажатие клавиши в поиске.
  let isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      isMobile = window.matchMedia('(max-width: 768px)').matches;
    });
    ro.observe(document.documentElement);
  } else {
    window.addEventListener('resize', () => {
      isMobile = window.matchMedia('(max-width: 768px)').matches;
    });
  }

  const render = (lessons, meta) => {
    if (!lessons.length) {
      container.innerHTML = emptyHtml('Ничего не найдено', 'Попробуйте изменить фильтры или поисковый запрос.');
      activeDay = '';
      return;
    }

    // Group by day
    const byDay = new Map();
    for (const it of lessons) {
      const k = it.day || 'Без дня';
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(it);
    }
    const ordered = [...byDay.keys()].sort((a, b) => {
      const ia = DAY_ORDER.indexOf(a), ib = DAY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    // Сбрасываем activeDay, если выбранный день больше не в списке
    // (например, после фильтра только на одну группу без пятницы).
    if (!ordered.includes(activeDay)) {
      activeDay = meta.today && ordered.includes(meta.today)
        ? meta.today
        : ordered[0] || '';
    }

    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (!isMobile) {
      activeDay = '';
      // Desktop: all days stacked
      container.innerHTML = ordered.map((d) => {
        const items = byDay.get(d).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        return dayBlockHtml(d, items, d === meta.today);
      }).join('');
    } else {
      // Mobile: day carousel with tabs at bottom
      const tabsHtml = ordered.map((d) => {
        const isActive = d === activeDay;
        return `<button type="button" class="day-tab ${isActive ? 'active' : ''} ${d === meta.today ? 'is-today' : ''}" data-day="${escapeHtml(d)}">
          <span class="day-tab-day">${DAY_SHORT[d] || escapeHtml(d)}</span>
          <span class="day-tab-num">${byDay.get(d).length}</span>
        </button>`;
      }).join('');

      const slidesHtml = ordered.map((d) => {
        const items = byDay.get(d).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const isActive = d === activeDay;
        return `<div class="day-slide ${isActive ? 'active' : ''}" data-day="${escapeHtml(d)}">${dayBlockHtml(d, items, d === meta.today)}</div>`;
      }).join('');

      container.innerHTML = `
        <div class="day-carousel">${slidesHtml}</div>
        <nav class="day-tabs" role="tablist">${tabsHtml}</nav>`;

      // Wire up tab clicks
      container.querySelectorAll('.day-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          const day = tab.dataset.day;
          showDay(day);
        });
      });

      // Touch / swipe between days
      attachSwipe(container, ordered, (d) => showDay(d));
    }
  };

  function showDay(day) {
    activeDay = day;
    const slides = container.querySelectorAll('.day-slide');
    const tabs = container.querySelectorAll('.day-tab');
    slides.forEach((s) => s.classList.toggle('active', s.dataset.day === day));
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.day === day));
    const activeSlide = container.querySelector('.day-slide.active');
    if (activeSlide) {
      // Scroll into view
      activeSlide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    onDayChange(day);
  }

  function attachSwipe(root, days, cb) {
    let startX = 0, startY = 0, dx = 0, dy = 0, locked = false;
    const slidesRoot = root.querySelector('.day-carousel');
    if (!slidesRoot) return;
    slidesRoot.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; dx = 0; dy = 0; locked = false;
    }, { passive: true });
    slidesRoot.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      dx = t.clientX - startX;
      dy = t.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) > Math.abs(dy) * 1.4) locked = 'h';
        else if (Math.abs(dy) > Math.abs(dx) * 1.4) locked = 'v';
      }
    }, { passive: true });
    slidesRoot.addEventListener('touchend', () => {
      if (locked !== 'h' || Math.abs(dx) < 50) return;
      const idx = days.indexOf(activeDay);
      if (dx < 0 && idx < days.length - 1) cb(days[idx + 1]);
      else if (dx > 0 && idx > 0) cb(days[idx - 1]);
    }, { passive: true });
  }

  return { render, showDay, setOnDayChange: (cb) => { onDayChange = cb; } };
}
