// @vitest-environment jsdom
/**
 * The admin preview must work in the browser, where SheetJS only exists as the
 * `window.XLSX` global loaded from the vendored bundle. jsdom is configured
 * without resource loading, so a preview that tried to inject
 * `xlsx.full.min.js` instead of reading the global could not resolve at all —
 * these tests therefore fail loudly if that path ever changes.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import * as NodeXLSX from 'xlsx';
import { ExcelFileParser } from '../../src/infrastructure/github/parser.ts';
import { ParserEngine } from '../../src/parser/engine.ts';
import { buildPreviewView } from '../../src/admin/preview.ts';

const ROWS = [
  ['Апта күндөрү', 'Паралар', 'Убакты', 'СЖ-1-25 (1)', 'СЖ-1-25 (2)'],
  [
    'Понедельник',
    '1',
    '08:00-09:20',
    'Биология пр. ауд. 101 Алиев А.',
    'Химия лекция ауд. 102 Борисов Б.',
  ],
  ['', '', '', 'Физика лаб. кл. каб 103 Петров П. /', ''],
  ['Вторник', '2', '09:30-10:50', 'Математика экзамен', 'Куратордук саат'],
];

/** Loads the vendored SheetJS into a jsdom window and into this one. */
async function loadVendoredXLSX() {
  const bundle = await readFile(resolve('public/xlsx.full.min.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
  });
  const script = dom.window.document.createElement('script');
  script.textContent = bundle;
  dom.window.document.head.appendChild(script);
  window.XLSX = dom.window.XLSX;
  return dom;
}

function workbookBytes() {
  const workbook = NodeXLSX.utils.book_new();
  NodeXLSX.utils.book_append_sheet(workbook, NodeXLSX.utils.aoa_to_sheet(ROWS), 'СЖ');
  const buffer = NodeXLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  const bytes = new Uint8Array(buffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('admin preview in the browser', () => {
  it('parses a real workbook through the window.XLSX global', async () => {
    const dom = await loadVendoredXLSX();

    const preview = await new ExcelFileParser().previewWorkbook(workbookBytes());

    expect(preview.sheets).toHaveLength(1);
    expect(preview.sheets[0].sheetName).toBe('СЖ');
    expect(preview.sheets[0].lessonCount).toBeGreaterThan(0);
    expect(preview.days).toEqual(['Понедельник', 'Вторник']);

    dom.window.close();
  });

  it('agrees with the engine the offline oracle runs', async () => {
    const dom = await loadVendoredXLSX();
    const workbook = NodeXLSX.utils.book_new();
    NodeXLSX.utils.book_append_sheet(workbook, NodeXLSX.utils.aoa_to_sheet(ROWS), 'СЖ');
    const engine = new ParserEngine().parseWorkbookDetailed(workbook, NodeXLSX);

    const preview = await new ExcelFileParser().previewWorkbook(workbookBytes());

    expect(preview.report).toEqual(engine.report);
    expect(preview.sheets[0].lessonCount).toBe(engine.sheets['СЖ'].stats.acceptedCount);
    expect(preview.sheets[0].stats.coverage).toBe(engine.sheets['СЖ'].stats.coverage);
    expect(preview.draft.lessons).toHaveLength(engine.report.acceptedCount);

    dom.window.close();
  });

  it('produces a view the admin can read', async () => {
    const dom = await loadVendoredXLSX();

    const preview = await new ExcelFileParser().previewWorkbook(workbookBytes());
    const view = buildPreviewView(preview, null);

    expect(view.totalLessons).toBe(preview.draft.lessons.length);
    expect(view.coverageText).toMatch(/^\d+([,.]\d+)?%$/);
    expect(view.sheets[0].sheetId).toBe('СЖ');
    expect(view.diff.nextTotal).toBe(view.totalLessons);
    // Nothing is live in this scenario, so every lesson counts as new.
    expect(view.diff.currentTotal).toBe(0);

    dom.window.close();
  });

  it('reuses the preview draft instead of parsing the file again', async () => {
    const dom = await loadVendoredXLSX();
    const parser = new ExcelFileParser();
    const bytes = workbookBytes();

    const first = await parser.previewWorkbook(bytes);
    const second = await parser.previewWorkbook(bytes);

    expect(second.draft.lessons).toEqual(first.draft.lessons);
    expect(second.report).toEqual(first.report);

    dom.window.close();
  });
});
