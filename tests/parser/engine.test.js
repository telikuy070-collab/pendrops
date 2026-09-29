import { describe, expect, it } from 'vitest';
import {
  PARSER_CONTRACT_VERSION,
  ParserEngine,
  validateCriticalFields,
} from '../../src/parser/engine.ts';
import {
  parseSheetRows,
  parseSheetRowsDetailed,
  parseWorkbook,
  parseWorkbookDetailed,
} from '../../src/sheet.js';

const header = ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)'];

function withLesson(raw = 'Биология пр. ауд. 101 Алиев А.', overrides = []) {
  return ['Дүйшөмбү', '1', '08:00-09:20', raw, '', ...overrides];
}

describe('ParserEngine canonical detailed result', () => {
  it('returns accepted records with minimal 1-based provenance', () => {
    const result = new ParserEngine().parseSheetRowsDetailed([header, withLesson()], 'ПСТ');

    expect(PARSER_CONTRACT_VERSION).toBe('1.0.0');
    expect(result.formatUsed).toBe('college-kyrgyz-2024');
    expect(result.stats).toMatchObject({
      candidateCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      ignoredNonLessonCount: 1,
    });
    expect(result.accepted[0]).toMatchObject({
      status: 'accepted',
      provenance: { sheetName: 'ПСТ', sourceRow: 2, sourceColumn: 4, partIndex: 0 },
    });
    expect(result.accepted[0].lesson).toMatchObject({
      day: 'Понедельник',
      group: 'СЖ-1-25',
      subgroup: '1',
      subject: 'Биология',
    });
  });

  it('records an explicit diagnostic for a day-only row', () => {
    const result = parseSheetRowsDetailed([header, ['Вторник']], 'ПСТ');

    expect(result.accepted).toHaveLength(0);
    expect(result.ignored).toEqual([
      expect.objectContaining({ status: 'ignored', code: 'day_without_lesson' }),
    ]);
    expect(result.stats.ignoredNonLessonCount).toBe(1);
  });

  it('preserves fill-down semantics for merged context cells', () => {
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Анатомия лекция ауд. 101 Иванов И.', ''],
      ['', '', '', 'Физика лаб. кл. каб 102 Петров П.', ''],
    ];
    const result = parseSheetRowsDetailed(rows);

    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.map((lesson) => lesson.subject)).toEqual(['Анатомия', 'Физика']);
    expect(result.rejected).toHaveLength(0);
  });

  it('records empty and decorative rows separately from candidates', () => {
    const result = parseSheetRowsDetailed([header, withLesson(), [], ['', '', '', '', '']], 'ПСТ');

    expect(result.stats).toMatchObject({ candidateCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(result.ignored).toContainEqual(
      expect.objectContaining({
        code: 'empty_row',
        provenance: expect.objectContaining({ sourceRow: 3, sourceColumn: 1 }),
      })
    );
  });

  it('splits slash records and reports an empty part', () => {
    const rows = [
      header,
      withLesson('Биология пр. ауд. 101 Алиев А. / / Химия пр. ауд. 102 Борисов Б.'),
    ];
    const result = parseSheetRowsDetailed(rows);

    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.map((lesson) => lesson.subject)).toEqual(['Биология', 'Химия']);
    expect(result.accepted.map((item) => item.provenance.partIndex)).toEqual([0, 2]);
    expect(result.ignored).toContainEqual(
      expect.objectContaining({
        code: 'empty_cell_part',
        provenance: expect.objectContaining({ partIndex: 1 }),
      })
    );
    expect(result.stats.ignoredNonLessonCount).toBe(2);
    expect(result.stats.candidateCount).toBe(2);
  });

  it('keeps subgroup columns separate', () => {
    const rows = [header, withLesson()];
    const result = parseSheetRowsDetailed(rows);
    const subgroupLesson = new ParserEngine().parseSheetRowsDetailed([
      header,
      ['Понедельник', '1', '08:00-09:20', '', 'Химия пр. ауд. 102 Борисов Б.'],
    ]);

    expect(result.lessons[0].subgroup).toBe('1');
    expect(subgroupLesson.lessons[0]).toMatchObject({ group: 'СЖ-1-25', subgroup: '2' });
  });

  it('detects exams without forcing non-exam lessons to true', () => {
    const result = parseSheetRowsDetailed([
      header,
      withLesson('Математика экзамен ауд. 101 Алиев А.'),
      ['Понедельник', '2', '09:30-10:50', 'Куратордук саат', ''],
    ]);

    expect(result.lessons[0].isExam).toBe(true);
    expect(result.lessons[1]).toMatchObject({ subject: 'Кураторский час', isExam: false });
  });

  it('accepts missing optional teacher and room with canonical empty strings', () => {
    const result = parseSheetRowsDetailed([header, withLesson('История лекция')]);

    expect(result.accepted).toHaveLength(1);
    expect(result.lessons[0]).toMatchObject({ teacher: '', room: '', subject: 'История' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['missing SheetNames', { Sheets: {} }],
  ])('preserves the legacy empty-object contract for %s input', (_name, workbook) => {
    const detailed = parseWorkbookDetailed(workbook);

    expect(parseWorkbook(workbook)).toEqual({});
    expect(new ParserEngine().parseWorkbook(workbook)).toEqual({});
    expect(detailed.sheets['<workbook>'].rejected).toEqual([
      expect.objectContaining({ code: 'invalid_input', status: 'rejected' }),
    ]);
  });

  it('classifies empty and unknown-format input without silent throws', () => {
    const empty = parseSheetRowsDetailed([], 'empty');
    const unknown = parseSheetRowsDetailed(
      [
        ['name', 'value'],
        ['a', 'b'],
      ],
      'unknown'
    );
    const emptyWorkbook = parseWorkbookDetailed({ SheetNames: [], Sheets: {} });

    expect(empty.ignored[0].code).toBe('empty_input');
    expect(empty.stats.candidateCount).toBe(0);
    expect(unknown.rejected).toEqual([
      expect.objectContaining({ code: 'unknown_format', status: 'rejected' }),
    ]);
    expect(unknown.stats).toMatchObject({ candidateCount: 1, acceptedCount: 0, rejectedCount: 1 });
    expect(parseWorkbook({ SheetNames: [], Sheets: {} })).toEqual({});
    expect(emptyWorkbook.report).toMatchObject({
      sheetCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
    });
  });

  it.each([
    [
      'unknown day',
      ['Нету такого дня', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      ['day'],
    ],
    ['invalid time', ['Понедельник', '1', '25:99', 'Биология пр. ауд. 101 Алиев А.', ''], ['time']],
    [
      'reversed time',
      ['Понедельник', '1', '10:00-09:00', 'Биология пр. ауд. 101 Алиев А.', ''],
      ['time'],
    ],
    [
      'invalid para',
      ['Понедельник', 'урок', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      ['para'],
    ],
  ])('rejects %s with critical-field diagnostics', (_name, row, fields) => {
    const result = parseSheetRowsDetailed([header, row]);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({
      status: 'rejected',
      code: 'critical_fields_invalid',
      details: { fields },
    });
  });

  it('rejects a header without valid group columns', () => {
    const result = parseSheetRowsDetailed([
      ['Апта күндөрү', 'Паралар', 'Убакты', 'Группа'],
      ['Понедельник', '1', '08:00-09:20', 'Биология'],
    ]);

    expect(result.rejected[0].code).toBe('no_schedule_blocks');
    expect(result.lessons).toHaveLength(0);
  });

  describe('signature and caption rows (ignored, not rejected)', () => {
    const SIGNATURE = 'Медициналык колледждин директору Н.Т.Талипов';

    it('ignores a signature row instead of rejecting a fabricated candidate', () => {
      const result = parseSheetRowsDetailed(
        [
          header,
          [
            'Понедельник',
            '4',
            '13:10-14:30',
            'Толук эмес алынуучу протездер 5 пр., №7 корп., 304 Сагынбаев З.',
            '',
          ],
          ['', '', SIGNATURE, '', ''],
        ],
        'СО'
      );

      expect(result.rejected).toHaveLength(0);
      expect(result.ignored).toContainEqual(
        expect.objectContaining({
          status: 'ignored',
          code: 'non_lesson_row',
          provenance: expect.objectContaining({ sheetName: 'СО', sourceRow: 3, partIndex: 0 }),
        })
      );
      // The signature row is not a candidate at all, so it must not appear in
      // the candidate accounting either.
      expect(result.stats).toMatchObject({ acceptedCount: 1, rejectedCount: 0, candidateCount: 1 });
      expect(result.ignored.filter((item) => item.code === 'non_lesson_row')).toHaveLength(1);
    });

    it('reports the whole row, not one diagnostic per group column', () => {
      const result = parseSheetRowsDetailed(
        [
          header,
          [
            'Понедельник',
            '4',
            '13:10-14:30',
            'Дене тарбия пр. спорттук аянтча Авазов К.',
            'Социалдык патронаж пр., №7 корп. Вакансия ВСО 2',
            '',
          ],
          ['', '', SIGNATURE, '', ''],
        ],
        'ЛД'
      );

      const nonLesson = result.ignored.filter((item) => item.code === 'non_lesson_row');
      expect(nonLesson).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);
      expect(result.stats.acceptedCount).toBe(2);
    });

    it('still rejects a row that has lesson content but an invalid time', () => {
      const result = parseSheetRowsDetailed([
        header,
        [
          'Понедельник',
          '4',
          SIGNATURE,
          'Толук эмес алынуучу протездер 5 пр., №7 корп., 304 Сагынбаев З.',
          '',
        ],
      ]);

      expect(result.ignored.filter((item) => item.code === 'non_lesson_row')).toHaveLength(0);
      expect(result.rejected[0]).toMatchObject({
        status: 'rejected',
        code: 'critical_fields_invalid',
        details: { fields: ['time'] },
      });
    });

    it('still rejects a row whose own lesson number is malformed', () => {
      const result = parseSheetRowsDetailed([
        header,
        ['Понедельник', 'урок', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      ]);

      expect(result.ignored.filter((item) => item.code === 'non_lesson_row')).toHaveLength(0);
      expect(result.rejected[0]).toMatchObject({
        code: 'critical_fields_invalid',
        details: { fields: ['para'] },
      });
    });
  });

  it('does not map a rejected candidate confidence onto the next accepted record', () => {
    const engine = new ParserEngine({ minConfidence: 0.5 });
    const result = engine.parseSheetRowsDetailed([
      header,
      withLesson('Биология'),
      withLesson('Химия пр. ауд. 102 Борисов Б.'),
    ]);

    expect(result.rejected[0].code).toBe('low_confidence');
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].lesson.subject).toBe('Химия');
    expect(result.accepted[0].lesson.confidence).toBeGreaterThan(0.5);
  });

  it('keeps the legacy array API while routing it through the canonical engine', () => {
    const rows = [header, withLesson()];
    const detailed = parseSheetRowsDetailed(rows);
    const legacy = parseSheetRows(rows);

    expect(legacy).toEqual(detailed.lessons);
    expect(legacy).toHaveLength(1);
  });

  it('validates critical fields independently of extraction confidence', () => {
    expect(
      validateCriticalFields({
        day: 'Понедельник',
        time: '08:00-09:20',
        para: '1',
        group: 'СЖ-1-25',
        subject: 'Биология',
        type: 'tp-practice',
        isExam: false,
      })
    ).toEqual([]);
    expect(
      validateCriticalFields({
        day: '',
        time: '',
        para: '',
        group: '',
        subject: '',
        type: '',
        isExam: 'no',
      })
    ).toEqual(['day', 'time', 'para', 'group', 'subject', 'type', 'isExam']);
  });
});
