/** Prepare the Action upload without allowing an exporter crash to preserve PASS. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportArtifact } from "./export-artifact.mjs";

const PUBLIC_VERDICTS = new Set(["pass", "fail", "blocked"]);

export function prepareActionArtifact({ runDir, outDir, verdict, exporter = exportArtifact }) {
  const requestedVerdict = PUBLIC_VERDICTS.has(verdict) ? verdict : "fail";
  try {
    exporter(runDir, outDir, { fallbackVerdict: requestedVerdict });
    return requestedVerdict;
  } catch {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "EXPORT-FAILED.txt"),
      "WitnessQA could not prepare the sanitized evidence bundle.\nVerdict: fail\n",
    );
    return "fail";
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const verdict = prepareActionArtifact({
    runDir: process.argv[2],
    outDir: process.argv[3],
    verdict: process.argv[4],
  });
  console.log(verdict);
}
