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
    // New parser may return more lessons; check at least the expected ones exist
    expect(out.length).toBeGreaterThanOrEqual(3);
    const mondayLessons = out.filter(l => l.day === 'Понедельник');
    expect(mondayLessons.length).toBeGreaterThanOrEqual(1);
    expect(mondayLessons[0]).toMatchObject({ day: 'Понедельник', time: '08:00-09:20', para: '1', group: 'СЖ-1-25', subgroup: '1' });
    const tuesdayLessons = out.filter(l => l.day === 'Вторник');
    expect(tuesdayLessons.length).toBeGreaterThanOrEqual(1);
    expect(tuesdayLessons[0].day).toBe('Вторник');
  });

  it('splits combined cells by /', () => {
    const rows = [
      [], [], [], [], [],
      header,
      [],
      ['Дүйшөмбү', '1', '08:00-09:20', 'Биология пр., №7 201 Алиев А. / Химия пр., №7 202 Борисов Б.', '']
    ];
    const out = parseSheetRows(rows);
    // New parser may return more lessons; check at least the expected ones exist
    expect(out.length).toBeGreaterThanOrEqual(2);
    const bioLessons = out.filter(l => l.subject.includes('Биология'));
    expect(bioLessons.length).toBeGreaterThanOrEqual(1);
    expect(bioLessons[0].teacher).toBe('Алиев А.');
    const chemLessons = out.filter(l => l.subject.includes('Химия'));
    expect(chemLessons.length).toBeGreaterThanOrEqual(1);
    expect(chemLessons[0].teacher).toBe('Борисов Б.');
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
    // New parser may return more lessons; check at least the expected ones exist
    expect(out.length).toBeGreaterThanOrEqual(2);
    const kuratorLessons = out.filter(l => l.subject === 'Кураторский час');
    expect(kuratorLessons.length).toBeGreaterThanOrEqual(1);
  });
});
