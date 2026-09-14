# WitnessQA

WitnessQA is the quality-observation context for exercising a product as a user
and preserving auditable evidence. It produces observations; release approval
belongs to the consumer that owns the product's acceptance criteria.

## Language

**Flow / Fluxo**:
A user objective or process, potentially spanning several screens. A flow groups
related tests; it is not a screenshot, a route, a step, or an individual execution.
_Avoid_: Using journey, screen, stage, and flow as interchangeable hierarchy levels

**Test / Teste**:
A specific scenario with preconditions, actions and assertions inside a flow.
The result belongs to an execution of this test. Existing YAML/JSON scenario
files are executable test definitions; `name` remains their compatibility identity.
_Avoid_: Calling every scenario a separate flow when an explicit flow is declared

**Scenario / Cenário**:
The executable YAML/JSON representation of a test. Retained in CLI commands,
file formats and native CI for compatibility, not a fourth report hierarchy level.

**Journey / Jornada**:
A description of a broader user experience or a report title. In native CI,
`kind: journey` still means a non-trivial test reaching a specific user outcome.
It is not an alternative label for Flow or Test in the report hierarchy.

**Agent plan**:
A frozen mapping from acceptance criteria to the journeys that will observe them.
_Avoid_: Test list, ad-hoc prompt

**Observation**:
The immutable record of what happened while executing a journey, before any approval decision.
_Avoid_: Approval, signoff

**Evidence / Evidência**:
A sanitized artifact supporting an observation, belonging to one test execution.
It retains run identity, test identity, source, content hash, and capture time or
step association when known. It can be an image, JSON, text, or another supported
artifact. A JSON execution record is not a screenshot or an additional assertion.
_Avoid_: Raw capture, proof without provenance, using old images to fill a current run's gaps

**Verdict**:
The execution-level classification of a scenario as pass, fail, warn, or blocked.
_Avoid_: Release decision

**Blocked**:
A verdict meaning the journey did not produce a complete, trustworthy observation.
_Avoid_: Pass with caveats, unknown success

**Agent inspection**:
A post-execution evaluation that relates frozen observations to every acceptance criterion.
_Avoid_: Collection, automatic approval

**Approval**:
A consumer-owned decision made only after complete observations and agent inspection satisfy the acceptance criteria.
_Avoid_: Passing scenario, successful collection

## Report hierarchy and compatibility

**Fluxos → Testes → Evidências** is the presentation hierarchy. The selected
execution is global context, not a fourth navigation level. Screens are metadata.
Results and artifacts from different executions never share a test-execution
identity. Historical references without a verified test association stay outside
the evidence collection and cannot affect counts or verdicts.

The native CI v1 schemas keep `scenario`, `kind: journey`, `flows` and
`flow_count` unchanged. Those legacy wire names refer to executed scenarios;
renaming them requires a separately versioned migration, not a report redesign.
