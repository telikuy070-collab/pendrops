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

    expect(PARSER_CONTRACT_VERSION).toBe('1.1.0');
    expect(result.formatUsed).toBe('college-kyrgyz-2024');
    expect(result.stats).toMatchObject({
      candidateCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      inRegions: 1,
      unresolvedCells: 0,
      coverage: 1,
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

  it('inventories every non-empty cell exactly once', () => {
    // The no-loss invariant in its smallest form: the header's five cells, the
    // three populated cells of the lesson row and the one cell of the trailing
    // day-only row are all accounted for, and each appears exactly once.
    const result = new ParserEngine().parseSheetRowsDetailed([header, withLesson()], 'ПСТ');

    const keys = result.cellOutcomes.map((cell) => `${cell.row},${cell.col}`);
    expect(keys).toEqual([...new Set(keys)]);
    expect(result.cellOutcomes).toHaveLength(9);
    expect(result.stats.totalNonEmpty).toBe(9);
    expect(result.stats.inRegions).toBe(1);
    expect(result.stats.outOfRegions).toBe(8);
    // Header and axis cells are outside the region, so they are classified but
    // never counted against coverage.
    const outside = result.cellOutcomes.filter((cell) => !cell.inRegion);
    expect(outside).toHaveLength(8);
    expect(outside.every((cell) => cell.status === 'non_lesson')).toBe(true);
    expect(outside.every((cell) => cell.counted === false)).toBe(true);
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

  it('records a blank separator row without turning it into a candidate', () => {
    const result = parseSheetRowsDetailed(
      [
        header,
        withLesson('Биология пр. ауд. 101 Алиев А.'),
        [],
        ['Вторник', '2', '09:30-10:50', 'Химия пр. ауд. 102 Борисов Б.', ''],
      ],
      'ПСТ'
    );

    expect(result.stats).toMatchObject({ candidateCount: 2, acceptedCount: 2, rejectedCount: 0 });
    // The blank row sits between two content rows, so it is inside the region
    // and is reported as a separator.
    expect(result.ignored).toContainEqual(
      expect.objectContaining({
        code: 'empty_row',
        provenance: expect.objectContaining({ sourceRow: 3, sourceColumn: 1 }),
      })
    );
    // A fully blank row holds no cells, so it cannot appear in the inventory
    // and cannot lower coverage.
    expect(result.cellOutcomes.some((cell) => cell.row === 2)).toBe(false);
    expect(result.stats.coverage).toBe(1);
  });

  it('ignores blank rows that trail after the last content row', () => {
    // A .xls export can carry thousands of empty trailing rows. They hold no
    // cells, so they are outside the region and produce no diagnostics at all.
    const result = parseSheetRowsDetailed([header, withLesson(), [], ['', '', '', '', '']], 'ПСТ');

    expect(result.stats).toMatchObject({ candidateCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(result.stats.totalRows).toBe(4);
    expect(result.stats.inRegions).toBe(1);
    expect(result.ignored.filter((item) => item.code === 'empty_row')).toHaveLength(0);
    expect(result.stats.coverage).toBe(1);
  });

  it('splits slash records and keeps the empty part out of the inventory', () => {
    const rows = [
      header,
      withLesson('Биология пр. ауд. 101 Алиев А. / / Химия пр. ауд. 102 Борисов Б.'),
    ];
    const result = parseSheetRowsDetailed(rows);

    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.map((lesson) => lesson.subject)).toEqual(['Биология', 'Химия']);
    // partIndex still points at the authored position inside the cell, so the
    // empty middle fragment stays visible as a gap in the sequence.
    expect(result.accepted.map((item) => item.provenance.partIndex)).toEqual([0, 2]);
    // The empty fragment is not a cell. It used to produce an `empty_cell_part`
    // diagnostic and no lesson; now it simply is not an outcome of its own.
    expect(result.cellOutcomes.filter((cell) => cell.inRegion)).toHaveLength(1);
    expect(result.stats.ignoredNonLessonCount).toBe(0);
    expect(result.stats.candidateCount).toBe(2);
    expect(result.stats.coverage).toBe(1);
  });

  it('keeps a room range in one cell instead of splitting it', () => {
    // A slash between two room numbers is a range, not two lessons: the halves
    // name no teacher and no second room key.
    const result = parseSheetRowsDetailed(
      [header, withLesson('Топография ауд. 101/102 Орубаев А.')],
      'ПСТ'
    );

    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0].subject).toBe('Топография');
  });

  it('splits a cell whose halves name different teachers', () => {
    const result = parseSheetRowsDetailed(
      [header, withLesson('Биология пр. ауд. 101 Алиев А. / Химия пр. ауд. 101 Борисов Б.')],
      'ПСТ'
    );

    expect(result.lessons.map((lesson) => lesson.subject)).toEqual(['Биология', 'Химия']);
    expect(result.lessons.map((lesson) => lesson.teacher)).toEqual(['Алиев А.', 'Борисов Б.']);
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

  describe('signature and caption cells (classified, never rejected)', () => {
    const SIGNATURE = 'Медициналык колледждин директору Н.Т.Талипов';

    it('classifies a signature written into the time column as non_lesson', () => {
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

    it('keeps the signature out of the coverage denominator and stays at 100%', () => {
      const result = parseSheetRowsDetailed(
        [
          header,
          [
            'Понедельник',
            '4',
            '13:10-14:30',
            'Дене тарбия пр. спорттук аянтча Авазов К.',
            'Социалдык патронаж пр., №7 корп. Вакансия ВСО 2',
          ],
          ['', '', SIGNATURE, '', ''],
        ],
        'ЛД'
      );

      expect(result.rejected).toHaveLength(0);
      expect(result.stats.acceptedCount).toBe(2);
      // Two group cells in the region, one of which holds a real lesson. The
      // signature lives in a time column, so it is outside the region: it is
      // classified but neither counted nor charged to coverage.
      expect(result.stats.inRegions).toBe(2);
      expect(result.stats.unresolvedCells).toBe(0);
      expect(result.stats.coverage).toBe(1);
      expect(result.stats.nonLessonCells).toBeGreaterThanOrEqual(1);
    });

    it('does not let a caption in the time column poison the rows underneath', () => {
      // A caption is not a time, so the axis must not continue through it. The
      // lesson on the next row keeps its own inherited time only if that time
      // really is a time; here it is empty, so the cell is `unresolved` and
      // reports exactly which field is missing.
      const result = parseSheetRowsDetailed(
        [
          header,
          ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
          ['', '', SIGNATURE, '', ''],
        ],
        'ПСТ'
      );

      expect(result.accepted).toHaveLength(1);
      const signatureCell = result.cellOutcomes.find((cell) => cell.row === 2 && cell.col === 2);
      expect(signatureCell).toMatchObject({ status: 'non_lesson', counted: false });
      // The time axis is broken at the caption, so nothing below inherits it.
      const below = result.cellOutcomes.filter((cell) => cell.inRegion && cell.row > 2);
      expect(below.every((cell) => cell.lessons.every((l) => l.time !== SIGNATURE))).toBe(true);
    });

    it('does not classify a signature written into a group column as rejected', () => {
      const result = parseSheetRowsDetailed(
        [
          header,
          ['Понедельник', '4', '13:10-14:30', 'Дене тарбия пр., спорттук аянтча Авазов К.', ''],
          ['', '', '13:10-14:30', SIGNATURE, ''],
        ],
        'СО'
      );

      expect(result.rejected).toHaveLength(0);
      const signatureCell = result.cellOutcomes.find(
        (cell) => cell.inRegion && cell.row === 2 && cell.col === 3
      );
      expect(signatureCell).toMatchObject({ status: 'non_lesson', inRegion: true, counted: true });
      // Being inside the region, it is counted — and `non_lesson` is exactly
      // why it must not reduce coverage.
      expect(result.stats.coverage).toBe(1);
      expect(result.stats.unresolvedCells).toBe(0);
    });

    it('still rejects a cell that has lesson content but an invalid time', () => {
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

      // The signature cell itself is classified `non_lesson` and reported, while
      // the group cell next to it cannot be placed in time and is rejected.
      expect(result.ignored.filter((item) => item.code === 'non_lesson_row')).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({
        status: 'rejected',
        code: 'critical_fields_invalid',
        details: { fields: ['time'] },
      });
      // The cell is `unresolved`, so it is the one state that lowers coverage.
      expect(result.stats.unresolvedCells).toBe(1);
      expect(result.stats.coverage).toBe(0);
    });

    it('still rejects a cell whose own lesson number is malformed', () => {
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
