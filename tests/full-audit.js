import X from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../src/sheet.js';
globalThis.XLSX = X;

const file = process.argv[2];
const buf = readFileSync(file);
const wb = X.read(buf, { type: 'array', cellDates: true });
const sheets = parseWorkbook(wb);

console.log('=== STRUCTURE ===');
for (const name of Object.keys(sheets)) {
  const data = sheets[name];
  const days = new Set(data.map(d => d.day));
  const groups = new Set(data.map(d => d.group));
  const types = data.reduce((acc, d) => { acc[d.type] = (acc[d.type]||0)+1; return acc; }, {});
  console.log(`\n${name}: ${data.length} занятий`);
  console.log(`  Дней: ${[...days].join(', ')}`);
  console.log(`  Групп: ${[...groups].join(', ')}`);
  console.log(`  Типы:`, types);
}

console.log('\n=== SAMPLE: ФЯ-2-25 подгруппа 1 ===');
const sample = (sheets['ФЯ'] || []).filter(l => l.group === 'ФЯ-2-25' && l.subgroup === '1').slice(0, 5);
for (const l of sample) {
  console.log(`  [${l.day}] ${l.time} | ${l.subject} | ${l.teacher} | ${l.room} | ${l.type}`);
}

console.log('\n=== SAMPLE: ЛД-1-23 подгруппа 1 ===');
const sample2 = (sheets['ЛД'] || []).filter(l => l.group === 'ЛД-1-23' && l.subgroup === '1').slice(0, 5);
for (const l of sample2) {
  console.log(`  [${l.day}] ${l.time} | ${l.subject} | ${l.teacher} | ${l.room} | ${l.type}`);
}

console.log('\n=== EDGE CASES ===');
const all = Object.values(sheets).flat();
const noTime = all.filter(l => !l.time).length;
const noSubject = all.filter(l => !l.subject).length;
const noTeacher = all.filter(l => !l.teacher).length;
const noRoom = all.filter(l => !l.room).length;
const noDay = all.filter(l => !l.day).length;
console.log(`  Без времени: ${noTime}`);
console.log(`  Без предмета: ${noSubject}`);
console.log(`  Без преподавателя: ${noTeacher} (${(noTeacher/all.length*100).toFixed(1)}%)`);
console.log(`  Без аудитории: ${noRoom}`);
console.log(`  Без дня: ${noDay}`);

console.log('\n=== TYPE DISTRIBUTION ===');
const tdist = all.reduce((acc, d) => { acc[d.type] = (acc[d.type]||0)+1; return acc; }, {});
console.log(tdist);
