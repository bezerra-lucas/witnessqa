import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function cleanHarness(sourceRoot, { parent, workerSource } = {}) {
  const container = parent ?? mkdtempSync(join(tmpdir(), "witnessqa-clean-"));
  const harness = join(container, "witnessqa");
  cpSync(sourceRoot, harness, {
    recursive: true,
    filter: (source) => ![".git", "node_modules"].includes(source.split(/[\\/]/).at(-1)),
  });
  symlinkSync(realpathSync(join(sourceRoot, "node_modules")), join(harness, "node_modules"), "dir");
  if (workerSource) writeFileSync(join(harness, "worker/src/worker.mjs"), workerSource);

  for (const arguments_ of [
    ["init", "-b", "main"],
    ["config", "user.email", "fixture@example.invalid"],
    ["config", "user.name", "Fixture"],
    ["add", "."],
    ["commit", "-m", "fixture"],
  ]) {
    const completed = spawnSync("git", ["-C", harness, ...arguments_], { encoding: "utf8" });
    if (completed.status !== 0) throw new Error(completed.stderr || "could not create clean harness fixture");
  }

  copyFileSync(join(harness, "cli.mjs"), join(harness, "witnessqa"));
  chmodSync(join(harness, "witnessqa"), 0o755);
  return harness;
}
