import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availableParallelism, freemem, tmpdir } from 'node:os';
import { launchBrowser } from './browser.mjs';
import { parseJobs } from './runtime-options.mjs';
import { waitUntilReady } from './conditions.mjs';

export async function doctor({ baseUrl, authFile, outDir = tmpdir(), ready, jobs = '1' } = {}) {
  const checks = [];
  let browser;
  let context;
  const check = async (name, action) => {
    try { const detail = await action(); checks.push({ name, ok: true, detail }); return true; }
    catch { checks.push({ name, ok: false }); return false; }
  };
  await check('jobs', () => `${parseJobs(jobs)} slot(s); ${availableParallelism()} logical CPUs available`);
  await check('output', () => {
    const dir = mkdtempSync(join(resolve(outDir), '.witnessqa-doctor-'));
    try { writeFileSync(join(dir, 'probe'), 'ok', { mode: 0o600 }); }
    finally { rmSync(dir, { recursive: true }); }
    return 'Writable';
  });
  let state;
  if (authFile) await check('auth-file', () => {
    state = JSON.parse(readFileSync(authFile, 'utf8'));
    if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error();
    return 'Valid storage state structure; session validity needs an authenticated readiness selector';
  });
  try {
    if (await check('browser', async () => {
      browser = await launchBrowser();
      context = await browser.newContext({ ...(state ? { storageState: state } : {}) });
      return browser.version();
    }) && baseUrl) {
      await check('application', async () => {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        const page = await context.newPage();
        const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!response || response.status() >= 400) throw new Error();
        await waitUntilReady(page, ready);
        return ready ? 'Reachable; readiness condition passed' : 'Reachable; business/session readiness not checked';
      });
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  const cgroup = {};
  for (const file of ['cpu.max', 'memory.max', 'memory.current', 'memory.events']) {
    try { cgroup[file] = readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim(); } catch { /* not cgroup v2 */ }
  }
  return { schema: 'witnessqa-doctor/v1', ok: checks.every(check => check.ok), checks,
    resources: { hostFreeMemoryBytes: freemem(), cgroup },
    remediation: {
      jobs: 'Choose --jobs within WITNESS_MAX_JOBS; start with 1 on a shared VPS.',
      output: 'Pass --out with an existing writable parent directory.',
      'auth-file': 'Create a Playwright storageState file with witnessqa login.',
      browser: 'Run witnessqa install-browser --with-deps, or configure a supported system Chromium.',
      application: 'Check preview availability and the --ready selector using the same test account.',
    },
  };
}
