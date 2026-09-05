import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { normalizeExpectText } from "./classify.mjs";
import { exportArtifact } from "./export-artifact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "../..");
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const JOB_ID = /^[a-f0-9]{32}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/;
const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const ALLOWED_ENVIRONMENT = /^(?:DOMOD_[A-Z0-9_]+|WITNESS_[A-Z0-9_]+|PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH|CHROME_PATH|CHROMIUM_PATH)$/;
const KNOWN_VERDICTS = new Set(["pass", "fail", "warn", "blocked"]);
const SUPPORTED_EVIDENCE = new Set(["json", "screenshot", "png", "html", "url", "text", "report"]);
const EXECUTABLE_ACTIONS = new Set(["goto", "fill", "click", "expectUrl", "expectVisible", "wait", "expectText", "expectNoText"]);
const MAX_JSON_BYTES = 1024 * 1024;

export class CiBlocked extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export async function executeCi(jobPathValue, outputValue, identity) {
  let output;
  let trustedRequest;
  let trustedSubject;
  let trustedInputs;
  let trustedHarness;
  try {
    const request = readBoundJson(jobPathValue, "invalid-job");
    validateRequest(request.document);
    trustedRequest = request.document;
    const environment = runtimeEnvironment(request.document.environment_names);
    const subject = observeSubject(request.document.subject);
    trustedSubject = subject;
    if (within(request.path, subject.checkout)) blocked("untrusted-job", "CI request cannot come from the subject checkout");
    output = freshOutput(outputValue, subject.checkout);
    const inputs = readInputs(request.document, subject.checkout);
    trustedInputs = inputs;
    const harnessBefore = identity.observe();
    if (!GIT_SHA.test(harnessBefore?.head_sha) || !SHA256.test(harnessBefore?.package_lock_sha256)) {
      blocked("invalid-harness", "WitnessQA identity is unavailable");
    }
    trustedHarness = { ...harnessBefore, version: identity.version };
    const { dod, plan } = validatePlan(inputs, subject.head_sha);
    const scenarioRoot = trustedScenarioRoot(environment, subject.checkout);
    const scenarios = selectScenarios(plan, scenarioRoot, environment, subject.checkout);
    const privateRun = mkdtempSync(join(tmpdir(), "witnessqa-ci-run-"));
    chmodSync(privateRun, 0o700);
    try {
      const workerExit = await runWorker(scenarios.map((item) => item.path), privateRun, environment);
      for (const scenario of scenarios) {
        verifyFileUnchanged(scenario.path, scenario.sha256, "scenario-changed");
      }
      const bundle = join(output, "evidence");
      try {
        exportArtifact(privateRun, bundle, workerExit === 2 ? { fallbackVerdict: "blocked" } : {});
      } catch {
        blocked("incomplete-observation", "Journey worker produced no exportable observation");
      }
      const observed = observeFlows(bundle, scenarios);

      verifyUnchanged(jobPathValue, request.sha256, "job-changed");
      for (const [name, input] of Object.entries(inputs)) {
        verifyUnchanged(input.path, input.sha256, `${name}-changed`);
      }
      verifySubject(subject);
      verifyHarness(identity, harnessBefore);

      const criteria = buildCriteria(dod, plan, observed, bundle);
      const observation = writeObservation(output, observed, criteria);
      const allPass = observed.every((flow) => flow.verdict === "pass");
      const status = allPass && workerExit === 0 ? "complete" : workerExit === 1 ? "failed" : "blocked";
      const result = buildResult({
        request: request.document,
        identity: trustedHarness,
        status,
        flowCount: observed.length,
        observation,
        criteria,
      });
      writeJsonExclusive(join(output, "result.json"), result);
      console.log(JSON.stringify({ schema: result.schema, status: result.status, flow_count: observed.length }));
      return status === "complete" ? 0 : status === "failed" ? 1 : 2;
    } finally {
      rmSync(privateRun, { recursive: true, force: true });
    }
  } catch (error) {
    const failure = error instanceof CiBlocked
      ? error
      : new CiBlocked("internal-error", "WitnessQA CI could not produce a complete observation");
    if (output && !existsSync(join(output, "result.json"))) {
      writeJsonExclusive(
        join(output, "result.json"),
        blockedResult(failure.code, trustedRequest, trustedSubject, trustedInputs, trustedHarness),
      );
    }
    console.error(`WitnessQA CI blocked: ${failure.code}`);
    return failure.exitCode;
  }
}

function blockedResult(code, request, subject, inputs, harness) {
  const result = {
    schema: "witnessqa-ci-result/v1",
    status: "blocked",
    privacy_version: 1,
    execution: { kind: "agent-journey", cover_only: false, flow_count: 0 },
    error: { code },
  };
  if (request) {
    result.job_id = request.job_id;
    result.job_sha256 = request.job_sha256;
  }
  if (subject) result.subject = { head_sha: subject.head_sha };
  if (inputs) {
    result.inputs = {
      dod_sha256: inputs.dod.sha256,
      plan_sha256: inputs.plan.sha256,
    };
  }
  if (harness) result.harness = harness;
  return result;
}

function blocked(code, message, exitCode = 2) {
  throw new CiBlocked(code, message, exitCode);
}

function freshOutput(value, subjectCheckout) {
  if (typeof value !== "string" || !isAbsolute(value)) blocked("invalid-output", "CI output must be absolute");
  const candidate = resolve(value);
  if (subjectCheckout && within(candidate, subjectCheckout)) {
    blocked("unsafe-output", "CI output cannot be inside the subject checkout");
  }
  const parent = safeDirectory(dirname(candidate), "invalid-output");
  if (subjectCheckout && within(parent, subjectCheckout)) {
    blocked("unsafe-output", "CI output parent cannot be inside the subject checkout");
  }
  const parentBefore = lstatSync(parent, { bigint: true });
  const created = join(parent, basename(candidate));
  if (existsSync(created)) blocked("output-not-fresh", "CI output must be a new directory");
  try {
    mkdirSync(created, { mode: 0o700 });
    const parentAfterPath = safeDirectory(parent, "invalid-output");
    const parentAfter = lstatSync(parentAfterPath, { bigint: true });
    if (parentAfterPath !== parent || parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) {
      blocked("output-parent-changed", "CI output parent changed during creation");
    }
    const output = safeDirectory(created, "invalid-output");
    if (subjectCheckout && within(output, subjectCheckout)) {
      blocked("unsafe-output", "Created CI output resolved inside the subject checkout");
    }
    chmodSync(output, 0o700);
    return output;
  } catch (error) {
    if (error instanceof CiBlocked) throw error;
    blocked("invalid-output", "CI output directory could not be created");
  }
}

function readBoundJson(pathValue, code) {
  const path = safeRegularFile(pathValue, code, MAX_JSON_BYTES);
  const before = statSync(path, { bigint: true });
  const bytes = readFileSync(path);
  const after = statSync(path, { bigint: true });
  if (["dev", "ino", "size", "mtimeNs"].some((key) => before[key] !== after[key])) {
    blocked(code, "JSON input changed while it was read");
  }
  if (bytes.length === 0) blocked(code, "JSON input is empty");
  let document;
  try {
    document = JSON.parse(bytes);
  } catch {
    blocked(code, "JSON input is invalid");
  }
  if (!document || Array.isArray(document) || typeof document !== "object") blocked(code, "JSON input must be an object");
  return { path, bytes, sha256: digest(bytes), document };
}

function safeRegularFile(pathValue, code, maximum = 64 * 1024 * 1024) {
  if (typeof pathValue !== "string" || !isAbsolute(pathValue)) blocked(code, "Input path must be absolute");
  try {
    const unresolved = resolve(pathValue);
    const resolved = realpathSync(pathValue);
    const info = lstatSync(pathValue);
    if (unresolved !== resolved || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      blocked(code, "Input must be a confined regular file");
    }
    const currentUid = typeof process.getuid === "function" ? process.getuid() : info.uid;
    if ((info.uid !== 0 && info.uid !== currentUid) || (info.mode & 0o022) !== 0 || info.size > maximum) {
      blocked(code, "Input file is unsafe or oversized");
    }
    return resolved;
  } catch (error) {
    if (error instanceof CiBlocked) throw error;
    blocked(code, "Input file is absent");
  }
}

function safeDirectory(pathValue, code) {
  if (typeof pathValue !== "string" || !isAbsolute(pathValue)) blocked(code, "Directory must be absolute");
  try {
    const unresolved = resolve(pathValue);
    const resolved = realpathSync(pathValue);
    const info = lstatSync(pathValue);
    const currentUid = typeof process.getuid === "function" ? process.getuid() : info.uid;
    if (unresolved !== resolved || !info.isDirectory() || info.isSymbolicLink() ||
        (info.uid !== 0 && info.uid !== currentUid) || (info.mode & 0o022) !== 0) {
      blocked(code, "Directory is not trusted");
    }
    return resolved;
  } catch (error) {
    if (error instanceof CiBlocked) throw error;
    blocked(code, "Directory is absent");
  }
}

function validateRequest(request) {
  if (request.schema !== "domod-witness-request/v1") blocked("invalid-job", "Unsupported request schema");
  if (!JOB_ID.test(request.job_id ?? "") || !SHA256.test(request.job_sha256 ?? "")) {
    blocked("invalid-job", "Request identity is invalid");
  }
  if (!request.subject || typeof request.subject !== "object") blocked("invalid-subject", "Subject identity is absent");
  if (!request.inputs || Object.keys(request.inputs).sort().join(",") !== "dod,plan") {
    blocked("invalid-inputs", "DoD and plan are required");
  }
  if (!Array.isArray(request.environment_names) || request.environment_names.length > 64) {
    blocked("invalid-environment", "Environment name list is invalid");
  }
}

function runtimeEnvironment(names) {
  const environment = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    CI: "true",
    DOMOD_NATIVE_WITNESS: "1",
  };
  for (const name of names) {
    if (typeof name !== "string" || !ALLOWED_ENVIRONMENT.test(name) || !(name in process.env)) {
      blocked("invalid-environment", "Declared runtime environment is absent or unsupported");
    }
    environment[name] = process.env[name];
  }
  return environment;
}

function observeSubject(subject) {
  const checkout = safeDirectory(subject.checkout, "invalid-subject");
  const repository = subject.repository;
  const remote = subject.remote;
  const pullRequest = subject.pull_request;
  const baseSha = subject.base_sha;
  const headSha = subject.head_sha;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
      typeof remote !== "string" || !remote ||
      !Number.isInteger(pullRequest) || pullRequest < 1 ||
      !GIT_SHA.test(baseSha ?? "") || !GIT_SHA.test(headSha ?? "")) {
    blocked("invalid-subject", "Subject identity is invalid");
  }
  const observed = {
    repository,
    remote,
    pull_request: pullRequest,
    checkout,
    base_sha: baseSha,
    head_sha: headSha,
  };
  verifySubject(observed);
  return observed;
}

function verifySubject(subject) {
  if (git(subject.checkout, "rev-parse", "HEAD") !== subject.head_sha) {
    blocked("subject-head-drift", "Subject HEAD differs from the frozen request");
  }
  if (git(subject.checkout, "remote", "get-url", "origin") !== subject.remote) {
    blocked("subject-remote-drift", "Subject remote differs from the frozen request");
  }
  const ancestry = spawnSync("git", ["-C", subject.checkout, "merge-base", "--is-ancestor", subject.base_sha, subject.head_sha], {
    stdio: "ignore",
  });
  if (ancestry.status !== 0) blocked("subject-base-drift", "Subject base is not an ancestor of HEAD");
}

function git(checkout, ...gitArguments) {
  const completed = spawnSync("git", ["-C", checkout, ...gitArguments], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (completed.status !== 0) blocked("invalid-subject", "Subject Git identity cannot be observed");
  return completed.stdout.trim();
}

function readInputs(request, subjectCheckout) {
  const inputs = {};
  for (const name of ["dod", "plan"]) {
    const reference = request.inputs[name];
    if (!reference || !SHA256.test(reference.sha256 ?? "")) blocked("invalid-inputs", "Input digest is invalid");
    const input = readBoundJson(reference.path, "invalid-inputs");
    if (input.sha256 !== reference.sha256) blocked("input-digest-mismatch", "Frozen input digest differs");
    if (within(input.path, subjectCheckout)) blocked("untrusted-input", "Frozen input cannot come from the subject checkout");
    inputs[name] = input;
  }
  return inputs;
}

function validatePlan(inputs, subjectHead) {
  const dodDocument = inputs.dod.document;
  const planDocument = inputs.plan.document;
  if (dodDocument.schema !== "domod-dod/v1" || planDocument.schema !== "witness-agent-plan/v1") {
    blocked("invalid-plan", "DoD or plan schema is unsupported");
  }
  if (planDocument.subject_head_sha !== subjectHead || planDocument.dod_sha256 !== inputs.dod.sha256) {
    blocked("plan-identity-drift", "Plan is not bound to subject HEAD and DoD");
  }
  if (typeof planDocument.agent_id !== "string" || !planDocument.agent_id.trim()) blocked("missing-agent", "Plan has no agent identity");
  const dod = mapCriteria(dodDocument.criteria, "invalid-dod");
  const plan = mapCriteria(planDocument.criteria, "invalid-plan");
  if (dod.size === 0 || dod.size !== plan.size || [...dod.keys()].some((id) => !plan.has(id))) {
    blocked("incomplete-plan", "Plan must cover every DoD criterion exactly");
  }
  for (const criterion of dod.values()) {
    if (!Array.isArray(criterion.required_evidence) || criterion.required_evidence.length === 0 ||
        criterion.required_evidence.some((kind) => typeof kind !== "string" || !IDENTIFIER.test(kind) || !SUPPORTED_EVIDENCE.has(kind))) {
      blocked("unknown-evidence", "Every DoD criterion needs supported evidence kinds");
    }
  }
  for (const criterion of plan.values()) {
    if (criterion.kind !== "journey" || !SCENARIO_ID.test(criterion.scenario ?? "") ||
        !nonEmptyStringArray(criterion.steps, 2) ||
        !nonEmptyStringArray(criterion.assertions, 1) ||
        !nonEmptyStringArray(criterion.reject_if, 1)) {
      blocked("invalid-journey", "Each criterion needs a concrete agent journey");
    }
  }
  return { dod, plan };
}

function mapCriteria(criteria, code) {
  if (!Array.isArray(criteria)) blocked(code, "Criteria must be an array");
  const mapped = new Map();
  for (const criterion of criteria) {
    if (!criterion || typeof criterion !== "object" || !IDENTIFIER.test(criterion.id ?? "") || mapped.has(criterion.id)) {
      blocked(code, "Criterion ids must be unique and stable");
    }
    mapped.set(criterion.id, criterion);
  }
  return mapped;
}

function trustedScenarioRoot(environment, subjectCheckout) {
  const configured = environment.WITNESS_CI_SCENARIO_DIR ?? join(PACKAGE_ROOT, "witness");
  const root = safeDirectory(configured, "invalid-scenario-root");
  if (within(root, subjectCheckout)) blocked("untrusted-scenario", "CI scenarios cannot come from the subject checkout");
  return root;
}

function selectScenarios(plan, scenarioRoot, environment, subjectCheckout) {
  const available = readdirSync(scenarioRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".yaml", ".yml", ".json"].includes(extname(entry.name)))
    .map((entry) => {
      const path = safeRegularFile(join(scenarioRoot, entry.name), "unsafe-scenario");
      let document;
      try {
        document = extname(entry.name) === ".json"
          ? JSON.parse(readFileSync(path, "utf8"))
          : YAML.parse(readFileSync(path, "utf8"));
      } catch {
        blocked("invalid-scenario", "Scenario cannot be parsed");
      }
      validateScenario(document, environment, subjectCheckout);
      return {
        id: String(document.name),
        path,
        directory: basename(path, extname(path)),
        sha256: digest(readFileSync(path)),
      };
    });
  const selected = new Map();
  for (const criterion of plan.values()) {
    const matches = available.filter((item) => item.id === criterion.scenario || item.directory === criterion.scenario);
    if (matches.length !== 1) blocked("unknown-scenario", "Planned scenario is absent or ambiguous");
    selected.set(matches[0].path, matches[0]);
  }
  const result = [...selected.values()];
  if (new Set(result.map((item) => item.directory)).size !== result.length) {
    blocked("ambiguous-scenario", "Selected scenarios collide in the evidence directory");
  }
  return result;
}

function validateScenario(document, environment, subjectCheckout) {
  if (!document || typeof document !== "object" || typeof document.name !== "string" ||
      !SCENARIO_ID.test(document.name) || !Array.isArray(document.steps) || document.steps.length < 2) {
    blocked("invalid-scenario", "Scenario is not a real journey");
  }
  for (const step of document.steps) {
    const actions = step && typeof step === "object" && !Array.isArray(step)
      ? Object.keys(step).filter((key) => EXECUTABLE_ACTIONS.has(key))
      : [];
    if (actions.length !== 1 || !validAction(step, actions[0])) {
      blocked("invalid-scenario", "Every scenario step must contain exactly one valid executable action");
    }
  }
  const absoluteTargets = [document.app, ...document.steps.map((step) => step?.goto)]
    .filter((value) => typeof value === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(value));
  if (absoluteTargets.length === 0) blocked("invalid-scenario", "CI journey has no absolute application target");
  for (const target of absoluteTargets) {
    let url;
    try {
      url = new URL(target);
    } catch {
      blocked("invalid-scenario", "CI journey target is invalid");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
      blocked("invalid-scenario", "CI journey target must be an HTTP URL without credentials");
    }
  }
  const navigations = [document.app, ...document.steps.map((step) => step?.goto)]
    .filter((value) => typeof value === "string" && value.trim());
  const specificAssertions = document.steps.filter((step) => {
    if (!step || typeof step !== "object") return false;
    if (step.expectText !== undefined) return Boolean(normalizeExpectText(step.expectText)?.text?.trim());
    if (step.expectNoText !== undefined) return Boolean(normalizeExpectText(step.expectNoText)?.text?.trim());
    if (step.expectUrl !== undefined) return isSpecificUrlAssertion(step.expectUrl, document.app, navigations);
    if (step.expectVisible === undefined) return false;
    return !new Set(["body", "html", "*"]).has(String(step.expectVisible).trim().toLowerCase());
  });
  if (specificAssertions.length === 0) {
    blocked("smoke-scenario", "Body-only smoke scenarios cannot satisfy an agent journey");
  }
  if (document.auth !== undefined) {
    const auth = safeRegularFile(document.auth, "unsafe-auth", MAX_JSON_BYTES);
    if (within(auth, subjectCheckout) || (statSync(auth).mode & 0o077) !== 0) {
      blocked("unsafe-auth", "Storage state must be owner-only and outside the subject checkout");
    }
  }
  for (const step of document.steps) {
    if (!step?.fill) continue;
    const value = step.fill.value ?? step.fill[1];
    const match = typeof value === "string" ? value.match(/^\$([A-Z][A-Z0-9_]*)$/) : null;
    if (!match || !(match[1] in environment)) blocked("literal-credential", "CI fill values must use declared environment variables");
  }
}

function nonEmptyStringArray(value, minimum) {
  return Array.isArray(value) && value.length >= minimum &&
    value.every((entry) => typeof entry === "string" && entry.trim());
}

function validAction(step, action) {
  const value = step[action];
  if (["goto", "expectUrl", "expectVisible"].includes(action)) {
    return typeof value === "string" && Boolean(value.trim());
  }
  if (["expectText", "expectNoText"].includes(action)) {
    const normalized = normalizeExpectText(value);
    return typeof normalized?.text === "string" && Boolean(normalized.text.trim()) &&
      typeof normalized?.selector === "string" && Boolean(normalized.selector.trim());
  }
  if (action === "wait") return Number.isFinite(Number(value)) && Number(value) > 0;
  if (action === "click") {
    return (typeof value === "string" && Boolean(value.trim())) ||
      (value && typeof value === "object" && !Array.isArray(value) &&
       [value.text, value.selector].some((entry) => typeof entry === "string" && entry.trim()));
  }
  if (action === "fill") {
    const selector = value?.selector ?? value?.[0];
    const fillValue = value?.value ?? value?.[1];
    return typeof selector === "string" && Boolean(selector.trim()) && typeof fillValue === "string" && Boolean(fillValue);
  }
  return false;
}

function isSpecificUrlAssertion(value, app, navigations) {
  if (typeof value !== "string" || !value.trim() || value.trim() === "/") return false;
  const wanted = value.trim();
  const base = typeof app === "string" && /^https?:\/\//i.test(app) ? app : "https://witness.invalid";
  const visited = navigations.flatMap((target) => {
    try {
      return [new URL(target, base).href];
    } catch {
      return [];
    }
  });
  return !visited.some((url) => url.includes(wanted));
}

function runWorker(scenarioPaths, output, environment) {
  if (scenarioPaths.length === 0) blocked("empty-journey", "No journey was selected");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(HERE, "worker.mjs"), ...scenarioPaths, "--out", output, "--jobs", "1", "--force"],
      { env: environment, stdio: "ignore" },
    );
    child.once("error", () => reject(new CiBlocked("worker-unavailable", "Journey worker could not start")));
    child.once("exit", (code) => resolvePromise(code ?? 2));
  });
}

function observeFlows(bundle, scenarios) {
  const expectedDirectories = new Set(scenarios.map((scenario) => scenario.directory));
  const actualDirectories = readdirSync(bundle, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (actualDirectories.length !== expectedDirectories.size ||
      actualDirectories.some((name) => !expectedDirectories.has(name))) {
    blocked("unexpected-observation", "Journey worker emitted an unexpected flow identity");
  }
  const observed = [];
  for (const scenario of scenarios) {
    const resultPath = join(bundle, scenario.directory, "result.json");
    const result = readBoundJson(resultPath, "incomplete-observation").document;
    if (result.name !== scenario.id) {
      blocked("scenario-identity-mismatch", "Journey result claims a different scenario identity");
    }
    if (result.privacyVersion !== 1 || !KNOWN_VERDICTS.has(result.verdict)) {
      blocked("unknown-observation", "Journey result is absent, unknown, or unsanitized");
    }
    observed.push({
      scenario: scenario.id,
      scenario_sha256: scenario.sha256,
      directory: scenario.directory,
      verdict: result.verdict,
      steps: Array.isArray(result.steps) ? result.steps.length : 0,
      screenshots: Array.isArray(result.screenshots) ? result.screenshots.length : 0,
    });
  }
  if (observed.length === 0 || observed.some((flow) => flow.steps < 2 || flow.verdict === "blocked")) {
    blocked("incomplete-observation", "Agent journey was empty, blocked, or incomplete");
  }
  return observed;
}

function buildCriteria(dod, plan, observed, bundle) {
  const flows = new Map(observed.flatMap((flow) => [[flow.scenario, flow], [flow.directory, flow]]));
  return [...dod.entries()].map(([id, criterion]) => {
    const flow = flows.get(plan.get(id).scenario);
    if (!flow) blocked("incomplete-observation", "Criterion has no observed journey");
    const evidence = criterion.required_evidence.map((kind) => evidenceFor(kind, flow.directory, bundle));
    return { id, status: "observed", evidence };
  });
}

function evidenceFor(kind, flowDirectory, bundle) {
  const flowRoot = join(bundle, flowDirectory);
  let relativePath;
  if (kind === "json") relativePath = join(flowDirectory, "result.json");
  else if (kind === "html") relativePath = join(flowDirectory, "page.html");
  else if (kind === "url" || kind === "text") relativePath = join(flowDirectory, "url.txt");
  else if (kind === "report") relativePath = "REPORT.html";
  else if (kind === "png" || kind === "screenshot") {
    const result = readBoundJson(join(flowRoot, "result.json"), "incomplete-evidence").document;
    const screenshot = Array.isArray(result.screenshots) ? result.screenshots.at(-1) : null;
    if (typeof screenshot !== "string") blocked("incomplete-evidence", "Required screenshot evidence is absent");
    relativePath = join(flowDirectory, screenshot);
  } else {
    blocked("unknown-evidence", "Required evidence kind is unsupported");
  }
  const absolute = safeRegularFile(join(bundle, relativePath), "incomplete-evidence");
  if (!within(absolute, bundle)) blocked("unsafe-evidence", "Evidence escaped the sanitized bundle");
  return {
    path: join("evidence", relativePath),
    sha256: digest(readFileSync(absolute)),
    kind,
    privacy_version: 1,
  };
}

function writeObservation(output, flows, criteria) {
  const path = join(output, "observation.json");
  const document = {
    schema: "witnessqa-observation/v1",
    privacy_version: 1,
    execution: { kind: "agent-journey", cover_only: false, flow_count: flows.length },
    flows,
    criteria: criteria.map((criterion) => ({
      id: criterion.id,
      status: criterion.status,
      evidence: criterion.evidence.map(({ path: evidencePath, sha256, kind, privacy_version }) => ({
        path: evidencePath,
        sha256,
        kind,
        privacy_version,
      })),
    })),
  };
  writeJsonExclusive(path, document);
  return { path: "observation.json", sha256: digest(readFileSync(path)) };
}

function buildResult({ request, identity, status, flowCount, observation, criteria }) {
  return {
    schema: "witnessqa-ci-result/v1",
    job_id: request.job_id,
    job_sha256: request.job_sha256,
    status,
    privacy_version: 1,
    execution: { kind: "agent-journey", cover_only: false, flow_count: flowCount },
    harness: identity,
    subject: { head_sha: request.subject.head_sha },
    inputs: {
      dod_sha256: request.inputs.dod.sha256,
      plan_sha256: request.inputs.plan.sha256,
    },
    observation,
    criteria,
  };
}

function writeJsonExclusive(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function verifyUnchanged(path, expected, code) {
  const observed = readBoundJson(path, code);
  if (observed.sha256 !== expected) blocked(code, "Frozen input changed during execution");
}

function verifyFileUnchanged(path, expected, code) {
  const safe = safeRegularFile(path, code);
  if (digest(readFileSync(safe)) !== expected) blocked(code, "Frozen file changed during execution");
}

function verifyHarness(identity, expected) {
  let observed;
  try {
    observed = identity.observe();
  } catch {
    blocked("harness-changed", "WitnessQA source tree drifted during execution");
  }
  if (observed?.head_sha !== expected.head_sha ||
      observed?.package_lock_sha256 !== expected.package_lock_sha256) {
    blocked("harness-changed", "WitnessQA identity changed during execution");
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function within(pathValue, parentValue) {
  const relation = relative(resolve(parentValue), resolve(pathValue));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}
