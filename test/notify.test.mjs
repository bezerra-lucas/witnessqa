import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummary } from "../worker/src/notify.mjs";
import { visualDiff } from "../worker/src/vdiff.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("formatSummary includes stamp and fail titles", () => {
  const text = formatSummary({
    stamp: "FAIL",
    counts: { pass: 2, fail: 1, warn: 0, blocked: 0, skip: 0 },
    flows: [{ status: "fail", title: "Dashboard" }],
  });
  assert.match(text, /FAIL/);
  assert.match(text, /Dashboard/);
});

test("visualDiff sees added shot", () => {
  const a = mkdtempSync(join(tmpdir(), "vd-a-"));
  const b = mkdtempSync(join(tmpdir(), "vd-b-"));
  mkdirSync(join(a, "home"));
  mkdirSync(join(b, "home"));
  writeFileSync(join(a, "home", "step-00.png"), Buffer.from("aaa"));
  writeFileSync(join(b, "home", "step-00.png"), Buffer.from("aaa"));
  writeFileSync(join(b, "home", "step-01.png"), Buffer.from("bbb"));
  const d = visualDiff(a, b);
  assert.equal(d.added, 1);
  assert.equal(d.changed, 0);
});
