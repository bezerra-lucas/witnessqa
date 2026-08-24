import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8767;
const out = process.argv[2] || join(root, ".tmp", "v4-fixture");

const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "inherit",
});

const ready = await (async () => {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
})();

if (!ready) {
  server.kill();
  console.error("fixture server failed");
  process.exit(2);
}

const code = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [join(root, "worker/src/worker.mjs"), join(root, "test/fixtures/witness"), "--base-url", `http://127.0.0.1:${PORT}`, "--out", out],
    { stdio: "inherit" },
  );
  child.on("exit", (c) => resolve(c ?? 0));
});
server.kill();

const destDir = "C:/Users/lucas/Downloads";
try {
  copyFileSync(join(out, "REPORT.html"), join(destDir, "WitnessQA-v4-fixture.html"));
  console.log("copied to Downloads/WitnessQA-v4-fixture.html");
} catch (e) {
  console.error("copy failed", e.message);
}
process.exit(code);
