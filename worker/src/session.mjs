/**
 * Sessão persistente: salva storageState do Playwright pra o explorer
 * (e cenários) rodarem logados sem repetir login a cada run.
 *
 * Uso: node src/session.mjs <cenário-login.yaml>
 * Credenciais: use $ENV_VARS no `value` dos steps de fill — expandidas daqui.
 */
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import YAML from "yaml";
import { launchBrowser } from "./browser.mjs";
import { expandEnv } from "./classify.mjs";
import { createEvidenceGuard, preparePrivateDirectory, securePrivateFile } from "./privacy.mjs";
import { parseScenario } from "./scenario.mjs";

const AUTH_DIR = ".witness/auth";

const file = process.argv[2];
if (!file) {
  console.error("uso: node src/session.mjs <cenário-de-login.yaml>");
  process.exit(1);
}

const scenario = parseScenario(readFileSync(file, "utf8"), YAML);
if (!scenario?.steps) die("cenário sem steps");
const guard = createEvidenceGuard({ scenario });

function abs(p) {
  return p?.startsWith("http") ? p : `${scenario.app ?? ""}${p ?? ""}`;
}
function die(m) {
  console.error(`✗ ${m}`);
  process.exit(1);
}

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();

for (const [i, step] of scenario.steps.entries()) {
  if (step.goto !== undefined) {
    await page.goto(abs(step.goto), { waitUntil: "networkidle", timeout: 30_000 });
    for (const s of ["#axeptio_btn_acceptAll", 'button:has-text("Aceitar")']) {
      try {
        const loc = page.locator(s).first();
        if (await loc.isVisible({ timeout: 400 })) await loc.click({ timeout: 800 });
      } catch { /* */ }
    }
  } else if (step.fill) {
    const selector = step.fill.selector ?? step.fill[0];
    const value = step.fill.value ?? step.fill[1] ?? "";
    await page.fill(selector, expandEnv(value, process.env, { required: true }), { timeout: 10_000 });
  } else if (step.click) {
    if (typeof step.click === "object" && step.click.text) {
      await page.getByRole("button", { name: step.click.text }).first().click({ timeout: 8000 }).catch(async () => {
        await page.getByText(step.click.text, { exact: false }).first().click({ timeout: 8000 });
      });
    } else {
      await page.click(typeof step.click === "string" ? step.click : step.click.selector, { timeout: 10_000 });
    }
  } else if (step.wait) {
    await page.waitForTimeout(Number(step.wait) || 1000);
  } else if (step.expectVisible || step.expectUrl || step.expectText) {
    // asserts no login: apenas valida e segue
    if (step.expectVisible) {
      try {
        await page.waitForSelector(step.expectVisible, { timeout: 8000, state: "visible" });
      } catch {
        die(`assert falhou no login: ${step.expectVisible} não visível`);
      }
    }
  } else {
    die(`step ${i} não suportado no login: ${JSON.stringify(step)}`);
  }
}
await page.waitForTimeout(2500);

// heurística simples de validação: saiu da tela de login?
const stillOnLogin = /login|signin|access/i.test(page.url());
preparePrivateDirectory(AUTH_DIR);
const name = basename(file).replace(/\.ya?ml$/, "");
const statePath = join(AUTH_DIR, `${name}.json`);
await context.storageState({ path: statePath });
securePrivateFile(statePath);
await guard.captureScreenshot(page, join(AUTH_DIR, `${name}-final.png`), { fullPage: false });
await browser.close();

if (stillOnLogin) {
  die(`login parece não ter completado (url ainda contém login/access): ${guard.redactText(page.url())}`);
}
console.log(`✓ sessão salva em ${statePath}`);
