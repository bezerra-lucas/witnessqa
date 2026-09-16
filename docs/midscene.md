# Midscene execution (optional)

Witness can use Midscene 1.12.7 to navigate a browser and inspect screenshots
from natural-language instructions. Playwright still owns the browser and the
isolated session; Witness owns the scenario, assertions, deadlines, evidence and
exit code. Existing deterministic scenarios do not load Midscene or a model.

This is the execution layer. It does not yet generate acceptance criteria from
a PR/Trello card, provision an isolated copy of the application, or promote
generated tests into a regression suite. Browser-context isolation does **not**
isolate application data or external side effects.

## Install and configure

Install the optional peer alongside Witness in the same project:

```sh
npm install witnessqa @midscene/web@1.12.7
npx witnessqa install-browser --with-deps
```

For a source checkout, `npm ci` includes the engine for development/tests.
`npm ci --omit=dev` leaves it out. The Docker image also leaves it out by default;
build the optional variant with:

```sh
docker build --build-arg WITNESS_WITH_MIDSCENE=1 -t witnessqa:midscene .
```

Configure a vision-capable model supported by Midscene. Model name, family and
endpoint must be explicit. For an OpenAI-compatible HTTPS endpoint:

```sh
export MIDSCENE_MODEL_NAME='<your vision model>'
export MIDSCENE_MODEL_FAMILY='<the corresponding Midscene model family>'
export MIDSCENE_MODEL_BASE_URL='https://your-provider.example/v1'
export MIDSCENE_MODEL_API_KEY='<secret supplied by your secret store>'
```

Alternatively, Midscene supports a separately installed/authenticated Codex CLI:

```sh
export MIDSCENE_MODEL_BASE_URL='codex://app-server'
export MIDSCENE_MODEL_NAME='<model available to the authenticated account>'
export MIDSCENE_MODEL_FAMILY='gpt-5'
```

The Codex binary and its authentication must exist in the execution environment.
They are not bundled into Witness or the optional Docker image. Do not bake
authentication into an image. `MIDSCENE_MODEL_REASONING_EFFORT` is optional.
If a container reports `invalid peer certificate: UnknownIssuer`, provide the
trusted system CA bundle through a read-only mount and `SSL_CERT_FILE`; do not
disable TLS certificate verification.
Native CI's restricted environment accepts the equivalent `WITNESS_MIDSCENE_*`
variables; these take precedence over the unprefixed variables.

## Scenario

```yaml
name: open-units
app: https://admin.example.com
auth: .witness/auth/admin.json
midscene:
  timeoutMs: 60000
  replanningCycleLimit: 8
steps:
  - goto: /projects
  - aiAct: Open the project named QA Sandbox, then open its units list. Do not change any data.
  - expectUrl: /units
  - aiAssert: The units list visibly contains the QA unit named Unit 101.
  - expectText: Unit 101
```

Run this through the normal `witnessqa run` command. Use `--jobs 1` initially:
each additional scenario can consume another model stream and browser context.
Use a private storage state or deterministic `fill` steps for authentication.
Environment-variable references in AI prompts are rejected. Do not write literal
credentials into prompts either.

`aiAct` can click, type, scroll and navigate. It is not inherently read-only:
instructions alone are not an enforcement boundary. Only authorize destructive
actions against an application with isolated data and integrations.

`aiAssert` checks the current screen. Completing an action is not an assertion;
every scenario with AI steps must include an explicit assertion. Prefer
deterministic assertions alongside visual checks for URLs, exact values and
known business invariants. A visual check cannot prove backend persistence or
full business coverage by itself.

## Results, privacy and limits

- False or malformed assertion responses fail the scenario; there is no retry
  that weakens the expectation. A timeout or missing configuration prevents a
  successful exit. Existing Witness verdict/exit-code conventions remain in use.
- The adapter uses Midscene's structured query API for `aiAssert` and requires an
  actual boolean `true`. The SDK's built-in assertion coerces values, so a string
  such as `"false"` is deliberately rejected by Witness.
- Every AI step requires a screenshot, even under the checkpoints policy. A
  missing capture prevents that step from passing.
- The result records engine/model, step duration, task summaries and token usage
  reported by the provider. Token counters are not a monetary cost estimate.
- Before inference, screenshots pass through Witness's field/region masking.
  DOM extraction is disabled. Add `redaction.selectors` for private regions the
  default masks cannot recognize. Prompts and visible unmasked content are sent
  to the selected model provider; masking is not anonymization of all page data.
- Native Midscene reports/dumps are disabled. Its diagnostic logs use a private
  temporary directory and are removed when the last session closes. Witness is
  the evidence/report source.
- Each AI step defaults to 60 seconds (maximum 120 seconds); action planning
  defaults to 8 cycles (maximum 20). Deadline failure ends the scenario and
  closes the browser context. An in-flight provider request may still finish
  and incur usage after local cancellation; provider cancellation is best effort.
- The integration test uses the real SDK and Chromium with a stubbed model
  endpoint to verify masking, usage, failure handling and deadlines. It is not
  evidence of a live model's reasoning quality.

See [Midscene model configuration](https://midscenejs.com/model-config) and
[Playwright integration](https://midscenejs.com/integrate-with-playwright).

## Reproduce the live-model validation

From a source checkout with the provider configured and Chromium installed:

```sh
npm run test:midscene:live -- .witness/midscene-validation/attempt-1
```

This serves the repository's synthetic shopping app on loopback. It asks the
agent to add two items, navigate to the cart and confirm a synthetic order,
then checks the result with deterministic and visual assertions. A second,
fresh session checks for confirmation **before** payment and must fail. There
are no real payment calls or application credentials. Scenarios, results,
screenshots, logs, token usage and resource measurements remain in the output.

The script succeeds only for the expected pair `pass / fail`; the report's
combined gate remains nonzero because it includes the intentional negative
control. Use a fresh output directory for each attempt. Container resource
measurements cover the entire cgroup, so run this in a dedicated container for
meaningful numbers.
