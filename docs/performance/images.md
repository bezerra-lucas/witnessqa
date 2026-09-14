# Evidence image optimization

The default capture is lossless WebP. Chromium's masked PNG is converted in
memory and discarded; no uncompressed/original PNG is saved alongside it.
The same captured resolution and every scenario step remain intact.

The privacy guard remembers one previous frame per scenario, so unchanged
consecutive screenshots reuse their encoding. File copies request copy-on-write
storage where supported, with ordinary independent copies as a fallback. Hard
links are deliberately not used: the native CI proof contract requires each
file to have a single link. Replacing one step cannot rewrite another step.

`REPORT.html` references one file per distinct image in `REPORT.assets/`.
Evidence IDs, timestamps and test/run ownership remain separate even when the
underlying image is shared. Existing PNG reports are still readable. An
explicit `png` criterion selects PNG as that native CI job's only format;
ordinary `screenshot` criteria use WebP.

## Measured effect

Linux x86_64, Node 24.19.0, Playwright 1.62.1, Chromium 153.0.8010.0. The worker
and its children were pinned to two CPUs. The baseline is report PR commit
`28542101fda488c2ccf3309fd2e6eb1b4daea265`.

Twelve synthetic dashboard scenarios ran six steps each. Every run retained
all 72 captures, with identical decoded pixels verified between baseline PNG
and the final WebP outputs. No assertions, fixed waits or screenshots were
removed. All 12 scenarios passed. This workload is intentionally repetitive,
so its deduplication benefit is not a prediction for an arbitrary application.

| Metric | Before, median of 2 | Final optimized verification, 1 run |
|---|---:|---:|
| Complete run artifacts | 20.40 MiB | 3.65 MiB |
| REPORT.html | 11.68 MiB | 0.30 MiB |
| Wall time | 20.65 s | 21.15 s |
| CPU time | 5.42 s | 6.26 s |
| Sampled peak process-tree PSS | 507 MiB | 571 MiB |

Artifacts shrank about **82%**, and HTML about **97%**. Encoding adds CPU and
temporary memory: this change optimizes storage, transfer and report payload,
not scenario execution latency. Two initial optimized runs had similar
durations (21.05 and 21.08 seconds). The final run additionally limits libvips'
cache to 8 MiB; it did not materially change peak memory in this fixture.

One dashboard capture fell from 124,400 bytes of PNG to 45,490 bytes of lossless
WebP, about **63% smaller**. Lossless effort 1 was selected after comparing
encoding cost and size: effort 0 was larger than the input, and lossy quality
82 was larger than the chosen lossless output for this particular UI.

Exact measurements and environment notes are in [image-benchmark.json](image-benchmark.json).
The measurements exclude installation, application build, external network,
LLM calls and uploads. The local fixture server is outside the worker resource
totals. Memory values are approximate samples, not enforced memory limits.

## Compatibility and verification

- PNG/WebP comparisons decode pixels, so changing only the codec does not
  appear as a new/removed screenshot or a visual regression.
- The visual diff still detects a deliberate image change.
- Tests verify masking, omission after failed encoding, safe replacement,
  separate evidence identities, native CI bindings and explicit PNG requests.
- Both file-based and HTTP reports display images and open the lightbox.
  HTTP downloads preserve the exact image bytes and filename. Browsers ignore
  the download attribute for local file origins; offline reports therefore
  offer **Abrir arquivo**, opening the exact image for the browser's Save action.
- Reports remain readable with JavaScript disabled. Keep `REPORT.assets/`
  beside the HTML, or copy/download the complete artifact ZIP.
- The image codec requires Node 20.9+ and the pinned Sharp dependency.

To compare with another application, run the unchanged and optimized workers
against the same scenarios and application revision, with fresh output
directories and identical `--jobs`. Compare all step verdicts and decoded
image pixels as well as time, CPU, PSS and artifact bytes. Do not treat fewer
captured checkpoints or skipped assertions as a compression improvement.
