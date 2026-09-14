import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser } from '../worker/src/browser.mjs';
import { runScenario } from '../worker/src/executor.mjs';
import { waitForText } from '../worker/src/conditions.mjs';
import { parseJobs } from '../worker/src/runtime-options.mjs';
import { doctor } from '../worker/src/doctor.mjs';
import { parseScenario } from '../worker/src/scenario.mjs';
import YAML from 'yaml';

async function fixture(html) {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(typeof html === 'function' ? html(req) : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
function execute(args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('cli.mjs'), ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    child.on('error', reject);
    child.on('exit', code => resolvePromise({ code, output }));
  });
}

test('retrying assertions wait for visible content, scope negative text and reject missing scopes', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<section id="scope">loading</section><p>Forbidden</p><p id="hidden" hidden>Ready</p>');
    await page.evaluate(() => setTimeout(() => document.querySelector('#scope').innerText = 'Ready', 220));
    await waitForText(page, { selector: '#scope', text: 'Ready' }, { timeout: 1000 });
    await waitForText(page, { selector: '#scope', text: 'Forbidden' }, { absent: true, timeout: 100 });
    await assert.rejects(waitForText(page, { selector: 'body', text: 'Forbidden' }, { absent: true, timeout: 100 }));
    await assert.rejects(waitForText(page, { selector: '#hidden', text: 'Ready' }, { timeout: 100 }));
    await page.evaluate(() => { const hidden = document.querySelector('#hidden'); hidden.hidden = false; hidden.style.opacity = 0; hidden.innerText = 'Invisible sentinel'; });
    await assert.rejects(waitForText(page, { selector: 'body', text: 'Invisible sentinel' }, { timeout: 100 }));
    await assert.rejects(waitForText(page, { selector: '#missing', text: 'Forbidden' }, { absent: true, timeout: 100 }));
    await page.evaluate(() => { document.querySelector('#scope').innerText = 'Forbidden'; setTimeout(() => document.querySelector('#scope').innerText = 'Ready', 220); });
    await waitForText(page, { selector: '#scope', text: 'Forbidden' }, { absent: true, timeout: 1000 });
  } finally { await browser.close(); }
});

test('reused browser isolates storage and checkpoints keep labelled steps, final state and failure', async () => {
  const app = await fixture(`<h1 id="state"></h1><button onclick="localStorage.setItem('session','yes');document.cookie='session=yes';document.querySelector('h1').innerText='Saved'">Save</button><script>document.querySelector('h1').innerText = localStorage.getItem('session') || document.cookie ? 'Leaked' : 'Clean';</script>`);
  const browser = await launchBrowser();
  const root = mkdtempSync(join(tmpdir(), 'wq-isolation-'));
  try {
    const base = { app: app.url, ready: 'h1', viewport: { width: 360, height: 240 }, assertionTimeoutMs: 150 };
    const first = await runScenario({ ...base, name: 'first', steps: [
      { goto: '/', evidence: { label: 'Initial state' } }, { expectText: 'Clean' }, { click: 'button' }, { expectText: 'Saved' },
    ] }, { browser, evidenceDir: join(root, 'first'), capture: 'checkpoints' });
    assert.equal(first.verdict, 'pass');
    assert.deepEqual(first.evidenceMetadata.map(item => item.stepIndex), [0, 3]);
    assert.equal(first.steps.length, 4);
    assert.equal(browser.contexts().length, 0);
    const second = await runScenario({ ...base, name: 'second', steps: [{ goto: '/' }, { expectText: 'Clean' }, { expectText: 'Missing' }, { expectText: 'Unreached' }] },
      { browser, evidenceDir: join(root, 'second'), capture: 'checkpoints' });
    assert.equal(second.verdict, 'fail');
    assert.deepEqual(second.evidenceMetadata.map(item => item.stepIndex), [2]);
    assert.equal(browser.contexts().length, 0);
    const blocked = await runScenario({ ...base, name: 'auth', auth: join(root, 'absent.json'), steps: [{ goto: '/' }] }, { browser, evidenceDir: join(root, 'auth') });
    assert.equal(blocked.verdict, 'blocked');
    assert.equal(browser.contexts().length, 0);
    const fresh = await runScenario({ ...base, name: 'fresh', steps: [{ goto: '/' }, { expectText: 'Clean' }] }, { browser, evidenceDir: join(root, 'fresh') });
    assert.equal(fresh.verdict, 'pass');
  } finally { await browser.close(); await app.close(); }
});

test('CLI forwards budgets, pools browsers, records metrics and reruns changed applications', async () => {
  let state = 'Ready';
  const app = await fixture(() => `<h1>${state}</h1>`);
  const root = mkdtempSync(join(tmpdir(), 'wq-worker-options-'));
  const scenarios = join(root, 'scenarios'); mkdirSync(scenarios);
  for (let i = 0; i < 3; i++) writeFileSync(join(scenarios, `scenario-${i}.yaml`), YAML.stringify({ name: `scenario-${i}`, ready: 'h1', viewport: { width: 360, height: 240 }, assertionTimeoutMs: 100,
    steps: [{ goto: '/' }, { expectVisible: 'h1' }, { expectText: 'Ready' }] }));
  const out = join(root, 'out');
  const args = ['run', scenarios, '--base-url', app.url, '--out', out, '--jobs', '2', '--capture', 'checkpoints'];
  try {
    const first = await execute(args, { WITNESS_MAX_JOBS: '2' });
    assert.equal(first.code, 0, first.output);
    const metrics = JSON.parse(readFileSync(join(out, 'METRICS.json')));
    assert.equal(metrics.jobs, 2);
    assert.equal(metrics.browserLaunches, 2);
    assert.equal(metrics.screenshots, 3);
    assert.ok(metrics.durationMs > 0 && metrics.workerCpuMs > 0 && metrics.artifactBytes > 0);
    const before = JSON.parse(readFileSync(join(out, 'scenario-0/result.json')));
    state = 'Broken';
    const second = await execute(args, { WITNESS_MAX_JOBS: '2' });
    assert.equal(second.code, 1, second.output);
    const after = JSON.parse(readFileSync(join(out, 'scenario-0/result.json')));
    assert.equal(after.verdict, 'fail');
    assert.notEqual(before.startedAt, after.startedAt);
    const reduced = await execute(['run', join(scenarios, 'scenario-0.yaml'), '--out', out]);
    assert.notEqual(reduced.code, 0);
    assert.match(reduced.output, /outside the selected suite/);
    const invalid = await execute(['run', scenarios, '--out', join(root, 'invalid'), '--jobs', '3'], { WITNESS_MAX_JOBS: '2' });
    assert.notEqual(invalid.code, 0);
    assert.equal(existsSync(join(root, 'invalid/REPORT.html')), false);
  } finally { await app.close(); }
});

test('doctor verifies an authenticated readiness condition without printing secrets', async () => {
  const app = await fixture('<h1>Login</h1>');
  const out = mkdtempSync(join(tmpdir(), 'wq-doctor-'));
  try {
    const good = await doctor({ baseUrl: app.url, outDir: out, ready: 'h1' });
    assert.equal(good.ok, true);
    const blocked = await doctor({ baseUrl: app.url, outDir: out, ready: { selector: '#authenticated', timeout: 100 } });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.checks.find(item => item.name === 'application').ok, false);
    const secret = await doctor({ baseUrl: 'http://user:secret@127.0.0.1', authFile: join(out, 'missing-secret'), outDir: out });
    assert.equal(secret.ok, false);
    assert.doesNotMatch(JSON.stringify(secret), /missing-secret|user:secret/);
  } finally { await app.close(); }
});

test('runtime budgets and readiness reject malformed or unbounded input', () => {
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.2', '17']) assert.throws(() => parseJobs(value, { WITNESS_MAX_JOBS: '2' }));
  assert.equal(parseJobs('2', { WITNESS_MAX_JOBS: '2' }), 2);
  for (const ready of [{ selector: '' }, { selector: 'h1', timeout: Infinity }, { selector: 'h1', text: 1 }]) {
    assert.throws(() => parseScenario({ name: 'x', steps: [], ready }, YAML));
  }
});

test('a slow BYOK request does not hold the browser lane or alter the observed verdict', async () => {
  let providerResponse;
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions') { providerResponse = res; return; }
    res.end('<h1>Ready</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), 'wq-byok-lane-'));
  const dir = join(root, 'scenarios'); mkdirSync(dir);
  for (const [file, text] of [['a', 'Missing'], ['b', 'Ready']]) writeFileSync(join(dir, `${file}.yaml`), YAML.stringify({
    name: file, ready: 'h1', assertionTimeoutMs: 100, viewport: { width: 360, height: 240 }, steps: [{ goto: '/' }, { expectText: text }],
  }));
  const out = join(root, 'out');
  const execution = execute(['run', dir, '--base-url', url, '--out', out, '--jobs', '1'], {
    WITNESS_KEY: 'local-test-key', WITNESS_BASE: `${url}/v1`,
  });
  try {
    const deadline = Date.now() + 10000;
    while ((!providerResponse || !existsSync(join(out, 'b/result.json'))) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(providerResponse, 'Provider call started');
    assert.ok(existsSync(join(out, 'b/result.json')), 'Second scenario finished before the provider responded');
  } finally {
    providerResponse?.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cause: 'fixture', isBug: false, confidence: 1, suggestion: '' }) } }] }));
    const result = await execution;
    assert.equal(result.code, 1, result.output);
    await new Promise(resolve => server.close(resolve));
  }
  const result = JSON.parse(readFileSync(join(out, 'a/result.json')));
  assert.equal(result.verdict, 'fail');
  assert.equal(result.analysis.isBug, false);
});
