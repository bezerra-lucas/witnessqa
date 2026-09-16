import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const instrumented = Symbol('witness.telemetry');
const count = value => Number.isFinite(value) && value >= 0 ? value : null;

// Retain structure and counts only: never prompts, image payloads or responses.
export function summarizeMessages(messages) {
  const summary = { messageCount: messages.length, imageCount: 0, textCharacters: 0, systemTextCharacters: 0, imageBytes: 0 };
  for (const message of messages) {
    const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
    for (const part of parts) {
      if (part.type === 'text') {
        summary.textCharacters += part.text?.length ?? 0;
        if (message.role === 'system') summary.systemTextCharacters += part.text?.length ?? 0;
      }
      if (part.type === 'image_url') {
        summary.imageCount += 1;
        const url = part.image_url?.url;
        if (typeof url === 'string' && /^data:image\/[^;]+;base64,/.test(url)) summary.imageBytes += Buffer.byteLength(url.slice(url.indexOf(',') + 1), 'base64');
      }
    }
  }
  return summary;
}

export function withCallTelemetry(result, entry, action, operation) {
  return context.run({ result, entry, action }, operation);
}

// Private boundary protected by the exact SDK pin and real-SDK integration test.
export function instrumentModelCaller(caller) {
  if (caller.callAI[instrumented]) return;
  const original = caller.callAI;
  const wrapped = async function (messages, runtime, options) {
    const scope = context.getStore();
    if (!scope) return original.apply(this, arguments);
    const row = { call: scope.result.aiCalls.length + 1, stepIndex: scope.entry.index, action: scope.action,
      startedAt: new Date().toISOString(), status: 'incomplete', inputTokens: null, outputTokens: null,
      cachedInputTokens: null, uncachedInputTokens: null, totalTokens: null, ...summarizeMessages(messages) };
    scope.result.aiCalls.push(row);
    const start = performance.now();
    try {
      const response = await original.apply(this, arguments);
      const usage = response.usage;
      row.status = 'completed';
      row.inputTokens = count(usage?.prompt_tokens);
      row.outputTokens = count(usage?.completion_tokens);
      row.totalTokens = count(usage?.total_tokens);
      row.cachedInputTokens = count(usage?.prompt_tokens_details?.cached_tokens);
      if (row.inputTokens !== null && row.cachedInputTokens !== null && row.cachedInputTokens <= row.inputTokens) row.uncachedInputTokens = row.inputTokens - row.cachedInputTokens;
      row.reasoningOutputTokens = count(usage?.completion_tokens_details?.reasoning_tokens);
      row.providerDurationMs = count(usage?.time_cost);
      return response;
    } catch (error) { row.status = 'failed'; throw error; }
    finally { row.durationMs = performance.now() - start; }
  };
  wrapped[instrumented] = true;
  caller.callAI = wrapped;
}
