import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8766;

function waitFor(url, ms = 8000) {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < ms) {
      try {
        const res = await fetch(url);
        if (res.ok) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  })();
}

test("e2e fixture: 2 pass + 1 fail, HTML laudo gerado", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });
  try {
    const up = await waitFor(`http://127.0.0.1:${PORT}/`);
    assert.equal(up, true, "fixture server did not start");

    const out = mkdtempSync(join(tmpdir(), "wq-e2e-"));
    const worker = join(root, "worker/src/worker.mjs");
    const scenarios = join(root, "test/fixtures/witness");
    const code = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [worker, scenarios, "--base-url", `http://127.0.0.1:${PORT}`, "--out", out],
        { stdio: "inherit" },
      );
      child.on("exit", (c) => resolve(c ?? 0));
    });
    assert.equal(code, 1, "missing.yaml deve falhar o run (exit 1)");

    const htmlPath = join(out, "REPORT.html");
    assert.ok(existsSync(htmlPath), "REPORT.html");
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /FAIL/);
    assert.match(html, /data-name="fixture-home"/);
    assert.match(html, /data-name="fixture-cart"/);
    assert.match(html, /data-name="fixture-missing"/);
    assert.match(html, /este texto nao existe/);
    assert.match(html, /Pedido confirmado|fixture-cart/);

    for (const name of ["home", "cart", "missing"]) {
      const rj = join(out, name, "result.json");
      assert.ok(existsSync(rj), rj);
    }
    const home = JSON.parse(readFileSync(join(out, "home", "result.json"), "utf8"));
    const cart = JSON.parse(readFileSync(join(out, "cart", "result.json"), "utf8"));
    const missing = JSON.parse(readFileSync(join(out, "missing", "result.json"), "utf8"));
    assert.equal(home.verdict, "pass");
    assert.equal(cart.verdict, "pass");
    assert.equal(missing.verdict, "fail");
    assert.ok(home.screenshots.length >= 1);
    assert.ok(existsSync(join(out, "missing", "page.html")));
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 90_000 });
