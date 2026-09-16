# Midscene integration validation — 2026-09-16

## Scope and result

Midscene 1.12.7 executed the repository's synthetic shopping application with a
real `gpt-5.6-luna` model through Codex app-server (CLI 0.154.0, reasoning effort
`low`). Chromium was 151.0.7922.34. The dedicated validation container had limits
of 2 CPUs and 2 GiB on the development VPS. No DOMOD session or business data
was used in this model run.

| Check | Observed result |
| --- | --- |
| Add to cart exactly twice | Agent clicked twice; deterministic badge assertion passed |
| Navigate to cart and confirm synthetic order | Agent opened the cart and clicked Pagar; URL/text assertions passed |
| Verify confirmation visually | AI assertion passed with a screenshot |
| New session: require confirmation before payment | AI assertion failed, as expected |
| Combined execution gate | Exit 1 because the negative control intentionally fails |
| Live-validation script | Exit 0 because the expected pair was `pass / fail` |

This is evidence of browser execution against running code, not evidence that
DOMOD's business journeys are covered or that PR acceptance criteria are
generated autonomously. The shared DOMOD test was initially blocked by automatic
approval review, which required explicit authorization for admin navigation and
sending its screenshots/content to the model provider. The user subsequently
authorized that scope; the resulting execution is recorded below.

The synthetic app's cart contents are static and its confirmation button reveals
a local message. These checks exercise browser actions and visible assertions;
they do not verify cart persistence, totals, a payment backend or a complete
business checkout.

## Measurements

| Measurement | Successful live-validation attempt |
| --- | ---: |
| Wall time, both scenarios | 44.80 s |
| CPU time, entire dedicated cgroup | 10.29 s |
| Peak cgroup memory, sampled every 100 ms | 726.13 MiB |
| Model calls reported | 8 |
| Input tokens reported | 163,841 |
| Output tokens reported | 659 |
| Total tokens reported | 164,500 |
| Optional runtime Docker image, uncompressed | 570,671,807 bytes |

The image figure is disk storage; it is not RAM consumption. The execution
figure includes Chromium, Node and Codex. The optional runtime image itself
does not bundle Codex, the test suite or Git. The validation image separately
adds those tools. The default production dependency install still added only
15 packages and did not install `@midscene/web`.

One execution is not a benchmark distribution. Provider token counters may
include cached input; this run did not record a cached/uncached breakdown and
does not establish a currency cost. The token total is substantial for this
small journey. A direct model API could reduce harness overhead, but that
comparison has not been measured. No efficiency improvement is claimed here.

## Validation and preserved failure

- The full automated suite passed: **116 tests, zero failures**, Node 22, 2 CPUs,
  2 GiB. The new transport test uses the actual SDK and browser with stubbed
  model responses; it checks screenshot masking, true/false/malformed responses,
  token accounting, deadline cancellation and cleanup of temporary SDK logs.
- The optional runtime Dockerfile built successfully with
  `WITNESS_WITH_MIDSCENE=1`; `witnessqa doctor` passed as the image's `node` user.
- The first live attempt produced `blocked / blocked` after 242.84 seconds.
  Codex could not validate the TLS certificate chain inside that container.
  No model usage was reported. This does not prove zero provider billing.
- The successful attempt used the same criteria and a read-only mount of the
  host's trusted CA bundle via `SSL_CERT_FILE`. Certificate validation stayed
  enabled. Both attempts are retained in the delivered evidence bundle.
- The local environment could not download Chromium (timeouts/502), so browser
  validation was performed on the VPS instead.

Reproduce the live check with the instructions in [Midscene execution](../midscene.md).
Use a new output directory to preserve each attempt.

## Authorized DOMOD development run

After explicit user authorization, the same runtime code from PR #5 commit
`27e10bc2c036e19162bba7351dde54b6f0e3199d` was tested against DOMOD development.
SHA-256 hashes of the adapter, executor, privacy guard, packer and report view in
the container matched that checkout before execution. No engine changes were
needed. A validation script called `runScenario` and `packRun` directly so it
could apply a browser request guard without changing product behavior.

The QA admin login was deterministic and ran before invoking the model. Each
scenario received its own authenticated browser context. Subsequent browser
requests were restricted to approved hosts and GET/HEAD/OPTIONS; WebSockets and
service workers were blocked. Zero disallowed requests were observed. This is
a navigation guard, not full application isolation or proof that GET handlers
cannot have server-side effects.

| Criterion | Result |
| --- | --- |
| Open organization, then project through natural-language instructions | PASS; resulting project URL checked deterministically |
| Open units through natural-language instructions | PASS; units URL checked deterministically |
| Find the QA client's unit in the visible list | PASS; visual assertion plus deterministic text assertion |
| Require a nonexistent organization in a fresh session | FAIL, as expected for the negative control |

| Measurement | DOMOD run, both scenarios |
| --- | ---: |
| Wall time, execution and report, excluding authentication | 41.63 s |
| CPU time, dedicated container cgroup | 10.96 s |
| Peak cgroup memory, sampled every 100 ms | 1,159.38 MiB (1.13 GiB) |
| Model calls | 7 |
| Input / output tokens reported | 141,657 / 592 |
| Total tokens reported | 142,249 |
| Screenshot files | 5 |
| Report HTML | 73,047 bytes |
| Blocked browser requests / OOM events | 0 / 0 |

Model, Codex version, browser, reasoning effort and container limits matched the
synthetic run. This is a different application and workload; the figures do not
establish an optimization against that earlier run. Token counts do not establish
subscription usage or monetary cost, and cached input was not measured separately.

The combined report correctly remains FAIL (exit 1), because it contains the
intentional negative control. The integration validation succeeded because the
predeclared pair `pass / fail` was observed. No known failure was reclassified.
The run does not approve the whole DOMOD application or validate business writes,
personalization persistence, contracts or payment flows.

Session files, the temporary QA credential file and the execution container were
removed after the run. The active native runner was not upgraded. The delivered
private evidence bundle contains scenarios, original results, screenshots, report,
resource measurements, deployed image/revision identities and the reproduction
script, without credentials or session state.
