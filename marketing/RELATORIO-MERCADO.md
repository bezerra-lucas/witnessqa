# WitnessQA — Relatório de Mercado & Benchmarks
*CMO/CFO briefing — agosto 2026*

---

## 1. O mercado existe, é grande e está financiada

- **US$ 1,5 bi+** já investidos em startups de "AI testing" (Momentic $18,7M, QA Wolf $57M, Ranger $8,9M, Meticulous $15M Série A com anjos da OpenAI/Stripe/Cursor).
- Gartner criou categoria formal em 2025: *AI-Augmented Software Testing → Agentic Software Quality Assurance Platforms*.
- Mercado de agentes IA: **$7,8 bi (2025) → $52,6 bi projetado (2030)**.
- Casulo real: bugs de código gerado por IA cresceram **43% a/a** — quem gera código mais rápido precisa verificar mais rápido.

## 2. Mapa competitivo (quem é quem)

| Player | Modelo | Pricing | Fraqueza explorável |
|---|---|---|---|
| **QA Wolf** | Serviço gerenciado (humanos+IA) | ~$40/teste/mês, ~$90K ACV médio ($60–250K/ano) | Caríssimo; só enterprise/mid-market |
| **Momentic** | SaaS agêntico puro | Quote-based (fechado) | Sem preço público; lock-in (não exporta código); Chrome-only |
| **Ranger** | Cyborg (agentes + gate humano) | Contrato anual custom | Enterprise sales cycle |
| **Spur** | Vertical e-commerce | Quote-based, pilot-first | Nicho |
| **Octomind** | ⚰️ Fechou mid-2026 ($4,8M levantados) | era $89–589/mo | Lição: engenharia boa ≠ mercado validado. Eles não acharam ICP |
| **Expect** | OSS, valida diffs de coding agent | Free CLI | Não cobre suíte de regressão nem exploração |
| **TestSprite, Mechasm, qtrl** etc. | Long tail agêntica | Credit-based / free tier | Sub-scale |

### Observação crítica (CFO)
A pesquisa independente (Ry Walker Research) mostra: **quase zero validação orgânica** em HN/Reddit em toda a categoria — as páginas que existem são dos próprios vendors. Quem aparecer com **prova pública verificável** (demo real, evidências reais) ganha confiança instantânea que nenhum concorrente tem hoje.

## 3. Nosso diferencial real

Todo mundo vende "gera e mantém testes". Ninguém entrega como produto principal:
1. **Evidência visual** — prints, gravações, logs por funcionalidade
2. **Veredito por fluxo** — relatório legível por humano ("checkout passou, cadastro falhou por X")
3. **Exploração exaustiva** — busca por branches tipo graph search, não specs escritas
4. **Investigação de causa** quando falha

Isso é o gap entre "teste automatizado" e "relatório de QA que um fundador lê". Posicionamento: **não vendemos testes, vendemos a certeza documentada de que o app funciona.**

## 4. Pricing benchmark

- Categoria enterprise: quote-based, $60K+/ano → deixamos esse dinheiro pra depois.
- Banda self-serve dev-tools: primeiro plano < $49 em 96% dos casos; plano topo mediana ~$115–180/mês.
- Regra SaaS pricing: meio-tier nunca $97 (âncora de info-produto); **$149–199 converte melhor que $99 em B2B**.
- Octomind morreu com $89–589/mo sem validação → nosso plano de entrada precisa ter trial instantâneo sem fricção.

**Decisão final de pricing:**
| Plano | Preço | Conteúdo |
|---|---|---|
| Solo | **$149/mês** | 1 app, 30 runs/mês, evidências + relatórios |
| Team | **$349/mês** | 3 apps, 120 runs, Slack alerts, branches exaustivos |
| Scale | **$899/mês** | apps ilimitados, overage $2/run, API, multi-usuário |
| Trial | grátis, sem cartão | 1 run completa no app do usuário — a demo É o funil |

Unit economics alvo: custo/run $0,20–0,40 (worker Playwright + tokens). No Solo, 30 runs ≈ $12 de custo → margem bruta >90%. Overage $2/run tem margem ~80%.

## 5. ICP e go-to-market

**ICP primário:** founders solo e equipes 2–8 devs de SaaS web, sem QA dedicado, que já usam coding agents (Cursor/Claude Code) e sofrem com regressões em prod.
**ICP secundário:** dev shops/agências que entregam web apps e respondem pelo pós-deploy.

**Canais (ordem de ROI):**
1. Demo real do domod na landing (único vendor com prova pública)
2. Show HN: "Show HN: AI agents that use your app like a user and hand you the evidence" — categoria quente, quase nenhuma discussão orgânica existe ainda
3. Build-in-public no X
4. Outreach manual: 50 dev shops BR/US com vídeo de 60s
5. Ecossistema Hermes/opencode/MCP — distribuir via MCP server (concorrentes já validaram que MCP é canal: Octomind tinha, Expect é CLI-first)

**Métricas semana 1–4:** trials ativados, % com ≥3 runs (ativação), calls feitas, MRR meta mês 1: $450–1.500 (3–10 clientes Solo).

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Commoditização por baixo (Playwright AI Healer, Stagehand grátis) | Nosso moat é o produto de relatório/evidência + exploração por branches, não o driver do browser |
| Mesmo destino do Octomind (sem validação) | Trial instantâneo antes de qualquer infra pesada; vender desde dia 1 |
| Ambiente de staging instável do cliente quebra agente | Onboarding guiado + fallback de credenciais de teste |
| Concorrentes enterprise descerem mercado | Velocidade: somos 2 pessoas com custo ~zero vs times com burn |

## 7. Identidade visual — diretriz

Conceito: **dossiê / ata notarial técnica**. O produto é testemunha; a marca deve parecer documento oficial de constatação — papel, tinta, carimbo, monospace de laudo. Fugir de: gradientes roxos, glassmorphism, emojis, "cara de IA".

- Papel: #F4F1EA (off-white morno), Tinta: #17150F
- Acento único: verde-sinal #0E6B3D (veredito "PASSOU") + vermelho carimbo #B3261E apenas para estados de falha
- Tipografia: display serif editorial (Instrument Serif) + corpo grotesca neutra (Archivo/Inter) + mono de laudo (IBM Plex Mono)
- Elementos: linhas de formulário, numeração de cláusulas (§), carimbos PASS/FAIL, tabela de evidências
