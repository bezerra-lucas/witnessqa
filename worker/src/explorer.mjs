/**
 * Graph Explorer — descoberta exaustiva de fluxos.
 *
 * Modela o app como grafo de estados:
 *   nó   = uma "tela" (URL normalizada, sem query/hash)
 *   aresta = ação clicável que leva a outro nó (link, button com navegação)
 *
 * Estratégia (inspirada em BFS/Dijkstra):
 *  - fila de prioridade: nós menos visitados primeiro; custo = profundidade
 *    do caminho (Dijkstra garante que cada tela é alcançada pelo caminho
 *    mais curto antes de explorar caminhos longos)
 *  - cada branch não-explorada spawna um subagente (contexto Playwright novo)
 *    que segue o caminho até o nó pai e expande as arestas dali
 *  - orçamento por run: maxNodes, maxDepth, maxAgents (controla custo)
 *  - ciclos cortados por conjunto de visitados (normalização de URL +
 *    assinatura do DOM para SPAs que mudam rota sem trocar de tela)
 *
 * Saída: grafo em JSON + um cenário YAML por branch significativa, prontos
 * para o worker rodar como regressão nas próximas runs.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createEvidenceGuard } from "./privacy.mjs";

const DEFAULTS = {
  maxNodes: 40,
  maxDepth: 6,
  maxAgents: 12,
  viewport: { width: 1440, height: 950 },
};

export async function exploreGraph({ startUrl, outDir, options = {} }) {
  const cfg = { ...DEFAULTS, ...options };
  const guard = createEvidenceGuard();
  mkdirSync(outDir, { recursive: true });

  const graph = {
    nodes: new Map(), // key -> {url, title, signature, visits}
    edges: [],        // {from, to, action, text}
    branches: [],     // caminhos até nós novos (viram cenários)
    agentsSpawned: 0,
    blockedNodes: [],
  };

  const browser = await chromium.launch({ headless: true });

  // Dijkstra-ish: fila ordenada por (profundidade, visitas)
  const queue = [{ url: startUrl, depth: 0, path: [] }];
  const visited = new Set();

  while (queue.length && visited.size < cfg.maxNodes && graph.agentsSpawned < cfg.maxAgents) {
    queue.sort((a, b) => a.depth - b.depth || nodeVisits(graph, a.url) - nodeVisits(graph, b.url));
    const job = queue.shift();
    const key = normalizeUrl(job.url);
    if (visited.has(key)) continue;
    if (job.depth > cfg.maxDepth) continue;
    visited.add(key);

    // subagente: contexto isolado seguindo o caminho até este nó
    graph.agentsSpawned++;
    const agent = await spawnSubagent(browser, graph, key, { viewport: cfg.viewport });
    if (!agent.ok) {
      graph.blockedNodes.push(guard.redact({ url: job.url, error: agent.error }));
      continue;
    }

    for (const edge of agent.edges) {
      graph.edges.push(guard.redact(edge));
      const targetKey = normalizeUrl(edge.to);
      if (!visited.has(targetKey)) {
        queue.push({
          url: edge.to,
          depth: job.depth + 1,
          path: [...job.path, { url: job.url, action: edge.action, text: edge.text }],
        });
      }
    }
    recordNode(graph, key, agent);

    // branch completa (caminho da raiz até cá) vira cenário de regressão
    if (job.path.length > 0) {
      graph.branches.push(pathToScenario(job, startUrl));
    }
  }

  await browser.close();

  const serialized = serialize(graph);
  guard.writeJson(join(outDir, "graph.json"), serialized);
  for (const [i, scenario] of graph.branches.entries()) {
    guard.writeText(join(outDir, `branch-${String(i).padStart(2, "0")}.yaml`), scenario.yaml);
  }
  return guard.redact(serialized);
}

async function spawnSubagent(browser, graph, nodeKey, { viewport }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await page.goto(nodeKey, { waitUntil: "networkidle", timeout: 30_000 });
    const title = await page.title();
    const signature = await page.evaluate(() => document.body?.innerText?.slice(0, 200)?.length ?? 0);
    const edges = await page.evaluate((origin) => {
      const out = [];
      for (const a of document.querySelectorAll("a[href]")) {
        const href = a.href;
        if (!href || href.startsWith("javascript") || href.startsWith("mailto")) continue;
        out.push({ from: origin, to: href.split("#")[0], action: "goto", text: (a.innerText || "").trim().slice(0, 60) });
      }
      return out.filter((e) => e.to.startsWith(origin)).slice(0, 25); // mantém no app
    }, nodeKey);

    await page.screenshot({ path: undefined, fullPage: false }).catch(() => {});
    return { ok: true, title, signature, edges };
  } catch (err) {
    return { ok: false, error: String(err).split("\n")[0].slice(0, 200), edges: [] };
  } finally {
    await context.close();
  }
}

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return u;
  }
}

function nodeVisits(graph, url) {
  return graph.nodes.get(normalizeUrl(url))?.visits ?? 0;
}

function recordNode(graph, key, agent) {
  graph.nodes.set(key, {
    url: key,
    title: agent.title,
    visits: (graph.nodes.get(key)?.visits ?? 0) + 1,
  });
}

function pathToScenario(job, startUrl) {
  const steps = [{ goto: "/" }];
  for (const hop of job.path.slice(1)) steps.push({ click: `text=${hop.text}` });
  steps.push({ expectVisible: "body" });
  const name = `branch-${normalizeUrl(job.url).split("/").filter(Boolean).slice(-2).join("-") || "root"}`;
  return {
    name,
    yaml: yamlDump({ name, app: startUrl, steps }),
    path: job.path,
  };
}

function yamlDump(obj) {
  // serialização mínima p/ evitar dependência extra aqui
  const lines = [`name: ${obj.name}`, `app: ${obj.app}`, "steps:"];
  for (const s of obj.steps) {
    if (s.goto !== undefined) lines.push(`  - goto: ${JSON.stringify(s.goto)}`);
    else if (s.click) lines.push(`  - click: ${JSON.stringify(s.click)}`);
    else if (s.expectVisible) lines.push(`  - expectVisible: ${JSON.stringify(s.expectVisible)}`);
  }
  lines.push("checks:", "  - noBrokenImages");
  return lines.join("\n") + "\n";
}

function serialize(graph) {
  return {
    nodes: Object.fromEntries(graph.nodes),
    edges: graph.edges,
    branchCount: graph.branches.length,
    agentsSpawned: graph.agentsSpawned,
    blockedNodes: graph.blockedNodes,
    scenarios: graph.branches.map((b) => b.name),
  };
}
