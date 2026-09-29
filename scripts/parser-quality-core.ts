import type { ParseProvenance, ParseWorkbookResult } from '../src/parser/engine.ts';

export const CRITICAL_FIELDS = [
  'day',
  'time',
  'para',
  'group',
  'subject',
  'type',
  'isExam',
] as const;

export type CriticalField = (typeof CRITICAL_FIELDS)[number];

const RECORD_FIELDS = [...CRITICAL_FIELDS, 'subgroup', 'teacher', 'room'] as const;

export interface HumanReviewedRecord {
  provenance: ParseProvenance;
  lesson: Record<string, unknown>;
}

export interface FieldMetric {
  correct: number;
  total: number;
  accuracy: number;
}

export interface QualityMetrics {
  expected: number;
  actual: number;
  matchedRecords: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  recordAccuracy: number;
  precision: number;
  recall: number;
  criticalFields: number;
  fields: Record<CriticalField, FieldMetric>;
}

export interface QualityThresholds {
  recordAccuracy: number;
  precision: number;
  recall: number;
  criticalFields: number;
}

export interface OracleResolution<T> {
  status: 'resolved';
  value: T;
}

export interface BlockedOracleResolution {
  status: 'blocked';
  reason: string;
}

export type OracleReadResult<T> = OracleResolution<T> | BlockedOracleResolution;

export interface FixtureAvailabilityEntry {
  id: string;
  status: 'active' | 'blocked';
  blockedReason?: string;
}

export type FixtureAvailability = { status: 'active' } | { status: 'blocked'; reason: string };

export type QualityMode = 'gate' | 'report';
export type RunStatus = 'pass' | 'fail' | 'blocked';

export function canonicalText(value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}

export function provenanceKey(provenance: ParseProvenance): string {
  return JSON.stringify([
    provenance.sheetName,
    provenance.sourceRow,
    provenance.sourceColumn,
    provenance.partIndex,
  ]);
}

export function recordKey(record: Record<string, unknown>, sheetName: string): string {
  return JSON.stringify([sheetName, ...RECORD_FIELDS.map((field) => canonicalText(record[field]))]);
}

function emptyFieldMetric(): FieldMetric {
  return { correct: 0, total: 0, accuracy: 0 };
}

export function emptyMetrics(): QualityMetrics {
  return {
    expected: 0,
    actual: 0,
    matchedRecords: 0,
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    recordAccuracy: 0,
    precision: 0,
    recall: 0,
    criticalFields: 0,
    fields: Object.fromEntries(
      CRITICAL_FIELDS.map((field) => [field, emptyFieldMetric()])
    ) as Record<CriticalField, FieldMetric>,
  };
}

export function measure(
  expected: HumanReviewedRecord[],
  result: ParseWorkbookResult
): QualityMetrics {
  const actualRecords = Object.entries(result.sheets).flatMap(([sheetName, sheet]) =>
    sheet.accepted.map((outcome) => ({
      provenance: outcome.provenance,
      lesson: outcome.lesson as unknown as Record<string, unknown>,
    }))
  );
  const actualByProvenance = new Map<string, typeof actualRecords>();
  for (const actual of actualRecords) {
    const key = provenanceKey(actual.provenance);
    const records = actualByProvenance.get(key) ?? [];
    records.push(actual);
    actualByProvenance.set(key, records);
  }

  const metrics = emptyMetrics();
  metrics.expected = expected.length;
  metrics.actual = actualRecords.length;

  for (const oracleRecord of expected) {
    const key = provenanceKey(oracleRecord.provenance);
    const actual = actualByProvenance.get(key)?.shift();
    if (!actual) continue;

    metrics.matchedRecords += 1;
    if (
      recordKey(oracleRecord.lesson, oracleRecord.provenance.sheetName) ===
      recordKey(actual.lesson, actual.provenance.sheetName)
    ) {
      metrics.truePositive += 1;
    }

    for (const field of CRITICAL_FIELDS) {
      const fieldMetric = metrics.fields[field];
      fieldMetric.total += 1;
      if (canonicalText(oracleRecord.lesson[field]) === canonicalText(actual.lesson[field])) {
        fieldMetric.correct += 1;
      }
    }
  }

  metrics.falsePositive = metrics.actual - metrics.truePositive;
  metrics.falseNegative = metrics.expected - metrics.truePositive;
  metrics.recordAccuracy =
    Math.max(metrics.expected, metrics.actual) === 0
      ? 0
      : metrics.truePositive / Math.max(metrics.expected, metrics.actual);
  metrics.precision = metrics.actual === 0 ? 0 : metrics.truePositive / metrics.actual;
  metrics.recall = metrics.expected === 0 ? 0 : metrics.truePositive / metrics.expected;

  for (const fieldMetric of Object.values(metrics.fields)) {
    fieldMetric.accuracy = fieldMetric.total === 0 ? 0 : fieldMetric.correct / fieldMetric.total;
  }
  const criticalTotal = Object.values(metrics.fields).reduce(
    (sum, metric) => sum + metric.total,
    0
  );
  const criticalCorrect = Object.values(metrics.fields).reduce(
    (sum, metric) => sum + metric.correct,
    0
  );
  metrics.criticalFields = criticalTotal === 0 ? 0 : criticalCorrect / criticalTotal;

  return metrics;
}

export function passes(metrics: QualityMetrics, thresholds: QualityThresholds): boolean {
  return (
    metrics.recordAccuracy >= thresholds.recordAccuracy &&
    metrics.precision >= thresholds.precision &&
    metrics.recall >= thresholds.recall &&
    metrics.criticalFields >= thresholds.criticalFields
  );
}

export function addMetrics(target: QualityMetrics, current: QualityMetrics): QualityMetrics {
  const aggregate = emptyMetrics();
  aggregate.expected = target.expected + current.expected;
  aggregate.actual = target.actual + current.actual;
  aggregate.matchedRecords = target.matchedRecords + current.matchedRecords;
  aggregate.truePositive = target.truePositive + current.truePositive;
  aggregate.falsePositive = target.falsePositive + current.falsePositive;
  aggregate.falseNegative = target.falseNegative + current.falseNegative;

  for (const field of CRITICAL_FIELDS) {
    aggregate.fields[field] = {
      correct: target.fields[field].correct + current.fields[field].correct,
      total: target.fields[field].total + current.fields[field].total,
      accuracy: 0,
    };
  }

  aggregate.recordAccuracy =
    Math.max(aggregate.expected, aggregate.actual) === 0
      ? 0
      : aggregate.truePositive / Math.max(aggregate.expected, aggregate.actual);
  aggregate.precision = aggregate.actual === 0 ? 0 : aggregate.truePositive / aggregate.actual;
  aggregate.recall = aggregate.expected === 0 ? 0 : aggregate.truePositive / aggregate.expected;
  for (const fieldMetric of Object.values(aggregate.fields)) {
    fieldMetric.accuracy = fieldMetric.total === 0 ? 0 : fieldMetric.correct / fieldMetric.total;
  }
  const criticalTotal = Object.values(aggregate.fields).reduce(
    (sum, metric) => sum + metric.total,
    0
  );
  const criticalCorrect = Object.values(aggregate.fields).reduce(
    (sum, metric) => sum + metric.correct,
    0
  );
  aggregate.criticalFields = criticalTotal === 0 ? 0 : criticalCorrect / criticalTotal;
  return aggregate;
}

export function classifyFixture<T>(
  entry: FixtureAvailabilityEntry,
  sourceExists: boolean,
  oracle: OracleReadResult<T> | null
): FixtureAvailability {
  if (entry.status === 'blocked') {
    return { status: 'blocked', reason: entry.blockedReason || 'Fixture is explicitly blocked' };
  }
  if (!sourceExists) {
    return { status: 'blocked', reason: 'Source workbook is missing' };
  }
  if (!oracle) {
    return { status: 'blocked', reason: 'Human-reviewed oracle is missing' };
  }
  if (oracle.status === 'blocked') {
    return { status: 'blocked', reason: oracle.reason };
  }
  return { status: 'active' };
}

export function runStatus(options: {
  mode: QualityMode;
  activeFixtureCount: number;
  blockedFixtureCount: number;
  activeMetrics: QualityMetrics[];
  thresholds: QualityThresholds;
}): { status: RunStatus; exitCode: number } {
  const qualityFailed = options.activeMetrics.some(
    (metrics) => !passes(metrics, options.thresholds)
  );
  const status: RunStatus =
    options.activeFixtureCount === 0 || options.blockedFixtureCount > 0
      ? 'blocked'
      : qualityFailed
        ? 'fail'
        : 'pass';
  const exitCode = options.mode === 'gate' && status !== 'pass' ? 1 : 0;
  return { status, exitCode };
}
