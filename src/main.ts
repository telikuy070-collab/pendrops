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
import {
  actions,
  filteredLessons,
  schedule,
  preferences,
  ui,
  todayName,
} from '@presentation/stores/appStore';
import { createToast } from './view/toast.js';
import { createScheduleView } from './view/scheduleView.js';
import { createScheduleStatusBanner } from './view/scheduleStatus.js';
import { createAdminView } from './view/adminView.js';
import { initBrandGesture } from '@presentation/gestures/brandGesture';
import { escapeHtml } from './text.js';
import { effect } from '@presentation/stores/signals';
import type { PreferencesService as PrefsServiceType } from '@core/application/services';
import { reportError } from './view/errorBoundary.js';
import { toAppError } from '@core/domain/errors';
import { logger } from '@shared/logger';
import { getBuildDiagnostics, formatBuildDiagnostics } from '@shared/diagnostics';
import { getSupabaseClient } from '@infrastructure/supabase/client.js';
import type { ScheduleData } from '@core/domain/entities/types';
// Force Supabase bundle inclusion
import '@supabase/supabase-js';

// Toast instance - declared at module level so it's accessible before bootstrap completes
let toast: ReturnType<typeof createToast>;

/** Where the currently rendered schedule came from. */
type ScheduleSource = 'cache' | 'fresh' | 'realtime';

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
  const banner = initializeUI(scheduleService, prefsService, authService, adminService);

  // Load initial data
  actions.setLoading(true);

  // Version bookkeeping: exactly one "Расписание обновлено" toast per applied
  // version, no matter whether the version arrived through realtime, a manual
  // refresh or a Service Worker message.
  let lastAnnouncedVersion = '';
  let cacheWarningShown = false;

  /** Applies a schedule and announces a new version at most once. */
  const applySchedule = (data: ScheduleData, source: ScheduleSource): void => {
    actions.setSchedule(data);
    renderBuildInfo(data);

    const version = data.version || '';
    if (source !== 'cache' && version && version !== lastAnnouncedVersion) {
      lastAnnouncedVersion = version;
      toast?.show('Расписание обновлено', 'ok');
    }
  };

  /** Retryable warning: the offline copy is stale, the applied data is fine. */
  const warnCacheWrite = (): void => {
    if (cacheWarningShown) return;
    cacheWarningShown = true;
    banner.show('warn', 'Не удалось обновить офлайн-копию расписания.', {
      onRetry: () => {
        cacheWarningShown = false;
        void reloadAuthoritative('cache-retry');
      },
      retryLabel: 'Повторить',
    });
  };

  /**
   * Authoritative load: apply immediately, then refresh the offline cache.
   * A failed load keeps whatever is already on screen and shows a retry.
   */
  async function reloadAuthoritative(reason: string): Promise<void> {
    actions.setLoading(true);
    try {
      const { data, cacheUpdated } = await scheduleService.refresh(reason);
      applySchedule(data, reason === 'realtime' ? 'realtime' : 'fresh');
      if (cacheUpdated) {
        cacheWarningShown = false;
        banner.hide();
      } else {
        warnCacheWrite();
      }
    } catch (err) {
      const appError = toAppError(err);
      logger.error('[App] Schedule load failed', { reason }, appError);
      if (schedule.value) {
        // Cached data stays on screen; the user can retry.
        banner.show('error', appError.userMessage, {
          onRetry: () => void reloadAuthoritative(reason),
          retryLabel: 'Повторить',
        });
      } else {
        actions.setError('Не удалось загрузить расписание');
        reportError(appError, 'Не удалось загрузить расписание');
      }
    } finally {
      actions.setLoading(false);
    }
  }

  try {
    // Load preferences first
    const prefs = await prefsService.load();
    actions.setPreference('currentSheetId', prefs.currentSheetId);
    actions.setPreference('currentGroup', prefs.currentGroup);
    actions.setPreference('activeSubgroup', prefs.activeSubgroup);

    // Non-blocking first render: the cached snapshot paints immediately while
    // the authoritative load runs. The heavy XLS parser is not part of this path.
    const cached = await scheduleService.loadCached();
    if (cached) {
      applySchedule(cached, 'cache');
      lastAnnouncedVersion = cached.version || '';
    }

    await reloadAuthoritative('bootstrap');

    // Subscribe to realtime updates
    const unsubscribe = scheduleService.subscribe((data) => {
      // Authoritative-first: apply, then refresh the offline cache.
      applySchedule(data, 'realtime');
      void storage.set('schedule_cache', data).then((cacheUpdated) => {
        if (cacheUpdated) {
          cacheWarningShown = false;
          banner.hide();
        } else {
          warnCacheWrite();
        }
      });
    });

    // Store unsubscribe for cleanup
    (window as any).__unsubscribeSchedule = unsubscribe;

    // Check for updates periodically
    startUpdateChecker(scheduleService);
    listenForServiceWorkerUpdates(() => reloadAuthoritative('service-worker'));
    logger.debug('[App] Build', { ...getBuildDiagnostics() });
  } catch (err) {
    logger.error('[App] Bootstrap failed', { context: 'bootstrap' }, err as Error);
    actions.setError('Не удалось загрузить расписание');
    reportError(err, 'Не удалось загрузить расписание');
  } finally {
    actions.setLoading(false);
  }

  /** Build identity in the settings modal, so bug reports name a real build. */
  function renderBuildInfo(data: ScheduleData): void {
    const info = document.getElementById('scheduleInfo');
    const text = document.getElementById('scheduleInfoText');
    if (!info || !text) return;
    const version = data.version ? ` · расписание ${data.version}` : '';
    text.textContent = `${formatBuildDiagnostics()}${version}`;
    info.hidden = false;
  }

  function initializeUI(
    scheduleService: ScheduleService,
    prefsService: PrefsServiceType,
    authService: AuthService,
    adminService: AdminService
  ): ReturnType<typeof createScheduleStatusBanner> {
    // Get DOM elements
    const container = document.getElementById('scheduleContainer');
    const toastEl = document.getElementById('toast');

    toast = createToast(toastEl);
    (window as any).toast = toast;

    // Initialize schedule view and start its live timer
    const scheduleView = createScheduleView(container);
    scheduleView.start();

    // Create admin view for brand gesture. After a successful publish the
    // admin's own screen is stale, so it reloads from the same authoritative
    // path the students use.
    const adminView = createAdminView(authService, adminService, toast, () =>
      reloadAuthoritative('publish')
    );

    // Cache pill value elements
    const sheetValue = document.getElementById('sheetValue');
    const groupValue = document.getElementById('groupValue');
    const subgroupValue = document.getElementById('subgroupValue');
    const quickPick = document.getElementById('quickPick');

    // The schedule view owns pull-to-refresh; main.ts must not attach a second
    // handler, otherwise one gesture triggers two refreshes.
    scheduleView.setOnRefresh(() => handlePullRefresh(scheduleService));
    scheduleView.setOnDayChange((day: string) => syncDayFilter(day));

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
        // Show quickPick selectors when schedule is loaded. The compact pill
        // stays visible for the rest of the session.
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

    return createScheduleStatusBanner();
  }

  function syncDayFilter(day: string): void {
    const dayFilter = document.getElementById('dayFilter') as HTMLSelectElement | null;
    if (dayFilter) dayFilter.value = day;
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

    // Pull-to-refresh is implemented once, inside scheduleView (setOnRefresh
    // above). No second touch handler is attached here.
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
      // Same authoritative path as bootstrap/realtime: one apply, one toast,
      // one offline-cache refresh.
      await reloadAuthoritative('pull-refresh');
    } else {
      toast?.show('Обновлений нет', 'ok');
    }
  }

  function startUpdateChecker(scheduleService: ScheduleService): void {
    const check = async (reason: string): Promise<void> => {
      try {
        const currentVersion = schedule.value?.version || '';
        const { hasUpdate, version, updatedAt } =
          await scheduleService.checkUpdates(currentVersion);
        if (hasUpdate) {
          actions.setUpdateAvailable({ version, updatedAt });
          await reloadAuthoritative(reason);
        }
      } catch (err) {
        logger.warn('[App] Update check failed', { reason, error: toAppError(err).code });
      }
    };

    // Check on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void check('visibility');
        requestServiceWorkerCheck();
      }
    });

    // Periodic check every 20 seconds. Each tick is a single-row SELECT on
    // schedule_version, so a new publish is picked up within seconds — the
    // realtime channel is only a bonus, not the delivery guarantee.
    setInterval(() => void check('interval'), 20 * 1000);
  }
}

/**
 * Asks the Service Worker to refresh its cached schedule snapshot.
 * The worker answers with the same version semantics; the applied data still
 * comes from the authoritative repository, so no stale cache is ever rendered.
 */
function requestServiceWorkerCheck(): void {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: 'check-schedule' });
}

/**
 * Service Worker → client update notifications.
 * A single handler serves every origin of an update (worker cache refresh,
 * manual check), so exactly one toast is shown per applied version.
 */
function listenForServiceWorkerUpdates(onUpdate: (version: string) => void): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; version?: string } | null;
    if (!data || data.type !== 'schedule-updated') return;
    logger.debug('[SW] schedule-updated received', { version: data.version ?? '' });
    onUpdate(data.version ?? '');
  });
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
