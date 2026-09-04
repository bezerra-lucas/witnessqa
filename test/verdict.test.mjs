import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateExitCode, normalizeFlowResult, verdictFromExitCode, workerExitCode } from "../worker/src/verdict.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "worker/src/verdict.mjs");

test("worker exit codes map to the public Action verdict contract", () => {
  assert.equal(verdictFromExitCode(0), "pass");
  assert.equal(verdictFromExitCode(1), "fail");
  assert.equal(verdictFromExitCode(2), "blocked");
  assert.equal(verdictFromExitCode(137), "fail");
});

test("release gate approves only PASS", () => {
  assert.equal(gateExitCode("pass"), 0);
  assert.equal(gateExitCode("fail"), 1);
  assert.equal(gateExitCode("blocked"), 1);
  assert.equal(gateExitCode("unknown"), 1);

  for (const [verdict, status] of [["pass", 0], ["fail", 1], ["blocked", 1]]) {
    assert.equal(spawnSync(process.execPath, [script, "gate", verdict]).status, status, verdict);
  }
});

test("worker aggregation fails closed for warnings, unknown verdicts, and empty runs", () => {
  assert.equal(workerExitCode([{ verdict: "pass" }]), 0);
  assert.equal(workerExitCode([{ verdict: "fail" }]), 1);
  assert.equal(workerExitCode([{ verdict: "warn" }]), 1);
  assert.equal(workerExitCode([{ verdict: "blocked" }]), 2);
  assert.equal(workerExitCode([{ verdict: "unknown" }]), 2);
  assert.equal(workerExitCode([]), 2);

  const unknown = { name: "unexpected", verdict: "unknown", steps: [] };
  assert.deepEqual(normalizeFlowResult(unknown), {
    ...unknown,
    verdict: "blocked",
    failure: { type: "invalidVerdict", message: "o executor devolveu um veredito inválido" },
  });
});
