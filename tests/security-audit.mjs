// Audit view, security, error handling
let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log('OK  ', name); passed++; }
  catch (e) { console.log('FAIL', name, '\n     ', e.message); failed++; }
};

// --- Security: escapeHtml ---
const { escapeHtml } = await import('../src/text.js');

test('escapeHtml: basic', () => { if (escapeHtml('<a>') !== '&lt;a&gt;') throw new Error('basic fail'); });
test('escapeHtml: все опасные символы', () => {
  const r = escapeHtml(`<script>alert("x")</script>'&`);
  if (r.includes('<') || r.includes('>') || r.includes('"') || r.includes("'") || r.includes('&amp;amp;')) {
    throw new Error('не все escape-нуты: ' + r);
  }
});
test('escapeHtml: undefined', () => { if (escapeHtml(undefined) !== '') throw new Error('undefined'); });
test('escapeHtml: null', () => { if (escapeHtml(null) !== '') throw new Error('null'); });
test('escapeHtml: число 0', () => { if (escapeHtml(0) !== '0') throw new Error('число'); });
test('escapeHtml: длинная XSS-полезная нагрузка', () => {
  const r = escapeHtml('<img src=x onerror=alert(document.cookie)>');
  if (r.includes('<') || r.includes('>')) throw new Error('XSS payload не escape-нут: ' + r);
});

// --- parseWorkbook: ошибки ---
const { parseWorkbook, parseSheetRows } = await import('../src/sheet.js');

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length === Object.keys(b).length;

test('parseWorkbook: null', () => { if (!eq(parseWorkbook(null), {})) throw new Error('null'); });
test('parseWorkbook: undefined', () => { if (!eq(parseWorkbook(undefined), {})) throw new Error('undefined'); });
test('parseWorkbook: пустой объект', () => { if (!eq(parseWorkbook({}), {})) throw new Error('empty obj'); });
test('parseWorkbook: без SheetNames', () => { if (!eq(parseWorkbook({ Sheets: {} }), {})) throw new Error('no SheetNames'); });
test('parseWorkbook: SheetNames пустой', () => { if (!eq(parseWorkbook({ SheetNames: [], Sheets: {} }), {})) throw new Error('empty SheetNames'); });
test('parseSheetRows: число', () => { if (!eq(parseSheetRows(42), [])) throw new Error('число'); });
test('parseSheetRows: строка', () => { if (!eq(parseSheetRows('abc'), [])) throw new Error('строка'); });
test('parseSheetRows: объект', () => { if (!eq(parseSheetRows({a:1}), [])) throw new Error('объект'); });

// --- timing edge cases ---
const { parseTimeRange, lessonState, getCurrentTime, getTodayName } = await import('../src/timing.js');

test('lessonState: null lesson', () => { if (lessonState(null, '08:00') !== 'idle') throw new Error('null lesson'); });
test('lessonState: без time', () => { if (lessonState({}, '08:00') !== 'idle') throw new Error('no time'); });
test('lessonState: time=null', () => { if (lessonState({ time: null }, '08:00') !== 'idle') throw new Error('null time'); });
test('parseTimeRange: 24:00', () => { const r = parseTimeRange('24:00'); if (r.start !== '24:00') throw new Error('24:00'); });
test('getCurrentTime: возвращает валидный формат', () => {
  const t = getCurrentTime();
  if (!/^\d{2}:\d{2}$/.test(t)) throw new Error('формат: ' + t);
});
test('getTodayName: возвращает одно из 7 имён', () => {
  const n = getTodayName();
  const valid = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
  if (!valid.includes(n)) throw new Error('invalid: ' + n);
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
