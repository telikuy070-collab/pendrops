import { TYPE_IDS } from './constants.js';
import { norm, lower } from './text.js';

// Word boundary that works with Cyrillic / Kyrgyz / any Unicode letter.
// JS's built-in \b uses \w = [A-Za-z0-9_] and does NOT recognize Cyrillic as word chars.
const LEFT = '(?:^|[\\s.,;:])';
const RIGHT = '(?=$|[\\s.,;:])';

const GROUP_RE = /^([А-ЯA-ZӨҮҢ]{1,6})[-\s]?(\d{1,2})[-\s]?(\d{2})(?:\s*\(?(\d)\)?)?$/;

// A type keyword must be a standalone word: e.g. "лекция", "лаб.", "пр.", but NOT "лек" inside "электро".
const TYPE_RE = new RegExp(
  LEFT + '(лекция|лек\\.?|лабораторн[а-я]*|лаб\\.?|практика|практ\\.?|пр\\.?|семинар|сем\\.?)' + RIGHT,
  'i'
);

// Detect which type was found.
const TYPE_KEYWORDS_RE = /(лабораторн|лаб\.)|(лекция|лек\.)|(практик|практ\.|пр\.|семинар|сем\.)/i;

// Same: word boundary for Cyrillic
const ROOM_RE = new RegExp(
  LEFT + '((?:корпус|корп\\.?|кор\\.?)\\s*\\d+|спорттук\\s+аянтча|кл\\.\\s*[А-Яа-яA-Za-z0-9 ]+|Оптика|№\\s*\\d+(?:\\s*(?:корпус|корп\\.?|кор\\.?))?(?:\\s*\\d+)?)' + RIGHT,
  'i'
);
const ROOM_STRIP_RE = /(?:корпус|корп\.?|кор\.|спорттук|аянтча|кл\.|Оптика|№\s*\d+)/gi;

const TEACHER_RE = /([А-ЯӨҢҮ][а-яёөңүА-ЯӨҢҮ]{3,}(?:\s+[а-яёөңүА-ЯӨҢҮ]+)*\s+[А-ЯӨҢҮ](?:\.[А-ЯӨҢҮ])?\.?)/g;

const SUBJECT_TRIM_RE = new RegExp(
  LEFT + '(?:лекция|лек\\.?|лабораторн[а-я]*|лаб\\.?|практика|практ\\.?|пр\\.?|семинар|сем\\.?)' + RIGHT,
  'i'
);
const KURATOR_RE = /куратордук|куратор/i;
const NUMBER_RE = /^\d+$/;

/**
 * Detects exam/control work keywords in the subject text.
 * Marks the lesson visually as red + badge "Экзамен/Зачёт/Тест".
 * — Matches whole Cyrillic words: экзамен, экз, зачёт, зачет, тест, кр, контрольная, диф.зачёт
 */
const EXAM_RE = new RegExp(
  '(?:^|[\\s.,;:])' +
  '(' +
    'экзамен|экз\\.?|зачёт|зачет|зач\\.?|тест|диф\\.\\s*зачёт|диф\\.\\s*зачет|контрольн[а-я]*|к\\.\\s*р\\.?|кр|коллоквиум' +
  ')' +
  '(?=$|[\\s.,;:,.])',
  'i'
);

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

export function detectType(text) {
  const tm = TYPE_KEYWORDS_RE.exec(lower(text));
  if (!tm) return TYPE_IDS.OTHER;
  if (tm[1]) return TYPE_IDS.LAB;
  if (tm[2]) return TYPE_IDS.LECTURE;
  if (tm[3]) return TYPE_IDS.PRACTICE;
  return TYPE_IDS.OTHER;
}

function extractSubject(s) {
  const m = s.match(SUBJECT_TRIM_RE);
  if (m) return s.slice(0, m.index).replace(/[\s.,;:]+$/, '');
  const cutAt = s.search(/[,;]|№\s*\d|корп\.?|корпус|спорттук/);
  if (cutAt > 0) return s.slice(0, cutAt).replace(/[\s.,;:]+$/, '');
  return s;
}

function extractRoom(s, subject) {
  const tail = s.slice(subject.length);
  const m = tail.match(ROOM_RE);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim();
}

function extractTeacher(s, subject, room) {
  let tail = s;
  if (room) {
    const idx = tail.lastIndexOf(room);
    if (idx >= 0) tail = tail.slice(idx + room.length);
  }
  tail = tail.replace(/^[,\s]+|[,;]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!tail) return '';
  const matches = [...tail.matchAll(TEACHER_RE)];
  if (!matches.length) return '';
  const cand = matches[matches.length - 1][0].trim().replace(/\s+/g, ' ');
  const words = cand.split(/\s+/);
  if (words.length > 6 || words[0].length < 4) return '';
  return cand;
}

function detectExam(text) {
  if (!text) return false;
  return EXAM_RE.test(text);
}

export function parseCell(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'number' && !isFinite(raw)) return null;
  const s = norm(raw);
  if (!s) return null;
  if (KURATOR_RE.test(s)) {
    return { subject: 'Кураторский час', type: TYPE_IDS.OTHER, room: '', teacher: '', isExam: false };
  }

  const subject = extractSubject(s);
  const rest = s.slice(subject.length);
  let type = detectType(rest);
  if (type === TYPE_IDS.OTHER && /\d/.test(rest) && /(корп|кор\.|ауд|спорттук|аянтча|Оптика)/i.test(rest)) {
    type = TYPE_IDS.PRACTICE;
  }
  const room = extractRoom(s, subject);
  const teacher = extractTeacher(s, subject, room);

  // Detect exam keywords in either the raw text or the trimmed subject.
  const isExam = detectExam(s) || detectExam(subject);

  return {
    subject: subject.replace(/\s+/g, ' ').trim() || s,
    type, room, teacher, isExam
  };
}

export function splitSubs(raw) {
  if (!raw) return [];
  return String(raw).split('/').map((s) => s.trim()).filter(Boolean);
}
