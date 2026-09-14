import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function phaseMetrics() {
  const phases = {};
  return {
    phases,
    async measure(name, action) {
      const start = performance.now();
      try { return await action(); }
      finally { phases[name] = (phases[name] ?? 0) + performance.now() - start; }
    },
  };
}

export function artifactBytes(dir) {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    bytes += stat.isDirectory() ? artifactBytes(path) : stat.size;
  }
  return bytes;
}
