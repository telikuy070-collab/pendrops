#!/usr/bin/env node
/**
 * `npm run verify:data` — fail-closed validation of the tracked schedule
 * snapshot. Prints metadata only (version, size, SHA-256); never file content.
 *
 * Exit code 0 = the snapshot can be packaged, 1 = build must not run.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  describeScheduleSnapshot,
  readScheduleSnapshot,
  validateScheduleSnapshot,
} from './build-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = readScheduleSnapshot(root);
const { ok, errors } = validateScheduleSnapshot(read);

if (ok) {
  console.log(`[verify:data] OK — ${describeScheduleSnapshot(read)}`);
  process.exit(0);
}

console.error('[verify:data] FAILED — the production build must not run:');
for (const error of errors) console.error(`  - ${error}`);
process.exit(1);
