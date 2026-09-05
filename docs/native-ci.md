# Native CI interface

WitnessQA exposes one small, headless interface for controllers that do not use
GitHub Actions:

```bash
witnessqa --version-json
witnessqa ci --job /private/request.json --out /private/new-output
```

The second command executes the scenarios selected by a frozen agent plan in a
real Playwright worker. It is an observation seam, not a release approval seam.
A controller must inspect the resulting evidence separately and keep its final
gate outside WitnessQA.

## Version identity

`--version-json` prints one JSON object:

```json
{
  "schema": "witnessqa-version/v1",
  "interface": "witnessqa-ci/v1",
  "version": "0.3.0",
  "head_sha": "0000000000000000000000000000000000000000",
  "package_lock_sha256": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

The command fails when the Git checkout is absent or dirty. An installed
executable copied from `cli.mjs` must still be byte-for-byte identical to that
tracked file. The probe and each CI result also bind the SHA-256 of the tracked
`package-lock.json`. Together these values bind the controller's executable and
locked dependency graph to a clean source tree instead of trusting a
self-reported `git rev-parse` value. The install must also be root-owned and
read-only to the job user so installed dependencies cannot change and then be
restored during a run.

## Request and plan

`ci` accepts only the exact `--job <json> --out <new-dir>` argument sequence.
The request schema is `domod-witness-request/v1` and carries:

- a 32-character job id and the SHA-256 of the controller-owned job;
- the repository, remote, PR, checkout, base SHA and HEAD SHA of the subject;
- absolute, controller-owned DoD and plan paths with SHA-256 digests;
- only the environment variable names explicitly passed to the worker.

The DoD uses `domod-dod/v1`. The pre-observation plan uses
`witness-agent-plan/v1`, is bound to the subject HEAD and DoD digest, identifies
an agent, and maps every criterion to a `kind: journey` scenario. WitnessQA
rejects an empty plan, partial criterion coverage, a scenario with fewer than
two non-empty steps, assertions and rejection conditions, literal fill
credentials, unknown evidence kinds and any identity drift.

Set `WITNESS_CI_SCENARIO_DIR` to an absolute, controller-owned directory outside
the candidate checkout. A plan's `scenario` matches either a top-level scenario
filename without its extension or its declared `name`. The directory must not
contain ambiguous identities. Every selected scenario is hashed before the
browser starts and checked again afterwards. A scenario step contains exactly
one action understood by the real executor. A generic visibility check or an
`expectUrl` that merely repeats `/`, the application origin or the URL just
navigated to does not count as a journey assertion.

Supported required evidence kinds are:

| Kind | Sanitized artifact |
| --- | --- |
| `json` | Per-flow `result.json` |
| `screenshot` or `png` | Last referenced PNG |
| `html` | Sanitized `page.html` |
| `url` or `text` | Sanitized `url.txt` |
| `report` | Regenerated allowlisted `REPORT.html` |

Credentials are provided only through declared `DOMOD_*` or `WITNESS_*`
variables. Browser selection may additionally use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `CHROME_PATH` or `CHROMIUM_PATH`. Literal
credential values never belong in a job, plan, scenario, argv, log or evidence.

## Result and exit status

The new output directory contains `result.json` in
`witnessqa-ci-result/v1`, `observation.json`, and a regenerated `evidence/`
bundle. Evidence references use `privacy_version: 1` and SHA-256 digests. The
result binds the job, harness HEAD/version/package-lock digest, subject HEAD, DoD digest, plan
digest, scenario hashes, observation and every criterion artifact.

- Exit `0`, `status: complete`: every planned real journey executed and its
  low-level scenario verdict was `pass`.
- Exit `1`, `status: failed`: a real journey produced `fail` or `warn`.
  Sanitized evidence is preserved, but the controller must reject the gate.
- Exit `2`, `status: blocked`: infrastructure, absent/empty/unknown output,
  unsafe input, unsupported evidence, incomplete journey or identity drift.

Only exit `0` is eligible for later agent inspection. Even then, `complete`
means “observed”, never “approved”. A fresh output path is mandatory on every
attempt; WitnessQA does not resume or reuse CI evidence. Its existing parent
must be controller-owned, non-writable by group/others and free of symlink
traversal. WitnessQA verifies that parent before creation and rechecks both its
inode and the created real path before writing evidence.

## Reproducible install from a remote SHA

Use a reviewed 40-character SHA that exists in
`https://github.com/bezerra-lucas/witnessqa.git`. Build the install in a new
directory; never mutate a directory used by an active job. The runtime requires
Node.js 20 or newer, matching both the package manifest and the locked
Playwright release.

```bash
witnessqa_ref=<reviewed-40-character-sha>
test "$(printf '%s' "$witnessqa_ref" | tr -cd '0-9a-f' | wc -c)" -eq 40

sudo install -d -m 0755 /opt/witnessqa
sudo git clone https://github.com/bezerra-lucas/witnessqa.git /opt/witnessqa/bin
sudo git -C /opt/witnessqa/bin checkout --detach "$witnessqa_ref"
test "$(sudo git -C /opt/witnessqa/bin rev-parse HEAD)" = "$witnessqa_ref"

sudo npm --prefix /opt/witnessqa/bin ci --omit=dev --ignore-scripts
sudo install -m 0755 /opt/witnessqa/bin/cli.mjs /opt/witnessqa/bin/witnessqa
sudo chown -R root:root /opt/witnessqa/bin
sudo chmod -R go-w /opt/witnessqa/bin
sudo git config --system --add safe.directory /opt/witnessqa/bin

sudo -u ci-native /opt/witnessqa/bin/witnessqa --version-json
sha256sum /opt/witnessqa/bin/witnessqa /opt/witnessqa/bin/package-lock.json
```

The copied `witnessqa` file is intentionally ignored by Git, but the executable
self-check requires it to equal the tracked `cli.mjs`. The adapter should record
the printed HEAD/version/package-lock SHA-256 and the executable SHA-256 in its
trusted job. Keep the scenario directory and ephemeral credentials outside `/opt/witnessqa/bin` and
outside the pull-request checkout. The system-level `safe.directory` entry is
needed because the immutable checkout is root-owned while the identity probe
runs as the unprivileged job user.
