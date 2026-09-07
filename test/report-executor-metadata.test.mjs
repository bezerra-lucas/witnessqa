import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScenario } from '../worker/src/executor.mjs';

test('evidence labels cannot turn missing purchase actions into authenticated-session skips', { timeout: 45_000 }, async t => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Purchase fixture</title><h1>Review purchase</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const app = `http://127.0.0.1:${server.address().port}`;
  const root = mkdtempSync(join(tmpdir(), 'wq-metadata-verdict-'));
  const actions = [
    { click: '#missing-payment' },
    { fill: { selector: '#missing-payment', value: 'fixture-value' } },
  ];
  for (const [index, action] of actions.entries()) {
    const result = await runScenario({ name: 'purchase-action', app,
      steps: [{ goto: '/purchase' }, { ...action, evidence: { label: 'Purchase after login', highlight: true } }],
    }, { evidenceDir: join(root, `case-${index}`) });
    assert.equal(result.verdict, 'fail', 'Display metadata must not convert a missing action to PASS');
    assert.equal(result.steps[1].ok, false);
    assert.notEqual(result.steps[1].skipped, true);
    assert.equal(result.failure.stepIndex, 1);
    assert.ok(result.steps[1].screenshot, 'The real failure still has sanitized evidence');
  }
});
