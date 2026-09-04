/**
 * cover — o mecanismo de cobertura exaustiva.
 *
 * 1. Entra autenticado (storageState)
 * 2. Varre nav/sidebar + <a href> + Next.js + botões que mudam URL
 * 3. Visita cada pathname único
 * 4. Extrai heading real (não "body visível")
 * 5. Gera 1 YAML por rota com expectText + expectNoText de erro
 *
 * Uso: node src/cover.mjs <url> [--auth file] [--out dir] [--max 80]
 */
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { createEvidenceGuard } from "./privacy.mjs";

const ERROR_MARKERS = [
  "Não foi possível carregar",
  "Houve um problema",
  "Something went wrong",
  "Internal Server Error",
  "Application error",
];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function norm(u) {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/$/, "") || "/";
    return `${x.origin}${path}`;
  } catch {
    return u;
  }
}

function slug(url) {
  try {
    const u = new URL(url);
    const p = (u.pathname.replace(/^\//, "").replace(/\/$/, "") || "home")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => m.slice(0, 8));
    const s = p.replace(/[^a-z0-9/-]/gi, "").replace(/\//g, "-").toLowerCase();
    return (s || "home").slice(0, 80);
  } catch {
    return "page";
  }
}

async function dismiss(page) {
  for (const s of ["#axeptio_btn_acceptAll", 'button:has-text("Aceitar")', 'button:has-text("Accept")']) {
    try {
      const loc = page.locator(s).first();
      if (await loc.isVisible({ timeout: 300 })) await loc.click({ timeout: 600 });
    } catch { /* */ }
  }
}

async function harvest(page, origin) {
  return page.evaluate((appOrigin) => {
    const seen = new Set();
    const out = [];
    const add = (href, text, via) => {
      try {
        const u = new URL(href, location.href);
        if (u.origin !== appOrigin) return;
        if (/\.(png|jpe?g|gif|svg|pdf|zip|webp)(\?|$)/i.test(u.pathname)) return;
        if (u.pathname.startsWith("/api") || u.pathname.startsWith("/_next")) return;
        const key = u.origin + (u.pathname.replace(/\/$/, "") || "/");
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ href: key, text: String(text || "").replace(/\s+/g, " ").trim().slice(0, 80), via });
      } catch { /* */ }
    };
    for (const a of document.querySelectorAll("a[href]")) {
      add(a.getAttribute("href"), a.innerText || a.getAttribute("aria-label"), "a");
    }
    const next = window.__NEXT_DATA__;
    if (next?.props?.page) add(next.page || location.pathname, "next-page", "next");
    return out;
  }, origin);
}

async function probeClicks(page, fromUrl, origin) {
  const labels = await page.evaluate(() => {
    const skip = /sair|logout|excluir|deletar|remover|apagar|delete/i;
    return [...document.querySelectorAll("nav a, aside a, [role=navigation] a, nav button, aside button, [role=tab]")]
      .map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40))
      .filter((t) => t && t.length < 40 && !skip.test(t))
      .filter((t, i, a) => a.indexOf(t) === i)
      .slice(0, 8);
  });
  const found = [];
  for (const label of labels) {
    const before = norm(page.url());
    try {
      await page.getByRole("link", { name: label }).first().click({ timeout: 1500 }).catch(async () => {
        await page.getByText(label, { exact: true }).first().click({ timeout: 1500 });
      });
      await page.waitForTimeout(700);
      const after = norm(page.url());
      if (after !== before && after.startsWith(origin)) {
        found.push({ from: fromUrl, to: after, text: label, via: "click" });
      }
    } catch {
      /* morto */
    }
  }
  return found;
}

async function probeWizard(page, fromUrl, origin) {
  const danger = /sair|logout|excluir|deletar|remover|apagar|delete|pagar|pagamento|assinar|cancelar/i;
  const nextRe = /continuar|pr[oó]ximo|avan[cç]ar|seguir|come[cç]ar|iniciar|personalizar|revisar|confirmar escolhas|pr[oó]xima etapa/i;
  const found = [];
  for (let i = 0; i < 4; i++) {
    const before = norm(page.url());
    const headingBefore = await page.locator("h1,h2").first().innerText().catch(() => "");
    const label = await page.evaluate(({ dangerSrc, nextSrc }) => {
      const danger = new RegExp(dangerSrc, "i");
      const nextRe = new RegExp(nextSrc, "i");
      const btns = [...document.querySelectorAll("button, [role=button], a")].filter((el) => {
        const t = (el.innerText || el.getAttribute("aria-label") || "").trim();
        if (!t || t.length > 48 || danger.test(t) || !nextRe.test(t)) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && r.width > 0 && r.height > 0;
      });
      return (btns[0]?.innerText || btns[0]?.getAttribute("aria-label") || "").trim().slice(0, 40);
    }, { dangerSrc: danger.source, nextSrc: nextRe.source });
    if (!label) break;
    try {
      await page.getByRole("button", { name: label }).first().click({ timeout: 2000 }).catch(async () => {
        await page.getByText(label, { exact: false }).first().click({ timeout: 2000 });
      });
      await page.waitForTimeout(900);
      const after = norm(page.url());
      const headingAfter = await page.locator("h1,h2").first().innerText().catch(() => "");
      if (after !== before && after.startsWith(origin)) {
        found.push({ from: fromUrl, to: after, text: label, via: "wizard" });
        fromUrl = after;
      } else if (headingAfter && headingAfter !== headingBefore) {
        found.push({ from: fromUrl, to: after, text: `wizard:${label}`, via: "wizard-step" });
      }
    } catch {
      break;
    }
  }
  return found;
}

async function inspect(page) {
  return page.evaluate((markers) => {
    const body = document.body?.innerText || "";
    const h1 = document.querySelector("h1")?.innerText?.trim() || "";
    const h2 = document.querySelector("h2")?.innerText?.trim() || "";
    const title = document.title || "";
    const heading = (h1 || h2 || "").replace(/\s+/g, " ").slice(0, 80);
    const errors = markers.filter((m) => body.includes(m));
    const assertionText = (heading.split(/\s+/).find((w) => w.length >= 4) || heading).slice(0, 40);
    return {
      title,
      heading,
      assertionText,
      errors,
      url: location.href,
    };
  }, ERROR_MARKERS);
}

export async function cover({ startUrl, outDir, authFile, maxNodes = 80, prefix = "" }) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "witness"), { recursive: true });
  const origin = new URL(startUrl).origin;
  const guard = createEvidenceGuard();
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    ...(authFile && existsSync(authFile) ? { storageState: authFile } : {}),
  });
  const page = await context.newPage();

  const queue = [norm(startUrl)];
  const visited = new Set();
  const pages = [];
  const edges = [];
  const prevFile = join(outDir, "coverage.json");
  if (existsSync(prevFile)) {
    try {
      const prev = JSON.parse(readFileSync(prevFile, "utf8"));
      for (const p of prev.pages ?? []) {
        if (p.url) {
          visited.add(norm(p.url));
          pages.push(p);
        }
      }
      for (const e of prev.edges ?? []) edges.push(e);
      for (const e of edges) {
        const to = e.to && norm(e.to);
        if (to && !visited.has(to) && !queue.includes(to)) queue.push(to);
      }
    } catch { /* grafo novo */ }
  }

  while (queue.length && visited.size < maxNodes) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
      await dismiss(page);
      await page.waitForTimeout(600);
      const info = Object.fromEntries(Object.entries(await inspect(page)).map(([key, value]) => [key, guard.redactText(value)]));
      const links = (await harvest(page, origin)).map((link) => ({ ...link, href: guard.redactText(link.href), text: guard.redactText(link.text) }));
      pages.push({ url, ...info, links: links.length });
      await guard.captureScreenshot(page, join(outDir, `${slug(url)}.png`), { fullPage: false });
      for (const l of links) {
        edges.push({ from: url, to: l.href, text: l.text, via: l.via });
        if (!visited.has(l.href) && !queue.includes(l.href)) queue.push(l.href);
      }
      const extras = await probeClicks(page, url, origin);
      for (const e of extras) {
        edges.push(e);
        if (!visited.has(e.to) && !queue.includes(e.to)) queue.push(e.to);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await dismiss(page);
      }
      const wizard = await probeWizard(page, url, origin);
      for (const e of wizard) {
        edges.push(e);
        if (!visited.has(e.to) && !queue.includes(e.to)) queue.push(e.to);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        await dismiss(page);
      }
    } catch (err) {
      pages.push({ url: guard.redactText(url), error: guard.redactText(String(err).split("\n")[0].slice(0, 200)), heading: "", assertionText: "", errors: [] });
    }
  }

  await browser.close();

  const yamls = [];
  for (const p of pages) {
    if (p.error) continue;
    const assertionText = p.assertionText && p.assertionText.length >= 3 ? p.assertionText : null;
    const path = new URL(p.url).pathname || "/";
    const title = (p.heading || path.replace(/\/$/, "") || "tela").trim();
    const name = prefix ? `${prefix} · ${title}` : title;
    const what = p.heading ? `valida "${p.heading}" (${path})` : `valida ${path}`;
    const lines = [
      `name: ${JSON.stringify(name)}`,
      `what: ${JSON.stringify(what)}`,
      `app: ${origin}`,
      ...(authFile ? [`auth: ${authFile}`] : []),
      "steps:",
      `  - goto: ${p.url}`,
      "  - wait: 2000",
    ];
    if (assertionText) lines.push(`  - expectText: ${JSON.stringify(assertionText)}`);
    for (const err of ERROR_MARKERS.slice(0, 3)) {
      lines.push(`  - expectNoText: ${JSON.stringify(err)}`);
    }
    lines.push("checks:", "  - noBrokenImages", "");
    const file = join(outDir, "witness", `${prefix ? `${prefix}-` : ""}${slug(p.url)}.yaml`);
    guard.writeText(file, lines.join("\n"));
    yamls.push(file);
  }

  const graph = {
    start: startUrl,
    origin,
    discovered: pages.length,
    generated: yamls.length,
    queuedLeft: queue.length,
    pages,
    edges,
  };
  const safeGraph = guard.writeJson(join(outDir, "coverage.json"), graph);
  return { ...safeGraph, yamls, outDir };
}

const isCli = process.argv[1] && /cover\.mjs$/.test(process.argv[1].replace(/\\/g, "/"));
if (isCli) {
  const url = process.argv[2];
  if (!url || url.startsWith("--")) {
    console.error("uso: node src/cover.mjs <url> [--auth file] [--out dir] [--max 80]");
    process.exit(1);
  }
  const r = await cover({
    startUrl: url,
    outDir: arg("--out", "runs/cover"),
    authFile: arg("--auth", ""),
    maxNodes: Number(arg("--max", 80)),
    prefix: arg("--prefix", ""),
  });
  console.log(`cover: ${r.discovered} telas · ${r.generated} YAMLs · ${r.edges.length} arestas`);
  for (const p of r.pages) {
    console.log(`  ${p.error ? "✗" : "✓"} ${p.url}  ${p.heading || p.error || ""}`);
  }
  if (r.pages.some((page) => page.error) || r.generated === 0) {
    process.exitCode = 2;
  }
}
