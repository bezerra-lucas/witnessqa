/**
 * WitnessQA worker — roda uma lista de cenários contra um app e gera o relatório.
 * `node src/worker.mjs scenarios/ --base-url https://app.com --out runs/<ts>`
 */
import { readdirSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "yaml";
import { parseScenario } from "./scenario.mjs";
import { runScenario } from "./executor.mjs";
import { investigateFailure, byokConfigured } from "./byok.mjs";
import { packRun } from "./packer.mjs";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function collectFiles(targets) {
  const files = [];
  for (const t of targets) {
    if (!t || t.startsWith("--")) continue;
    if (!existsSync(t)) continue;
    if (statSync(t).isDirectory()) {
      files.push(
        ...readdirSync(t)
          .filter((f) => /\.(ya?ml|json)$/.test(f))
          .map((f) => join(t, f)),
      );
    } else if (/\.(ya?ml|json)$/.test(t)) {
      files.push(t);
    }
  }
  return files;
}

const rawTargets = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    i += 1;
    continue;
  }
  rawTargets.push(a);
}

const baseUrl = arg("--base-url", "");
const outDir = arg("--out", join("runs", String(Date.now())));
const authFile = arg("--auth", "");
const headed = process.argv.includes("--headed");
const force = process.argv.includes("--force");
const jobs = Math.max(1, Number(arg("--jobs", "1")) || 1);
mkdirSync(outDir, { recursive: true });

const files = collectFiles(rawTargets.length ? rawTargets : ["."]);
if (!files.length) {
  console.error("nenhum cenário .yaml/.json encontrado");
  process.exit(2);
}

console.log(`WitnessQA — ${files.length} cenário(s) contra ${baseUrl || "(urls dos cenários)"}\n`);

const results = [];

async function runOne(file) {
  const scenario = parseScenario(readFileSync(file, "utf8"), yaml);
  const evidenceDir = join(outDir, basename(file).replace(/\.(ya?ml|json)$/, ""));
  const prev = join(evidenceDir, "result.json");
  if (!force && existsSync(prev)) {
    const result = JSON.parse(readFileSync(prev, "utf8"));
    console.log(`▶ ${scenario.name}\n  · resume ${result.verdict?.toUpperCase?.() ?? "?"}`);
    results.push(result);
    return;
  }
  console.log(`▶ ${scenario.name}`);
  const result = await runScenario(scenario, { evidenceDir, baseUrl, authFile: authFile || undefined, headed });
  const icon = result.verdict === "pass" ? "✓" : result.verdict === "blocked" ? "■" : "✗";
  console.log(`  ${icon} ${result.verdict.toUpperCase()} (${result.steps.length} steps)`);
  if (result.failure) console.log(`    └ ${JSON.stringify(result.failure).slice(0, 200)}`);

  if (result.verdict !== "pass") {
    const analysis = await investigateFailure(result, evidenceDir);
    if (analysis) {
      result.analysis = analysis;
      writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2));
      console.log(`    └ causa: ${analysis.cause} (bug=${analysis.isBug}, confiança=${analysis.confidence})`);
    }
  }
  results.push(result);
  if (results.length % 10 === 0) {
    try { packRun(outDir); } catch { /* pack parcial */ }
  }
}

const queue = [...files];
const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const file = queue.shift();
    if (file) await runOne(file);
  }
});
await Promise.all(workers);

const failed = results.filter((r) => r.verdict === "fail");
const blocked = results.filter((r) => r.verdict === "blocked");
let report = `# WitnessQA Run — ${new Date().toISOString()}\n\n`;
report += `**Veredito geral:** ${failed.length === 0 && blocked.length === 0 ? "PASS" : `${failed.length} fail / ${blocked.length} blocked / ${results.length} total`}\n\n`;
for (const r of results) {
  report += `## ${r.verdict.toUpperCase()} ${r.name}\n`;
  for (const s of r.steps) {
    report += `- ${s.ok ? "ok" : "FALHOU"} step ${s.index}: \`${JSON.stringify(s.step)}\`${s.detail ? ` — ${s.detail}` : ""} (evidência: ${s.screenshot})\n`;
  }
  if (r.consoleErrors.length) report += `\n**Console errors:**\n${r.consoleErrors.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.networkErrors?.length) report += `\n**Rede:**\n${r.networkErrors.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.brokenImages.length) report += `\n**Imagens quebradas:**\n${r.brokenImages.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.analysis) {
    report += `\n**Investigação de causa (BYOK):**\n- Causa: ${r.analysis.cause}\n- Bug do app: ${r.analysis.isBug ?? "?"} (confiança ${r.analysis.confidence})\n- Sugestão: ${r.analysis.suggestion}\n`;
  }
  report += "\n";
}
if (byokConfigured()) report += `---\n*Análise de causa por LLM via BYOK (${process.env.WITNESS_MODEL ?? "openai/gpt-4o-mini"}).*\n`;
writeFileSync(join(outDir, "REPORT.md"), report);

try {
  const packed = packRun(outDir);
  console.log(`\nlaudo: ${packed.path}  (${packed.stamp})`);
} catch (e) {
  console.log(`\nrelatório md: ${join(outDir, "REPORT.md")}  (html falhou: ${e.message})`);
}

process.exitCode = failed.length ? 1 : blocked.length ? 2 : 0;
