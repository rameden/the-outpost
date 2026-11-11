# Writing and reviewing PRDs

## Contents
1. Choosing a template
2. Header block (both templates)
3. Template A — Full PRD
4. Template B — Decision-led PRD
5. Section guidance
6. Review checklist (for critiquing an existing PRD)

---

## 1. Choosing a template

| Use **Full (A)** when | Use **Decision-led (B)** when |
|---|---|
| New user-facing feature in discovery | Scope is known; the work is a set of engineering choices |
| Design, PMM, and analytics need their own sections | Audience is mostly engineers preparing for grooming |
| Multiple stories and releases (MVP / V2) | One release, one team or two |
| Problem still needs to be argued | Problem is accepted; the "how" is the debate |

If the user uploads an existing PRD from their org, mirror its structure instead.

## 2. Header block (both templates)

Start every PRD with a product information table:

| Field | Value |
|---|---|
| Product | |
| Feature | |
| Product lead / Engineering lead / Design lead / PMM lead | names or `TBC` |
| Release | quarter or date |
| Status | Discovery · Requirements gathering · Draft for grooming · Ready for grooming · Approved |
| Last updated | date |

Then a "Supporting documentation" table: Jira link, design link, and **code touchpoints** (repo path to the component, existing endpoints reused, new endpoints). Code touchpoints are what make a PRD actionable for engineers.

## 3. Template A — Full PRD

1. **Summary / Purpose** — what ships, in two short paragraphs; which layers it touches (frontend, BFF, services); one sentence on what's in and out.
2. **Problem statement** — Who is the user (personas). What problem they face. Workflow impact.
3. **Goals & objectives** — table: Goal · Metric · Tracking (event name or funnel) · Target (`TBC` if unknown).
4. **User stories / feature requirements** — the MVP story ("As a…, I want…, so that…"), then a table: Release · Priority · Requirements / Definition of Done (bulleted, testable).
5. **UX / UI design** — link, key states, accessibility, reduced motion, i18n.
6. **Technical design** — per layer (frontend component and hooks, BFF endpoint with DTO shape, model/prompt, data flow). Include an **options table** when there's a real choice (rows: engine, latency, support, data leaves device, new work; columns: options) followed by a one-paragraph recommendation.
7. **Acceptance criteria** — observable behaviours, including failure paths.
8. **Risks & dependencies** — table: Risk/Dependency · Impact · Mitigation.
9. **Out of scope** — each with reason or "deferred to future release".
10. **Open questions** — each with owner.

## 4. Template B — Decision-led PRD

1. **Summary** — three to five sentences. What the user can do, where it lives, its lifecycle.
2. **In scope** — bullets, each a concrete behaviour.
3. **Out of scope** — bullets, each with the reason.
4. **Decisions** — numbered. Each decision:
   - The decision in one or two imperative sentences.
   - Why: cost, latency, limits, existing capability, with numbers.
   - What was rejected and why.
   - Changes needed to reuse an existing component.
   - `Open.` paragraph if any part is unresolved, saying what it waits on.
5. **Checks / pipeline** (if applicable) — ordered steps with a table: Check · Rule · Owner.
6. **What we will build** — one short paragraph per layer or team (frontend, BFF, storage, assistant/model).
7. **Acceptance criteria** — written as verifiable statements about the decisions ("Storage is namespace X, scoped to chat, deleted with chat").

## 5. Section guidance

**Goals:** a goal without a tracking mechanism is a wish. Name the analytics event or funnel. Don't send user-entered text (search queries, prompts) as analytics properties; say so.

**Requirements:** each must be testable by QA without asking the author. Bad: "Search should be fast." Good: "Search matches name and short description, case-insensitive, updates as the user types, preserves alphabetical order."

**States:** list loading, empty, error, partial-data, and permission-denied states explicitly. They're where most bugs live.

**Limits:** state product limits (what the user is told) and safety limits (what the server enforces regardless of client) separately, and say which component enforces which. Put product limits in one server config, never hardcoded in the client.

**Failure paths:** every external call needs a fallback behaviour ("on structuring failure, insert raw transcript and show a non-blocking toast"). Failed uploads keep the user's typed text.

**Security and data handling:** what data leaves the device or tenant, where it's stored, retention, deletion with parent object. File/text content is data, never instructions.

**Descoped content:** if the source has struck-through or "not part of MVP" sections, move them to Out of scope or Future scope rather than leaving them inline.

## 6. Review checklist

When reviewing a PRD, produce comments ranked **Blocker / Should fix / Nit**, each quoting the location.

Blockers:
- No owner for a component or check on the critical path.
- A dependency on another team with no contact or status.
- Acceptance criteria that can't be tested, or that contradict the requirements.
- Security/data-handling gap (data leaves boundary unstated; no deletion path).
- A decision made without considering an existing service that does the job.

Should fix:
- Goals without tracking or targets.
- Missing empty/error/loading states.
- Product and safety limits conflated; limits hardcoded in the client.
- Out-of-scope items without reasons.
- Open questions without owners.
- Status or "last updated" stale versus content.

Nits: typos, inconsistent naming of the same thing, section numbering.

End the review with the three questions you'd ask in grooming.
