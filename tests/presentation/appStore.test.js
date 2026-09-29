import { describe, expect, it } from 'vitest';
import {
  actions,
  browsingOtherGroup,
  currentFilters,
  emptyReason,
  filteredLessons,
  groupLessons,
  netStatus,
  offlineNotice,
  preferences,
  schedule,
  scopedChanges,
  searchResults,
  startScreen,
  viewMode,
  weekPlan,
} from '../../src/presentation/stores/appStore';
const lesson = (over = {}) => ({
  id: '1',
  sheetId: 'ЛД',
  day: 'Понедельник',
  dayOrder: 0,
  time: '08:00-09:20',
  para: '1',
  group: 'ЛД-11',
  subgroup: '',
  subject: 'Анатомия',
  type: 'lecture',
  teacher: 'Иванов',
  room: '201',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const data = (items) => ({
  sheets: new Map([['ЛД', items]]),
  sheetsMeta: [{ id: 'ЛД', name: 'Лечебное дело', order: 0, lessonCount: items.length }],
  groups: new Map(),
  preferences: {
    currentSheetId: 'ЛД',
    currentGroup: 'ЛД-11',
    activeSubgroup: '',
    hiddenSheets: [],
  },
  version: 'W38',
  updatedAt: new Date(2026, 8, 30, 8, 12).toISOString(),
});

const reset = () => {
  actions.setSchedule(data([]));
  preferences.value = {
    currentSheetId: 'ЛД',
    currentGroup: 'ЛД-11',
    activeSubgroup: '',
    hiddenSheets: [],
  };
  actions.setFilter('day', '');
  actions.setFilter('search', '');
  actions.setViewMode('day');
  actions.setChanges(null);
  actions.setNetStatus({ browserOnline: true, loadFailed: false });
  actions.setLoading(false);
};

describe('my schedule selection', () => {
  it('shows the first-run chooser while no group is remembered', () => {
    reset();
    preferences.value = { ...preferences.value, currentGroup: '', myGroup: '' };
    expect(startScreen.value).toBe('onboarding');
  });

  it('opens the schedule as soon as a group is known', () => {
    reset();
    // A remembered group is what counts; the current one alone is browsing.
    preferences.value = { ...preferences.value, mySheetId: 'ЛД', myGroup: 'ЛД-11' };
    expect(startScreen.value).toBe('schedule');
  });

  it('keeps the remembered group when another one is being browsed', () => {
    reset();
    preferences.value = {
      ...preferences.value,
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      currentGroup: 'СТ-22',
    };
    expect(browsingOtherGroup.value).toBe(true);
    const patch = actions.goToMySchedule();
    expect(patch).toEqual({
      currentSheetId: 'ЛД',
      currentGroup: 'ЛД-11',
      activeSubgroup: '',
    });
    expect(browsingOtherGroup.value).toBe(false);
  });
});

describe('search does not touch the day filter', () => {
  const week = [
    lesson(),
    lesson({ id: '2', day: 'Среда', subject: 'Химия', room: '101', time: '10:00-11:20' }),
  ];

  /** Monday selected, search active — the state most tests need. */
  const searching = () => {
    reset();
    actions.setSchedule(data(week));
    actions.setFilter('day', 'Понедельник');
    actions.setFilter('search', 'химия');
  };

  it('finds matches on other days than the selected one', () => {
    searching();
    expect(groupLessons.value).toHaveLength(2);
    expect(filteredLessons.value).toHaveLength(1);
    expect(searchResults.value).toHaveLength(1);
    expect(searchResults.value[0].day).toBe('Среда');
  });

  it('keeps the selected day when the search is cleared', () => {
    searching();
    actions.clearSearch();
    expect(currentFilters.value.day).toBe('Понедельник');
    expect(currentFilters.value.search).toBe('');
    expect(searchResults.value).toEqual([]);
    expect(filteredLessons.value).toHaveLength(1);
  });

  it('jumps to the day of a result without dropping the query', () => {
    searching();
    actions.showDayOf('Среда');
    expect(currentFilters.value.day).toBe('Среда');
    expect(currentFilters.value.search).toBe('химия');
    expect(viewMode.value).toBe('day');
  });
});

describe('week mode', () => {
  it('builds the whole week from the selected group', () => {
    reset();
    actions.setSchedule(
      data([
        lesson(),
        lesson({ id: '2', day: 'Пятница', subject: 'Биология', time: '09:00-10:20' }),
      ])
    );
    actions.setFilter('day', 'Понедельник');
    expect(filteredLessons.value).toHaveLength(1);
    // The week view deliberately ignores the day filter.
    expect(weekPlan.value.map((entry) => entry.day)).toEqual(['Понедельник', 'Пятница']);
  });
});

describe('offline notice', () => {
  it('appears when the browser reports no network', () => {
    reset();
    actions.setSchedule(data([lesson()]));
    actions.setNetStatus({ browserOnline: false });
    expect(offlineNotice.value.offline).toBe(true);
    expect(offlineNotice.value.text).toBe('Офлайн · последнее обновление в 08:12');
  });

  it('appears when a load failed although the browser says it is online', () => {
    actions.setNetStatus({ browserOnline: true, loadFailed: true });
    expect(offlineNotice.value.offline).toBe(true);
  });

  it('disappears on its own once a load succeeds', () => {
    actions.setNetStatus({ browserOnline: true, loadFailed: false });
    expect(offlineNotice.value).toEqual({ offline: false, text: '' });
  });
});

describe('empty states', () => {
  it('names the reason instead of showing a blank screen', () => {
    reset();
    actions.setSchedule({ ...data([]), sheetsMeta: [] });
    expect(emptyReason.value).toBe('no-schedule');
    actions.setSchedule(data([lesson()]));
    preferences.value = { ...preferences.value, currentGroup: '' };
    expect(emptyReason.value).toBe('no-group');
    preferences.value = { ...preferences.value, currentGroup: 'НЕТ-ТАКОЙ' };
    expect(emptyReason.value).toBe('no-group-lessons');
    preferences.value = { ...preferences.value, currentGroup: 'ЛД-11' };
    actions.setFilter('day', 'Суббота');
    expect(emptyReason.value).toBe('no-lessons-today');
  });
});

describe('changes are scoped to what is on screen', () => {
  it('hides the section when the group did not change', () => {
    reset();
    expect(scopedChanges.value).toBeNull();
    actions.setChanges({
      fromVersion: 'W37',
      toVersion: 'W38',
      added: [
        {
          sheetId: 'СТ',
          day: 'Понедельник',
          time: '08:00-09:20',
          para: '1',
          group: 'СТ-22',
          subgroup: '',
          subject: 'Гигиена',
          teacher: '',
          room: '',
          type: 'lecture',
          isExam: false,
        },
      ],
      removed: [],
    });
    expect(scopedChanges.value).toBeNull();
  });

  it('shows the rows of the selected group', () => {
    actions.setChanges({
      fromVersion: 'W37',
      toVersion: 'W38',
      added: [
        {
          sheetId: 'ЛД',
          day: 'Понедельник',
          time: '12:00-13:20',
          para: '4',
          group: 'ЛД-11',
          subgroup: '',
          subject: 'Физика',
          teacher: '',
          room: '204',
          type: 'lecture',
          isExam: false,
        },
      ],
      removed: [],
    });
    expect(scopedChanges.value.added).toHaveLength(1);
  });
});

describe('net status', () => {
  it('merges a partial update', () => {
    reset();
    actions.setNetStatus({ browserOnline: false });
    expect(netStatus.value).toEqual({ browserOnline: false, loadFailed: false });
  });
});
