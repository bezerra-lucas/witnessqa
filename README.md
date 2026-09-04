# WitnessQA

**AI agents that use your app like a real user — and hand you the evidence.**

The product is a **coverage engine**: discover every screen, assert real content, hand you one self-contained dossier.

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

Chrome/Chromium on the machine (or `npx playwright install chromium`).

```bash
npx witnessqa init
# edit witness.config.yaml → targets + auth
witnessqa login witness/login.yaml
witnessqa cover                 # discover + run + open the report
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

Manual YAML still works (`witnessqa run`). Prefer `cover` — it writes one scenario per discovered screen with heading + visible-error asserts, not `expectVisible: body`.

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
| `witnessqa cover [url]` | Discover routes (nav + clicks + wizards), generate YAML, run, serve the dossier |
| `witnessqa login [file]` | Save Playwright storageState |
| `witnessqa run [names…]` | Run existing YAML |
| `witnessqa report [runs…]` | Pack + serve `http://127.0.0.1:8765/REPORT.html` |
| `witnessqa diff a b` | Compare verdicts across two runs |
| `witnessqa vdiff a b` | Pixel visual-diff of screenshots |
| `witnessqa notify [run]` | Discord/Slack webhook on verdict |
| `witnessqa list` | List scenarios |

## GitHub Action

```yaml
- uses: bezerra-lucas/witnessqa@main
  with:
    mode: cover
    base-url: https://staging.example.com
    auth: .witness/auth/login.json
    api-key: ${{ secrets.OPENROUTER_KEY }}
    discord-webhook: ${{ secrets.DISCORD_WEBHOOK }}
```

Job fails only on **FAIL**. Artifact = full dossier. PR gets a comment.

Docker (same CLI, CI/cloud):

```bash
docker build -t witnessqa .
docker run --rm -v $PWD:/work witnessqa cover
```

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
