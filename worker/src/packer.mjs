/** Self-contained report: flows contain test executions; tests own evidence. */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportModel, summarizeTests } from './report-model.mjs';
import { renderReport } from './report-view.mjs';

export function packRun(runDir) {
  const model = buildReportModel(runDir);
  const selectedTests = model.tests.filter(test => test.runId === model.selectedRunId);
  const { counts, stamp } = summarizeTests(selectedTests);
  const html = renderReport(model);
  const root = (Array.isArray(runDir) ? runDir : [runDir]).find(root => root && existsSync(root));
  const path = join(root, 'REPORT.html');
  writeFileSync(path, html, { mode: 0o600 });
  return { path, bytes: Buffer.byteLength(html), stamp, counts,
    // Compatibility: old CLI consumers called each executed scenario a "flow".
    flows: selectedTests.length, tests: selectedTests.length,
    flowCount: model.flows.filter(flow => flow.runId === model.selectedRunId).length,
    runs: model.runs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const info = packRun(process.argv.slice(2).filter(arg => arg && !arg.startsWith('--')));
    console.log(`✓ REPORT.html (${Math.round(info.bytes / 1024)} KB, ${info.flowCount} fluxos, ${info.tests} testes, ${info.stamp})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
