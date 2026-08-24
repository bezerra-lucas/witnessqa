import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packRun } from "../worker/src/packer.mjs";

function fixtureRun() {
  const dir = mkdtempSync(join(tmpdir(), "wq-"));
  const failDir = join(dir, "checkout");
  mkdirSync(failDir);
  writeFileSync(
    join(failDir, "result.json"),
    JSON.stringify({
      name: "checkout",
      what: "valida o checkout",
      verdict: "fail",
      startedAt: "2026-08-23T21:12:00.000Z",
      steps: [
        { index: 0, ok: true, step: { goto: "https://shop.test/cart" } },
        { index: 1, ok: false, step: { expectText: "Pagar" }, detail: 'texto "Pagar" não encontrado em body' },
      ],
      consoleErrors: ["TypeError: x is not a function"],
      networkErrors: ["422 https://shop.test/api/coupon"],
      pageErrors: [],
      screenshots: [],
      analysis: { cause: "cupom rejeitado", isBug: true, confidence: 0.8, suggestion: "normalizar case" },
    }),
  );

  const crashDir = join(dir, "dashboard");
  mkdirSync(crashDir);
  writeFileSync(
    join(crashDir, "result.json"),
    JSON.stringify({
      name: "admin-02-dashboard-kpis",
      verdict: "fail",
      startedAt: "2026-08-23T21:12:00.000Z",
      steps: [
        { index: 0, ok: true, step: { goto: "https://admin.test/dashboard" } },
        { index: 1, ok: false, step: { expectText: { text: "Dashboard" } }, detail: "Error: page.textContent: Target crashed" },
      ],
      consoleErrors: [],
      screenshots: [],
    }),
  );
  return dir;
}

test("packer marks crash as BLOCKED and fail as FAIL", () => {
  const dir = fixtureRun();
  const info = packRun(dir);
  assert.equal(info.stamp, "FAIL");
  assert.equal(info.flows, 2);
  assert.equal(info.counts.fail, 1);
  assert.equal(info.counts.blocked, 1);
  const html = readFileSync(join(dir, "REPORT.html"), "utf8");
  assert.match(html, /BLOCKED/);
  assert.match(html, /Investigação BYOK/);
  assert.match(html, /cupom rejeitado/);
  assert.doesNotMatch(html, /📷/);
  assert.match(html, /Instrument Serif/);
  assert.match(html, /themeBtn/);
  assert.match(html, /id="lightbox"/);
  assert.ok(existsSync(info.path));
});

test("packer refuses missing dir", () => {
  assert.throws(() => packRun("/no/such/run"), /uso:/);
});
