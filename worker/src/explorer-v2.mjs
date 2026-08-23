/**
 * Explorer v2 — grafo de estados com clicáveis JS e travessia de portais.
 *
 * Melhorias v2:
 *  - arestas = <a href> + button + [role=tab|link|button] + input[type=submit]
 *  - cada nó: tenta atravessar "portais" (forms com 1 campo de texto) usando
 *    credenciais contextuais (--portal-value) — ex.: "Seu nome" → digita e entra
 *  - navegação JS: clica de verdade (não só coleta href) e observa mudança de URL/DOM
 *  - assinatura de DOM pra distinguir telas diferentes na mesma URL (SPAs)
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const DEFAULTS = { maxNodes: 25, maxDepth: 5, viewport: { width: 1440, height: 950 }, portalValue: "QA Explorer" };

export async function exploreV2({ startUrl, outDir, options = {} }) {
  const cfg = { ...DEFAULTS, ...options };
  mkdirSync(outDir, { recursive: true });
  const origin = new URL(startUrl).origin;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: cfg.viewport,
    ...(cfg.authFile && existsSync(cfg.authFile) ? { storageState: cfg.authFile } : {}),
  });
  const page = await context.newPage();

  const nodes = new Map();
  const edges = [];
  const visited = new Set();
  const queue = [{ url: startUrl, depth: 0 }];
  let portalUnlocked = false;

  while (queue.length && visited.size < cfg.maxNodes) {
    queue.sort((a, b) => a.depth - b.depth);
    const job = queue.shift();
    if (visited.has(job.url)) continue;
    if (job.depth > cfg.maxDepth) continue;
    visited.add(job.url);

    try {
      await page.goto(job.url, { waitUntil: "networkidle", timeout: 25_000 });
      await page.waitForTimeout(900);

      // portal: um form com 1-2 campos texto + botão submit, sem sessão ainda
      if (!portalUnlocked) {
        const portal = await detectPortal(page);
        if (portal) {
          await page.fill(portal.inputSelector, cfg.portalValue);
          await page.click(portal.submitSelector);
          await page.waitForTimeout(2000);
          portalUnlocked = true;
          edges.push({ from: job.url, to: page.url(), action: "portal-submit", text: portal.label });
          queue.push({ url: page.url(), depth: job.depth + 1 });
        }
      }

      const title = await page.title();
      const sig = await page.evaluate(() => document.body?.innerText?.slice(0, 300)?.replace(/\s+/g, " ") ?? "");
      const slug = norm(job.url).replace(/https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      nodes.set(job.url, { title, sigHash: hash(sig), shot: `${slug}.png` });
      await page.screenshot({ path: join(outDir, `${slug}.png`) }).catch(() => {});

      // coleta clicáveis reais
      const clickables = await page.evaluate((o) => {
        const seen = new Set();
        const out = [];
        const els = [
          ...document.querySelectorAll("a[href], button, [role=tab], [role=link], [role=button], input[type=submit]"),
        ];
        for (const el of els) {
          const label = (el.innerText || el.getAttribute("aria-label") || el.value || "").trim().slice(0, 50);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          const href = el.href ?? null;
          out.push({ label, href, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") });
        }
        return out.slice(0, 20); // orçamento por nó
      }, origin);

      // arestas via href direto
      for (const c of clickables.filter((c) => c.href)) {
        const to = new URL(c.href, job.url);
        if (to.origin !== origin) continue;
        edges.push({ from: job.url, to: norm(to.href), action: "goto", text: c.label });
        if (!visited.has(norm(to.href))) queue.push({ url: norm(to.href), depth: job.depth + 1 });
      }

      // arestas via clique JS (tabs/botões): clica e vê o que muda
      for (const c of clickables.filter((c) => !c.href && ["button", "a"].includes(c.tag))) {
        const beforeUrl = page.url();
        const beforeSig = await domSig(page);
        try {
          await page.click(`text="${c.label}"`, { timeout: 4000 });
          await page.waitForTimeout(1200);
          const afterUrl = page.url();
          const afterSig = await domSig(page);
          if (afterUrl !== beforeUrl || afterSig !== beforeSig) {
            edges.push({ from: job.url, to: norm(afterUrl), action: `click:${c.label}`, text: c.label });
            if (!visited.has(norm(afterUrl))) queue.push({ url: norm(afterUrl), depth: job.depth + 1 });
            // volta pro nó pai pra testar próximo clickable
            await page.goto(job.url, { waitUntil: "networkidle", timeout: 25_000 }).catch(() => {});
            await page.waitForTimeout(600);
            if (portalUnlocked) {
              const p2 = await detectPortal(page);
              if (p2) {
                await page.fill(p2.inputSelector, cfg.portalValue);
                await page.click(p2.submitSelector);
                await page.waitForTimeout(1500);
              }
            }
          }
        } catch {
          /* clickable morto — ignora */
        }
      }
    } catch (err) {
      nodes.set(job.url, { error: String(err).split("\n")[0].slice(0, 150) });
    }
  }

  await browser.close();

  const result = {
    start: startUrl,
    nodeCount: nodes.size,
    edgeCount: edges.length,
    nodes: Object.fromEntries([...nodes].map(([k, v]) => [k, v])),
    edges,
    portalUnlocked,
  };
  writeFileSync(join(outDir, "graph-v2.json"), JSON.stringify(result, null, 2));
  return result;
}

async function detectPortal(page) {
  // v2: não exige <form> — procura input de texto solto + botão de entrar/criar
  return page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(
      (i) => i.offsetParent !== null,
    );
    if (!inputs.length) return null;
    const input = inputs[0];
    const selector =
      input.name ? `input[name="${input.name}"]` :
      input.placeholder ? `input[placeholder="${input.placeholder}"]` :
      "input[type=text]";
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /entrar|criar|iniciar|começar|join|start/i.test(b.innerText),
    );
    if (!btn) return null;
    return { inputSelector: selector, submitSelector: `text=${btn.innerText.trim()}`, label: input.placeholder || input.name };
  });
}

async function domSig(page) {
  return page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").length + ":" + document.querySelectorAll("*").length);
}

function norm(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
