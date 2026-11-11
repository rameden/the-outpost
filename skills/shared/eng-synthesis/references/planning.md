# Planning, sequencing and roadmaps

For "how do we ship this", phasing, migrations, dependency mapping, quarter plans.

## Contents
1. Plan structure
2. Phasing rules
3. Dependency matrix
4. Exit criteria
5. Risk register
6. Evidence-based sequencing
7. Migration plans
8. Milestone breakdown for teams

---

## 1. Plan structure

1. **The one-line plan** — phases, dates, the single critical-path dependency.
2. **Phases in narrative** — one column/paragraph per phase: what ships, what it waits for.
3. **Dependency matrix** — components × phases (§3).
4. **Exit criteria per phase** — measurable (§4).
5. **Risk register** (§5).
6. **What slips if X slips** — one paragraph.
7. **Open decisions** with owners and the date they're needed by.

## 2. Phasing rules

- **Phase 0 runs on what exists.** Wrap, reshape, and expose current services with no dependency on unfinished initiatives. It de-risks everything after it and proves demand early.
- **Each later phase names its gates by name** — not "after the platform work", but "I4 stream engine" or "severity label live with eval card".
- **Gate on the specific deliverable, not the whole initiative.** "Gated on composite risk score and LEI crosswalk landing, not on I2 as a block."
- **Order by demand and risk, not by architecture purity.** Things customers ask for most go first; things whose buyers aren't yet engaged are queued behind a paying sponsor or a pilot.
- **If an upstream slips, only its dependents slip.** Structure so everything to the left still ships.
- **Deprecation has a date.** Legacy surfaces enter a dated window with aliases; telemetry on alias usage decides retirement order.

## 3. Dependency matrix

| Component | Phase 0 (date) | Phase 1 (date) | Phase 2 (date) |
|---|---|---|---|
| component name | what ships · `no dep` | what ships · `depends: <gate>` | … |

Rules: every cell says what ships, not just "continued work". Every dependency names an owner team. Mark cells `no dep` explicitly — it's the most reassuring word in a plan.

For a visual, a Gantt-style timeline with platform rows solid and upstream initiative rows dashed works well.

## 4. Exit criteria

Each phase gets 4–8 criteria that are measurable and checkable by someone outside the team:
- Performance: "default response under 4,000 tokens; p95 under 1.5 s on isolated pool".
- Coverage: "every current tool has a mapped primitive or documented retirement".
- Reliability: "zero product incidents attributable to agent load in the quarter".
- Adoption/business: "first metered revenue reported"; "cold-start rate below 30% from 53%".
- Quality: "basis present on 100% of schema fields".

Avoid: "feature complete", "stable", "customers happy".

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation | Owner | Trigger to act |
|---|---|---|---|---|---|

Include at minimum: upstream team slips, cost overrun at scale, data/privacy exposure, migration breaking existing customers, key-person dependency, unvalidated demand.

## 6. Evidence-based sequencing

When the material includes demand evidence (calls, tickets, telemetry, ARR, ideas portal):
- Rank work items by validated demand, with verdict levels: **Validated, large · Validated · Emerging · Thin · Not found**. Define the thresholds you used.
- Cross-check: does Phase 0 cover the top-demand items? Does any late phase hold something with large demand? Flag mismatches.
- Note who is and isn't "in the room": if a planned capability serves a buyer who rarely appears in the evidence, recommend a paid design partner or pilot before building.
- Recommend catalog edits: merge thin items into validated neighbours; add cards for uncovered demand.
- Keep caveats attached (mentions ≠ willingness to pay; exposure ARR ≠ attributable revenue; raw growth vs base growth).

## 7. Migration plans

Table: Today (endpoint/tool) · Becomes · Alias behaviour. Rules: every existing endpoint maps to something or has a documented retirement; aliases translate shapes and emit deprecation headers; existing integrations keep working until re-registered; the window has a date measured from a named phase.

## 8. Milestone breakdown for teams

When turning a plan into team work: break each phase into epics of 2–6 weeks, each with an owner team, a demoable outcome, and its upstream dependency. Flag any epic that needs two teams to land together — those are where schedules break. Suggest a parity or contract test where multiple surfaces must stay in sync.
