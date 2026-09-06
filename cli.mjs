#!/usr/bin/env node
/**
 * WitnessQA CLI — `npx witnessqa <comando>`
 *
 *   witnessqa init
 *   witnessqa run [alvos...]
 *   witnessqa explore <url>
 *   witnessqa login [cenário.yaml]
 *   witnessqa report [run-dir]
 *   witnessqa list
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { platform } from "node:os";
import YAML from "yaml";
import { executeCi } from "./worker/src/ci.mjs";

const VERSION = "0.3.2";
const SCENARIO_DIR = "witness";
const RUNS_DIR = ".witness/runs";
const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `
  WitnessQA — agentes de IA que testam seu app como um usuário real.

  Uso: witnessqa <comando>

  Comandos:
    init                        Configuração inicial (config + cenário exemplo)
    run [alvos...]              Roda cenários; alvo = nome, arquivo ou pasta. Sem args = todos.
    explore <url>               Explora o app como grafo e gera cenários de regressão
    cover [url]                 Cobre alvos do config (ou 1 URL): descobre + roda + laudo no browser
    diff <run-a> <run-b>        Compara vereditos de duas runs
    vdiff <run-a> <run-b>       Visual-diff de screenshots
    notify [run]                Dispara webhook Discord/Slack do veredito
    ci --job <json> --out <dir> Executa o seam headless da CI nativa
    login [cenário]             Faz login e grava storageState em .witness/auth/
    report [run]                Gera/abre o laudo HTML da última run
    list                        Lista cenários encontrados
    --help, -h                  Esta ajuda
    --version                   Versão
    --version-json              Identidade imutável do seam de CI

  Exemplos:
    witnessqa init
    witnessqa run
    witnessqa run login checkout
    witnessqa explore https://meuapp.com
    witnessqa login witness/login.yaml
    witnessqa report
`;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function loadConfig() {
  const p = "witness.config.yaml";
  if (!existsSync(p)) return {};
  return YAML.parse(readFileSync(p, "utf8")) ?? {};
}

function workerFile(name) {
  return join(HERE, "worker", "src", name);
}

function runNode(script, args, { inherit = true } = {}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolvePromise(code);
    };
    const child = spawn(process.execPath, [script, ...args], {
      stdio: inherit ? "inherit" : "pipe",
      env: process.env,
    });
    child.once("error", (error) => {
      console.error(`falha ao iniciar processo: ${error.message}`);
      finish(1);
    });
    child.once("exit", (code) => finish(code ?? 1));
  });
}

function findScenarios(args) {
  if (args.length === 1 && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
    return readdirSync(args[0])
      .filter((f) => /\.(ya?ml|json)$/.test(f))
      .map((f) => join(args[0], f));
  }
  if (args.length && args.every((a) => existsSync(a) && /\.(ya?ml|json)$/.test(a))) {
    return args.map((a) => resolve(a));
  }
  if (!existsSync(SCENARIO_DIR)) die(`pasta ./${SCENARIO_DIR} não existe — rode "witnessqa init"`);
  const all = readdirSync(SCENARIO_DIR).filter((f) => /\.(ya?ml|json)$/.test(f));
  if (!args.length) return all.map((f) => join(SCENARIO_DIR, f));
  const picked = [];
  for (const a of args) {
    if (existsSync(a) && /\.(ya?ml|json)$/.test(a)) {
      picked.push(resolve(a));
      continue;
    }
    const byFile = all.find((f) => f === a || f === `${a}.yaml` || f === `${a}.yml` || f === `${a}.json`);
    if (byFile) {
      picked.push(join(SCENARIO_DIR, byFile));
      continue;
    }
    const hit = all.find((f) => {
      try {
        return YAML.parse(readFileSync(join(SCENARIO_DIR, f), "utf8"))?.name === a;
      } catch {
        return false;
      }
    });
    if (hit) picked.push(join(SCENARIO_DIR, hit));
    else die(`cenário "${a}" não encontrado em ./${SCENARIO_DIR}/ (use "witnessqa list")`);
  }
  return picked;
}

function latestRunDir() {
  if (!existsSync(RUNS_DIR)) return null;
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "explore")
    .map((d) => d.name)
    .sort();
  return dirs.length ? join(RUNS_DIR, dirs[dirs.length - 1]) : null;
}

function openPath(p) {
  const target = /^https?:\/\//i.test(p) ? p : resolve(p);
  const cmd = platform() === "win32" ? "cmd" : platform() === "darwin" ? "open" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", target] : [target];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = rest.filter((a) => a.startsWith("--"));
  const pos = positionalArgs(rest);

  switch (cmd) {
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return;

    case "--version":
    case "-v":
      console.log(VERSION);
      return;

    case "--version-json":
      console.log(JSON.stringify({
        schema: "witnessqa-version/v1",
        interface: "witnessqa-ci/v1",
        version: VERSION,
        ...repositoryIdentity(),
      }));
      return;

    case "ci": {
      if (rest.length !== 4 || rest[0] !== "--job" || rest[2] !== "--out" || !rest[1] || !rest[3]) {
        console.error("uso: witnessqa ci --job <json> --out <novo-dir>");
        process.exitCode = 2;
        return;
      }
      const job = flagValue(flags, rest, "--job");
      const out = flagValue(flags, rest, "--out");
      process.exitCode = await executeCi(job, out, { version: VERSION, observe: repositoryIdentity });
      return;
    }

    case "init": {
      mkdirSync(SCENARIO_DIR, { recursive: true });
      if (!existsSync("witness.config.yaml")) {
        writeFileSync(
          "witness.config.yaml",
          YAML.stringify({
            viewport: { width: 1440, height: 950 },
            targets: [{ name: "app", url: "https://meuapp.com", auth: ".witness/auth/login.json" }],
          }),
        );
        console.log("✓ witness.config.yaml criado");
      }
      if (!existsSync(`${SCENARIO_DIR}/smoke.yaml`)) {
        writeFileSync(
          `${SCENARIO_DIR}/smoke.yaml`,
          [
            "name: smoke-home",
            "what: valida que a home carrega",
            "steps:",
            "  - goto: /",
            "  - expectText: \"Home\"",
            "checks:",
            "  - noBrokenImages",
            "",
          ].join("\n"),
        );
        console.log(`✓ ${SCENARIO_DIR}/smoke.yaml criado`);
      }
      console.log("\npróximo passo: witnessqa login && witnessqa cover");
      console.log("(precisa de Chrome/Chromium no PATH, ou: npx playwright install chromium)");
      return;
    }

    case "list": {
      const files = findScenarios([]);
      for (const f of files) {
        const s = YAML.parse(readFileSync(f, "utf8"));
        console.log(`${s.name ?? "?"}  (${f}, ${s.steps?.length ?? 0} steps)`);
      }
      return;
    }

    case "run": {
      const targets = findScenarios(pos);
      if (!targets.length) die("nenhum cenário para rodar");
      const cfg = loadConfig();
      const outDir = process.env.WITNESS_RUN_OUT || join(RUNS_DIR, String(Date.now()));
      mkdirSync(outDir, { recursive: true });
      const base = flagValue(flags, rest, "--base-url") ?? cfg.baseUrl ?? "";
      const auth = flagValue(flags, rest, "--auth") ?? (existsSync(".witness/auth/login.json") ? ".witness/auth/login.json" : "");
      const extra = ["--base-url", base, "--out", outDir];
      if (auth) extra.push("--auth", auth);
      if (rest.includes("--headed")) extra.push("--headed");
      console.log(`WitnessQA — rodando ${targets.length} cenário(s)\n`);
      const code = await runNode(workerFile("worker.mjs"), [...targets, ...extra]);
      console.log(`\nevidências em ${outDir}`);
      process.exit(code);
      return;
    }

    case "explore": {
      const url = pos[0];
      if (!url) die("explore precisa de uma URL: witnessqa explore https://app.com");
      const maxNodes = flagValue(flags, rest, "--max-nodes") ?? "40";
      const out = join(RUNS_DIR, "explore", String(Date.now()));
      mkdirSync(out, { recursive: true });
      const extra = [url, "--max-nodes", String(maxNodes), "--out", out];
      const auth = flagValue(flags, rest, "--auth");
      if (auth) extra.push("--auth", auth);
      const code = await runNode(workerFile("explore.mjs"), extra);
      console.log(`\ngrafo + cenários gerados em ${out}`);
      process.exit(code);
      return;
    }

    case "cover": {
      const cfg = loadConfig();
      const out = process.env.WITNESS_COVER_OUT || flagValue(flags, rest, "--out") || join(RUNS_DIR, "cover-graph");
      mkdirSync(out, { recursive: true });
      const max = flagValue(flags, rest, "--max") ?? "80";
      const jobs = flagValue(flags, rest, "--jobs") ?? "2";
      const discoverOnly = rest.includes("--discover-only");
      const targets = [];
      if (pos[0]) {
        targets.push({ name: "app", url: pos[0], auth: flagValue(flags, rest, "--auth") ?? "" });
      } else if (Array.isArray(cfg.targets) && cfg.targets.length) {
        targets.push(...cfg.targets);
      } else if (cfg.baseUrl) {
        targets.push({
          name: "app",
          url: cfg.baseUrl,
          auth: flagValue(flags, rest, "--auth") ?? (existsSync(".witness/auth/login.json") ? ".witness/auth/login.json" : ""),
        });
      } else {
        die("cover: passe uma URL ou declare targets: em witness.config.yaml");
      }

      let code = 0;
      for (const t of targets) {
        if (!t?.url) continue;
        console.log(`\ncover → ${t.name ?? t.url}`);
        const extra = [t.url, "--out", out, "--max", String(max)];
        if (t.auth) extra.push("--auth", t.auth);
        if (t.name) extra.push("--prefix", String(t.name));
        code = await runNode(workerFile("cover.mjs"), extra);
        if (code !== 0) break;
      }
      if (code !== 0) process.exit(code);

      if (!discoverOnly) {
        const runOut = process.env.WITNESS_RUN_OUT || join(RUNS_DIR, "cover-live");
        mkdirSync(runOut, { recursive: true });
        const workerCode = await runNode(workerFile("worker.mjs"), [join(out, "witness"), "--out", runOut, "--jobs", String(jobs)]);
        await publishReport(runOut, rest);
        process.exitCode = workerCode;
      } else {
        console.log(`\ncobertura + YAMLs em ${out}/witness`);
      }
      return;
    }

    case "login": {
      const file = pos[0] ?? (existsSync(`${SCENARIO_DIR}/login.yaml`) ? `${SCENARIO_DIR}/login.yaml` : null);
      if (!file) die("informe o cenário de login: witnessqa login witness/login.yaml");
      const code = await runNode(workerFile("session.mjs"), [file]);
      process.exit(code);
      return;
    }

    case "report": {
      const dirs = pos.length ? pos : [latestRunDir()].filter(Boolean);
      if (!dirs.length || !dirs.every((d) => existsSync(d))) die("nenhuma run encontrada — rode witnessqa cover ou witnessqa run primeiro");
      if (dirs.length === 1) await publishReport(dirs[0], rest);
      else {
        await runNode(workerFile("packer.mjs"), dirs);
        await publishReport(dirs[0], rest);
      }
      return;
    }

    case "vdiff": {
      if (pos.length < 2) die("uso: witnessqa vdiff <run-a> <run-b>");
      const outDir = join(RUNS_DIR, `vdiff-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
      const code = await runNode(workerFile("vdiff.mjs"), [pos[0], pos[1], outDir]);
      if (code !== 0) process.exit(code);
      await publishReport(outDir, rest);
      return;
    }

    case "notify": {
      const dir = pos[0] ?? latestRunDir();
      if (!dir) die("nenhuma run — rode witnessqa cover primeiro");
      process.exit(await runNode(workerFile("notify.mjs"), [dir]));
      return;
    }

    case "diff": {
      if (pos.length < 2) die("uso: witnessqa diff <run-a> <run-b>");
      const outDir = join(RUNS_DIR, `diff-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });
      const dest = join(outDir, "REPORT.html");
      const code = await runNode(workerFile("diff.mjs"), [pos[0], pos[1], dest]);
      if (code !== 0) process.exit(code);
      await publishReport(outDir, rest);
      return;
    }

    default:
      die(`comando desconhecido "${cmd}" — use --help`);
  }
}

function serveReport(dir, port = 8765) {
  spawn(process.execPath, [workerFile("serve.mjs"), resolve(dir), String(port)], {
    detached: true,
    stdio: "ignore",
  }).unref();
  return `http://127.0.0.1:${port}/REPORT.html`;
}

async function publishReport(dir, rest = []) {
  if (!existsSync(join(dir, "REPORT.html"))) {
    const code = await runNode(workerFile("packer.mjs"), [dir]);
    if (code !== 0) die("falha ao gerar o laudo");
  }
  if (rest.includes("--no-serve")) {
    const report = resolve(dir, "REPORT.html");
    console.log(report);
    return report;
  }
  const url = serveReport(dir);
  console.log(url);
  if (!rest.includes("--no-open")) openPath(url);
  if (process.env.WITNESS_DISCORD_WEBHOOK || process.env.WITNESS_SLACK_WEBHOOK) {
    await runNode(workerFile("notify.mjs"), [dir, url]);
  }
  return url;
}

function flagValue(_flags, rest, name) {
  const i = rest.indexOf(name);
  if (i < 0) return undefined;
  return rest[i + 1];
}

function repositoryIdentity() {
  const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
  const canonical = join(HERE, "cli.mjs");
  if (!invoked || !existsSync(invoked) || !readFileSync(invoked).equals(readFileSync(canonical))) {
    throw new Error("não foi possível verificar o executável imutável do WitnessQA");
  }
  const observed = spawnSync("git", ["-C", HERE, "rev-parse", "--verify", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const head = observed.status === 0 ? observed.stdout.trim() : "";
  const status = spawnSync("git", ["-C", HERE, "status", "--porcelain=v1", "--untracked-files=all", "--", "."], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (!/^[a-f0-9]{40}$/.test(head) || status.status !== 0 || status.stdout.trim()) {
    throw new Error("não foi possível verificar uma árvore imutável do WitnessQA");
  }
  const packageLock = readFileSync(join(HERE, "package-lock.json"));
  return {
    head_sha: head,
    package_lock_sha256: createHash("sha256").update(packageLock).digest("hex"),
  };
}

const VALUE_FLAGS = new Set(["--auth", "--base-url", "--job", "--jobs", "--max", "--max-nodes", "--out"]);

export function positionalArgs(args) {
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (VALUE_FLAGS.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) positionals.push(value);
  }
  return positionals;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  // Evidence must stay private even when the invoking shell uses a
  // collaborative umask. Child workers inherit this restriction.
  process.umask(0o077);
  main().catch((e) => die(e.message));
}
