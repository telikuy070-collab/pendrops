import { describe, expect, it } from 'vitest';
import {
  goToMySchedule,
  hasSavedGroup,
  isBrowsingOtherGroup,
  migrateMySelectionPrefs,
  mySelection,
  rememberAsMySchedule,
  resolveStartScreen,
} from '../../src/core/domain/onboarding';

const prefs = (over = {}) => ({
  currentSheetId: '',
  currentGroup: '',
  activeSubgroup: '',
  hiddenSheets: [],
  ...over,
});

describe('resolveStartScreen', () => {
  it('waits while the first load is running', () => {
    expect(
      resolveStartScreen({
        loading: true,
        hasSchedule: false,
        hasSavedGroup: false,
        skipped: false,
      })
    ).toBe('loading');
  });

  it('asks for a group once when a schedule arrived and none is remembered', () => {
    expect(
      resolveStartScreen({
        loading: false,
        hasSchedule: true,
        hasSavedGroup: false,
        skipped: false,
      })
    ).toBe('onboarding');
  });

  it('opens the schedule straight away for a remembered group', () => {
    expect(
      resolveStartScreen({ loading: false, hasSchedule: true, hasSavedGroup: true, skipped: false })
    ).toBe('schedule');
  });

  it('respects the "посмотреть всё расписание" escape hatch', () => {
    expect(
      resolveStartScreen({ loading: false, hasSchedule: true, hasSavedGroup: false, skipped: true })
    ).toBe('schedule');
  });

  it('never shows the chooser without a schedule to choose from', () => {
    expect(
      resolveStartScreen({
        loading: false,
        hasSchedule: false,
        hasSavedGroup: false,
        skipped: false,
      })
    ).toBe('schedule');
  });
});

describe('my schedule selection', () => {
  it('does not invent a remembered group out of the current one', () => {
    // Pre-migration preferences must not pass for a remembered selection:
    // doing so makes "my schedule" unreachable and browsing destructive.
    const stored = prefs({ currentSheetId: 'ЛД', currentGroup: 'ЛД-11', activeSubgroup: '2' });
    expect(mySelection(stored)).toEqual({ sheetId: '', group: '', subgroup: '' });
    expect(hasSavedGroup(stored)).toBe(false);
    expect(goToMySchedule(stored)).toEqual({});
  });

  it('remembers a group separately from the one being browsed', () => {
    const stored = prefs({
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      mySubgroup: '',
      currentSheetId: 'Стоматология',
      currentGroup: 'СТ-22',
      activeSubgroup: '',
    });
    expect(isBrowsingOtherGroup(stored)).toBe(true);
    expect(goToMySchedule(stored)).toEqual({
      currentSheetId: 'ЛД',
      currentGroup: 'ЛД-11',
      activeSubgroup: '',
    });
  });

  it('does not consider the subgroup change a switch to another group', () => {
    const stored = prefs({
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      mySubgroup: '1',
      currentSheetId: 'ЛД',
      currentGroup: 'ЛД-11',
      activeSubgroup: '2',
    });
    expect(isBrowsingOtherGroup(stored)).toBe(false);
  });

  it('has nothing to go back to before a group is ever chosen', () => {
    const stored = prefs({ currentSheetId: 'ЛД' });
    expect(hasSavedGroup(stored)).toBe(false);
    expect(goToMySchedule(stored)).toEqual({});
  });

  it('captures the current selection when it becomes the remembered one', () => {
    const stored = prefs({ currentSheetId: 'ЛД', currentGroup: 'ЛД-11', activeSubgroup: '1' });
    expect(rememberAsMySchedule(stored)).toEqual({
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      mySubgroup: '1',
    });
  });
});

describe('migration of preferences stored before "my schedule"', () => {
  it('promotes the current selection of an existing install', () => {
    const stored = prefs({ currentSheetId: 'ЛД', currentGroup: 'ЛД-11', activeSubgroup: '2' });
    expect(migrateMySelectionPrefs(stored)).toEqual({
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      mySubgroup: '2',
    });
  });

  it('leaves preferences that already have a remembered group alone', () => {
    const stored = prefs({
      mySheetId: 'ЛД',
      myGroup: 'ЛД-11',
      mySubgroup: '1',
      currentSheetId: 'Стоматология',
      currentGroup: 'СТ-22',
    });
    expect(migrateMySelectionPrefs(stored)).toBeNull();
  });

  it('leaves a browsing sheet without a group for the first explicit choice', () => {
    expect(migrateMySelectionPrefs(prefs({ currentSheetId: 'ЛД' }))).toBeNull();
  });

  it('leaves a fresh install empty', () => {
    expect(migrateMySelectionPrefs(prefs())).toBeNull();
  });

  it('is idempotent once the patch has been written back', () => {
    const stored = prefs({ currentSheetId: 'ЛД', currentGroup: 'ЛД-11', activeSubgroup: '2' });
    const patch = migrateMySelectionPrefs(stored);
    const migrated = prefs({ ...stored, ...patch });
    expect(migrateMySelectionPrefs(migrated)).toBeNull();
    expect(migrated.myGroup).toBe('ЛД-11');
  });

  it('keeps browsing another group from overwriting the own one after migrating', () => {
    const beforeMigration = prefs({
      currentSheetId: 'ЛД',
      currentGroup: 'ЛД-11',
      activeSubgroup: '2',
    });
    const patch = migrateMySelectionPrefs(beforeMigration);
    const migrated = prefs({ ...beforeMigration, ...patch });

    // What the group picker writes when another group is chosen afterwards.
    const browsing = prefs({ ...migrated, currentGroup: 'СТ-22', activeSubgroup: '' });
    expect(isBrowsingOtherGroup(browsing)).toBe(true);
    expect(goToMySchedule(browsing)).toEqual({
      currentSheetId: 'ЛД',
      currentGroup: 'ЛД-11',
      activeSubgroup: '2',
    });
    // The own group is still the one that was captured.
    expect(migrated.myGroup).toBe('ЛД-11');
  });
});
