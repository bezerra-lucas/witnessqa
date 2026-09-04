# WitnessQA — estado atual (v0.1.1)

CLI open-source + worker Playwright + laudo HTML self-contained.
Cloud (dashboard/billing) ainda não existe — a landing aponta para o CLI.

## O que o produto faz hoje

```
witnessqa init | login | cover | run | report | diff | list
        │
        ▼
 worker/src/worker.mjs  → executor (Playwright) → EvidenceGuard → result.json + shots
        │
        ├─ byok.mjs          investigação opcional (WITNESS_KEY)
        └─ packer.mjs        REPORT.html (dossiê técnico)
```

- **CLI** (`cli.mjs`) — bin npm. Resolve Chrome do sistema; não exige `playwright install` se o Chrome já está na máquina.
- **Executor** — steps YAML (goto/click/fill/expect*), screenshot viewport (fullPage derrubava Chromium nos dashboards v3), dump de `page.html`, rede 4xx/5xx, crash → `blocked`.
- **EvidenceGuard** (`privacy.mjs`) — boundary obrigatório para JSON, HTML,
  screenshots, URLs, notificações e BYOK. Capturas falham fechadas e runs novas
  recebem `privacyVersion: 1`; o packer não incorpora bitmaps legados sem essa
  marca.
- **Artifact exporter** (`export-artifact.mjs`) — cria um destino novo e
  allowlisted para CI, rejeita traversal/symlinks e regenera o laudo a partir
  dos resultados sanitizados; o diretório bruto da run nunca é publicado.
- **Visual diff** (`vdiff.mjs`) — compara apenas capturas referenciadas por runs
  com a versão de privacidade atual e persiste somente máscaras dos pixels que
  mudaram, sem reproduzir o conteúdo visual estável.
- **Packer v4** — identidade papel/tinta/carimbo, galeria de evidências, BLOCKED ≠ FAIL.
- **Cover** (`cover.mjs` + `witnessqa cover`) — descobre rotas (nav + `<a>`), gera 1 YAML por tela com heading real + `expectNoText` visível, sem teto de 12 nem `expectVisible: body`.
- **GitHub Action** (`action/action.yml`) — instala o action path, falha o job só em FAIL.

O `storageState` em `.witness/auth` é uma credencial persistida, não evidência:
fica fora de `runs`, com permissões de owner e nunca deve entrar no artifact.
Política, limites de detecção e migração estão em [SECURITY.md](SECURITY.md).

## Benchmark interno

Runs v5 contra **produção** async.dev.br (24/08):
- admin-login-dashboard **PASS** — autenticou e caiu em `/organization` (texto "Dashboard")
- cliente-login-unidades **PASS** — autenticou e `/units` contém "unidad"
Overlay Axeptio agora é dispensado no `goto`. Login com sessão já redirecionada vira skip, não FAIL.

Cover produção (24/08): admin 30 telas (27 PASS, 3 FAIL de webp — recheck HTTP 200 = PASS), cliente 7 PASS, superadmin 7 PASS.
`expectNoText` só conta texto visível. `noBrokenImages` espera load + GET; `naturalWidth=0` com HTTP 200 não é FAIL.
`/units` no cliente era 404 — PR https://github.com/async-desenvolvimento/plana-cliente/pull/57 (`fix/units-alias` → demo).

## Fora do escopo desta versão

- app Next.js / Supabase / Stripe (ARCHITECTURE original do 72h MVP)
- publish npm (token expirado — decisão humana)
- limpeza dos `worker/debug*.cjs` (artefatos locais, não vão no pacote)
