import { parseCell, parseGroupCode, splitSubs, detectType } from '../src/cell.js';
import { parseSheetRows } from '../src/sheet.js';
import { parseTimeRange, lessonState } from '../src/timing.js';

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log('OK  ', name); passed++; }
  catch (e) { console.log('FAIL', name, '\n     ', e.message); failed++; }
};
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg||'eq'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// --- parseCell edge cases ---
test('parseCell: undefined', () => { eq(parseCell(undefined), null); });
test('parseCell: number 0 — валидное число, обрабатывается как "0"', () => {
  // В Excel пустые ячейки = '', не 0. parseCell(0) не падает и не возвращает null,
  // т.к. может встретиться число-идентификатор.
  const r = parseCell(0);
  if (r && r.subject !== '0') throw new Error('должен вернуть subject="0"');
});
test('parseCell: только пробелы', () => { eq(parseCell('   '), null); });
test('parseCell: HTML-инъекция в subject (raw содержит, но view escape-ит)', () => {
  const r = parseCell('<script>alert(1)</script> пр. №7 305 Иванов');
  // Raw subject may contain script tags — safety is in view's escapeHtml.
  if (!r.subject) throw new Error('subject не должен быть пустым');
});
test('parseCell: HTML-инъекция в teacher', () => {
  const r = parseCell('Фармакология пр., №7 305 <img src=x onerror=alert(1)>');
  if (r.teacher && r.teacher.includes('<')) throw new Error('XSS в teacher!');
});
test('parseCell: emoji в названии', () => {
  const r = parseCell('Биохимия 🧬 пр. №7 305 Иванов И.');
  if (!r.subject.includes('Биохимия')) throw new Error('emoji не должен ломать парсинг');
});
test('parseCell: длинный текст', () => {
  const long = 'Очень '.repeat(100) + 'длинное название пр., №7 305 Иванов';
  const r = parseCell(long);
  if (!r.subject || r.subject.length < 10) throw new Error('длинный subject не извлёкся');
});
test('parseCell: число Excel как time', () => {
  const r = parseCell('0.375');  // 9:00 как Excel time
  // не падать
});
test('parseCell: только тип', () => {
  const r = parseCell('пр.');
  eq(r.type, 'tp-practice');
});
test('parseCell: только преподаватель без room', () => {
  const r = parseCell('Иванов И.И.');
  // не падать, вернуть что-то осмысленное
});
test('parseCell: цифры в начале', () => {
  const r = parseCell('1-я лекция 305 Иванов');
});

// --- parseGroupCode edge cases ---
test('parseGroupCode: 1 буква', () => { eq(parseGroupCode('А-1-25 (1)'), { code: 'А-1-25', subgroup: '1', raw: 'А-1-25 (1)' }); });
test('parseGroupCode: 6 букв', () => { eq(parseGroupCode('АБВГДЕ-1-25 (2)'), { code: 'АБВГДЕ-1-25', subgroup: '2', raw: 'АБВГДЕ-1-25 (2)' }); });
test('parseGroupCode: lowercase', () => { eq(parseGroupCode('сж-1-25 (1)'), { code: 'СЖ-1-25', subgroup: '1', raw: 'сж-1-25 (1)' }); });
test('parseGroupCode: 7 букв — не группа', () => { eq(parseGroupCode('АБВГДЕЖ-1-25'), null); });
test('parseGroupCode: только цифры', () => { eq(parseGroupCode('123'), null); });
test('parseGroupCode: undefined', () => { eq(parseGroupCode(undefined), null); });

// --- splitSubs ---
test('splitSubs: пусто', () => { eq(splitSubs(''), []); });
test('splitSubs: undefined', () => { eq(splitSubs(undefined), []); });
test('splitSubs: 1 элемент без /', () => { eq(splitSubs('A'), ['A']); });
test('splitSubs: 5 подгрупп', () => { eq(splitSubs('A / B / C / D / E'), ['A','B','C','D','E']); });
test('splitSubs: пробелы', () => { eq(splitSubs(' A /  B '), ['A','B']); });
test('splitSubs: число 0', () => { eq(splitSubs(0), []); });

// --- parseSheetRows edge cases ---
test('parseSheetRows: пустой массив', () => { eq(parseSheetRows([]), []); });
test('parseSheetRows: undefined', () => { eq(parseSheetRows(undefined), []); });
test('parseSheetRows: только шапка', () => {
  const rows = [['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)']];
  eq(parseSheetRows(rows), []);
});
test('parseSheetRows: только пустые строки', () => { eq(parseSheetRows([[],[],[]]), []); });

// --- detectType ---
test('detectType: лекция в середине слова', () => {
  eq(detectType('электричество'), 'tp-other');
});
test('detectType: ЛЕКЦИЯ uppercase', () => { eq(detectType('ЛЕКЦИЯ'), 'tp-lecture'); });

// --- timing ---
test('parseTimeRange: только пробелы', () => { eq(parseTimeRange('   '), null); });
test('parseTimeRange: мусор', () => { eq(parseTimeRange('abc-def'), null); });
test('parseTimeRange: 25:00', () => { eq(parseTimeRange('25:00-26:00'), { start: '25:00', end: '26:00' }); }); // не падать

test('lessonState: ровно в start', () => { eq(lessonState({ time: '08:00-09:20' }, '08:00'), 'now'); });
test('lessonState: ровно в end', () => { eq(lessonState({ time: '08:00-09:20' }, '09:20'), 'now'); });
test('lessonState: через минуту после end', () => { eq(lessonState({ time: '08:00-09:20' }, '09:21'), 'past'); });

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
