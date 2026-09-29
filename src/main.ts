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
  groupLessons,
  searchResults,
  weekPlan,
  schedule,
  preferences,
  ui,
  currentFilters,
  viewMode,
  changes,
  netStatus,
  offlineNotice,
  startScreen,
  browsingOtherGroup,
  scopedChanges,
  emptyReason,
  todayName,
} from '@presentation/stores/appStore';
import type { ViewMode } from '@presentation/stores/appStore';
import { createToast } from './view/toast.js';
import { createScheduleView } from './view/scheduleView.js';
import { createScheduleStatusBanner } from './view/scheduleStatus.js';
import { createOnboardingView } from './view/onboardingView.js';
import { renderSearchResults } from './view/searchResults.js';
import { renderChanges } from './view/changesPanel.js';
import { createReminderSettings } from './view/reminderSettings.js';
import { createReminderStore } from '@presentation/reminders';
import { countChanges, lessonKey } from '@core/domain/scheduleDiff';
import {
  goToMySchedule,
  isBrowsingOtherGroup,
  migrateMySelectionPrefs,
  rememberAsMySchedule,
} from '@core/domain/onboarding';
import { createAdminView } from './view/adminView.js';
import { createSnapshotStore, createIndexedDbSnapshotBackend } from './admin/snapshots.ts';
import { initBrandGesture } from '@presentation/gestures/brandGesture';
import { initInstallPrompt } from '@presentation/pwa/install';
import {
  clearSharedLaunchFlag,
  isSharedLaunch,
  takeSharedWorkbook,
} from '@presentation/pwa/sharedFile';
import { escapeHtml } from './text.js';
import { DAY_ORDER } from './constants.js';
import { effect } from '@presentation/stores/signals';
import type { PreferencesService as PrefsServiceType } from '@core/application/services';
import { reportError } from './view/errorBoundary.js';
import { toAppError } from '@core/domain/errors';
import { logger } from '@shared/logger';
import { getBuildDiagnostics, formatBuildDiagnostics } from '@shared/diagnostics';
import { getSupabaseClient } from '@infrastructure/supabase/client.js';
import type { ScheduleData } from '@core/domain/entities/types';
import type { Lesson } from '@core/domain/entities/types';
// Force Supabase bundle inclusion
import '@supabase/supabase-js';

// Toast instance - declared at module level so it's accessible before bootstrap completes
let toast: ReturnType<typeof createToast>;

/** Where the currently rendered schedule came from. */
type ScheduleSource = 'cache' | 'fresh' | 'realtime';

/** Initialize all services and start the app */
export async function bootstrap(): Promise<void> {
  // Version bookkeeping: exactly one "Расписание обновлено" toast per applied
  // version, no matter whether the version arrived through realtime, a manual
  // refresh or a Service Worker message.
  let lastAnnouncedVersion = '';
  let cacheWarningShown = false;
  /** The day filter is seeded from "today" once, after data is on screen. */
  let initialDayApplied = false;
  /** Whether the "Изменения" disclosure is expanded; only the button changes it. */
  let changesOpen = false;

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

  // Initialize UI FIRST (so toast exists before any async callbacks).
  // The render effect it installs runs synchronously, so every piece of state
  // it can reach must already be initialized above.
  const banner = initializeUI(scheduleService, prefsService, authService, adminService);

  // Load initial data
  actions.setLoading(true);

  /** Applies a schedule and announces a new version at most once. */
  const applySchedule = (data: ScheduleData, source: ScheduleSource): void => {
    actions.setSchedule(data);
    renderBuildInfo(data);
    applyInitialDay();

    const version = data.version || '';
    if (source !== 'cache' && version && version !== lastAnnouncedVersion) {
      lastAnnouncedVersion = version;
      toast?.show('Расписание обновлено', 'ok');
    }
  };

  /**
   * "Мои пары сегодня" по умолчанию: как только данные на экране, день
   * переключается на сегодняшний — но только если у выбранной группы сегодня
   * действительно есть пары, иначе день остаётся «как есть».
   */
  function applyInitialDay(): void {
    if (initialDayApplied) return;
    initialDayApplied = true;
    if (currentFilters.value.day) return;
    if (!preferences.value.currentGroup) return;
    const today = todayName.value;
    if (!groupLessons.value.some((lesson) => lesson.day === today)) return;
    actions.setFilter('day', today);
    syncDayFilter(today);
  }

  /**
   * Compares the applied version with the one stored in the offline cache and
   * keeps the result for the "Изменения" section. Failures are swallowed: a
   * broken comparison must never cost the student their schedule.
   *
   * The panel is not opened here: the button badge says that something
   * changed, and the student decides when to look. Opening it on every update
   * would push the timetable off the screen on a plain page load.
   */
  const rememberVersion = (data: ScheduleData): void => {
    void scheduleService
      .recordChanges(data)
      .then((next) => {
        if (next) actions.setChanges(next);
      })
      .catch((err) => {
        logger.warn('[App] Change detection failed', { error: toAppError(err).code });
      });
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
      setNetStatus({ loadFailed: false });
      if (cacheUpdated) {
        cacheWarningShown = false;
        banner.hide();
      } else {
        warnCacheWrite();
      }
    } catch (err) {
      const appError = toAppError(err);
      logger.error('[App] Schedule load failed', { reason }, appError);
      setNetStatus({ loadFailed: true });
      // The banner is shown in every case: with data it explains that the copy
      // on screen may be old, without data it is the only way to retry.
      banner.show('error', appError.userMessage, {
        onRetry: () => void reloadAuthoritative(reason),
        retryLabel: 'Повторить',
      });
      if (!schedule.value) {
        actions.setError('Не удалось загрузить расписание');
        reportError(appError, 'Не удалось загрузить расписание');
      }
    } finally {
      actions.setLoading(false);
    }
  }

  /**
   * Records what the browser claims about the network. A failure of a real
   * load flips `loadFailed`, which is what actually drives the offline notice:
   * `navigator.onLine` alone lies on captive portals and dead Wi-Fi.
   */
  function setNetStatus(patch: { browserOnline?: boolean; loadFailed?: boolean }): void {
    const current = netStatus.value;
    actions.setNetStatus({
      browserOnline: patch.browserOnline ?? current.browserOnline,
      loadFailed: patch.loadFailed ?? current.loadFailed,
    });
  }

  try {
    // Load preferences first
    let prefs = await prefsService.load();
    // One-off promotion for installs that predate "my schedule": their current
    // group was chosen by them, so it becomes the remembered one. Persisting
    // the patch is what makes it one-off and idempotent; a failure is not
    // fatal, the app still works, only the way back is lost until next launch.
    const migration = migrateMySelectionPrefs(prefs);
    if (migration) {
      // Applied in memory even when the write fails: otherwise this session
      // would keep the destructive pre-migration behaviour and only the next
      // launch would be fixed.
      prefs = { ...prefs, ...migration };
      try {
        await prefsService.save(migration);
        logger.info('[prefs] promoted current selection to "my schedule"', { ...migration });
      } catch (err) {
        logger.warn('[prefs] "my schedule" migration was not saved', { error: err as Error });
      }
    }
    actions.setPreference('currentSheetId', prefs.currentSheetId);
    actions.setPreference('currentGroup', prefs.currentGroup);
    actions.setPreference('activeSubgroup', prefs.activeSubgroup);
    actions.setPreference('mySheetId', prefs.mySheetId || '');
    actions.setPreference('myGroup', prefs.myGroup || '');
    actions.setPreference('mySubgroup', prefs.mySubgroup || '');
    if (prefs.onboardingSkipped) actions.skipOnboarding();

    // PWA shortcut / start_url: open straight on today's weekday.
    applyLaunchFilters();

    // Non-blocking first render: the cached snapshot paints immediately while
    // the authoritative load runs. The heavy XLS parser is not part of this path.
    const cached = await scheduleService.loadCached();
    if (cached) {
      applySchedule(cached, 'cache');
      lastAnnouncedVersion = cached.version || '';
      rememberVersion(cached);
    }

    await reloadAuthoritative('bootstrap');
    if (schedule.value) rememberVersion(schedule.value);

    // Subscribe to realtime updates
    const unsubscribe = scheduleService.subscribe((data) => {
      // Authoritative-first: apply, then refresh the offline cache.
      applySchedule(data, 'realtime');
      setNetStatus({ loadFailed: false });
      rememberVersion(data);
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
    listenForNetworkChanges(() => void reloadAuthoritative('online'));
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
    // path the students use. The dialog also gets the schedule this window
    // already shows (its comparison costs no request) and the on-device
    // snapshot store the rollback is restored from.
    const adminView = createAdminView(
      authService,
      adminService,
      toast,
      () => reloadAuthoritative('publish'),
      {
        getCurrentSchedule: () => schedule.value,
        snapshots: createSnapshotStore(createIndexedDbSnapshotBackend()),
      }
    );

    // Cache pill value elements
    const sheetValue = document.getElementById('sheetValue');
    const groupValue = document.getElementById('groupValue');
    const subgroupValue = document.getElementById('subgroupValue');
    const quickPick = document.getElementById('quickPick');
    const offlineBar = document.getElementById('offlineBar');
    const searchResultsEl = document.getElementById('searchResults');
    const viewTools = document.getElementById('viewTools');
    const myScheduleBtn = document.getElementById('myScheduleBtn') as HTMLButtonElement | null;
    const modeDayBtn = document.getElementById('modeDayBtn') as HTMLButtonElement | null;
    const modeWeekBtn = document.getElementById('modeWeekBtn') as HTMLButtonElement | null;
    const changesBtn = document.getElementById('changesBtn') as HTMLButtonElement | null;
    const changesCount = document.getElementById('changesCount');
    const changesPanel = document.getElementById('changesPanel');
    const dayFilterEl = document.getElementById('dayFilter') as HTMLSelectElement | null;

    populateDayFilter();

    // The schedule view owns pull-to-refresh; main.ts must not attach a second
    // handler, otherwise one gesture triggers two refreshes.
    scheduleView.setOnRefresh(() => handlePullRefresh(scheduleService));
    scheduleView.setOnDayChange((day: string) => syncDayFilter(day));
    scheduleView.setOnOpenDay((day: string) => jumpToDay(day));
    scheduleView.setOnRemind((lesson: Lesson) => scheduleReminderFor(lesson));

    // Reminders live on this device only: localStorage list + platform
    // notifications, no server call.
    const reminders = createReminderStore();
    reminders.start();
    reminders.onChange(() => renderScheduleView());

    const reminderSettings = createReminderSettings({
      store: reminders,
      section: document.getElementById('reminderSettings'),
      list: document.getElementById('reminderList'),
      leadRow: document.getElementById('reminderLeadRow'),
      enableButton: document.getElementById('reminderEnable') as HTMLButtonElement | null,
      status: document.getElementById('reminderStatus'),
      onRequest: () => {
        void reminders.request().then((state) => {
          if (state === 'granted') toast?.show('Напоминания включены', 'ok');
          else if (state === 'denied') toast?.show('Уведомления запрещены в браузере', 'bad');
          else toast?.show('Браузер не разрешил уведомления', 'bad');
          renderScheduleView();
          reminderSettings.render();
        });
      },
    });

    // First run: one short chooser instead of an empty schedule.
    const onboarding = createOnboardingView({
      root: document.getElementById('onboarding') as HTMLElement,
      list: document.getElementById('onboardingList') as HTMLElement,
      title: document.getElementById('onboardingTitle') as HTMLElement,
      hint: document.getElementById('onboardingHint') as HTMLElement,
      skip: document.getElementById('onboardingSkip') as HTMLButtonElement,
      onSelect: async (selection) => {
        await prefsService.save({
          currentSheetId: selection.sheetId,
          currentGroup: selection.group,
          activeSubgroup: '',
          mySheetId: selection.sheetId,
          myGroup: selection.group,
          mySubgroup: '',
        });
        actions.setPreference('currentSheetId', selection.sheetId);
        actions.setPreference('currentGroup', selection.group);
        actions.setPreference('activeSubgroup', '');
        actions.setPreference('mySheetId', selection.sheetId);
        actions.setPreference('myGroup', selection.group);
        actions.setPreference('mySubgroup', '');
        onboarding.reset();
        initialDayApplied = false;
        applyInitialDay();
        renderScheduleView();
      },

      onSkip: () => {
        actions.skipOnboarding();
        void prefsService.save({ onboardingSkipped: true });
        renderScheduleView();
      },
    });

    myScheduleBtn?.addEventListener('click', () => {
      const patch = actions.goToMySchedule();
      if (!patch.currentGroup) return;
      void prefsService.save(patch);
      jumpToDay(currentFilters.value.day || todayName.value);
    });

    modeDayBtn?.addEventListener('click', () => setViewMode('day'));
    modeWeekBtn?.addEventListener('click', () => setViewMode('week'));

    changesBtn?.addEventListener('click', () => {
      changesOpen = !changesOpen;
      renderChangesPanel();
    });

    /** Reminder for one lesson, with an honest message for every refusal. */
    function scheduleReminderFor(lesson: Lesson): void {
      const result = reminders.add(lesson);
      if (result.ok) {
        toast?.show(`Напомним за ${result.reminder.leadMinutes} мин до начала`, 'ok');
        return;
      }
      const messages: Record<string, string> = {
        passed: 'Пара уже началась — напоминать поздно',
        'too-soon': 'До начала меньше, чем выбранное напоминание',
        'no-time': 'У этой пары не указано время',
      };
      toast?.show(messages[result.reason] || 'Напоминание невозможно', 'bad');
    }

    function setViewMode(mode: ViewMode): void {
      actions.setViewMode(mode);
      renderScheduleView();
    }

    /** Navigate to a weekday without losing the search query. */
    function jumpToDay(day: string): void {
      if (!day) return;
      actions.showDayOf(day);
      syncDayFilter(day);
      renderScheduleView();
    }

    /** The schedule itself; the chrome around it is rendered separately. */
    function renderScheduleView(): void {
      const mode = viewMode.value;
      scheduleView.render(groupLessons.value, {
        today: ui.value.loading ? '' : todayName.value,
        mode,
        plan: weekPlan.value,
        selectedDay: mode === 'day' ? currentFilters.value.day : '',
        emptyReason: emptyReason.value,
        canRemind: reminders.canRemind(),
        isReminded: (lesson: Lesson) => reminders.keys().has(lessonKey(lesson)),
      });
    }

    function renderChangesPanel(): void {
      if (!changesPanel || !changesBtn) return;
      const next = scopedChanges.value;
      renderChanges(changesPanel, changesOpen ? next : null, { onJump: jumpToDay });
      changesBtn.setAttribute('aria-expanded', String(changesOpen && Boolean(next)));
      changesPanel.hidden = !changesOpen || !next;
    }

    // Bind store to view
    effect(() => {
      const state = {
        schedule: schedule.value,
        preferences: preferences.value,
        ui: ui.value,
        notice: offlineNotice.value,
        screen: startScreen.value,
        results: searchResults.value,
        changes: scopedChanges.value,
        browsing: browsingOtherGroup.value,
        mode: viewMode.value,
      };
      logger.debug('[ui] subscribe triggered', { preferences: state.preferences });
      logger.debug('[ui] filtered lessons', { count: filteredLessons.value?.length });

      if (state.schedule || state.ui.error) {
        // First run gets the chooser instead of somebody else's schedule.
        const showChooser = state.screen === 'onboarding' && Boolean(state.schedule);
        if (showChooser && state.schedule) {
          onboarding.show(state.schedule, 'visible');
          container?.setAttribute('hidden', '');
        } else {
          if (state.schedule) onboarding.show(state.schedule, 'hidden');
          container?.removeAttribute('hidden');
          renderScheduleView();
        }
        // Show quickPick selectors when schedule is loaded. The compact pill
        // stays visible for the rest of the session.
        if (quickPick) quickPick.classList.remove('hidden');
      }

      // Offline notice: visible only while the data on screen may be stale.
      if (offlineBar) {
        offlineBar.textContent = state.notice.text;
        offlineBar.hidden = !state.notice.offline;
      }

      // Search results live in their own block, so the selected day survives.
      renderSearchResults(searchResultsEl, state.results, {
        query: currentFilters.value.search,
        onJump: jumpToDay,
      });

      // Toolbar: only the controls that have something to do.
      if (viewTools) viewTools.hidden = !state.schedule;
      if (myScheduleBtn) myScheduleBtn.hidden = !state.browsing;
      if (dayFilterEl) dayFilterEl.disabled = state.mode === 'week';
      if (modeDayBtn && modeWeekBtn) {
        modeDayBtn.classList.toggle('active', state.mode === 'day');
        modeWeekBtn.classList.toggle('active', state.mode === 'week');
        modeDayBtn.setAttribute('aria-selected', String(state.mode === 'day'));
        modeWeekBtn.setAttribute('aria-selected', String(state.mode === 'week'));
      }
      if (changesBtn) changesBtn.hidden = !state.changes;
      if (changesCount) changesCount.textContent = String(countChanges(state.changes));
      renderChangesPanel();

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

    // A workbook shared into the PWA: take it over and prefill the admin dialog
    // so publishing is one PIN away.
    void adoptSharedWorkbook(adminView, toast);

    // Bind UI events
    bindEvents(scheduleService, prefsService, authService, adminService);

    return createScheduleStatusBanner();
  }

  function syncDayFilter(day: string): void {
    const dayFilter = document.getElementById('dayFilter') as HTMLSelectElement | null;
    if (dayFilter) dayFilter.value = day;
  }

  /**
   * Launch deep links.
   *
   * `?day=today` is carried by the manifest `start_url` and by the "Сегодня"
   * app shortcut, so a long press on the home-screen icon lands on today's
   * weekday without the user picking anything first.
   */
  function applyLaunchFilters(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('day') !== 'today') return;
    actions.setFilter('day', todayName.value);
    syncDayFilter(todayName.value);
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
    // "Сделать моей группой": explicit, because browsing must not overwrite
    // the remembered selection.
    const rememberGroupBtn = document.getElementById('rememberGroupBtn');

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

    rememberGroupBtn?.addEventListener('click', async () => {
      await prefsService.save(actions.rememberCurrentAsMySchedule());
      actions.closeModal();
      toast?.show('Запомнил: это твоя группа', 'ok');
    });

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

    // "input" covers typing and clearing; "search" covers the native clear
    // button of type="search" in browsers that fire only that one.
    const onSearchInput = (e: Event) =>
      actions.setFilter('search', (e.target as HTMLInputElement).value);
    searchInput?.addEventListener('input', onSearchInput);
    searchInput?.addEventListener('search', onSearchInput);
    dayFilter?.addEventListener('change', (e) =>
      actions.setFilter('day', (e.target as HTMLSelectElement).value)
    );
    // Clearing the search must leave the chosen day exactly where it was.
    resetBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      actions.clearSearch();
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
    const rememberGroupBtn = document.getElementById('rememberGroupBtn');
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
        // The very first explicit choice is the student's own group; later
        // choices are treated as browsing until they say otherwise.
        const firstChoice = !preferences.value.myGroup && !preferences.value.mySheetId;
        actions.setPreference('currentGroup', groupCode);
        actions.setPreference('activeSubgroup', '');
        const patch: Record<string, string> = { currentGroup: groupCode, activeSubgroup: '' };
        if (firstChoice) Object.assign(patch, actions.rememberCurrentAsMySchedule());
        await prefsService.save(patch);
        actions.closeModal();
      });
    });

    if (rememberGroupBtn) {
      // Only meaningful while browsing somebody else's group.
      rememberGroupBtn.classList.toggle('hidden', !isBrowsingOtherGroup(preferences.value));
    }
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
 * Network flag of the browser.
 *
 * This only feeds the notice; the authoritative load result decides whether
 * the schedule is really fresh, because a connected browser can still be
 * unable to reach Supabase.
 */
function listenForNetworkChanges(onOnline?: () => void): void {
  window.addEventListener('offline', () => {
    actions.setNetStatus({ browserOnline: false, loadFailed: true });
  });
  window.addEventListener('online', () => {
    actions.setNetStatus({ browserOnline: true });
    onOnline?.();
  });
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
 * Fills the "День" filter, which shipped with a single hard-coded option and
 * could therefore never actually filter anything.
 */
function populateDayFilter(): void {
  const select = document.getElementById('dayFilter') as HTMLSelectElement | null;
  if (!select || select.options.length > 1) return;
  for (const day of DAY_ORDER) {
    const option = document.createElement('option');
    option.value = day;
    option.textContent = day;
    select.appendChild(option);
  }
}

/**
 * Picks up a workbook shared into the PWA from the Android share sheet.
 *
 * The Service Worker already parked the file in Cache Storage and the landing
 * page appended `?shared=1`; the admin dialog is opened with the file staged so
 * the user only has to enter the PIN and publish.
 */
async function adoptSharedWorkbook(
  adminView: { show(): void; stageFile(file: File): void },
  toast: { show(message: string, type?: string): void } | undefined
): Promise<void> {
  if (!isSharedLaunch()) return;
  const shared = await takeSharedWorkbook();
  // Always drop the marker: a reload must not re-open the admin dialog.
  clearSharedLaunchFlag();
  if (!shared) {
    logger.warn('[share] no workbook found in the handoff cache');
    return;
  }
  adminView.stageFile(shared.file);
  adminView.show();
  toast?.show(`Файл «${shared.name}» готов к публикации`, 'ok');
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

/**
 * Install affordance. Must be wired at module scope: `beforeinstallprompt` is
 * only observable if a listener is present before the browser decides to fire
 * it, which can happen before the first render finishes.
 */
initInstallPrompt({
  panel: document.getElementById('installPanel'),
  title: document.getElementById('installPanelTitle'),
  subtitle: document.getElementById('installPanelSub'),
  button: document.getElementById('installBtn') as HTMLButtonElement | null,
  dismiss: document.getElementById('installDismiss') as HTMLButtonElement | null,
});

// Start the app - register SW independently (runs even if bootstrap fails)
registerServiceWorker();
bootstrap().catch((err) => {
  logger.error('[App] Fatal error', { context: 'bootstrap' }, err as Error);
  document.body.innerHTML =
    '<div style="padding:2rem;text-align:center">Ошибка инициализации приложения</div>';
});
