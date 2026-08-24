import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { parseScenario } from "../worker/src/scenario.mjs";

test("parseScenario aceita yaml mínimo", () => {
  const s = parseScenario("name: smoke\nsteps:\n  - goto: /\n", YAML);
  assert.equal(s.name, "smoke");
  assert.equal(s.steps.length, 1);
});

test("parseScenario recusa sem name", () => {
  assert.throws(() => parseScenario("steps: []", YAML), /inválido/);
});
