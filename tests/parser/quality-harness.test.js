import { describe, expect, it } from 'vitest';
import { ParserEngine } from '../../src/parser/engine.ts';
import {
  addMetrics,
  classifyFixture,
  emptyMetrics,
  measure,
  runStatus,
} from '../../scripts/parser-quality-core.ts';

const thresholds = {
  recordAccuracy: 0.95,
  precision: 0.95,
  recall: 0.95,
  criticalFields: 1,
};

function parseResult() {
  const sheet = new ParserEngine().parseSheetRowsDetailed(
    [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)'],
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.'],
      ['Вторник', '2', '09:30-10:50', 'Химия лекция ауд. 102 Борисов Б.'],
    ],
    'ПСТ'
  );
  return {
    sheets: { ПСТ: sheet },
    report: {
      sheetCount: 1,
      candidateCount: sheet.stats.candidateCount,
      acceptedCount: sheet.stats.acceptedCount,
      rejectedCount: sheet.stats.rejectedCount,
      ignoredNonLessonCount: sheet.stats.ignoredNonLessonCount,
    },
  };
}

describe('parser quality harness', () => {
  it('compares critical fields with matched human-reviewed oracle records', () => {
    const result = parseResult();
    const expected = result.sheets.ПСТ.accepted.map((outcome) => ({
      provenance: outcome.provenance,
      lesson: { ...outcome.lesson },
    }));
    expected[1].lesson.subject = 'Физика';

    const metrics = measure(expected, result);

    expect(metrics).toMatchObject({
      expected: 2,
      actual: 2,
      matchedRecords: 2,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      recordAccuracy: 0.5,
      precision: 0.5,
      recall: 0.5,
      criticalFields: 13 / 14,
    });
    expect(metrics.fields.subject).toEqual({ correct: 1, total: 2, accuracy: 0.5 });
    expect(metrics.fields.day).toEqual({ correct: 2, total: 2, accuracy: 1 });
  });

  it('aggregates field metrics by comparison count', () => {
    const result = parseResult();
    const exact = measure(
      result.sheets.ПСТ.accepted.map((outcome) => ({
        provenance: outcome.provenance,
        lesson: { ...outcome.lesson },
      })),
      result
    );
    const aggregate = addMetrics(exact, exact);

    expect(aggregate).toMatchObject({
      expected: 4,
      actual: 4,
      matchedRecords: 4,
      truePositive: 4,
      recordAccuracy: 1,
      precision: 1,
      recall: 1,
      criticalFields: 1,
    });
    expect(aggregate.fields.subject).toEqual({ correct: 4, total: 4, accuracy: 1 });
  });

  it.each([
    [
      'blocked fixture',
      { id: 'blocked', status: 'blocked' },
      true,
      { status: 'resolved', value: {} },
      'Fixture is explicitly blocked',
    ],
    [
      'missing source',
      { id: 'missing-source', status: 'active' },
      false,
      null,
      'Source workbook is missing',
    ],
    [
      'missing oracle',
      { id: 'missing-oracle', status: 'active' },
      true,
      null,
      'Human-reviewed oracle is missing',
    ],
    [
      'hash mismatch',
      { id: 'hash-mismatch', status: 'active' },
      true,
      { status: 'blocked', reason: 'Oracle source SHA-256 does not match the workbook' },
      'Oracle source SHA-256 does not match the workbook',
    ],
  ])('fails the gate but reports %s as blocked', (_name, entry, sourceExists, oracle, reason) => {
    const availability = classifyFixture(entry, sourceExists, oracle);

    expect(availability).toEqual({ status: 'blocked', reason });
    expect(
      runStatus({
        mode: 'gate',
        activeFixtureCount: 0,
        blockedFixtureCount: 1,
        activeMetrics: [],
        thresholds,
      }).exitCode
    ).toBe(1);
    expect(
      runStatus({
        mode: 'report',
        activeFixtureCount: 0,
        blockedFixtureCount: 1,
        activeMetrics: [],
        thresholds,
      }).exitCode
    ).toBe(0);
  });

  it('allows report mode but not gate mode when no active oracle exists', () => {
    const options = {
      activeFixtureCount: 0,
      blockedFixtureCount: 0,
      activeMetrics: [],
      thresholds,
    };

    expect(runStatus({ ...options, mode: 'gate' })).toEqual({ status: 'blocked', exitCode: 1 });
    expect(runStatus({ ...options, mode: 'report' })).toEqual({ status: 'blocked', exitCode: 0 });
  });

  it('passes a complete gate with active oracle metrics', () => {
    const result = parseResult();
    const metrics = measure(
      result.sheets.ПСТ.accepted.map((outcome) => ({
        provenance: outcome.provenance,
        lesson: { ...outcome.lesson },
      })),
      result
    );

    expect(
      runStatus({
        mode: 'gate',
        activeFixtureCount: 1,
        blockedFixtureCount: 0,
        activeMetrics: [metrics],
        thresholds,
      })
    ).toEqual({ status: 'pass', exitCode: 0 });
    expect(emptyMetrics().recordAccuracy).toBe(0);
  });
});
