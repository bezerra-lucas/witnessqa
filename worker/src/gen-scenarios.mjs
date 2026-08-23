/**
 * Gera cenários de regressão a partir de um grafo descoberto (graph-v2.json).
 *
 * Para cada nó alcançado, gera um cenário "smoke": goto na URL do nó +
 * assert básico + checks globais. Cenários usam storageState quando disponível
 * (o executor suporta via campo `auth` no YAML — resolvido pelo CLI em runtime).
 *
 * Uso: node src/gen-scenarios.mjs <graph-v2.json> [--auth .witness/auth/x.json] --out witness/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const graphFile = process.argv[2];
if (!graphFile || !existsSync(graphFile)) die("grafo não encontrado: passe o caminho do graph-v2.json");

const authIdx = process.argv.indexOf("--auth");
const auth = authIdx > -1 && existsSync(process.argv[authIdx + 1]) ? process.argv[authIdx + 1] : null;
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > -1 ? process.argv[outIdx + 1] : "witness";
mkdirSync(outDir, { recursive: true });

const graph = JSON.parse(readFileSync(graphFile, "utf8"));
const origin = new URL(Object.keys(graph.nodes)[0]).origin;

let count = 0;
for (const [url, node] of Object.entries(graph.nodes)) {
  if (node.error) continue; // nó que crashou vira cenário à parte depois
  const path = new URL(url).pathname.replace(/^\//, "").replace(/\/$/, "") || "home";
  const name = `regressao-${path.split("/").slice(0, 3).join("-").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "home"}`;
  if (count >= 12) break; // orçamento: 12 cenários por grafo

  const lines = [
    `name: ${name}-${++count}`,
    `app: ${origin}`,
    ...(auth ? [`auth: ${auth}`] : []),
    "steps:",
    `  - goto: ${url}`,
    "  - wait: 1500",
    '  - expectVisible: "body"',
    "checks:",
    "  - noBrokenImages",
    "",
  ];
  writeFileSync(join(outDir, `${name}-${String(count).padStart(2, "0")}.yaml`), lines.join("\n"));
}
console.log(`✓ ${count} cenários gerados em ${outDir}/${auth ? " (com auth)" : ""}`);

function die(m) {
  console.error(`✗ ${m}`);
  process.exit(1);
}
