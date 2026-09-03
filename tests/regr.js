import X from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../src/sheet.js';
globalThis.XLSX = X;

const file = process.argv[2];
const buf = readFileSync(file);
const wb = X.read(buf, { type: 'array', cellDates: true });
const sheets = parseWorkbook(wb);
let total = 0, withT = 0;
for (const n of Object.keys(sheets)) {
  const a = sheets[n];
  total += a.length;
  withT += a.filter((r) => r.teacher).length;
  console.log(n + ': ' + a.length);
}
console.log('TOTAL:', total, 'with teacher:', withT, '(' + Math.round(withT / total * 100) + '%)');
