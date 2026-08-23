# QA Agent SaaS — Arquitetura (v0.1, 72h MVP)

## Nome de trabalho: **WitnessQA** (decidir depois)

## Conceito
Agentes de IA abrem o app do cliente como um usuário real (Playwright headless),
navegam fluxos declarados (ou descobertos), capturam evidências (screenshots,
console/page errors, geometria, network), emitem veredito por fluxo e — quando
falha — investigam a causa com LLM lendo as evidências.

Diferencial vs CodeRabbit/Greptile: QA **funcional** (usa o sistema), não code review.

## O que já existe no domod (base extraída)

| Ativo domod | Reuso no SaaS |
|---|---|
| `scripts/qa/lib/qa.mjs` — relatorios, shotsDir, imagensQuebradas | núcleo do SDK de cenários |
| `finance-scope.mjs` etc. (39 cenários!) — check(), shot(), geometry() | padrão de evidência + checks |
| `domod-cli qa scope plan/record/gate` | modelo de run → gate de release |
| `qa scope viewport` — overflow/clipping/obstrução | checagem de UI automática |
| frota review-fleet.mjs — concorrência, rotas, failover | orquestração de workers |
| opencode/openrouter ox-alpha | motor LLM do agente |

## Arquitetura MVP

```
[Next.js App]  ── cria run --> [Supabase: runs queue]
      │                                │
      │ dashboard                      ▼
      │ evidências/billing    [Worker (Fly.io/VPS): Playwright]
      │                                │
      │                    1. carrega fluxos do tenant (YAML ou descoberta)
      │                    2. executa: goto→check→shot→geometry
      │                    3. coleta consoleErrors/pageErrors/imgs quebradas
      │                    4. se falha → LLM analisa evidências → causa provável
      │                                │
      ▼                                ▼
[Screenshots + relatório MD] ──> [Supabase Storage + tabela results]
```

### Componentes
1. **app/** — Next.js 15 + Supabase Auth; dashboard por org; viewer de evidências
2. **worker/** — Node + Playwright; consome fila (pg-boss ou Supabase realtime);
   roda N cenários em paralelo; sobe screenshots pro Storage
3. **scenario-sdk/** — pacote npm: `defineScenario({ name, url, steps[], checks[] })`
   compatível com o padrão dos scripts domod (migração trivial)
4. **agent-discovery/** (fase 2) — LLM explora o app sozinho e PROPÕE fluxos,
   humano aprova uma vez, depois roda sempre

### Modelo de dados (Supabase)
- orgs, users, apps(url, env), scenarios(app_id, yaml/json), runs(app_id, status),
  results(run_id, scenario_id, verdict pass|fail|blocked, evidence_path[],
  console_errors jsonb, cause_analysis text), billing via Stripe webhook → orgs.plan

### Fluxo do worker (MVP)
1. poll run pendente
2. para cada cenário: launch chromium → context isolado → executa steps
   - cada step: action (goto/click/fill/expect) + screenshot após + check opcional
3. falha → junta últimos 5 prints + erros de console + HTML snippet → LLM:
   "qual a causa provável? é bug do app ou cenário desatualizado?"
4. grava results + report.md + atualiza run.status=done
5. dashboard mostra timeline + galeria de evidências

## Benchmark: domod
- Rodar contra demo async.dev.br (cliente/admin/superadmin) com os MESMOS
  39 fluxos dos scripts manuais
- Métrica: % de concordância entre veredito do agente e QA manual conhecido
- Meta MVP: 80%+ nos cenários de fumaça; zero falso-verde (pior erro)

## Pricing (hipótese)
- Solo: $49/mo — 1 app, 20 cenários, runs diários
- Team: $149/mo — 5 apps, 100 cenários, runs por deploy (webhook)
- Agency: $399/mo — ilimitado, white-label do relatório

## 72h
- D1: worker + sdk rodando 3 cenários reais do domod localmente ✓ benchmark parcial
- D2: app Next.js + Supabase + dashboard viewer + Stripe test mode; benchmark completo
- D3: deploy (Vercel + worker num VPS/Fly), demo vídeo com domod real, lançamento
