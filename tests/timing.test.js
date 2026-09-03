import { describe, it, expect } from 'vitest';
import { parseTimeRange, lessonState, highlightIndex, getCurrentTime } from '../src/timing.js';

describe('parseTimeRange', () => {
  it('parses range', () => {
    expect(parseTimeRange('08:00-09:20')).toEqual({ start: '08:00', end: '09:20' });
  });
  it('parses with dot separator', () => {
    expect(parseTimeRange('08.00-09.20')).toEqual({ start: '08:00', end: '09:20' });
  });
  it('pads single-digit hours', () => {
    expect(parseTimeRange('8:00-9:20')).toEqual({ start: '08:00', end: '09:20' });
  });
  it('handles single time', () => {
    expect(parseTimeRange('08:00')).toEqual({ start: '08:00', end: null });
  });
  it('returns null for empty', () => {
    expect(parseTimeRange('')).toBe(null);
    expect(parseTimeRange(null)).toBe(null);
  });
});

describe('lessonState', () => {
  it('returns "next" before start', () => {
    expect(lessonState({ time: '08:00-09:20' }, '07:00')).toBe('next');
  });
  it('returns "now" during lesson', () => {
    expect(lessonState({ time: '08:00-09:20' }, '08:30')).toBe('now');
    expect(lessonState({ time: '08:00-09:20' }, '09:20')).toBe('now');
  });
  it('returns "past" after end', () => {
    expect(lessonState({ time: '08:00-09:20' }, '10:00')).toBe('past');
  });
  it('returns "now" without end time', () => {
    expect(lessonState({ time: '08:00' }, '08:30')).toBe('now');
  });
  it('returns "idle" for unparseable time', () => {
    expect(lessonState({ time: '' }, '08:00')).toBe('idle');
  });
});

describe('highlightIndex', () => {
  it('finds "now" lesson', () => {
    const list = [
      { time: '08:00-09:20' },
      { time: '09:30-10:50' },
      { time: '11:40-13:00' }
    ];
    expect(highlightIndex(list, '10:00')).toEqual({ now: 1, next: -1 });
  });
  it('finds "next" lesson when nothing is happening', () => {
    const list = [
      { time: '08:00-09:20' },
      { time: '09:30-10:50' }
    ];
    expect(highlightIndex(list, '07:00')).toEqual({ now: -1, next: 0 });
  });
  it('returns empty when all past', () => {
    const list = [{ time: '08:00-09:20' }];
    expect(highlightIndex(list, '23:00')).toEqual({ now: -1, next: -1 });
  });
});
