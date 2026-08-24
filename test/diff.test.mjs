import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNoiseNetwork, isNoiseMessage } from "../worker/src/classify.mjs";
import { diffRuns } from "../worker/src/diff.mjs";

test("RSC abort and React 418 are noise", () => {
  assert.equal(isNoiseNetwork("net::ERR_ABORTED https://x/?_rsc=abc"), true);
  assert.equal(isNoiseMessage("Minified React error #418; visit https://react.dev"), true);
  assert.equal(isNoiseNetwork("500 https://x/api/units"), false);
});

test("diff detects regression", () => {
  const a = mkdtempSync(join(tmpdir(), "wq-a-"));
  const b = mkdtempSync(join(tmpdir(), "wq-b-"));
  const write = (root, name, verdict, url) => {
    const d = join(root, name);
    mkdirSync(d);
    writeFileSync(join(d, "result.json"), JSON.stringify({
      name, verdict, steps: [{ ok: verdict === "pass", step: { goto: url } }],
    }));
  };
  write(a, "dash", "pass", "https://admin.example.com/dashboard");
  write(b, "dash", "fail", "https://admin.example.com/dashboard");
  write(b, "units", "pass", "https://admin.example.com/units");
  const d = diffRuns(a, b);
  assert.equal(d.regressions.length, 1);
  assert.equal(d.added.length, 1);
});
