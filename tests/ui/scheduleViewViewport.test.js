// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScheduleView } from '../../src/view/scheduleView.js';

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
  room: '201',
  isExam: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

/**
 * jsdom ships neither ResizeObserver nor a configurable matchMedia, so the
 * viewport is driven the way the app sees it: a media query the test flips and
 * a ResizeObserver callback the test fires.
 */
function installViewport() {
  const state = { mobile: false, notify: () => {} };

  window.matchMedia = vi.fn((query) => ({
    media: query,
    get matches() {
      return state.mobile;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));

  globalThis.ResizeObserver = class {
    constructor(callback) {
      state.notify = () => callback([]);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  return state;
}

describe('schedule view and the viewport', () => {
  let viewport;
  let container;

  beforeEach(() => {
    viewport = installViewport();
    // jsdom implements no scrolling, which showDay() uses to keep the active
    // pill visible; without the stub the click handler throws.
    Element.prototype.scrollIntoView = () => {};
    document.body.innerHTML = '<div id="scheduleContainer"></div>';
    container = document.getElementById('scheduleContainer');
  });

  it('draws the day without pills on a desktop width', () => {
    const view = createScheduleView(container);
    view.render([lesson()], { today: 'Понедельник' });
    expect(container.querySelector('.day')).not.toBeNull();
    expect(container.querySelector('.day-pills')).toBeNull();
  });

  it('re-renders into the mobile layout when the viewport becomes narrow', () => {
    const view = createScheduleView(container);
    view.render([lesson(), lesson({ id: '2', day: 'Вторник' })], { today: 'Понедельник' });
    expect(container.querySelector('.day-pills')).toBeNull();

    viewport.mobile = true;
    viewport.notify();

    const pills = container.querySelectorAll('.day-pill');
    expect(pills.length).toBe(2);
    expect(container.querySelector('.day-carousel')).not.toBeNull();
  });

  it('re-renders back to the desktop layout when the viewport widens', () => {
    viewport.mobile = true;
    const view = createScheduleView(container);
    view.render([lesson()], { today: 'Понедельник' });
    expect(container.querySelector('.day-pills')).not.toBeNull();

    viewport.mobile = false;
    viewport.notify();

    expect(container.querySelector('.day-pills')).toBeNull();
    expect(container.querySelector('.day')).not.toBeNull();
  });

  it('keeps the selected day across a viewport change', () => {
    viewport.mobile = true;
    const view = createScheduleView(container);
    view.render([lesson(), lesson({ id: '2', day: 'Вторник' })], { today: 'Понедельник' });
    container.querySelectorAll('.day-pill')[1].click();

    viewport.mobile = false;
    viewport.notify();

    const active = container.querySelector('.day.active') || container.querySelector('.day');
    expect(active.dataset.day).toBe('Вторник');
  });

  it('does not re-render when the width changes within the same layout', () => {
    const view = createScheduleView(container);
    view.render([lesson()], { today: 'Понедельник' });
    const before = container.innerHTML;

    viewport.notify();

    expect(container.innerHTML).toBe(before);
  });
});
