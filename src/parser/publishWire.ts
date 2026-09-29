/**
 * Wire shape of a published schedule record.
 *
 * This mirrors the `lessons` table row that the publish path writes, so the
 * browser parser projection and the offline Supabase oracle can share one
 * definition instead of drifting apart. It is a pure data contract: no
 * transport, no auth and no server-side logic belong here.
 */

/** One publishable schedule record (snake_case, as stored in the database). */
export interface PublishLessonV1 {
  sheet_id: string;
  day: string;
  day_order: number;
  time: string;
  para: string;
  group_code: string;
  subgroup: string | null;
  subject: string;
  type: string;
  teacher: string | null;
  room: string | null;
  is_exam: boolean;
}

/** Aggregate parser outcome for a whole workbook. */
export interface PublishReportV1 {
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  ignoredNonLessonCount: number;
}
