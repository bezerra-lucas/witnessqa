/** Offline report bundle: a small HTML document and content-addressed images. */
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportModel, summarizeTests } from './report-model.mjs';
import { renderReport } from './report-view.mjs';
import { writeImage } from './evidence-image.mjs';

export function packRun(runDir) {
  const model = buildReportModel(runDir);
  const selectedTests = model.tests.filter(test => test.runId === model.selectedRunId);
  const { counts, stamp } = summarizeTests(selectedTests);
  const root = (Array.isArray(runDir) ? runDir : [runDir]).find(root => root && existsSync(root));
  const assetDir = join(root, 'REPORT.assets');
  if (existsSync(join(assetDir, 'result.json'))) throw new Error('REPORT.assets is reserved for report images');
  if (existsSync(assetDir) && (!lstatSync(assetDir).isDirectory() || lstatSync(assetDir).isSymbolicLink())) {
    throw new Error('Report asset directory must be a regular directory');
  }
  mkdirSync(assetDir, { recursive: true, mode: 0o700 });
  const assets = new Set();
  for (const item of [...model.evidence, ...(model.references ?? [])]) {
    if (item.kind !== 'screenshot') continue;
    const name = `${item.sha256}.${item.contentType === 'image/webp' ? 'webp' : 'png'}`;
    if (assets.has(name)) continue;
    const path = join(assetDir, name);
    // Atomic replacement also avoids following an existing file symlink.
    writeImage(path, Buffer.from(item.body, 'base64'));
    assets.add(name);
  }
  const html = renderReport(model, { externalImages: true });
  const path = join(root, 'REPORT.html');
  writeFileSync(path, html, { mode: 0o600 });
  for (const name of readdirSync(assetDir)) {
    if (/^[a-f0-9]{64}\.(?:png|webp)$/.test(name) && !assets.has(name)) rmSync(join(assetDir, name), { force: true });
  }
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
