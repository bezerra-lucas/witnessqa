# WitnessQA

**AI agents that use your app like a real user — and hand you the evidence.**

Agents open your web app, walk every flow, take screenshots at every step, and deliver a signed report with a verdict per feature. When something breaks, they find out why.

```
$ npx witnessqa init
$ witnessqa run

  ▶ smoke-home
    ✓ PASS (2 steps)

  relatório: .witness/runs/1787457548157/REPORT.md
```

## Why

Code review tools read your diff. Traditional E2E tests demand fragile specs. Neither tells you **"does the app actually work for a human right now?"**

WitnessQA agents do:

- **Open your app like a user** — real browser, real clicks, real forms
- **Screenshot every step** — evidence, not promises
- **Verdict per flow** — a report a founder can read: "checkout passed, signup failed because X"
- **Root-cause investigation** — on failure, an LLM reads the console errors + HTML + screenshots and tells you if it's your bug or a stale selector
- **Graph exploration** — point it at a URL and it discovers your app's flows by itself (BFS over states), generating regression scenarios per branch

## Quick start

```bash
npx witnessqa init        # creates witness.config.yaml + example scenario
witnessqa run             # runs every scenario in ./witness/
witnessqa list            # shows discovered scenarios
witnessqa explore https://yourapp.com   # AI discovery of flows → scenarios
```

Scenarios are plain YAML:

```yaml
name: checkout-smoke
app: https://myshop.com
steps:
  - goto: /products
  - click: "text=Add to cart"
  - expectVisible: ".cart-badge"
checks:
  - noBrokenImages
  - noConsoleErrors
```

### Bring Your Own Key (free forever)

The root-cause investigator uses **your own LLM key**. No account, no middleman:

```bash
export WITNESS_KEY="sk-or-v1-..."          # OpenRouter / OpenAI / any OpenAI-compatible
export WITNESS_MODEL="openai/gpt-4o-mini"  # optional
witnessqa run
```

No key? Everything still works — you just skip the cause analysis.

## Commands

| Command | What it does |
|---|---|
| `witnessqa init` | Scaffold config + first scenario |
| `witnessqa run [names...]` | Run scenarios (all by default) |
| `witnessqa explore <url>` | Discover flows as a graph, generate regression scenarios |
| `witnessqa list` | List scenarios |
| `witnessqa report` | Open the latest report |

## How exploration works

The explorer models your app as a graph: nodes are screens (URL + DOM signature), edges are actions (`goto`, button clicks, portal forms). It walks the graph best-first (shortest path to each new screen before deep branches), spawns an isolated browser context per branch, and emits one regression scenario per meaningful path. Budget-controlled: `--max-nodes`, depth cap.

## Roadmap

- [ ] Cloud worker (1-click runs, no local setup)
- [ ] Dashboard with evidence timeline
- [ ] Slack/Discord alerts on verdict change
- [ ] Visual diff between runs

## License

MIT
