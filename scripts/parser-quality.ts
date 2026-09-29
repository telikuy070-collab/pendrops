import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import * as NodeXLSX from 'xlsx';
import {
  PARSER_CONTRACT_VERSION,
  ParserEngine,
  type ParseProvenance,
  type ParseWorkbookResult,
} from '../src/parser/engine.ts';
import {
  CRITICAL_FIELDS,
  addMetrics,
  classifyFixture,
  emptyMetrics,
  measure,
  passes,
  runStatus,
  type CriticalField,
  type HumanReviewedRecord,
  type OracleReadResult,
  type QualityMetrics,
  type QualityMode,
} from './parser-quality-core.ts';

interface FixtureManifestEntry {
  id: string;
  source: string;
  sourcePolicy: 'tracked-real' | 'local-ignored-real';
  expected: string;
  status: 'active' | 'blocked';
  blockedReason?: string;
}

interface CorpusManifest {
  parserContractVersion: string;
  thresholds: {
    recordAccuracy: number;
    precision: number;
    recall: number;
    criticalFields: number;
  };
  fixtures: FixtureManifestEntry[];
}

interface HumanReviewedOracle {
  parserContractVersion: string;
  sourceSha256: string;
  reviewedBy: string;
  reviewedAt: string;
  records: HumanReviewedRecord[];
  rejectedOutcomes: Array<{
    code: string;
    sheetName: string;
    sourceRow: number;
    sourceColumn: number;
    partIndex: number;
  }>;
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function diagnosticKey(outcome: Record<string, any>): string {
  return JSON.stringify([
    outcome.code,
    outcome.provenance.sheetName,
    outcome.provenance.sourceRow,
    outcome.provenance.sourceColumn,
    outcome.provenance.partIndex,
  ]);
}

function canonicalProjection(result: ParseWorkbookResult): unknown {
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

function deterministicHash(result: ParseWorkbookResult): string {
  return sha256(JSON.stringify(canonicalProjection(result)));
}

function assertParserInvariants(result: ParseWorkbookResult): void {
  if (result.report.candidateCount !== result.report.acceptedCount + result.report.rejectedCount) {
    throw new Error(
      'No-silent-drops invariant failed: candidateCount != acceptedCount + rejectedCount'
    );
  }
  for (const sheet of Object.values(result.sheets)) {
    if (sheet.stats.candidateCount !== sheet.stats.acceptedCount + sheet.stats.rejectedCount) {
      throw new Error(`No-silent-drops invariant failed for sheet ${sheet.sheetName}`);
    }
  }
}

function isProvenance(value: unknown): value is ParseProvenance {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sheetName === 'string' &&
    Number.isInteger(candidate.sourceRow) &&
    Number.isInteger(candidate.sourceColumn) &&
    Number.isInteger(candidate.partIndex)
  );
}

function blocked(reason: string): OracleReadResult<HumanReviewedOracle> {
  return { status: 'blocked', reason };
}

function loadOracle(
  entry: FixtureManifestEntry,
  sourceHash: string
): OracleReadResult<HumanReviewedOracle> {
  if (!existsSync(entry.expected)) {
    return blocked(`Human-reviewed oracle is missing: ${entry.expected}`);
  }

  let oracle: HumanReviewedOracle;
  try {
    oracle = JSON.parse(readFileSync(entry.expected, 'utf8')) as HumanReviewedOracle;
  } catch (error) {
    return blocked(
      `Human-reviewed oracle cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (oracle.parserContractVersion !== PARSER_CONTRACT_VERSION) {
    return blocked(
      `Oracle parser contract ${oracle.parserContractVersion} does not match runtime ${PARSER_CONTRACT_VERSION}`
    );
  }
  if (oracle.sourceSha256 !== sourceHash) {
    return blocked('Oracle source SHA-256 does not match the workbook');
  }
  if (!oracle.reviewedBy || !oracle.reviewedAt || !Array.isArray(oracle.records)) {
    return blocked('Oracle lacks human review metadata or records');
  }
  if (!Array.isArray(oracle.rejectedOutcomes)) {
    return blocked('Oracle lacks rejected outcome expectations');
  }
  if (oracle.records.length === 0) {
    return blocked('Oracle is empty and cannot satisfy the quality gate');
  }

  const provenanceKeys = new Set<string>();
  for (const [index, record] of oracle.records.entries()) {
    if (
      !record ||
      !isProvenance(record.provenance) ||
      !record.lesson ||
      typeof record.lesson !== 'object'
    ) {
      return blocked(`Oracle record ${index + 1} lacks provenance or lesson fields`);
    }
    for (const field of CRITICAL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record.lesson, field)) {
        return blocked(`Oracle record ${index + 1} lacks critical field ${field}`);
      }
    }
    const key = JSON.stringify([
      record.provenance.sheetName,
      record.provenance.sourceRow,
      record.provenance.sourceColumn,
      record.provenance.partIndex,
    ]);
    if (provenanceKeys.has(key)) {
      return blocked(`Oracle contains duplicate provenance at record ${index + 1}`);
    }
    provenanceKeys.add(key);
  }

  return { status: 'resolved', value: oracle };
}

function assertExpectedDiagnostics(
  oracle: HumanReviewedOracle,
  result: ParseWorkbookResult,
  fixtureId: string
): void {
  const actual = Object.values(result.sheets).flatMap((sheet) => sheet.rejected);
  const expectedKeys = new Set(oracle.rejectedOutcomes.map(diagnosticKey));
  const actualKeys = actual.map(diagnosticKey);
  const missing = actualKeys.filter((key) => !expectedKeys.has(key));
  const unexpected = [...expectedKeys].filter((key) => !actualKeys.includes(key));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Rejected diagnostics differ for ${fixtureId}: missing=${missing.length}, unexpected=${unexpected.length}`
    );
  }
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fieldMetricsText(metrics: QualityMetrics): string {
  return CRITICAL_FIELDS.map((field: CriticalField) => {
    const metric = metrics.fields[field];
    return `${field}=${ratio(metric.accuracy)}(${metric.correct}/${metric.total})`;
  }).join(' ');
}

function printQuality(
  fixtureId: string,
  metrics: QualityMetrics,
  thresholds: CorpusManifest['thresholds'],
  hash: string
): void {
  const fixturePassed = passes(metrics, thresholds);
  console.log(
    `[${fixtureId}] QUALITY=${fixturePassed ? 'PASS' : 'FAIL'} parity=100% hash=${hash} ` +
      `accuracy=${ratio(metrics.recordAccuracy)} precision=${ratio(metrics.precision)} ` +
      `recall=${ratio(metrics.recall)} critical=${ratio(metrics.criticalFields)} ` +
      `matched=${metrics.matchedRecords} expected=${metrics.expected} actual=${metrics.actual}`
  );
  console.log(`[${fixtureId}] critical-fields ${fieldMetricsText(metrics)}`);
}

function main(): void {
  const mode: QualityMode = process.argv.includes('--report-only') ? 'report' : 'gate';
  const manifestPath = resolve('tests/fixtures/real/corpus.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CorpusManifest;

  if (manifest.parserContractVersion !== PARSER_CONTRACT_VERSION) {
    throw new Error(
      `Manifest parser contract ${manifest.parserContractVersion} does not match runtime ${PARSER_CONTRACT_VERSION}`
    );
  }

  const browserDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
  });
  const browserScript = browserDom.window.document.createElement('script');
  browserScript.textContent = readFileSync(resolve('public/xlsx.full.min.js'), 'utf8');
  browserDom.window.document.head.appendChild(browserScript);
  const BrowserXLSX = browserDom.window.XLSX;

  if (!BrowserXLSX || BrowserXLSX.version !== NodeXLSX.version) {
    browserDom.window.close();
    throw new Error(
      `SheetJS version mismatch: Node=${NodeXLSX.version}, browser=${BrowserXLSX?.version ?? 'missing'}`
    );
  }

  const activeMetrics: QualityMetrics[] = [];
  let activeFixtureCount = 0;
  let blockedFixtureCount = 0;
  let fatalErrors = 0;

  for (const entry of [...manifest.fixtures].sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const sourcePath = resolve(entry.source);
    const sourceExists = existsSync(sourcePath);
    let sourceHash = '';

    if (sourceExists) {
      const sourceBytes = readFileSync(sourcePath);
      sourceHash = sha256(sourceBytes);
      try {
        const nodeWorkbook = NodeXLSX.read(sourceBytes, { type: 'buffer', cellDates: true });
        const browserInput = new Uint8Array(
          sourceBytes.buffer,
          sourceBytes.byteOffset,
          sourceBytes.byteLength
        );
        const browserWorkbook = BrowserXLSX.read(browserInput, { type: 'array', cellDates: true });
        const nodeResult = new ParserEngine().parseWorkbookDetailed(nodeWorkbook, NodeXLSX);
        const browserResult = new ParserEngine().parseWorkbookDetailed(
          browserWorkbook,
          BrowserXLSX
        );

        assertParserInvariants(nodeResult);
        const nodeHash = deterministicHash(nodeResult);
        const browserHash = deterministicHash(browserResult);
        if (nodeHash !== browserHash) {
          throw new Error(`Node/browser canonical hash mismatch`);
        }

        if (entry.status === 'blocked') {
          console.log(
            `[${entry.id}] QUALITY=BLOCKED parity=100% hash=${nodeHash} report=${JSON.stringify(nodeResult.report)}`
          );
        } else {
          const oracle = loadOracle(entry, sourceHash);
          const availability = classifyFixture(entry, sourceExists, oracle);
          if (availability.status === 'blocked') {
            console.log(`[${entry.id}] QUALITY=BLOCKED reason=${availability.reason}`);
          } else {
            assertExpectedDiagnostics(oracle.value, nodeResult, entry.id);
            const metrics = measure(oracle.value.records, nodeResult);
            activeFixtureCount += 1;
            activeMetrics.push(metrics);
            printQuality(entry.id, metrics, manifest.thresholds, nodeHash);
          }
        }
      } catch (error) {
        fatalErrors += 1;
        console.error(
          `[${entry.id}] QUALITY=ERROR ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else if (entry.status === 'blocked') {
      console.log(`[${entry.id}] QUALITY=BLOCKED source unavailable: ${entry.source}`);
    } else {
      const availability = classifyFixture(entry, false, null);
      console.log(
        `[${entry.id}] QUALITY=BLOCKED reason=${availability.status === 'blocked' ? availability.reason : 'unknown'}`
      );
    }

    const availability = classifyFixture(
      entry,
      sourceExists,
      entry.status === 'active' && sourceExists ? loadOracle(entry, sourceHash) : null
    );
    if (availability.status === 'blocked') {
      blockedFixtureCount += 1;
      if (entry.status === 'blocked') {
        console.log(`[${entry.id}] Reason: ${availability.reason}`);
      }
    }
  }

  if (activeMetrics.length) {
    const aggregate = activeMetrics.reduce(addMetrics, emptyMetrics());
    const aggregatePassed = passes(aggregate, manifest.thresholds);
    console.log(
      `[aggregate] QUALITY=${aggregatePassed ? 'PASS' : 'FAIL'} ` +
        `accuracy=${ratio(aggregate.recordAccuracy)} precision=${ratio(aggregate.precision)} ` +
        `recall=${ratio(aggregate.recall)} critical=${ratio(aggregate.criticalFields)} ` +
        `matched=${aggregate.matchedRecords} expected=${aggregate.expected} actual=${aggregate.actual}`
    );
    console.log(`[aggregate] critical-fields ${fieldMetricsText(aggregate)}`);
  } else {
    console.log(
      '[aggregate] QUALITY=BLOCKED no human-reviewed active oracle; no accuracy claim is made'
    );
  }

  const finalStatus = runStatus({
    mode,
    activeFixtureCount,
    blockedFixtureCount,
    activeMetrics,
    thresholds: manifest.thresholds,
  });
  console.log(
    `[gate] MODE=${mode} STATUS=${finalStatus.status.toUpperCase()} ` +
      `active=${activeFixtureCount} blocked=${blockedFixtureCount} errors=${fatalErrors}`
  );
  process.exitCode = Math.max(finalStatus.exitCode, fatalErrors > 0 ? 1 : 0);
  browserDom.window.close();
}

main();
