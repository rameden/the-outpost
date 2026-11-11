# Architecture decisions

For "should we X or Y", platform design, component boundaries, build-vs-reuse, API shape, data placement.

## Contents
1. ADR template
2. Framing the decision
3. Options analysis
4. Principles with review tests
5. Common SaaS decision lenses
6. Anti-patterns

---

## 1. ADR template

```
# ADR-<n>: <decision as a short imperative, e.g. "Serve agent traffic from isolated pools">

Status: Proposed | Accepted | Superseded by ADR-<m>   Date:   Deciders:   Consulted:

## Context
What forces the decision now. Constraints with numbers (traffic, latency, cost, limits,
deadlines, regulatory dates). What exists today that is relevant.

## Decision
One paragraph. The choice, stated plainly.

## Options considered
Table (see §3). Include "do nothing / extend what exists".

## Consequences
Positive. Negative. What becomes easier, what becomes harder. New ops burden.
What we commit to maintaining.

## Review test
The question a reviewer applies to future PRs/schema changes to tell whether
they respect this decision.

## Reversibility
One-way or two-way door. Cost to reverse. Trigger that would make us revisit.

## Open items
Each with owner.
```

## 2. Framing the decision

Before options, write:
- **The decision in one sentence**, as a question with a deadline ("Do we build our own STT or reuse Whisper before the Q4 release?").
- **The deciding criteria, ranked.** If principles conflict, earlier wins — say the order.
- **What is fixed** (contracts, vendors, regulatory dates, team size) vs **what is variable**.

## 3. Options analysis

Rows are criteria, columns are options. Always include the reuse/extend option.

| Criterion | Option A | Option B | Option C (extend existing) |
|---|---|---|---|
| New work | | | |
| Latency / performance (with figures) | | | |
| Cost (unit cost and at expected volume) | | | |
| Coverage / compatibility | | | |
| Data leaves boundary? | | | |
| Ops burden / on-call | | | |
| Reversibility | | | |
| Dependencies on other teams | | | |

Follow with **Recommendation**: the choice, the one or two criteria that decided it, and the condition under which you'd pick differently. "Ship both behind a flag, default A, fall back to B" is a legitimate answer when the options cover different populations.

## 4. Principles with review tests

When the material defines architectural principles, or you're asked to propose them, give each three parts (this pattern is from the Agent Platform spec and is worth copying):

| Principle | Rule | Review test | Where it lives |
|---|---|---|---|
| One contract, many doors | All surfaces expose the same schemas, generated from one source | Is it reachable from every door with the same request body? If not, the change is incomplete. | Contract service; generated clients |

A principle without a review test is a slogan. A principle without a location in the system gets lost in implementation.

## 5. Common SaaS decision lenses

Run through these when evaluating any option:

- **Tenancy & isolation:** can one tenant/agent degrade others? Can we throttle it without touching product traffic?
- **Identity & audit:** is there a human principal behind every action? Is it logged?
- **Rights & data residency:** what may be returned, stored, exported; EU residency.
- **Metering & cost visibility:** can a caller know cost before and after?
- **Async:** anything over ~1 s should have a run/poll/webhook path.
- **Versioning:** additive changes; breaking changes behind a beta flag with dated deprecation.
- **Determinism:** do identical requests give identical results where it matters (aggregates, alerts)?
- **Observability:** per-component SLOs (p95), error budgets, request ids resolvable to traces.
- **Migration:** what happens to existing clients; alias layer; telemetry-driven retirement.
- **Build vs reuse:** which existing service is the seed? What does it lack?

## 6. Anti-patterns to call out

- Options table where only one option is realistic (straw men).
- Decisions justified by preference with no figure.
- A "new service" whose responsibilities overlap an existing one without a migration story.
- Two parallel registries/catalogs/validators for the same concept.
- Hard deletes where audit or undo matters.
- A future phase that silently depends on another team's initiative with no named gate.
