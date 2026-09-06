import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFlow, describeFlow, summarize, expandEnv, normalizeExpectText, isCrashDetail, displayTitle, displayGroup } from "../worker/src/classify.mjs";

test("connection refused is BLOCKED", () => {
  const f = {
    name: "home",
    verdict: "fail",
    steps: [{ ok: false, detail: "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:9/" }],
  };
  assert.equal(classifyFlow(f), "blocked");
});

test("crash v3 admin-02 is BLOCKED, not FAIL", () => {
  const f = {
    name: "admin-02-dashboard-kpis",
    verdict: "fail",
    steps: [
      { ok: true, step: { goto: "/dashboard" } },
      { ok: true, step: { wait: 20000 } },
      { ok: false, step: { expectText: { text: "Dashboard" } }, detail: "Error: page.textContent: Target crashed" },
    ],
  };
  assert.equal(classifyFlow(f), "blocked");
  assert.equal(isCrashDetail("Target crashed"), true);
});

test("blocked verdict stays blocked", () => {
  assert.equal(classifyFlow({ verdict: "blocked", steps: [] }), "blocked");
});

test("unknown verdict fails closed as blocked", () => {
  assert.equal(classifyFlow({ verdict: "unknown", steps: [] }), "blocked");
});

test("login timeout with first step ok is FAIL, never evidence of an active session", () => {
  const f = {
    name: "admin-01-login-formulario",
    verdict: "fail",
    steps: [
      { ok: true, step: { goto: "/login" } },
      { ok: false, step: { fill: { selector: "input" } }, detail: "TimeoutError: locator.fill" },
    ],
  };
  assert.equal(classifyFlow(f), "fail");
  assert.equal(summarize([f]).allPass, false);
  assert.equal(summarize([f]).stamp, "FAIL");
});

test("real assertion miss is FAIL", () => {
  const f = {
    name: "checkout",
    verdict: "fail",
    steps: [{ ok: false, detail: 'texto "Pagar" não encontrado em body' }],
  };
  assert.equal(classifyFlow(f), "fail");
});

test("summarize stamp FAIL vs BLOCKED vs PASS", () => {
  assert.equal(summarize([{ status: "pass" }]).stamp, "PASS");
  assert.equal(summarize([{ status: "blocked" }]).stamp, "BLOCKED");
  assert.equal(summarize([{ status: "fail" }, { status: "blocked" }]).stamp, "FAIL");
  assert.equal(summarize([{ status: "warn" }]).stamp, "WARN");
});

test("describeFlow is generic, not hardcoded to a client app", () => {
  const f = { name: "x", steps: [{ step: { goto: "https://shop.test/cart" } }] };
  assert.match(describeFlow(f), /cart/);
  assert.doesNotMatch(describeFlow(f), /unidades|faturamento/);
});

test("describeFlow prefers scenario.what", () => {
  assert.equal(describeFlow({ what: "valida cupom", steps: [] }), "valida cupom");
});

test("displayTitle prefers heading, not uuid slug", () => {
  const f = {
    name: "cover-org-0c3d0025-proj-8e056209-dashboard",
    what: 'valida "Dashboard" (/org/x/proj/y/dashboard)',
    steps: [{ step: { goto: "https://admin.async.dev.br/org/x/proj/y/dashboard" } }],
  };
  assert.equal(displayTitle(f), "Dashboard");
  assert.equal(displayGroup(f), "Admin");
});

test("expandEnv interpolates $VARS", () => {
  process.env.WITNESS_EMAIL = "qa@example.com";
  assert.equal(expandEnv("$WITNESS_EMAIL"), "qa@example.com");
  assert.equal(expandEnv("plain"), "plain");
});

test("normalizeExpectText accepts string and object", () => {
  assert.deepEqual(normalizeExpectText("Dashboard"), { text: "Dashboard", selector: "body" });
  assert.deepEqual(normalizeExpectText({ text: "Hi", selector: "h1" }), { text: "Hi", selector: "h1" });
  assert.equal(normalizeExpectText(null), null);
});
