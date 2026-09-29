/**
 * Supabase parser oracle — read-only cross-check, run offline.
 *
 * Answers one question: does parsing the tracked workbook still reproduce what
 * `publish-schedule` actually wrote to the production `lessons` table?
 *
 * Safety contract (enforced by construction, asserted in tests):
 * - the Supabase **anon** key only, so RLS applies exactly as it does for every
 *   student client; the service-role key is never read, even when present in
 *   `.env`;
 * - SELECT statements only — there is no insert/update/delete/rpc call in this
 *   file;
 * - it prints counts, ratios and column names only. It never prints a key, a
 *   URL, a subject, a teacher, a room or a full schedule row.
 *
 * This script is deliberately NOT part of CI: it needs production credentials
 * and network access. It feeds `docs/PRODUCTION_PREFLIGHT.md` and is the
 * evidence that would let a fixture be promoted from `blocked` to `active`.
 *
 * Usage:
 *   npm run verify:oracle                # report only
 *   npm run verify:oracle -- --promote   # emit the oracle + flip the manifest
 *
 * `--promote` refuses to run unless every threshold is met.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as NodeXLSX from 'xlsx';
import {
  PARSER_CONTRACT_VERSION,
  ParserEngine,
  type ParseWorkbookResult,
} from '../src/parser/engine.ts';
import { toPublishDraft } from '../src/parser/draft.ts';
import {
  ORACLE_THRESHOLDS,
  buildOracleRecords,
  measureAgainstOracle,
  oracleMetricsText,
  oraclePasses,
  type OracleRow,
} from './oracle-core.ts';

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/** Minimal `.env` reader: the script must work without loading the whole file. */
function readEnvValues(envPath: string): Record<string, string> {
  const values: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function fetchLessons(
  url: string,
  key: string
): Promise<{ rows: OracleRow[]; error?: string }> {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const rows: OracleRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    // Read-only. The anon role is subject to the same RLS as the PWA.
    const { data, error } = await client
      .from('lessons')
      .select(
        'sheet_id, day, time, para, group_code, subgroup, subject, type, teacher, room, is_exam'
      )
      .range(from, to);

    if (error) return { rows, error: error.message };
    if (!Array.isArray(data)) return { rows, error: 'unexpected response shape' };
    rows.push(...(data as OracleRow[]));
    if (data.length < PAGE_SIZE) return { rows };
  }

  return { rows, error: `row cap reached after ${MAX_PAGES} pages` };
}

function parseTrackedWorkbook(sourcePath: string): ParseWorkbookResult {
  const bytes = readFileSync(sourcePath);
  const workbook = NodeXLSX.read(bytes, { type: 'buffer', cellDates: true });
  return new ParserEngine().parseWorkbookDetailed(workbook, NodeXLSX);
}

async function main(): Promise<void> {
  const promote = process.argv.includes('--promote');
  const source = resolve('data/schedule.xls');
  const env = readEnvValues(resolve('.env'));

  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('[oracle] UNAVAILABLE VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set');
    process.exitCode = 2;
    return;
  }

  const parsed = parseTrackedWorkbook(source);
  const { lessons, report } = toPublishDraft(parsed);
  console.log(`[oracle] parser source=data/schedule.xls contract=${PARSER_CONTRACT_VERSION}`);
  console.log(`[oracle] parser report=${JSON.stringify(report)} draftRecords=${lessons.length}`);

  const { rows, error } = await fetchLessons(url, key);
  if (error) {
    console.error(`[oracle] UNAVAILABLE lessons query failed: ${error}`);
    process.exitCode = 2;
    return;
  }

  const metrics = measureAgainstOracle(lessons, rows);
  const passed = oraclePasses(metrics, ORACLE_THRESHOLDS);

  console.log(`[oracle] production rows (lessons)=${rows.length}`);
  console.log(`[oracle] ${oracleMetricsText(metrics)}`);
  console.log(
    `[oracle] thresholds=${JSON.stringify(ORACLE_THRESHOLDS)} verdict=${
      passed ? 'MATCH' : 'MISMATCH'
    }`
  );

  if (!passed) {
    console.error(
      '[oracle] Parser output does not reproduce the production table. ' +
        'Fixtures stay blocked; no accuracy claim may be made from the parser alone.'
    );
    process.exitCode = 1;
    return;
  }

  if (!promote) {
    console.log('[oracle] Aggregates match. Re-run with --promote to emit the oracle.');
    return;
  }

  // Only reached when every threshold is met. The lesson values come from the
  // production table (the independent authority); only the grid coordinates
  // come from the parser, because `lessons` stores no provenance.
  // `docs/PRODUCTION_PREFLIGHT.md` documents that limitation explicitly.
  const oraclePath = resolve('tests/fixtures/real/schedule-tracked.expected.json');

  // Flatten accepted outcomes in the same order `toPublishDraft` produced them.
  const provenances: Array<{
    sheetName: string;
    sourceRow: number;
    sourceColumn: number;
    partIndex: number;
  }> = [];
  for (const [sheetName, sheet] of Object.entries(parsed.sheets)) {
    for (const outcome of sheet.accepted) {
      provenances.push({
        sheetName,
        sourceRow: outcome.provenance.sourceRow,
        sourceColumn: outcome.provenance.sourceColumn,
        partIndex: outcome.provenance.partIndex,
      });
    }
  }

  const records = buildOracleRecords(lessons, rows, (index) => provenances[index]);
  if (records.length !== lessons.length) {
    console.error(
      `[oracle] REFUSING to promote: only ${records.length}/${lessons.length} parser records ` +
        'align with a production row.'
    );
    process.exitCode = 1;
    return;
  }

  writeFileSync(
    oraclePath,
    `${JSON.stringify(
      {
        parserContractVersion: PARSER_CONTRACT_VERSION,
        reviewedBy: 'supabase-oracle',
        reviewedAt: new Date().toISOString().slice(0, 10),
        provenanceSource: 'parser-grid-coordinates+supabase-lesson-values',
        records,
        rejectedOutcomes: [],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  console.log(`[oracle] Wrote ${oraclePath} (${records.length} records)`);
}

await main();
