/**
 * CLI do explorer: node src/explore.mjs <url> [--max-nodes N] [--out pasta]
 * Descobre o grafo do app e gera cenários de regressão por branch.
 */
import { exploreGraph } from "./explorer.mjs";

const url = process.argv[2];
if (!url) {
  console.error("uso: node src/explore.mjs <url-inicial> [--max-nodes 40] [--out runs/explore]");
  process.exit(1);
}
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? Number(process.argv[i + 1]) || process.argv[i + 1] : fallback;
}
const out = arg("--out", "runs/explore");

console.log(`Explorando grafo a partir de ${url}...`);
const g = await exploreGraph({ startUrl: url, outDir: out, options: { maxNodes: Number(arg("--max-nodes", 40)) } });
console.log(`\nnós: ${Object.keys(g.nodes).length}`);
console.log(`arestas: ${g.edges.length}`);
console.log(`subagentes: ${g.agentsSpawned}`);
console.log(`branches → cenários: ${g.branchCount} (${g.scenarios.join(", ")})`);
if (g.blockedNodes.length) console.log(`bloqueados: ${g.blockedNodes.map((b) => b.url).join(", ")}`);
