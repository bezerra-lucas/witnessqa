import { availableParallelism } from 'node:os';

export function parseJobs(value = '1', environment = process.env) {
  const ceiling = environment.WITNESS_MAX_JOBS ?? String(Math.min(16, availableParallelism()));
  if (!/^[1-9]\d*$/.test(String(ceiling)) || Number(ceiling) > 16) {
    throw new Error('WITNESS_MAX_JOBS must be an integer from 1 to 16');
  }
  if (!/^[1-9]\d*$/.test(String(value)) || Number(value) > Number(ceiling)) {
    throw new Error(`--jobs must be an integer from 1 to ${ceiling}`);
  }
  return Number(value);
}

export function capturePolicy(value = 'all') {
  if (!['all', 'checkpoints'].includes(value)) throw new Error('--capture must be all or checkpoints');
  return value;
}

export function shouldCapture(step, { policy, failed, final }) {
  return policy === 'all' || failed || final || step.evidence !== undefined;
}
