import { describe, it, expect } from 'vitest';
import { parseSheetRows } from '../src/sheet.js';

const header = ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)'];

describe('parseSheetRows', () => {
  it('parses 1st column 1st day first slot', () => {
    const rows = [
      [], [], [], [], [],
      header,
      [],
      ['Дүйшөмбү', '1', '08:00-09:20', 'Анатомия лекция №7 корпус 315 Иванов И.И.', 'Химия пр. №7 320 Петров П.П.'],
      ['Вторник', '2', '09:30-10:50', 'Физика лаб. №3 105 Сидоров С.', '']
    ];
    const out = parseSheetRows(rows);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ day: 'Понедельник', time: '08:00-09:20', para: '1', group: 'СЖ-1-25', subgroup: '1', teacher: 'Иванов И.И.' });
    expect(out[1].group).toBe('СЖ-1-25');
    expect(out[1].subgroup).toBe('2');
    expect(out[2].day).toBe('Вторник');
  });

  it('splits combined cells by /', () => {
    const rows = [
      [], [], [], [], [],
      header,
      [],
      ['Дүйшөмбү', '1', '08:00-09:20', 'Биология пр., №7 201 Алиев А. / Химия пр., №7 202 Борисов Б.', '']
    ];
    const out = parseSheetRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0].subject).toContain('Биология');
    expect(out[0].teacher).toBe('Алиев А.');
    expect(out[1].subject).toContain('Химия');
    expect(out[1].teacher).toBe('Борисов Б.');
  });

  it('returns empty for empty input', () => {
    expect(parseSheetRows([])).toEqual([]);
    expect(parseSheetRows(null)).toEqual([]);
  });

  it('handles kurator hour', () => {
    const rows = [
      [], [], [], [], [],
      header,
      [],
      ['Бейшемби', '5', '14:40-15:10', 'Куратордук саат', 'Куратордук саат']
    ];
    const out = parseSheetRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0].subject).toBe('Кураторский час');
  });
});
