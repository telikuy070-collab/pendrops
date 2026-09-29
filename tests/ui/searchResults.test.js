// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSearchResults } from '../../src/view/searchResults.js';

const lesson = (over = {}) => ({
  id: '1',
  sheetId: 'ЛД',
  day: 'Понедельник',
  dayOrder: 0,
  time: '08:00-09:20',
  para: '1',
  group: 'ЛД-11',
  subgroup: '',
  subject: 'Анатомия человека',
  type: 'lecture',
  teacher: 'Иванов И.И.',
  room: '225',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const subgroupPair = (subgroup) => lesson({ id: `s${subgroup}`, subgroup });

function render(results, query = '225') {
  const element = document.createElement('div');
  const onJump = vi.fn();
  renderSearchResults(element, results, { query, onJump });
  return {
    element,
    onJump,
    metas: () => [...element.querySelectorAll('.find-meta')].map((n) => n.textContent),
  };
}

describe('search results block', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is hidden while there is no query', () => {
    const { element } = render([lesson()], '   ');
    expect(element.hidden).toBe(true);
  });

  it('labels the subgroup when one slot holds several of them', () => {
    const { metas } = render([subgroupPair('1'), subgroupPair('2'), subgroupPair('3')]);
    expect(metas()).toEqual([
      '08:00-09:20 · подгр. 1 · 225 · Иванов И.И.',
      '08:00-09:20 · подгр. 2 · 225 · Иванов И.И.',
      '08:00-09:20 · подгр. 3 · 225 · Иванов И.И.',
    ]);
  });

  it('keeps the subgroup out of the way when results do not collide', () => {
    const { metas } = render([
      lesson({ id: 'a' }),
      lesson({ id: 'b', day: 'Вторник', time: '10:00-11:20' }),
    ]);
    expect(metas()).toEqual(['08:00-09:20 · 225 · Иванов И.И.', '10:00-11:20 · 225 · Иванов И.И.']);
  });

  it('escapes the text it renders', () => {
    const { metas } = render([lesson({ teacher: '<img src=x onerror=alert(1)>' })], '225');
    expect(metas()[0]).toContain('<img src=x onerror=alert(1)>');
    expect(element('img')).toBeNull();
  });

  it('jumps to the day of the tapped result', () => {
    const { element, onJump } = render([lesson()], '225');
    element.querySelector('.find-row').click();
    expect(onJump).toHaveBeenCalledWith('Понедельник');
  });
});

function element(tag) {
  return document.querySelector(tag);
}
