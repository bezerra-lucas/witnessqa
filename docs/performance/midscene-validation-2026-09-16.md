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
generated autonomously. The shared DOMOD test was not executed: automatic
approval review required explicit authorization for admin navigation and sending
its screenshots/content to the model provider. The prepared DOMOD plan is
navigation-only (organization → project → units), with a nonexistent-organization
negative control; it must not be presented as executed.

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
