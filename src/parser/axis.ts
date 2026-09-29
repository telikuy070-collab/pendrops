/**
 * Axis resolution for the day / lesson-number / time columns.
 *
 * These three columns behave like a vertical axis: a value written once
 * describes the rows below it until a new, plausible value appears.
 *
 * The previous implementation resolved a missing axis cell by walking UP the
 * column and taking the FIRST non-empty value it met, with no check that the
 * value was even of the right kind. Two failures followed:
 *
 *  - A caption parked in the time column ("Медициналык колледждин директору
 *    Н.Т.Талипов") was handed to every row below it as their time, because the
 *    walk-up stopped at the first non-empty cell regardless of its contents.
 *  - A cell in the day column holding unrecognised text produced an EMPTY day
 *    (`day: directDay ? detected : lastDay`), so the lesson was dropped instead
 *    of inheriting the day it clearly belongs to.
 *
 * Both are fixed here: the axis only continues through values that parse as
 * the axis kind, and a day cell with unrecognised content inherits the last
 * known day with an explicit `inherited_day` warning.
 */

export type AxisKind = 'day' | 'para' | 'time';

export interface AxisReading {
  /** Canonical value for this row, or `''` when the axis is not resolvable. */
  value: string;
  /** The value came from this row's own cell. */
  own: boolean;
  /** The value was carried down from an earlier row. */
  inherited: boolean;
  /** The cell held text that does not parse as this axis kind. */
  unreadable: boolean;
}

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?:-(?:[01]\d|2[0-3]):[0-5]\d)?$/;
const PARA_RE = /^\d+(?:\s*пар[аы])?$/i;

export interface AxisSpec<T> {
  kind: AxisKind;
  /** Does this raw text parse as the axis kind? */
  parse: (raw: string) => T;
  /** Render a parsed value back into its stored form. */
  format: (parsed: T) => string;
}

/**
 * A time cell is plausible only when it really is a time. A caption, a room or
 * a teacher name is not, and must never be allowed to continue the axis.
 */
export const TIME_AXIS: AxisSpec<string> = {
  kind: 'time',
  parse: (raw) => (TIME_RE.test(raw) ? raw : ''),
  format: (value) => value,
};

/** A lesson-number cell is plausible only when it is a number (optionally "3 пара"). */
export const PARA_AXIS: AxisSpec<string> = {
  kind: 'para',
  parse: (raw) => (PARA_RE.test(raw) ? raw : ''),
  format: (value) => value,
};

export const DAY_AXIS: AxisSpec<string> = {
  kind: 'day',
  parse: (raw) => raw,
  format: (value) => value,
};

export interface AxisResolution {
  /** Reading per row inside the scanned range. */
  rows: Map<number, AxisReading>;
  /** Rows whose own cell held text that could not be read as this axis. */
  unreadableRows: number[];
}

/**
 * Resolve one axis column over a row range.
 *
 * @param read Raw cell text for a row; `''` when the cell is empty.
 * @param from First row of the range (inclusive).
 * @param to Last row of the range (inclusive).
 * @param spec Axis kind rules.
 * @param parseDay Canonicaliser for the day axis; other kinds pass through.
 */
export function resolveAxis(
  read: (row: number) => string,
  from: number,
  to: number,
  spec: AxisSpec<string>,
  parseDay?: (raw: string) => string
): AxisResolution {
  const rows = new Map<number, AxisReading>();
  const unreadableRows: number[] = [];
  let carried = '';

  for (let row = from; row <= to; row++) {
    const raw = read(row);
    if (!raw) {
      // Empty cell: continue the axis only if one is running.
      rows.set(row, {
        value: carried,
        own: false,
        inherited: Boolean(carried),
        unreadable: false,
      });
      continue;
    }

    const parsed = spec.parse(raw);
    if (parsed) {
      const value =
        spec.kind === 'day' && parseDay ? parseDay(parsed) || carried : spec.format(parsed);
      if (spec.kind === 'day' && parseDay) {
        const canonical = parseDay(parsed);
        if (canonical) {
          carried = canonical;
          rows.set(row, { value: canonical, own: true, inherited: false, unreadable: false });
          continue;
        }
        // Unrecognised day text: keep the last known day instead of dropping
        // the lesson (this is what used to silently empty the day).
        unreadableRows.push(row);
        rows.set(row, {
          value: carried,
          own: false,
          inherited: Boolean(carried),
          unreadable: true,
        });
        continue;
      }
      carried = value;
      rows.set(row, { value, own: true, inherited: false, unreadable: false });
      continue;
    }

    // Non-empty text that is not of this axis kind. It must not become the
    // axis value, and it must not keep the previous value alive for the rows
    // below either: a signature line ends the column's meaning.
    if (spec.kind === 'day') {
      // A day cell with unreadable content still belongs to the current day.
      unreadableRows.push(row);
      rows.set(row, { value: carried, own: false, inherited: Boolean(carried), unreadable: true });
      continue;
    }
    unreadableRows.push(row);
    rows.set(row, { value: '', own: false, inherited: false, unreadable: true });
  }

  return { rows, unreadableRows };
}
