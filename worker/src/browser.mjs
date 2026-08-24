/**
 * Launch Chromium via playwright-core without assuming `npx playwright install`.
 * Tries Playwright's own browser, then system Chrome/Edge.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

function candidates() {
  const home = homedir();
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    // Linux / WSL
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
}

export function findBrowserExecutable() {
  return candidates().find((p) => existsSync(p)) ?? null;
}

export async function launchBrowser(opts = {}) {
  const executablePath = opts.executablePath || findBrowserExecutable();
  const launchOpts = {
    headless: opts.headless !== false,
    args: ["--disable-dev-shm-usage", "--no-sandbox", ...(opts.args ?? [])],
  };
  if (executablePath) launchOpts.executablePath = executablePath;

  try {
    return await chromium.launch(launchOpts);
  } catch (first) {
    try {
      return await chromium.launch({ ...launchOpts, channel: "chrome", executablePath: undefined });
    } catch {
      try {
        return await chromium.launch({ ...launchOpts, channel: "msedge", executablePath: undefined });
      } catch {
        const hint =
          "Não achei um Chrome/Chromium. Instale o Chrome ou rode: npx playwright install chromium";
        throw new Error(`${hint}\n${String(first).split("\n")[0]}`);
      }
    }
  }
}
