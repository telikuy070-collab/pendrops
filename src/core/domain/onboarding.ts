/**
 * Start screen and "my schedule" selection.
 *
 * The app has exactly three states and no new screen hierarchy:
 * - loading   — nothing to decide yet;
 * - schedule  — the student has a group, or explicitly skipped the chooser;
 * - onboarding— a schedule is available but the student has never picked a
 *               group, so one short chooser is shown once instead of an
 *               empty list that looks broken.
 */
import type { UserPreferences } from './entities/types';

export type StartScreen = 'loading' | 'schedule' | 'onboarding';

export interface StartScreenInput {
  loading: boolean;
  /** A schedule is on screen (cached or freshly loaded). */
  hasSchedule: boolean;
  /** The remembered selection contains a group. */
  hasSavedGroup: boolean;
  /** The student asked to look at the whole timetable for now. */
  skipped: boolean;
}

export function resolveStartScreen(input: StartScreenInput): StartScreen {
  if (input.loading) return 'loading';
  if (input.skipped) return 'schedule';
  if (!input.hasSchedule) return 'schedule';
  return input.hasSavedGroup ? 'schedule' : 'onboarding';
}

/** The selection that belongs to this student, however they got there. */
export interface MySelection {
  sheetId: string;
  group: string;
  subgroup: string;
}

/**
 * The remembered selection.
 *
 * Read strictly: preferences stored before the "my schedule" feature exist
 * only until {@link migrateMySelectionPrefs} has promoted their current
 * selection once. Without that migration a fallback here would make
 * `isBrowsingOtherGroup` permanently false for those installs, so browsing
 * another group would silently overwrite the student's own group instead of
 * offering a way back.
 */
export function mySelection(prefs: UserPreferences): MySelection {
  return {
    sheetId: prefs.mySheetId || '',
    group: prefs.myGroup || '',
    subgroup: prefs.mySubgroup || '',
  };
}

/**
 * One-off promotion of the current selection to the remembered one.
 *
 * Returns the patch to persist, or `null` when there is nothing to do: the
 * field is already stored, or no group was ever selected. The caller writes the
 * patch back to `user_prefs`, which makes the promotion idempotent — the
 * second call sees `myGroup` present and returns `null`.
 */
export function migrateMySelectionPrefs(prefs: UserPreferences): Partial<UserPreferences> | null {
  if (prefs.myGroup) return null;
  // A sheet without a group is a browsing state, not an own group: promoting
  // it would suppress the first-choice capture that still has to happen.
  if (!prefs.currentGroup) return null;
  return {
    mySheetId: prefs.currentSheetId || '',
    myGroup: prefs.currentGroup || '',
    mySubgroup: prefs.activeSubgroup || '',
  };
}

export function hasSavedGroup(prefs: UserPreferences): boolean {
  return mySelection(prefs).group !== '';
}

/** True while the student looks at somebody else's group. */
export function isBrowsingOtherGroup(prefs: UserPreferences): boolean {
  const mine = mySelection(prefs);
  if (!mine.group) return false;
  return mine.group !== (prefs.currentGroup || '') || mine.sheetId !== (prefs.currentSheetId || '');
}

/** The patch that brings the view back to the remembered selection. */
export function goToMySchedule(prefs: UserPreferences): Partial<UserPreferences> {
  const mine = mySelection(prefs);
  if (!mine.group) return {};
  return {
    currentSheetId: mine.sheetId,
    currentGroup: mine.group,
    activeSubgroup: mine.subgroup,
  };
}

/** The patch that marks the current selection as the remembered one. */
export function rememberAsMySchedule(prefs: UserPreferences): Partial<UserPreferences> {
  return {
    mySheetId: prefs.currentSheetId || '',
    myGroup: prefs.currentGroup || '',
    mySubgroup: prefs.activeSubgroup || '',
  };
}
