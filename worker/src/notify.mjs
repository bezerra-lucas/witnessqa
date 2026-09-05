/**
 * Alerta de veredito (Discord / Slack / GitHub).
 * Sem URL configurada, não faz nada.
 *
 *   WITNESS_DISCORD_WEBHOOK
 *   WITNESS_SLACK_WEBHOOK
 *   GH_TOKEN + WITNESS_GH_PR  → comentário no PR
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFlow, summarize, displayTitle } from "./classify.mjs";
import { createEvidenceGuard } from "./privacy.mjs";

export function loadRunSummary(runDir) {
  const guard = createEvidenceGuard();
  const flows = [];
  if (!runDir || !existsSync(runDir)) return { flows, stamp: "EMPTY", counts: {} };
  for (const name of readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const rf = join(runDir, name, "result.json");
    if (!existsSync(rf)) continue;
    const r = guard.redact(JSON.parse(readFileSync(rf, "utf8")));
    const status = classifyFlow(r);
    flows.push({ ...r, status, title: displayTitle(r) });
  }
  return { flows, ...summarize(flows) };
}

export function formatSummary(s, { url } = {}) {
  const guard = createEvidenceGuard();
  const c = s.counts ?? {};
  const fails = (s.flows ?? []).filter((f) => f.status === "fail").slice(0, 8);
  const lines = [
    `**WitnessQA · ${s.stamp}**`,
    `${c.pass ?? 0} pass · ${c.fail ?? 0} fail · ${c.warn ?? 0} warn · ${c.blocked ?? 0} blocked · ${c.skip ?? 0} skip`,
  ];
  if (url) lines.push(guard.redactText(url));
  if (fails.length) {
    lines.push("", "Falhas:");
    for (const f of fails) lines.push(`- ${guard.redactText(f.title)}`);
  }
  return lines.join("\n");
}

export async function notifyRun(runDir, { url } = {}) {
  const s = loadRunSummary(runDir);
  const text = formatSummary(s, { url });
  const sent = [];
  const discord = process.env.WITNESS_DISCORD_WEBHOOK;
  const slack = process.env.WITNESS_SLACK_WEBHOOK;
  if (discord) {
    await postJson(discord, { content: text.slice(0, 1900) });
    sent.push("discord");
  }
  if (slack) {
    await postJson(slack, { text });
    sent.push("slack");
  }
  const pr = process.env.WITNESS_GH_PR || process.env.GITHUB_PR_NUMBER;
  if (process.env.GH_TOKEN && pr) {
    sent.push("github");
  }
  return { sent, stamp: s.stamp, text };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

const isCli = process.argv[1] && /notify\.mjs$/.test(String(process.argv[1]).replace(/\\/g, "/"));
if (isCli) {
  const dir = process.argv[2];
  const r = await notifyRun(dir, { url: process.argv[3] });
  console.log(`notify ${r.stamp} → ${r.sent.join(",") || "(nenhum webhook)"}`);
}
