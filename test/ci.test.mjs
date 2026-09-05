import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanHarness as copyCleanHarness } from "./helpers/clean-harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function cleanHarness(parent, { workerSource } = {}) {
  return copyCleanHarness(root, { parent, workerSource });
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function writeJson(path, value) {
  const data = `${JSON.stringify(value)}\n`;
  writeFileSync(path, data, { mode: 0o600 });
  return sha256(data);
}

function withUmask(mask, operation) {
  const previous = process.umask(mask);
  try {
    return operation();
  } finally {
    process.umask(previous);
  }
}

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

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

function makeRequest(directory, port) {
  const subject = join(directory, "subject");
  const inputs = join(directory, "inputs");
  const scenarios = join(directory, "scenarios");
  mkdirSync(subject);
  mkdirSync(inputs);
  mkdirSync(scenarios);
  spawnSync("git", ["-C", subject, "init", "-b", "development"], { encoding: "utf8" });
  spawnSync("git", ["-C", subject, "config", "user.email", "fixture@example.invalid"]);
  spawnSync("git", ["-C", subject, "config", "user.name", "Fixture"]);
  writeFileSync(join(subject, "README.md"), "fixture\n");
  spawnSync("git", ["-C", subject, "add", "README.md"]);
  spawnSync("git", ["-C", subject, "commit", "-m", "fixture"]);
  const headSha = spawnSync("git", ["-C", subject, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["-C", subject, "remote", "add", "origin", "git@github.com:domod-tech/domod-cliente.git"]);

  writeFileSync(join(scenarios, "account.yaml"), [
    "name: account-journey",
    `app: http://127.0.0.1:${port}`,
    "steps:",
    "  - goto: /",
    "  - expectText: Witness Shop",
    "  - click: \"#add\"",
    "  - expectVisible: \".cart-badge\"",
    "checks:",
    "  - noBrokenImages",
    "",
  ].join("\n"));

  const dodPath = join(inputs, "dod.json");
  const dodSha = writeJson(dodPath, {
    schema: "domod-dod/v1",
    criteria: [{ id: "account-home", required_evidence: ["json", "screenshot", "html", "url", "report"] }],
  });
  const planPath = join(inputs, "plan.json");
  const planSha = writeJson(planPath, {
    schema: "witness-agent-plan/v1",
    agent_id: "agent:fixture",
    subject_head_sha: headSha,
    dod_sha256: dodSha,
    criteria: [{
      id: "account-home",
      kind: "journey",
      scenario: "account",
      steps: ["open account", "add product"],
      assertions: ["cart badge changes"],
      reject_if: ["cart badge is absent"],
    }],
  });
  const requestPath = join(directory, "request.json");
  const jobSha = "d".repeat(64);
  writeJson(requestPath, {
    schema: "domod-witness-request/v1",
    job_id: "a".repeat(32),
    job_sha256: jobSha,
    subject: {
      repository: "domod-tech/domod-cliente",
      remote: "git@github.com:domod-tech/domod-cliente.git",
      pull_request: 98,
      checkout: subject,
      base_sha: headSha,
      head_sha: headSha,
    },
    inputs: {
      dod: { path: dodPath, sha256: dodSha },
      plan: { path: planPath, sha256: planSha },
    },
    environment_names: ["WITNESS_CI_SCENARIO_DIR"],
  });
  return { requestPath, scenarios, jobSha, headSha, dodSha, planSha };
}

test("ci executes a real planned journey and emits a sanitized result bound to its inputs", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });
  try {
    const port = await waitForServerPort(server);
    const directory = mkdtempSync(join(tmpdir(), "witness-ci-"));
    const harness = cleanHarness(directory);
    const output = join(directory, "output");
    const fixture = makeRequest(directory, port);

    const completed = withUmask(0o002, () =>
      spawnSync(
        join(harness, "witnessqa"),
        ["ci", "--job", fixture.requestPath, "--out", output],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
            WITNESS_CI_SCENARIO_DIR: fixture.scenarios,
          },
          timeout: 60_000,
        },
      ),
    );

    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    assert.equal(result.schema, "witnessqa-ci-result/v1");
    assert.equal(result.status, "complete");
    assert.equal(result.privacy_version, 1);
    assert.deepEqual(result.execution, { kind: "agent-journey", cover_only: false, flow_count: 1 });
    assert.equal(result.job_id, "a".repeat(32));
    assert.equal(result.job_sha256, fixture.jobSha);
    assert.equal(result.harness.package_lock_sha256, sha256(readFileSync(join(harness, "package-lock.json"))));
    assert.deepEqual(result.subject, { head_sha: fixture.headSha });
    assert.deepEqual(result.inputs, { dod_sha256: fixture.dodSha, plan_sha256: fixture.planSha });
    assert.equal(result.criteria[0].id, "account-home");
    assert.equal(result.criteria[0].status, "observed");
    assert.deepEqual(
      result.criteria[0].evidence.map((item) => item.kind),
      ["json", "screenshot", "html", "url", "report"],
    );
    for (const evidence of result.criteria[0].evidence) {
      const evidencePath = join(output, evidence.path);
      const bytes = readFileSync(evidencePath);
      assert.equal(evidence.sha256, sha256(bytes));
      assert.equal(evidence.privacy_version, 1);
      assert.equal(statSync(evidencePath).mode & 0o022, 0, `${evidence.path} is group/world writable`);
    }
    const observation = readFileSync(join(output, result.observation.path));
    assert.equal(result.observation.sha256, sha256(observation));

    const originalResult = readFileSync(join(output, "result.json"));
    const reused = spawnSync(
      join(harness, "witnessqa"),
      ["ci", "--job", fixture.requestPath, "--out", output],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
          WITNESS_CI_SCENARIO_DIR: fixture.scenarios,
        },
      },
    );
    assert.equal(reused.status, 2);
    assert.match(reused.stderr, /output-not-fresh/);
    assert.deepEqual(readFileSync(join(output, "result.json")), originalResult);
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 90_000 });

test("ci preserves a real failing journey as evidence but never exits green", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });
  try {
    const port = await waitForServerPort(server);
    const directory = mkdtempSync(join(tmpdir(), "witness-ci-fail-"));
    const harness = cleanHarness(directory);
    const output = join(directory, "output");
    const fixture = makeRequest(directory, port);
    const scenarioPath = join(fixture.scenarios, "account.yaml");
    writeFileSync(
      scenarioPath,
      readFileSync(scenarioPath, "utf8").replace("Witness Shop", "text that is intentionally absent"),
    );

    const completed = spawnSync(
      process.execPath,
      [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
      {
        encoding: "utf8",
        env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
        timeout: 60_000,
      },
    );

    assert.equal(completed.status, 1, completed.stderr || completed.stdout);
    const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    assert.equal(result.status, "failed");
    assert.equal(result.execution.flow_count, 1);
    assert.equal(result.criteria[0].status, "observed");
    assert.ok(result.criteria[0].evidence.length > 0);
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 90_000 });

test("ci exposes only privacy-versioned evidence and never persists declared credentials", async () => {
  const server = spawn(process.execPath, [join(root, "test/fixtures/serve.mjs")], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });
  try {
    const port = await waitForServerPort(server);
    const directory = mkdtempSync(join(tmpdir(), "witness-ci-private-"));
    const harness = cleanHarness(directory);
    const output = join(directory, "output");
    const fixture = makeRequest(directory, port);
    const secret = "private.fixture@example.test";
    writeFileSync(join(fixture.scenarios, "account.yaml"), [
      "name: account-journey",
      `app: http://127.0.0.1:${port}`,
      "redaction:",
      "  selectors:",
      "    - .custom-private",
      "steps:",
      "  - goto: /?privacy=1",
      "  - fill: { selector: \"#private-email\", value: $WITNESS_CI_TEST_SECRET }",
      "  - expectVisible: \"#private-email\"",
      "checks:",
      "  - noBrokenImages",
      "",
    ].join("\n"));
    const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
    request.environment_names.push("WITNESS_CI_TEST_SECRET");
    writeJson(fixture.requestPath, request);

    const completed = spawnSync(
      process.execPath,
      [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WITNESS_CI_SCENARIO_DIR: fixture.scenarios,
          WITNESS_CI_TEST_SECRET: secret,
        },
        timeout: 60_000,
      },
    );

    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    for (const artifact of filesBelow(output)) {
      assert.equal(readFileSync(artifact).includes(Buffer.from(secret)), false, artifact);
    }
    const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    assert.ok(result.criteria[0].evidence.every((item) => item.privacy_version === 1));
  } finally {
    server.kill("SIGTERM");
  }
}, { timeout: 90_000 });

test("ci blocks an unknown evidence kind without losing the trusted identities", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-unknown-"));
  const harness = cleanHarness(directory);
  const fixture = makeRequest(directory, 1);
  const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
  const dod = JSON.parse(readFileSync(request.inputs.dod.path, "utf8"));
  dod.criteria[0].required_evidence = ["video"];
  const dodSha = writeJson(request.inputs.dod.path, dod);
  const plan = JSON.parse(readFileSync(request.inputs.plan.path, "utf8"));
  plan.dod_sha256 = dodSha;
  const planSha = writeJson(request.inputs.plan.path, plan);
  request.inputs.dod.sha256 = dodSha;
  request.inputs.plan.sha256 = planSha;
  writeJson(fixture.requestPath, request);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.schema, "witnessqa-ci-result/v1");
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "unknown-evidence");
  assert.equal(result.job_id, "a".repeat(32));
  assert.equal(result.job_sha256, fixture.jobSha);
  assert.deepEqual(result.subject, { head_sha: fixture.headSha });
  assert.deepEqual(result.inputs, { dod_sha256: dodSha, plan_sha256: planSha });
  assert.match(result.harness.head_sha, /^[a-f0-9]{40}$/);
  assert.equal(result.harness.version, "0.3.1");
  assert.equal(result.harness.package_lock_sha256, sha256(readFileSync(join(harness, "package-lock.json"))));
  assert.deepEqual(result.execution, { kind: "agent-journey", cover_only: false, flow_count: 0 });
});

test("ci blocks when the journey worker exits without any observation", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-empty-"));
  const harness = cleanHarness(directory, { workerSource: "process.exitCode = 0;\n" });
  const fixture = makeRequest(directory, 1);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "incomplete-observation");
  assert.equal(result.job_id, "a".repeat(32));
});

test("ci blocks an unknown worker verdict even when the worker exits zero", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-verdict-"));
  const harness = cleanHarness(directory, {
    workerSource: [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { basename, extname, join } from "node:path";',
      'const out = process.argv[process.argv.indexOf("--out") + 1];',
      'const scenario = process.argv[2];',
      'const flow = join(out, basename(scenario, extname(scenario)));',
      'mkdirSync(flow, { recursive: true });',
      'writeFileSync(join(flow, "result.json"), JSON.stringify({',
      '  name: "account-journey", privacyVersion: 1, verdict: "unknown",',
      '  steps: [{ ok: true }, { ok: true }], screenshots: [],',
      '}));',
      "",
    ].join("\n"),
  });
  const fixture = makeRequest(directory, 1);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "unknown-observation");
});

test("ci rejects evidence attributed to a different scenario identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-forged-flow-"));
  const harness = cleanHarness(directory, {
    workerSource: [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { basename, extname, join } from "node:path";',
      'const out = process.argv[process.argv.indexOf("--out") + 1];',
      'const scenario = process.argv[2];',
      'const flow = join(out, basename(scenario, extname(scenario)));',
      'mkdirSync(flow, { recursive: true });',
      'writeFileSync(join(flow, "result.json"), JSON.stringify({',
      '  name: "another-journey", privacyVersion: 1, verdict: "pass",',
      '  steps: [{ ok: true }, { ok: true }], screenshots: [],',
      '}));',
      "",
    ].join("\n"),
  });
  const fixture = makeRequest(directory, 1);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.error.code, "scenario-identity-mismatch");
});

test("ci blocks when a selected scenario drifts during the real worker process", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-drift-"));
  const harness = cleanHarness(directory, {
    workerSource: [
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { basename, extname, join } from "node:path";',
      'const out = process.argv[process.argv.indexOf("--out") + 1];',
      'const scenario = process.argv[2];',
      'appendFileSync(scenario, "# drift\\n");',
      'const flow = join(out, basename(scenario, extname(scenario)));',
      'mkdirSync(flow, { recursive: true });',
      'writeFileSync(join(flow, "result.json"), JSON.stringify({',
      '  name: "account-journey", privacyVersion: 1, verdict: "pass",',
      '  steps: [{ ok: true }, { ok: true }], screenshots: [],',
      '}));',
      "",
    ].join("\n"),
  });
  const fixture = makeRequest(directory, 1);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "scenario-changed");
});

test("ci blocks when an imported harness source drifts during execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-harness-drift-"));
  const harness = cleanHarness(directory, {
    workerSource: [
      'import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { basename, dirname, extname, join } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'const out = process.argv[process.argv.indexOf("--out") + 1];',
      'const scenario = process.argv[2];',
      'appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "ci.mjs"), "// drift\\n");',
      'const flow = join(out, basename(scenario, extname(scenario)));',
      'mkdirSync(flow, { recursive: true });',
      'writeFileSync(join(flow, "result.json"), JSON.stringify({',
      '  name: "account-journey", privacyVersion: 1, verdict: "pass",',
      '  steps: [{ ok: true }, { ok: true }], screenshots: [],',
      '}));',
      "",
    ].join("\n"),
  });
  const fixture = makeRequest(directory, 1);
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "harness-changed");
});

test("ci never creates or accepts its output inside the candidate checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-output-scope-"));
  const harness = cleanHarness(directory);
  const fixture = makeRequest(directory, 1);
  const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
  const output = join(request.subject.checkout, "witness-output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  assert.equal(existsSync(output), false);
  assert.match(completed.stderr, /unsafe-output/);
});

test("ci rejects a symlinked output parent before creating anything in the candidate checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-output-link-"));
  const harness = cleanHarness(directory);
  const fixture = makeRequest(directory, 1);
  const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
  const alias = join(directory, "output-parent");
  symlinkSync(request.subject.checkout, alias, "dir");
  const output = join(alias, "witness-output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  assert.equal(existsSync(join(request.subject.checkout, "witness-output")), false);
  assert.match(completed.stderr, /invalid-output|unsafe-output/);
});

test("ci rejects a generic body-only smoke before starting the browser", () => {
  const directory = mkdtempSync(join(tmpdir(), "witness-ci-smoke-"));
  const harness = cleanHarness(directory);
  const fixture = makeRequest(directory, 1);
  writeFileSync(join(fixture.scenarios, "account.yaml"), [
    "name: account-journey",
    "app: https://example.invalid",
    "steps:",
    "  - goto: /",
    "  - expectVisible: body",
    "",
  ].join("\n"));
  const output = join(directory, "output");

  const completed = spawnSync(
    process.execPath,
    [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
    {
      encoding: "utf8",
      env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
    },
  );

  assert.equal(completed.status, 2, completed.stderr || completed.stdout);
  const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
  assert.equal(result.error.code, "smoke-scenario");
  assert.equal(existsSync(join(output, "evidence")), false);
});

test("ci blocks absent scenarios and empty or incomplete journeys", async (t) => {
  const cases = [
    {
      name: "absent scenario",
      reason: "unknown-scenario",
      mutate: (_fixture, plan) => { plan.criteria[0].scenario = "not-installed"; },
    },
    {
      name: "empty plan",
      reason: "incomplete-plan",
      mutate: (_fixture, plan) => { plan.criteria = []; },
    },
    {
      name: "incomplete scenario",
      reason: "invalid-scenario",
      mutate: (fixture) => {
        writeFileSync(join(fixture.scenarios, "account.yaml"), [
          "name: account-journey",
          "app: https://example.invalid",
          "steps:",
          "  - goto: /",
          "",
        ].join("\n"));
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const directory = mkdtempSync(join(tmpdir(), "witness-ci-invalid-"));
      const harness = cleanHarness(directory);
      const fixture = makeRequest(directory, 1);
      const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
      const plan = JSON.parse(readFileSync(request.inputs.plan.path, "utf8"));
      entry.mutate(fixture, plan);
      const planSha = writeJson(request.inputs.plan.path, plan);
      request.inputs.plan.sha256 = planSha;
      writeJson(fixture.requestPath, request);
      const output = join(directory, "output");

      const completed = spawnSync(
        process.execPath,
        [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
        {
          encoding: "utf8",
          env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
        },
      );

      assert.equal(completed.status, 2, completed.stderr || completed.stdout);
      const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
      assert.equal(result.error.code, entry.reason);
      assert.equal(existsSync(join(output, "evidence")), false);
    });
  }
});

test("ci rejects ambiguous steps, empty plan entries, and degenerate URL assertions", async (t) => {
  const cases = [
    {
      name: "two executable actions in one step",
      reason: "invalid-scenario",
      mutate: (fixture) => writeFileSync(join(fixture.scenarios, "account.yaml"), [
        "name: account-journey",
        "app: https://example.invalid",
        "steps:",
        "  - { goto: /, expectText: Example }",
        "  - expectVisible: '#account'",
        "",
      ].join("\n")),
    },
    {
      name: "empty plan assertion",
      reason: "invalid-journey",
      mutate: (_fixture, plan) => { plan.criteria[0].assertions = [" "]; },
    },
    {
      name: "empty plan rejection",
      reason: "invalid-journey",
      mutate: (_fixture, plan) => { plan.criteria[0].reject_if = [""]; },
    },
    {
      name: "empty plan step description",
      reason: "invalid-journey",
      mutate: (_fixture, plan) => { plan.criteria[0].steps = ["open", " "]; },
    },
    {
      name: "root URL is not a specific assertion",
      reason: "smoke-scenario",
      mutate: (fixture) => writeFileSync(join(fixture.scenarios, "account.yaml"), [
        "name: account-journey",
        "app: https://example.invalid",
        "steps:",
        "  - goto: /",
        "  - expectUrl: /",
        "",
      ].join("\n")),
    },
    {
      name: "the URL just navigated to is not a specific assertion",
      reason: "smoke-scenario",
      mutate: (fixture) => writeFileSync(join(fixture.scenarios, "account.yaml"), [
        "name: account-journey",
        "app: https://example.invalid",
        "steps:",
        "  - goto: /account",
        "  - expectUrl: /account",
        "",
      ].join("\n")),
    },
    {
      name: "a substring already present in every HTTP URL is not a specific assertion",
      reason: "smoke-scenario",
      mutate: (fixture) => writeFileSync(join(fixture.scenarios, "account.yaml"), [
        "name: account-journey",
        "app: https://example.invalid",
        "steps:",
        "  - goto: /account",
        "  - expectUrl: http",
        "",
      ].join("\n")),
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const directory = mkdtempSync(join(tmpdir(), "witness-ci-shape-"));
      const harness = cleanHarness(directory);
      const fixture = makeRequest(directory, 1);
      const request = JSON.parse(readFileSync(fixture.requestPath, "utf8"));
      const plan = JSON.parse(readFileSync(request.inputs.plan.path, "utf8"));
      entry.mutate(fixture, plan);
      const planSha = writeJson(request.inputs.plan.path, plan);
      request.inputs.plan.sha256 = planSha;
      writeJson(fixture.requestPath, request);
      const output = join(directory, "output");

      const completed = spawnSync(
        process.execPath,
        [join(harness, "cli.mjs"), "ci", "--job", fixture.requestPath, "--out", output],
        {
          encoding: "utf8",
          env: { ...process.env, WITNESS_CI_SCENARIO_DIR: fixture.scenarios },
        },
      );

      assert.equal(completed.status, 2, completed.stderr || completed.stdout);
      const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
      assert.equal(result.error.code, entry.reason);
      assert.equal(existsSync(join(output, "evidence")), false);
    });
  }
});
