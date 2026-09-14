import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertPrComment } from '../worker/src/action-comment.mjs';

const env = { GITHUB_REPOSITORY: 'example/app', WITNESS_PR_NUMBER: '3', WITNESS_HEAD_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '20', GH_TOKEN: 'test-token', WITNESS_VERDICT: 'pass' };
function api({ comments = [], head = env.WITNESS_HEAD_SHA } = {}) {
  const writes = [];
  return { writes, fetch: async (url, options) => {
    if (options.method !== 'GET') { writes.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ id: 7 }) }; }
    return { ok: true, json: async () => url.includes('/comments?') ? comments : { head: { sha: head } } };
  } };
}

test('Action comment updates its own bot comment and never an obsolete revision or newer run', async () => {
  const first = api();
  await upsertPrComment(env, first.fetch);
  assert.equal(first.writes.length, 1);
  assert.equal(first.writes[0].method, 'POST');
  const body = first.writes[0].body.body;
  assert.match(body, /actions\/runs\/20/);
  assert.match(body, new RegExp(env.WITNESS_HEAD_SHA));
  const comment = { id: 7, user: { login: 'github-actions[bot]' }, body };
  const second = api({ comments: [comment] });
  await upsertPrComment({ ...env, WITNESS_VERDICT: 'fail', GITHUB_RUN_ID: '21' }, second.fetch);
  assert.equal(second.writes[0].method, 'PATCH');
  assert.match(second.writes[0].body.body, /FAIL/);
  const stale = api({ head: 'b'.repeat(40), comments: [comment] });
  assert.deepEqual(await upsertPrComment(env, stale.fetch), { skipped: 'obsolete-head' });
  assert.equal(stale.writes.length, 0);
  const older = api({ comments: [comment] });
  assert.deepEqual(await upsertPrComment({ ...env, GITHUB_RUN_ID: '19' }, older.fetch), { skipped: 'obsolete-run' });
  assert.equal(older.writes.length, 0);
  const human = api({ comments: [{ ...comment, user: { login: 'human' } }] });
  await upsertPrComment(env, human.fetch);
  assert.equal(human.writes[0].method, 'POST');
});
