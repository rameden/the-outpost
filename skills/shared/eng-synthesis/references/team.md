# Team building, ownership and staffing

For "who builds this", team structure, hiring plans, ownership maps, RACI, onboarding.

## Contents
1. Derive teams from the architecture
2. Ownership map
3. Team topology
4. Staffing plan
5. Hiring profiles
6. Decision rights (RACI)
7. Onboarding pack

---

## 1. Derive teams from the architecture

Start from the components in the material, not from an org chart. For each component record: new vs existing, current owning team (if stated), change volume in the plan, on-call needs, and which other components it must ship in lockstep with. Components that always change together belong to one team; components with a stable contract between them can be split.

## 2. Ownership map

| Component / check | Status (exists, extend, new) | Owning team | Key contact | Backup | Notes |
|---|---|---|---|---|---|

Every row has an owner or `unassigned`. Unassigned rows on the critical path go straight into the risks and open questions. External teams (another org's scanner, a platform team's gateway) get a named contact and a status of the conversation.

## 3. Team topology

Classify proposed teams:
- **Stream-aligned:** owns a user-facing slice end to end (e.g., Mira Studio composer).
- **Platform:** owns shared contracts and services others build on (gateway, contract service, registry).
- **Enabling:** temporary, helps others adopt (developer experience, migration squad).
- **Complicated-subsystem:** deep specialist area (enrichment models, stream engine).

Call out interaction modes between teams (collaboration for a phase, then X-as-a-service). Too many collaboration links = coordination cost; flag it.

## 4. Staffing plan

| Phase | Team | Roles needed (count) | Have | Gap | Hire / borrow / contract | Needed by |
|---|---|---|---|---|---|---|

Sizing heuristics (state them as assumptions, not facts):
- A stream-aligned team: 4–7 engineers, plus shared design and PM.
- A new platform service with on-call: at least 4 engineers to sustain a rotation.
- Any role that exists in only one person is a key-person risk.
- Hiring lead time typically 2–4 months to start date; plan Phase 1 staffing during Phase 0.

## 5. Hiring profiles

For each gap: role title, level, the three things they'll own in their first 90 days, must-have skills (tied to the components), nice-to-haves, and the interview signal for each must-have. Keep requirements tied to actual work in the plan.

## 6. Decision rights (RACI)

| Decision | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|

Include at least: API/contract changes, deprecations, pricing/metering, data handling and rights, on-call escalation, scope changes mid-phase. One Accountable per row.

## 7. Onboarding pack

For new engineers joining the effort: the one-line version, the glossary of internal terms and initiative codes from the material, the ownership map, the five docs to read first (in order), the services they'll touch with repo paths, and the first good starter task from Phase 0.
