# WitnessQA

WitnessQA is the quality-observation context for exercising a product as a user
and preserving auditable evidence. It produces observations; release approval
belongs to the consumer that owns the product's acceptance criteria.

## Language

**Scenario**:
A declared sequence of user-facing actions and concrete assertions against one application.
_Avoid_: Test case, script

**Journey**:
A non-trivial scenario that reaches and verifies a specific user outcome.
_Avoid_: Smoke, route check

**Agent plan**:
A frozen mapping from acceptance criteria to the journeys that will observe them.
_Avoid_: Test list, ad-hoc prompt

**Observation**:
The immutable record of what happened while executing a journey, before any approval decision.
_Avoid_: Approval, signoff

**Evidence**:
A sanitized artifact that supports an observation and retains its origin and identity.
_Avoid_: Raw capture, proof without provenance

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
