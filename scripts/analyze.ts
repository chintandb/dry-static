/**
 * Offline benchmark over one or more recordings.
 *
 *   npm run analyze -- recordings/demo-1.jsonl
 *
 * Prints per-file signal quality, hold verdicts, contraction precision/recall against the
 * taps in the file, the pulse trend, and the go/no-go verdict.
 */
import { readFileSync } from 'node:fs';
import { analyzeRecording, formatReport, goNoGo } from '../src/core/benchmark.js';
import { DEFAULT_PARAMS } from '../src/core/params.js';

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (files.length === 0) {
  console.error('usage: npm run analyze -- <recording.jsonl> [more.jsonl ...]');
  process.exit(1);
}

const reports = files.map((file) => analyzeRecording(file, readFileSync(file, 'utf8'), DEFAULT_PARAMS));
const verdict = goNoGo(reports, DEFAULT_PARAMS);
console.log(formatReport(reports, verdict));
process.exit(0);
