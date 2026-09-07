/**
 * Executor de um cenário: abre o browser, roda steps, captura evidências.
 *
 * Lições dos laudos v3 (admin-02 Target crashed):
 *   - screenshot fullPage em dashboard pesado derruba o Chromium
 *   - wait longo + textContent depois do crash vira FAIL sem causa
 *   - page.html não era dumpado → BYOK sem contexto
 *   - expectText string vs objeto
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser } from "./browser.mjs";
import { expandEnv, isCrashDetail, normalizeExpectText, isNoiseMessage, isNoiseNetwork } from "./classify.mjs";
import { createEvidenceGuard, PRIVACY_VERSION } from "./privacy.mjs";

const NOISE_CONSOLE = /Failed to load resource:.*(favicon|hot-update|\.map|status of 404)|Download the React DevTools|third-party cookie will be blocked/i;

export async function runScenario(scenario, { evidenceDir, baseUrl, viewport, authFile, headed } = {}) {
  mkdirSync(evidenceDir, { recursive: true });
  const guard = createEvidenceGuard({ scenario });
  const vp = scenario.viewport ?? viewport ?? { width: 1440, height: 950 };
  const auth = scenario.auth ?? authFile;
  const appBase = scenario.app ?? baseUrl ?? "";

  const result = {
    name: scenario.name,
    ...(scenario.flow !== undefined ? { flow: scenario.flow } : {}),
    ...(scenario.testId !== undefined ? { testId: scenario.testId } : {}),
    ...(scenario.title !== undefined ? { title: scenario.title } : {}),
    app: appBase,
    viewport: vp,
    browser: 'chromium',
    expectedStatus: 'pass',
    what: scenario.what ?? "",
    verdict: "pass",
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    networkErrors: [],
    brokenImages: [],
    screenshots: [],
    evidenceMetadata: [],
    failure: null,
    privacyVersion: PRIVACY_VERSION,
    startedAt: new Date().toISOString(),
  };

  let browser;
  try {
    browser = await launchBrowser({ headless: headed !== true });
  } catch (err) {
    result.verdict = "blocked";
    result.failure = guard.redact({ type: "browser", message: String(err).slice(0, 400) });
    result.finishedAt = new Date().toISOString();
    return guard.writeJson(join(evidenceDir, "result.json"), result);
  }

  const contextOpts = { viewport: vp };
  if (auth && existsSync(auth)) contextOpts.storageState = auth;
  const context = await browser.newContext(contextOpts);
  let page = await context.newPage();

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    const loc = m.location()?.url ?? "";
    if (NOISE_CONSOLE.test(t) || isNoiseMessage(t) || /favicon|\.map(\?|$)|hot-update/.test(loc + " " + t)) return;
    result.consoleErrors.push(guard.redactText(t));
  });
  page.on("pageerror", (e) => {
    const t = String(e);
    if (isNoiseMessage(t)) return;
    result.pageErrors.push(guard.redactText(t));
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const line = `${req.failure()?.errorText ?? "failed"} ${url}`.slice(0, 240);
    if (isNoiseNetwork(line) || /favicon|hot-update|\.map(\?|$)/.test(url)) return;
    result.networkErrors.push(guard.redactText(line));
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const url = res.url();
    const line = `${res.status()} ${url}`.slice(0, 240);
    if (isNoiseNetwork(line) || /favicon|hot-update|\.map(\?|$)/.test(url)) return;
    result.networkErrors.push(guard.redactText(line));
  });

  try {
    for (const [i, step] of scenario.steps.entries()) {
      if (page.isClosed()) {
        page = await context.newPage();
      }
      const entry = await runStep(page, step, i, { evidenceDir, baseUrl: appBase, result, guard });
      result.steps.push(entry);
      if (!entry.ok) {
        result.verdict = isCrashDetail(entry.detail) ? "blocked" : "fail";
        result.failure = guard.redact({ stepIndex: i, step, detail: entry.detail, type: result.verdict === "blocked" ? "crash" : "step" });
        await dumpPage(page, evidenceDir, guard);
        break;
      }
    }

    if (result.verdict === "pass") {
      result.brokenImages = guard.redact(await findBrokenImages(page));
      if (scenario.checks?.includes("noBrokenImages") && result.brokenImages.length) {
        result.verdict = "fail";
        result.failure = { type: "brokenImages", images: result.brokenImages };
      }
      if (scenario.checks?.includes("noConsoleErrors") && result.consoleErrors.length && !result.failure) {
        result.verdict = "warn";
        result.failure = { type: "consoleErrors", errors: result.consoleErrors.slice(0, 5) };
      }
      await dumpPage(page, evidenceDir, guard);
    }
  } catch (err) {
    result.verdict = isCrashDetail(err) ? "blocked" : "blocked";
    result.failure = guard.redact({ type: "exception", message: String(err).slice(0, 500) });
    await safeShot(page, join(evidenceDir, "crash-step.png"), guard);
    await dumpPage(page, evidenceDir, guard);
  } finally {
    await browser.close().catch(() => {});
    result.finishedAt = new Date().toISOString();
  }

  return guard.writeJson(join(evidenceDir, "result.json"), result);
}

async function runStep(page, step, index, { evidenceDir, baseUrl, result, guard }) {
  const entry = { index, step: guard.redact(step), ok: true, detail: "" };
  const shotName = `step-${String(index).padStart(2, "0")}.png`;
  try {
    if (page.isClosed()) throw new Error("Target closed: page was closed before step");

    if (step.goto !== undefined) {
      const url = resolveUrl(step.goto, baseUrl);
      await gotoResilient(page, url);
      await dismissOverlays(page);
    } else if (step.fill) {
      const selector = step.fill.selector ?? step.fill[0];
      const value = expandEnv(step.fill.value ?? step.fill[1] ?? "", process.env, { required: true });
      try {
        await page.fill(selector, value, { timeout: 10_000 });
      } catch (err) {
        if (await leftAuthSurface(page, step)) {
          entry.skipped = true;
          entry.detail = "sessão já autenticada — campo de login não existe (redirect)";
        } else {
          throw err;
        }
      }
    } else if (step.click) {
      try {
        await clickSmart(page, step.click);
        await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});
      } catch (err) {
        if (await leftAuthSurface(page, step)) {
          entry.skipped = true;
          entry.detail = "sessão já autenticada — botão de login não existe (redirect)";
        } else {
          throw err;
        }
      }
    } else if (step.expectUrl) {
      const want = step.expectUrl;
      const cur = page.url();
      if (!cur.includes(want)) {
        entry.ok = false;
        entry.detail = `esperava URL contendo "${want}", atual: ${cur}`;
      }
    } else if (step.expectVisible) {
      try {
        await page.waitForSelector(step.expectVisible, { timeout: 8_000, state: "visible" });
      } catch {
        entry.ok = false;
        entry.detail = `seletor visível não encontrado: ${step.expectVisible}`;
      }
    } else if (step.wait) {
      const ms = Math.min(Number(step.wait) || 1000, 15_000);
      await page.waitForTimeout(ms);
    } else if (step.expectText !== undefined) {
      const spec = normalizeExpectText(step.expectText);
      if (!spec) {
        entry.ok = false;
        entry.detail = `expectText inválido: ${JSON.stringify(step.expectText)}`;
      } else {
        const body = await page.textContent(spec.selector, { timeout: 8_000 });
        if (!body?.includes(spec.text)) {
          entry.ok = false;
          entry.detail = `texto "${spec.text}" não encontrado em ${spec.selector}`;
        }
      }
    } else if (step.expectNoText !== undefined) {
      const spec = normalizeExpectText(step.expectNoText);
      if (!spec) {
        entry.ok = false;
        entry.detail = `expectNoText inválido: ${JSON.stringify(step.expectNoText)}`;
      } else {
        const visible = await page.evaluate((text) => {
          const hit = [...document.querySelectorAll("body *")].find((el) => {
            if (el.children.length > 3) return false;
            const t = (el.innerText || "").trim();
            if (!t || t.length > 400) return false;
            if (!t.includes(text)) return false;
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          return Boolean(hit);
        }, spec.text);
        if (visible) {
          entry.ok = false;
          entry.detail = `texto proibido visível: "${spec.text}"`;
        }
      }
    } else {
      entry.ok = false;
      entry.detail = `ação desconhecida: ${JSON.stringify(Object.keys(step))}`;
    }
  } catch (err) {
    entry.ok = false;
    entry.detail = guard.redactText(String(err).split("\n")[0].slice(0, 300));
  }

  if (await safeShot(page, join(evidenceDir, shotName), guard)) {
    entry.screenshot = shotName;
    result.screenshots.push(shotName);
    result.evidenceMetadata.push(guard.redact({ file: shotName, stepIndex: index,
      capturedAt: new Date().toISOString(), label: step.evidence?.label || '',
      highlight: step.evidence?.highlight === true }));
  }
  return entry;
}

function resolveUrl(target, baseUrl) {
  if (typeof target !== "string") return String(target);
  if (/^https?:\/\//i.test(target)) return target;
  if (!baseUrl) return target;
  return `${String(baseUrl).replace(/\/$/, "")}${target.startsWith("/") ? target : `/${target}`}`;
}

async function clickSmart(page, spec) {
  if (typeof spec === "string") {
    await page.click(spec, { timeout: 10_000 });
    return;
  }
  if (spec?.text) {
    await page.getByRole("button", { name: spec.text }).first().click({ timeout: 6_000 }).catch(async () => {
      await page.getByText(spec.text, { exact: false }).first().click({ timeout: 6_000 });
    });
    return;
  }
  if (spec?.selector) {
    await page.click(spec.selector, { timeout: 10_000 });
    return;
  }
  throw new Error(`click inválido: ${JSON.stringify(spec)}`);
}

async function dismissOverlays(page) {
  const sels = [
    "#axeptio_btn_acceptAll",
    "#onetrust-accept-btn-handler",
    'button:has-text("Aceitar todos")',
    'button:has-text("Aceitar")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    '[aria-label="Close"]',
    'button:has-text("Fechar")',
  ];
  for (const s of sels) {
    try {
      const loc = page.locator(s).first();
      if (await loc.isVisible({ timeout: 400 })) {
        await loc.click({ timeout: 800 });
        return;
      }
    } catch {
      /* próximo */
    }
  }
}

async function leftAuthSurface(page, step) {
  if (page.isClosed()) return false;
  const url = page.url();
  // Presentation metadata must not change whether an action succeeded or was
  // skipped. Inspect only the executable action, never evidence labels/titles.
  const action = step?.fill ? { fill: step.fill } : { click: step?.click };
  const looksLikeAuthStep = /login|signin|email|password|senha/i.test(
    JSON.stringify(action) + url,
  );
  if (!looksLikeAuthStep) return false;
  return !/login|signin|access|entrar/i.test(url);
}

async function gotoResilient(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (err) {
    if (isCrashDetail(err)) throw err;
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

async function findBrokenImages(page) {
  if (page.isClosed()) return [];
  try {
    await page.evaluate(() =>
      Promise.all(
        [...document.images].map(
          (img) =>
            img.complete ||
            new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
              setTimeout(r, 4000);
            }),
        ),
      ),
    );
    const candidates = await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.naturalWidth === 0 && img.src && !img.src.startsWith("data:"))
        .map((img) => img.currentSrc || img.src),
    );
    const broken = [];
    for (const src of [...new Set(candidates)].slice(0, 12)) {
      try {
        const res = await page.request.get(src, { timeout: 8000 });
        if (res.status() >= 400) broken.push(src);
      } catch {
        broken.push(src);
      }
    }
    return broken;
  } catch {
    return [];
  }
}

async function dumpPage(page, evidenceDir, guard) {
  if (!page || page.isClosed()) return;
  await guard.captureHtml(page, join(evidenceDir, "page.html"));
  guard.writeText(join(evidenceDir, "url.txt"), page.url());
}

async function safeShot(page, path, guard) {
  if (!page || page.isClosed()) return false;
  return guard.captureScreenshot(page, path, { fullPage: false, timeout: 8_000 });
}
