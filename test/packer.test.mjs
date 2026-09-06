import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync } from "node:fs";
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
      screenshots: ["legacy.png"],
      analysis: { cause: "cupom rejeitado", isBug: true, confidence: 0.8, suggestion: "normalizar case" },
    }),
  );
  writeFileSync(join(failDir, "legacy.png"), Buffer.from("unsafe-legacy-bitmap"));

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
  assert.doesNotMatch(html, new RegExp(Buffer.from("unsafe-legacy-bitmap").toString("base64")));
  assert.match(html, /captura legada omitida/i);
  assert.ok(existsSync(info.path));
});

test("packer refuses missing dir", () => {
  assert.throws(() => packRun("/no/such/run"), /uso:/);
});

test("packer shows unique assertion captures and the actual final route", () => {
  const dir = mkdtempSync(join(tmpdir(), "wq-useful-"));
  const flow = join(dir,"units"); mkdirSync(flow);
  for (const name of ['fill.png','assert.png','duplicate.png']) writeFileSync(join(flow,name),Buffer.from('same-image'));
  writeFileSync(join(flow,'result.json'),JSON.stringify({privacyVersion:1,name:'units',what:'Unidades',verdict:'fail',
    finalUrl:'http://127.0.0.1:42000/login',failure:{type:'dependency',message:'Login não comprovado'},
    steps:[{index:0,ok:true,step:{fill:{selector:'input',value:'secret'}},screenshot:'fill.png'},
      {index:1,ok:false,step:{expectText:'Unidades'},screenshot:'assert.png'}],
    screenshots:['fill.png','assert.png','duplicate.png']}));
  const report = readFileSync(packRun(dir).path,'utf8');
  assert.equal((report.match(/data:image\/png;base64,/g)||[]).length,1);
  assert.match(report,/URL final/);
  assert.match(report,/Login não comprovado/);
});

test("packer escapes scenario names in HTML attributes", () => {
  const dir = mkdtempSync(join(tmpdir(), "wq-xss-"));
  const flow = join(dir, "unsafe-name");
  mkdirSync(flow);
  writeFileSync(join(flow, "result.json"), JSON.stringify({
    privacyVersion: 1,
    name: '\"><img src=x onerror="globalThis.pwned=true">',
    verdict: "pass",
    steps: [],
    consoleErrors: [],
    screenshots: [],
  }));

  packRun(dir);
  const html = readFileSync(join(dir, "REPORT.html"), "utf8");
  assert.doesNotMatch(html, /data-name=""><img/);
  assert.match(html, /data-name="&quot;&gt;&lt;img/);
});

test("packer refuses traversal and symlink screenshot paths", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-path-"));
  const run = join(root, "run");
  const flow = join(run, "flow");
  mkdirSync(flow, { recursive: true });
  const outside = join(root, "outside.png");
  writeFileSync(outside, Buffer.from("outside-private-bitmap"));
  symlinkSync(outside, join(flow, "linked.png"));
  writeFileSync(join(flow, "result.json"), JSON.stringify({
    privacyVersion: 1,
    name: "path safety",
    verdict: "pass",
    steps: [],
    consoleErrors: [],
    screenshots: ["../../outside.png", "linked.png"],
  }));

  packRun(run);
  const html = readFileSync(join(run, "REPORT.html"), "utf8");
  assert.doesNotMatch(html, new RegExp(Buffer.from("outside-private-bitmap").toString("base64")));
});
