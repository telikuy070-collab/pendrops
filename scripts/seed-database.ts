/**
 * Database Seed Script - Run once to populate Supabase from Excel
 * Usage: npx tsx scripts/seed-database.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../src/sheet.js';

// Load env
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function seed() {
  console.log('[Seed] Reading Excel file...');
  const buffer = readFileSync('data/schedule.xls');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets = parseWorkbook(workbook, XLSX);

  const allLessons = [];
  const DAY_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресеньe'];
  const dayOrderMap = new Map();
  DAY_ORDER.forEach((d, i) => dayOrderMap.set(d, i));

  for (const [sheetName, lessons] of Object.entries(sheets)) {
    for (const lesson of lessons) {
      allLessons.push({
        sheet_id: sheetName,
        day: lesson.day,
        day_order: dayOrderMap.get(lesson.day) || 0,
        time: lesson.time,
        para: lesson.para,
        group_code: lesson.group,
        subgroup: lesson.subgroup || null,
        subject: lesson.subject,
        type: lesson.type,
        teacher: lesson.teacher || null,
        room: lesson.room || null,
        is_exam: lesson.isExam,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }

  console.log(`[Seed] Parsed ${allLessons.length} lessons from ${Object.keys(sheets).length} sheets`);

  // Clear existing data
  console.log('[Seed] Clearing existing lessons...');
  const { error: deleteError } = await supabase
    .from('lessons')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  
  if (deleteError) {
    console.error('[Seed] Delete failed:', deleteError);
    process.exit(1);
  }

  // Insert in batches
  const batchSize = 500;
  for (let i = 0; i < allLessons.length; i += batchSize) {
    const batch = allLessons.slice(i, i + batchSize);
    const { error } = await supabase.from('lessons').insert(batch);
    if (error) {
      console.error(`[Seed] Batch ${i} failed:`, error);
      process.exit(1);
    }
    console.log(`[Seed] Inserted batch ${i} (${batch.length} lessons)`);
  }

  // Update version
  const version = `W${new Date().getWeek()}-${new Date().getFullYear()}`;
  const { error: versionError } = await supabase
    .from('schedule_version')
    .upsert({
      id: 1,
      version,
      updated_at: new Date().toISOString(),
      file_name: 'schedule.xls',
      file_size: buffer.length
    });

  if (versionError) {
    console.error('[Seed] Version update failed:', versionError);
    process.exit(1);
  }

  console.log('[Seed] Done! Version:', version);
}

// Add getWeek to Date prototype
declare global {
  interface Date {
    getWeek(): number;
  }
}
Date.prototype.getWeek = function() {
  const date = new Date(this.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

seed().catch(console.error);