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

export function parseGroupCode(name) {
  if (name == null) return null;
  const original = norm(name);
  // Try the original string first, then uppercase (handles lowercase group codes).
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
  // First, find the type keyword (лекция, пр., лаб., etc.) — that's where subject ends.
  const m = s.match(SUBJECT_TRIM_RE);
  if (m) {
    // Cut everything from the start of the type keyword (and any preceding space/punct).
    return s.slice(0, m.index).replace(/[\s.,;:]+$/, '');
  }
  // No type keyword → take everything up to first comma, semicolon, room, or teacher marker.
  const cutAt = s.search(/[,;]|№\s*\d|корп\.?|корпус|спорттук/);
  if (cutAt > 0) return s.slice(0, cutAt).replace(/[\s.,;:]+$/, '');
  return s;
}

function extractRoom(s, subject) {
  // Look in the part after the subject.
  const tail = s.slice(subject.length);
  const m = tail.match(ROOM_RE);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim();
}

function extractTeacher(s, subject, room) {
  // Strip everything up to & including the room, then find the teacher in the remaining tail.
  let tail = s;
  if (room) {
    const idx = tail.lastIndexOf(room);
    if (idx >= 0) tail = tail.slice(idx + room.length);
  }
  // Trim only leading whitespace and trailing commas/semicolons — keep trailing dot for "И.И."
  tail = tail.replace(/^[,\s]+|[,;]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!tail) return '';
  const matches = [...tail.matchAll(TEACHER_RE)];
  if (!matches.length) return '';
  const cand = matches[matches.length - 1][0].trim().replace(/\s+/g, ' ');
  const words = cand.split(/\s+/);
  if (words.length > 6 || words[0].length < 4) return '';
  return cand;
}

export function parseCell(raw) {
  // Reject null/undefined/non-string-non-number/non-finite values.
  if (raw == null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'number' && !isFinite(raw)) return null;
  const s = norm(raw);
  if (!s) return null;
  if (KURATOR_RE.test(s)) {
    return { subject: 'Кураторский час', type: TYPE_IDS.OTHER, room: '', teacher: '' };
  }

  // 1. Subject first (cut at the type keyword or first room/separator).
  const subject = extractSubject(s);

  // 2. Type — look only in the part AFTER the subject to avoid matching
  // "лаб" inside "лаборатория" which is part of the subject.
  const rest = s.slice(subject.length);
  let type = detectType(rest);
  if (type === TYPE_IDS.OTHER && /\d/.test(rest) && /(корп|кор\.|ауд|спорттук|аянтча|Оптика)/i.test(rest)) {
    type = TYPE_IDS.PRACTICE;
  }

  // 3. Room — look only after the subject.
  const room = extractRoom(s, subject);

  // 4. Teacher — look only after the room.
  const teacher = extractTeacher(s, subject, room);

  return {
    subject: subject.replace(/\s+/g, ' ').trim() || s,
    type, room, teacher
  };
}

export function splitSubs(raw) {
  if (!raw) return [];
  return String(raw).split('/').map((s) => s.trim()).filter(Boolean);
}
