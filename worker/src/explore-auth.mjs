/**
 * Explorer com sessão: usa storageState salvo (session.mjs) pra explorar
 * o app logado, e captura screenshots dos nós.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const url = process.argv[2];
const authFile = process.argv[3] && existsSync(process.argv[3]) ? process.argv[3] : null;
const maxNodes = Number(process.argv[4] ?? 20);
if (!url) {
  console.error("uso: node src/explore-auth.mjs <url> [auth-state.json] [max-nodes]");
  process.exit(1);
}
mkdirSync(".witness/explore", { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  ...(authFile ? { storageState: authFile } : {}),
});
const page = await context.newPage();

function norm(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

const nodes = new Map();
const edges = [];
const queue = [{ url, depth: 0 }];
const visited = new Set();
const t0 = Date.now();

while (queue.length && visited.size < maxNodes) {
  queue.sort((a, b) => a.depth - b.depth);
  const job = queue.shift();
  const key = norm(job.url);
  if (visited.has(key)) continue;
  visited.add(key);

  try {
    await page.goto(key, { waitUntil: "networkidle", timeout: 25_000 });
    await page.waitForTimeout(800);
    const title = await page.title();
    const slug = key.replace(/https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    const shotPath = join(".witness/explore", `${slug}.png`);
    await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});

    const links = await page.evaluate((origin) => {
      const out = [];
      for (const a of document.querySelectorAll("a[href]")) {
        if (!a.href || a.href.startsWith("javascript") || a.href.startsWith("mailto")) continue;
        const abs2 = new URL(a.href, location.href);
        if (abs2.origin !== origin) continue;
        out.push({ to: abs2.origin + abs2.pathname, text: (a.innerText || "").trim().slice(0, 50) });
      }
      return out.slice(0, 30);
    }, new URL(key).origin);

    nodes.set(key, { title, shot: shotPath });
    console.log(`✓ ${key} — "${title}" (${links.length} links)`);

    for (const l of links) {
      edges.push({ from: key, to: norm(l.to), text: l.text });
      if (!visited.has(norm(l.to))) queue.push({ url: norm(l.to), depth: job.depth + 1 });
    }
  } catch (err) {
    console.log(`✗ ${key} — ${String(err).split("\n")[0].slice(0, 120)}`);
    nodes.set(key, { error: String(err).split("\n")[0].slice(0, 120) });
  }
}

await browser.close();
console.log(`\ngrafo: ${nodes.size} nós, ${edges.length} arestas em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(JSON.stringify({ nodes: Object.fromEntries(nodes), edges }, null, 2));
