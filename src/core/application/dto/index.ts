/**
 * Data Transfer Objects - For crossing layer boundaries
 * Serializable, no behavior, pure data
 */
import type { Lesson, Sheet, Group, UserPreferences } from '@core/domain/entities/types';

/** Schedule response for UI */
export interface ScheduleDTO {
  sheets: Record<string, LessonDTO[]>;
  sheetsMeta: SheetDTO[];
  groups: Record<string, GroupDTO>;
  preferences: UserPreferencesDTO;
  version: string;
  updatedAt: string;
}

export interface LessonDTO {
  id: string;
  sheetId: string;
  day: string;
  dayOrder: number;
  time: string;
  para: string;
  group: string;
  subgroup: string;
  subject: string;
  type: string;
  teacher: string;
  room: string;
  isExam: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SheetDTO {
  id: string;
  name: string;
  order: number;
  lessonCount: number;
}

export interface GroupDTO {
  code: string;
  sheetId: string;
  lessonCount: number;
  subgroups: string[];
}

export interface UserPreferencesDTO {
  currentSheetId: string;
  currentGroup: string;
  activeSubgroup: string;
  hiddenSheets: string[];
}

export interface VersionDTO {
  version: string;
  updatedAt: string;
}

export interface PublishRequestDTO {
  lessons: Omit<LessonDTO, 'id' | 'createdAt' | 'updatedAt'>[];
}

export interface AuthDTO {
  isAdmin: boolean;
  user?: {
    id: string;
    email: string;
  };
}

/** Mappers between domain and DTO */
export function toScheduleDTO(data: {
  sheets: Map<string, Lesson[]>;
  sheetsMeta: Sheet[];
  groups: Map<string, Group>;
  preferences: UserPreferences;
  version: string;
  updatedAt: string;
}): ScheduleDTO {
  const sheetsObj: Record<string, LessonDTO[]> = {};
  for (const [sheetId, lessons] of data.sheets) {
    sheetsObj[sheetId] = lessons.map(toLessonDTO);
  }

  const groupsObj: Record<string, GroupDTO> = {};
  for (const [code, group] of data.groups) {
    groupsObj[code] = toGroupDTO(group);
  }

  return {
    sheets: sheetsObj,
    sheetsMeta: data.sheetsMeta.map(toSheetDTO),
    groups: groupsObj,
    preferences: toPreferencesDTO(data.preferences),
    version: data.version,
    updatedAt: data.updatedAt,
  };
}

export function toLessonDTO(lesson: Lesson): LessonDTO {
  return {
    id: lesson.id,
    sheetId: lesson.sheetId,
    day: lesson.day,
    dayOrder: lesson.dayOrder,
    time: lesson.time,
    para: lesson.para,
    group: lesson.group,
    subgroup: lesson.subgroup,
    subject: lesson.subject,
    type: lesson.type,
    teacher: lesson.teacher,
    room: lesson.room,
    isExam: lesson.isExam,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

export function toSheetDTO(sheet: Sheet): SheetDTO {
  return {
    id: sheet.id,
    name: sheet.name,
    order: sheet.order,
    lessonCount: sheet.lessonCount,
  };
}

export function toGroupDTO(group: Group): GroupDTO {
  return {
    code: group.code,
    sheetId: group.sheetId,
    lessonCount: group.lessonCount,
    subgroups: group.subgroups,
  };
}

export function toPreferencesDTO(prefs: UserPreferences): UserPreferencesDTO {
  return {
    currentSheetId: prefs.currentSheetId,
    currentGroup: prefs.currentGroup,
    activeSubgroup: prefs.activeSubgroup,
    hiddenSheets: prefs.hiddenSheets,
  };
}
