/** CLI explorer v2: node src/explore2.mjs <url> [--auth arquivo.json] [--max-nodes N] [--out pasta] [--portal-value X] */
import { existsSync } from "node:fs";
import { exploreV2 } from "./explorer-v2.mjs";

const url = process.argv[2];
if (!url) {
  console.error("uso: node src/explore2.mjs <url> [--auth .witness/auth/x.json] [--max-nodes 25] [--out runs/explore2] [--portal-value Nome]");
  process.exit(1);
}
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const authIdx = process.argv.indexOf("--auth");
console.log(`Explorer v2 → ${url}${authIdx > -1 ? ` (auth: ${process.argv[authIdx + 1]})` : ""}`);
const g = await exploreV2({
  startUrl: url,
  outDir: arg("--out", "runs/explore2"),
  options: {
    maxNodes: Number(arg("--max-nodes", 25)),
    authFile: authIdx > -1 && existsSync(process.argv[authIdx + 1]) ? process.argv[authIdx + 1] : null,
    portalValue: arg("--portal-value", "QA Explorer"),
  },
});
console.log(`\nnós: ${g.nodeCount} | arestas: ${g.edgeCount} | portal atravessado: ${g.portalUnlocked ? "sim" : "não"}`);
for (const [u, n] of Object.entries(g.nodes)) console.log(`  ${n.error ? "✗" : "✓"} ${u} ${n.title ? `"${n.title}"` : n.error ?? ""}`);
