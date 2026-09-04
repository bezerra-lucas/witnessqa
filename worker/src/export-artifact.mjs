/** Build a fresh, allowlisted upload bundle from privacy-versioned evidence. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packRun } from "./packer.mjs";
import { createEvidenceGuard, PRIVACY_VERSION } from "./privacy.mjs";
import { safeEvidencePath } from "./safe-evidence-path.mjs";

export function exportArtifact(runDir, outDir) {
  if (!runDir || !existsSync(runDir)) throw new Error("run de evidência não encontrada");
  if (!outDir) throw new Error("diretório de exportação obrigatório");
  if (existsSync(outDir)) throw new Error("diretório de exportação já existe; use um destino novo");
  mkdirSync(outDir, { recursive: true });
  const guard = createEvidenceGuard();
  let flows = 0;
  let screenshots = 0;

  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceDir = join(runDir, entry.name);
    const resultPath = safeEvidencePath(sourceDir, "result.json", { extension: ".json" });
    if (!resultPath) continue;

    let result;
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      continue;
    }
    if (result.privacyVersion !== PRIVACY_VERSION) continue;

    const targetDir = join(outDir, entry.name);
    mkdirSync(targetDir, { recursive: true });
    const safeResult = guard.redact(result);
    const copiedScreenshots = [];

    for (const name of safeResult.screenshots ?? []) {
      const source = safeEvidencePath(sourceDir, name, { extension: ".png" });
      if (!source) continue;
      copyFileSync(source, join(targetDir, name));
      copiedScreenshots.push(name);
      screenshots += 1;
    }
    safeResult.screenshots = copiedScreenshots;
    guard.writeJson(join(targetDir, "result.json"), safeResult);
    flows += 1;

    const htmlPath = safeEvidencePath(sourceDir, "page.html", { extension: ".html" });
    if (htmlPath) {
      writeFileSync(join(targetDir, "page.html"), guard.sanitizeHtml(readFileSync(htmlPath, "utf8")));
    }
    const urlPath = safeEvidencePath(sourceDir, "url.txt", { extension: ".txt" });
    if (urlPath) guard.writeText(join(targetDir, "url.txt"), readFileSync(urlPath, "utf8"));
  }

  if (!flows) throw new Error("nenhuma evidência com privacyVersion compatível");
  const packed = packRun(outDir);
  return { path: outDir, flows, screenshots, report: packed.path };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const result = exportArtifact(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
