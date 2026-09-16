// Opt-in live-model check against the repository's synthetic shopping app.
// No DOMOD credentials, business data or external payment service is used.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { midsceneModelConfig } from '../worker/src/midscene.mjs';

midsceneModelConfig(); // Reject missing provider configuration before starting.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = resolve(process.argv[2] || `.witness/midscene-validation/${Date.now()}`);
mkdirSync(out, { recursive: true, mode: 0o700 });
const server = spawn(process.execPath, [join(root, 'test/fixtures/serve.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
const lines = createInterface({ input: server.stdout });
let timer;
try {
  const base = await Promise.race([
    new Promise((resolve, reject) => {
      lines.on('line', line => { const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) resolve(url); });
      server.once('exit', () => reject(new Error('Fixture server exited before listening')));
      server.once('error', reject);
    }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture server startup timed out')), 10000); }),
  ]);
  clearTimeout(timer);
  const common = { app: base, ready: 'h1', viewport: { width: 1440, height: 900 },
    flow: { id: 'midscene-checkout', title: 'Midscene · compra com dados sintéticos' },
    midscene: { timeoutMs: 120000, replanningCycleLimit: 8 } };
  const scenarios = [
    { ...common, name: '01-checkout', title: 'Adicionar dois itens e confirmar o pedido', steps: [
      { goto: '/' },
      { aiAct: 'Click Add to cart exactly twice. Stay on this page afterwards.' },
      { expectText: { selector: '.cart-badge', text: '2' } },
      { aiAct: 'Go to the cart, then click Pagar once to confirm this synthetic order.' },
      { expectUrl: '/cart.html' },
      { expectText: 'Pedido confirmado' },
      { aiAssert: 'The confirmation message Pedido confirmado is visibly displayed on this page.', evidence: { label: 'Pedido sintético confirmado', highlight: true } },
    ] },
    { ...common, name: '02-negative-control', title: 'Reprovar confirmação antes de pagar (controle negativo)', steps: [
      { goto: '/cart.html' },
      { expectNoText: 'Pedido confirmado' },
      { aiAssert: 'The confirmation message Pedido confirmado is visibly displayed on this page.' },
    ] },
  ];
  const plans = join(out, 'scenarios'); mkdirSync(plans);
  for (const scenario of scenarios) writeFileSync(join(plans, `${scenario.name}.json`), JSON.stringify(scenario, null, 2));
  const cgroup = existsSync('/sys/fs/cgroup/cpu.stat') && existsSync('/sys/fs/cgroup/memory.current');
  const cpu = () => cgroup ? Number(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').match(/usage_usec (\d+)/)?.[1] || 0) : null;
  let peak = 0;
  const sample = () => { if (cgroup) peak = Math.max(peak, Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8'))); };
  sample(); timer = setInterval(sample, 100);
  const start = performance.now(), cpuStart = cpu();
  const log = openSync(join(out, 'execution.log'), 'w');
  const child = spawn(process.execPath, [join(root, 'cli.mjs'), 'run', plans, '--base-url', base, '--out', join(out, 'results'), '--jobs', '1', '--capture', 'checkpoints'], { cwd: root, env: process.env, stdio: ['ignore', log, log] });
  const [exitCode] = await once(child, 'exit');
  closeSync(log); sample(); clearInterval(timer);
  const results = scenarios.map(scenario => JSON.parse(readFileSync(join(out, 'results', scenario.name, 'result.json'), 'utf8')));
  const validation = {
    kind: 'live-model-synthetic-application', expected: ['pass', 'fail'], observed: results.map(result => result.verdict),
    success: exitCode === 1 && results[0].verdict === 'pass' && results[1].verdict === 'fail' && results[1].steps.at(-1)?.step?.aiAssert !== undefined,
    gateExitCode: exitCode, wallSeconds: (performance.now() - start) / 1000,
    cpuSeconds: cgroup ? (cpu() - cpuStart) / 1e6 : null, peakCgroupBytes: cgroup ? peak : null,
    resourcesScope: cgroup ? 'entire container/cgroup, sampled every 100ms' : 'unavailable',
    results: results.map(result => ({ name: result.name, verdict: result.verdict, failure: result.failure, engine: result.engine, aiUsage: result.aiUsage })),
  };
  writeFileSync(join(out, 'validation.json'), JSON.stringify(validation, null, 2));
  console.log(JSON.stringify(validation, null, 2));
  process.exitCode = validation.success ? 0 : 1;
} finally {
  clearTimeout(timer); clearInterval(timer); lines.close(); server.kill();
}
