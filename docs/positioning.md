# Why choose WitnessQA?

Witness helps a team decide whether a change behaves as expected in the running
application. Its deliverable is a result organized as **flows → tests → evidence**,
with the expected behavior, observed failure and the execution that produced it.
The native CI contract binds a frozen plan and required evidence to a subject
commit; collecting evidence alone never grants approval.

| Alternative | What the user gets | What Witness should add |
|---|---|---|
| CodeRabbit and code review platforms | Feedback on the code change in the PR workflow | Repeatable observation of the application, tied to acceptance criteria and evidence |
| An E2E suite maintained in-house | Automated regression assertions and control over the test framework | A packaged execution, privacy, reporting and evidence-validation workflow that saves integration and triage work |
| A QA professional/team | Business context, exploratory judgment and investigation | Repeatable execution and evidence collection that expands the team's capacity |

These capabilities overlap. Screenshots and browser execution alone are not a
competitive moat; an E2E suite can provide both. Witness is useful when operating
the runner, producing reviewable evidence and tying it to the delivery workflow
cost less than assembling those parts independently. A team already satisfied
with its E2E/QA process may not benefit from another tool.

Today the user still defines business expectations, test data and environments.
Discovery generates smoke-test drafts, not comprehensive business coverage.
BYOK investigates observed failures; it is optional and does not determine the
release verdict. Docker/Compose and the Action simplify running the existing
worker, but are not a managed cloud service.

The practical lessons adopted from PR-oriented review tools are low setup effort,
a concise result in the PR, one updated comment instead of repeated notifications,
and explicit treatment of obsolete revisions. Future work should focus on
planning by change risk, editable business rules, safe impact-based selection and
a hosted runner lifecycle. Those need their own implementation and validation.

Measure value as time to useful evidence, time spent on triage, false positives,
missed regressions and cost per validated change. Counting visited pages or images
can reward volume without improving the user's confidence in a release.
