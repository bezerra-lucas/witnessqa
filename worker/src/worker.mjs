/**
 * WitnessQA worker — roda uma lista de cenários contra um app e gera o relatório.
 * MVP local: `node src/worker.mjs scenarios/ --base-url https://app.com --out runs/<ts>`
 */
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "yaml";
import { parseScenario } from "./scenario.mjs";
import { runScenario } from "./executor.mjs";
import { investigateFailure, byokConfigured } from "./byok.mjs";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const dirArg = process.argv[2];
const isFile = /\.(ya?ml|json)$/.test(dirArg ?? "");
const baseUrl = arg("--base-url", "");
const outDir = arg("--out", join("runs", String(Date.now())));
mkdirSync(outDir, { recursive: true });

const files = isFile ? [dirArg] : readdirSync(dirArg).map((f) => join(dirArg, f)).filter((f) => /\.(ya?ml|json)$/.test(f));
console.log(`WitnessQA — ${files.length} cenário(s) contra ${baseUrl || "(urls dos cenários)"}\n`);

const results = [];
for (const file of files) {
  const scenario = parseScenario(readFileSync(file, "utf8"), yaml);
  const evidenceDir = join(outDir, basename(file).replace(/\.(ya?ml|json)$/, ""));
  console.log(`▶ ${scenario.name}`);
  const result = await runScenario(scenario, { evidenceDir, baseUrl });
  const icon = result.verdict === "pass" ? "✓" : "✗";
  console.log(`  ${icon} ${result.verdict.toUpperCase()} (${result.steps.length} steps)`);
  if (result.failure) console.log(`    └ ${JSON.stringify(result.failure).slice(0, 200)}`);

  // BYOK: investigação de causa quando falha
  if (result.verdict !== "pass") {
    const analysis = await investigateFailure(result, evidenceDir);
    if (analysis) {
      result.analysis = analysis;
      console.log(`    └ causa: ${analysis.cause} (bug=${analysis.isBug}, confiança=${analysis.confidence})`);
    }
  }
  results.push(result);
}

// relatório consolidado (mesmo espírito do criarRelatorio() do domod)
const failed = results.filter((r) => r.verdict !== "pass");
let report = `# WitnessQA Run — ${new Date().toISOString()}\n\n`;
report += `**Veredito geral:** ${failed.length === 0 ? "✅ PASS" : `🔴 ${failed.length}/${results.length} com problema`}\n\n`;
for (const r of results) {
  const icon = r.verdict === "pass" ? "✅" : r.verdict === "warn" ? "⚠️" : "❌";
  report += `## ${icon} ${r.name} — ${r.verdict}\n`;
  for (const s of r.steps) {
    report += `- ${s.ok ? "ok" : "FALHOU"} step ${s.index}: \`${JSON.stringify(s.step)}\`${s.detail ? ` — ${s.detail}` : ""} (evidência: ${s.screenshot})\n`;
  }
  if (r.consoleErrors.length) report += `\n**Console errors:**\n${r.consoleErrors.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.brokenImages.length) report += `\n**Imagens quebradas:**\n${r.brokenImages.map((e) => `- ${e}`).join("\n")}\n`;
  if (r.analysis) {
    report += `\n**Investigação de causa (BYOK):**\n- Causa: ${r.analysis.cause}\n- Bug do app: ${r.analysis.isBug ?? "?"} (confiança ${r.analysis.confidence})\n- Sugestão: ${r.analysis.suggestion}\n`;
  }
  report += "\n";
}
if (byokConfigured()) report += `---\n*Análise de causa por LLM via BYOK (${process.env.WITNESS_MODEL ?? "openai/gpt-4o-mini"}).*\n`;
writeFileSync(join(outDir, "REPORT.md"), report);
console.log(`\nrelatório: ${join(outDir, "REPORT.md")}`);
process.exitCode = failed.some((r) => r.verdict === "fail") ? 1 : 0;
