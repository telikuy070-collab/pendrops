import { norm, lower, noSpace } from './text.js';

const DAY_ALIASES = Object.freeze({
  'дүйшөмбү': 'Понедельник', 'дүйшембу': 'Понедельник', 'дуйшембу': 'Понедельник',
  'шейшемби': 'Вторник', 'шаршемби': 'Среда', 'бейшемби': 'Четверг',
  'жума': 'Пятница', 'ишемби': 'Суббота', 'жекшемби': 'Воскресенье',
  'понедельник': 'Понедельник', 'вторник': 'Вторник', 'среда': 'Среда',
  'четверг': 'Четверг', 'пятница': 'Пятница', 'суббота': 'Суббота', 'воскресенье': 'Воскресенье',
  'пн': 'Понедельник', 'вт': 'Вторник', 'ср': 'Среда', 'чт': 'Четверг',
  'пт': 'Пятница', 'сб': 'Суббота', 'вс': 'Воскресенье',
  'mon': 'Понедельник', 'monday': 'Понедельник',
  'tue': 'Вторник', 'tuesday': 'Вторник',
  'wed': 'Среда', 'wednesday': 'Среда',
  'thu': 'Четверг', 'thursday': 'Четверг',
  'fri': 'Пятница', 'friday': 'Пятница',
  'sat': 'Суббота', 'saturday': 'Суббота',
  'sun': 'Воскресенье', 'sunday': 'Воскресенье'
});

export function detectDay(raw) {
  const v = norm(raw);
  if (!v) return '';
  if (DAY_ALIASES[noSpace(v)]) return DAY_ALIASES[noSpace(v)];
  if (DAY_ALIASES[lower(v)]) return DAY_ALIASES[lower(v)];
  for (const key of Object.keys(DAY_ALIASES)) {
    if (lower(v).includes(key)) return DAY_ALIASES[key];
  }
  return '';
}
