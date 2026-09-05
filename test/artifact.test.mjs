import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportArtifact } from "../worker/src/export-artifact.mjs";

test("artifact export allowlists verified evidence and omits legacy or orphan files", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-export-"));
  const run = join(root, "run");
  const out = join(root, "upload");
  const safe = join(run, "safe-flow");
  const legacy = join(run, "legacy-flow");
  const linkedResult = join(run, "linked-result-flow");
  mkdirSync(safe, { recursive: true });
  mkdirSync(legacy);
  mkdirSync(linkedResult);

  writeFileSync(join(safe, "result.json"), JSON.stringify({
    privacyVersion: 1,
    name: "safe",
    verdict: "pass",
    steps: [],
    consoleErrors: [],
    screenshots: ["step-00.png", "linked.png"],
  }));
  writeFileSync(join(safe, "step-00.png"), Buffer.from("verified-bitmap"));
  writeFileSync(join(safe, "orphan.png"), Buffer.from("orphan-bitmap"));
  const outside = join(root, "outside.png");
  writeFileSync(outside, Buffer.from("outside-bitmap"));
  symlinkSync(outside, join(safe, "linked.png"));
  const outsideHtml = join(root, "outside.html");
  const outsideUrl = join(root, "outside.txt");
  writeFileSync(outsideHtml, "<p>outside-private-html</p>");
  writeFileSync(outsideUrl, "https://outside.test/?token=outside-private-token");
  symlinkSync(outsideHtml, join(safe, "page.html"));
  symlinkSync(outsideUrl, join(safe, "url.txt"));
  writeFileSync(join(legacy, "result.json"), JSON.stringify({
    name: "legacy",
    verdict: "pass",
    steps: [],
    screenshots: ["legacy.png"],
  }));
  writeFileSync(join(legacy, "legacy.png"), Buffer.from("legacy-bitmap"));
  const outsideResult = join(root, "outside-result.json");
  writeFileSync(outsideResult, JSON.stringify({ privacyVersion: 1, name: "linked", verdict: "pass", screenshots: [] }));
  symlinkSync(outsideResult, join(linkedResult, "result.json"));
  writeFileSync(join(run, "REPORT.md"), "legacy opaque fill: outside-private-report");

  const exported = exportArtifact(run, out);
  assert.equal(exported.flows, 1);
  assert.ok(existsSync(join(out, "safe-flow", "step-00.png")));
  assert.ok(existsSync(join(out, "REPORT.html")));
  assert.equal(existsSync(join(out, "safe-flow", "orphan.png")), false);
  assert.equal(existsSync(join(out, "safe-flow", "linked.png")), false);
  assert.equal(existsSync(join(out, "safe-flow", "page.html")), false);
  assert.equal(existsSync(join(out, "safe-flow", "url.txt")), false);
  assert.equal(existsSync(join(out, "legacy-flow")), false);
  assert.equal(existsSync(join(out, "linked-result-flow")), false);
  assert.doesNotMatch(readFileSync(join(out, "REPORT.html"), "utf8"), /b3JwaGFuLWJpdG1hcA==|bGVnYWN5LWJpdG1hcA==/);
  assert.doesNotMatch(readFileSync(join(out, "REPORT.html"), "utf8"), /outside-private-(?:html|token|report)/);
  assert.equal(existsSync(join(out, "REPORT.md")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "safe-flow", "result.json"), "utf8")).screenshots, ["step-00.png"]);
});

test("artifact export refuses a reused destination", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-export-existing-"));
  const run = join(root, "run");
  const out = join(root, "upload");
  mkdirSync(run);
  mkdirSync(out);
  writeFileSync(join(out, "stale-private.txt"), "must not survive");

  assert.throws(() => exportArtifact(run, out), /já existe/);
});

test("artifact export creates a sanitized non-pass dossier when a run produced no flows", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-export-fallback-"));
  const out = join(root, "upload");

  const exported = exportArtifact(join(root, "missing-run"), out, { fallbackVerdict: "blocked" });

  assert.equal(exported.flows, 1);
  assert.ok(existsSync(join(out, "REPORT.html")));
  const result = JSON.parse(readFileSync(join(out, "run-status", "result.json"), "utf8"));
  assert.equal(result.verdict, "blocked");
  assert.equal(result.privacyVersion, 1);
});
