import { describe, expect, it } from 'vitest';
import {
  buildPreviewView,
  formatCount,
  formatCoverage,
  formatDays,
} from '../../src/admin/preview.ts';
import { diffSchedules } from '../../src/admin/diff.ts';

function lesson(sheetId = 'СЖ', overrides = {}) {
  return {
    id: 'id',
    sheetId,
    day: 'Понедельник',
    dayOrder: 0,
    time: '08:30-10:05',
    para: '1',
    group: 'ЛД-11',
    subgroup: '',
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов И.И.',
    room: '101',
    isExam: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    sheet_id: 'СЖ',
    day: 'Понедельник',
    day_order: 0,
    time: '08:30-10:05',
    para: '1',
    group_code: 'ЛД-11',
    subgroup: null,
    subject: 'Анатомия',
    type: 'lecture',
    teacher: 'Иванов И.И.',
    room: '101',
    is_exam: false,
    ...overrides,
  };
}

function sheetStats(overrides = {}) {
  return {
    totalRows: 20,
    headerRow: 3,
    headerRows: [3],
    regionCount: 1,
    groupsFound: 4,
    candidateCount: 12,
    acceptedCount: 10,
    rejectedCount: 2,
    ignoredNonLessonCount: 5,
    totalNonEmpty: 30,
    inRegions: 20,
    outOfRegions: 10,
    lessonCells: 8,
    partialCells: 2,
    nonLessonCells: 5,
    unresolvedCells: 0,
    coverage: 1,
    mergeCount: 3,
    mergeExpandedCount: 3,
    mergeExpandedCells: 6,
    mergeRowsCovered: 2,
    mergeColumnsCovered: 3,
    expandedGroupCells: 10,
    ...overrides,
  };
}

/** A preview shaped exactly like the one `previewWorkbook` returns. */
function previewOf({ lessons = [record()], sheets = [], report = {} } = {}) {
  const sheetsWithDefaults = sheets.map((sheet) => ({
    days: ['Понедельник'],
    ...sheet,
    stats: sheetStats(sheet.stats),
  }));
  return {
    draft: {
      lessons,
      report: {
        candidateCount: lessons.length,
        acceptedCount: lessons.length,
        rejectedCount: 0,
        ignoredNonLessonCount: 0,
      },
      diagnostics: [],
    },
    sheets: sheetsWithDefaults,
    days: Array.from(new Set(lessons.map((item) => item.day))),
    report: {
      sheetCount: sheetsWithDefaults.length,
      regionCount: 1,
      candidateCount: lessons.length,
      acceptedCount: lessons.length,
      rejectedCount: 0,
      ignoredNonLessonCount: 0,
      totalNonEmpty: 30,
      inRegions: 20,
      outOfRegions: 10,
      lessonCells: 8,
      partialCells: 2,
      nonLessonCells: 5,
      unresolvedCells: 0,
      coverage: 1,
      mergeCount: 3,
      mergeExpandedCount: 3,
      mergeExpandedCells: 6,
      mergeRowsCovered: 2,
      mergeColumnsCovered: 3,
      expandedGroupCells: 10,
      ...report,
    },
  };
}

function scheduleOf(lessons, version = 'v1') {
  const sheets = new Map();
  for (const item of lessons) {
    const list = sheets.get(item.sheetId) || [];
    list.push(item);
    sheets.set(item.sheetId, list);
  }
  return {
    sheets,
    sheetsMeta: [],
    groups: new Map(),
    preferences: { currentSheetId: '', currentGroup: '', activeSubgroup: '', hiddenSheets: [] },
    version,
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

describe('preview formatting', () => {
  it('groups thousands the way Russian writes them', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(778)).toBe('778');
    expect(formatCount(1854)).toBe('1\u00a0854');
    expect(formatCount(-42)).toBe('-42');
  });

  it('shows one decimal below 100 % and nothing at all at 100 %', () => {
    expect(formatCoverage(1)).toBe('100%');
    expect(formatCoverage(0.9642)).toBe('96,4%');
    expect(formatCoverage(0)).toBe('0,0%');
    // A rounding artefact must not read as a loss.
    expect(formatCoverage(0.99999)).toBe('100%');
  });

  it('says "нет" instead of showing a blank for an empty sheet', () => {
    expect(formatDays(['Понедельник', 'Среда'])).toBe('Понедельник, Среда');
    expect(formatDays([])).toBe('нет');
  });
});

describe('buildPreviewView', () => {
  it('carries the engine counters through untouched', () => {
    const preview = previewOf({
      lessons: [record(), record({ para: '2' })],
      sheets: [{ sheetName: 'СЖ', lessonCount: 2 }],
      report: { unresolvedCells: 4, inRegions: 100, coverage: 0.96, rejectedCount: 3 },
    });

    const view = buildPreviewView(preview, null);

    expect(view.totalLessons).toBe(2);
    expect(view.coverageText).toBe('96,0%');
    expect(view.counters).toMatchObject({
      merges: 3,
      expandedGroupCells: 6,
      inRegions: 100,
      unresolved: 4,
      ignored: 0,
      rejected: 3,
    });
    expect(view.countersText).toContain('не разобрано: 4');
  });

  it('lists one row per sheet with its coverage and weekdays', () => {
    const preview = previewOf({
      lessons: [record()],
      sheets: [
        { sheetName: 'СЖ', lessonCount: 1, days: ['Понедельник', 'Пятница'] },
        {
          sheetName: 'ПСТ',
          lessonCount: 0,
          days: [],
          stats: { coverage: 0.5, unresolvedCells: 5 },
        },
      ],
    });

    const view = buildPreviewView(preview, null);

    expect(view.sheets.map((sheet) => sheet.sheetId)).toEqual(['СЖ', 'ПСТ']);
    expect(view.sheets[0]).toMatchObject({ lessonCount: 1, coverageText: '100%' });
    expect(view.sheets[0].daysText).toBe('Понедельник, Пятница');
    expect(view.sheets[1]).toMatchObject({ coverageText: '50,0%', unresolvedCells: 5 });
    expect(view.sheets[1].daysText).toBe('нет');
    expect(view.daysText).toBe('Понедельник');
  });

  it('attaches the comparison to the current schedule', () => {
    const current = scheduleOf([
      lesson(),
      lesson('СЖ', { para: '2' }),
      lesson('СЖ', { para: '3' }),
    ]);
    const preview = previewOf({
      lessons: [record()],
      sheets: [{ sheetName: 'СЖ', lessonCount: 1 }],
    });

    const view = buildPreviewView(preview, current);

    expect(view.diff.currentTotal).toBe(3);
    expect(view.diff.nextTotal).toBe(1);
    expect(view.diff.disappearedCount).toBe(2);
  });

  it('never blocks: a perfectly clean parse raises no warnings at all', () => {
    const current = scheduleOf([lesson()]);
    const preview = previewOf({
      lessons: [record()],
      sheets: [{ sheetName: 'СЖ', lessonCount: 1 }],
    });

    expect(buildPreviewView(preview, current).warnings).toEqual([]);
  });
});

describe('buildPreviewView warnings', () => {
  it('shouts when the file holds nothing to publish', () => {
    const preview = previewOf({ lessons: [], sheets: [], report: { coverage: 1 } });

    const warnings = buildPreviewView(preview, scheduleOf([lesson()])).warnings;

    expect(warnings[0].severity).toBe('error');
    expect(warnings.some((warning) => warning.text.includes('ни одного занятия'))).toBe(true);
  });

  it('names a sheet that exists now but not in the file', () => {
    const current = scheduleOf([lesson('ЛД')]);
    const preview = previewOf({
      lessons: [record()],
      sheets: [{ sheetName: 'СЖ', lessonCount: 1 }],
    });

    const warning = buildPreviewView(preview, current).warnings.find(
      (item) => item.severity === 'error' && item.text.includes('ЛД')
    );

    expect(warning.text).toContain('есть в текущем расписании, но в файле его нет');
  });

  it('names a weekday a sheet lost since the last publication', () => {
    const current = scheduleOf([lesson('СЖ', { day: 'Пятница' })]);
    const preview = previewOf({
      lessons: [record()],
      sheets: [{ sheetName: 'СЖ', lessonCount: 1, days: ['Понедельник'] }],
    });

    const view = buildPreviewView(preview, current);

    expect(view.sheets[0].lostDays).toEqual(['Пятница']);
    expect(
      view.warnings.some(
        (warning) => warning.text.includes('Пятница') && warning.text.includes('в этом файле нет')
      )
    ).toBe(true);
  });

  it('reports coverage below 100 % once for the workbook and once per sheet', () => {
    const preview = previewOf({
      sheets: [
        {
          sheetName: 'СЖ',
          lessonCount: 8,
          stats: { coverage: 0.9, unresolvedCells: 2, inRegions: 200 },
        },
      ],
      report: { coverage: 0.9, unresolvedCells: 2, inRegions: 200 },
    });

    const warnings = buildPreviewView(preview, null).warnings;
    const coverageWarnings = warnings.filter((warning) =>
      warning.text.includes('Покрытие разбора')
    );
    const sheetWarnings = warnings.filter((warning) => warning.text.includes('Лист «СЖ»'));

    expect(coverageWarnings).toHaveLength(1);
    expect(sheetWarnings).toHaveLength(1);
    expect(coverageWarnings[0].text).toContain('90,0%');
    // A 1 % loss is worth noting, not alarming about.
    expect(coverageWarnings[0].severity).toBe('info');
  });

  it('raises the coverage warning when a sixth of the file is unparsed', () => {
    const preview = previewOf({
      report: { coverage: 0.8, unresolvedCells: 20, inRegions: 100 },
    });

    const warning = buildPreviewView(preview, null).warnings.find((item) =>
      item.text.includes('Покрытие разбора')
    );

    expect(warning.severity).toBe('warn');
  });

  it('reports candidates the parser refused, with examples', () => {
    const preview = previewOf({ report: { rejectedCount: 7 } });
    preview.draft.diagnostics = [
      { sheet: 'СЖ', row: 42, code: 'low_confidence', message: 'нет аудитории' },
    ];

    const view = buildPreviewView(preview, null);

    expect(
      view.warnings.some((warning) => warning.text.includes('Парсер отклонил 7 кандидатов'))
    ).toBe(true);
    expect(view.rejectedSamples).toEqual(['СЖ · стр. 42: нет аудитории']);
  });

  it('describes the same change the diff block shows', () => {
    const current = scheduleOf([lesson(), lesson('СЖ', { para: '2' })]);
    const preview = previewOf({
      lessons: [record()],
      sheets: [{ sheetName: 'СЖ', lessonCount: 1 }],
    });

    const view = buildPreviewView(preview, current);

    expect(view.diff).toEqual(diffSchedules(current, preview.draft.lessons));
  });
});
