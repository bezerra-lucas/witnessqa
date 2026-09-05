import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { resolveServedFile } from "../worker/src/serve.mjs";

test("report server rejects traversal and symlink resources", () => {
  const parent = mkdtempSync(join(tmpdir(), "wq-serve-"));
  const root = join(parent, "report");
  mkdirSync(root);
  writeFileSync(join(root, "REPORT.html"), "safe report");
  const sibling = join(parent, `${basename(root)}-private.txt`);
  writeFileSync(sibling, "outside private file");
  symlinkSync(sibling, join(root, "linked.txt"));

  assert.equal(resolveServedFile(root, "/REPORT.html"), join(root, "REPORT.html"));
  assert.equal(resolveServedFile(root, `/../${basename(sibling)}`), null);
  assert.equal(resolveServedFile(root, "/linked.txt"), null);
  assert.equal(resolveServedFile(root, "/%E0%A4%A"), null);
});
