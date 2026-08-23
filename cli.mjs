#!/usr/bin/env node
/**
 * WitnessQA CLI — `npx witnessqa <comando>`
 *
 * Comandos:
 *   witnessqa init                  cria witness.config.yaml + cenários de exemplo
 *   witnessqa run [cenário...]      roda cenários (arquivo, pasta ou nome); sem args = todos
 *   witnessqa explore <url>         descobre o grafo do app e gera cenários por branch
 *   witnessqa login <email> [--password-env VAR]  helper: descobre seletores de login e salva auth state
 *   witnessqa report [run-dir]      abre o último relatório no navegador
 *   witnessqa --help
 *
 * Convenções:
 *   - cenários em ./witness/ (yaml|json)
 *   - runs e evidências em ./.witness/runs/<timestamp>/
 *   - config em witness.config.yaml (baseUrl, credentials por env var, viewport)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import YAML from "yaml";

const VERSION = "0.1.0";
const SCENARIO_DIR = "witness";
const RUNS_DIR = ".witness/runs";

const HELP = `
  WitnessQA — agentes de IA que testam seu app como um usuário real.

  Uso: witnessqa <comando>

  Comandos:
    init                        Configuração inicial (config + cenário exemplo)
    run [alvos...]              Roda cenários; alvo = nome, arquivo ou pasta. Sem args = todos.
    explore <url>               Explora o app como grafo e gera cenários de regressão
    report [run]                Mostra/abre o relatório da última run
    list                        Lista cenários encontrados
    --help, -h                  Esta ajuda
    --version                   Versão

  Exemplos:
    witnessqa init
    witnessqa run                       # tudo em ./witness/
    witnessqa run login checkout        # cenários específicos pelo nome
    witnessqa explore https://meuapp.com
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

function findScenarios(args) {
  if (!existsSync(SCENARIO_DIR)) die(`pasta ./${SCENARIO_DIR} não existe — rode "witnessqa init"`);
  const all = readdirSync(SCENARIO_DIR).filter((f) => /\.(ya?ml|json)$/.test(f));
  if (!args.length) return all.map((f) => join(SCENARIO_DIR, f));
  const picked = [];
  for (const a of args) {
    const byFile = all.find((f) => f === a || f === `${a}.yaml` || f === `${a}.yml` || f === `${a}.json`);
    if (byFile) {
      picked.push(join(SCENARIO_DIR, byFile));
      continue;
    }
    // busca pelo campo `name:` dentro dos arquivos
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

async function main() {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      return;

    case "--version":
      console.log(VERSION);
      return;

    case "init": {
      mkdirSync(SCENARIO_DIR, { recursive: true });
      if (!existsSync("witness.config.yaml")) {
        writeFileSync(
          "witness.config.yaml",
          YAML.stringify({
            baseUrl: "https://meuapp.com",
            viewport: { width: 1440, height: 950 },
            credentials: { email: "$WITNESS_EMAIL", password: "$WITNESS_PASSWORD" },
          }),
        );
        console.log("✓ witness.config.yaml criado");
      }
      if (!existsSync(`${SCENARIO_DIR}/smoke.yaml`)) {
        writeFileSync(
          `${SCENARIO_DIR}/smoke.yaml`,
          [
            "name: smoke-home",
            "steps:",
            "  - goto: /",
            "  - expectVisible: body",
            "checks:",
            "  - noBrokenImages",
            "",
          ].join("\n"),
        );
        console.log(`✓ ${SCENARIO_DIR}/smoke.yaml criado`);
      }
      console.log("\npróximo passo: witnessqa run");
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
      const targets = findScenarios(rest.filter((a) => !a.startsWith("--")));
      const cfg = loadConfig();
      const outDir = join(RUNS_DIR, String(Date.now()));
      mkdirSync(outDir, { recursive: true });
      const base = cfg.baseUrl ?? "";
      console.log(`WitnessQA — rodando ${targets.length} cenário(s)\n`);
      const workerPath = new URL("./worker/src/worker.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
      const child = spawn(process.execPath, [
        workerPath,
        ...targets,
        "--base-url",
        base,
        "--out",
        outDir,
      ], { stdio: "inherit" });
      child.on("exit", (code) => {
        console.log(`\nevidências em ${outDir}`);
        process.exit(code ?? 0);
      });
      return;
    }

    case "explore": {
      const url = rest.find((a) => !a.startsWith("--"));
      if (!url) die("explore precisa de uma URL: witnessqa explore https://app.com");
      const maxNodes = Number(rest[rest.indexOf("--max-nodes") + 1] ?? 40);
      const out = join(RUNS_DIR, "explore", String(Date.now()));
      mkdirSync(out, { recursive: true });
      const explorePath = new URL("./worker/src/explore.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
      const child = spawn(process.execPath, [
        explorePath,
        url,
        "--max-nodes",
        String(maxNodes),
        "--out",
        out,
      ], { stdio: "inherit" });
      child.on("exit", (code) => {
        console.log(`\ngrafo + cenários gerados em ${out}`);
        process.exit(code ?? 0);
      });
      return;
    }

    default:
      die(`comando desconhecido "${cmd}" — use --help`);
  }
}

main().catch((e) => die(e.message));
