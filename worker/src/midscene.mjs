import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const MIDSCENE_VERSION = '1.12.7';
export const AI_ACTIONS = ['aiAct', 'aiAssert'];
const ACTIONS = [...AI_ACTIONS, 'goto', 'fill', 'click', 'wait', 'expectUrl', 'expectVisible', 'expectText', 'expectNoText'];
export const usesMidscene = scenario => scenario.steps?.some(step => AI_ACTIONS.some(key => step?.[key] !== undefined));

export function validateMidsceneScenario(scenario) {
  if (!usesMidscene(scenario) && scenario.midscene === undefined) return;
  const options = scenario.midscene ?? {};
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['timeoutMs', 'replanningCycleLimit'].includes(key))) {
    throw new Error('midscene accepts only timeoutMs and replanningCycleLimit');
  }
  for (const [key, maximum] of [['timeoutMs', 120000], ['replanningCycleLimit', 20]]) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > maximum)) {
      throw new Error(`midscene.${key} must be an integer from 1 to ${maximum}`);
    }
  }
  for (const step of scenario.steps ?? []) {
    if (!AI_ACTIONS.some(key => step?.[key] !== undefined)) continue;
    const actions = ACTIONS.filter(key => step[key] !== undefined);
    if (actions.length !== 1 || typeof step[actions[0]] !== 'string' || !step[actions[0]].trim() || step[actions[0]].length > 8000) {
      throw new Error('Each Midscene step needs exactly one non-empty aiAct or aiAssert string (maximum 8000 characters)');
    }
    // Authentication belongs in deterministic fill steps or private storage state.
    if (/\$\{?[A-Z_][A-Z0-9_]*/.test(step[actions[0]])) throw new Error('Do not put environment variables or credentials in AI prompts; use fill or --auth');
  }
  if (usesMidscene(scenario) && !scenario.steps.some(step => ['aiAssert', 'expectUrl', 'expectVisible', 'expectText', 'expectNoText'].some(key => step?.[key] !== undefined))) {
    throw new Error('A Midscene scenario needs an explicit assertion; completing an action is not proof of acceptance');
  }
}

export function midsceneModelConfig(env = process.env) {
  const config = {};
  for (const key of ['NAME', 'FAMILY', 'BASE_URL', 'API_KEY', 'REASONING_EFFORT']) {
    const value = env[`WITNESS_MIDSCENE_MODEL_${key}`] ?? env[`MIDSCENE_MODEL_${key}`];
    if (value) config[`MIDSCENE_MODEL_${key}`] = value;
  }
  const fail = message => { throw Object.assign(new Error(message), { code: 'midscene-config' }); };
  if (!config.MIDSCENE_MODEL_NAME || !config.MIDSCENE_MODEL_FAMILY || !config.MIDSCENE_MODEL_BASE_URL) {
    fail('Configure MIDSCENE_MODEL_NAME, MIDSCENE_MODEL_FAMILY and MIDSCENE_MODEL_BASE_URL (or their WITNESS_ aliases)');
  }
  if (config.MIDSCENE_MODEL_BASE_URL !== 'codex://app-server') {
    let url;
    try { url = new URL(config.MIDSCENE_MODEL_BASE_URL); } catch { fail('Invalid Midscene model endpoint'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) fail('Midscene model endpoint requires HTTPS (HTTP allowed only on loopback) and no URL credentials');
    if (!config.MIDSCENE_MODEL_API_KEY && !local) fail('MIDSCENE_MODEL_API_KEY is required for this provider');
    if (local && !config.MIDSCENE_MODEL_API_KEY) config.MIDSCENE_MODEL_API_KEY = 'local-no-key';
  }
  return config;
}

// Midscene's logger writes files even with generateReport:false. Keep these
// transient diagnostics outside the evidence bundle, private and short-lived.
let runtime;
let activeSessions = 0;
let logDirectory;
async function loadRuntime() {
  if (!runtime) runtime = (async () => {
    const require = createRequire(import.meta.url);
    const agentPath = require.resolve('@midscene/web/playwright/agent');
    const installed = JSON.parse(readFileSync(join(dirname(agentPath), '../../../package.json'), 'utf8')).version;
    if (installed !== MIDSCENE_VERSION) throw new Error('Unsupported Midscene adapter version');
    const fromMidscene = createRequire(agentPath);
    return { ...require('@midscene/web/playwright/agent'), logger: fromMidscene('@midscene/shared/logger') };
  })().catch(() => { runtime = undefined; throw Object.assign(new Error(`Install the optional engine: npm install @midscene/web@${MIDSCENE_VERSION}`), { code: 'midscene-unavailable' }); });
  return runtime;
}

export async function createMidsceneSession(page, { scenario, guard, result, env = process.env }) {
  validateMidsceneScenario(scenario);
  const modelConfig = midsceneModelConfig(env);
  const timeoutMs = scenario.midscene?.timeoutMs ?? 60000;
  modelConfig.MIDSCENE_MODEL_TIMEOUT = timeoutMs;
  const { PlaywrightAgent, logger } = await loadRuntime();
  if (activeSessions === 0) {
    logDirectory = mkdtempSync(join(tmpdir(), 'witness-midscene-'));
    logger.setLogDirectoryResolver(() => logDirectory);
  }
  activeSessions += 1;
  const trace = [];
  result.engine = { name: 'midscene', version: MIDSCENE_VERSION, model: modelConfig.MIDSCENE_MODEL_NAME,
    family: modelConfig.MIDSCENE_MODEL_FAMILY, timeoutMs,
    replanningCycleLimit: scenario.midscene?.replanningCycleLimit ?? 8 };
  result.aiUsage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let agent;
  let closed = false;
  let controller;
  const close = async () => {
    if (closed) return;
    closed = true;
    controller?.abort();
    try { await agent?.destroy(); }
    finally {
      activeSessions -= 1;
      if (activeSessions === 0) {
        logger.setLogDirectoryResolver(undefined);
        rmSync(logDirectory, { recursive: true, force: true });
      }
    }
  };
  try {
    agent = new PlaywrightAgent(page, {
      modelConfig, generateReport: false, persistExecutionDump: false, autoPrintReportMsg: false,
      cache: false, forceSameTabNavigation: false, forceChromeSelectRendering: false,
      replanningCycleLimit: result.engine.replanningCycleLimit,
      waitForNetworkIdleTimeout: 0, waitForNavigationTimeout: 5000,
      onTaskStartTip: tip => { if (trace.length < 100) trace.push(guard.redactText(String(tip).slice(0, 1000))); },
      onLLMUsage: usage => {
        result.aiUsage.calls += 1;
        for (const [target, source] of [['inputTokens', 'prompt_tokens'], ['outputTokens', 'completion_tokens'], ['totalTokens', 'total_tokens']]) {
          if (Number.isFinite(usage[source]) && usage[source] >= 0) result.aiUsage[target] += usage[source];
        }
      },
    });
    // Pin + integration tests protect this adapter boundary. The model receives
    // the same masked image as Witness evidence, never the raw form values.
    agent.page.screenshotBase64 = async () => `data:image/png;base64,${(await guard.screenshotBuffer(page, { timeout: 8000 })).toString('base64')}`;
  } catch (error) { await close(); throw error; }

  return {
    close,
    async execute(step, entry) {
      if (closed) throw new Error('Midscene session is closed');
      const action = step.aiAssert !== undefined ? 'aiAssert' : 'aiAct';
      const traceStart = trace.length;
      controller = new AbortController();
      let timer;
      const start = performance.now();
      try {
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error(`Midscene exceeded the ${timeoutMs} ms step budget`), { code: 'midscene-timeout' }));
          }, timeoutMs);
        });
        // The SDK's aiAssert coerces arbitrary values with Boolean(...), which
        // would accept a malformed "false" string. Query structured data and
        // enforce the boolean type ourselves before approving a criterion.
        // 1.12.7's public aiQuery drops AbortSignal. Use its query execution
        // boundary so a deadline also cancels the underlying model request.
        const query = () => {
          const insight = agent.createInsight();
          return insight.taskExecutor.createTypeQueryExecution('Query', {
            pass: `boolean: true only when the current screenshot proves this criterion; false if absent, uncertain or contradicted: ${step.aiAssert}`,
            thought: 'string: concise evidence explaining the decision',
          }, insight.resolveModelRuntime(), { domIncluded: false, screenshotIncluded: true }, undefined, { abortSignal: controller.signal }).then(response => response.output);
        };
        const operation = action === 'aiAssert'
          ? query()
          : agent.aiAct(step.aiAct, { abortSignal: controller.signal, cacheable: false });
        const response = await Promise.race([operation, deadline]);
        if (action === 'aiAssert') {
          entry.ok = response?.pass === true;
          entry.detail = typeof response?.pass !== 'boolean' ? 'Midscene returned an invalid assertion response; expected a boolean pass field'
            : guard.redactText(String(response?.thought || (entry.ok ? 'AI assertion satisfied' : 'AI assertion was not proven')).slice(0, 1500));
        }
      } finally {
        clearTimeout(timer);
        entry.ai = { engine: 'midscene', durationMs: performance.now() - start, tasks: trace.slice(traceStart) };
      }
    },
  };
}
