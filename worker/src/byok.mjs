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

export function byokConfigured() {
  return Boolean(process.env.WITNESS_KEY);
}

/**
 * Analisa uma falha: recebe result do executor + snippets de evidência,
 * devolve { cause, isBug, confidence, suggestion } ou null se BYOK off.
 */
export async function investigateFailure(result, evidenceDir) {
  if (!byokConfigured()) return null;

  const consoleTail = (result.consoleErrors ?? []).slice(-5);
  const failingStep = result.steps.find((s) => !s.ok);

  // HTML snippet da página no momento do print da falha (se existir dump)
  let htmlSnippet = "";
  try {
    htmlSnippet = readFileSync(`${evidenceDir}/page.html`, "utf8").slice(0, 3000);
  } catch {
    /* opcional */
  }

  const prompt = `Você é um engenheiro de QA sênior. Um agente automatizado testou um fluxo web e falhou.

Fluxo: ${result.name}
Step que falhou (${failingStep?.index ?? "?"}): ${JSON.stringify(failingStep?.step)}
Detalhe: ${failingStep?.detail ?? result.failure?.message ?? "n/a"}

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
    const res = await fetch(`${process.env.WITNESS_BASE ?? "https://openrouter.ai/api/v1"}/chat/completions`, {
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
    return JSON.parse(json);
  } catch (err) {
    return { cause: `(BYOK falhou: ${String(err).split("\n")[0].slice(0, 120)})`, isBug: null, confidence: 0, suggestion: "" };
  }
}
