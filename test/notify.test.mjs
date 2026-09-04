import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummary } from "../worker/src/notify.mjs";
import { renderVdiffHtml, visualDiff } from "../worker/src/vdiff.mjs";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

function writeResult(dir, screenshots) {
  writeFileSync(join(dir, "result.json"), JSON.stringify({
    privacyVersion: 1,
    name: "fixture",
    verdict: "pass",
    screenshots,
  }));
}

test("formatSummary includes stamp and fail titles", () => {
  const text = formatSummary({
    stamp: "FAIL",
    counts: { pass: 2, fail: 1, warn: 0, blocked: 0, skip: 0 },
    flows: [{ status: "fail", title: "Dashboard" }],
  });
  assert.match(text, /FAIL/);
  assert.match(text, /Dashboard/);
});

test("formatSummary redacts PII and sensitive URL parameters", () => {
  const text = formatSummary({
    stamp: "FAIL",
    counts: { fail: 1 },
    flows: [{ status: "fail", title: "private.person@example.test" }],
  }, { url: "https://report.test/view?token=unit-test-token" });

  assert.doesNotMatch(text, /private\.person@example\.test|unit-test-token/);
});

test("visualDiff sees added shot", () => {
  const a = mkdtempSync(join(tmpdir(), "vd-a-"));
  const b = mkdtempSync(join(tmpdir(), "vd-b-"));
  mkdirSync(join(a, "home"));
  mkdirSync(join(b, "home"));
  writeResult(join(a, "home"), ["step-00.png"]);
  writeResult(join(b, "home"), ["step-00.png", "step-01.png"]);
  writeFileSync(join(a, "home", "step-00.png"), Buffer.from("aaa"));
  writeFileSync(join(b, "home", "step-00.png"), Buffer.from("aaa"));
  writeFileSync(join(b, "home", "step-01.png"), Buffer.from("bbb"));
  const d = visualDiff(a, b);
  assert.equal(d.added, 1);
  assert.equal(d.changed, 0);
});

test("visualDiff ignores legacy, orphan and symlink screenshots", () => {
  const root = mkdtempSync(join(tmpdir(), "vd-private-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(join(a, "legacy"), { recursive: true });
  mkdirSync(join(b, "legacy"), { recursive: true });
  writeFileSync(join(a, "legacy", "legacy.png"), Buffer.from("opaque-legacy-a"));
  writeFileSync(join(b, "legacy", "legacy.png"), Buffer.from("opaque-legacy-b"));

  const safeA = join(a, "safe");
  const safeB = join(b, "safe");
  mkdirSync(safeA);
  mkdirSync(safeB);
  writeResult(safeA, ["linked.png"]);
  writeResult(safeB, ["linked.png"]);
  symlinkSync(join(a, "legacy", "legacy.png"), join(safeA, "linked.png"));
  symlinkSync(join(b, "legacy", "legacy.png"), join(safeB, "linked.png"));

  assert.deepEqual(visualDiff(a, b), { compared: 0, changed: 0, added: 0, removed: 0, rows: [] });
});

test("visualDiff output contains only changed-pixel masks", () => {
  const root = mkdtempSync(join(tmpdir(), "vd-mask-"));
  const a = join(root, "a");
  const b = join(root, "b");
  const out = join(root, "out");
  mkdirSync(join(a, "home"), { recursive: true });
  mkdirSync(join(b, "home"), { recursive: true });
  writeResult(join(a, "home"), ["shot.png"]);
  writeResult(join(b, "home"), ["shot.png"]);

  const before = new PNG({ width: 2, height: 1 });
  const after = new PNG({ width: 2, height: 1 });
  before.data.set([12, 34, 56, 255, 10, 20, 30, 255]);
  after.data.set([12, 34, 56, 255, 200, 210, 220, 255]);
  writeFileSync(join(a, "home", "shot.png"), PNG.sync.write(before));
  writeFileSync(join(b, "home", "shot.png"), PNG.sync.write(after));

  const result = visualDiff(a, b, out);
  assert.equal(result.changed, 1);
  const diff = PNG.sync.read(readFileSync(join(out, "home-shot.png")));
  assert.equal(diff.data[3], 0, "unchanged source pixels must be transparent");
});

test("visual diff report escapes hostile evidence names", () => {
  const html = renderVdiffHtml({
    compared: 1,
    changed: 1,
    added: 0,
    removed: 0,
    rows: [{ status: "changed", key: '\"><img src=x onerror="globalThis.pwned=true">.png', pct: 1 }],
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
