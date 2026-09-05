/**
 * Diff de duas runs: o que mudou de veredito.
 * Uso: node src/diff.mjs <run-a> <run-b>
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { classifyFlow, displayTitle, displayPath } from "./classify.mjs";
import { createEvidenceGuard } from "./privacy.mjs";
import { safeEvidencePath } from "./safe-evidence-path.mjs";

function loadFlows(dir) {
  const map = new Map();
  const guard = createEvidenceGuard();
  if (!dir || !existsSync(dir)) return map;
  for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const rf = safeEvidencePath(join(dir, name), "result.json", { extension: ".json" });
    if (!rf) continue;
    let r;
    try {
      r = guard.redact(JSON.parse(readFileSync(rf, "utf8")));
    } catch {
      continue;
    }
    const status = classifyFlow(r);
    const key = displayPath(r) || name;
    map.set(key, { ...r, dir: name, status, title: displayTitle(r), path: key });
  }
  return map;
}

export function diffRuns(aDir, bDir) {
  const a = loadFlows(aDir);
  const b = loadFlows(bDir);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const changes = [];
  const added = [];
  const removed = [];
  for (const k of [...keys].sort()) {
    const left = a.get(k);
    const right = b.get(k);
    if (left && !right) removed.push(left);
    else if (!left && right) added.push(right);
    else if (left.status !== right.status) {
      changes.push({ key: k, from: left.status, to: right.status, title: right.title });
    }
  }
  return {
    a: aDir,
    b: bDir,
    before: a.size,
    after: b.size,
    changes,
    added,
    removed,
    regressions: changes.filter((c) => c.to === "fail" && c.from !== "fail"),
    recovered: changes.filter((c) => c.from === "fail" && c.to !== "fail"),
  };
}

export function renderDiffHtml(d) {
  const row = (c) => `<tr><td>${esc(c.title || c.key)}</td><td>${esc(c.from)}</td><td>${esc(c.to)}</td></tr>`;
  const add = d.added.map((f) => `<li>+ ${esc(f.title)} <code>${esc(f.path)}</code> (${f.status})</li>`).join("");
  const rem = d.removed.map((f) => `<li>− ${esc(f.title)} <code>${esc(f.path)}</code></li>`).join("");
  return `<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>WitnessQA diff</title>
<style>body{font-family:Archivo,sans-serif;background:#F4F1EA;color:#17150F;padding:32px;max-width:860px;margin:auto}h1{font-family:Georgia,serif}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #C9C3B2;padding:8px;text-align:left}code{font-size:12px}</style>
<h1>Diff de vereditos</h1>
<p>${d.before} → ${d.after} fluxos · ${d.changes.length} mudaram · ${d.regressions.length} regressão(ões) · ${d.recovered.length} recuperado(s)</p>
<h2>Mudanças</h2>
<table><tr><th>Tela</th><th>Antes</th><th>Agora</th></tr>${d.changes.map(row).join("") || "<tr><td colspan=3>nenhuma</td></tr>"}</table>
<h2>Novos</h2><ul>${add || "<li>nenhum</li>"}</ul>
<h2>Sumiram</h2><ul>${rem || "<li>nenhum</li>"}</ul>
</html>`;
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const isCli = process.argv[1] && /diff\.mjs$/.test(String(process.argv[1]).replace(/\\/g, "/"));
if (isCli) {
  const [a, b, out] = process.argv.slice(2);
  if (!a || !b) {
    console.error("uso: node src/diff.mjs <run-a> <run-b> [out.html]");
    process.exit(1);
  }
  const d = diffRuns(a, b);
  console.log(`diff: ${d.changes.length} mudaram · ${d.added.length} novos · ${d.removed.length} sumiram · ${d.regressions.length} regressões`);
  for (const c of d.changes) console.log(`  ${c.from} → ${c.to}  ${c.title}`);
  const dest = out || join(b, "DIFF.html");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, renderDiffHtml(d));
  console.log(dest);
}
