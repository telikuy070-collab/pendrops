import { TYPE_IDS } from './constants.js';
import { norm } from './text.js';
import { fieldExtractor } from './parser/fieldExtractor.ts';

const GROUP_RE = /^([А-ЯA-ZӨҮҢ]{1,6})[-\s]?(\d{1,2})[-\s]?(\d{2})(?:\s*\(?(\d)\)?)?$/;

export function parseGroupCode(name) {
  if (name == null) return null;
  const original = norm(name);
  let m = original.match(GROUP_RE);
  if (!m) {
    const upper = original.toUpperCase();
    m = upper.match(GROUP_RE);
    if (!m) return null;
    return { code: `${m[1]}-${m[2]}-${m[3]}`, subgroup: m[4] || '1', raw: original };
  }
  return { code: `${m[1]}-${m[2]}-${m[3]}`, subgroup: m[4] || '1', raw: original };
}

/**
 * Преобразует результат fieldExtractor.extractAll в формат, совместимый с существующим кодом
 * Применяет fallback-логику: если тип не определён или OTHER без явного ключевого слова,
 * но есть комната — по умолчанию практика.
 */
function convertExtractedFields(result, rawText) {
  let type = result.type?.value;
  const room = result.room?.value || '';
  const hasRoom = Boolean(room);

  // Проверяем наличие явного ключевого слова типа занятия в исходном тексте
  const hasExplicitTypeKeyword = /(?:^|[\s.,;:])(?:пр|практ|практика|семинар|сем|лаб|лабораторн|лек|лекц|лекция)(?=$|[\s.,;:])/i.test(rawText);

  // Fallback: если тип не определён (null) ИЛИ тип OTHER без явного ключевого слова, но есть комната — по умолчанию практика
  if ((!type || (type === TYPE_IDS.OTHER && !hasExplicitTypeKeyword)) && hasRoom) {
    type = TYPE_IDS.PRACTICE;
  }

  return {
    subject: result.subject.value,
    type: type || TYPE_IDS.OTHER,
    room,
    teacher: result.teacher?.value || '',
    isExam: false,
  };
}

export function parseCell(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'number' && !isFinite(raw)) return null;
  const s = norm(raw);
  if (!s) return null;

  const extracted = fieldExtractor.extractAll(s);
  return convertExtractedFields(extracted, s);
}

export function splitSubs(raw) {
  if (!raw) return [];
  return String(raw)
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}