import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import YAML from 'yaml';
import { parseScenario } from '../worker/src/scenario.mjs';
import { midsceneModelConfig } from '../worker/src/midscene.mjs';
import { runScenario } from '../worker/src/executor.mjs';
import { workerExitCode } from '../worker/src/verdict.mjs';

test('AI plans reject ambiguous actions, missing assertions, secret expansion and unbounded budgets', () => {
  const base = { name: 'ai', steps: [{ goto: '/' }, { aiAssert: 'The cart shows exactly one item' }] };
  assert.equal(parseScenario(base, YAML), base);
  for (const changed of [
    { steps: [{ aiAct: 'Click cart' }] },
    { steps: [{ aiAssert: '' }] },
    { steps: [{ aiAssert: 'Ready', click: '#continue' }] },
    { steps: [{ aiAct: 'Enter $PASSWORD' }, { aiAssert: 'Ready' }] },
    { midscene: { timeoutMs: Infinity } },
    { midscene: { replanningCycleLimit: 100 } },
    { midscene: { modelConfig: {} } },
  ]) assert.throws(() => parseScenario({ ...base, ...changed }, YAML));
});

test('provider configuration is explicit, supports Codex auth and refuses remote cleartext', () => {
  assert.throws(() => midsceneModelConfig({}), /Configure/);
  const env = { MIDSCENE_MODEL_NAME: 'test-model', MIDSCENE_MODEL_FAMILY: 'gpt-5', MIDSCENE_MODEL_BASE_URL: 'codex://app-server' };
  assert.equal(midsceneModelConfig(env).MIDSCENE_MODEL_API_KEY, undefined);
  assert.throws(() => midsceneModelConfig({ ...env, MIDSCENE_MODEL_BASE_URL: 'http://provider.example/v1' }), /HTTPS/);
  assert.throws(() => midsceneModelConfig({ ...env, MIDSCENE_MODEL_BASE_URL: 'https://provider.example/v1' }), /API_KEY/);
  assert.equal(midsceneModelConfig({ ...env, WITNESS_MIDSCENE_MODEL_NAME: 'configured-model' }).MIDSCENE_MODEL_NAME, 'configured-model');
});

// This is a transport-contract test with the real SDK + real Chromium, not a
// model-quality evaluation. Live model runs are documented separately.
test('real Midscene SDK preserves assertions, masks model screenshots, records usage and cancels stalled calls', { timeout: 60000 }, async () => {
  let responseMode = 'pass';
  const requests = [];
  let heldResponse;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/chat/completions') {
      let body = ''; for await (const part of req) body += part;
      requests.push(JSON.parse(body));
      if (responseMode === 'stall') { heldResponse = res; return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: `fixture-${requests.length}`, model: 'gpt-5.6-luna',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: `<data-json>${JSON.stringify({ pass: responseMode === 'malformed' ? 'false' : responseMode === 'pass', thought: responseMode === 'pass' ? 'Expected heading visible' : 'Required heading is absent' })}</data-json>` } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } },
      }));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<input style="position:absolute;left:20px;top:20px;width:180px;height:40px" value="private-sentinel"><h1 style="margin-top:100px">Ready</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = { MIDSCENE_MODEL_BASE_URL: `${base}/v1`, MIDSCENE_MODEL_NAME: 'gpt-5.6-luna', MIDSCENE_MODEL_FAMILY: 'gpt-5' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const dir = mkdtempSync(join(tmpdir(), 'witness-midscene-test-'));
  const logsBefore = readdirSync(tmpdir()).filter(name => name.startsWith('witness-midscene-'));
  const scenario = { name: 'sdk', app: base, ready: 'h1', viewport: { width: 800, height: 600 }, midscene: { timeoutMs: 10000 },
    steps: [{ goto: '/' }, { aiAssert: 'The heading Ready is visible' }, { expectText: 'Ready' }] };
  try {
    const passed = await runScenario(scenario, { evidenceDir: join(dir, 'pass'), capture: 'checkpoints' });
    assert.equal(passed.verdict, 'pass', JSON.stringify(passed.failure));
    assert.equal(passed.steps[1].ok, true);
    assert.ok(passed.steps[1].screenshot, 'AI checks always retain evidence');
    assert.equal(passed.aiUsage.totalTokens, 120);
    assert.equal(passed.aiCalls.length, 1);
    assert.equal(passed.aiCalls[0].imageCount, 1);
    assert.equal(passed.aiCalls[0].stepIndex, 1);
    assert.equal(passed.aiCalls[0].cachedInputTokens, 40);
    assert.equal(passed.aiCalls[0].uncachedInputTokens, 60);
    assert.equal(passed.aiCalls[0].status, 'completed');
    assert.doesNotMatch(JSON.stringify(passed.aiCalls), /data:image|private-sentinel|heading Ready/);
    assert.equal(passed.engine.name, 'midscene');
    assert.doesNotMatch(JSON.stringify(requests), /private-sentinel/);
    const image = requests[0].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(part => part.type === 'image_url');
    assert.ok(image, 'the real SDK must submit the screenshot');
    const { data, info } = await sharp(Buffer.from(image.image_url.url.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
    const offset = (35 * info.width + 35) * info.channels;
    assert.ok([...data.subarray(offset, offset + 3)].every(channel => channel < 12), 'input values must be masked before inference');
    responseMode = 'fail';
    const failed = await runScenario(scenario, { evidenceDir: join(dir, 'fail') });
    assert.equal(failed.verdict, 'fail');
    assert.equal(failed.steps.length, 2, 'do not continue or rewrite the expectation after failure');
    assert.equal(workerExitCode([failed]), 1);
    assert.match(failed.steps[1].detail, /absent/);
    responseMode = 'malformed';
    const malformed = await runScenario(scenario, { evidenceDir: join(dir, 'malformed') });
    assert.equal(malformed.verdict, 'fail', 'a string "false" must never be coerced into approval');
    assert.match(malformed.steps[1].detail, /invalid assertion response/);
    responseMode = 'stall';
    const stalled = await runScenario({ ...scenario, midscene: { timeoutMs: 500 } }, { evidenceDir: join(dir, 'stall') });
    assert.notEqual(stalled.verdict, 'pass');
    assert.notEqual(workerExitCode([stalled]), 0);
    assert.ok(stalled.metrics.durationMs < 10000);
    assert.deepEqual(readdirSync(tmpdir()).filter(name => name.startsWith('witness-midscene-')).sort(), logsBefore.sort(), 'temporary SDK logs are removed');
    assert.doesNotMatch(readFileSync(join(dir, 'pass/result.json'), 'utf8'), /private-sentinel/);
  } finally {
    heldResponse?.destroy();
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
