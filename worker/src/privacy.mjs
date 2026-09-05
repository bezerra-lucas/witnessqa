import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

export const PRIVACY_VERSION = 1;
export const REDACTED = "[REDACTED]";

const DEFAULT_MASK_SELECTORS = [
  "input",
  "textarea",
  "select",
  "iframe",
  "[contenteditable]",
  "[data-witness-redact]",
  "[data-sensitive]",
  "[data-private]",
  "[data-pii]",
];

const SENSITIVE_KEY = /(?:^|_)(?:access_token|api_key|authorization|cookie|credential|email|key|login|pass|password|refresh_token|secret|senha|session|session_id|token|username|user)(?:$|_)/i;
const SENSITIVE_QUERY = /^(?:access[_-]?token|api[_-]?key|authorization|code|credential|email|key|password|refresh[_-]?token|secret|senha|session|session[_-]?id|token|username|user)$/i;

export function preparePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function securePrivateFile(path) {
  chmodSync(path, 0o600);
}

export function createEvidenceGuard({ scenario = {}, env = process.env, additionalSecrets = [] } = {}) {
  const secrets = collectSecrets(scenario, env, additionalSecrets);
  const selectors = [
    ...DEFAULT_MASK_SELECTORS,
    ...collectFillSelectors(scenario),
    ...(Array.isArray(scenario.redaction?.selectors) ? scenario.redaction.selectors : []),
  ].filter((value, index, all) => typeof value === "string" && value.trim() && all.indexOf(value) === index);

  function redactText(value) {
    if (typeof value !== "string") return value;
    let safe = maybeSanitizeUrl(value);
    for (const secret of secrets) safe = safe.split(secret).join(REDACTED);
    safe = safe
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g, REDACTED)
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
      .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, REDACTED)
      .replace(/(?<!\d)(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]\d{4}(?!\d)/g, REDACTED)
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, REDACTED)
      .replace(/((?:access[_-]?token|api[_-]?key|authorization|cookie|credential|email|password|refresh[_-]?token|secret|senha|session(?:[_-]?id)?|token|username)\s*[=:]\s*)(?!\[REDACTED\])[^\s,;"'&}]+/gi, `$1${REDACTED}`)
      .replace(/([?&](?:access[_-]?token|api[_-]?key|authorization|code|credential|email|key|password|refresh[_-]?token|secret|senha|session(?:[_-]?id)?|token|username|user)=)[^&#\s]*/gi, `$1${encodeURIComponent(REDACTED)}`);
    return safe;
  }

  function redact(value, parentKey = "") {
    if (typeof value === "string") return redactText(value);
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => redact(item, parentKey));

    const safe = {};
    for (const [key, item] of Object.entries(value)) {
      const safeKey = redactText(key);
      if (key === "fill") {
        safe[safeKey] = redactFill(item);
      } else if (isSensitiveKey(key)) {
        safe[safeKey] = REDACTED;
      } else {
        safe[safeKey] = redact(item, key);
      }
    }
    return safe;
  }

  function redactFill(fill) {
    if (Array.isArray(fill)) return fill.map((item, index) => index === 1 ? REDACTED : redact(item));
    if (!fill || typeof fill !== "object") return REDACTED;
    return Object.fromEntries(Object.entries(fill).map(([key, value]) => [key, key === "value" ? REDACTED : redact(value, key)]));
  }

  function sanitizeHtml(html) {
    let safe = String(html ?? "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script data-witness-redacted></script>')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '<iframe data-witness-redacted></iframe>')
      .replace(/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi, `<textarea$1>${REDACTED}</textarea>`)
      .replace(/<input\b[^>]*>/gi, (tag) => {
        if (/\svalue\s*=/.test(tag)) {
          return tag.replace(/(\svalue\s*=\s*)(["'])[^"']*\2/gi, `$1$2${REDACTED}$2`);
        }
        return tag.replace(/\s*\/?\s*>$/, ` value="${REDACTED}">`);
      })
      .replace(/<([a-z][\w:-]*)\b([^>]*\bdata-witness-redact(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*)>[\s\S]*?<\/\1>/gi,
        `<$1$2 data-witness-redacted>${REDACTED}</$1>`);
    safe = redactText(safe);
    return safe;
  }

  function writeJson(path, value) {
    const safe = redact(value);
    const versioned = Array.isArray(safe) ? { privacyVersion: PRIVACY_VERSION, items: safe } : { ...safe, privacyVersion: PRIVACY_VERSION };
    writeFileSync(path, JSON.stringify(versioned, null, 2));
    return versioned;
  }

  function writeText(path, value) {
    const safe = redactText(String(value ?? ""));
    writeFileSync(path, safe);
    return safe;
  }

  async function captureHtml(page, path) {
    try {
      const html = await page.evaluate(({ selectors, redacted }) => {
        const root = document.documentElement.cloneNode(true);
        for (const script of root.querySelectorAll("script")) {
          script.textContent = "";
          script.setAttribute("data-witness-redacted", "");
        }
        for (const field of root.querySelectorAll("input, textarea, select")) {
          if (field.matches("input")) field.setAttribute("value", redacted);
          else field.textContent = redacted;
        }
        for (const selector of selectors) {
          for (const element of root.querySelectorAll(selector)) {
            if (!element.matches("input, textarea, select")) element.textContent = redacted;
            element.setAttribute("data-witness-redacted", "");
          }
        }
        return `<!DOCTYPE html>\n${root.outerHTML}`;
      }, { selectors, redacted: REDACTED });
      writeFileSync(path, sanitizeHtml(html));
      return true;
    } catch {
      rmSync(path, { force: true });
      return false;
    }
  }

  async function captureScreenshot(page, path, options = {}) {
    try {
      const mask = selectors.map((selector) => page.locator(selector));
      for (const secret of secrets) mask.push(page.getByText(secret, { exact: false }));
      await page.screenshot({ ...options, path, mask, maskColor: "#000000" });
      return true;
    } catch {
      rmSync(path, { force: true });
      return false;
    }
  }

  return {
    privacyVersion: PRIVACY_VERSION,
    redact,
    redactText,
    sanitizeHtml,
    writeJson,
    writeText,
    captureHtml,
    captureScreenshot,
  };
}

function isSensitiveKey(key) {
  const normalized = String(key)
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
  return SENSITIVE_KEY.test(normalized);
}

function collectFillSelectors(scenario) {
  return (scenario.steps ?? []).flatMap((step) => {
    const selector = step.fill?.selector ?? step.fill?.[0];
    return typeof selector === "string" ? [selector] : [];
  });
}

function collectSecrets(scenario, env, additionalSecrets) {
  const values = [...additionalSecrets];
  for (const step of scenario.steps ?? []) {
    const raw = step.fill?.value ?? step.fill?.[1];
    if (typeof raw !== "string") continue;
    const resolved = raw.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) => env[name] ?? match);
    if (!/^\$[A-Z_][A-Z0-9_]*$/.test(resolved)) values.push(resolved);
  }
  for (const [name, value] of Object.entries(env ?? {})) {
    if (/^WITNESS_REDACT_/i.test(name) && typeof value === "string") values.push(value);
  }
  return [...new Set(values.filter((value) => typeof value === "string" && value.length >= 4))]
    .sort((a, b) => b.length - a.length);
}

function maybeSanitizeUrl(value) {
  if (!/^https?:\/\/[^\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const name of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(name)) url.searchParams.set(name, REDACTED);
    }
    if (url.hash && /token|secret|password|senha|auth|session/i.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
