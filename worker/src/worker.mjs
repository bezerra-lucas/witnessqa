/**
 * WitnessQA worker — roda uma lista de cenários contra um app e gera o relatório.
 * `node src/worker.mjs scenarios/ --base-url https://app.com --out runs/<ts>`
 */
import { readdirSync, mkdirSync, readFileSync, statSync, lstatSync, existsSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "yaml";
import { parseArgs } from 'node:util';
import { parseJobs, capturePolicy } from './runtime-options.mjs';
import { launchBrowser } from './browser.mjs';
import { artifactBytes } from './metrics.mjs';
import { parseScenario } from "./scenario.mjs";
import { runScenario } from "./executor.mjs";
import { investigateFailure, byokConfigured } from "./byok.mjs";
import { packRun } from "./packer.mjs";
import { createEvidenceGuard } from "./privacy.mjs";
import { normalizeFlowResult, workerExitCode } from "./verdict.mjs";

function collectFiles(targets) {
  const files = [];
  for (const t of targets) {
    if (!t || t.startsWith("--")) continue;
    if (!existsSync(t)) throw new Error("Scenario target does not exist");
    if (statSync(t).isDirectory()) {
      files.push(
        ...readdirSync(t)
          .filter((f) => /\.(ya?ml|json)$/.test(f))
          .map((f) => join(t, f)),
      );
    } else if (/\.(ya?ml|json)$/.test(t)) {
      files.push(t);
    }
  }
  return files;
}

const started = performance.now();
const cpuStart = process.cpuUsage();
const { values, positionals: rawTargets } = parseArgs({ allowPositionals: true, options: {
  'base-url': { type: 'string', default: '' }, out: { type: 'string', default: join('runs', String(Date.now())) },
  auth: { type: 'string' }, headed: { type: 'boolean' }, force: { type: 'boolean' },
  jobs: { type: 'string', default: process.env.WITNESS_JOBS ?? '1' },
  'image-format': { type: 'string', default: 'webp' }, capture: { type: 'string', default: 'all' },
} });
const baseUrl = values['base-url'];
const outDir = values.out;
const authFile = values.auth;
const headed = values.headed;
const imageFormat = values['image-format'];
if (!['png', 'webp'].includes(imageFormat)) throw new Error('Unsupported screenshot format');
const capture = capturePolicy(values.capture);
const jobs = parseJobs(values.jobs);
const files = [...new Set(collectFiles(rawTargets.length ? rawTargets : ['.']))];
if (!files.length) { console.error('nenhum cenário .yaml/.json encontrado'); process.exit(2); }
// Validate every scenario before starting any browser or modifying old evidence.
const planned = files.map(file => ({ file, scenario: parseScenario(readFileSync(file, 'utf8'), yaml),
  directory: basename(file).replace(/\.(ya?ml|json)$/, '') }));
if (new Set(planned.map(item => item.directory)).size !== planned.length ||
    planned.some(item => !item.directory || item.directory.startsWith('.') || /[\\/\x00-\x1f]/.test(item.directory) || item.directory === 'REPORT.assets')) {
  throw new Error('Scenario filenames must be safe and unique in the evidence directory');
}
if (existsSync(outDir) && (!lstatSync(outDir).isDirectory() || lstatSync(outDir).isSymbolicLink())) {
  throw new Error('Output must be a regular directory');
}
mkdirSync(outDir, { recursive: true, mode: 0o700 });
for (const name of readdirSync(outDir)) {
  const path = join(outDir, name);
  if (lstatSync(path).isSymbolicLink()) throw new Error('Output contains a symlink');
  if (lstatSync(path).isDirectory() && existsSync(join(path, 'result.json')) && !planned.some(item => item.directory === name)) {
    throw new Error('Output contains results outside the selected suite; use a new --out directory');
  }
}
for (const item of planned) {
  const dir = join(outDir, item.directory);
  if (existsSync(dir)) discardLegacyEvidence(dir);
}
// Never reuse a verdict just because result.json exists. A mutable preview URL
// cannot establish the revision, data or session that produced that verdict.
let analysisTail = Promise.resolve();
let analysisMs = 0;
let analysisError;
let browserLaunches = 0;

console.log(`WitnessQA — ${files.length} cenário(s) contra ${baseUrl || "(urls dos cenários)"}\n`);

const results = [];

async function runOne({ scenario, directory }, acquireBrowser) {
  const guard = createEvidenceGuard({ scenario });
  const evidenceDir = join(outDir, directory);
  console.log(`▶ ${scenario.name}`);
  let result = await runScenario(scenario, { evidenceDir, baseUrl, authFile: authFile || undefined, headed, imageFormat, capture, acquireBrowser });
  const normalized = normalizeFlowResult(result);
  if (normalized !== result) {
    result = guard.writeJson(join(evidenceDir, "result.json"), normalized);
  }
  const icon = result.verdict === "pass" ? "✓" : result.verdict === "blocked" ? "■" : "✗";
  console.log(`  ${icon} ${result.verdict.toUpperCase()} (${result.steps.length} steps)`);
  if (result.failure) console.log(`    └ ${JSON.stringify(guard.redact(result.failure)).slice(0, 200)}`);

  results.push(result);
  if (result.verdict !== 'pass' && byokConfigured()) {
    // One bounded provider lane, independent of browser slots. Persist the
    // observed verdict immediately; a model can only add analysis.
    analysisTail = analysisTail.then(async () => {
      const start = performance.now();
      const analysis = await investigateFailure(result, evidenceDir, { guard });
      analysisMs += performance.now() - start;
      if (analysis) { result.analysis = analysis; guard.writeJson(join(evidenceDir, 'result.json'), result); }
    }).catch(error => { analysisError = error; });
  }
}

const queue = [...planned];
const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  let browser;
  let uses = 0;
  const acquireBrowser = async () => {
    if (!browser?.isConnected() || uses >= 20) {
      await browser?.close().catch(() => {});
      browser = await launchBrowser({ headless: !headed });
      browserLaunches += 1;
      uses = 0;
    }
    uses += 1;
    return browser;
  };
  try {
    while (queue.length) await runOne(queue.shift(), acquireBrowser);
  } finally { await browser?.close().catch(() => {}); }
});
// Wait for every lane before surfacing an error so resources are always closed.
const completed = await Promise.allSettled(workers);
await analysisTail;
const rejected = completed.find(result => result.status === 'rejected');
if (rejected) throw rejected.reason;
if (analysisError) throw analysisError;

const failed = results.filter((r) => r.verdict === "fail");
const blocked = results.filter((r) => r.verdict === "blocked");
const warned = results.filter((r) => r.verdict === "warn");
let report = `# WitnessQA Run — ${new Date().toISOString()}\n\n`;
report += `**Veredito geral:** ${workerExitCode(results) === 0 ? "PASS" : `${failed.length} fail / ${blocked.length} blocked / ${warned.length} warn / ${results.length} total`}\n\n`;
for (const r of results) {
  report += `## ${r.verdict.toUpperCase()} ${r.name}\n`;
  for (const s of r.steps) {
    report += `- ${s.ok ? "ok" : "FALHOU"} step ${s.index}: \`${JSON.stringify(s.step)}\`${s.detail ? ` — ${s.detail}` : ""} (evidência: ${s.screenshot})\n`;
  }
  if ((r.consoleErrors ?? []).length) report += `\n**Console errors:**\n${r.consoleErrors.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.networkErrors?.length) report += `\n**Rede:**\n${r.networkErrors.map((e) => `- ${e}`).join("\n")}\n`;
  if ((r.brokenImages ?? []).length) report += `\n**Imagens quebradas:**\n${r.brokenImages.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.analysis) {
    report += `\n**Investigação de causa (BYOK):**\n- Causa: ${r.analysis.cause}\n- Bug do app: ${r.analysis.isBug ?? "?"} (confiança ${r.analysis.confidence})\n- Sugestão: ${r.analysis.suggestion}\n`;
  }
  report += "\n";
}
if (byokConfigured()) report += `---\n*Análise de causa por LLM via BYOK (${process.env.WITNESS_MODEL ?? "openai/gpt-4o-mini"}).*\n`;
createEvidenceGuard().writeText(join(outDir, "REPORT.md"), report);

function discardLegacyEvidence(evidenceDir) {
  for (const name of readdirSync(evidenceDir)) {
    if (!/^(?:result\.json|page\.html|url\.txt|.+\.(?:png|webp))$/.test(name)) continue;
    unlinkSync(join(evidenceDir, name));
  }
}

const reportStarted = performance.now();
let reportFailed = false;
try {
  const packed = packRun(outDir);
  console.log(`\nlaudo: ${packed.path}  (${packed.stamp})`);
} catch (e) {
  reportFailed = true;
  console.log(`\nrelatório md: ${join(outDir, "REPORT.md")}  (html falhou: ${e.message})`);
}

const cpu = process.cpuUsage(cpuStart);
createEvidenceGuard().writeJson(join(outDir, 'METRICS.json'), {
  schema: 'witnessqa-metrics/v1', privacyVersion: 1, durationMs: performance.now() - started,
  jobs, browserLaunches, capturePolicy: capture, scenarios: results.length,
  screenshots: results.reduce((sum, result) => sum + result.screenshots.length, 0),
  phasesMs: { report: performance.now() - reportStarted, analysis: analysisMs },
  workerCpuMs: (cpu.user + cpu.system) / 1000,
  workerPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  resourceScope: 'Node worker only; browser processes excluded. Phase times can overlap.',
  artifactBytes: artifactBytes(outDir),
});
process.exitCode = reportFailed ? 2 : workerExitCode(results);
