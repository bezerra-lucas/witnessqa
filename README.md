# WitnessQA

**Validate your application’s user flows and review the evidence for each test.**

Run versioned journeys against your application, inspect failures by flow and test, and keep an offline evidence bundle. Native CI binds the plan and evidence to the tested commit. [Why Witness, alongside QA, E2E and code review](docs/positioning.md).

Screenshots are stored as **lossless WebP** at the captured resolution. The PNG
returned by Chromium exists only in memory; no original copy is retained.
Unchanged consecutive captures reuse their encoding and file contents while
keeping each step's filename and metadata. Reports load images on demand from
`REPORT.assets/`, with one file per distinct image, instead of embedding every
capture as Base64. Keep `REPORT.html` and `REPORT.assets/` together when copying a
report, or download the complete artifact ZIP. Legacy PNG runs remain readable,
and visual diff compares decoded pixels across PNG/WebP versions.

Node **20.9+** is required. A native CI criterion explicitly requiring `png`
keeps PNG as that job's single capture format; ordinary `screenshot` evidence
uses WebP. Changing the format does not remove steps or weaken their assertions.

```
$ witnessqa login
$ witnessqa cover

cover → admin
cover → cliente
  ✓ Dashboard
  ✓ Unidades
  …

laudo: http://127.0.0.1:8765/REPORT.html
```

## Quick start

Node 20.9+ and Chromium. Use `witnessqa install-browser --with-deps` for the exact browser version; `witnessqa doctor` checks the setup.

```bash
npm install -g witnessqa
witnessqa install-browser --with-deps
witnessqa init
# edit witness.config.yaml → targets + auth
witnessqa login witness/login.yaml
witnessqa run --jobs 1          # execute your reviewed scenarios
witnessqa cover --discover-only # optionally draft route smoke tests
witnessqa report                # serve the latest dossier
witnessqa diff <run-a> <run-b>  # verdict delta between two runs
```

`witness.config.yaml`:

```yaml
viewport: { width: 1440, height: 950 }
targets:
  - name: admin
    url: https://admin.example.com
    auth: .witness/auth/login.json
```

Use `run` for regression in every PR. Use `cover` explicitly to discover routes and draft smoke tests, then review/version their assertions. A discovered heading is not a complete business acceptance criterion.

For optional natural-language actions and visual assertions inside those scenarios,
see [Midscene execution](docs/midscene.md). The default installation and Docker
image remain deterministic; the AI engine and model access are opt-in.

`$WITNESS_EMAIL` / `$WITNESS_PASSWORD` expand in `fill.value`.

Credentials must stay in a CI secret store or ephemeral environment variables;
literal login values in tracked scenarios are rejected by the test suite. See
[SECURITY.md](SECURITY.md) for session handling, evidence masking and migration.
The verification record for this hardening is in the
[0.2.0 security release note](docs/releases/0.2.0-security.md).

Evidence is sanitized before it is written: form fields and configured private
regions are masked in screenshots, HTML/scripts and common PII are redacted, and
legacy unverified screenshots are not embedded into new reports. Mark additional
app-specific regions with `data-witness-redact` or scenario
`redaction.selectors`.

### Report: Flows → Tests → Evidence

Start with a user flow, open a test, then inspect that test execution's evidence.
Optional `flow: { id, title }`, `testId` and `title` metadata group related tests
without breaking existing scenario files. One meaningful capture is featured;
other captures remain collapsed, and JSON records are distinct from screenshots.
Multiple runs stay separate. See [the report model and metadata guide](docs/report-hierarchy.md).

### BYOK (free)

```bash
export WITNESS_KEY="sk-or-v1-..."
export WITNESS_MODEL="openai/gpt-4o-mini"
```

No key: runs still work, skip cause analysis.

BYOK receives sanitized diagnostics without page HTML by default. Sending a
sanitized HTML excerpt requires the explicit opt-in
`WITNESS_BYOK_INCLUDE_HTML=true`.

## Commands

| Command | What it does |
|---|---|
| `witnessqa doctor [--base-url URL] [--ready selector]` | Diagnose browser, session, application readiness and output access |
| `witnessqa install-browser [--with-deps]` | Install Chromium matching the pinned Playwright version |
| `witnessqa --version-json` | Report the immutable `witnessqa-ci/v1` harness identity |
| `witnessqa ci --job <json> --out <new-dir>` | Execute a frozen agent journey for native CI |
| `witnessqa cover [url]` | Discover routes (nav + clicks + wizards), generate YAML, run, serve the dossier |
| `witnessqa login [file]` | Save Playwright storageState |
| `witnessqa run [names…]` | Run existing YAML |
| `witnessqa report [runs…]` | Pack + serve `http://127.0.0.1:8765/REPORT.html` |
| `witnessqa diff a b` | Compare verdicts across two runs |
| `witnessqa vdiff a b` | Pixel visual-diff of screenshots |
| `witnessqa notify [run]` | Discord/Slack webhook on verdict |
| `witnessqa list` | List scenarios |

The native CI command is fail-closed, always requires a fresh output directory,
and never turns collection alone into approval. See the complete
[native CI interface and SHA-pinned installation guide](docs/native-ci.md).

## GitHub Action

```yaml
- uses: bezerra-lucas/witnessqa@main
  with:
    mode: run
    scenarios: ./witness
    jobs: "1"
    base-url: https://staging.example.com
    auth: .witness/auth/login.json
    api-key: ${{ secrets.OPENROUTER_KEY }}
    discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}
```

The public verdict/exit contract is: `pass`/`0`, `fail`/`1`, and
`blocked`/`2`. The release job succeeds only on **PASS**; both **FAIL** and
**BLOCKED** reject the gate. Internal warnings and unknown/empty results also
fail closed. Sanitized evidence still uploads with `always()`, and the PR
receives the verdict comment even when the gate is rejected.

Docker (same CLI, CI/cloud):

```bash
docker build -t witnessqa .
docker run --rm -v "$PWD:/work" witnessqa run witness --base-url https://preview.example.com
```

See [the VPS/Actions setup guide](docs/runner.md) for Compose, private sessions,
browser caching and cancellation of obsolete Actions runs. See [runtime performance](docs/performance/runner.md)
for readiness conditions, checkpoints, budgets, measurements and migration behavior.

## Roadmap

- [x] Cover engine (discover → assert → one dossier)
- [x] Human titles + grouped index + lightbox
- [x] Next.js noise filter (RSC abort, React #418)
- [x] Verdict diff between runs
- [x] Pixel visual-diff (`vdiff`)
- [x] Slack/Discord webhook (`notify` + Action input)
- [x] GitHub Action cover + PR comment + CI
- [x] Docker runner (cloud-shaped, no SaaS yet)
- [ ] Hosted dashboard / 1-click cloud account

## License

MIT
