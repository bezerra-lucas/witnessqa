# Runner performance and migration

## Changes

- Lossless WebP and external report assets (see [images.md](images.md)). Native
  image encoding is limited to one operation at a time to bound working memory.
- One browser per execution slot, a fresh context per scenario and recycling
  after 20 scenarios or a disconnected browser. Contexts close on success,
  assertion failure and setup failure. Sessions are never shared between tests.
- One final report build. Results are persisted per scenario while the suite
  runs; use `witnessqa report <run>` explicitly if an interrupted run needs a report.
- One bounded BYOK analysis lane independent of browser slots. The worker waits
  for requested analysis before completing; an LLM cannot change the observed
  verdict. The provider timeout remains 45 seconds per request.
- Broken-image scanning runs only for scenarios declaring `noBrokenImages`.
- `run`, `cover`, the Action and native CI share the same jobs validation.
  Default: 1. `WITNESS_MAX_JOBS` sets an operator ceiling from 1 to 16; otherwise
  the ceiling is min(16, available logical CPUs). Native CI accepts `WITNESS_JOBS`
  and `WITNESS_MAX_JOBS` only when declared in the frozen request's environment.
- Old results are never implicitly resumed. All selected scenarios execute
  again, even in a reused output directory. Results outside the selected suite,
  unsafe/colliding scenario filenames and output symlinks are rejected. `--force`
  remains accepted for callers that already pass it.

## Readiness and assertions

```yaml
name: confirm-order
app: https://preview.example.com
ready: { selector: '[data-testid="cart-loaded"]', timeout: 10000 }
assertionTimeoutMs: 8000
steps:
  - goto: /cart
  - expectText: { selector: '#total', text: 'R$ 150,00' }
    evidence: { label: 'Order total before confirmation' }
  - click: '#confirm'
  - expectUrl: /confirmation
  - expectText: { selector: 'h1', text: 'Order confirmed' }
    evidence: { label: 'Confirmed order', highlight: true }
checks: [noBrokenImages]
```

`ready` runs after navigation. It replaces generic network-idle waiting only when
explicitly declared; the selector and optional text must reflect real application
readiness. Text and URL assertions retry up to the configured timeout. Text
assertions observe visible content in their declared selector. Negative assertions
respect that selector and fail if it never exists. They test absence **at the
observed moment**, so run them after a readiness/positive assertion; they cannot
prove no error will appear later. Positive assertions no longer pass on hidden
text, which can expose previously weak scenarios.

## Capture budgets

`--capture all` remains the default. `--capture checkpoints` keeps every executed
step and assertion in result.json, but takes screenshots only for annotated
`evidence` steps, the final step, and any failing step. Annotate every intermediate
state required by your acceptance criteria. This intentionally reduces visual
history and may be unsuitable for tests inspecting transient visual changes.
Native CI always uses `all`, regardless of ordinary CLI/config preferences.
Existing masking, ownership and file-integrity validation stay in force.

## Diagnostics

Each result contains `metrics.durationMs` and measured phase totals in
`metrics.phasesMs`: browser acquisition, context setup, navigation, readiness,
assertions, explicit waits, screenshots and requested broken-image checks.
The run writes `METRICS.json` with elapsed time, job/browser counts, capture count,
artifact bytes, report/analysis durations, Node worker CPU and peak RSS. The
exporter allowlists numeric diagnostic fields; unknown strings are never copied.

**Worker CPU and peak RSS exclude Chromium processes.** Phase totals may overlap
across concurrent scenarios and cannot be added to obtain wall time. Artifact
bytes are measured before writing METRICS.json. For whole-job CPU, PSS, OOM or
throttling, measure the process tree and cgroup on the actual runner. The benchmark
records beside this file use process-tree measurements.

## Validation limits

The synthetic benchmark has 12 scenarios, two worker slots and a dashboard ready
after 200 ms. Baseline scenarios have an artificial 2-second wait. The opt-in
profile replaces it with `ready: { selector: '#ready', text: 'Pedidos carregados' }`
and uses checkpoints. It keeps the same positive/negative assertions and requested
image check; it intentionally captures fewer intermediate states. Timings exclude
application builds, LLM calls, upload, discovery and queue time. Compare defaults
and the opt-in profile separately; the latter requires adapting each real suite.

## Measured result (Linux, 2026-09-14)

Median of two runs per profile, with order reversed on the second round. Node
24.19.0, Playwright Core 1.62.1, Chromium 153.0.8010.0; worker process-tree affinity
restricted to two logical CPUs. Memory is sampled PSS at nominal 100 ms intervals.
The host is shared and samples are approximate, not p95 or a capacity guarantee.

| Profile | Wall time | CPU, process tree | Peak PSS | Artifact bytes |
|---|---:|---:|---:|---:|
| PR #3 baseline | 20.97 s | 5.67 s | 507.7 MiB | 20.39 MiB |
| New defaults, same waits / all 72 captures | 20.97 s | 5.71 s | 548.8 MiB | 3.66 MiB |
| Explicit readiness + 12 checkpoint captures | 4.47 s | 3.55 s | 534.4 MiB | 0.89 MiB |

The opt-in profile reduces wall time by about **79%**, CPU by **38%** and artifacts
by **96%**. PSS is about **27 MiB higher** than baseline: this is not a RAM reduction.
Defaults reduce bytes by about 82%, without a material runtime improvement in
this wait-heavy fixture. Every run passed all 12 scenarios. Functional failures,
privacy masks, isolated sessions and failed-step capture are tested separately.

Raw measurements: [runner-benchmark.json](runner-benchmark.json). Reproduce on
Linux after installing dependencies in both checkouts:

```sh
python3 scripts/benchmark-runner.py --baseline /path/to/pr3-checkout \
  --candidate "$PWD" --out /tmp/witnessqa-benchmark-new \
  --browser /path/to/the/same/chromium
```

The baseline used commit `28542101fda488c2ccf3309fd2e6eb1b4daea265`. The checked-in
fixture is synthetic; no DOMOD screenshots, data or session files are included.
