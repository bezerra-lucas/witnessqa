/** Read-only presentation model. A result is a test execution, not a flow. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { classifyFlow, cleanErrors, describeFlow, displayTitle, firstGoto } from './classify.mjs';
import { createEvidenceGuard, PRIVACY_VERSION } from './privacy.mjs';
import { safeEvidencePath } from './safe-evidence-path.mjs';

export const REPORT_SCHEMA = 'witnessqa-report/v1';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const reportId = (kind, value) => `${kind}-${digest(String(value)).slice(0, 20)}`;
const statuses = ['pass', 'fail', 'blocked', 'warn', 'skip'];
// Model IDs share the document with these controls and must never shadow them.
const reservedIds = new Set(['overview', 'flows', 'flows-heading', 'run-status',
  'flow-count', 'test-count', 'pass-count', 'attention-count', 'run-breakdown',
  'evidence-coverage', 'run-select', 'test-search', 'status-filter', 'clear-filters',
  'filter-counter', 'report-source', 'themeBtn', 'lightbox', 'lbCap', 'lbOrigin',
  'lbImg', 'lbClose', 'lbPosition', 'lbPrev', 'lbNext', 'lbDownload']);

export function summarizeTests(tests) {
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  for (const test of tests) counts[statuses.includes(test.status) ? test.status : 'blocked']++;
  const stamp = !tests.length ? 'BLOCKED' : counts.fail ? 'FAIL' : counts.blocked ? 'BLOCKED'
    : counts.warn ? 'WARN' : counts.skip ? 'SKIP' : 'PASS';
  const displayStatus = stamp === 'SKIP' && counts.pass > 0 ? 'PASS + SKIP' : stamp;
  return { counts, total: tests.length, stamp, displayStatus };
}

export function validateReportModel(model) {
  if (model?.schema !== REPORT_SCHEMA) throw new Error('Unsupported report schema');
  for (const key of ['runs', 'flows', 'tests', 'evidence']) {
    if (!Array.isArray(model[key])) throw new Error(`Report needs ${key}[]`);
    if (new Set(model[key].map(item => item.id)).size !== model[key].length ||
        model[key].some(item => typeof item.id !== 'string' || !/^[a-z][a-z0-9-]+$/i.test(item.id))) {
      throw new Error(`Invalid or duplicate ${key} identity`);
    }
  }
  const references = model.references ?? [];
  if (!Array.isArray(references)) throw new Error('Report references must be an array');
  const allIds = [...model.runs, ...model.flows, ...model.tests, ...model.evidence, ...references].map(item => item.id);
  if (new Set(allIds).size !== allIds.length || allIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]+$/i.test(id))) {
    throw new Error('Report identities must be globally unique and safe for links');
  }
  if (allIds.some(id => reservedIds.has(id))) throw new Error('Report identities cannot use reserved control IDs');
  const runs = new Map(model.runs.map(run => [run.id, run]));
  const flows = new Map(model.flows.map(flow => [flow.id, flow]));
  const tests = new Map(model.tests.map(test => [test.id, test]));
  if (!runs.has(model.selectedRunId)) throw new Error('Selected run is absent');
  for (const flow of model.flows) if (!runs.has(flow.runId)) throw new Error('Flow has no run');
  for (const test of model.tests) {
    if (!runs.has(test.runId) || !flows.has(test.flowId) ||
        flows.get(test.flowId).runId !== test.runId || !statuses.includes(test.status)) {
      throw new Error('Test has an invalid flow, run or status');
    }
  }
  for (const item of model.evidence) {
    if (!tests.has(item.testId) || tests.get(item.testId).runId !== item.runId) {
      throw new Error('Evidence must belong to exactly one test in the same run');
    }
    if (!['screenshot', 'json', 'text'].includes(item.kind) || typeof item.body !== 'string') {
      throw new Error('Unsupported evidence content');
    }
    validateContent(item);
    if (item.duplicateOf && !model.evidence.some(other => other.id === item.duplicateOf &&
        other.id !== item.id && !other.duplicateOf && other.kind === item.kind &&
        other.testId === item.testId && other.runId === item.runId && other.sha256 === item.sha256)) {
      throw new Error('Duplicate evidence cannot cross a test or execution boundary');
    }
  }
  // Historical references with no verified test identity deliberately live outside evidence[].
  for (const ref of references) {
    if (!flows.has(ref.relatedFlowId) || ref.testId != null || !ref.sourceLabel) {
      throw new Error('Historical reference cannot claim a current test');
    }
    if (ref.kind !== 'screenshot') throw new Error('Unsupported historical reference content');
    validateContent(ref);
  }
  return model;
}

function validateContent(item) {
  if (typeof item.body !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('Evidence needs content and a digest');
  if (item.kind === 'screenshot') {
    const dimensions = [item.width, item.height];
    if (!dimensions.every(value => value == null) &&
        !dimensions.every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff)) {
      throw new Error('Screenshot dimensions must be positive integers or both unknown');
    }
  }
  if (item.kind === 'screenshot' && (item.body.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.body))) {
    throw new Error('Screenshot must be encoded as base64');
  }
  const content = item.kind === 'screenshot' ? Buffer.from(item.body, 'base64') : item.body;
  if (digest(content) !== item.sha256) throw new Error('Evidence content does not match its digest');
}

export function buildReportModel(input) {
  const roots = [...new Set((Array.isArray(input) ? input : [input])
    .filter(root => root && existsSync(root)).map(root => realpathSync(resolve(root))))];
  if (!roots.length) throw new Error('uso: node src/packer.mjs <run-dir> [run-dir...]');
  const guard = createEvidenceGuard();
  const model = { schema: REPORT_SCHEMA, title: 'Relatório de qualidade', selectedRunId: '',
    runs: [], flows: [], tests: [], evidence: [], references: [],
    scope: 'Resultado automatizado não é aprovação visual nem autorização de release.' };
  for (const root of roots) {
    const runId = reportId('run', root);
    const run = { id: runId, label: guard.redactText(basename(root)), startedAt: null, omissions: 0 };
    model.runs.push(run);
    const flowMap = new Map();
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const resultPath = safeEvidencePath(join(root, entry.name), 'result.json', { extension: '.json' });
      if (!resultPath) continue;
      const original = readFileSync(resultPath);
      const result = guard.redact(JSON.parse(original.toString('utf8')));
      const target = result.app || firstGoto(result);
      let application = '';
      try { application = new URL(target, 'https://unspecified.invalid').origin; } catch { /* no inferred application */ }
      const explicit = typeof result.flow === 'string' ? { id: result.flow, title: result.flow } : result.flow;
      const declared = typeof explicit?.id === 'string' && explicit.id.trim() && typeof explicit?.title === 'string';
      const flowKey = declared ? JSON.stringify([application, explicit.id]) : `legacy:${entry.name}`;
      const flowId = reportId('flow', `${runId}:${flowKey}`);
      if (!flowMap.has(flowId)) {
        const flow = { id: flowId, runId, title: declared ? explicit.title : displayTitle(result),
          description: declared ? explicit.description || '' : 'Agrupamento individual: este teste ainda não declara um fluxo.',
          legacyGrouping: !declared, application };
        flowMap.set(flowId, flow);
        model.flows.push(flow);
      }
      const testId = reportId('test', `${runId}:${entry.name}`);
      const test = { id: testId, flowId, runId, sourceTestId: result.testId || result.name || entry.name,
        name: result.name || entry.name, title: result.title || result.what || result.name || entry.name,
        description: result.what || describeFlow(result), status: classifyFlow(result),
        observedStatus: result.verdict || 'unknown', expectedStatus: result.expectedStatus || null,
        startedAt: result.startedAt || null, finishedAt: result.finishedAt || null,
        viewport: result.viewport || null, browser: result.browser || null,
        sourceFile: `${guard.redactText(entry.name)}/result.json`, sourceSha256: digest(original),
        steps: Array.isArray(result.steps) ? result.steps : [],
        consoleErrors: cleanErrors(result.consoleErrors), pageErrors: cleanErrors(result.pageErrors),
        networkErrors: cleanErrors(result.networkErrors), failure: result.failure || null,
        analysis: result.analysis || null, omissions: 0 };
      model.tests.push(test);
      if (test.startedAt && Number.isFinite(Date.parse(test.startedAt)) &&
          (!run.startedAt || Date.parse(test.startedAt) < Date.parse(run.startedAt))) run.startedAt = test.startedAt;

      const shots = [];
      for (const name of new Set(Array.isArray(result.screenshots) ? result.screenshots : [])) {
        if (result.privacyVersion !== PRIVACY_VERSION) { test.omissions++; continue; }
        const file = safeEvidencePath(join(root, entry.name), name, { extension: '.png' });
        if (!file) { test.omissions++; continue; }
        const bytes = readFileSync(file);
        if (!bytes.length) { test.omissions++; continue; }
        const step = test.steps.find(step => step.screenshot === name);
        const metadata = result.evidenceMetadata?.find?.(item => item.file === name);
        const hasHeader = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        shots.push({ id: reportId('evidence', `${testId}:${name}`), runId, testId,
          kind: 'screenshot', title: metadata?.label || (step ? `Captura do passo ${step.index + 1}` : name),
          filename: name, sourceFile: `${guard.redactText(entry.name)}/${name}`,
          body: bytes.toString('base64'), contentType: 'image/png', sha256: digest(bytes),
          width: hasHeader ? bytes.readUInt32BE(16) : null, height: hasHeader ? bytes.readUInt32BE(20) : null,
          capturedAt: metadata?.capturedAt || null, stepIndex: step?.index ?? null,
          featured: false, requestedHighlight: metadata?.highlight === true,
          documents: 'Registra a aparência da interface neste ponto do teste.',
          limits: 'Uma captura isolada não comprova persistência, entrega externa ou aprovação visual.' });
      }
      const failedShot = shots.find(shot => test.steps.some(step => step.ok === false && step.index === shot.stepIndex));
      const featured = failedShot || shots.find(shot => shot.requestedHighlight) || shots.at(-1);
      if (featured) featured.featured = true;
      const hashes = new Map();
      // Keep all filenames. Exact duplicates are labeled only within this test execution.
      for (const shot of [...shots].sort((a, b) => Number(b.featured) - Number(a.featured))) {
        if (hashes.has(shot.sha256)) shot.duplicateOf = hashes.get(shot.sha256);
        else hashes.set(shot.sha256, shot.id);
      }
      model.evidence.push(...shots);
      const body = JSON.stringify(result, null, 2);
      model.evidence.push({ id: reportId('evidence', `${testId}:result.json`), runId, testId,
        title: 'Registro de execução (JSON)', kind: 'json', body, contentType: 'application/json',
        filename: 'result.json', sourceFile: test.sourceFile, sha256: digest(body), capturedAt: null,
        documents: 'Resultado, passos e diagnósticos registrados pelo executor. Conteúdo sanitizado para apresentação.',
        limits: 'Não é uma captura visual nem uma verificação independente adicional.' });
      run.omissions += test.omissions;
    }
  }
  model.selectedRunId = model.runs[0].id;
  return validateReportModel(model);
}
