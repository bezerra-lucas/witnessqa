import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLOW_VERDICTS = new Set(["pass", "fail", "blocked", "warn"]);

export function isKnownFlowVerdict(value) {
  return FLOW_VERDICTS.has(value);
}

export function normalizeFlowResult(result) {
  if (isKnownFlowVerdict(result?.verdict)) return result;
  return {
    ...result,
    verdict: "blocked",
    failure: result?.failure ?? {
      type: "invalidVerdict",
      message: "o executor devolveu um veredito inválido",
    },
  };
}

export function workerExitCode(results) {
  if (!results.length) return 2;
  if (results.some((result) => result.verdict === "fail" || result.verdict === "warn")) return 1;
  if (results.some((result) => result.verdict !== "pass")) return 2;
  return 0;
}

export function verdictFromExitCode(code) {
  const numeric = Number(code);
  if (numeric === 0) return "pass";
  if (numeric === 2) return "blocked";
  return "fail";
}

export function gateExitCode(verdict) {
  return verdict === "pass" ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const [command, value] = process.argv.slice(2);
  if (command === "from-exit") {
    console.log(verdictFromExitCode(value));
  } else if (command === "gate") {
    process.exitCode = gateExitCode(value);
  } else {
    console.error("uso: node verdict.mjs from-exit <code> | gate <verdict>");
    process.exitCode = 1;
  }
}
