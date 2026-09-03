import { describe, it, expect } from 'vitest';
import { detectDay } from '../src/day.js';

describe('detectDay', () => {
  it('maps Kyrgyz days', () => {
    expect(detectDay('Дүйшөмбү')).toBe('Понедельник');
    expect(detectDay('Шейшемби')).toBe('Вторник');
    expect(detectDay('Шаршемби')).toBe('Среда');
    expect(detectDay('Бейшемби')).toBe('Четверг');
    expect(detectDay('Жума')).toBe('Пятница');
    expect(detectDay('Ишемби')).toBe('Суббота');
  });

  it('maps Russian days', () => {
    expect(detectDay('Понедельник')).toBe('Понедельник');
    expect(detectDay('Суббота')).toBe('Суббота');
  });

  it('maps short forms', () => {
    expect(detectDay('пн')).toBe('Понедельник');
    expect(detectDay('ВТ')).toBe('Вторник');
  });

  it('handles whitespace', () => {
    expect(detectDay('  дүйшөмбү  ')).toBe('Понедельник');
  });

  it('returns empty for unknown', () => {
    expect(detectDay('фыва')).toBe('');
    expect(detectDay('')).toBe('');
    expect(detectDay(null)).toBe('');
  });
});
