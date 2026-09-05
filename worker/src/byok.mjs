/**
 * BYOK — investigação de causa via LLM do próprio usuário.
 *
 * Configuração (nenhuma chave nossa envolvida):
 *   WITNESS_KEY   = chave do provider (OpenRouter, OpenAI, etc.)
 *   WITNESS_BASE  = base URL da API compatível OpenAI (default: https://openrouter.ai/api/v1)
 *   WITNESS_MODEL = modelo (default: openai/gpt-4o-mini)
 *
 * Sem WITNESS_KEY o worker funciona normal, só sem a análise de causa.
 */
import { readFileSync } from "node:fs";
import { createEvidenceGuard } from "./privacy.mjs";

export function byokConfigured() {
  return Boolean(process.env.WITNESS_KEY);
}

/**
 * Analisa uma falha: recebe result do executor + snippets de evidência,
 * devolve { cause, isBug, confidence, suggestion } ou null se BYOK off.
 */
export async function investigateFailure(result, evidenceDir, { fetchImpl = globalThis.fetch, guard = createEvidenceGuard() } = {}) {
  if (!byokConfigured()) return null;

  const safeResult = guard.redact(result);
  const consoleTail = (safeResult.consoleErrors ?? []).slice(-5);
  const failingStep = safeResult.steps.find((s) => !s.ok);

  let htmlSnippet = "";
  if (process.env.WITNESS_BYOK_INCLUDE_HTML === "true") {
    try {
      htmlSnippet = guard.sanitizeHtml(readFileSync(`${evidenceDir}/page.html`, "utf8")).slice(0, 3000);
    } catch {
      /* opt-in e opcional */
    }
  }

  const prompt = `Você é um engenheiro de QA sênior. Um agente automatizado testou um fluxo web e falhou.

Fluxo: ${safeResult.name}
Step que falhou (${failingStep?.index ?? "?"}): ${JSON.stringify(failingStep?.step)}
Detalhe: ${failingStep?.detail ?? safeResult.failure?.message ?? "n/a"}

Console errors recentes:
${consoleTail.map((e) => `- ${e}`).join("\n") || "(nenhum)"}
${htmlSnippet ? `\nHTML no momento da falha (trecho):\n${htmlSnippet}` : ""}

Responda EM JSON puro (sem markdown):
{
  "cause": "explicação em 1-2 frases do que provavelmente aconteceu",
  "isBug": true|false,           // true = bug do app; false = cenário/seletor desatualizado
  "confidence": 0.0-1.0,
  "suggestion": "o que o time deve fazer (1 frase)"
}`;

  try {
    const base = new URL(process.env.WITNESS_BASE ?? "https://openrouter.ai/api/v1");
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
      return { cause: "(BYOK recusou endpoint sem HTTPS)", isBug: null, confidence: 0, suggestion: "" };
    }
    const res = await fetchImpl(`${base.toString().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WITNESS_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.WITNESS_MODEL ?? "openai/gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { cause: `(BYOK: provider respondeu ${res.status})`, isBug: null, confidence: 0, suggestion: "" };
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    return guard.redact({
      cause: String(parsed.cause ?? "").slice(0, 600),
      isBug: typeof parsed.isBug === "boolean" ? parsed.isBug : null,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0,
      suggestion: String(parsed.suggestion ?? "").slice(0, 400),
    });
  } catch (err) {
    return guard.redact({ cause: `(BYOK falhou: ${String(err).split("\n")[0].slice(0, 120)})`, isBug: null, confidence: 0, suggestion: "" });
  }
}
