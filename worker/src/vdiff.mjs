/**
 * Visual-diff de screenshots entre duas runs.
 * Com pixelmatch+pngjs: % de pixels. Sem eles: hash de arquivo.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PRIVACY_VERSION } from "./privacy.mjs";
import { safeEvidencePath } from "./safe-evidence-path.mjs";

const req = createRequire(import.meta.url);

function listShots(runDir) {
  const out = [];
  if (!runDir || !existsSync(runDir)) return out;
  for (const flow of readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const dir = join(runDir, flow.name);
    const resultPath = safeEvidencePath(dir, "result.json", { extension: ".json" });
    if (!resultPath) continue;
    let result;
    try {
      result = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      continue;
    }
    if (result.privacyVersion !== PRIVACY_VERSION || !Array.isArray(result.screenshots)) continue;
    for (const name of result.screenshots) {
      const path = safeEvidencePath(dir, name, { extension: ".png" });
      if (path) out.push({ flow: flow.name, name, path });
    }
  }
  return out;
}

function sha(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function tryPixelmatch(aPath, bPath, diffPath) {
  let PNG, pixelmatch;
  try {
    PNG = req("pngjs").PNG;
    const pixelmatchModule = req("pixelmatch");
    pixelmatch = pixelmatchModule.default ?? pixelmatchModule;
  } catch {
    return null;
  }
  let a, b;
  try {
    a = PNG.sync.read(readFileSync(aPath));
    b = PNG.sync.read(readFileSync(bPath));
  } catch {
    return null;
  }
  if (a.width !== b.width || a.height !== b.height) {
    return { changed: true, pct: 100, reason: "size" };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, diffMask: true });
  const pct = (n / (a.width * a.height)) * 100;
  if (diffPath && pct > 0) {
    mkdirSync(join(diffPath, ".."), { recursive: true });
    writeFileSync(diffPath, PNG.sync.write(diff));
  }
  return { changed: pct >= 0.15, pct, pixels: n };
}

export function visualDiff(aDir, bDir, outDir) {
  const a = listShots(aDir);
  const b = listShots(bDir);
  const bMap = new Map(b.map((s) => [`${s.flow}/${s.name}`, s]));
  const rows = [];
  if (outDir) mkdirSync(outDir, { recursive: true });
  for (const shot of a) {
    const key = `${shot.flow}/${shot.name}`;
    const other = bMap.get(key);
    if (!other) {
      rows.push({ key, status: "removed" });
      continue;
    }
    bMap.delete(key);
    if (sha(shot.path) === sha(other.path)) {
      rows.push({ key, status: "same", pct: 0 });
      continue;
    }
    const px = tryPixelmatch(shot.path, other.path, outDir ? join(outDir, `${shot.flow}-${shot.name}`) : null);
    if (px) rows.push({ key, status: px.changed ? "changed" : "same", ...px });
    else rows.push({ key, status: "changed", pct: null });
  }
  for (const shot of bMap.values()) rows.push({ key: `${shot.flow}/${shot.name}`, status: "added" });
  return {
    compared: rows.length,
    changed: rows.filter((r) => r.status === "changed").length,
    added: rows.filter((r) => r.status === "added").length,
    removed: rows.filter((r) => r.status === "removed").length,
    rows,
  };
}

export function renderVdiffHtml(d) {
  const li = d.rows
    .filter((r) => r.status !== "same")
    .map((r) => `<li><b>${esc(r.status)}</b> ${esc(r.key)}${r.pct != null ? ` (${r.pct.toFixed(2)}%)` : ""}</li>`)
    .join("");
  return `<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><title>WitnessQA visual-diff</title>
<style>body{font:16px Archivo,sans-serif;background:#F4F1EA;color:#17150F;padding:32px;max-width:800px;margin:auto}</style>
<h1>Visual-diff</h1>
<p>${d.changed} mudaram · ${d.added} novas · ${d.removed} sumiram · ${d.compared} comparadas</p>
<ul>${li || "<li>nenhuma diferença</li>"}</ul></html>`;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const isCli = process.argv[1] && /vdiff\.mjs$/.test(String(process.argv[1]).replace(/\\/g, "/"));
if (isCli) {
  const [a, b, out] = process.argv.slice(2);
  if (!a || !b) {
    console.error("uso: node src/vdiff.mjs <run-a> <run-b> [out-dir]");
    process.exit(1);
  }
  const dest = out || join(b, "vdiff");
  const d = visualDiff(a, b, dest);
  writeFileSync(join(dest, "REPORT.html"), renderVdiffHtml(d));
  console.log(`vdiff: ${d.changed} mudaram · ${d.added} novas · ${d.removed} sumiram`);
  console.log(join(dest, "REPORT.html"));
}
