/**
 * Supabase oracle comparison core.
 *
 * Compares a parser draft against the authoritative `lessons` table that the
 * `publish-schedule` RPC wrote in production. Pure functions only: no Supabase
 * client, no filesystem, no console. The transport lives in
 * `scripts/oracle-supabase.ts`.
 *
 * Disclosure rules enforced here:
 * - comparison works on counts and ratios only;
 * - no helper in this module returns or formats a single schedule row, so a
 *   caller cannot accidentally print subjects, teachers or rooms.
 */
import type { PublishLessonV1 } from '../src/parser/publishWire.ts';

/**
 * Critical fields for the record-level comparison. `day_order` is derived from
 * `day` on both sides and is therefore covered by it; `sheet_id` is treated as
 * the slot namespace rather than a per-record value.
 */
export const ORACLE_CRITICAL_FIELDS = [
  'day',
  'time',
  'para',
  'group_code',
  'subject',
  'type',
  'is_exam',
] as const;

export type OracleCriticalField = (typeof ORACLE_CRITICAL_FIELDS)[number];

/** A `lessons` row as stored by the RPC (only the compared columns). */
export interface OracleRow {
  sheet_id: string | null;
  day: string;
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

export interface OracleThresholds {
  recordAccuracy: number;
  precision: number;
  recall: number;
  criticalFields: number;
}

export interface OracleFieldMetric {
  correct: number;
  total: number;
  accuracy: number;
}

export interface OracleMetrics {
  /** Rows in the production table. */
  expected: number;
  /** Records produced by the parser. */
  actual: number;
  /** Slot keys present in both sides. */
  matched: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  recordAccuracy: number;
  precision: number;
  recall: number;
  criticalFields: number;
  fields: Record<OracleCriticalField, OracleFieldMetric>;
}

/** Acceptance criteria for promoting a fixture to `active`. */
export const ORACLE_THRESHOLDS: OracleThresholds = Object.freeze({
  recordAccuracy: 0.95,
  precision: 0.95,
  recall: 0.95,
  criticalFields: 1,
});

/** NFC-normalised comparison text, matching the RPC's `normalizeText`. */
export function oracleText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return String(value);
  return String(value).normalize('NFC').trim();
}

/**
 * Slot key: the grid coordinates that identify one cell.
 *
 * Deliberately excludes `subject`/`type`/`is_exam` so that a parser reading the
 * wrong lesson body is scored as a field error rather than as a record
 * mismatch, and excludes the compared fields themselves.
 */
export function slotKey(record: {
  sheet_id?: string | null;
  day: string;
  time: string;
  para: string;
  group_code: string;
  subgroup?: string | null;
}): string {
  return JSON.stringify([
    oracleText(record.sheet_id),
    oracleText(record.day),
    oracleText(record.time),
    oracleText(record.para),
    oracleText(record.group_code),
    oracleText(record.subgroup),
  ]);
}

function emptyFieldMetric(): OracleFieldMetric {
  return { correct: 0, total: 0, accuracy: 0 };
}

export function emptyOracleMetrics(): OracleMetrics {
  return {
    expected: 0,
    actual: 0,
    matched: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    recordAccuracy: 0,
    precision: 0,
    recall: 0,
    criticalFields: 0,
    fields: Object.fromEntries(
      ORACLE_CRITICAL_FIELDS.map((field) => [field, emptyFieldMetric()])
    ) as Record<OracleCriticalField, OracleFieldMetric>,
  };
}

function ratio(correct: number, total: number): number {
  return total === 0 ? 0 : correct / total;
}

/**
 * Multiset comparison of a parser draft against production rows.
 *
 * Records are aligned by slot key, so duplicated slots are consumed pairwise
 * instead of collapsing.
 */
export function measureAgainstOracle(
  draft: readonly PublishLessonV1[],
  rows: readonly OracleRow[]
): OracleMetrics {
  const metrics = emptyOracleMetrics();
  metrics.actual = draft.length;
  metrics.expected = rows.length;

  const remaining = new Map<string, OracleRow[]>();
  for (const row of rows) {
    const key = slotKey(row as unknown as PublishLessonV1);
    const bucket = remaining.get(key);
    if (bucket) bucket.push(row);
    else remaining.set(key, [row]);
  }

  for (const lesson of draft) {
    const key = slotKey(lesson);
    const bucket = remaining.get(key);
    if (!bucket || bucket.length === 0) continue;

    const row = bucket.shift()!;
    metrics.matched += 1;

    let allEqual = true;
    for (const field of ORACLE_CRITICAL_FIELDS) {
      const metric = metrics.fields[field];
      metric.total += 1;
      const expectedValue = oracleText((row as unknown as Record<string, unknown>)[field]);
      const actualValue = oracleText((lesson as unknown as Record<string, unknown>)[field]);
      if (expectedValue === actualValue) metric.correct += 1;
      else allEqual = false;
    }
    if (allEqual) metrics.truePositive += 1;
  }

  metrics.falsePositive = metrics.actual - metrics.matched;
  metrics.falseNegative = metrics.expected - metrics.matched;
  metrics.recordAccuracy = ratio(metrics.matched, Math.max(metrics.expected, metrics.actual));
  metrics.precision = ratio(metrics.matched, metrics.actual);
  metrics.recall = ratio(metrics.matched, metrics.expected);

  let correct = 0;
  let total = 0;
  for (const field of ORACLE_CRITICAL_FIELDS) {
    const metric = metrics.fields[field];
    metric.accuracy = ratio(metric.correct, metric.total);
    correct += metric.correct;
    total += metric.total;
  }
  metrics.criticalFields = ratio(correct, total);

  return metrics;
}

export function oraclePasses(
  metrics: OracleMetrics,
  thresholds: OracleThresholds = ORACLE_THRESHOLDS
): boolean {
  return (
    metrics.recordAccuracy >= thresholds.recordAccuracy &&
    metrics.precision >= thresholds.precision &&
    metrics.recall >= thresholds.recall &&
    metrics.criticalFields >= thresholds.criticalFields
  );
}

/**
 * Builds human-reviewable oracle records whose VALUES come from the production
 * table, keyed by the parser's grid coordinates.
 *
 * `lessons` stores no provenance, so the coordinates necessarily come from the
 * parser. The lesson payload does not: it is copied from the authoritative row
 * found at the same slot. A parser that mis-reads a subject therefore fails the
 * field metric against the production value instead of confirming itself.
 */
export function buildOracleRecords(
  draft: ReadonlyArray<PublishLessonV1>,
  rows: readonly OracleRow[],
  provenanceOf: (index: number) => {
    sheetName: string;
    sourceRow: number;
    sourceColumn: number;
    partIndex: number;
  }
): Array<{ provenance: ReturnType<typeof provenanceOf>; lesson: Record<string, unknown> }> {
  const bySlot = new Map<string, OracleRow[]>();
  for (const row of rows) {
    const key = slotKey(row as unknown as PublishLessonV1);
    const bucket = bySlot.get(key);
    if (bucket) bucket.push(row);
    else bySlot.set(key, [row]);
  }

  const records: Array<{
    provenance: ReturnType<typeof provenanceOf>;
    lesson: Record<string, unknown>;
  }> = [];

  draft.forEach((lesson, index) => {
    const bucket = bySlot.get(slotKey(lesson));
    if (!bucket || bucket.length === 0) return;
    const row = bucket.shift()!;
    records.push({
      provenance: provenanceOf(index),
      // Oracle payload uses the parser's field names so the fixture gate's
      // `measure()` can compare them directly.
      lesson: {
        day: oracleText(row.day),
        time: oracleText(row.time),
        para: oracleText(row.para),
        group: oracleText(row.group_code),
        subgroup: oracleText(row.subgroup),
        subject: oracleText(row.subject),
        type: oracleText(row.type),
        teacher: oracleText(row.teacher),
        room: oracleText(row.room),
        isExam: row.is_exam === true,
      },
    });
  });

  return records;
}

/** Percentages for human-readable aggregate output. */
export function oracleMetricsText(metrics: OracleMetrics): string {
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
  const fields = ORACLE_CRITICAL_FIELDS.map(
    (field) =>
      `${field}=${pct(metrics.fields[field].accuracy)}(${metrics.fields[field].correct}/${metrics.fields[field].total})`
  ).join(' ');
  return (
    `recordAccuracy=${pct(metrics.recordAccuracy)} ` +
    `precision=${pct(metrics.precision)} recall=${pct(metrics.recall)} ` +
    `critical=${pct(metrics.criticalFields)} ` +
    `expected=${metrics.expected} actual=${metrics.actual} matched=${metrics.matched} ` +
    `falsePositive=${metrics.falsePositive} falseNegative=${metrics.falseNegative}\n` +
    `  critical-fields ${fields}`
  );
}
