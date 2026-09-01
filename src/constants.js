export const DAY_ORDER = Object.freeze([
  'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'
]);

export const JS_DAY_TO_NAME = Object.freeze({
  0: 'Воскресенье', 1: 'Понедельник', 2: 'Вторник', 3: 'Среда',
  4: 'Четверг', 5: 'Пятница', 6: 'Суббота'
});

export const DAY_SHORT = Object.freeze({
  Понедельник: 'Пн', Вторник: 'Вт', Среда: 'Ср', Четверг: 'Чт',
  Пятница: 'Пт', Суббота: 'Сб', Воскресенье: 'Вс'
});

export const PARS_TIMES = Object.freeze([
  { para: 1, start: '08:00', end: '09:20' },
  { para: 2, start: '09:30', end: '10:50' },
  { para: 3, start: '11:40', end: '13:00' },
  { para: 4, start: '13:10', end: '14:30' },
  { para: 5, start: '14:40', end: '15:10' }
]);

export const TYPE_IDS = Object.freeze({
  LECTURE: 'tp-lecture',
  PRACTICE: 'tp-practice',
  LAB: 'tp-lab',
  OTHER: 'tp-other'
});

export const TYPE_LABELS = Object.freeze({
  [TYPE_IDS.LECTURE]: 'Лекция',
  [TYPE_IDS.PRACTICE]: 'Практика',
  [TYPE_IDS.LAB]: 'Лабораторная',
  [TYPE_IDS.OTHER]: 'Занятие'
});

export const STORAGE_KEY = 'schedule:v1';
export const CACHE_NAME = 'schedule-pwa-v4';
export const APP_VERSION = '1.0.0';

export const MAX_HEADER_SCAN_ROWS = 30;
export const MAX_DAY_LOOKAHEAD = 80;
