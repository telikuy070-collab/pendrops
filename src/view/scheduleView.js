import { escapeHtml } from '../text.js';
import { TYPE_LABELS, DAY_SHORT, DAY_ORDER } from '../constants.js';
import { lessonState, highlightIndex, dayStatus, getNextLesson, getNowMinutes, timeToMin, formatCountdown, getTomorrowName } from '../timing.js';

const dayWord = (n) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'занятие';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'занятия';
  return 'занятий';
};

const lessonWord = (n) => {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пара';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'пары';
  return 'пар';
};

const stateLabel = (s) => ({
  now:  { tag: 'now',  text: '● Сейчас' },
  next: { tag: 'next', text: 'Дальше' },
  past: { tag: 'past', text: 'Завершено' },
  idle: { tag: '',     text: '' }
}[s] || { tag: '', text: '' });

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

const cardHtml = (lesson, idx, highlight) => {
  const tpLabel = TYPE_LABELS[lesson.type] ?? 'Занятие';
  const state = lessonState(lesson);
  const isNow = highlight.now === idx;
  const isNext = highlight.next === idx;
  const cls = ['card'];
  if (isNow) cls.push('is-now');
  else if (isNext) cls.push('is-next');
  else if (state === 'past') cls.push('is-past');
  if (lesson.isExam) cls.push('is-exam');

  const meta = [];
  if (lesson.group) meta.push(`<span class="chip chip-group"><b>Группа:</b> ${escapeHtml(lesson.group)}${lesson.subgroup ? ` <sup>(${escapeHtml(lesson.subgroup)})</sup>` : ''}</span>`);
  if (lesson.teacher) meta.push(`<span class="chip chip-teacher"><b>Преподаватель:</b> ${escapeHtml(lesson.teacher)}</span>`);
  if (lesson.room) meta.push(`<span class="chip chip-room"><b>Аудитория:</b> ${escapeHtml(lesson.room)}</span>`);

  const sl = stateLabel(state);
  const stateBlock = sl.text ? `<span class="state-pill ${sl.tag}">${sl.text}</span>` : '';
  const timeBlock = lesson.time ? `<span class="time">🕒 ${escapeHtml(lesson.time)}</span>` : '';
  const examBadge = lesson.isExam ? `<span class="exam-badge">📝 Экзамен</span>` : '';

  // Live-таймер и прогресс показываем ТОЛЬКО для is-now карточки
  const liveHtml = isNow ? `
    <div class="card-live">
      <div class="card-live-bar"><div class="card-live-fill"></div></div>
      <div class="card-live-text">Осталось <b class="countdown">—</b></div>
    </div>` : '';

  return `
    <div class="${cls.join(' ')}" data-card-idx="${idx}">
      <div class="card-top">
        ${timeBlock}
        <div class="card-tags">
          ${examBadge}
          <span class="type-pill ${lesson.type}">${tpLabel}</span>
          ${stateBlock}
        </div>
      </div>
      <div class="subject">${escapeHtml(lesson.subject || '—')}</div>
      <div class="row-info">${meta.join('')}</div>
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

const dayBlockHtml = (day, items, isToday, today) => {
  const hl = highlightIndex(items);
  const status = dayStatus(items);
  const hero = heroHtml(items, status);
  const cards = items.map((it, i) => cardHtml(it, i, hl)).join('');
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
  const ordered = [...byDay.keys()].sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a), ib = DAY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
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
      if (byDay.has(name)) { nextDay = name; break; }
    }
  }
  if (!nextDay) return '';
  const nextLessons = byDay.get(nextDay).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
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
  /** @type {string} */
  let activeDay = '';
  /** @type {any[]} */
  let lastLessons = [];
  /** @type {string} */
  let lastToday = '';
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
    // Прогресс-бар is-now
    const isNow = container.querySelector('.card.is-now');
    if (isNow) {
      const idx = Number(isNow.dataset.cardIdx);
      const lesson = lastLessons[idx];
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
  let pullStartY = 0, pulling = false, pullEl = null;
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
      if (dy > 0 && window.scrollY < 5) pullEl.style.transform = `translateY(${Math.min(dy, 120)}px)`;
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

  const render = (lessons, meta) => {
    // Сохраняем для live-таймера и для "завтра"
    lastLessons = lessons;
    lastToday = meta.today || '';

    if (!lessons.length) {
      // Если есть данные в lessons, но фильтр всё отрезал — показываем пусто.
      // Иначе: empty state с "завтра" (если есть state.sheets)
      container.innerHTML = emptyHtml('Ничего не найдено', 'Попробуйте изменить фильтры или поисковый запрос.');
      activeDay = '';
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

    const ordered = [...byDay.keys()].sort((a, b) => {
      const ia = DAY_ORDER.indexOf(a), ib = DAY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b, 'ru');
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    if (!ordered.includes(activeDay)) {
      activeDay = meta.today && ordered.includes(meta.today)
        ? meta.today
        : ordered[0] || '';
    }

    if (!isMobile) {
      activeDay = '';
      container.innerHTML = ordered.map((d) => {
        const items = byDay.get(d).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        return dayBlockHtml(d, items, d === meta.today, meta.today);
      }).join('');
    } else {
      // Сегодня — особый случай: если сегодня пар нет (или пусто в текущей выборке),
      // показываем "завтра" поверх пустого дня.
      const todayName = meta.today;
      const todayItems = todayName ? (byDay.get(todayName) || []) : [];
      const todayIsEmpty = !todayItems.length;

      // Если сегодня пустой И это "первый" показ — добавляем tomorrow widget
      const tomorrowWidget = todayIsEmpty ? tomorrowWidgetHtml(lessons, todayName) : '';

      const pillsHtml = `<div class="day-pills" role="tablist">
        ${ordered.map((d) => {
          const isActive = d === activeDay;
          return `<button type="button" class="day-pill ${isActive ? 'active' : ''} ${d === meta.today ? 'is-today' : ''}" data-day="${escapeHtml(d)}">
            ${DAY_SHORT[d] || escapeHtml(d)}
          </button>`;
        }).join('')}
      </div>`;

      const slidesHtml = ordered.map((d) => {
        const items = byDay.get(d).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const isActive = d === activeDay;
        const isTodayDay = d === meta.today;
        return `<div class="day-slide ${isActive ? 'active' : ''}" data-day="${escapeHtml(d)}">${dayBlockHtml(d, items, isTodayDay, meta.today)}</div>`;
      }).join('');

      container.innerHTML = tomorrowWidget + pillsHtml + `<div class="day-carousel">${slidesHtml}</div>`;

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
      const idx = Number(isNow.dataset.cardIdx);
      const lesson = lastLessons[idx];
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
      if (t.dataset.day === day) t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    const activeSlide = container.querySelector('.day-slide.active');
    if (activeSlide) activeSlide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onDayChange(day);
  }

  function attachSwipe(root, days, cb) {
    let startX = 0, startY = 0, dx = 0, dy = 0, locked = false, touchStartTime = 0;
    const slidesRoot = root.querySelector('.day-carousel');
    if (!slidesRoot) return;
    slidesRoot.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; dx = 0; dy = 0; locked = false;
      touchStartTime = Date.now();
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

  return {
    render,
    start() { start(); ensurePull(); attachCardVibrate(); },
    stop,
    showDay,
    setOnDayChange: (cb) => { onDayChange = cb; },
    setOnRefresh: (cb) => { onRefresh = cb; }
  };
}
