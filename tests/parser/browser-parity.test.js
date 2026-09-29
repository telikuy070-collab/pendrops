// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import * as NodeXLSX from 'xlsx';
import { ExcelFileParser } from '../../src/infrastructure/github/parser.ts';
import { ParserEngine } from '../../src/parser/engine.ts';

function canonicalProjection(result) {
  return {
    report: result.report,
    sheets: Object.fromEntries(
      Object.entries(result.sheets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, sheet]) => [
          name,
          {
            ...sheet,
            outcomes: [...sheet.outcomes].sort((left, right) =>
              JSON.stringify(left.provenance).localeCompare(JSON.stringify(right.provenance))
            ),
          },
        ])
    ),
  };
}

describe('Node/browser parser parity infrastructure', () => {
  it('uses the same parser core and vendored SheetJS version for identical bytes', async () => {
    const sourceRows = [
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
    const nodeWorkbook = NodeXLSX.utils.book_new();
    NodeXLSX.utils.book_append_sheet(nodeWorkbook, NodeXLSX.utils.aoa_to_sheet(sourceRows), 'ПСТ');
    const buffer = NodeXLSX.write(nodeWorkbook, { bookType: 'xlsx', type: 'buffer' });
    const bytes = new Uint8Array(buffer);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const bundle = await readFile(resolve('public/xlsx.full.min.js'), 'utf8');
    const browserDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      runScripts: 'dangerously',
    });
    const script = browserDom.window.document.createElement('script');
    script.textContent = bundle;
    browserDom.window.document.head.appendChild(script);
    const browserXLSX = browserDom.window.XLSX;
    window.XLSX = browserXLSX;

    expect(browserXLSX.version).toBe(NodeXLSX.version);

    const browserWorkbook = await new ExcelFileParser().parseExcel(arrayBuffer);
    const nodeParsed = new ParserEngine().parseWorkbookDetailed(nodeWorkbook, NodeXLSX);
    const browserParsed = new ParserEngine().parseWorkbookDetailed(browserWorkbook, browserXLSX);

    expect(JSON.stringify(canonicalProjection(browserParsed))).toBe(
      JSON.stringify(canonicalProjection(nodeParsed))
    );
    expect(nodeParsed.report.acceptedCount).toBeGreaterThan(0);

    browserDom.window.close();
  });
});
