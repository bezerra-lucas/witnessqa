import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function upsertPrComment(environment = process.env, fetchImpl = fetch) {
  const { GITHUB_REPOSITORY: repo, WITNESS_PR_NUMBER: pr, WITNESS_HEAD_SHA: head,
    GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt = '1', GH_TOKEN: token } = environment;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^\d+$/.test(pr ?? '') ||
      !/^[a-f0-9]{40}$/.test(head ?? '') || !/^\d+$/.test(run ?? '') || !/^\d+$/.test(attempt) || !token) {
    throw new Error('PR comment requires repository, PR, head SHA and Actions run identity');
  }
  const api = environment.GITHUB_API_URL ?? 'https://api.github.com';
  if (new URL(api).protocol !== 'https:') throw new Error('GitHub API must use HTTPS');
  const request = async (path, method = 'GET', body) => {
    const response = await fetchImpl(`${api}/repos/${repo}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub comment request failed (${response.status})`);
    return response.json();
  };
  const artifact = environment.WITNESS_ARTIFACT_NAME ?? 'witnessqa-report';
  const key = createHash('sha256').update(artifact).digest('hex').slice(0, 24);
  const marker = `<!-- witnessqa:${key} -->`;
  let existing;
  for (let page = 1; ; page++) {
    const comments = await request(`/issues/${pr}/comments?per_page=100&page=${page}`);
    existing = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker));
    if (existing || comments.length < 100) break;
  }
  const current = await request(`/pulls/${pr}`);
  if (current.head?.sha !== head) return { skipped: 'obsolete-head' };
  const previous = existing?.body?.match(/<!-- witnessqa-run:(\d+):(\d+) -->/);
  if (previous && (BigInt(previous[1]) > BigInt(run) ||
      (previous[1] === run && BigInt(previous[2]) > BigInt(attempt)))) return { skipped: 'obsolete-run' };
  const verdict = ['pass', 'fail', 'blocked'].includes(environment.WITNESS_VERDICT) ? environment.WITNESS_VERDICT : 'fail';
  const server = environment.GITHUB_SERVER_URL ?? 'https://github.com';
  const body = `${marker}\n<!-- witnessqa-run:${run}:${attempt} -->\n## WitnessQA · ${verdict.toUpperCase()}\n\n` +
    `Revisão testada: \`${head}\`.\n\n[Execução e artefatos](${server}/${repo}/actions/runs/${run}). ` +
    'Baixe o pacote de evidências e abra REPORT.html junto de REPORT.assets.\n';
  await request(existing ? `/issues/comments/${existing.id}` : `/issues/${pr}/comments`, existing ? 'PATCH' : 'POST', { body });
  return { updated: Boolean(existing) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { console.log(JSON.stringify(await upsertPrComment())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
