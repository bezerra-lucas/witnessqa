import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanHarness as copyCleanHarness } from "./helpers/clean-harness.mjs";

const umaskBeforeCliImport = process.umask();
const { positionalArgs } = await import("../cli.mjs");
const umaskAfterCliImport = process.umask();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

function cleanHarness() {
  return copyCleanHarness(root);
}

test("importing CLI helpers does not change the caller umask", () => {
  assert.equal(umaskAfterCliImport, umaskBeforeCliImport);
});

test("cli --version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "0.3.2");
});

test("cli --version-json identifies the immutable CI interface and checkout", () => {
  const harness = cleanHarness();
  const expectedHead = spawnSync("git", ["-C", harness, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

  const r = spawnSync(join(harness, "witnessqa"), ["--version-json"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` },
  });

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    schema: "witnessqa-version/v1",
    interface: "witnessqa-ci/v1",
    version: "0.3.2",
    head_sha: expectedHead,
    package_lock_sha256: createHash("sha256").update(readFileSync(join(harness, "package-lock.json"))).digest("hex"),
  });
});

test("cli --version-json blocks when any harness source drifts from HEAD", () => {
  const harness = cleanHarness();
  writeFileSync(join(harness, "worker/src/ci.mjs"), "// changed after install\n", { flag: "a" });

  const r = spawnSync(process.execPath, [join(harness, "cli.mjs"), "--version-json"], { encoding: "utf8" });

  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /imutável/);
  assert.equal(r.stdout, "");
});

test("installed CI executable cannot claim the checkout identity after diverging from cli.mjs", () => {
  const harness = cleanHarness();
  const executable = join(harness, "witnessqa");
  copyFileSync(join(harness, "cli.mjs"), executable);
  writeFileSync(executable, "// diverged executable\n", { flag: "a" });

  const r = spawnSync(process.execPath, [executable, "--version-json"], { encoding: "utf8" });

  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /imutável/);
  assert.equal(r.stdout, "");
});

test("cli --help lists report and login", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /report/);
  assert.match(r.stdout, /login/);
  assert.match(r.stdout, /explore/);
  assert.match(r.stdout, /cover/);
  assert.match(r.stdout, /diff/);
  assert.match(r.stdout, /vdiff/);
  assert.match(r.stdout, /notify/);
});

test("cli unknown command exits 1", () => {
  const r = run(["wat"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /desconhecido/);
});

test("cli ci rejects flags outside its fixed public interface before creating output", () => {
  const output = join(mkdtempSync(join(tmpdir(), "witnessqa-cli-args-")), "output");

  const r = run(["ci", "--job", "/missing.json", "--out", output, "--unexpected"]);

  assert.equal(r.status, 2);
  assert.match(r.stderr, /uso: witnessqa ci --job <json> --out <novo-dir>/);
  assert.equal(existsSync(output), false);
});

test("CLI positional parsing excludes values owned by flags", () => {
  assert.deepEqual(
    positionalArgs(["witness/home.yaml", "--base-url", "https://app.test", "--auth", "state.json", "--headed"]),
    ["witness/home.yaml"],
  );
});
