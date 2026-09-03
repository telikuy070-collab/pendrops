import { describe, it, expect } from 'vitest';
import { parseCell, parseGroupCode, splitSubs } from '../src/cell.js';
import { TYPE_IDS } from '../src/constants.js';

describe('parseCell', () => {
  it('detects kurator hour', () => {
    const r = parseCell('Куратордук саат');
    expect(r.subject).toBe('Кураторский час');
    expect(r.type).toBe(TYPE_IDS.OTHER);
  });

  it('detects lecture', () => {
    const r = parseCell('Анатомия лекция №7 корпус 315 Иванов И.И.');
    expect(r.type).toBe(TYPE_IDS.LECTURE);
    expect(r.room).toContain('№7');
    expect(r.teacher).toBe('Иванов И.И.');
  });

  it('detects practice (пр.)', () => {
    const r = parseCell('Фармакология пр., №7 корп., 365 Петров П.П.');
    expect(r.type).toBe(TYPE_IDS.PRACTICE);
    expect(r.teacher).toBe('Петров П.П.');
  });

  it('detects lab', () => {
    const r = parseCell('Химия лабораторная №3 корп. 312 Сидоров С.');
    expect(r.type).toBe(TYPE_IDS.LAB);
  });

  it('defaults to practice when has room but no type keyword', () => {
    const r = parseCell('Фармакология №7 корп., 318 Эрматов А.');
    expect(r.type).toBe(TYPE_IDS.PRACTICE);
    expect(r.teacher).toBe('Эрматов А.');
  });

  it('extracts kyrgyz-style teacher (кызы)', () => {
    const r = parseCell('Фармацевтикалык химия 2 лекция №7 корпус 315 Улукбек кызы Э.');
    expect(r.teacher).toBe('Улукбек кызы Э.');
  });

  it('extracts kyrgyz-style teacher (уулу)', () => {
    const r = parseCell('Дене тарбия пр., спорттук аянтча Кадырбек уулу М.');
    expect(r.teacher).toBe('Кадырбек уулу М.');
  });

  it('handles sport area as room', () => {
    const r = parseCell('Дене тарбия пр., спорттук аянтча Токтобаев А.');
    expect(r.room).toBe('спорттук аянтча');
    expect(r.teacher).toBe('Токтобаев А.');
  });

  it('handles Optika room', () => {
    const r = parseCell('Клиникалык патология пр. Оптика Г. Айтиев Урбай кызы Н.');
    expect(r.room).toBe('Оптика');
    expect(r.teacher).toBe('Айтиев Урбай кызы Н.');
  });

  it('returns null for empty', () => {
    expect(parseCell('')).toBe(null);
    expect(parseCell('   ')).toBe(null);
    expect(parseCell(null)).toBe(null);
  });
});

describe('parseGroupCode', () => {
  it('parses standard code', () => {
    expect(parseGroupCode('СЖ-1-25 (1)')).toEqual({ code: 'СЖ-1-25', subgroup: '1', raw: 'СЖ-1-25 (1)' });
    expect(parseGroupCode('ФЯ-2-24 (2)')).toEqual({ code: 'ФЯ-2-24', subgroup: '2', raw: 'ФЯ-2-24 (2)' });
  });
  it('parses without parens', () => {
    expect(parseGroupCode('ЛД-3-23')).toEqual({ code: 'ЛД-3-23', subgroup: '1', raw: 'ЛД-3-23' });
  });
  it('returns null for non-group', () => {
    expect(parseGroupCode('Апта күндөрү')).toBe(null);
    expect(parseGroupCode('')).toBe(null);
  });
});

describe('splitSubs', () => {
  it('splits by slash', () => {
    expect(splitSubs('Лекция 1 / Лекция 2')).toEqual(['Лекция 1', 'Лекция 2']);
  });
  it('returns empty for empty input', () => {
    expect(splitSubs('')).toEqual([]);
    expect(splitSubs(null)).toEqual([]);
  });
});
