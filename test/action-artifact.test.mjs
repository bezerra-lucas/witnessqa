import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareActionArtifact } from "../worker/src/action-artifact.mjs";

test("Action artifact preparation preserves PASS only after a successful export", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-action-artifact-pass-"));
  const out = join(root, "upload");
  const verdict = prepareActionArtifact({
    runDir: join(root, "run"),
    outDir: out,
    verdict: "pass",
    exporter: (_runDir, outDir) => {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "REPORT.html"), "safe report");
    },
  });

  assert.equal(verdict, "pass");
  assert.ok(existsSync(join(out, "REPORT.html")));
});

test("Action artifact preparation changes PASS to FAIL when the exporter crashes", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-action-artifact-fail-"));
  const out = join(root, "upload");
  const privateError = "opaque-private-exporter-error";
  const verdict = prepareActionArtifact({
    runDir: join(root, "run"),
    outDir: out,
    verdict: "pass",
    exporter: () => {
      throw new Error(privateError);
    },
  });

  assert.equal(verdict, "fail");
  const fallback = readFileSync(join(out, "EXPORT-FAILED.txt"), "utf8");
  assert.doesNotMatch(fallback, new RegExp(privateError));
});
