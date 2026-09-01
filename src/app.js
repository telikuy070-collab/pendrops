import { parseWorkbook } from './sheet.js';
import { loadState, saveState } from './store.js';
import { createScheduleView } from './view/scheduleView.js';
import { createToast } from './view/toast.js';
import { escapeHtml, debounce } from './text.js';
import { DAY_ORDER } from './constants.js';
import { getTodayName } from './timing.js';

const els = {
  fileInput: /** @type {HTMLInputElement} */ (document.getElementById('fileInput')),
  demoBtn: document.getElementById('demoBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  quickPick: document.getElementById('quickPick'),
  sheetBtn: document.getElementById('sheetBtn'),
  groupBtn: document.getElementById('groupBtn'),
  sheetValue: document.getElementById('sheetValue'),
  groupValue: document.getElementById('groupValue'),
  subgroupChipsRow: document.getElementById('subgroupChipsRow'),
  subgroupChips: document.getElementById('subgroupChips'),
  searchInput: /** @type {HTMLInputElement} */ (document.getElementById('searchInput')),
  dayFilter: /** @type {HTMLSelectElement} */ (document.getElementById('dayFilter')),
  resetBtn: document.getElementById('resetBtn'),
  settingsModal: document.getElementById('settingsModal'),
  sheetModal: document.getElementById('sheetModal'),
  groupModal: document.getElementById('groupModal'),
  sheetList: document.getElementById('sheetList'),
  groupList: document.getElementById('groupList'),
  fileHint: document.getElementById('fileHint')
};

const state = await loadState();
const view = createScheduleView(document.getElementById('scheduleContainer'));
const toast = createToast(document.getElementById('toast'));

/** @type {string} */
let activeSubgroup = '';

/**
 * Persist current state. Returns where it was saved: 'ls' | 'idb' | 'none'.
 * Показывает toast при 'none' — сохранение не удалось (например, нет IndexedDB).
 */
async function persist() {
  const where = await saveState(state);
  if (where === 'none') {
    toast.show('Не удалось сохранить — изменения только в памяти', 'bad');
  } else if (where === 'idb') {
    toast.show('Хранилище переполнено — сохранено в резерв', 'ok');
  }
  return where;
}

const demoData = () => ({
  'Демо': [
    { day: 'Понедельник', time: '09:00-10:50', para: '1', group: 'СЖ-1-25', subgroup: '1', subject: 'Анатомия', type: 'tp-lecture', teacher: 'Иванов И.И.', room: '№7 корпус 315' },
    { day: 'Понедельник', time: '11:40-13:00', para: '3', group: 'СЖ-1-25', subgroup: '1', subject: 'Фармакология', type: 'tp-practice', teacher: 'Петров П.П.', room: '№7 корп. 365' },
    { day: 'Вторник', time: '09:30-10:50', para: '2', group: 'СЖ-1-25', subgroup: '2', subject: 'Английский', type: 'tp-practice', teacher: 'Сидоров С.', room: '№7 корп. 312' }
  ]
});

/** Форматирует timestamp в "пн, 1 сен 14:30" — коротко и понятно. */
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${hh}:${mm}`;
}

const uniqueSorted = (arr) =>
  Array.from(new Set(arr.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'ru'));

function currentLessons() {
  return state.sheets[state.current] || [];
}

function applyFilters(lessons, filters) {
  let out = lessons;
  if (filters.day) out = out.filter((it) => it.day === filters.day);
  if (filters.group) out = out.filter((it) => it.group === filters.group);
  if (filters.subgroup) out = out.filter((it) => it.subgroup === filters.subgroup);
  if (filters.search) {
    const q = filters.search;
    out = out.filter((it) =>
      `${it.day} ${it.time} ${it.group} ${it.subject} ${it.teacher} ${it.room}`.toLowerCase().includes(q)
    );
  }
  return out;
}

const keyOf = (it) =>
  `${it.day}|${it.time}|${it.para}|${it.group}|${it.subgroup}|${it.subject}|${it.type}|${it.teacher}|${it.room}`;

function readFilters() {
  return {
    day: els.dayFilter.value,
    group: state.group,
    subgroup: activeSubgroup,
    search: els.searchInput.value.trim().toLowerCase()
  };
}

const render = debounce(() => {
  const filtered = applyFilters(currentLessons(), readFilters());
  view.render(filtered, { today: getTodayName() });
}, 50);

// --- Quick pick values (top chooser buttons) ---
function updateQuickPick() {
  if (state.current && els.sheetValue) els.sheetValue.textContent = state.current;
  if (state.group && els.groupValue) els.groupValue.textContent = state.group;
}

// --- Subgroup chips visibility ---
function refreshSubgroupChips(lessons) {
  // Determine the lessons for the currently selected group (or all if none)
  const relevant = state.group ? lessons.filter((l) => l.group === state.group) : lessons;
  const available = new Set(relevant.map((l) => l.subgroup).filter(Boolean));

  if (available.size <= 1 && state.group) {
    els.subgroupChipsRow.hidden = true;
    activeSubgroup = '';
    return;
  }
  els.subgroupChipsRow.hidden = false;

  const buttons = els.subgroupChips.querySelectorAll('.chip-btn');
  buttons.forEach((btn) => {
    const v = btn.dataset.value || '';
    if (v === '') { btn.hidden = false; return; }
    btn.hidden = !available.has(v);
  });
  if (activeSubgroup && !available.has(activeSubgroup)) activeSubgroup = '';
  updateChipsActive();
}

function updateChipsActive() {
  const buttons = els.subgroupChips.querySelectorAll('.chip-btn');
  buttons.forEach((btn) => {
    const v = btn.dataset.value || '';
    const isActive = v === activeSubgroup;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function refreshControls() {
  const lessons = currentLessons();
  if (!Object.keys(state.sheets).length) {
    els.quickPick.classList.add('hidden');
    els.reloadBtn.classList.add('hidden');
    return;
  }
  els.quickPick.classList.remove('hidden');
  els.reloadBtn.classList.remove('hidden');

  // Сохраняем выбранную группу, чтобы не сбрасывать при hot-reload
  const prevGroup = state.group;

  // Auto-pick first sheet if none
  if (!state.sheets[state.current]) state.current = Object.keys(state.sheets)[0];

  // Auto-pick first group if none
  const groups = uniqueSorted(lessons.map((l) => l.group));
  if (!state.group || !groups.includes(state.group)) {
    // Пытаемся сохранить предыдущую группу
    if (prevGroup && groups.includes(prevGroup)) {
      state.group = prevGroup;
    } else {
      state.group = groups[0] || '';
    }
  }

  // Auto-detect subgroup if only 1 exists
  refreshSubgroupChips(lessons);

  // Update advanced filters
  const days = uniqueSorted(lessons.map((x) => x.day))
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  els.dayFilter.innerHTML = '<option value="">Все</option>' +
    days.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');

  updateQuickPick();
  render();
}

// --- Modal helpers ---
function openModal(modal) {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal(modal) {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function showSheetPicker() {
  const names = Object.keys(state.sheets);
  els.sheetList.innerHTML = names.map((n) => {
    const count = state.sheets[n].length;
    const active = n === state.current;
    return `<button class="picker-item ${active ? 'active' : ''}" data-sheet="${escapeHtml(n)}">
      <span>${escapeHtml(n)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? 'запись' : 'записей'}</span>
    </button>`;
  }).join('');
  els.sheetList.querySelectorAll('.picker-item').forEach((b) => {
    b.addEventListener('click', async () => {
      state.current = b.dataset.sheet;
      state.group = '';
      await persist();
      closeModal(els.sheetModal);
      refreshControls();
    });
  });
  openModal(els.sheetModal);
}

function showGroupPicker() {
  const groups = uniqueSorted(currentLessons().map((l) => l.group));
  els.groupList.innerHTML = groups.map((g) => {
    const count = currentLessons().filter((l) => l.group === g).length;
    const active = g === state.group;
    return `<button class="picker-item ${active ? 'active' : ''}" data-group="${escapeHtml(g)}">
      <span>${escapeHtml(g)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? 'пара' : 'пар'}</span>
    </button>`;
  }).join('');
  els.groupList.querySelectorAll('.picker-item').forEach((b) => {
    b.addEventListener('click', async () => {
      state.group = b.dataset.group;
      await persist();
      closeModal(els.groupModal);
      refreshControls();
    });
  });
  openModal(els.groupModal);
}

/**
 * Загружает xlsx на лету (881 КБ), только когда реально понадобился.
 * Кешируем модуль в module-level promise — повторный drop не скачивает заново.
 * @returns {Promise<any>}
 */
let xlsxPromise = null;
function loadXLSX() {
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = 'xlsx.full.min.js';
    s.async = true;
    s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX not loaded'));
    s.onerror = () => reject(new Error('Failed to load xlsx.full.min.js'));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// --- File handling ---
async function handleFile(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const XLSX = await loadXLSX();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheets = parseWorkbook(wb, XLSX);
    const total = Object.values(sheets).reduce((s, a) => s + a.length, 0);
    if (!total) { toast.show('Не удалось распознать строки. Проверьте файл.', 'bad'); return; }
    // Запоминаем текущий выбор, чтобы попытаться восстановить после загрузки
    const prevSheet = state.current;
    const prevGroup = state.group;
    state.sheets = sheets;
    state.current = wb.SheetNames[0];
    state.group = '';
    state.loadedAt = Date.now();
    state.fileName = file.name;
    // Восстанавливаем отделение и группу, если они есть в новом файле
    if (prevSheet && state.sheets[prevSheet]) state.current = prevSheet;
    if (prevGroup) {
      const newGroups = new Set((state.sheets[state.current] || []).map((l) => l.group));
      if (newGroups.has(prevGroup)) state.group = prevGroup;
    }
    await persist();
    refreshControls();
    toast.show(`Загружено: ${total} пар`, 'ok', { label: 'Обновить', onClick: () => els.fileInput.click() });
    closeModal(els.settingsModal);
    if (els.fileHint) els.fileHint.textContent = `Загружено: ${file.name} · ${formatTime(state.loadedAt)}`;
  } catch (err) {
    console.error(err);
    toast.show('Ошибка чтения: ' + (err instanceof Error ? err.message : String(err)), 'bad');
  }
}

function bindEvents() {
  els.fileInput.addEventListener('change', (e) => {
    const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    handleFile(f);
  });

  // Drag & drop в любом месте страницы.
  // dragenter/dragleave считают counter, dragend и drop сбрасывают счётчик —
  // иначе при быстром перетаскивании через дочерние элементы счётчик залипает
  // и overlay остаётся на экране.
  let dragCounter = 0;
  const resetDrag = () => {
    dragCounter = 0;
    document.body.classList.remove('is-dragging');
  };
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) resetDrag();
  });
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    resetDrag();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
  // dragend срабатывает, если пользователь отменил drop (отпустил вне окна)
  document.addEventListener('dragend', resetDrag);

  els.demoBtn.addEventListener('click', async () => {
    state.sheets = demoData();
    state.current = 'Демо';
    state.group = 'СЖ-1-25';
    await persist();
    refreshControls();
    toast.show('Демо-данные загружены', 'ok');
    closeModal(els.settingsModal);
  });

  // Settings modal
  els.settingsBtn.addEventListener('click', () => {
    if (els.fileHint && Object.keys(state.sheets).length) {
      const stamp = state.loadedAt ? ` · обновлено ${formatTime(state.loadedAt)}` : '';
      els.fileHint.textContent = `Загружено: ${state.fileName || 'файл'}${stamp}`;
    } else if (els.fileHint) {
      els.fileHint.textContent = 'Файл не загружен';
    }
    openModal(els.settingsModal);
  });
  els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.settingsModal));
  document.getElementById('closeModal').addEventListener('click', () => closeModal(els.settingsModal));

  // Quick reload (открывает диалог выбора файла)
  els.reloadBtn.addEventListener('click', () => els.fileInput.click());

  // Sheet / Group pickers
  els.sheetBtn.addEventListener('click', showSheetPicker);
  els.groupBtn.addEventListener('click', showGroupPicker);
  els.sheetModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.sheetModal));
  els.groupModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.groupModal));
  els.sheetModal.querySelector('[data-close="sheet"]').addEventListener('click', () => closeModal(els.sheetModal));
  els.groupModal.querySelector('[data-close="group"]').addEventListener('click', () => closeModal(els.groupModal));

  // Subgroup chips
  els.subgroupChips.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.chip-btn');
    if (!btn || btn.hidden) return;
    activeSubgroup = btn.dataset.value || '';
    updateChipsActive();
    render();
  });

  // Advanced filters
  [els.searchInput, els.dayFilter].forEach((el) => el.addEventListener('input', render));
  els.resetBtn.addEventListener('click', () => {
    els.searchInput.value = '';
    els.dayFilter.value = '';
    render();
  });
}

function init() {
  if (Object.keys(state.sheets).length) {
    refreshControls();
  }
  bindEvents();
  initBrandConfetti();
  initServiceWorker();
}

function initBrandConfetti() {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  let clickCount = 0;
  let resetTimer = null;
  brand.addEventListener('click', () => {
    clickCount++;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { clickCount = 0; }, 1200);
    if (clickCount >= 3) {
      clickCount = 0;
      brand.classList.add('celebrate');
      setTimeout(() => brand.classList.remove('celebrate'), 1000);
      fireConfetti(40);
    }
  });
}

function fireConfetti(count = 50) {
  const colors = ['#a78bfa', '#f0abfc', '#fda4af', '#fcd34d', '#6ee7b7', '#67e8f9', '#7dd3fc'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = (Math.random() * 100) + 'vw';
    el.style.top = '-20px';
    el.style.background = colors[i % colors.length];
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 200) + 'px');
    el.style.animationDelay = (Math.random() * 0.4) + 's';
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    const size = 6 + Math.random() * 8;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    // Чистим узел по окончании анимации — нет утечки setTimeout при множественных кликах.
    el.addEventListener('animationend', () => el.remove(), { once: true });
    document.body.appendChild(el);
  }
}

/**
 * Service Worker registration с уведомлением о новой версии.
 * При activate новой SW мы получаем controllerchange — перезагружаем страницу
 * один раз, чтобы пользователь увидел свежую версию.
 */
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Регистрируем ПОСЛЕ load, чтобы не блокировать первый рендер.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Раз в час проверяем обновления.
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(console.error);
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

init();
