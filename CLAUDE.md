# Outpost (guild-camp)

A multi-agent harness on Claude: a Quartermaster plans and dispatches a crew (Scout, Scribe, Artificer, Warden, Test Pilot), with memory, skills, scheduled jobs and a local mission-control web UI.

## Where things live

- `src/` — Node/TS backend. `server.ts` is the mission-control HTTP/SSE server (big: grep it, don't read it whole). `quartermaster.ts` plans and dispatches; `agent.ts` runs a crew member; `claude-code.ts` is the Claude Code subscription path; `tools.ts` holds agent tools; `memory.ts`, `memfit.ts`, `recall.ts` handle memory; `scheduler.ts` and `jobs.ts` handle recurring jobs; `providers.ts` handles other model providers; `routing.ts` (pure decisions) and `autoroute.ts` (registry, health, log) are Auto model selection; `oplog.ts` journals side-effecting tool calls so a resumed task never repeats them; `outpost.ts` names the outpost the server runs in (its working folder: Mae is this checkout, others live in `~/Outposts`, made and started by `scripts/outpost.ts`; `scripts/launch.ts` with `src/hub.ts` is the star chart, one page that lists them all and starts the one you pick; its page is `ui/hub.html` and `ui/src/hub/`).
- `ui/src/` — React app, built into `ui/dist`. `App.tsx` is the shell; `components/` holds UI pieces (Header, Composer, Crew, Terminal, Files…); `panels/` holds Records and Usage; `settings/` holds the Settings pages; `orbit/` holds the full-screen crew view. `styles.css` is ~3,200 lines: grep it for the selector you need.
- `tests/` — node `--test` backend tests; UI tests sit beside components as `*.test.tsx` (vitest).
- `camp/` — runtime state (crew, memory, feeds). It's data, not code, so don't explore it unless the task is about it.
- `docs/index.html` — the in-app Tour. `evals/` — eval runner. `extension/` — browser extension.

## Commands

- `npm start` — the star chart of outposts: the way into the app. `npm run ui` — one outpost's dev server (Mae, page reloading as you edit). `npm run cli` — the camp in the terminal. `npm test` — all tests. `npm run typecheck` — all three tsconfigs.

## Keeping context small

- Read only the part of a file you need: grep for the symbol, then read that range. Don't re-read a file that's already in this conversation unless it has changed.
- If command output is saved to a file because it was too long, grep it; don't read it whole.
- Keep test and build output short: run the failing file, or pipe through `tail -40`.
- Browser checks: use `read_page`/`get_page_text` to check text and structure; take a screenshot only to judge how something looks, and one per check.
- Hand broad searches, test-fixing loops and visual QA to a subagent so only its summary comes back.
- When a task is finished (committed or PR opened), suggest starting a new chat for the next one.
