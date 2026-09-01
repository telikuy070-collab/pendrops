import { parseWorkbook } from './sheet.js';
import { loadState, saveState, saveHandle, loadHandle } from './store.js';
import { createScheduleView } from './view/scheduleView.js';
import { createToast } from './view/toast.js';
import { escapeHtml, debounce } from './text.js';
import { DAY_ORDER } from './constants.js';
import { getTodayName } from './timing.js';
import { pickExcelFile, hasNativeFilePicker } from './picker.js';

const LAST_HANDLE = 'lastFile';

const els = {
  fileInput: /** @type {HTMLInputElement} */ (document.getElementById('fileInput')),
  findFileBtn: document.getElementById('findFileBtn'),
  findFileBtnModal: document.getElementById('findFileBtnModal'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  installBtn: document.getElementById('installBtn'),
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

/**
 * Открывает нативный диалог выбора Excel-файла на устройстве
 * (File System Access API) или fallback на <input type=file>.
 * Запоминает handle в IDB, чтобы в следующий раз открыть одной кнопкой.
 */
async function openFinder() {
  try {
    const picked = await pickExcelFile();
    if (!picked || !picked.length) return; // cancelled
    const f = picked[0];
    if (f.handle) {
      await saveHandle(LAST_HANDLE, f.handle);
    }
    await handleFile(f.file, f.name);
  } catch (err) {
    console.error(err);
    toast.show('Не удалось открыть файл: ' + (err instanceof Error ? err.message : String(err)), 'bad');
  }
}

/**
 * Пытается открыть последний использованный файл через сохранённый handle
 * (без диалога выбора). Если handle нет / битый / файл перемещён — возвращает false.
 * @returns {Promise<boolean>}
 */
async function tryOpenLastHandle() {
  const handle = await loadHandle(LAST_HANDLE);
  if (!handle || typeof handle.getFile !== 'function') return false;
  try {
    // Проверяем разрешение перед чтением (могло истечь после закрытия PWA)
    if (handle.queryPermission) {
      const q = await handle.queryPermission({ mode: 'read' });
      if (q !== 'granted') {
        const r = await handle.requestPermission({ mode: 'read' });
        if (r !== 'granted') return false;
      }
    }
    const file = await handle.getFile();
    await handleFile(file, file.name);
    return true;
  } catch (err) {
    console.warn('Last handle invalid:', err);
    return false;
  }
}

// --- File handling ---
/**
 * @param {File} file
 * @param {string} [nameOverride] — если уже получили имя из handle
 */
async function handleFile(file, nameOverride) {
  if (!file) return;
  const name = nameOverride || file.name;
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
    state.fileName = name;
    // Восстанавливаем отделение и группу, если они есть в новом файле
    if (prevSheet && state.sheets[prevSheet]) state.current = prevSheet;
    if (prevGroup) {
      const newGroups = new Set((state.sheets[state.current] || []).map((l) => l.group));
      if (newGroups.has(prevGroup)) state.group = prevGroup;
    }
    await persist();
    refreshControls();
    toast.show(`Загружено: ${total} пар`, 'ok', {
      label: 'Найти другой',
      onClick: () => openFinder()
    });
    closeModal(els.settingsModal);
    if (els.fileHint) els.fileHint.textContent = `Загружено: ${name} · ${formatTime(state.loadedAt)}`;
  } catch (err) {
    console.error(err);
    toast.show('Ошибка чтения: ' + (err instanceof Error ? err.message : String(err)), 'bad');
  }
}

function bindEvents() {
  els.fileInput.addEventListener('change', (e) => {
    const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (f) handleFile(f);
  });

  // Кнопки «Найти на устройстве» (на пустом экране + в настройках)
  if (els.findFileBtn) els.findFileBtn.addEventListener('click', openFinder);
  if (els.findFileBtnModal) els.findFileBtnModal.addEventListener('click', () => {
    closeModal(els.settingsModal);
    openFinder();
  });
  if (els.openSettingsBtn) els.openSettingsBtn.addEventListener('click', () => {
    if (els.settingsModal) openModal(els.settingsModal);
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

  // Quick reload: нативный диалог выбора файла (с фильтром по .xls/.xlsx)
  els.reloadBtn.addEventListener('click', openFinder);
  // Если handle сохранён и permission granted — Reload откроет его без диалога.
  els.reloadBtn.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const ok = await tryOpenLastHandle();
    if (!ok) openFinder();
  });

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
  initInstallPrompt();
  // Если файл уже загружен, но handle сохранён — кнопка 🔄 покажет «Открыть заново».
  // На пустом экране ничего не делаем.
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

/**
 * PWA install prompt.
 * Браузер (Chrome/Edge/Samsung) генерирует событие `beforeinstallprompt` когда
 * приложение соответствует критериям. Сохраняем его и предлагаем пользователю
 * установить через кнопку 📲 и/или автоматически через 30 секунд.
 */
function initInstallPrompt() {
  const DISMISS_KEY = 'pendrops-install-dismissed';
  const DISMISS_DAYS = 7;
  // Если пользователь уже отклонил — не показываем неделю.
  const dismissed = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null');
      if (!v) return false;
      return Date.now() - v < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch { return false; }
  })();
  if (dismissed) return;

  // Уже установлено — не показываем.
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (/** @type {any} */ (navigator).standalone === true) return;

  let deferredPrompt = null;
  let promptShown = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (els.installBtn) els.installBtn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    if (els.installBtn) els.installBtn.classList.add('hidden');
    toast.show('PenDrops установлено!', 'ok');
  });

  // Кнопка в topbar
  if (els.installBtn) {
    els.installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        // Браузер не дал prompt — направляем в меню «Добавить на главный экран».
        toast.show('Откройте меню браузера → «Добавить на главный экран»', 'ok');
        return;
      }
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          els.installBtn.classList.add('hidden');
        } else {
          localStorage.setItem(DISMISS_KEY, JSON.stringify(Date.now()));
        }
      } catch {}
      deferredPrompt = null;
    });
  }

  // Автоматический toast-подсказка через 30 сек, если пользователь ещё не отреагировал.
  setTimeout(() => {
    if (!deferredPrompt || promptShown) return;
    if (els.installBtn && !els.installBtn.classList.contains('hidden')) {
      promptShown = true;
      toast.show('Установите PenDrops как приложение', 'ok', {
        label: 'Установить',
        onClick: () => els.installBtn.click()
      });
    }
  }, 30000);
}

init();
