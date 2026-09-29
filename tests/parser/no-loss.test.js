/**
 * The no-loss invariant.
 *
 * Three properties, checked on the real workbook and on synthetic tables that
 * each reproduce one historical defect:
 *
 *  1. the number of outcomes equals the number of non-empty authored cells in
 *     the recognised regions — re-derived independently from the sheet
 *     geometry, not from the engine's own bookkeeping;
 *  2. `coverage === 1 - unresolved / totalNonEmptyCellsInRegions`;
 *  3. no cell is lost, duplicated, or left without a terminal status.
 *
 * Every assertion here is strict. A parser that quietly drops a cell fails;
 * a parser that reports a fabricated lesson fails; so does one that hides a
 * bad cell outside the coverage denominator.
 */
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '../../src/parser/engine.ts';
import {
  ParserEngine as EngineForStatic,
  checkSheet,
  checkWorkbook,
  expectInventory,
  readRealWorkbook,
  XLSX,
} from '../../scripts/parser-invariants.ts';
import { buildGrid } from '../../src/parser/grid.ts';
import { norm } from '../../src/text.js';

const header = ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)'];
const engine = new ParserEngine();

/** Build a merge list in SheetJS range form, as `sheet['!merges']` holds it. */
function mergeRanges(merges) {
  return merges.map(([r0, c0, r1, c1]) => ({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } }));
}

function parse(rows, merges = []) {
  return engine.parseSheetRowsDetailed(rows, 'ТЕСТ', { merges: mergeRanges(merges) });
}

describe('coverage accounting', () => {
  it('is 1 minus unresolved over in-region cells', () => {
    const result = parse([
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Биология пр. ауд. 101 Алиев А.',
        'Химия лек. 102 Борисов Б.',
      ],
      ['Вторник', '2', '09:30-10:50', 'Физика лаб. 103 Петров П.', 'Математика пр. 104 Сидоров С.'],
    ]);

    expect(result.stats.inRegions).toBe(4);
    expect(result.stats.unresolvedCells).toBe(0);
    expect(result.stats.coverage).toBe(1);
  });

  it('counts an unresolvable cell against coverage and nothing else', () => {
    // The time cell holds a caption, so no row below it can be placed in time.
    // One group cell is thereby unresolved; the other three are fine.
    const result = parse([
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Биология пр. ауд. 101 Алиев А.',
        'Химия пр. ауд. 102 Борисов Б.',
      ],
      [
        'Вторник',
        '2',
        'МЕДИЦИНАЛЫК КОЛЛЕДЖДИН ДИРЕКТОРУ Н.Т.ТАЛИПОВ',
        'Физика лаб. 103 Петров П.',
        '',
      ],
    ]);

    expect(result.stats.inRegions).toBe(3);
    expect(result.stats.unresolvedCells).toBe(1);
    expect(result.stats.coverage).toBeCloseTo(1 - 1 / 3, 10);
    // The caption itself is `non_lesson` and is not part of the denominator.
    const caption = result.cellOutcomes.find((cell) => cell.row === 2 && cell.col === 2);
    expect(caption).toMatchObject({ status: 'non_lesson', counted: false });
  });

  it('keeps header and axis cells out of the coverage denominator', () => {
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
    ];
    const result = parse(rows);

    // 5 header cells + 4 populated cells of the lesson row (day, para, time,
    // group); the trailing empty cell is not a cell at all.
    const independent = expectInventory(rows, null, 'ТЕСТ');
    expect(independent.totalNonEmpty).toBe(9);
    expect(independent.inRegions).toBe(1);
    expect(result.stats.totalNonEmpty).toBe(independent.totalNonEmpty);
    // Only the single group cell counts.
    expect(result.stats.inRegions).toBe(1);
    expect(result.stats.outOfRegions).toBe(8);
    expect(result.stats.totalNonEmpty).toBe(result.stats.inRegions + result.stats.outOfRegions);
  });
});

describe('inventory: no cell is lost', () => {
  it('produces exactly one outcome per non-empty authored cell', () => {
    const rows = [
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Биология пр. ауд. 101 Алиев А.',
        'Химия пр. ауд. 102 Борисов Б.',
      ],
      [],
      ['Вторник', '2', '09:30-10:50', 'Физика лаб. 103 Петров П.', ''],
    ];
    const result = parse(rows);

    expect(checkSheet('ТЕСТ', result, rows, null)).toEqual([]);
    const keys = result.cellOutcomes.map((cell) => `${cell.row},${cell.col}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it('matches an independently derived inventory on a wide synthetic table', () => {
    const rows = [header];
    for (let day = 0; day < 5; day++) {
      rows.push([
        ['Дүйшөмбү', 'Шейшемби', 'Шаршемби', 'Бейшемби', 'Жума'][day],
        '1',
        '08:00-09:20',
        `Предмет ${day} пр. ауд. 10${day} Алиев А.`,
        '',
      ]);
      rows.push(['', '2', '09:30-10:50', '', `Другой ${day} лек. 20${day} Борисов Б.`]);
    }
    const result = parse(rows);

    expect(checkSheet('ТЕСТ', result, rows, null)).toEqual([]);
    expect(result.stats.inRegions).toBe(10);
    expect(result.stats.coverage).toBe(1);
    expect(result.accepted).toHaveLength(10);
  });
});

describe('A: a caption in the time column does not poison the axis', () => {
  const rows = [
    header,
    ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
    ['', '', 'Медициналык колледждин директору Н.Т.Талипов', '', ''],
    ['', '', '11:40-13:00', 'Физика лаб. 103 Петров П.', ''],
  ];

  it('does not hand the caption to any row as a time', () => {
    const result = parse(rows);

    const times = result.lessons.map((lesson) => lesson.time);
    expect(times.every((time) => /^\d{2}:\d{2}/.test(time))).toBe(true);
    expect(times).not.toContain('Медициналык колледждин директору Н.Т.Талипов');
  });

  it('keeps resolving the axis once a plausible time reappears', () => {
    const result = parse(rows);

    const physics = result.lessons.find((lesson) => lesson.subject.startsWith('Физика'));
    expect(physics).toBeDefined();
    expect(physics?.time).toBe('11:40-13:00');
    expect(physics?.day).toBe('Понедельник');
  });

  it('still classifies the caption cell itself', () => {
    const result = parse(rows);
    const caption = result.cellOutcomes.find((cell) => cell.row === 2 && cell.col === 2);

    expect(caption).toMatchObject({ status: 'non_lesson' });
    expect(caption?.reason).toMatch(/Служебная строка/);
  });
});

describe('B: every table on a sheet is parsed', () => {
  it('parses a second table that starts at its own header row', () => {
    // The second table is the case the old single-header search dropped: it has
    // its own header, its own axis columns and its own group columns, and it
    // uses a completely different subject set.
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      [],
      ['Апта күндөрү', 'Паралар', 'Убакты', 'ФЯ-9-99 (1)'],
      ['Среда', '3', '11:40-13:00', 'Фармацевтикалык химия лек. 315 Улукбек Э.'],
    ];
    const result = parse(rows);

    expect(result.stats.headerRows).toEqual([0, 3]);
    expect(result.stats.regionCount).toBe(2);
    const groups = result.lessons.map((lesson) => lesson.group);
    expect(groups).toContain('СЖ-1-25');
    // Without the second region this lesson simply does not exist.
    expect(groups).toContain('ФЯ-9-99');
    expect(checkSheet('ТЕСТ', result, rows, null)).toEqual([]);
  });

  it('does not let the first table swallow the rows of the second', () => {
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      ['Апта күндөрү', 'Паралар', 'Убакты', 'ФЯ-9-99 (1)'],
      ['Пятница', '5', '14:40-15:10', 'Куратордук саат'],
    ];
    const result = parse(rows);

    const kurator = result.lessons.find((lesson) => lesson.subject === 'Кураторский час');
    expect(kurator).toBeDefined();
    expect(kurator?.group).toBe('ФЯ-9-99');
    expect(kurator?.day).toBe('Пятница');
  });
});

describe('C: an unreadable day inherits the last known day', () => {
  it('keeps the lesson and flags the inheritance', () => {
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', ''],
      ['НЕДЕЛЯ', '2', '09:30-10:50', 'Физика лаб. 103 Петров П.', ''],
    ];
    const result = parse(rows);

    // The old engine produced `day: ''` here, which failed critical-field
    // validation and the whole row was rejected.
    const physics = result.lessons.find((lesson) => lesson.subject.startsWith('Физика'));
    expect(physics).toBeDefined();
    expect(physics?.day).toBe('Понедельник');

    const cell = result.cellOutcomes.find((outcome) => outcome.row === 2 && outcome.col === 3);
    expect(cell?.status).toBe('partial');
    expect(cell?.warnings).toContain('inherited_day');
  });

  it('still rejects a day that was never established', () => {
    const rows = [header, ['НЕДЕЛЯ', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.', '']];
    const result = parse(rows);

    expect(result.accepted).toHaveLength(0);
    expect(result.stats.unresolvedCells).toBe(1);
    expect(result.rejected[0]).toMatchObject({
      code: 'critical_fields_invalid',
      details: { fields: ['day'] },
    });
  });
});

describe('D: a subgroup written in the cell beats the header', () => {
  it('splits the halves onto the subgroups they name', () => {
    const rows = [
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Физика лаб. гр.1 ауд. 101 Алиев А. / Физика лаб. гр.2 ауд. 102 Петров П.',
        '',
      ],
    ];
    const result = parse(rows);

    const subgroups = result.lessons
      .map((lesson) => ({ subgroup: lesson.subgroup, room: lesson.room }))
      .sort((a, b) => a.subgroup.localeCompare(b.subgroup));
    // Both halves used to land on the header's subgroup "1", merging two
    // different groups into one indistinguishable record.
    expect(subgroups).toEqual([
      { subgroup: '1', room: 'ауд. 101' },
      { subgroup: '2', room: 'ауд. 102' },
    ]);
  });

  it('inherits the header subgroup when the cell names none', () => {
    const result = parse([
      header,
      ['Понедельник', '1', '08:00-09:20', 'Химия пр. ауд. 102 Борисов Б.', ''],
    ]);

    expect(result.lessons[0].subgroup).toBe('1');
  });
});

describe('E: a slash is not a boundary by itself', () => {
  it('keeps a room range in a single lesson', () => {
    const result = parse([
      header,
      ['Понедельник', '1', '08:00-09:20', 'Топография ауд. 101/102 Орубаев А.', ''],
    ]);

    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0].subject).toBe('Топография');
    expect(result.lessons[0].room).toBe('ауд. 101/102');
  });

  it('keeps a trailing separator from producing a phantom part', () => {
    const result = parse([
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Фармацевтикалык химия 2 пр., №7 корп., 369 Улукбек кызы Э./',
        '',
      ],
    ]);

    expect(result.lessons).toHaveLength(1);
    expect(result.cellOutcomes.filter((cell) => cell.inRegion)).toHaveLength(1);
    expect(result.stats.coverage).toBe(1);
  });

  it('splits halves that name different teachers', () => {
    const result = parse([
      header,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Биология пр. ауд. 101 Алиев А. / Химия пр. ауд. 101 Борисов Б.',
        '',
      ],
    ]);

    expect(result.lessons.map((lesson) => lesson.teacher)).toEqual(['Алиев А.', 'Борисов Б.']);
  });
});

describe('F: a lesson type is inferred from the column distribution', () => {
  const rows = [
    ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)'],
    ['Понедельник', '1', '08:00-09:20', 'Биология лек. ауд. 101 Алиев А.'],
    ['Понедельник', '2', '09:30-10:50', 'Физика лек. ауд. 102 Борисов Б.'],
    ['Вторник', '3', '11:40-13:00', 'Химия лек. ауд. 103 Петров П.'],
    ['Вторник', '4', '13:10-14:30', 'Математика ауд. 104 Сидоров С.'],
  ];

  it('reads the dominant type from the file instead of hardcoding it', () => {
    const result = parse(rows);

    const inferred = result.lessons.find((lesson) => lesson.subject === 'Математика');
    expect(inferred?.type).toBe('tp-lecture');
  });

  it('marks the substitution so the report shows it was not read', () => {
    const result = parse(rows);

    const cell = result.cellOutcomes.find((outcome) => outcome.raw.startsWith('Математика'));
    expect(cell?.warnings).toContain('inferred_type');
    expect(cell?.status).toBe('partial');
  });

  it('leaves the type alone when the column has no clear majority', () => {
    // Two lectures and one lab: no type reaches the 80% threshold, so nothing
    // is substituted and the cell keeps its own reading.
    const mixed = [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)'],
      ['Понедельник', '1', '08:00-09:20', 'Биология лек. ауд. 101 Алиев А.'],
      ['Понедельник', '2', '09:30-10:50', 'Физика лек. ауд. 102 Борисов Б.'],
      ['Вторник', '3', '11:40-13:00', 'Химия лаб. ауд. 103 Петров П.'],
    ];
    const result = parse(mixed);

    const lab = result.lessons.find((lesson) => lesson.subject === 'Химия');
    expect(lab?.type).toBe('tp-lab');
  });
});

describe('G: merged cells are restored before parsing', () => {
  const rows = [header, ['Понедельник', '1', '08:00-09:20', 'Физика лаб. ауд. 101 Алиев А.', '']];
  // D2:E2 — the lesson spans both subgroup columns as one authored cell.
  const merges = [[1, 3, 1, 4]];

  it('gives the lesson to every subgroup the merge covers', () => {
    const result = parse(rows, merges);

    const lessons = result.lessons.filter((lesson) => lesson.subject.startsWith('Физика'));
    expect(lessons).toHaveLength(2);
    expect(lessons.map((lesson) => lesson.subgroup).sort()).toEqual(['1', '2']);
  });

  it('counts the merged cell once, not once per covered column', () => {
    const result = parse(rows, merges);

    // One authored cell, even though it occupies two physical columns.
    expect(result.cellOutcomes.filter((cell) => cell.inRegion)).toHaveLength(1);
    expect(result.stats.inRegions).toBe(1);
    expect(checkSheet('ТЕСТ', result, rows, mergeRanges(merges))).toEqual([]);
  });

  it('expands a vertical merge in the day column', () => {
    const vertical = [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)'],
      // A1:A2 — the day label spans both lesson rows.
      ['Понедельник', '1', '08:00-09:20', 'Биология пр. ауд. 101 Алиев А.'],
      ['', '2', '09:30-10:50', 'Физика лаб. 103 Петров П.'],
    ];
    const result = parse(vertical, [[1, 0, 2, 0]]);

    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.every((lesson) => lesson.day === 'Понедельник')).toBe(true);
  });

  it('gives a lesson to every group column a wide horizontal merge covers', () => {
    // One authored cell stretched over four subgroup columns, exactly like the
    // real ПСТ D10:G10 lecture. Every covered column owes a lesson.
    const wide = [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)', 'СЖ-1-25 (3)'],
      ['Понедельник', '3', '11:40-13:00', 'Менеджмент лекция №7 корпус 337 Абдураимов К.', '', ''],
    ];
    // D2:G2 — anchored in the first covered column.
    const result = parse(wide, [[1, 3, 1, 5]]);

    const lessons = result.lessons.filter((lesson) => lesson.subject.startsWith('Менеджмент'));
    expect(lessons).toHaveLength(3);
    expect(lessons.map((lesson) => lesson.subgroup).sort()).toEqual(['1', '2', '3']);
    // One authored cell, so one outcome and one coverage denominator entry.
    expect(result.stats.inRegions).toBe(1);
    expect(result.cellOutcomes.filter((cell) => cell.inRegion)).toHaveLength(1);
  });

  it('reports how large the expansion was', () => {
    const wide = [
      ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)', 'СЖ-1-25 (3)'],
      ['Понедельник', '3', '11:40-13:00', 'Менеджмент лекция 337 Абдураимов К.', '', ''],
      ['Вторник', '1', '08:00-09:20', '', 'Физика лаб. 101 Петров П.', ''],
    ];
    // A2:C2 horizontally and A2:A3 vertically.
    const result = parse(wide, [
      [1, 3, 1, 5],
      [1, 0, 2, 0],
    ]);

    expect(result.stats.mergeCount).toBe(2);
    expect(result.stats.mergeExpandedCount).toBe(2);
    // Two covered cells only: D2's merge fills E2 and F2. The vertical day
    // merge touches A2:A3, but A3 already holds its own day label, so the
    // expansion must not overwrite it and it is not a filled cell.
    expect(result.stats.mergeExpandedCells).toBe(2);
    // Three distinct columns touched: E and F from the horizontal merge, A
    // from the vertical one.
    expect(result.stats.mergeColumnsCovered).toBe(3);
    // Two distinct rows: the row of the horizontal merge and the row of the
    // vertical one.
    expect(result.stats.mergeRowsCovered).toBe(1);
    // Four distinct (row, subgroup) slots the expanded grid can fill:
    // three subgroups on the Monday row and one on the Tuesday row.
    expect(result.stats.expandedGroupCells).toBe(4);
  });

  it('never fills a cell that is outside the merge', () => {
    // Row 2 is merged across D:E; row 3 is not merged at all and its E column
    // is empty. "Empty" must stay empty: it means this group has no lesson
    // here. Copying row 2's lesson down is the fill-down corruption that made
    // the old engine report 1262 lessons where the file contains 778.
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Физика лаб. 101 Петров П.', 'Химия лек. 102 Борисов Б.'],
      ['Вторник', '2', '09:30-10:50', 'Биология пр. 103 Алиев А.', ''],
    ];
    const result = parse(rows, [[1, 3, 1, 4]]);

    const tuesdayChemistry = result.lessons.filter(
      (lesson) => lesson.day === 'Вторник' && lesson.subgroup === '2'
    );
    expect(tuesdayChemistry).toHaveLength(0);
    // The Tuesday row still yields exactly the one lesson it authors.
    expect(result.lessons.filter((lesson) => lesson.day === 'Вторник')).toHaveLength(1);
  });

  it('does not let a lesson cross rows through the day axis alone', () => {
    // The day label is vertically merged over both rows while only the first
    // carries a lesson. The second row must not inherit one.
    const rows = [
      header,
      ['Понедельник', '1', '08:00-09:20', 'Физика лаб. 101 Петров П.', 'Химия лек. 102 Борисов Б.'],
      ['', '2', '09:30-10:50', '', ''],
    ];
    const result = parse(rows, [[1, 0, 2, 0]]);

    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.every((lesson) => lesson.para === '1')).toBe(true);
  });
});

describe('H: the invariant is measured over the expanded grid', () => {
  const wide = [
    ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)'],
    ['Понедельник', '1', '08:00-09:20', 'Физика лаб. 101 Петров П.', ''],
  ];
  const merges = mergeRanges([[1, 3, 1, 4]]);

  it('passes when every cell of the expanded merge is served', () => {
    const result = parse(wide, [[1, 3, 1, 4]]);

    expect(checkSheet('ТЕСТ', result, wide, merges)).toEqual([]);
    // The merge really did put text into the second group column.
    expect(result.lessons.map((lesson) => lesson.subgroup).sort()).toEqual(['1', '2']);
  });

  it('fails when a cell of the expanded merge is removed from the inventory', () => {
    // Simulates a parser that sees the merge but forgets to expand it: the
    // covered column stays empty, so the subgroup loses its lesson while the
    // authored anchor is still accounted for. The check must notice.
    const unexpanded = parse(wide, []);
    const violations = checkSheet('ТЕСТ', unexpanded, wide, merges);

    expect(violations.map((violation) => violation.kind)).toContain('unexpanded_merge');
    expect(unexpanded.lessons.map((lesson) => lesson.subgroup)).toEqual(['1']);
  });

  it('fails when a lesson is invented for an empty cell', () => {
    // A drop-in replacement for the result that fill-down would have produced.
    const result = parse(wide, []);
    const fabricated = {
      ...result,
      accepted: [
        ...result.accepted,
        {
          status: 'accepted',
          lesson: { ...result.lessons[0], subgroup: '2' },
          provenance: { sheetName: 'ТЕСТ', sourceRow: 2, sourceColumn: 5, partIndex: 0 },
        },
      ],
    };
    const violations = checkSheet('ТЕСТ', fabricated, wide, null);

    expect(violations.map((violation) => violation.kind)).toContain('fabricated_lesson');
  });
});

describe('the real workbook', () => {
  const { workbook, raw } = readRealWorkbook();
  // SheetJS is passed explicitly: the engine reads it from the global in a
  // browser and needs the library handed to it under Node.
  const parsed = engine.parseWorkbookDetailed(workbook, XLSX);

  it('satisfies the invariant on every sheet', () => {
    const report = checkWorkbook(parsed, raw);

    expect(report.violations).toEqual([]);
  });

  it('reaches 100% coverage — no unresolved cell anywhere', () => {
    expect(parsed.report.unresolvedCells).toBe(0);
    expect(parsed.report.coverage).toBe(1);
    expect(parsed.report.inRegions).toBeGreaterThan(0);
  });

  it('expands every merge the real sheets declare', () => {
    // Guards the specific regression this suite exists for: `sheet_to_json`
    // throws the merge metadata away, so if `!merges` stops being handed to
    // `buildGrid` the parse still "passes" — every surviving cell is still
    // accounted for — while the merged lessons quietly disappear. The counts
    // below are read off the real file, not invented.
    const declared = Object.values(raw).reduce(
      (sum, sheet) => sum + (sheet.merges?.length ?? 0),
      0
    );
    expect(declared).toBeGreaterThan(0);
    expect(parsed.report.mergeCount).toBe(declared);
    expect(parsed.report.mergeExpandedCells).toBeGreaterThan(0);
    for (const [name, result] of Object.entries(parsed.sheets)) {
      expect(result.stats.mergeCount, name).toBe(raw[name].merges?.length ?? 0);
    }
  });

  it('serves at least one lesson per expanded group cell on every sheet', () => {
    // The old engine reached 1262 lessons on this file by copying a lesson
    // into empty cells; 778 of those had a cell behind them. This asserts the
    // floor that rules the other direction out, independently of the parser.
    // The ceiling is stated over lesson-bearing slots: a signature line parked
    // in a group column is knowingly not a lesson.
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const expected = expectInventory(raw[name].rows, raw[name].merges, name);
      expect(result.accepted.length, name).toBeGreaterThanOrEqual(expected.lessonBearingSlots);
    }
  });

  it('never invents a lesson for a cell that holds no text', () => {
    // The counterpart to the floor above: no lesson may point at an empty
    // cell. This is the check the old engine would have failed hardest on.
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const grid = buildGrid(raw[name].rows, raw[name].merges);
      const authored = new Set();
      for (let r = 0; r < grid.rowCount; r++) {
        for (let c = 0; c < grid.colCount; c++) {
          if (grid.cells[r][c]) authored.add(`${r},${c}`);
        }
      }
      for (const outcome of result.accepted) {
        const r = outcome.provenance.sourceRow - 1;
        const c = outcome.provenance.sourceColumn - 1;
        const anchor = grid.continuations.get(`${r},${c}`) ?? `${r},${c}`;
        expect(authored.has(anchor), `${name} r${r + 1}c${c + 1}`).toBe(true);
      }
    }
  });

  it('loses no cell: outcomes match an independent inventory', () => {
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const source = raw[name];
      expect(checkSheet(name, result, source.rows, source.merges), name).toEqual([]);
      const expected = expectInventory(source.rows, source.merges, name);
      expect(result.stats.totalNonEmpty, name).toBe(expected.totalNonEmpty);
      expect(result.stats.inRegions, name).toBe(expected.inRegions);
    }
  });

  it('classifies every cell in exactly one terminal state', () => {
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const total =
        result.stats.lessonCells +
        result.stats.partialCells +
        result.stats.nonLessonCells +
        result.stats.unresolvedCells;
      expect(total, name).toBe(result.cellOutcomes.length);
      expect(result.stats.totalNonEmpty, name).toBe(result.cellOutcomes.length);
    }
  });

  it('keeps the accounting identity totalNonEmpty === inRegions + outOfRegions', () => {
    expect(parsed.report.totalNonEmpty).toBe(parsed.report.inRegions + parsed.report.outOfRegions);
    for (const result of Object.values(parsed.sheets)) {
      expect(result.stats.totalNonEmpty).toBe(result.stats.inRegions + result.stats.outOfRegions);
    }
  });

  it('publishes a lesson for every region cell that is not a non-lesson', () => {
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const publishable = result.cellOutcomes.filter(
        (cell) => cell.inRegion && cell.status !== 'non_lesson' && cell.status !== 'unresolved'
      );
      const published = publishable.reduce((sum, cell) => sum + cell.lessons.length, 0);
      expect(published, name).toBe(result.accepted.length);
    }
  });

  it('rejects nothing: the real file has no unplaceable cell', () => {
    expect(parsed.report.rejectedCount).toBe(0);
  });

  it('never gives one authored cell two lessons for the same subgroup', () => {
    // Within a cell this is a parser defect: the merge expansion plus part
    // distribution would be double-assigning a group.
    for (const [name, result] of Object.entries(parsed.sheets)) {
      for (const cell of result.cellOutcomes) {
        const slots = cell.lessons.map(
          (lesson) =>
            `${lesson.group}|${lesson.subgroup}|${lesson.day}|${lesson.time}|${lesson.para}`
        );
        expect(new Set(slots).size, `${name} cell ${cell.row},${cell.col}`).toBe(slots.length);
      }
    }
  });

  it('never publishes two lessons for the same slot, even from different cells', () => {
    // The ПСТ sheet authors one subgroup across two physical columns, and a
    // data row can reach that subgroup from both sides — the real file did
    // exactly that in D8:E8 and F8:G8, so the same lesson was published twice
    // and the student saw two identical cards. A slot now has exactly one
    // owner per row, so the whole schedule holds one lesson per slot.
    for (const [name, result] of Object.entries(parsed.sheets)) {
      const bySlot = new Map();
      for (const { lesson } of result.accepted) {
        const key = `${lesson.day}|${lesson.time}|${lesson.para}|${lesson.group}|${lesson.subgroup}`;
        bySlot.set(key, [...(bySlot.get(key) ?? []), lesson]);
      }
      for (const [key, lessons] of bySlot) {
        expect(lessons.length, `${name} slot ${key}`).toBe(1);
      }
    }
  });

  it('keeps the consolidation visible instead of dropping it silently', () => {
    // The lesson is not lost, but the cell that restated it is recorded, so
    // the report shows the file really does author that slot from two sides.
    const restated = Object.entries(parsed.sheets).flatMap(([name, result]) =>
      result.cellOutcomes
        .filter((cell) => cell.restated)
        .map((cell) => `${name} r${cell.row + 1}c${cell.col + 1}`)
    );
    expect(restated.length).toBeGreaterThan(0);
    for (const place of restated) {
      expect(place).toMatch(/^.+ r\d+c\d+$/);
    }
  });

  it('leaves the room number out of the subject', () => {
    // "Кыргызстан географиясы №7 корпус 402 №7 корпус 402" — the room is
    // extracted once and removed from the subject wherever it appears, so the
    // week view does not print the auditorium twice.
    for (const [name, result] of Object.entries(parsed.sheets)) {
      for (const { lesson, provenance } of result.accepted) {
        if (!lesson.room) continue;
        const roomDigits = (lesson.room.match(/\d+/g) ?? []).join('');
        if (!roomDigits) continue;
        const subjectDigits = (lesson.subject.match(/\d+/g) ?? []).join('');
        expect(
          subjectDigits.includes(roomDigits),
          `${name} r${provenance.sourceRow}: "${lesson.subject}" still carries "${lesson.room}"`
        ).toBe(false);
      }
    }
  });
});

describe('a subgroup printed across two columns', () => {
  // The real ПСТ geometry: the header prints `ПСТ-1-25 (2)` merged over two
  // physical columns, so that subgroup is ONE column of the table. A data row
  // can reach it from either side, and the old per-column reading registered
  // the subgroup twice and published the same lesson from both sides.
  const wideHeader = [
    'Апта күндөрү',
    'Паралар',
    'Убакты',
    'ПСТ-1-25 (1)',
    'ПСТ-1-25 (2)',
    '',
    'ПСТ-1-25 (3)',
  ];
  /** The wide header cell: subgroup 2 printed across columns E and F. */
  const WIDE_HEADER_MERGE = [0, 4, 0, 5];
  const PHILOSOPHY = 'Философия пр., №7 корпус  404 Муратов Т.';
  const HEALTH =
    'Саламаттыкты сактоодогу ишкердик жана менеджмент пр.,  №7 корп., 403 Абдураимов К.';

  it('registers the merged header as one group column, not two', () => {
    const result = parse(
      [wideHeader, ['Шаршемби', '2', '09:30-10:50', '', '', '', '']],
      [WIDE_HEADER_MERGE]
    );

    // Three subgroup columns. Read per physical column, the expanded header
    // would instead yield four, with subgroup 2 registered twice.
    expect(result.stats.groupsFound).toBe(3);
  });

  it('publishes one lesson per subgroup when both sides name the same lesson', () => {
    // D8:E8 carries PHILOSOPHY for subgroup 1 and HEALTH for subgroup 2;
    // F8:G8 restates HEALTH for subgroup 2 and PHILOSOPHY for subgroup 3.
    // Subgroup 2 is one column of the table, so it is one lesson.
    const result = parse(
      [
        wideHeader,
        [
          'Шаршемби',
          '2',
          '09:30-10:50',
          `${PHILOSOPHY} / ${HEALTH}`,
          '',
          `${HEALTH} / ${PHILOSOPHY}`,
          '',
        ],
      ],
      [WIDE_HEADER_MERGE, [1, 3, 1, 4], [1, 5, 1, 6]]
    );

    const slots = result.lessons.map((l) => `${l.group}|${l.subgroup}`);
    expect(slots).toEqual(['ПСТ-1-25|1', 'ПСТ-1-25|2', 'ПСТ-1-25|3']);
    // Nothing is lost: each of the three subgroups still has its lesson.
    expect(result.lessons.map((l) => l.subject)).toEqual([
      'Философия',
      'Саламаттыкты сактоодогу ишкердик жана менеджмент',
      'Философия',
    ]);
    expect(result.stats.coverage).toBe(1);
  });

  it('keeps the lesson when only the far side of the wide column is filled', () => {
    // Subgroup 2's OWN first column is empty, so nothing owns it by that rule.
    // The right cell reaches it only through its continuation column, and that
    // lesson must not be dropped for want of an owner.
    const result = parse(
      [
        wideHeader,
        [
          'Шаршемби',
          '2',
          '09:30-10:50',
          'Физика пр., №7 корпус 101 Иванов И.',
          '',
          'Химия пр., №7 корпус 102 Петров П. / Биология пр., №7 корпус 103 Сидоров С.',
          '',
        ],
      ],
      [WIDE_HEADER_MERGE, [1, 5, 1, 6]]
    );

    // All three subgroups keep a lesson, so nothing was lost to the merge.
    const slots = result.lessons.map((lesson) => lesson.subgroup + '/' + lesson.subject).sort();
    expect(slots).toEqual(['1/Физика', '2/Химия', '3/Биология']);
    expect(result.stats.coverage).toBe(1);
  });

  it('keeps two different subjects that one cell assigns to the same subgroup', () => {
    // A single cell naming two lessons, both explicitly for subgroup 1. This is
    // a legitimate second lesson in the same slot, and dropping either one
    // would be data loss — the reason the fix above decides ownership from the
    // sheet geometry and never from comparing lesson text.
    const result = parse(
      [
        wideHeader,
        [
          'Шаршемби',
          '2',
          '09:30-10:50',
          'Физика лаб. гр.1 №7 корпус 101 Иванов И. / Химия лаб. гр.1 №7 корпус 102 Петров П.',
          '',
          '',
          '',
        ],
      ],
      [WIDE_HEADER_MERGE]
    );

    const lessons = result.lessons.filter((l) => l.subgroup === '1');
    expect(lessons).toHaveLength(2);
    expect(lessons.map((l) => l.subject).sort()).toEqual(['Физика гр.1', 'Химия гр.1']);
  });
});

describe('the room must not survive in the subject', () => {
  const simpleHeader = ['Апта күндөрү', 'Паралар', 'Убакты', 'ЛД-1-25 (1)'];

  it('removes the room the subject repeats with the authored spacing', () => {
    // The cell writes "№7 корпус  402" with the author's double space. The
    // extracted room is whitespace-collapsed, so a literal search for it in the
    // un-collapsed text found nothing and the room stayed in the subject.
    const result = parse([
      simpleHeader,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Кыргызстан  географиясы пр., №7 корпус  402 Калмурзаева Р.',
      ],
    ]);

    const [lesson] = result.lessons;
    expect(lesson.room).toBe('№7 корпус 402');
    expect(lesson.subject).toBe('Кыргызстан географиясы');
  });

  it('removes a trailing room written as "№7 корп., 349"', () => {
    const result = parse([
      simpleHeader,
      ['Понедельник', '1', '08:00-09:20', 'Ден соолук билими №7 корп., 349 Асанов А.'],
    ]);

    const [lesson] = result.lessons;
    expect(lesson.room).toBe('№7 корп., 349');
    expect(lesson.subject).toBe('Ден соолук билими');
  });

  it('keeps both subjects of a cell that holds two of them', () => {
    // The slash here separates two different subjects, not a room range, and
    // both have to survive the room being cleaned out of the second one.
    const result = parse([
      simpleHeader,
      [
        'Понедельник',
        '1',
        '08:00-09:20',
        'Педиатрия 2 / Жугуштуу коопсуздук фельдшердик негиздери менен №7 корп. 215 Вакансия 1 ТПиА',
      ],
    ]);

    const [lesson] = result.lessons;
    expect(lesson.room).toBe('№7 корп. 215');
    expect(lesson.subject).toContain('Педиатрия 2');
    expect(lesson.subject).toContain('Жугуштуу коопсуздук фельдшердик негиздери менен');
    // The separator and both subjects are intact; only the repeated room went.
    expect(lesson.subject).toContain('/');
    expect(lesson.subject).not.toContain('215');
  });
});

describe('compatibility surface', () => {
  const rows = [
    header,
    [
      'Понедельник',
      '1',
      '08:00-09:20',
      'Биология пр. ауд. 101 Алиев А.',
      'Химия пр. ауд. 102 Борисов Б.',
    ],
  ];

  it('keeps parseSheetRows returning lessons', () => {
    expect(engine.parseSheetRows(rows)).toHaveLength(2);
  });

  it('keeps parseWorkbook returning lessons per sheet', () => {
    const workbook = { SheetNames: ['ТЕСТ'], Sheets: { ТЕСТ: { '!ref': 'A1:E2' } } };
    const xlsx = { utils: { sheet_to_json: () => rows } };
    const result = EngineForStatic.parse(workbook, xlsx);

    expect(Object.keys(result)).toEqual(['ТЕСТ']);
    expect(result.ТЕСТ).toHaveLength(2);
  });

  it('exposes coverage in the workbook report', () => {
    const workbook = { SheetNames: ['ТЕСТ'], Sheets: { ТЕСТ: { '!ref': 'A1:E2' } } };
    const xlsx = { utils: { sheet_to_json: () => rows } };
    const report = EngineForStatic.parseDetailed(workbook, xlsx).report;

    expect(report).toMatchObject({ sheetCount: 1, coverage: 1, unresolvedCells: 0 });
    expect(report.inRegions).toBeGreaterThan(0);
  });
});

describe('grid materialisation', () => {
  it('copies a merge anchor into every covered cell', () => {
    const grid = buildGrid([['a', '', '']], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);

    expect(grid.cells[0]).toEqual(['a', 'a', 'a']);
  });

  it('does not overwrite a value stored inside a covered cell', () => {
    const grid = buildGrid([['a', 'kept']], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);

    expect(grid.cells[0]).toEqual(['a', 'kept']);
  });

  it('records which cells are continuations so they are not counted twice', () => {
    const grid = buildGrid([['a', '', '']], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);

    expect(grid.continuations.size).toBe(2);
    expect(grid.continuations.get('0,1')).toBe('0,0');
  });

  it('leaves a cell outside the merge untouched', () => {
    const grid = buildGrid([['a', 'b']], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);

    expect(grid.cells[0]).toEqual(['a', 'b']);
  });

  it('normalises cell text so whitespace-only cells read as empty', () => {
    const grid = buildGrid([['  ', 'x ']], null);

    expect(grid.cells[0][0]).toBe('');
    expect(norm(grid.cells[0][1])).toBe('x');
  });
});
