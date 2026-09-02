import { parseWorkbook } from './sheet.js';
import { loadState, saveState } from './store.js';
import { createScheduleView } from './view/scheduleView.js';
import { createToast } from './view/toast.js';
import { escapeHtml, debounce } from './text.js';
import { DAY_ORDER } from './constants.js';
import { getTodayName } from './timing.js';
import { createAdminView } from './view/adminView.js';

const REMOTE_SCHEDULE_URL = './data/schedule.xls';
const REMOTE_VERSION_URL = './data/version.json';

const els = {
  settingsBtn: document.getElementById('settingsBtn'),
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
  loadingState: document.getElementById('loadingState'),
  scheduleInfo: document.getElementById('scheduleInfo'),
  scheduleInfoText: document.getElementById('scheduleInfoText')
};

const state = await loadState();
const view = createScheduleView(document.getElementById('scheduleContainer'));
const toast = createToast(document.getElementById('toast'));
const admin = createAdminView();

/** @type {string} */
let activeSubgroup = '';

async function persist() {
  const where = await saveState(state);
  if (where === 'none') toast.show('Не удалось сохранить — изменения только в памяти', 'bad');
  return where;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${hh}:${mm}`;
}

function formatDateLong(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
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

function updateQuickPick() {
  if (state.current && els.sheetValue) els.sheetValue.textContent = state.current;
  if (state.group && els.groupValue) els.groupValue.textContent = state.group;
}

function refreshSubgroupChips(lessons) {
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
    return;
  }
  els.quickPick.classList.remove('hidden');
  const prevGroup = state.group;
  if (!state.sheets[state.current]) state.current = Object.keys(state.sheets)[0];
  const groups = uniqueSorted(lessons.map((l) => l.group));
  if (!state.group || !groups.includes(state.group)) {
    if (prevGroup && groups.includes(prevGroup)) {
      state.group = prevGroup;
    } else {
      state.group = groups[0] || '';
    }
  }
  refreshSubgroupChips(lessons);
  const days = uniqueSorted(lessons.map((x) => x.day))
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  els.dayFilter.innerHTML = '<option value="">Все</option>' +
    days.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  updateQuickPick();
  updateScheduleInfo();
  render();
}

function updateScheduleInfo() {
  if (!state.remoteVersion && !state.remoteUpdated) {
    els.scheduleInfo.hidden = true;
    return;
  }
  els.scheduleInfo.hidden = false;
  const v = state.remoteVersion ? ` · ${state.remoteVersion}` : '';
  const d = state.remoteUpdated ? formatDateLong(state.remoteUpdated) : '';
  els.scheduleInfoText.textContent = `Версия ${v.replace(' · ', '')} · обновлено ${d}`.trim();
}

function openModal(modal) { modal.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(modal) { modal.classList.add('hidden'); document.body.style.overflow = ''; }

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

async function loadRemoteSchedule() {
  try {
    const res = await fetch(REMOTE_SCHEDULE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    const XLSX = await loadXLSX();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheets = parseWorkbook(wb, XLSX);
    const total = Object.values(sheets).reduce((s, a) => s + a.length, 0);
    if (!total) return false;
    const prevSheet = state.current;
    const prevGroup = state.group;
    state.sheets = sheets;
    state.current = wb.SheetNames[0];
    state.group = '';
    state.fileName = 'schedule.xls';
    state.source = 'remote';
    if (prevSheet && state.sheets[prevSheet]) state.current = prevSheet;
    if (prevGroup) {
      const newGroups = new Set((state.sheets[state.current] || []).map((l) => l.group));
      if (newGroups.has(prevGroup)) state.group = prevGroup;
    }
    await persist();
    return true;
  } catch (err) {
    console.warn('loadRemoteSchedule error:', err);
    return false;
  }
}

async function fetchRemoteVersion() {
  try {
    const r = await fetch(REMOTE_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function showUpdateBanner(version) {
  if (document.getElementById('updateBanner')) return;
  const b = document.createElement('div');
  b.id = 'updateBanner';
  b.className = 'update-banner';
  b.innerHTML = `
    <span>📅 Доступно расписание <b>${escapeHtml(version || 'новое')}</b></span>
    <button id="updateBannerClose">✕</button>
  `;
  const topbar = document.querySelector('.topbar');
  if (topbar && topbar.parentNode) topbar.parentNode.insertBefore(b, topbar.nextSibling);
  else document.body.prepend(b);
  b.querySelector('#updateBannerClose').addEventListener('click', () => b.remove());
  setTimeout(() => b.remove(), 8000);
}

async function checkForUpdates() {
  const v = await fetchRemoteVersion();
  if (!v || !v.updated) return;
  const localStamp = state.remoteUpdated || '';
  if (v.updated === localStamp) return;
  const ok = await loadRemoteSchedule();
  if (ok) {
    state.remoteUpdated = v.updated;
    state.remoteVersion = v.version;
    await persist();
    refreshControls();
    showUpdateBanner(v.version);
  }
}

function bindEvents() {
  els.settingsBtn.addEventListener('click', () => openModal(els.settingsModal));
  els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.settingsModal));
  document.getElementById('closeModal').addEventListener('click', () => closeModal(els.settingsModal));

  els.sheetBtn.addEventListener('click', showSheetPicker);
  els.groupBtn.addEventListener('click', showGroupPicker);
  els.sheetModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.sheetModal));
  els.groupModal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(els.groupModal));
  els.sheetModal.querySelector('[data-close="sheet"]').addEventListener('click', () => closeModal(els.sheetModal));
  els.groupModal.querySelector('[data-close="group"]').addEventListener('click', () => closeModal(els.groupModal));

  els.subgroupChips.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('.chip-btn');
    if (!btn || btn.hidden) return;
    activeSubgroup = btn.dataset.value || '';
    updateChipsActive();
    render();
  });

  [els.searchInput, els.dayFilter].forEach((el) => el.addEventListener('input', render));
  els.resetBtn.addEventListener('click', () => {
    els.searchInput.value = '';
    els.dayFilter.value = '';
    render();
  });
}

function init() {
  bindEvents();
  initBrandGesture();
  initServiceWorker();
  initInstallPrompt();
  initRemoteSync();
}

function initRemoteSync() {
  (async () => {
    const ok = await loadRemoteSchedule();
    if (ok) {
      const v = await fetchRemoteVersion();
      if (v) {
        state.remoteUpdated = v.updated;
        state.remoteVersion = v.version;
        await persist();
      }
      els.loadingState.classList.add('hidden');
      refreshControls();
    } else {
      // Remote недоступен — показываем "расписание недоступно"
      els.loadingState.innerHTML = `
        <div class="empty-illu">📡</div>
        <h2>Расписание недоступно</h2>
        <p>Проверьте подключение к интернету и откройте приложение снова.</p>
      `;
    }
  })();
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

function initBrandGesture() {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  let pressTimer = null;
  let pressing = false;
  let hint = null;
  const LONG_PRESS_MS = 1500;

  const showHint = () => {
    if (hint) return;
    hint = document.createElement('div');
    hint.className = 'longpress-hint';
    hint.textContent = 'Админка';
    brand.appendChild(hint);
  };
  const hideHint = () => { if (hint) { hint.remove(); hint = null; } };

  brand.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressing = true;
    showHint();
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (pressing) {
        pressing = false;
        hideHint();
        admin.show();
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, LONG_PRESS_MS);
  });
  const cancel = () => { pressing = false; clearTimeout(pressTimer); hideHint(); };
  brand.addEventListener('pointerup', cancel);
  brand.addEventListener('pointerleave', cancel);
  brand.addEventListener('pointercancel', cancel);

  // Конфетти на 3 быстрых тапа
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
    el.addEventListener('animationend', () => el.remove(), { once: true });
    document.body.appendChild(el);
  }
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
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

function initInstallPrompt() {
  const DISMISS_KEY = 'pendrops-install-dismissed';
  const DISMISS_DAYS = 7;
  const dismissed = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null');
      if (!v) return false;
      return Date.now() - v < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch { return false; }
  })();
  if (dismissed) return;
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

  if (els.installBtn) {
    els.installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) {
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
