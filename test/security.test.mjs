import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { expandEnv } from "../worker/src/classify.mjs";
import { parseScenario } from "../worker/src/scenario.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function filesBelow(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("tracked scenarios inject every fill value through environment variables", () => {
  const files = [join(root, "witness"), join(root, "worker/scenarios"), join(root, "test/fixtures/witness")]
    .flatMap(filesBelow)
    .filter((path) => /\.ya?ml$/.test(path));

  for (const file of files) {
    const scenario = YAML.parse(readFileSync(file, "utf8"));
    for (const [index, step] of (scenario.steps ?? []).entries()) {
      if (!step.fill) continue;
      const value = step.fill.value ?? step.fill[1];
      assert.ok(/^\$[A-Z_][A-Z0-9_]*$/.test(value), `${file}: step ${index} must use an env reference`);
    }
  }
});

test("expandEnv can require variables without exposing their values", () => {
  const env = { PRESENT_SECRET: "unit-test-sentinel" };
  assert.equal(expandEnv("$PRESENT_SECRET", env, { required: true }), "unit-test-sentinel");
  assert.throws(
    () => expandEnv("$MISSING_SECRET", env, { required: true }),
    (error) => error.message.includes("MISSING_SECRET") && !error.message.includes("unit-test-sentinel"),
  );
});

test("parseScenario never repeats malformed source in its error", () => {
  const sentinel = "unit-test-private-source";
  assert.throws(
    () => parseScenario(`name: broken\nsteps: [\nprivate: ${sentinel}`, YAML),
    (error) => !error.message.includes(sentinel),
  );
});

test("GitHub Action uploads only the prepared evidence bundle", () => {
  const action = readFileSync(join(root, "action/action.yml"), "utf8");
  const parsed = YAML.parse(action);
  assert.match(action, /export-artifact\.mjs/);
  assert.match(action, /path:\s*\$\{\{ steps\.run\.outputs\.artifact-path \}\}/);
  assert.doesNotMatch(action, /path:\s*\.witness\/runs\//);
  assert.doesNotMatch(action, /MODE="\$\{\{ inputs\./);
  assert.doesNotMatch(action, /ARGS=\("\$\{\{ inputs\./);
  assert.doesNotMatch(action, /Evidence artifact: \*\*\$\{\{ inputs\./);
  assert.match(action, /ARGS=\(\)\s+if \[ -n "\$BASE" \]; then ARGS\+?=\("\$BASE"\); fi/s);
  assert.doesNotMatch(action, /LATEST=\$\(ls/);
  assert.match(action, /mktemp -d/);
  assert.match(action, /WITNESS_RUN_OUT/);
  assert.equal(parsed.outputs.verdict.value, "${{ steps.run.outputs.verdict }}");
  assert.equal(parsed.outputs["report-path"].value, "${{ steps.run.outputs.report-path }}");
  assert.equal(parsed.outputs["artifact-path"].value, "${{ steps.run.outputs.artifact-path }}");
  for (const step of parsed.runs.steps) {
    if (!step.run) continue;
    assert.doesNotMatch(step.run, /\$\{\{\s*(?:steps\.run\.outputs|github\.event)\./, `${step.name} interpolates untrusted output in shell`);
  }
});
