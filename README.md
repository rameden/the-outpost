# Guild Camp

A small, hackable multi-agent harness built on the Claude API. A **Quartermaster** plans your request, gets your OK on the plan, and sends specialist adventurers out on quests, sometimes several at once. Each crew member has a fixed identity, its own memory and workspace, and clear limits on what it does.

| | Crew member | Does | Doesn't |
|---|---|---|---|
| 🧭 | **Quartermaster** | Plans, briefs the crew, reviews reports, schedules recurring jobs | Specialist work (dispatches it instead) |
| 🏹 | **Scout** | Research: web search and fetch, local files, cited findings | Polished writing, code |
| 🪶 | **Scribe** | Writing and editing docs, posts, emails, READMEs | Code, new research |
| 🔨 | **Artificer** | Code: reads, edits, runs, and tests, with shell commands you approve | Prose, open-ended research |

Ask a crew member for work outside its role and it declines in one line, naming the right teammate ("That's the Artificer's job.").

## Quick start

Requires Node 22.9 or later and an Anthropic API key.

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

Then pick a way in:

```bash
npm run ui      # mission control in your browser (open the link it prints)
npm start       # the camp in your terminal
npm run watch   # run scheduled jobs from the terminal (mission control runs them too)
```

Try: *"Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc."*

## Mission control

`npm run ui` serves a local dashboard on `127.0.0.1`. It has:

- **Crew cards:** live status for each agent, XP, and a picker to change its model and effort level.
- **Live feed:** replies stream in as they're written, and each quest gets its own block (parallel quests run side by side in the feed).
- **Approvals as buttons:** plans, shell commands, new scheduled jobs, and connector tools that make changes.
- **Stop button** on a running expedition, which cancels it and every quest in it.
- **Attachments:** a **+** menu for files, folders, images, pasted images, links, and prompt snippets; `@path` references project files inline; drag and drop works too. Images and PDFs reach the model as real image and document blocks.
- **Tabs:** Quests (cost, tokens, cache rate, model per run, plus a spending summary and per-expedition budget), Memory, Jobs, Wiki, Skills, Connectors, and Inbox.

It only listens on `127.0.0.1`, checks the `Host` header, and requires a key that changes every launch, so other websites in your browser can't drive the camp.

## Terminal commands

In `npm start`, type a request for the Quartermaster, or:

| Command | What it does |
|---|---|
| `@scout <task>` | Talk to one crew member directly (aliases work: `@writer`, `@dev`, `@research`) |
| `@path/to/file` | Attach a project file or folder anywhere in a message |
| `/review` | Approve or reject skills the Quartermaster proposed |
| `/log` | Recent quests with time, tokens, cost, and model |
| `/jobs` · `/wiki` | Scheduled jobs; the wiki index |
| `/memory <name>` | What a crew member remembers |
| `/model [name model [effort] \| name reset]` | Show or change a crew member's model |
| `/budget [dollars \| off]` | Stop each expedition once it has spent this much |
| Ctrl+C | Stop the running expedition; press again to quit |

## How it works

- **One agent loop** (`src/agent.ts`) runs every character. A character is a persona, a set of tools, and some skill folders. Replies stream, tool calls in a turn run in parallel, and on long runs the API clears old tool results so the context doesn't fill up.
- **Dispatch keeps context clean.** An adventurer starts with no memory of the Quartermaster's conversation, works from a written brief, and returns only a report. The brief has to be self-contained, which is why the Quartermaster's prompt stresses it.
- **Identity** lives in `src/crew.ts`. Agents can grow their memory, but they can't rewrite who they are.
- **Memory** has three layers:
  - Each agent's own `camp/agents/<id>/memory.md` and session history, which carry into its next run.
  - The shared wiki in `camp/wiki/`: `facts/` for what you told the camp, `notes/` for what the crew found, always with sources.
  - Skills in `skills/<agent>/`, which the Quartermaster proposes and you approve.
- **Scheduled jobs** run unattended. A run with nothing new to report stays quiet; reports land in `camp/inbox.md` and as a macOS notification.

## Safety

- **Files:** the file tools only work inside the camp folder. They never read `.env`, never touch another agent's memory or sessions, and can't write to `skills/`, `plugins/`, or `camp/` except an agent's own outputs folder.
- **Shell:** commands ask you first. Only simple read-only commands (`ls`, `git status`, `git diff`, version checks) run without asking. Test runners aren't on that list by default, because the Artificer can edit the code they run. Add your own in `camp/settings.json` under `"shell": {"allow": ["npm test"]}`.
- **Untrusted content:** web pages, files, and connector results are treated as information, never as instructions, and agents flag suspected prompt injection.
- **Connectors** are read-only unless you allow writes, and then every write asks you first.
- **Budgets:** set a per-expedition budget in mission control or with `/budget`.

## Configuration

Everything in `camp/` is local to you and gitignored:

| File | Holds |
|---|---|
| `camp/settings.json` | Per-agent model and effort, budget, extra shell commands |
| `camp/mcp.json` | MCP connectors: copy `mcp.example.json`, then say which agents may use each server |
| `camp/jobs.json` | Scheduled jobs |
| `camp/agents/<id>/` | Each agent's memory, sessions, and outputs |
| `camp/wiki/` · `camp/inbox.md` · `camp/quest-log.jsonl` | Shared knowledge, job reports, run history |

To skip plan approval, set `CAMP_APPROVE_PLANS=0`. To use a different port, set `CAMP_PORT`.

## Tests and evals

```bash
npm test            # 33 tests, about 4 seconds, no API key needed
npm run typecheck   # source, tests, and evals
npm run eval        # 8 standard tasks against the real API (spends tokens; capped at $2 per case)
```

- **Tests** run each file in a throwaway camp, against a fake streaming API.
- **Evals** run each case in a throwaway camp with your current model settings. To compare models without changing your settings, use `npm run eval -- --set scout=claude-haiku-5-5:low`. Results are saved to `evals/results/`.

## Adding a crew member

1. Add an identity in `src/crew.ts`: name, role, personality, what it handles, what isn't its job.
2. Add a roster entry in `src/roster.ts` with its tools and default model.
3. Create `skills/<id>/` for its skills.
