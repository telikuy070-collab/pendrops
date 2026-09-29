/**
 * Publish draft projection.
 *
 * Single source of truth for turning a canonical `ParseWorkbookResult` into the
 * wire shape that `publish-schedule` persists (`PublishLessonV1`). Both the
 * browser parser adapter and the offline Supabase oracle use this module, so
 * the oracle can never drift from what the app actually publishes.
 *
 * Kept free of path aliases and DOM globals on purpose: it must load in Node
 * (vitest / vite-node) as well as in the browser bundle.
 */
import type { ParseWorkbookResult, ParsedLesson } from './engine.ts';
import type { PublishLessonV1, PublishReportV1 } from './publishWire.ts';

/** day -> sort index, mirroring `src/constants.js` DAY_ORDER. */
export const DAY_ORDER_LOOKUP: Readonly<Record<string, number>> = {
  Понедельник: 0,
  Вторник: 1,
  Среда: 2,
  Четверг: 3,
  Пятница: 4,
  Суббота: 5,
  Воскресенье: 6,
};

/** Diagnostic capped the same way for every caller (admin modal, oracle). */
export const MAX_REPORTED_DIAGNOSTICS = 5;

export interface PublishDraftProjection {
  lessons: PublishLessonV1[];
  report: PublishReportV1;
}

/** One accepted parser outcome as a publishable wire record. */
export function toPublishLesson(sheetId: string, lesson: ParsedLesson): PublishLessonV1 {
  return {
    sheet_id: sheetId,
    day: lesson.day as PublishLessonV1['day'],
    day_order: DAY_ORDER_LOOKUP[lesson.day] ?? 0,
    time: lesson.time,
    para: lesson.para,
    group_code: lesson.group,
    subgroup: lesson.subgroup ? lesson.subgroup : null,
    subject: lesson.subject,
    type: lesson.type,
    teacher: lesson.teacher ? lesson.teacher : null,
    room: lesson.room ? lesson.room : null,
    is_exam: lesson.isExam === true,
  };
}

/** Flatten a workbook parse into the publishable draft plus its report. */
export function toPublishDraft(parsed: ParseWorkbookResult): PublishDraftProjection {
  const lessons: PublishLessonV1[] = [];

  for (const [sheetName, sheet] of Object.entries(parsed.sheets)) {
    for (const outcome of sheet.accepted) {
      lessons.push(toPublishLesson(sheetName, outcome.lesson));
    }
  }

  return {
    lessons,
    report: {
      candidateCount: parsed.report.candidateCount,
      acceptedCount: parsed.report.acceptedCount,
      rejectedCount: parsed.report.rejectedCount,
      ignoredNonLessonCount: parsed.report.ignoredNonLessonCount,
    },
  };
}
