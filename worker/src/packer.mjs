/**
 * Packer v4 — laudo self-contained no sistema visual "dossiê técnico".
 *
 * Uso CLI:  node src/packer.mjs <run-dir>
 * Uso lib:  import { packRun } from "./packer.mjs"
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFlow, describeFlow, summarize, displayTitle, displayGroup, displayPath, cleanErrors } from "./classify.mjs";
import { createEvidenceGuard, PRIVACY_VERSION } from "./privacy.mjs";
import { safeEvidencePath } from "./safe-evidence-path.mjs";

export function packRun(runDir) {
  const roots = (Array.isArray(runDir) ? runDir : [runDir]).filter((d) => d && existsSync(d));
  if (!roots.length) throw new Error("uso: node src/packer.mjs <run-dir> [run-dir...]");

  const seen = new Set();
  const flows = [];
  const guard = createEvidenceGuard();
  let legacyScreenshotsOmitted = 0;
  for (const run of roots) {
    const flowDirs = readdirSync(run, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of flowDirs) {
      const rf = safeEvidencePath(join(run, dir), "result.json", { extension: ".json" });
      if (!rf || seen.has(dir)) continue;
      seen.add(dir);
      const r = guard.redact(JSON.parse(readFileSync(rf, "utf8")));
      const shots = [];
      if (r.privacyVersion === PRIVACY_VERSION) {
        for (const s of r.screenshots ?? []) {
          const p = safeEvidencePath(join(run, dir), s, { extension: ".png" });
          if (p) shots.push({ name: s, b64: readFileSync(p).toString("base64") });
        }
      } else {
        legacyScreenshotsOmitted += (r.screenshots ?? []).length;
      }
      const status = classifyFlow(r);
      flows.push({ ...r, dir, shots, status, what: r.what || describeFlow(r) });
    }
  }

  flows.sort((a, b) => {
    const order = { fail: 0, blocked: 1, warn: 2, skip: 3, pass: 4 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const { counts, realFails, blocked, allPass, stamp } = summarize(flows);
  const startedAt = flows[0]?.startedAt ? new Date(flows[0].startedAt) : new Date();
  const shotCount = flows.reduce((a, f) => a + f.shots.length, 0);

  const tocGroups = new Map();
  for (const [i, f] of flows.entries()) {
    const g = displayGroup(f);
    if (!tocGroups.has(g)) tocGroups.set(g, []);
    tocGroups.get(g).push({ i, f });
  }
  const tocLinks = [...tocGroups.entries()]
    .map(([g, items]) => {
      const rows = items
        .map(({ i, f }) => {
          const mark = { pass: "✓", warn: "!", skip: "—", fail: "✗", blocked: "■" }[f.status] ?? "";
          return `<a href="#flow-${i}" class="${f.status}"><i>${mark}</i><span>${esc(displayTitle(f))}</span></a>`;
        })
        .join("");
      return `<div class="toc-g"><b>${esc(g)} <em>${items.length}</em></b>${rows}</div>`;
    })
    .join("");

  const verdictText = allPass
    ? `<em>${counts.pass} fluxo(s) validado(s)</em>`
    : realFails > 0
      ? `<em style="color:var(--fail)">${realFails} falha(s)</em>`
      : `<em style="color:var(--warn)">${blocked} bloqueio(s) de infra</em>`;

  const total = Math.max(flows.length, 1);
  const scoreSegments = [
    counts.pass ? `<span class="sp" style="width:${(counts.pass / total) * 100}%"></span>` : "",
    counts.warn ? `<span class="sw" style="width:${(counts.warn / total) * 100}%"></span>` : "",
    counts.skip ? `<span class="ssk" style="width:${(counts.skip / total) * 100}%"></span>` : "",
    counts.blocked ? `<span class="sb" style="width:${(counts.blocked / total) * 100}%"></span>` : "",
    counts.fail ? `<span class="sf" style="width:${(counts.fail / total) * 100}%"></span>` : "",
  ].join("");

  const summaryBits = [];
  if (realFails) summaryBits.push(`${realFails} falha(s) do app`);
  if (blocked) summaryBits.push(`${blocked} bloqueio(s) do testemunha (crash/OOM)`);
  if (counts.warn) summaryBits.push(`${counts.warn} aviso(s) de console/rede`);
  if (counts.skip) summaryBits.push(`${counts.skip} skip(s) de sessão`);
  const execNote = allPass
    ? "Nenhum fluxo falhou. O laudo abaixo é o registro assinado desta run."
    : `Leia primeiro os cartões no topo. ${summaryBits.join(" · ")}.`;

  const flowCards = flows.map((f, i) => flowCard(f, i, flows.length)).join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WitnessQA — ${stamp} · ${flows.length} fluxos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#F4F1EA; --card:#FBF9F4; --ink:#17150F; --soft:#4A463B;
    --rule:#C9C3B2; --pass:#0E6B3D; --pass-bg:#E7F0EA; --fail:#B3261E; --fail-bg:#F6E7E5;
    --warn:#8A6D1C; --warn-bg:#F4EDD8; --blocked:#3A362B; --blocked-bg:#E8E4D8;
    --shadow:rgba(23,21,15,.85);
    --serif:'Instrument Serif',Georgia,serif;
    --sans:'Archivo',Helvetica,sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,monospace;
  }
  [data-theme=dark]{
    --paper:#141310; --card:#1D1B16; --ink:#EDE9DC; --soft:#9B968A;
    --rule:#3A372E; --pass:#3FBF77; --pass-bg:#16281D; --fail:#E5544C; --fail-bg:#2C1512;
    --warn:#C9A83E; --warn-bg:#292214; --blocked:#C9C3B2; --blocked-bg:#242018;
    --shadow:rgba(0,0,0,.6);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased}
  .topbar{background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;padding:7px 16px;display:flex;justify-content:center;position:relative}
  .theme-switch{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:1px solid currentColor;color:inherit;font-family:var(--mono);font-size:10px;padding:3px 10px;cursor:pointer;text-transform:uppercase}
  .wrap{max-width:1120px;margin:0 auto;padding:28px 22px 80px}
  .layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:28px;align-items:start}
  @media(max-width:860px){.layout{grid-template-columns:1fr}}

  .toc{position:sticky;top:10px;max-height:calc(100vh - 24px);overflow:auto;border:2px solid var(--ink);background:var(--card);padding:10px 0 12px;z-index:5}
  .toc-h{font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--soft);padding:4px 12px 10px}
  .toc-g{padding:6px 0 10px}
  .toc-g b{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;padding:6px 12px 4px;color:var(--ink)}
  .toc-g b em{font-style:normal;color:var(--soft);font-weight:500}
  .toc a{display:flex;gap:8px;align-items:baseline;font-family:var(--sans);font-size:13px;text-decoration:none;color:var(--ink);padding:4px 12px;border-left:3px solid transparent}
  .toc a i{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--soft);width:12px;flex:none}
  .toc a:hover{background:var(--paper)}
  .toc a.fail{border-left-color:var(--fail);color:var(--fail)}
  .toc a.warn{border-left-color:var(--warn)}
  .toc a.blocked{border-left-color:var(--blocked)}
  .toc a.skip{opacity:.55}
  .toc a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  header{border-bottom:3px double var(--ink);padding-bottom:24px}
  h1{font-family:var(--serif);font-weight:400;font-size:clamp(26px,4.5vw,42px);margin-top:12px;line-height:1.1}
  h1 em{font-style:italic}
  .meta{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;font-family:var(--mono);font-size:11.5px;color:var(--soft)}
  .meta b{color:var(--ink)}
  .stamp{font-family:var(--mono);font-weight:700;font-size:14px;letter-spacing:.16em;color:${stamp === "PASS" ? "var(--pass)" : stamp === "WARN" ? "var(--warn)" : "var(--fail)"};border:2.5px solid currentColor;padding:8px 18px;transform:rotate(-2.5deg)}
  .stamp-row{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px}

  .score{display:flex;height:13px;border:2px solid var(--ink);margin:24px 0 6px;overflow:hidden}
  .score span{display:block;height:100%}
  .sp{background:var(--pass)}.sf{background:var(--fail)}.sw{background:var(--warn)}.ssk{background:var(--rule)}.sb{background:var(--blocked)}
  .score-legend{display:flex;gap:16px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--soft)}

  .exec{border:2px solid var(--ink);background:var(--card);box-shadow:6px 6px 0 var(--shadow);padding:16px 20px;margin:22px 0 0;font-size:14.5px}
  .exec .tag{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);display:block;margin-bottom:6px}

  section{margin-bottom:44px}
  .sec-label{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--soft);margin:28px 0 16px;display:flex;align-items:center;gap:12px}
  .sec-label::after{content:"";flex:1;height:1px;background:var(--rule)}

  .flow{border:2px solid var(--ink);background:var(--card);box-shadow:6px 6px 0 var(--shadow);margin-bottom:20px;break-inside:avoid;scroll-margin-top:16px}
  .flow-head{display:grid;grid-template-columns:1fr auto;gap:6px 12px;padding:14px 18px;border-bottom:2px solid var(--ink);align-items:start}
  .flow-head .name{font-family:var(--serif);font-weight:400;font-size:22px;line-height:1.15}
  .flow-head .path{font-family:var(--mono);font-size:11px;color:var(--soft);grid-column:1}
  .flow-nav{display:flex;gap:8px;font-family:var(--mono);font-size:11px}
  .flow-nav a{color:var(--soft);text-decoration:none;border:1px solid var(--rule);padding:2px 8px}
  .flow-nav a:hover{color:var(--ink);border-color:var(--ink)}
  .badge{font-family:var(--mono);font-weight:700;font-size:10.5px;letter-spacing:.12em;padding:4px 12px;border:2px solid}
  .badge.pass{color:var(--pass);border-color:var(--pass);background:var(--pass-bg)}
  .badge.fail{color:var(--fail);border-color:var(--fail);background:var(--fail-bg)}
  .badge.warn{color:var(--warn);border-color:var(--warn);background:var(--warn-bg)}
  .badge.skip{color:var(--soft);border-color:var(--rule);background:var(--paper)}
  .badge.blocked{color:var(--blocked);border-color:var(--blocked);background:var(--blocked-bg)}

  table.steps{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
  td{padding:9px 16px;border-bottom:1px solid var(--rule);vertical-align:top}
  tr:last-child td{border-bottom:0}
  td.idx{color:var(--soft);white-space:nowrap;width:74px;font-size:10.5px}
  td.act code{font-family:var(--mono);font-size:11px;background:var(--paper);border:1px solid var(--rule);padding:1px 5px;word-break:break-all}
  td.act .detail{display:block;margin-top:5px;color:var(--fail);font-size:11px}
  td.st{text-align:right;font-weight:700;width:70px;font-size:10.5px}
  .st.ok{color:var(--pass)}.st.no{color:var(--fail)}.st.sk{color:var(--soft)}

  details.ev{margin:10px 16px 14px;border:1px solid var(--rule)}
  details.ev summary{cursor:pointer;font-family:var(--mono);font-size:11px;padding:7px 12px;color:var(--soft);list-style:none}
  details.ev summary::before{content:"▸ "}
  details.ev[open] summary::before{content:"▾ "}
  details.ev img{max-width:100%;display:block;border-top:1px solid var(--rule)}
  .film{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;padding:10px}
  .film figure{margin:0;border:1px solid var(--rule)}
  .film figcaption{font-family:var(--mono);font-size:10px;padding:4px 8px;color:var(--soft)}
  .film img{cursor:zoom-in}

  dialog.lb{border:2px solid var(--ink);padding:0;background:var(--paper);color:var(--ink);max-width:min(96vw,1400px);max-height:96vh;width:96vw}
  dialog.lb::backdrop{background:rgba(23,21,15,.72)}
  .lb-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-bottom:2px solid var(--ink);font-family:var(--mono);font-size:11px}
  .lb-bar button{font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--ink);color:var(--ink);padding:4px 10px;cursor:pointer}
  .lb-bar button:hover{background:var(--ink);color:var(--paper)}
  .lb img{display:block;width:100%;height:auto;max-height:calc(96vh - 48px);object-fit:contain;background:#0b0a08}

  .cerr{padding:10px 18px;border-top:1px solid var(--rule);font-family:var(--mono);font-size:11px;color:var(--fail)}
  .analysis{padding:12px 18px;border-top:2px solid var(--ink);background:var(--paper)}
  .analysis .tag{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);display:block;margin-bottom:6px}
  .note{border:2px solid var(--ink);background:var(--card);box-shadow:6px 6px 0 var(--shadow);padding:18px 22px;font-size:14px}
  .note .tag{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);display:block;margin-bottom:8px}

  footer{margin-top:52px;padding-top:16px;border-top:2px solid var(--ink);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:var(--mono);font-size:11px;color:var(--soft)}
</style>
</head>
<body data-theme="light">
<div class="topbar">WitnessQA · case file · evidências embutidas<button class="theme-switch" id="themeBtn" type="button">escuro</button></div>
<div class="wrap">

<div class="layout">
<nav class="toc" aria-label="Índice"><div class="toc-h">§ Índice · ${flows.length}</div>${tocLinks}</nav>
<div class="main">

<header>
  <div class="stamp-row">
    <div>
      <h1>${flows.length} fluxos — ${verdictText}</h1>
      <div class="meta">
        <span>Run <b>${esc(startedAt.toLocaleString("pt-BR"))}</b></span>
        <span>Evidências <b>${shotCount}</b></span>
        <span>Diretório <b>${esc(String(roots[0]).split(/[/\\\\]/).slice(-2).join("/"))}</b></span>
      </div>
    </div>
    <div class="stamp">${esc(stamp)}</div>
  </div>
  <div class="score">${scoreSegments}</div>
  <div class="score-legend">
    <span>pass (${counts.pass})</span><span>warn (${counts.warn})</span><span>skip (${counts.skip})</span><span>blocked (${counts.blocked})</span><span>fail (${counts.fail})</span>
  </div>
  <div class="exec"><span class="tag">§ Veredito</span>${esc(execNote)}</div>
</header>

<section>
  <div class="sec-label">§ Fluxos examinados</div>
  ${flowCards}
</section>

${counts.skip ? `<section><div class="sec-label">§ Nota sobre os SKIPs</div><div class="note"><span class="tag">Comportamento esperado, não bug</span>Cenários marcados como SKIP usam sessão auth válida (storageState), então o app redireciona antes de mostrar o formulário de login. Para validar o form de verdade, rode com cookie limpo.</div></section>` : ""}
${counts.blocked ? `<section><div class="sec-label">§ Nota sobre BLOCKED</div><div class="note"><span class="tag">Infra do testemunha, não necessariamente o app</span>O Chromium caiu (Target crashed / OOM) ao abrir ou fotografar a página. Dashboard pesado com screenshot full-page era a causa clássica nas runs v3. Não trate BLOCKED como regressão do produto até reproduzir à mão.</div></section>` : ""}
${counts.warn ? `<section><div class="sec-label">§ Nota sobre os WARNs</div><div class="note"><span class="tag">Funcional com ruído</span>O fluxo carrega e valida, mas registra console errors ou respostas 4xx/5xx. Vale investigar no card correspondente.</div></section>` : ""}
${legacyScreenshotsOmitted ? `<section><div class="sec-label">§ Privacidade</div><div class="note"><span class="tag">Captura legada omitida</span>${legacyScreenshotsOmitted} screenshot(s) sem marca de sanitização não foram incorporados ao laudo.</div></section>` : ""}

<footer><span>WitnessQA — evidence, not promises.</span><span>gerado em ${esc(new Date().toISOString())}</span></footer>
</div></div>
</div>
<dialog class="lb" id="lightbox">
  <div class="lb-bar"><span id="lbCap"></span><span><button type="button" id="lbPrev">←</button> <button type="button" id="lbNext">→</button> <button type="button" id="lbClose">fechar</button></span></div>
  <img id="lbImg" alt="">
</dialog>
<script>
  const btn = document.getElementById('themeBtn');
  const apply = (t) => { document.body.dataset.theme = t; btn.textContent = t === 'dark' ? 'claro' : 'escuro'; };
  apply(localStorage.getItem('wq-theme') || 'light');
  btn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('wq-theme', next);
    apply(next);
  });

  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lbImg');
  const lbCap = document.getElementById('lbCap');
  const shots = () => [...document.querySelectorAll('.film img')];
  let li = 0;
  const show = (i) => {
    const all = shots();
    if (!all.length) return;
    li = (i + all.length) % all.length;
    const el = all[li];
    lbImg.src = el.src;
    lbCap.textContent = (el.closest('figure')?.querySelector('figcaption')?.textContent || '') + ' · ' + (li + 1) + '/' + all.length;
    if (!lb.open) lb.showModal();
  };
  document.addEventListener('click', (e) => {
    const img = e.target.closest?.('.film img');
    if (img) show(shots().indexOf(img));
  });
  document.getElementById('lbClose').onclick = () => lb.close();
  document.getElementById('lbPrev').onclick = () => show(li - 1);
  document.getElementById('lbNext').onclick = () => show(li + 1);
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.open) return;
    if (e.key === 'Escape') lb.close();
    if (e.key === 'ArrowLeft') show(li - 1);
    if (e.key === 'ArrowRight') show(li + 1);
  });
</script>
</body>
</html>`;

  const out = join(roots[0], "REPORT.html");
  writeFileSync(out, html);
  return { path: out, bytes: html.length, flows: flows.length, stamp, counts };
}

function flowCard(f, i, total) {
  const badge = {
    pass: '<span class="badge pass">PASS</span>',
    warn: '<span class="badge warn">WARN</span>',
    skip: '<span class="badge skip">SKIP</span>',
    fail: '<span class="badge fail">FAIL</span>',
    blocked: '<span class="badge blocked">BLOCKED</span>',
  }[f.status];
  const path = displayPath(f);
  const prev = i > 0 ? `<a href="#flow-${i - 1}">↑ anterior</a>` : "";
  const next = i < total - 1 ? `<a href="#flow-${i + 1}">↓ próximo</a>` : "";
  const analysis = f.analysis
    ? `<div class="analysis"><span class="tag">§ Investigação BYOK</span>
      <p><b>Causa:</b> ${esc(f.analysis.cause)}</p>
      <p><b>Bug do app:</b> ${esc(String(f.analysis.isBug ?? "?"))} · confiança ${esc(f.analysis.confidence)} — ${esc(f.analysis.suggestion)}</p></div>`
    : "";
  return `
    <div class="flow" id="flow-${i}" data-name="${esc(f.name ?? "")}">
      <div class="flow-head">
        <span class="name">${esc(displayTitle(f))}</span>
        ${badge}
        ${path ? `<span class="path">${esc(displayGroup(f))} · ${esc(path)}</span>` : ""}
        <span class="flow-nav">${prev}${next}</span>
      </div>
      <table class="steps">${stepRows(f)}</table>
      ${consoleBlock(f)}${networkBlock(f)}${analysis}${evidenceBlock(f)}
    </div>`;
}

function describeStep(step) {
  if (typeof step !== "object" || !step) return esc(String(step));
  if (step.goto) return `abre <code>${esc(shortUrl(step.goto))}</code>`;
  if (step.fill) return `preenche <code>${esc(step.fill.selector)}</code>`;
  if (step.click) return `clica <code>${esc(step.click)}</code>`;
  if (step.expectVisible) return `verifica visibilidade <code>${esc(step.expectVisible)}</code>`;
  if (step.expectText !== undefined) {
    const t = typeof step.expectText === "string" ? step.expectText : step.expectText.text;
    return `verifica texto <code>"${esc(t)}"</code>`;
  }
  if (step.expectUrl) return `verifica URL <code>${esc(step.expectUrl)}</code>`;
  if (step.wait) return `aguarda ${Number(step.wait) / 1000}s`;
  return esc(JSON.stringify(step));
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.pathname + (x.search || "");
  } catch {
    return u;
  }
}

function stepRows(f) {
  return (f.steps ?? [])
    .map((s, i) => {
      let status, cls;
      if (s.ok) {
        status = "ok";
        cls = "ok";
      } else if (f.status === "skip") {
        status = "skip";
        cls = "sk";
      } else {
        status = f.status === "blocked" ? "BLOCKED" : "FAIL";
        cls = "no";
      }
      const detail = !s.ok && s.detail ? `<span class="detail">${esc(s.detail.slice(0, 280))}</span>` : "";
      return `<tr><td class="idx">STEP ${String(i).padStart(2, "0")}</td><td class="act">${describeStep(s.step)}${detail}</td><td class="st ${cls}">${status}</td></tr>`;
    })
    .join("\n");
}

function evidenceBlock(f) {
  if (!f.shots.length) return "";
  const open = f.status === "fail" || f.status === "blocked" ? " open" : "";
  const figs = f.shots
    .map(
      (s) => `<figure><img src="data:image/png;base64,${s.b64}" alt="${esc(s.name)}" loading="lazy"><figcaption>${esc(s.name)}</figcaption></figure>`,
    )
    .join("");
  return `<details class="ev"${open}><summary>evidência · ${f.shots.length} captura(s)</summary><div class="film">${figs}</div></details>`;
}

function consoleBlock(f) {
  const items = [];
  for (const e of cleanErrors(f.consoleErrors)) items.push(`console: ${e}`);
  for (const e of cleanErrors(f.pageErrors)) items.push(`pageerror: ${e}`);
  if (!items.length) return "";
  return `<div class="cerr"><b>console / page errors:</b><br>${items.map((e) => `<code>${esc(e.slice(0, 180))}</code>`).join("<br>")}</div>`;
}

function networkBlock(f) {
  const errs = cleanErrors(f.networkErrors);
  if (!errs.length) return "";
  const items = errs.slice(0, 12).map((e) => `<code>${esc(e.slice(0, 180))}</code>`).join("<br>");
  return `<div class="cerr"><b>rede 4xx/5xx:</b><br>${items}</div>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  try {
    const dirs = process.argv.slice(2).filter((a) => a && !a.startsWith("--"));
    const info = packRun(dirs.length <= 1 ? dirs[0] : dirs);
    console.log(`✓ REPORT.html v4 (${Math.round(info.bytes / 1024)} KB, ${info.flows} fluxos, ${info.stamp})`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
