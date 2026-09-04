/**
 * Classificação de veredito de um fluxo.
 * Separado do packer para ser testável e compartilhado com o worker.
 *
 *   pass    — todos os steps ok
 *   warn    — fluxo passou, mas há ruído (console/network)
 *   skip    — falha esperada (login com sessão já ativa)
 *   blocked — o testemunha caiu (crash do Chromium, timeout de infra)
 *   fail    — o app não fez o que o cenário pedia
 */

const CRASH_RE = /Target crashed|Target closed|Target page, context or browser has been closed|Protocol error|browser has been closed|Page crashed|net::ERR_CONNECTION_REFUSED|net::ERR_NAME_NOT_RESOLVED/i;
const TIMEOUT_RE = /TimeoutError|Timeout \d+ms exceeded/i;
const NOISE_MSG = /Minified React error #418|Hydration failed|Did not expect server HTML|text content does not match server-rendered HTML|Download the React DevTools/i;
const NOISE_NET = /[?&]_rsc=|\/_next\/data|hot-update|\.map(\?|$)|favicon/i;

export function isNoiseMessage(s) {
  return NOISE_MSG.test(String(s ?? ""));
}

export function isNoiseNetwork(s) {
  const t = String(s ?? "");
  if (NOISE_NET.test(t)) return true;
  if (/ERR_ABORTED/i.test(t) && /(_rsc=|_next\/)/i.test(t)) return true;
  return false;
}

export function cleanErrors(list) {
  return (list ?? []).filter((e) => !isNoiseMessage(e) && !isNoiseNetwork(e));
}

export function isCrashDetail(detail) {
  return CRASH_RE.test(String(detail ?? ""));
}

export function classifyFlow(f) {
  const details = [
    f.failure?.message,
    f.failure?.detail,
    f.failure?.type,
    ...(f.steps ?? []).map((s) => s.detail),
  ]
    .filter(Boolean)
    .join("\n");

  if (f.verdict === "blocked" || isCrashDetail(details)) return "blocked";
  if (f.verdict === "warn") return "warn";
  if (f.verdict !== "fail") return f.verdict === "pass" ? "pass" : "pass";

  const isAuthRedirect =
    /login|signin|access/i.test(f.name ?? "") &&
    (f.steps ?? []).some((s) => !s.ok && TIMEOUT_RE.test(s.detail || "")) &&
    f.steps?.[0]?.ok === true;
  if (isAuthRedirect) return "skip";

  return "fail";
}

export function summarize(flows) {
  const counts = { pass: 0, warn: 0, skip: 0, blocked: 0, fail: 0 };
  for (const f of flows) {
    const status = f.status ?? classifyFlow(f);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const realFails = counts.fail;
  const blocked = counts.blocked;
  const allPass = realFails === 0 && blocked === 0;
  let stamp = "PASS";
  if (realFails > 0) stamp = "FAIL";
  else if (blocked > 0) stamp = "BLOCKED";
  else if (counts.warn > 0) stamp = "WARN";
  return { counts, realFails, blocked, allPass, stamp };
}

/** Descrição humana genérica — não hardcoded em um cliente. */
export function describeFlow(f) {
  if (f.what) return f.what;
  const firstGoto = (f.steps ?? []).find((s) => s.step?.goto)?.step.goto;
  if (!firstGoto) return f.name ?? "";
  try {
    const u = new URL(firstGoto, "https://app.local");
    const p = u.pathname.replace(/\/+$/, "") || "/";
    const last = p.split("/").filter(Boolean).pop();
    if (p === "/") return "valida a tela inicial";
    if (/login|signin|access/i.test(p)) return "valida o formulário de autenticação";
    return `valida ${last.replace(/[-_]/g, " ")} (${p})`;
  } catch {
    return f.name ?? "";
  }
}

export function firstGoto(f) {
  return (f.steps ?? []).find((s) => s.step?.goto)?.step.goto
    ?? (f.steps ?? []).find((s) => s.goto)?.goto
    ?? "";
}

/** Título curto pra índice/cartão — heading da tela, não slug com UUID. */
export function displayTitle(f) {
  const what = String(f.what ?? "");
  const quoted = what.match(/valida\s+"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1].trim();
  const firstGotoUrl = firstGoto(f);
  if (firstGotoUrl) {
    try {
      const u = new URL(firstGotoUrl, "https://app.local");
      const segs = u.pathname.split("/").filter(Boolean).filter((s) => !isId(s));
      if (segs.length) return titleCase(segs.slice(-2).join(" / "));
      if (u.pathname === "/" || u.pathname === "") return "Início";
    } catch { /* */ }
  }
  return String(f.name ?? "fluxo")
    .replace(/^cover[-_]?/i, "")
    .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, "")
    .replace(/[-_]+/g, " ")
    .trim() || "fluxo";
}

export function displayGroup(f) {
  const url = firstGoto(f);
  try {
    const host = new URL(url, "https://app.local").hostname;
    const head = host.split(".")[0];
    if (/admin|cliente|superadmin|app|www/i.test(head) && head !== "www") {
      return titleCase(head);
    }
    return host || "App";
  } catch {
    const n = String(f.name ?? "");
    if (/cliente|client/i.test(n)) return "Cliente";
    if (/super/i.test(n)) return "Superadmin";
    if (/admin/i.test(n)) return "Admin";
    return "App";
  }
}

export function displayPath(f) {
  const url = firstGoto(f);
  try {
    const u = new URL(url, "https://app.local");
    return u.pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

function isId(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /^[0-9a-f]{8}$/i.test(s);
}

function titleCase(s) {
  return String(s)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function expandEnv(value, env = process.env, { required = false } = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => {
    if (env[name] !== undefined) return env[name];
    if (required) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
    return `$${name}`;
  });
}

export function normalizeExpectText(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return { text: raw, selector: "body" };
  if (typeof raw === "object" && raw.text) return { text: raw.text, selector: raw.selector ?? "body" };
  return null;
}
