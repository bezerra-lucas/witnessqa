import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function waitForServerPort(server, ms = 8000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("fixture server did not start")), ms);
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/fixture http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture server exited early (${code})`));
    });
  });
}

test("e2e fixture: 3 pass + 1 fail, sanitized HTML dossier generated", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });
  try {
    const port = await waitForServerPort(server);

    const out = mkdtempSync(join(tmpdir(), "wq-e2e-"));
    const legacySecret = "opaque-legacy-fill-value";
    const legacyHome = join(out, "home");
    mkdirSync(legacyHome);
    writeFileSync(join(legacyHome, "result.json"), JSON.stringify({
      name: "fixture-home",
      verdict: "pass",
      steps: [{ ok: true, step: { fill: { selector: "#legacy", value: legacySecret } } }],
      screenshots: ["legacy.png"],
    }));
    writeFileSync(join(legacyHome, "legacy.png"), Buffer.from("legacy-bitmap"));
    const invalidSecret = "opaque-invalid-resume-value";
    const invalidCart = join(out, "cart");
    mkdirSync(invalidCart);
    writeFileSync(join(invalidCart, "result.json"), JSON.stringify({
      privacyVersion: 1,
      name: "invalid resume",
      verdict: "unknown",
      steps: [{ ok: true, step: { fill: { selector: "#stale", value: invalidSecret } } }],
      screenshots: ["invalid.png"],
    }));
    writeFileSync(join(invalidCart, "invalid.png"), Buffer.from("invalid-resume-bitmap"));
    const worker = join(root, "worker/src/worker.mjs");
    const scenarios = join(root, "test/fixtures/witness");
    const code = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [worker, scenarios, "--base-url", `http://127.0.0.1:${port}`, "--out", out],
        { stdio: "inherit", env: { ...process.env, FIXTURE_PRIVATE_EMAIL: "private.person@example.test" } },
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
    assert.match(html, /data-name="fixture-privacy"/);
    assert.match(html, /este texto nao existe/);
    assert.match(html, /Pedido confirmado|fixture-cart/);

    for (const name of ["home", "cart", "missing", "privacy"]) {
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
    assert.equal(home.privacyVersion, 1);
    assert.doesNotMatch(readFileSync(join(out, "home", "result.json"), "utf8"), new RegExp(legacySecret));
    assert.equal(existsSync(join(out, "home", "legacy.png")), false, "legacy evidence must be discarded before rerun");
    assert.equal(existsSync(join(out, "cart", "invalid.png")), false, "unknown verdict evidence must be discarded before rerun");
    assert.doesNotMatch(readFileSync(join(out, "cart", "result.json"), "utf8"), new RegExp(invalidSecret));

    const privateTexts = ["Fixture Private Person", "Fixture Custom Selector Private"];
    const textArtifacts = [
      join(out, "REPORT.md"),
      join(out, "REPORT.html"),
      ...["home", "cart", "missing", "privacy"].flatMap((name) => [
        join(out, name, "result.json"),
        join(out, name, "page.html"),
        join(out, name, "url.txt"),
      ]),
    ].filter(existsSync);
    for (const artifact of textArtifacts) {
      for (const privateText of privateTexts) {
        assert.doesNotMatch(readFileSync(artifact, "utf8"), new RegExp(privateText), artifact);
      }
    }

    const shot = PNG.sync.read(readFileSync(join(out, "privacy", "step-01.png")));
    const customSelectorPixel = (270 * shot.width + 30) * 4;
    assert.deepEqual([...shot.data.subarray(customSelectorPixel, customSelectorPixel + 3)], [0, 0, 0], "custom redaction selectors must be masked black");
    const pixel = (310 * shot.width + 30) * 4;
    assert.deepEqual([...shot.data.subarray(pixel, pixel + 3)], [0, 0, 0], "sensitive input must be masked black");
    const framePixel = (310 * shot.width + 260) * 4;
    assert.deepEqual([...shot.data.subarray(framePixel, framePixel + 3)], [0, 0, 0], "iframes must be masked black");
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 90_000 });
