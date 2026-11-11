# Extraction ledger

How to read large inputs without losing anything, and how to record what you find so synthesis is traceable.

## Contents
1. Reading strategy by input type
2. Ledger schema
3. Tagging rules and edge cases
4. Handling conflicts
5. Handling evidence and numbers
6. Example ledger

---

## 1. Reading strategy by input type

| Input | What to hunt for | Traps |
|---|---|---|
| **Spec / RFC / platform doc** | Principles and their tests, primitives/components, what is new vs existing, phases, SLOs, exit criteria | Long reference appendices hide decisions (e.g., migration tables decide deprecation behaviour). Read appendices. |
| **PRD** | Status, owners, scope in/out, decisions, limits, acceptance criteria, open questions | Struck-through sections (descoped), "TBC" targets, assumptions phrased as facts |
| **Meeting transcript** | Who agreed to what; action items; "let's go with", "parking that", "can you check" | Agreement ≠ decision. A decision needs the person with authority to say it, or it's `OPEN`. Tentative language ("maybe we", "I think") → `OPEN` or `ASSUME` |
| **Slack / email dump** | The last word on a thread, reversals, escalations | Earlier messages are often superseded. Track reversals as `DECISION (supersedes …)` |
| **Data export / analytics** | Denominators, time windows, precision notes, growth vs base growth | Raw growth that's below overall volume growth is shrinking share. Counts of mentions ≠ demand ≠ revenue |
| **Code / config / API catalog** | What exists today, its stage (GA, beta, unstaged), real limits | Docs and code disagree → trust code for current behaviour, docs for intent; log `CONFLICT` |
| **Incident notes / postmortems** | Timeline, root cause, contributing factors, action items with owners | Blame language; actions without owners |

Read in this order for a multi-doc bundle: the newest status-bearing doc first (to learn current truth), then the rest in dependency order (platform before features built on it).

## 2. Ledger schema

One line per item:

```
[TAG] statement — ref: <source#chunk or section> — owner: <name|team|unassigned> — note: <optional>
```

Group by source while reading; regroup by tag when synthesizing.

## 3. Tagging rules and edge cases

- **DECISION** requires a chosen option. Record the rejected option when given: `DECISION Reuse Whisper /speech/to-text rather than build STT — rejected: browser-only SpeechRecognition (Chromium-only)`.
- A recommendation in a draft doc is a `DECISION` only if the doc's status says it's approved; otherwise tag `DECISION (proposed)`.
- **REQ** vs **METRIC**: "20 MB per file" is a METRIC that also implies a REQ. Log the METRIC; the REQ is what's enforced and by whom.
- **SCOPE-OUT** always carries the reason if the source gives one. If it doesn't, note `reason: not stated`.
- **OPEN** includes deferred decisions ("Open decisions before grooming"), TBC targets, and things waiting on another team.
- **ASSUME** is anything in an "Assumptions" section, or phrasing like "the backend will return only…" when not verified.
- **DEP** names the thing depended on precisely: team, service, initiative id (e.g., `I4 Real-time intelligence`), vendor, or label.
- Don't log restatements. If section 7 repeats a decision from section 1, keep one entry and cite both refs.

## 4. Handling conflicts

When sources disagree, log `CONFLICT` with both refs and both claims verbatim. Then resolve if possible:
- Newer dated doc beats older, for current state.
- Approved status beats draft.
- Measured beats estimated.
- Code beats docs for what currently runs.

If none applies, it stays a conflict and goes into the Open Questions section of the synthesis with the person or team who can settle it.

## 5. Handling evidence and numbers

- Copy numbers verbatim, with units and the time window ("Jan 2025 to Sep 2026", "p95", "per month").
- Keep the caveat attached to the number. If a source says "counts are calls that talked about a job, not willingness to pay", that caveat travels with every use of the count.
- Note denominators. "13,569 calls" means little without "out of 276,074".
- Compare growth to base growth. If total volume grew 115%, a topic growing 51% is losing share.
- Distinguish **exposure** (ARR of accounts that mentioned X) from **attributable revenue**.
- Mark precision issues the source admits ("loose match", "low precision").

## 6. Example ledger (from a document-upload PRD)

```
[SCOPE-IN]  Thread-level upload only; file lives and dies with the chat — ref: upload#1 — owner: Mira Studio
[SCOPE-OUT] Project-level upload — reason: backend cannot read a file across chats — ref: upload#1
[DECISION]  Store original + extracted text; pass Artifact Store id, not content — rejected: paste text into prompt (fills context) — ref: upload#2
[METRIC]    Azure Doc Intelligence layout $10/1,000 pages; 50-page PDF ≈ $0.50 — ref: upload#2
[METRIC]    Product limits 20 MB/file, 10 files/chat, 100 MB/chat, 300 pages; safety limits 32/20/200/500 — ref: upload#2
[DECISION]  Namespace mira-uploads, scope = chat id; not `mira` (10 MB cap for generated files) — ref: upload#3
[OWNER]     Malware scan — Analyze team scanner, called by ai-bff — ref: upload#5
[OPEN]      Contact Analyze team about scanner; scan step blocked until then — ref: upload#5 — owner: unassigned
[DEP]       Analyze team malware scanner (not in our repos) — ref: upload#5
```
