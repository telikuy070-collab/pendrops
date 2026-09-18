/**
 * Application Composition Root - Wires all layers together
 * Single entry point, sets up DI, starts the app
 */
import { ScheduleService } from '@core/application/services';
import { PreferencesService } from '@core/application/services';
import { AuthService } from '@core/application/services';
import { AdminService } from '@core/application/services';
import { SupabaseScheduleRepository } from '@infrastructure/supabase/repository';
import { SupabaseAuthProvider } from '@infrastructure/supabase/auth';
import { HybridStorage } from '@infrastructure/storage/hybrid';
import { ExcelFileParser } from '@infrastructure/github/parser';
import { actions, filteredLessons, schedule, preferences, ui, todayName } from '@presentation/stores/appStore';
import { createToast } from './view/toast.js';
import { createScheduleView } from './view/scheduleView.js';
import { createAdminView } from './view/adminView.js';
import { initBrandGesture } from '@presentation/gestures/brandGesture';
import { escapeHtml } from './text.js';
import { effect } from '@presentation/stores/signals';
import type { PreferencesService as PrefsServiceType } from '@core/application/services';
import { reportError } from './view/errorBoundary.js';
import { toAppError } from '@core/domain/errors';
import { logger } from '@shared/logger';
import { getSupabaseClient } from '@infrastructure/supabase/client.js';
import type { ScheduleData } from '@core/domain/entities/types';
// Force Supabase bundle inclusion
import '@supabase/supabase-js';

// Toast instance - declared at module level so it's accessible before bootstrap completes
let toast: ReturnType<typeof createToast>;

/** Initialize all services and start the app */
export async function bootstrap(): Promise<void> {
  // Force Supabase client initialization for bundle inclusion
  getSupabaseClient();

  // Infrastructure
  const repository = new SupabaseScheduleRepository();
  const auth = new SupabaseAuthProvider();
  const storage = new HybridStorage();
  const parser = new ExcelFileParser();

  // Application Services
  const scheduleService = new ScheduleService(repository, storage);
  const prefsService = new PreferencesService(storage);
  const authService = new AuthService(auth);
  const adminService = new AdminService(repository, parser);

  // Initialize UI FIRST (so toast exists before any async callbacks)
  initializeUI(scheduleService, prefsService, authService, adminService);

  // Load initial data
  actions.setLoading(true);

  try {
    // Load preferences first
    const prefs = await prefsService.load();
    actions.setPreference('currentSheetId', prefs.currentSheetId);
    actions.setPreference('currentGroup', prefs.currentGroup);
    actions.setPreference('activeSubgroup', prefs.activeSubgroup);

    // Load schedule (instant from cache, then fresh from DB)
    const scheduleData = await scheduleService.load();
    actions.setSchedule(scheduleData);

    // Subscribe to realtime updates
    let initialLoad = true;
    const unsubscribe = scheduleService.subscribe((data) => {
      actions.setSchedule(data);
      // Show toast for updates (but not initial load)
      if (!initialLoad) {
        toast?.show('Расписание обновлено', 'ok');
      }
      initialLoad = false;
    });

    // Store unsubscribe for cleanup
    (window as any).__unsubscribeSchedule = unsubscribe;

    // Check for updates periodically
    startUpdateChecker(scheduleService);
  } catch (err) {
    logger.error('[App] Bootstrap failed', { context: 'bootstrap' }, err as Error);
    actions.setError('Не удалось загрузить расписание');
    reportError(err, 'Не удалось загрузить расписание');
  } finally {
    actions.setLoading(false);
  }

  function initializeUI(
    scheduleService: ScheduleService,
    prefsService: PrefsServiceType,
    authService: AuthService,
    adminService: AdminService
  ): void {
    // Get DOM elements
    const container = document.getElementById('scheduleContainer');
    const toastEl = document.getElementById('toast');

    toast = createToast(toastEl);
    (window as any).toast = toast;

    // Initialize schedule view
    const scheduleView = createScheduleView(container);

    // Create admin view for brand gesture
    const adminView = createAdminView(authService, adminService, toast);

    // Cache pill value elements
    const sheetValue = document.getElementById('sheetValue');
    const groupValue = document.getElementById('groupValue');
    const subgroupValue = document.getElementById('subgroupValue');
    const quickPick = document.getElementById('quickPick');

    // Bind store to view
    effect(() => {
      const state = {
        schedule: schedule.value,
        preferences: preferences.value,
        ui: ui.value,
      };
      logger.debug('[ui] subscribe triggered', { preferences: state.preferences });
      logger.debug('[ui] filtered lessons', { count: filteredLessons.value?.length });

      if (state.schedule) {
        scheduleView.render(filteredLessons.value, {
          today: state.ui.loading ? '' : todayName.value,
        });
        // Show quickPick selectors when schedule is loaded
        if (quickPick) quickPick.classList.remove('hidden');
      }
      // Update pill values
      if (sheetValue) sheetValue.textContent = state.preferences.currentSheetId || '—';
      if (groupValue) groupValue.textContent = state.preferences.currentGroup || '—';
      if (subgroupValue) subgroupValue.textContent = state.preferences.activeSubgroup || 'Все';

      // Show/hide modals based on activeModal state
      const modals = ['sheetModal', 'groupModal', 'subgroupModal', 'settingsModal'];
      modals.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          const shouldShow = state.ui.activeModal === id.replace('Modal', '');
          el.classList.toggle('hidden', !shouldShow);
        }
      });
    });

    // Initialize brand gesture (10-tap for admin)
    initBrandGesture({ authService, adminView, toast });

    // Bind UI events
    bindEvents(scheduleService, prefsService, authService, adminService);
  }

  function bindEvents(
    scheduleService: ScheduleService,
    prefsService: PrefsServiceType,
    authService: AuthService,
    adminService: AdminService
  ): void {
    // Settings modal
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeModal = document.getElementById('closeModal');

    settingsBtn?.addEventListener('click', () => actions.openModal('settings'));
    closeModal?.addEventListener('click', () => actions.closeModal());
    settingsModal
      ?.querySelector('.modal-backdrop')
      ?.addEventListener('click', () => actions.closeModal());

    // Sheet picker
    const sheetBtn = document.getElementById('sheetBtn');
    const sheetModal = document.getElementById('sheetModal');
    const sheetList = document.getElementById('sheetList');

    sheetBtn?.addEventListener('click', () => {
      renderSheetPicker(schedule.value!);
      actions.openModal('sheet');
    });
    sheetModal
      ?.querySelector('.modal-backdrop')
      ?.addEventListener('click', () => actions.closeModal());
    sheetModal
      ?.querySelector('[data-close="sheet"]')
      ?.addEventListener('click', () => actions.closeModal());

    // Group picker
    const groupBtn = document.getElementById('groupBtn');
    const groupModal = document.getElementById('groupModal');
    const groupList = document.getElementById('groupList');

    groupBtn?.addEventListener('click', () => {
      renderGroupPicker(schedule.value!);
      actions.openModal('group');
    });
    groupModal
      ?.querySelector('.modal-backdrop')
      ?.addEventListener('click', () => actions.closeModal());
    groupModal
      ?.querySelector('[data-close="group"]')
      ?.addEventListener('click', () => actions.closeModal());

    // Subgroup picker
    const subgroupBtn = document.getElementById('subgroupBtn');
    const subgroupModal = document.getElementById('subgroupModal');
    const subgroupList = document.getElementById('subgroupList');

    subgroupBtn?.addEventListener('click', () => {
      renderSubgroupPicker(schedule.value!);
      actions.openModal('subgroup');
    });
    subgroupModal
      ?.querySelector('.modal-backdrop')
      ?.addEventListener('click', () => actions.closeModal());
    subgroupModal
      ?.querySelector('[data-close="subgroup"]')
      ?.addEventListener('click', () => actions.closeModal());

    // Search and day filter
    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    const dayFilter = document.getElementById('dayFilter') as HTMLSelectElement | null;
    const resetBtn = document.getElementById('resetBtn');

    searchInput?.addEventListener('input', (e) =>
      actions.setFilter('search', (e.target as HTMLInputElement).value)
    );
    dayFilter?.addEventListener('change', (e) =>
      actions.setFilter('day', (e.target as HTMLSelectElement).value)
    );
    resetBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      if (dayFilter) dayFilter.value = '';
      actions.resetFilters();
    });

    // Pull to refresh
    const scheduleContainer = document.getElementById('scheduleContainer') as HTMLElement | null;
    let pullStart = 0;
    scheduleContainer?.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if ((e.target as HTMLElement).closest('.card')) return;
        const touch = e.touches[0];
        if (touch) pullStart = touch.clientY;
      },
      { passive: true }
    );

    scheduleContainer?.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (pullStart === 0 || !scheduleContainer) return;
        const touch = e.touches[0];
        if (!touch) return;
        const delta = touch.clientY - pullStart;
        if (delta > 100 && scheduleContainer.scrollTop === 0) {
          handlePullRefresh(scheduleService);
          pullStart = 0;
        }
      },
      { passive: true }
    );
  }

  function renderSheetPicker(scheduleData: ScheduleData): void {
    const sheetList = document.getElementById('sheetList');
    if (!scheduleData || !sheetList) return;

    sheetList.innerHTML = scheduleData.sheetsMeta
      .map((sheet) => {
        const count = scheduleData.sheets.get(sheet.id)?.length || 0;
        const active = sheet.id === preferences.value.currentSheetId;
        return `<button class="picker-item ${active ? 'active' : ''}" data-sheet="${escapeHtml(sheet.id)}">
      <span>${escapeHtml(sheet.name)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? 'запись' : 'записей'}</span>
    </button>`;
      })
      .join('');

    sheetList.querySelectorAll('.picker-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sheetId = (btn as HTMLElement).dataset.sheet!;
        logger.info('[picker] sheet selected', { sheetId });
        actions.setPreference('currentSheetId', sheetId);
        actions.setPreference('currentGroup', '');
        actions.setPreference('activeSubgroup', '');
        await prefsService.save({ currentSheetId: sheetId, currentGroup: '', activeSubgroup: '' });
        actions.closeModal();
      });
    });
  }

  function renderGroupPicker(scheduleData: ScheduleData): void {
    const groupList = document.getElementById('groupList');
    const prefs = preferences.value;
    if (!scheduleData || !groupList || !prefs.currentSheetId) return;

    const groups = Array.from(scheduleData.groups.values()).filter(
      (g) => g.sheetId === prefs.currentSheetId
    );

    groupList.innerHTML = groups
      .map((group) => {
        const active = group.code === prefs.currentGroup;
        return `<button class="picker-item ${active ? 'active' : ''}" data-group="${escapeHtml(group.code)}">
      <span>${escapeHtml(group.code)}</span>
      <span class="picker-item-meta">${group.lessonCount} ${group.lessonCount === 1 ? 'пара' : 'пар'}</span>
    </button>`;
      })
      .join('');

    groupList.querySelectorAll('.picker-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const groupCode = (btn as HTMLElement).dataset.group!;
        logger.info('[picker] group selected', { groupCode });
        actions.setPreference('currentGroup', groupCode);
        actions.setPreference('activeSubgroup', '');
        await prefsService.save({ currentGroup: groupCode, activeSubgroup: '' });
        actions.closeModal();
      });
    });
  }

  function renderSubgroupPicker(scheduleData: ScheduleData): void {
    const subgroupList = document.getElementById('subgroupList');
    const prefs = preferences.value;
    if (!scheduleData || !subgroupList || !prefs.currentGroup) return;

    const lessons = scheduleData.sheets.get(prefs.currentSheetId!) || [];
    const groupLessons = lessons.filter((l) => l.group === prefs.currentGroup);
    const subgroups = Array.from(new Set(groupLessons.map((l) => l.subgroup).filter(Boolean))).sort(
      (a, b) => {
        const na = Number(a),
          nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b), 'ru');
      }
    );

    if (subgroups.length === 0) {
      subgroupList.innerHTML = '<div class="picker-empty">Нет подгрупп для этой группы</div>';
      return;
    }

    subgroupList.innerHTML = subgroups
      .map((sg) => {
        const count = groupLessons.filter((l) => l.subgroup === sg).length;
        const active = sg === prefs.activeSubgroup;
        return `<button class="picker-item ${active ? 'active' : ''}" data-subgroup="${escapeHtml(sg)}">
      <span>${escapeHtml(sg)}</span>
      <span class="picker-item-meta">${count} ${count === 1 ? 'пара' : 'пар'}</span>
    </button>`;
      })
      .join('');

    subgroupList.querySelectorAll('.picker-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const subgroup = (btn as HTMLElement).dataset.subgroup!;
        logger.info('[picker] subgroup selected', { subgroup });
        actions.setPreference('activeSubgroup', subgroup);
        await prefsService.save({ activeSubgroup: subgroup });
        actions.closeModal();
      });
    });
  }

  async function handlePullRefresh(scheduleService: ScheduleService): Promise<void> {
    toast?.show('Проверяю обновления...', 'ok');
    const currentVersion = schedule.value?.version || '';
    const { hasUpdate } = await scheduleService.checkUpdates(currentVersion);

    if (hasUpdate) {
      const scheduleData = await scheduleService.load();
      actions.setSchedule(scheduleData);
      toast?.show('Расписание обновлено', 'ok');
    } else {
      toast?.show('Обновлений нет', 'ok');
    }
  }

  function startUpdateChecker(scheduleService: ScheduleService): void {
    // Check on visibility change
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        const currentVersion = schedule.value?.version || '';
        const { hasUpdate, version, updatedAt } =
          await scheduleService.checkUpdates(currentVersion);
        if (hasUpdate) {
          actions.setUpdateAvailable({ version, updatedAt });
        }
      }
    });

    // Periodic check every 5 minutes
    setInterval(
      async () => {
        const currentVersion = schedule.value?.version || '';
        const { hasUpdate, version, updatedAt } =
          await scheduleService.checkUpdates(currentVersion);
        if (hasUpdate) {
          actions.setUpdateAvailable({ version, updatedAt });
        }
      },
      5 * 60 * 1000
    );
  }
}

/**
 * Register Service Worker for PWA functionality.
 * Required for beforeinstallprompt to fire on Chrome Android.
 */
function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .then((reg) => {
        if (import.meta.env.DEV) {
          logger.debug('[SW] Registered', { scope: reg.scope });
        }
      })
      .catch((err) => {
        logger.error('[SW] Registration failed', { context: 'service_worker' }, err as Error);
      });
  }
}

// Start the app - register SW independently (runs even if bootstrap fails)
registerServiceWorker();
bootstrap().catch((err) => {
  logger.error('[App] Fatal error', { context: 'bootstrap' }, err as Error);
  document.body.innerHTML =
    '<div style="padding:2rem;text-align:center">Ошибка инициализации приложения</div>';
});

/**
 * Handle beforeinstallprompt for PWA install button.
 * Shows the install button when the event fires.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e: Event) => {
  const promptEvent = e as BeforeInstallPromptEvent;
  promptEvent.preventDefault();
  deferredPrompt = promptEvent;
  const btn = document.getElementById('installBtn');
  if (btn) btn.classList.remove('hidden');
});

const installBtn = document.getElementById('installBtn');
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      alert('Откройте меню браузера → Добавить на главный экран');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installBtn.classList.add('hidden');
    }
    deferredPrompt = null;
  });
}

// Type for beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}