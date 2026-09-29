/**
 * Application Store - Central reactive state for the entire app
 * Combines schedule data, user preferences, and UI state
 */
import type {
  ScheduleData,
  Lesson,
  Sheet,
  Group,
  UserPreferences,
  DayName,
} from '@core/domain/entities/types';
import { signal, computed, effect, batch } from '@preact/signals';
import { logger } from '@shared/logger';
import { buildWeekPlan } from '@core/domain/weekPlan';
import type { DayPlan } from '@core/domain/weekPlan';
import { searchLessons } from '@core/domain/search';
import { resolveConnectivity } from '@core/domain/connectivity';
import type { ConnectivityResult } from '@core/domain/connectivity';
import { scopeChanges } from '@core/domain/scheduleDiff';
import type { ScheduleChanges } from '@core/domain/scheduleDiff';
import {
  hasSavedGroup,
  isBrowsingOtherGroup,
  resolveStartScreen,
  goToMySchedule as mySchedulePatch,
  rememberAsMySchedule as rememberAsMySchedulePatch,
} from '@core/domain/onboarding';
import type { StartScreen } from '@core/domain/onboarding';

export type ViewMode = 'day' | 'week';

export interface AppState {
  schedule: ScheduleData | null;
  filteredLessons: Lesson[];
  currentFilters: {
    day: string;
    search: string;
  };
  ui: {
    loading: boolean;
    error: string | null;
    showInstallPrompt: boolean;
    activeModal: string | null;
  };
  preferences: UserPreferences;
  isAdmin: boolean;
  updateAvailable: { version: string; updatedAt: string } | null;
}

const initialPreferences: UserPreferences = {
  currentSheetId: '',
  currentGroup: '',
  activeSubgroup: '',
  hiddenSheets: [],
};

const initialUI = {
  loading: true,
  error: null as string | null,
  showInstallPrompt: false,
  activeModal: null as string | null,
};

const initialFilters = { day: '', search: '' };

// Individual signals for each piece of state
export const schedule = signal<ScheduleData | null>(null);
export const preferences = signal<UserPreferences>(initialPreferences);
export const ui = signal(initialUI);
export const currentFilters = signal(initialFilters);
export const isAdmin = signal(false);
export const updateAvailable = signal<{ version: string; updatedAt: string } | null>(null);

/** "День" (default) or "Неделя". */
export const viewMode = signal<ViewMode>('day');

/** Added/removed lessons of the last publish, already scoped by the caller. */
export const changes = signal<ScheduleChanges | null>(null);

/** The student asked to look at the whole timetable instead of choosing. */
export const onboardingSkipped = signal(false);

/**
 * What we know about the connection.
 *
 * `browserOnline` is `navigator.onLine`, `loadFailed` is set by the real
 * authoritative load: an "online" browser that cannot reach Supabase must
 * still be reported as offline.
 */
export const netStatus = signal<{ browserOnline: boolean; loadFailed: boolean }>({
  browserOnline: true,
  loadFailed: false,
});

// Selectors for common derived state
export const scheduleData = computed(() => schedule.value);
export const lessons = computed(() => {
  const sched = scheduleData.value;
  if (!sched) return [];
  return Array.from(sched.sheets.values()).flat();
});

export const sheets = computed(() => {
  const sched = scheduleData.value;
  return sched?.sheetsMeta || [];
});

export const groups = computed(() => {
  const sched = scheduleData.value;
  const prefs = preferences.value;
  if (!sched || !prefs.currentSheetId) return [];
  const sheetLessons = sched.sheets.get(prefs.currentSheetId) || [];
  const groupMap = new Map<string, { code: string; count: number; subgroups: Set<string> }>();

  for (const lesson of sheetLessons) {
    const existing = groupMap.get(lesson.group);
    if (!existing) {
      groupMap.set(lesson.group, {
        code: lesson.group,
        count: 1,
        subgroups: new Set([lesson.subgroup].filter(Boolean)),
      });
    } else {
      existing.count++;
      if (lesson.subgroup) existing.subgroups.add(lesson.subgroup);
    }
  }

  return Array.from(groupMap.entries()).map(([code, meta]) => ({
    code,
    count: meta.count,
    subgroups: Array.from(meta.subgroups).sort(),
  }));
});

export const currentSheet = computed(() => {
  const sched = scheduleData.value;
  const prefs = preferences.value;
  if (!sched || !prefs.currentSheetId) return null;
  return sched.sheetsMeta.find((s) => s.id === prefs.currentSheetId) || null;
});

export const currentGroup = computed(() => {
  const prefs = preferences.value;
  const groupsList = groups.value;
  if (!prefs.currentGroup) return null;
  return groupsList.find((g) => g.code === prefs.currentGroup) || null;
});

export const subgroups = computed(() => {
  const group = currentGroup.value;
  return group?.subgroups || [];
});

/** Parse "ПСТ-1-25 (1)" → { code: "ПСТ-1-25", subgroup: "1" } */
function parseGroupSelection(selected: string): { code: string; subgroup: string | null } {
  if (!selected) return { code: '', subgroup: null };
  const match = selected.match(/^(.+?)\s*\((\d+)\)$/);
  if (match) return { code: match[1]!, subgroup: match[2]! };
  return { code: selected, subgroup: null };
}

/**
 * Lessons of the selected department / group / subgroup, with neither the day
 * nor the search applied.
 *
 * This is the base every other view derives from: the day list, the week
 * overview and the search block all start here, which is what keeps the search
 * from narrowing the day filter and vice versa.
 */
export const groupLessons = computed(() => {
  const allLessons = lessons.value;
  const prefs = preferences.value;

  let result = allLessons;

  // Filter by sheet (department)
  if (prefs.currentSheetId) {
    result = result.filter((l) => l.sheetId === prefs.currentSheetId);
  }

  // Filter by group (currentGroup stores just the group code, e.g., "ПСТ-1-25")
  if (prefs.currentGroup) {
    result = result.filter((l) => l.group === prefs.currentGroup);
  }

  // Filter by subgroup (activeSubgroup stores just the subgroup, e.g., "1")
  if (prefs.activeSubgroup) {
    result = result.filter((l) => String(l.subgroup) === String(prefs.activeSubgroup));
  }

  return result;
});

/**
 * What the day view renders: the student's own lessons for the selected day.
 *
 * The search query is intentionally not applied here — search results are a
 * separate block so the selected day survives clearing the query.
 */
export const filteredLessons = computed(() => {
  const base = groupLessons.value;
  const day = currentFilters.value.day;

  const result = day ? base.filter((l) => l.day === day) : base;

  // Counts only: lesson objects are never logged (they contain the full
  // schedule and would flood the console on every filter change).
  logger.debug('[filter] applied', {
    sheet: preferences.value.currentSheetId,
    group: preferences.value.currentGroup,
    subgroup: preferences.value.activeSubgroup,
    total: lessons.value.length,
    filtered: result.length,
  });

  return result;
});

/** Matches for the search box, ignoring the day filter on purpose. */
export const searchResults = computed(() => {
  const query = currentFilters.value.search;
  if (!query.trim()) return [];
  return searchLessons(groupLessons.value, query);
});

/** Every day of the student's week, in weekday order. */
export const weekPlan = computed<DayPlan[]>(() =>
  buildWeekPlan(groupLessons.value, todayName.value)
);

/** The offline / stale-data notice for the current connection state. */
export const offlineNotice = computed<ConnectivityResult>(() => {
  const data = schedule.value;
  const net = netStatus.value;
  return resolveConnectivity({
    browserOnline: net.browserOnline,
    loadFailed: net.loadFailed,
    hasData: Boolean(data),
    updatedAt: data?.updatedAt,
  });
});

/** Which of the three start states the app is in right now. */
export const startScreen = computed<StartScreen>(() => {
  const data = schedule.value;
  return resolveStartScreen({
    loading: ui.value.loading,
    hasSchedule: Boolean(data && data.sheetsMeta.length),
    hasSavedGroup: hasSavedGroup(preferences.value),
    skipped: onboardingSkipped.value,
  });
});

/** True while the student is looking at somebody else's group. */
export const browsingOtherGroup = computed(() => isBrowsingOtherGroup(preferences.value));

/** Changes narrowed to the currently selected group. */
export const scopedChanges = computed(() =>
  scopeChanges(changes.value, {
    sheetId: preferences.value.currentSheetId,
    group: preferences.value.currentGroup,
    subgroup: preferences.value.activeSubgroup,
  })
);

/**
 * Why the list is empty, so an empty screen reads as an answer and not as a
 * failure to load.
 */
export const emptyReason = computed(() => {
  if (!schedule.value || !schedule.value.sheetsMeta.length) {
    return ui.value.error ? 'load-failed' : 'no-schedule';
  }
  if (!preferences.value.currentGroup) return 'no-group';
  const own = groupLessons.value;
  if (!own.length) return 'no-group-lessons';
  if (currentFilters.value.day && !filteredLessons.value.length) return 'no-lessons-today';
  return 'unknown';
});

export const days = computed(() => {
  const lessonList = groupLessons.value;
  const daySet = new Set<DayName>(lessonList.map((l) => l.day));
  const DAY_ORDER: DayName[] = [
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
    'Воскресенье',
  ];
  return DAY_ORDER.filter((d) => daySet.has(d));
});

export const todayName = computed(() => {
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return days[new Date().getDay()];
});

export const isToday = (day: string) => day === todayName.value;

// Actions
export const actions = {
  setSchedule(data: ScheduleData) {
    batch(() => {
      schedule.value = data;
      ui.value = { ...ui.value, loading: false, error: null };
      // Sync preferences with schedule
      const prefs = preferences.value;
      const firstSheet = data.sheetsMeta[0];
      if (!prefs.currentSheetId && firstSheet) {
        preferences.value = { ...prefs, currentSheetId: firstSheet.id };
      }
    });
  },

  setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    batch(() => {
      preferences.value = { ...preferences.value, [key]: value };
    });
  },

  setFilter<K extends keyof typeof initialFilters>(key: K, value: (typeof initialFilters)[K]) {
    batch(() => {
      currentFilters.value = { ...currentFilters.value, [key]: value };
    });
  },

  setLoading(loading: boolean) {
    batch(() => {
      ui.value = { ...ui.value, loading };
    });
  },

  setError(error: string | null) {
    batch(() => {
      ui.value = { ...ui.value, error };
    });
  },

  openModal(modal: string) {
    batch(() => {
      ui.value = { ...ui.value, activeModal: modal };
    });
  },

  closeModal() {
    batch(() => {
      ui.value = { ...ui.value, activeModal: null };
    });
  },

  setAdmin(admin: boolean) {
    batch(() => {
      isAdmin.value = admin;
    });
  },

  setUpdateAvailable(update: { version: string; updatedAt: string } | null) {
    batch(() => {
      updateAvailable.value = update;
    });
  },

  setViewMode(mode: ViewMode) {
    batch(() => {
      viewMode.value = mode;
    });
  },

  setChanges(next: ScheduleChanges | null) {
    batch(() => {
      changes.value = next;
    });
  },

  setNetStatus(patch: Partial<{ browserOnline: boolean; loadFailed: boolean }>) {
    batch(() => {
      netStatus.value = { ...netStatus.value, ...patch };
    });
  },

  skipOnboarding() {
    batch(() => {
      onboardingSkipped.value = true;
    });
  },

  /**
   * Returns the view to the remembered group.
   *
   * The patch is returned as well so the caller can persist exactly what was
   * applied, instead of a second, possibly different, derivation.
   */
  goToMySchedule(): Partial<UserPreferences> {
    const patch = mySchedulePatch(preferences.value);
    if (!patch.currentGroup) return patch;
    batch(() => {
      preferences.value = { ...preferences.value, ...patch };
    });
    return patch;
  },

  /** Marks the current selection as the remembered one. */
  rememberCurrentAsMySchedule(): Partial<UserPreferences> {
    const patch = rememberAsMySchedulePatch(preferences.value);
    batch(() => {
      preferences.value = { ...preferences.value, ...patch };
    });
    return patch;
  },

  /**
   * Forgets every stored group, remembered or merely browsed.
   *
   * Used on a shared or borrowed device: the next person must not open the app
   * and find somebody else's group already selected, and the chooser has to be
   * reachable again — `onboardingSkipped` is a one-way flag, so it goes back to
   * `false` here instead of staying "already answered" for good.
   */
  forgetSelection() {
    batch(() => {
      preferences.value = {
        ...preferences.value,
        currentSheetId: '',
        currentGroup: '',
        activeSubgroup: '',
        mySheetId: '',
        myGroup: '',
        mySubgroup: '',
      };
      currentFilters.value = { ...currentFilters.value, day: '' };
      onboardingSkipped.value = false;
    });
  },

  /** Clearing the search must not touch the selected day. */
  clearSearch() {
    batch(() => {
      currentFilters.value = { ...currentFilters.value, search: '' };
    });
  },

  /** Jumps to one weekday from a search result or a change entry. */
  showDayOf(day: string) {
    batch(() => {
      currentFilters.value = { ...currentFilters.value, day };
      viewMode.value = 'day';
    });
  },

  resetFilters() {
    batch(() => {
      currentFilters.value = { day: '', search: '' };
    });
  },
};
