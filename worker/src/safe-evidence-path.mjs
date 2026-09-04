import { lstatSync, realpathSync } from "node:fs";
import { basename, extname, isAbsolute, resolve, relative } from "node:path";

/** Resolve a regular evidence file without allowing traversal or symbolic links. */
export function safeEvidencePath(baseDir, name, { extension } = {}) {
  if (typeof name !== "string" || !name || basename(name) !== name) return null;
  return safeContainedEvidencePath(baseDir, name, { extension });
}

/** Resolve a nested regular file while keeping it inside its real base directory. */
export function safeContainedEvidencePath(baseDir, name, { extension } = {}) {
  if (typeof name !== "string" || !name) return null;
  if (extension && extname(name).toLowerCase() !== extension.toLowerCase()) return null;

  try {
    const lexicalBase = resolve(baseDir);
    const candidate = resolve(lexicalBase, name);
    const lexicalRel = relative(lexicalBase, candidate);
    if (!lexicalRel || lexicalRel.startsWith("..") || isAbsolute(lexicalRel)) return null;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;

    const base = realpathSync(lexicalBase);
    const actual = realpathSync(candidate);
    const rel = relative(base, actual);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return actual;
  } catch {
    return null;
  }
}
