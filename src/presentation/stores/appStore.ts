/**
 * Application Store - Central reactive state for the entire app
 * Combines schedule data, user preferences, and UI state
 */
import type { ScheduleData, Lesson, Sheet, Group, UserPreferences, DayName } from '@core/domain/entities/types';
import { createStore, signal, computed, type Store, type Signal, type Computed } from './signals';

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

const initialState: AppState = {
  schedule: null,
  filteredLessons: [],
  currentFilters: { day: '', search: '' },
  ui: {
    loading: true,
    error: null,
    showInstallPrompt: false,
    activeModal: null
  },
  preferences: {
    currentSheetId: '',
    currentGroup: '',
    activeSubgroup: '',
    hiddenSheets: []
  },
  isAdmin: false,
  updateAvailable: null
};

export const appStore = createStore<AppState>(initialState);

// Selectors for common derived state
export const scheduleData = computed(() => appStore.get('schedule').value);
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
  const prefs = appStore.get('preferences').value;
  if (!sched || !prefs.currentSheetId) return [];
  const sheetLessons = sched.sheets.get(prefs.currentSheetId) || [];
  const groupMap = new Map<string, { code: string; count: number; subgroups: Set<string> }>();
  
  for (const lesson of sheetLessons) {
    const existing = groupMap.get(lesson.group);
    if (!existing) {
      groupMap.set(lesson.group, { code: lesson.group, count: 1, subgroups: new Set([lesson.subgroup].filter(Boolean)) });
    } else {
      existing.count++;
      if (lesson.subgroup) existing.subgroups.add(lesson.subgroup);
    }
  }
  
  return Array.from(groupMap.entries())
    .map(([code, meta]) => ({ code, count: meta.count, subgroups: Array.from(meta.subgroups).sort() }));
});

export const currentSheet = computed(() => {
  const sched = scheduleData.value;
  const prefs = appStore.get('preferences').value;
  if (!sched || !prefs.currentSheetId) return null;
  return sched.sheetsMeta.find(s => s.id === prefs.currentSheetId) || null;
});

export const currentGroup = computed(() => {
  const prefs = appStore.get('preferences').value;
  const groupsList = groups.value;
  if (!prefs.currentGroup) return null;
  return groupsList.find(g => g.code === prefs.currentGroup) || null;
});

export const subgroups = computed(() => {
  const group = currentGroup.value;
  return group?.subgroups || [];
});

export const filteredLessons = computed(() => {
  const allLessons = lessons.value;
  const prefs = appStore.get('preferences').value;
  const filters = appStore.get('currentFilters').value;
  
  let result = allLessons;
  
  if (prefs.currentSheetId) {
    result = result.filter(l => l.sheetId === prefs.currentSheetId);
  }
  if (prefs.currentGroup) {
    result = result.filter(l => l.group === prefs.currentGroup);
  }
  if (prefs.activeSubgroup) {
    result = result.filter(l => l.subgroup === prefs.activeSubgroup);
  }
  if (filters.day) {
    result = result.filter(l => l.day === filters.day);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(l =>
      `${l.day} ${l.time} ${l.group} ${l.subject} ${l.teacher} ${l.room}`.toLowerCase().includes(q)
    );
  }
  
  return result;
});

export const days = computed(() => {
  const lessonList = filteredLessons.value;
  const daySet = new Set<DayName>(lessonList.map(l => l.day));
  const DAY_ORDER: DayName[] = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  return DAY_ORDER.filter(d => daySet.has(d));
});

export const todayName = computed(() => {
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  return days[new Date().getDay()];
});

export const isToday = (day: string) => day === todayName.value;

// Actions
export const actions = {
  setSchedule(data: ScheduleData) {
    appStore.set('schedule', data);
    // Sync preferences with schedule
    const prefs = appStore.get('preferences').value;
    const firstSheet = data.sheetsMeta[0];
    if (!prefs.currentSheetId && firstSheet) {
      actions.setPreference('currentSheetId', firstSheet.id);
    }
  },

  setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    appStore.set('preferences', prev => ({ ...prev, [key]: value }));
  },

  setFilter<K extends keyof AppState['currentFilters']>(key: K, value: AppState['currentFilters'][K]) {
    appStore.set('currentFilters', prev => ({ ...prev, [key]: value }));
  },

  setLoading(loading: boolean) {
    appStore.set('ui', prev => ({ ...prev, loading }));
  },

  setError(error: string | null) {
    appStore.set('ui', prev => ({ ...prev, error }));
  },

  openModal(modal: string) {
    appStore.set('ui', prev => ({ ...prev, activeModal: modal }));
  },

  closeModal() {
    appStore.set('ui', prev => ({ ...prev, activeModal: null }));
  },

  setAdmin(isAdmin: boolean) {
    appStore.set('isAdmin', isAdmin);
  },

  setUpdateAvailable(update: { version: string; updatedAt: string } | null) {
    appStore.set('updateAvailable', update);
  },

  resetFilters() {
    appStore.set('currentFilters', { day: '', search: '' });
  }
};