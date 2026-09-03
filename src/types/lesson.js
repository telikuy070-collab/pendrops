/**
 * Lesson schema — validated via Zod on parse.
 *
 * The schedule parser outputs Lesson objects. Every field is validated here
 * so that malformed Excel data can't produce broken UI state.
 *
 * Note: Although this file uses JSDoc + Zod (works in plain JS), it's
 * structured so that migrating to TypeScript later only requires renaming
 * the file to `.ts` and adding `export type Lesson = z.infer<typeof LessonSchema>`.
 */
import { z } from 'zod';

// Re-use the TYPE_IDS enum values from constants
import { TYPE_IDS } from '../constants.js';

/** @typedef {z.infer<typeof LessonSchema>} Lesson */

/**
 * The Lesson schema. Fields are intentionally strict:
 * - time must match "HH:MM-HH:MM"
 * - type must be one of the known TYPE_IDS
 * - isExam defaults to false
 */
export const LessonSchema = z.object({
  day: z.string().min(1, 'day required'),
  // Accept "08:00-09:20" or "08:00" — single time is valid (no end).
  time: z.string().min(1, 'time required'),
  para: z.string().min(1, 'para required'),
  group: z.string().min(1, 'group required'),
  subgroup: z.string().optional(),
  subject: z.string().min(1, 'subject required'),
  type: z
    .enum([TYPE_IDS.LECTURE, TYPE_IDS.PRACTICE, TYPE_IDS.LAB, TYPE_IDS.OTHER])
    .catch(TYPE_IDS.OTHER),
  teacher: z.string().optional(),
  room: z.string().optional(),
  isExam: z.preprocess((v) => v === true || v === 'true' || v === 1, z.boolean().default(false)),
  /**
   * Internal: parsed time cache, populated lazily by the view layer.
   * Not validated strictly — it's derived data.
   */
  _parsed: z
    .object({
      start: z.number(),
      end: z.number().nullable(),
    })
    .nullable()
    .optional(),
});

/** Convenience: parse a single lesson object */
export function parseLesson(obj) {
  return LessonSchema.parse(obj);
}

/** Convenience: parse an array of lessons, filtering out invalid entries */
export function parseLessons(arr) {
  const out = [];
  for (const l of arr) {
    try {
      out.push(LessonSchema.parse(l));
    } catch {
      // Silently skip invalid lessons — they'd cause UI errors downstream
      // In production you may want to log this
    }
  }
  return out;
}
