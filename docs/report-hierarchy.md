# Report structure: Flows → Tests → Evidence

The report starts with flows, not a gallery. Open a flow to see its tests, then
open a test to inspect its result and evidence. Steps and screens are details of
a test; they are not additional tests or flows. The selected run is global context.

## Declaring a flow and test

Existing scenarios remain valid. Add optional presentation metadata to group
related tests deliberately instead of inferring groups from screenshots or URLs:

```yaml
name: checkout-confirmation
testId: checkout-confirmation
title: Confirm an order with the selected payment method
flow:
  id: checkout
  title: Complete an order
  description: Review the order and confirm the purchase.
app: http://127.0.0.1:8765
steps:
  - goto: /cart.html
  - click: "#pay"
  - expectText: Pedido confirmado
    evidence:
      label: Order confirmation
      highlight: true
```

`name` is still the scenario's executable identity. `testId` defaults to `name`;
`title` supplies a reader-facing title. A flow can also be a non-empty string.
Explicit flows are grouped by flow identity **and application origin**, within
one run. Without `flow`, each scenario gets a clearly labeled individual group;
the report does not invent a business process from a route.

## Evidence selection and integrity

The default view features one screenshot per opened test: a failed step's image,
then a declared highlight, otherwise the last available screenshot. All other
captures are retained behind “Other captures of this test.” Exact byte duplicates
are labeled within the same test execution only. Similar-looking images are not
automatically deleted or declared identical. This selection changes presentation,
not the executor's capture policy, verdict or recorded assertions.

The executor records capture completion time separately from test start time,
plus the associated step and optional label. Older results have an explicit
unknown capture time; filenames and test start times are not presented as exact
capture timestamps. Images are not retouched to improve their appearance.

The sanitized `result.json` is also available as a JSON execution record. Its
displayed content hash covers the sanitized representation; the test's source
hash separately identifies the source file. A JSON record is neither visual
coverage nor an independent check. Missing screenshot evidence stays visible.
Saving a JSON/text record preserves the UTF-8 bytes covered by its digest, even
when the HTML preview normalizes line endings or control characters.

## Run boundaries and history

Packing multiple run directories preserves repeated scenario names. The report
selects one run at a time; changing runs changes all counts and displayed flows.
The first input directory is the initial selection. Lightbox arrows remain in
the current test execution, never in a global cross-run gallery.

The shared renderer also accepts historical references supplied by an adapter.
They must explicitly identify their source and remain outside `evidence[]` when
their test association is unknown. They are collapsed within a flow, do not fill
visual gaps, and cannot contribute to results or current evidence counts.

## Compatibility and scope

`witnessqa run`, `cover`, `report` and the artifact exporter use the same canonical
renderer. The report is self-contained, with system-font fallbacks and no external
scripts, stylesheets, analytics or font requests. JavaScript adds filtering,
run selection, links that open collapsed parents, and a keyboard-accessible
lightbox; native details and all run sections remain readable without JavaScript.

`packRun().flows` remains a legacy alias for the selected run's scenario/test
count. New callers should use `tests` and `flowCount`. Native CI v1 field names,
gate rules, executor verdicts and privacy requirements are unchanged.

The public model is `witnessqa-report/v1`: `runs`, `flows`, `tests`, `evidence`,
and optional `references`. Every test identifies a flow and run. Every evidence
item identifies a test in that same run. Model validation rejects duplicate IDs
and cross-run associations, missing parent identities, and IDs reserved for
report controls. Screenshot dimensions must be positive integers (or both
unknown); duplicate references must point to a different original in the same
test execution. `renderReport()` is a rendering boundary, not a
sanitizer: callers must sanitize their records and images before supplying them.
`buildReportModel()` enforces the existing EvidenceGuard and safe-path boundary.

Automated success is not visual approval or permission to release. The report
does not change test verdicts to compensate for missing, old, or poor captures.
