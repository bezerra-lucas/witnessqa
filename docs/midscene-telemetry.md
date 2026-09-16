# Midscene model-call telemetry

Each scenario result now contains `aiCalls`, scoped by scenario and zero-based step index. Entries retain counts and timings only, never prompt text, raw responses, image payloads or authentication headers. `completed` means the model request completed, not that the acceptance criterion passed.

Fields include input/output/total tokens, cached and uncached input, reasoning output, message/image counts, decoded inline-image bytes, text character counts (including system text), start time and duration in milliseconds. Characters and bytes are not token estimates. Unknown cache is `null`, not zero. Provider/SDK-reported values are usage observations, not a billing receipt. The SDK can normalize missing usage fields; this is not an independent provider audit.

The boundary is one Midscene `callAI` invocation. Internal transport retries or Codex internal turns are not separately counted. The legacy `aiUsage` callback aggregate remains unchanged; semantic retries may cause call rows and that aggregate to differ. Interrupted requests may remain incomplete with unknown usage. Partial failed requests can consume tokens that the provider never reports.

The adapter instruments a private CommonJS boundary in pinned Midscene 1.12.7 before loading the agent. AsyncLocalStorage associates concurrent calls with the right scenario/step. Version upgrades require the real-SDK transport contract test. The telemetry unit tests check concurrency, unknown cache, failures and duplicate instrumentation.

## DOMOD development repetition — 2026-09-16

Same two authorized navigation scenarios, model `gpt-5.6-luna`, reasoning `low`, Codex app-server, 2 CPUs, 2 GiB, one job. The positive scenario passed; the intentionally false criterion failed. Combined report remains FAIL because it includes that negative control. This does not establish full DOMOD acceptance or complete application isolation.

| Call | Action | Input | Cached input | Uncached input | Output | Images | Duration s |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Open organization/project | 21,185 | 8,960 | 12,225 | 117 | 1 | 8.33 |
| 2 | Continue navigation | 22,390 | 8,960 | 13,430 | 113 | 1 | 4.69 |
| 3 | Confirm destination | 22,583 | 8,960 | 13,623 | 53 | 1 | 8.23 |
| 4 | Open units | 22,203 | 8,960 | 13,243 | 119 | 1 | 5.81 |
| 5 | Confirm units destination | 22,396 | 8,960 | 13,436 | 57 | 1 | 7.33 |
| 6 | Assert expected unit | 15,553 | 0 | 15,553 | 79 | 1 | 4.27 |
| 7 | Assert nonexistent organization | 15,561 | 8,960 | 6,601 | 79 | 1 | 4.39 |
| Total | | 141,871 | 53,760 | 88,111 | 617 | 7 | 43.04 |

Cache accounts for 37.89% of reported input. Five navigation calls each carry 32,323 system-text characters; assertions carry 2,689. Exactly one screenshot is presented at this boundary per call. This disproves an accumulation of screenshots in this particular run, but does not partition tokens between images, prompts and Codex-added context. The Codex SDK creates a fresh thread for each request; optimization of that lifecycle has not been implemented.

Wall time was 48.23 s versus 41.63 s previously; CPU was 11.56 s versus 10.96 s; sampled cgroup memory peak was 671 MiB versus 1,159 MiB. Only one run per configuration: no performance improvement can be attributed to telemetry. Total tokens were 142,488 versus 142,249. Previous cache usage is unknown because it was not saved.

Three adapter contract tests passed in the VPS with real Chromium and SDK; two telemetry unit tests passed locally. Live source hashes were checked against the published source. Credentials remained temporary and were removed with the container. No changes to native runner or main branch.

Next decision: compare a smaller planner/system prompt and a leaner provider path under these same acceptance criteria. Do not optimize by removing assertions or changing the negative control. Price cannot be inferred from these token counts under the current ChatGPT-authenticated execution.
