import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

test("cover propagates a failing worker while preserving its report", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });
  try {
    const port = await waitForServerPort(server);
    const out = mkdtempSync(join(tmpdir(), "wq-cover-exit-"));
    const runDir = join(out, "run");
    const result = spawnSync(process.execPath, [
      join(root, "cli.mjs"),
      "cover",
      `http://127.0.0.1:${port}`,
      "--max", "10",
      "--jobs", "1",
      "--no-open",
      "--no-serve",
    ], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WITNESS_RUN_OUT: runDir, WITNESS_COVER_OUT: join(out, "graph") },
      timeout: 60_000,
    });

    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.ok(existsSync(join(runDir, "REPORT.html")), "failure report must survive for CI upload");
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 70_000 });

test("cover blocks when route discovery cannot capture the target", () => {
  const out = mkdtempSync(join(tmpdir(), "wq-cover-blocked-"));
  const result = spawnSync(process.execPath, [
    join(root, "cli.mjs"),
    "cover",
    "http://127.0.0.1:65530",
    "--max", "1",
    "--discover-only",
    "--no-open",
    "--no-serve",
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WITNESS_COVER_OUT: join(out, "graph") },
    timeout: 40_000,
  });

  assert.equal(result.status, 2, result.stdout || result.stderr);
  assert.ok(existsSync(join(out, "graph", "coverage.json")), "blocked discovery must preserve its coverage record");
}, { timeout: 45_000 });
