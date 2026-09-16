import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentModelCaller, withCallTelemetry } from '../worker/src/midscene-telemetry.mjs';

test('concurrent telemetry keeps scenarios separate and missing cache unknown', async () => {
  const caller = { async callAI(messages) {
    await new Promise(resolve => setTimeout(resolve, messages[0].delay));
    return { usage: { prompt_tokens: messages[0].tokens, completion_tokens: 2, total_tokens: messages[0].tokens + 2 } };
  } };
  instrumentModelCaller(caller);
  instrumentModelCaller(caller);
  const a = { aiCalls: [] }, b = { aiCalls: [] };
  await Promise.all([
    withCallTelemetry(a, { index: 3 }, 'aiAct', () => caller.callAI([{ delay: 20, tokens: 100, role: 'system', content: 'secret prompt' }])),
    withCallTelemetry(b, { index: 5 }, 'aiAssert', () => caller.callAI([{ delay: 1, tokens: 200, role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }] }]))
  ]);
  assert.equal(a.aiCalls.length, 1);
  assert.equal(a.aiCalls[0].inputTokens, 100);
  assert.equal(a.aiCalls[0].stepIndex, 3);
  assert.equal(a.aiCalls[0].cachedInputTokens, null);
  assert.equal(a.aiCalls[0].uncachedInputTokens, null);
  assert.equal(b.aiCalls[0].inputTokens, 200);
  assert.equal(b.aiCalls[0].stepIndex, 5);
  assert.equal(b.aiCalls[0].imageCount, 1);
  assert.equal(b.aiCalls[0].imageBytes, 3);
  assert.doesNotMatch(JSON.stringify([a, b]), /secret prompt|YWJj/);
});

test('failed model calls remain failures with unknown usage', async () => {
  const error = new Error('provider failure');
  const caller = { async callAI() { throw error; } };
  instrumentModelCaller(caller);
  const result = { aiCalls: [] };
  await assert.rejects(withCallTelemetry(result, { index: 0 }, 'aiAssert', () => caller.callAI([])), value => value === error);
  assert.equal(result.aiCalls[0].status, 'failed');
  assert.equal(result.aiCalls[0].inputTokens, null);
  assert.ok(result.aiCalls[0].durationMs >= 0);
});
