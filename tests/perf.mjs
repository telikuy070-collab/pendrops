import { parseWorkbook } from '../src/sheet.js';
import X from 'xlsx';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
globalThis.XLSX = X;
const t1 = performance.now();
const wb = X.read(buf, { type: 'array', cellDates: true });
const t2 = performance.now();
const sheets = parseWorkbook(wb);
const t3 = performance.now();
const total = Object.values(sheets).reduce((s, a) => s + a.length, 0);
console.log(`Read XLS: ${(t2-t1).toFixed(1)}ms`);
console.log(`Parse:    ${(t3-t2).toFixed(1)}ms (${total} lessons)`);
console.log(`Total:    ${(t3-t1).toFixed(1)}ms`);

// Simulate filter pass
const all = Object.values(sheets).flat();
const t4 = performance.now();
const filtered = all.filter(l => l.group === 'ФЯ-2-25' && l.subgroup === '1');
const t5 = performance.now();
console.log(`Filter:   ${(t5-t4).toFixed(1)}ms (${filtered.length} matches)`);

// Sort by time
const t6 = performance.now();
filtered.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const t7 = performance.now();
console.log(`Sort:     ${(t7-t6).toFixed(1)}ms`);

// Simulate escapeHtml for all fields
const { escapeHtml } = await import('../src/text.js');
const t8 = performance.now();
let totalStr = 0;
for (const l of filtered) {
  totalStr += escapeHtml(l.subject).length + escapeHtml(l.teacher).length + escapeHtml(l.room).length;
}
const t9 = performance.now();
console.log(`Escape:   ${(t9-t8).toFixed(1)}ms (${totalStr} chars)`);
