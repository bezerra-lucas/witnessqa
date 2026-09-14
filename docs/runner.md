# Running WitnessQA in CI and on a VPS

Witness runs against an **existing application URL**. Bring a preview environment,
versioned scenarios, a test account and isolated data. This repository provides
the worker, a composite GitHub Action and a Docker/Compose deployment; it does
not provision your application, database or a hosted Witness control plane.

## Install and diagnose

From a checkout pinned to the commit you want to run:

```sh
npm ci
node cli.mjs install-browser --with-deps
node cli.mjs doctor --base-url https://preview.example.com \
  --auth /private/test-account.json --ready '[data-testid="app-ready"]' --out /tmp
node cli.mjs run witness --base-url https://preview.example.com --jobs 1
```

`install-browser` calls the **installed playwright-core version**, fixed in both
package manifests and lockfiles. It does not resolve a second Playwright package
through npx. Browser executables are reused when already installed. An explicit
browser path is authoritative: a broken override is reported instead of silently
falling back to a different browser.

`doctor` checks the browser launch, storage-state structure, output permissions
and HTTP navigation. `--ready` should identify a state available to the authenticated
user. A 200 response alone does not prove that a session is valid. Diagnostics
return exit 2 for a blocked check and do not print input URLs, cookies or raw
browser errors. They expose host free RAM and readable cgroup v2 limits; they do
not claim to predict the resources required by your application. Doctor does not
verify the deployed commit: keep that check in your deployment/CI integration.

## VPS with Docker Compose

```sh
docker compose build
export WITNESS_PROJECT_DIR=/srv/my-project
export WITNESS_UID=$(id -u)
export WITNESS_GID=$(id -g)
docker compose run --rm witness doctor --base-url https://preview.example.com \
  --auth /work/.witness/auth/test.json --ready '[data-testid="app-ready"]'
docker compose run --rm witness run witness --base-url https://preview.example.com \
  --auth /work/.witness/auth/test.json --jobs 1 --capture checkpoints \
  --out .witness/runs/pr-123-head-sha
```

Compose supplies an init process, a default ceiling of 2 CPUs / 2 GiB RAM, a PID
limit and one scenario slot. These are starting limits, **not a measured sizing
recommendation for DOMOD**. Increase them only after profiling the application and
browser together. Browser contexts isolate cookies/local storage, not backend
records: keep one job when tests share an account or mutate the same entity.
Match the container UID/GID to the writable project directory. The worker runs
as a non-root user by default. The Docker build context allowlists runtime source
and package files, excluding sessions, runs and consumer application files.

The image contains the CLI for `run`, `cover`, `doctor` and reporting. Native
`witnessqa ci` additionally requires a clean **Git checkout** for its existing
immutable-harness verification; a source-only Docker image cannot satisfy that
contract. Keep the SHA-pinned native installation described in [native-ci.md](native-ci.md).

Do not bind the report server publicly to share private results. Download the
sanitized Actions artifact, or serve it behind your own authenticated access.
Keep REPORT.html and REPORT.assets together.

## GitHub Actions

```yaml
permissions:
  contents: read
  pull-requests: write # only needed for the PR comment
concurrency:
  group: witness-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
jobs:
  witness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Prepare your preview and ephemeral storageState before this step.
      - uses: bezerra-lucas/witnessqa@<reviewed-commit-sha>
        with:
          mode: run
          scenarios: ./witness
          base-url: https://preview.example.com
          auth: .witness/auth/test.json
          jobs: '1'
          capture: checkpoints
```

The Action now defaults to `run`. Use `mode: cover` explicitly for discovery.
Browser binaries are cached by OS, architecture and lockfile; OS dependencies
are installed on the runner. Inputs are passed through environment variables,
never interpolated as shell commands. Unknown modes fail the gate.

A bot comment is updated per artifact name, links to the Actions run and names
the exact tested head SHA. Before updating, the helper checks the current PR head
and refuses to overwrite a newer run. Configure Actions `concurrency` as above to
cancel obsolete work; the CLI has no GitHub-wide scheduler. Fork PRs can run with
`comment-pr: 'false'` when their token cannot write comments.

## Discovery versus regression

Run `cover --discover-only --ready '[data-testid="app-ready"]'` once to draft
route smoke tests. Review their assertions and copy the YAMLs into your versioned
suite. Each discovery needs a fresh directory. Multiple targets get separate
subdirectories; old maps and results are not silently reused.

With `ready`, cover waits for that selector and emits the same readiness condition
in the generated scenarios, without a generated 2-second sleep. The condition
must mean the **page-specific state is ready**, not merely that the navigation
shell exists. Discovery without a declared condition retains its conservative
legacy waits. Existing YAML `wait` steps are never removed automatically.
