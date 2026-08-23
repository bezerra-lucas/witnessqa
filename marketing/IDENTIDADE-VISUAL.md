# WitnessQA — Identidade Visual
*"Dossiê técnico" — o agente como testemunha oficial. Documento, não dashboard.*

## Conceito
O produto entrega **laudos com evidência**. A marca tem que parecer o documento que um engenheiro respeita: papel, tinta, numeração de cláusulas, carimbo. Zero estética "AI SaaS" (gradiente roxo, glassmorphism, emoji, ilustração 3D fofa).

## Paleta
| Token | Hex | Uso |
|---|---|---|
| `--paper` | #F4F1EA | fundo principal (off-white morno) |
| `--paper-2` / `#FBF9F4` | superfícies de card/relatório |
| `--ink` | #17150F | texto e bordas fortes |
| `--ink-soft` | #4A463B | texto secundário |
| `--rule` | #C9C3B2 | linhas finas de formulário |
| `--pass` | #0E6B3D | verde-sinal — veredito positivo, acento único da marca |
| `--fail` | #B3261E | vermelho carimbo — SOMENTE estados de falha (nunca decorativo) |

## Tipografia
- **Display:** Instrument Serif (títulos grandes, itálico como recurso expressivo)
- **Corpo/UI:** Archivo (grotesca neutra, pesos 400–700)
- **Laudo/código/labels:** IBM Plex Mono (números de seção §, stamps, metadados)

## Elementos gráficos
1. **Numeração de cláusulas** — toda seção começa com label mono uppercase precedida de § ou STEP 0N
2. **Carimbos** — caixas de borda 2px levemente rotacionadas (-3°): PASSED / FAILED em verde/vermelho carimbo
3. **Tabela de evidências** — linhas §N com veredito à direita, separadas por hairline
4. **Bordas duras + sombra offset sólida** (`box-shadow: 6px 6px 0 var(--ink)`) — nada de blur
5. **Topbar preta de "case file"** no topo da página (Case No., data)
6. Ícone de marca: monograma `W/QA` em caixa de borda mono

## Voz e tom
- Inglês, sóbrio, jurídico-técnico leve ("witnessed", "under oath", "signed report")
- Frases curtas. Nada de hype words ("revolutionary", "10x", 🚀)
- Promessa sempre acompanhada de mecanismo ("evidence, not promises" + screenshots/logs)

## Aplicação
- Landing: `marketing/landing/index.html` (implementa todo o sistema acima)
- Favicon/produto: monograma W/QA ink-on-paper; estado PASS usa o verde-sinal
- Social/OG images: fundo paper, headline serif, carimbo PASS — consistente com a landing
