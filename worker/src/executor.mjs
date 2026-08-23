/**
 * Executor de um cenário: abre o browser, roda steps, captura evidências.
 * Padrão de evidência herdado dos cenários QA do domod:
 *   screenshot por step + checks (broken images, console errors, geometry).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

export async function runScenario(scenario, { evidenceDir, baseUrl, viewport, authFile }) {
  mkdirSync(evidenceDir, { recursive: true });
  const vp = scenario.viewport ?? viewport ?? { width: 1440, height: 950 };
  const auth = scenario.auth ?? authFile;

  const result = {
    name: scenario.name,
    verdict: "pass",
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    brokenImages: [],
    screenshots: [],
    failure: null,
    startedAt: new Date().toISOString(),
  };

  const browser = await chromium.launch({ headless: true });
  const contextOpts = { viewport: vp };
  if (auth && existsSync(auth)) contextOpts.storageState = auth;
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") result.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => result.pageErrors.push(String(e)));

  try {
    for (const [i, step] of scenario.steps.entries()) {
      const entry = await runStep(page, step, i, { evidenceDir, baseUrl, result });
      result.steps.push(entry);
      if (!entry.ok) {
        result.verdict = "fail";
        result.failure = { stepIndex: i, step, detail: entry.detail };
        break;
      }
    }

    if (result.verdict === "pass") {
      // pós-checks globais (padrão domod)
      result.brokenImages = await findBrokenImages(page);
      if (scenario.checks?.includes("noBrokenImages") && result.brokenImages.length) {
        result.verdict = "fail";
        result.failure = { type: "brokenImages", images: result.brokenImages };
      }
      if (
        scenario.checks?.includes("noConsoleErrors") &&
        result.consoleErrors.length &&
        !result.failure
      ) {
        result.verdict = "warn"; // erro de console sozinho não reprova, sinaliza
        result.failure = { type: "consoleErrors", errors: result.consoleErrors.slice(0, 5) };
      }
    }
  } catch (err) {
    result.verdict = "blocked";
    result.failure = { type: "exception", message: String(err).slice(0, 500) };
    await safeShot(page, join(evidenceDir, `crash-step.png`), result);
  } finally {
    await browser.close();
    result.finishedAt = new Date().toISOString();
  }

  writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2));
  return result;
}

async function runStep(page, step, index, { evidenceDir, baseUrl, result }) {
  const entry = { index, step, ok: true, detail: "" };
  const shotName = `step-${String(index).padStart(2, "0")}.png`;
  try {
    if (step.goto !== undefined) {
      const url = step.goto.startsWith("http") ? step.goto : `${baseUrl}${step.goto}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } else if (step.fill) {
      await page.fill(step.fill.selector, step.fill.value, { timeout: 10_000 });
    } else if (step.click) {
      await page.click(step.click, { timeout: 10_000 });
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
      await page.waitForTimeout(Number(step.wait) || 1000);
    } else if (step.expectText) {
      const { text, selector } = step.expectText;
      const body = await page.textContent(selector ?? "body", { timeout: 8_000 });
      if (!body?.includes(text)) {
        entry.ok = false;
        entry.detail = `texto "${text}" não encontrado em ${selector ?? "body"}`;
      }
    } else {
      entry.ok = false;
      entry.detail = `ação desconhecida: ${JSON.stringify(Object.keys(step))}`;
    }
  } catch (err) {
    entry.ok = false;
    entry.detail = String(err).split("\n")[0].slice(0, 300);
  }

  await safeShot(page, join(evidenceDir, shotName), result);
  entry.screenshot = shotName;
  result.screenshots.push(shotName);
  return entry;
}

async function findBrokenImages(page) {
  try {
    return await page.evaluate(() =>
      Array.from(document.images)
        .filter((img) => img.naturalWidth === 0 && img.src)
        .map((img) => img.currentSrc || img.src),
    );
  } catch {
    return [];
  }
}

async function safeShot(page, path, result) {
  try {
    await page.screenshot({ path, fullPage: true });
  } catch {
    /* página pode ter crashado — segue */
  }
}
