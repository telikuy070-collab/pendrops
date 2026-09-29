/**
 * Cell text semantics: what a single non-empty cell means.
 *
 * Everything in this module is derived from the file itself. No college name,
 * no sheet name and no week-specific constant is used: the same rules run on
 * any weekly workbook the parser is pointed at.
 */
import { norm } from '../text.js';
import { fieldExtractor } from './fieldExtractor.ts';
import { TYPE_IDS } from '../constants.js';

export interface CellPart {
  /** Part text, already normalised. */
  text: string;
  /**
   * 0-based index of this part inside the cell as authored.
   *
   * Empty fragments are dropped, so a trailing or doubled separator leaves a
   * gap in the sequence: `"A / / B"` yields parts 0 and 2. Provenance keeps
   * pointing at the real position in the cell rather than at the compacted one.
   */
  partIndex: number;
  /** Subgroup named by the part itself, e.g. `1` in `... гр.1 ...`. */
  ownSubgroup: string;
  /** Fields extracted from the part. */
  fields: ReturnType<typeof fieldExtractor.extractAll>;
}

/**
 * Explicit lesson-type keywords.
 *
 * Used both to decide whether a part states its own type (only then can a
 * cell be used to infer the type of other cells) and to keep a cell out of the
 * column/row type statistics.
 */
export const TYPE_KEYWORD_RE =
  /(?:^|[\s.,;:])(?:пр|практ|практика|семинар|сем|лаб|лабораторн|лек|лекц|лекция)(?=$|[\s.,;:])/i;

export function hasTypeKeyword(text: string): boolean {
  return TYPE_KEYWORD_RE.test(norm(text));
}

/**
 * Subgroup written inside the cell text.
 *
 * The subgroup in the header cell describes the COLUMN; when the cell itself
 * names a subgroup, the cell wins. Without this rule a cell such as
 * `Физика лаб. гр.1 ... / Физика лаб. гр.2 ...` would hand both halves to the
 * subgroup printed in the header and merge two different groups into one
 * indistinguishable record.
 */
const SUBGROUP_IN_TEXT_RE =
  /(?:^|[\s([])(?:гр|групп[аы]|подгрупп[аы]|субгрупп[аы]|subgroup)\s*\.?\s*№?\s*(\d{1,2})(?=$|[\s.,;:)])/i;

export function subgroupFromText(text: string): string {
  const match = norm(text).match(SUBGROUP_IN_TEXT_RE);
  return match?.[1] ?? '';
}

/** Words that carry a lesson: a subject is at least one alphabetic token. */
const ALPHABETIC_TOKEN_RE = /[\p{L}]{3,}/u;

export function hasAlphabeticToken(text: string): boolean {
  return ALPHABETIC_TOKEN_RE.test(norm(text));
}

/** Values of a field across parts, ignoring empties, for equality comparison. */
function distinctValues(
  parts: CellPart[],
  pick: (fields: CellPart['fields']) => string
): Set<string> {
  const values = new Set<string>();
  for (const part of parts) {
    const value = norm(pick(part.fields));
    if (value) values.add(value);
  }
  return values;
}

/**
 * Split a cell on the configured subgroup separator.
 *
 * A slash alone is NOT evidence of a boundary (item E): `ауд. 101/102` is one
 * room range, and a trailing or leading slash is formatting noise. The
 * separator only splits when the resulting halves really are different
 * lessons, which is decided by comparing rooms and teachers:
 *
 *  - halves without any alphabetic token (`102`) are not lessons, so the slash
 *    belongs to the room range and the cell stays whole;
 *  - halves that all share the same room AND the same teacher describe the same
 *    lesson, so the cell stays whole;
 *  - otherwise the halves are different lessons and the cell is split.
 */
export function splitCellParts(raw: string, separator = '/'): CellPart[] {
  const text = norm(raw);
  if (!text) return [];
  if (!separator) return [makePart(text, 0)];

  const chunks = text.split(separator);
  const candidates: CellPart[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = norm(chunks[index]);
    // A trailing slash ("... Э./") or a leading one ("/Фармацевтикалык ...")
    // produces an empty half. That half is not a cell and not a lesson, so it
    // contributes no outcome; dropping it here is what removes the old
    // `empty_cell_part` noise without losing any authored data. The ORIGINAL
    // index is kept so provenance still points at the authored position.
    if (!chunk) continue;
    candidates.push(makePart(chunk, index));
  }
  if (!candidates.length) return [];
  if (candidates.length === 1) return candidates;

  const lessonLike = candidates.filter((part) => hasAlphabeticToken(part.text));
  if (lessonLike.length < 2) {
    // Every half is a bare number or a single short token: this is a value
    // range such as "ауд. 101/102", not two lessons. The halves are rejoined
    // so the room extractor sees the whole range — splitting first would cut
    // "102" loose and leave it stranded in the subject.
    return [makePart(text, 0)];
  }

  const rooms = distinctValues(lessonLike, (fields) => fields.room?.value ?? '');
  const teachers = distinctValues(lessonLike, (fields) => fields.teacher?.value ?? '');
  if (rooms.size <= 1 && teachers.size <= 1) {
    // Same room and same teacher across all halves: the slash separated
    // fragments of one record, not two records.
    return [makePart(text, 0)];
  }

  return candidates;
}

function makePart(text: string, partIndex: number): CellPart {
  const normalised = norm(text);
  return {
    text: normalised,
    partIndex,
    ownSubgroup: subgroupFromText(normalised),
    fields: fieldExtractor.extractAll(normalised),
  };
}

/**
 * Dominant lesson type of a set of cells that state a type explicitly.
 *
 * Returned only when the winner is at least `threshold` of the sample, so a
 * single stray "лаб." in a column of lectures cannot flip the whole column.
 */
export function dominantType(
  types: string[],
  threshold = 0.8,
  minSamples = 3
): { type: string; share: number } | null {
  if (types.length < minSamples) return null;
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  if (!best) return null;
  const share = bestCount / types.length;
  return share >= threshold ? { type: best, share } : null;
}

/** Map a classifier answer onto a stored lesson type. */
export function typeOf(fields: CellPart['fields']): string {
  return fields.type?.value || TYPE_IDS.OTHER;
}

/**
 * Values that mark a cell as something other than a lesson.
 *
 * These are generic administrative markers of a schedule sheet (a signature
 * block addressed to a director, a totals line, a placeholder). They are
 * language-level patterns, not college-specific literals.
 */
const NON_LESSON_RE =
  /(?:^|[\s.,;:])(?:директор[а-я]*|ректор[а-я]*|проректор[а-я]*|заведующ[а-я]*|декан[а-я]*|начальник[а-я]*|утверждаю|согласовано|рассмотрено|подписал[а-я]*|подпись|м\s*\.?\s*п\s*\.?|мп|итого|всего|бардык|жашында|эскертүү|жазу|примечание|примеч|место| vacant|отсутствует)(?=$|[\s.,;:])/i;

/** Purely structural filler: no word at all, only digits and punctuation. */
const NON_ALPHABETIC_RE = /^[\d\s.,;:№\-()/]+$/;

export interface NonLessonVerdict {
  isNonLesson: boolean;
  /**
   * `administrative` — signature/total/placeholder wording;
   * `empty` — nothing there at all;
   * `none` — no positive evidence that this is not a lesson.
   */
  kind: 'administrative' | 'empty' | 'none';
  reason: string;
}

/**
 * Is this cell definitely not a lesson?
 *
 * Only a positive signal qualifies: administrative wording, or text with no
 * word in it at all. Anything else stays a lesson candidate, because a wrong
 * "this is not a lesson" verdict silently deletes a real entry.
 */
export function classifyNonLesson(text: string): NonLessonVerdict {
  const value = norm(text);
  if (!value) return { isNonLesson: true, kind: 'empty', reason: 'Пустая ячейка' };
  if (NON_ALPHABETIC_RE.test(value)) {
    return {
      isNonLesson: true,
      kind: 'empty',
      reason: 'Нет текста: только цифры и знаки',
    };
  }
  if (NON_LESSON_RE.test(value)) {
    return {
      isNonLesson: true,
      kind: 'administrative',
      reason: 'Служебная строка (подпись, итог, примечание)',
    };
  }
  return { isNonLesson: false, kind: 'none', reason: '' };
}
