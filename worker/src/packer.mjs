/**
 * Packer — converte o result.json + screenshots de um run no laudo final:
 * HTML self-contained (prints embutidos base64), dark/light com switch.
 * Uso: node src/packer.mjs <run-dir>
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const runDir = process.argv[2];
if (!runDir || !existsSync(runDir)) die("uso: node src/packer.mjs <run-dir>");

const flowDirs = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const flows = [];

for (const dir of flowDirs) {
  const rf = join(runDir, dir, "result.json");
  if (!existsSync(rf)) continue;
  const r = JSON.parse(readFileSync(rf, "utf8"));
  const shots = [];
  for (const s of r.screenshots ?? []) {
    const p = join(runDir, dir, s);
    if (existsSync(p)) shots.push({ name: s, b64: readFileSync(p).toString("base64") });
  }
  flows.push({ ...r, dir, shots });
}

const passed = flows.filter((f) => f.verdict === "pass").length;
const failed = flows.length - passed;
const allPass = failed === 0;
const pct = Math.round((passed / Math.max(flows.length, 1)) * 100);

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stepRows(f) {
  return f.steps.map((s) => {
    let detail = s.detail ? `<span class="detail">${esc(s.detail)}</span>` : "";
    const shot = f.shots.find((sh) => sh.name === s.screenshot);
    if (shot) {
      detail = `<span class="detail">evidence: <a class="evlink" href="#shot-${esc(f.dir)}-${esc(shot.name.replace(".png", ""))}">${esc(shot.name)}</a></span>${detail}`;
    }
    const act = typeof s.step === "object" ? describeStep(s.step) : esc(s.step);
    return `<tr><td class="idx">STEP ${String(s.index).padStart(2, "0")}</td><td class="act">${act}${detail}</td><td class="st ${s.ok ? "ok" : "no"}">${s.ok ? "ok" : "FAIL"}</td></tr>`;
  }).join("\n");
}

function describeStep(step) {
  if (step.goto !== undefined) return `goto <code>${esc(step.goto)}</code>`;
  if (step.fill) return `fill <code>${esc(step.fill.selector)}</code>`;
  if (step.click) return `click <code>${esc(step.click)}</code>`;
  if (step.expectVisible) return `assert visible <code>${esc(step.expectVisible)}</code>`;
  if (step.expectUrl) return `assert url contains <code>${esc(step.expectUrl)}</code>`;
  if (step.wait) return `wait ${esc(step.wait)}ms`;
  return esc(JSON.stringify(step));
}

function gallery(f) {
  if (!f.shots.length) return "";
  const figs = f.shots.map((s) => `
    <figure id="shot-${esc(f.dir)}-${esc(s.name.replace(".png", ""))}">
      <img src="data:image/png;base64,${s.b64}" alt="${esc(s.name)}" loading="lazy">
      <figcaption><b>STEP</b> ${esc(s.name.replace("step-", "").replace(".png", ""))} · ${esc(f.name)}</figcaption>
    </figure>`).join("\n");
  return `<div class="subsec-label">Evidence · ${esc(f.name)}</div><div class="gallery single">${figs}</div>`;
}

const flowCards = flows.map((f) => {
  const badge = f.verdict === "pass" ? '<span class="badge pass">PASS</span>'
    : f.verdict === "warn" ? '<span class="badge warn">WARN</span>'
    : '<span class="badge fail">FAIL</span>';
  const analysis = f.analysis ? `
      <div class="analysis">
        <span class="tag">Root-cause analysis (BYOK)</span>
        <p><b>Cause:</b> ${esc(f.analysis.cause)}</p>
        <p><b>Bug:</b> ${f.analysis.isBug ?? "?"} · confidence ${f.analysis.confidence} — ${esc(f.analysis.suggestion)}</p>
      </div>` : "";
  return `
    <div class="flow">
      <div class="flow-head"><span class="name">${esc(f.name)}</span>${badge}</div>
      <table class="steps">${stepRows(f)}</table>
      ${f.consoleErrors?.length ? `<div class="cerr"><b>console errors:</b> ${f.consoleErrors.map((e) => `<code>${esc(e.slice(0, 140))}</code>`).join(" ")}</div>` : ""}
    </div>${gallery(f)}${analysis}`;
}).join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WitnessQA Report — ${flows.length} flows · ${allPass ? "PASSED" : "FAILED " + failed}</title>
<style>
  :root{
    --paper:#F4F1EA; --card:#FBF9F4; --ink:#17150F; --ink-soft:#5A5648;
    --rule:#C9C3B2; --pass:#0E6B3D; --pass-bg:#E7F0EA; --fail:#B3261E; --fail-bg:#F6E7E5;
    --warn:#8A6D1C; --warn-bg:#F4EDD8; --shadow:rgba(23,21,15,.9); --img-border:#17150F;
    --serif:Georgia,'Times New Roman',serif;
    --sans:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;
    --mono:ui-monospace,'Cascadia Mono',Consolas,Menlo,monospace;
  }
  [data-theme="dark"]{
    --paper:#141310; --card:#1D1B16; --ink:#EDE9DC; --ink-soft:#9B968A;
    --rule:#3A372E; --pass:#3FBF77; --pass-bg:#16281D; --fail:#E5544C; --fail-bg:#2C1512;
    --warn:#C9A83E; --warn-bg:#292214; --shadow:rgba(0,0,0,.6); --img-border:#000;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;transition:background .2s,color .2s}
  .topbar{background:var(--ink);color:var(--paper);font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;padding:7px 16px;display:flex;justify-content:center;position:relative}
  .theme-switch{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:1px solid currentColor;color:inherit;font-family:var(--mono);font-size:10px;letter-spacing:.08em;padding:3px 10px;cursor:pointer;text-transform:uppercase}
  .wrap{max-width:900px;margin:0 auto;padding:40px 24px 80px}
  header{border-bottom:3px double var(--ink);padding-bottom:24px;margin-bottom:34px}
  .stamp-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  h1{font-family:var(--serif);font-weight:400;font-size:clamp(28px,5vw,44px);line-height:1.08;margin-top:12px}
  .meta{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;font-family:var(--mono);font-size:11.5px;color:var(--ink-soft)}
  .meta b{color:var(--ink)}
  .stamp{font-family:var(--mono);font-weight:700;font-size:14px;letter-spacing:.16em;color:var(--pass);border:2.5px solid var(--pass);padding:8px 18px;transform:rotate(-2.5deg);white-space:nowrap}
  .stamp.fail{color:var(--fail);border-color:var(--fail)}
  .score{display:flex;height:13px;border:2px solid var(--ink);margin:24px 0 8px;overflow:hidden}
  .score .sp{background:var(--pass)}.score .sf{background:var(--fail)}
  .score-legend{display:flex;gap:16px;font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
  .dot{display:inline-block;width:8px;height:8px;margin-right:5px}.dot.p{background:var(--pass)}.dot.f{background:var(--fail)}
  section{margin-bottom:48px}
  .sec-label{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);margin-bottom:16px;display:flex;align-items:center;gap:12px}
  .sec-label::after{content:"";flex:1;height:1px;background:var(--rule)}
  .subsec-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);margin:26px 0 12px}
  .flow{border:2px solid var(--ink);background:var(--card);box-shadow:6px 6px 0 var(--shadow);margin-bottom:22px;break-inside:avoid}
  .flow-head{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:2px solid var(--ink)}
  .flow-head .name{font-family:var(--mono);font-weight:600;font-size:13.5px}
  .badge{font-family:var(--mono);font-weight:700;font-size:10.5px;letter-spacing:.12em;padding:4px 12px;border:2px solid}
  .badge.pass{color:var(--pass);border-color:var(--pass);background:var(--pass-bg)}
  .badge.fail{color:var(--fail);border-color:var(--fail);background:var(--fail-bg)}
  table.steps{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
  td{padding:9px 18px;border-bottom:1px solid var(--rule);vertical-align:top}
  tr:last-child td{border-bottom:0}
  td.idx{color:var(--ink-soft);white-space:nowrap;width:74px}
  td.act{word-break:break-all}
  code{font-family:var(--mono);font-size:11.5px;background:var(--paper);border:1px solid var(--rule);padding:1px 5px}
  .detail{color:var(--ink-soft);font-size:11px;display:block;margin-top:2px}
  a.evlink{color:var(--ink-soft)}
  td.st{white-space:nowrap;text-align:right;font-weight:700;width:60px}
  td.st.ok{color:var(--pass)} td.st.no{color:var(--fail)}
  .cerr{padding:10px 18px;border-top:1px solid var(--rule);font-size:11.5px;color:var(--ink-soft)}
  .cerr code{display:inline-block;margin:2px 4px 2px 0}
  .gallery.single figure{max-width:100%}
  .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
  figure{border:2px solid var(--img-border);background:#fff;margin:0;box-shadow:4px 4px 0 var(--shadow)}
  figure img{width:100%;display:block;border-bottom:2px solid var(--img-border)}
  figcaption{font-family:var(--mono);font-size:10px;padding:8px 11px;color:var(--ink-soft)}
  figcaption b{color:var(--ink)}
  .analysis{border-top:2px solid var(--ink);padding:14px 18px;font-size:13.5px}
  .analysis .tag{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);display:block;margin-bottom:6px}
  footer{margin-top:56px;padding-top:16px;border-top:2px solid var(--ink);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
  @media print{body{background:#fff}}
</style>
</head>
<body data-theme="light">
<div class="topbar">
  WitnessQA · Autonomous examination report
  <button class="theme-switch" onclick="document.body.dataset.theme = document.body.dataset.theme==='dark'?'light':'dark'">☾ / ☀</button>
</div>
<div class="wrap">
  <header>
    <div class="stamp-row">
      <div>
        <h1>Examination report</h1>
        <div class="meta">
          <span>Date <b>${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</b></span>
          <span>Flows <b>${flows.length}</b></span>
          <span>Evidence <b>${flows.reduce((n, f) => n + (f.shots?.length ?? 0), 0)} screenshots</b></span>
        </div>
      </div>
      <div class="stamp ${allPass ? "" : "fail"}">${allPass ? "PASSED" : "FAILED · " + failed}</div>
    </div>
    <div class="score"><div class="sp" style="width:${pct}%"></div><div class="sf" style="width:${100 - pct}%"></div></div>
    <div class="score-legend"><span><span class="dot p"></span>pass ${passed}</span><span><span class="dot f"></span>fail ${failed}</span></div>
  </header>

  <section>
    <div class="sec-label">§1 — Verdict per flow</div>
    ${flowCards}
  </section>

  <footer>
    <span>Executed locally · evidence embedded in this file</span>
    <span>WitnessQA — evidence, not promises.</span>
  </footer>
</div>
</body>
</html>`;

writeFileSync(join(runDir, "REPORT.html"), html);
const sizeKb = Math.round(html.length / 1024);
console.log(`✓ REPORT.html gerado (${sizeKb} KB, prints embutidos, dark mode incluso)`);

function die(m) { console.error(`✗ ${m}`); process.exit(1); }
