import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { positionalArgs } from "../cli.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("cli --version", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /0\.2\.\d+/);
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

test("CLI positional parsing excludes values owned by flags", () => {
  assert.deepEqual(
    positionalArgs(["witness/home.yaml", "--base-url", "https://app.test", "--auth", "state.json", "--headed"]),
    ["witness/home.yaml"],
  );
});
