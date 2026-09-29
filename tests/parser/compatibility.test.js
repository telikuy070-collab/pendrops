import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCorrection,
  applyCorrections,
  classifier,
  exportLearnedPatterns,
  importLearnedPatterns,
} from '../../src/parser/classifier.ts';
import { ParserEngine } from '../../src/parser/engine.ts';
import { safeValidateFormatConfig } from '../../src/parser/types.ts';
import { parseLesson, parseLessons } from '../../src/types/lesson.js';

const validLesson = {
  day: 'Понедельник',
  time: '08:00-09:20',
  para: '1',
  group: 'СЖ-1-25',
  subject: 'Биология',
  type: 'tp-practice',
  isExam: false,
};

afterEach(() => {
  classifier.reset();
  vi.restoreAllMocks();
});

describe('parser compatibility and static APIs', () => {
  it('keeps LessonSchema single and legacy array helpers available', () => {
    expect(parseLesson(validLesson)).toMatchObject(validLesson);
    expect(() => parseLesson({ ...validLesson, subject: '' })).toThrow();
    expect(
      parseLessons([validLesson, { day: '' }, { ...validLesson, group: 'ФЯ-1-25' }])
    ).toHaveLength(2);
  });

  it('exposes non-throwing format validation', () => {
    expect(safeValidateFormatConfig({}).success).toBe(false);
    expect(
      safeValidateFormatConfig({
        formatId: 'synthetic',
        name: 'Synthetic',
        version: '1.0.0',
        detection: { headerKeywords: ['day'] },
        structure: { header: {} },
        parsing: {},
      }).success
    ).toBe(true);
  });

  it('keeps static detailed and legacy parser entrypoints on the same core', () => {
    const rows = [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)'],
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.'],
    ];
    const workbook = { SheetNames: ['ПСТ'], Sheets: { ПСТ: { '!ref': 'A1:D2' } } };
    const xlsx = { utils: { sheet_to_json: () => rows } };

    expect(ParserEngine.parseSheetRows(rows)).toHaveLength(1);
    expect(ParserEngine.parseSheetRowsDetailed(rows).accepted).toHaveLength(1);
    expect(ParserEngine.parse(workbook, xlsx).ПСТ).toHaveLength(1);
    expect(ParserEngine.parseDetailed(workbook, xlsx).report.acceptedCount).toBe(1);
  });

  it('supports classifier correction persistence helpers', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    applyCorrection({
      rawText: 'биология',
      correctedFields: { type: 'tp-practice', subject: 'Биология' },
    });
    expect(classifier.classify('биология').type).toBe('tp-practice');

    applyCorrections([{ rawText: 'новый термин', correctedFields: { type: 'tp-lecture' } }]);
    expect(classifier.classify('новый термин').type).toBe('tp-lecture');

    const exported = exportLearnedPatterns();
    expect(exported.timestamp).toEqual(expect.any(Number));
    expect(exported.classifierPatterns.size).toBeGreaterThan(0);

    classifier.reset();
    expect(classifier.classify('новый термин').type).toBe('unknown');
    importLearnedPatterns({ classifierPatterns: exported.classifierPatterns });
    expect(classifier.classify('новый термин').type).toBe('tp-lecture');
  });
});
