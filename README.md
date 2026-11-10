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

Requires Node 22.9 or later, and either a Claude subscription (Pro or Max) or an Anthropic API key.

```bash
npm install
```

**On your Claude subscription (the default):** the crew runs through [Claude Code](https://code.claude.com) signed in with your Claude account. Install Claude Code and sign in once:

```bash
claude auth login
```

Usage counts against your plan's limits. Costs in the camp are shown as estimates at API prices, not charges. Your own Claude Code settings, hooks, `CLAUDE.md`, and MCP servers are not loaded for the crew, and no API key is passed to it.

**On the API instead:** put a key in `.env` and switch the runtime (`/runtime api` in the terminal camp, or the runtime chip in mission control):

```bash
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

- **History, down the left:** every conversation you've had with the camp, filed under projects. **New conversation** gives you a clean page, so unrelated work stays out of each other's context; opening a conversation shows only that one, and what you send there continues it with everything said so far. **All activity** shows everything at once, scheduled jobs included. A dot marks a conversation with something running, and a number marks decisions waiting on you. **New project** opens a dialog for its name, a description, and (optionally) a folder on your disk to link. The Quartermaster is given all three at the start of every conversation in the project, so the description is the place for standing notes: what the project is, how you like the work done there, what to be careful with. Clicking a project's name opens its page (what the crew is told, its folder, its conversations); **Projects** lists them all. Each linked folder gets a project to start with. The **⋯** menu on a conversation renames it, moves it to another project, or removes it from the list (its record stays in the camp folder).
- **Crew cards, across the top:** live status for each agent, XP, and a picker to change its model, effort level, and turn limit (how many replies one run may take; the Artificer gets 60, others 20 or 30).
- **Live feed:** replies stream in as they're written, and each quest gets its own block (parallel quests run side by side in the feed).
- **Approvals as buttons:** plans, shell commands, new scheduled jobs, and connector tools that make changes.
- **Several at once:** expeditions, direct chats, and scheduled jobs run side by side, up to 3 at a time by default (change it under Quests, 1–8); the rest wait their turn. Each has its own block in the feed, its own approvals, and its own budget. More at once uses up your plan's limits (or API spend) faster.
- **Stop button** on each running expedition, which cancels it and every quest in it and leaves the others running.
- **Attachments:** a **+** menu for files, folders, images, pasted images, links, and prompt snippets; `@path` references project files inline; drag and drop works too. Images and PDFs reach the model as real image and document blocks.
- **Linked folders:** for big folders (hundreds of files), use **Link a folder…** instead of uploading: **Choose folder…** opens your system's folder picker (or paste a path), and agents read it where it lives as `links/<name>/…`. They get an overview and explore it with `list_dir`, `glob`, and `grep`. Read-only unless you choose "Can edit".
- **Worktrees:** when a linked folder is a git repository, a picker under the composer chooses where the next request works: the linked checkout, a new worktree and branch (`<repo>-camp/<branch>` beside the repo, branch `camp/<task>`), or a worktree you already have. The file tools and the shell follow it, and a follow-up stays in the same worktree. When the expedition ends its card shows the branch, with **Commit…**, **Open PR…** (pushes and uses the GitHub CLI), and **Remove worktree**. Those three are yours to press; agents never commit or push on their own. A new worktree has no installed dependencies until you install them.
- **Steer:** a box on each running expedition sends a message to the agents working in it; they see it on their next step.
- **Resume:** an expedition that was cut off by a restart, stopped, failed, or ran out of turns gets a **Resume** button, which starts again from what the feed recorded of it (the plan, who was sent, what they did) in the same worktree.
- **Checks after changes:** on a linked folder's card (Connectors tab), list commands such as `npm run typecheck`. The camp runs them by itself after any quest changes files there and attaches the results to the quest's report.
- **Follow-ups:** **Reply** on a finished expedition continues that conversation, with every earlier request and full answer carried over (in the terminal: `/reply <message>`).
- **Changes you can review and undo:** when an expedition's file tools change files, its card shows how many, with **View changes** (a diff) and **Undo** (puts every file back). This covers `write_file` and `edit_file`, not changes made by shell commands.
- **Plan usage:** on your subscription, the Quests tab shows your 5-hour and weekly windows as Claude Code reports them. If one is used up, the camp pauses: queued work and scheduled jobs wait for the reset instead of failing ("Try anyway" overrides it).
- **Notifications:** the 🔔 button turns on browser notifications for approvals and long expeditions finishing while the tab is in the background. For your phone, see [Approvals from your phone](#approvals-from-your-phone).
- **The feed is kept:** it's saved to `camp/feed.jsonl` and reloaded when mission control restarts.
- **Agent pages:** click any crew card to chat with that agent directly, browse its runs and each run's steps, edit its memory, see its output files, and check its tools, skills, and stats.
- **Tabs:** Quests (cost, tokens, cache rate, model per run, plus a spending summary and per-expedition budget), Memory, Jobs, Wiki, Skills, Connectors, and Inbox.

It only listens on `127.0.0.1`, checks the `Host` header, and requires a key that changes every launch (for the page's own scripts and styles too), so other websites in your browser can't drive the camp. The page runs under a Content-Security-Policy that allows no inline code, only the scripts and styles the camp itself serves.

### Working on the page

The page is a React app in `ui/` (React 19, TypeScript, plain CSS, built with Vite). The camp's own server (`src/server.ts`) serves the built files from `ui/dist`; there is no second server in normal use.

```bash
npm run ui         # builds the page first if ui/dist is missing or older than ui/src, then starts the camp
npm run ui:build   # just build it
npm run ui:dev     # the camp plus Vite with live reload: open the second link it prints
```

- `npm run ui:dev` starts the camp as usual and puts Vite's dev server in front of it. Vite serves the page from `ui/src` and passes `/api` and `/events` through to the camp; the link it prints carries the launch key, which the page sends itself, so the dev server is no way around the key.
- The feed is a pure function of the camp's events (`ui/src/feed/reducer.ts`): each event names its expedition and quest, and lands in that card. That's where to look first when the feed shows something wrong.
- The page's types come from the server's code (`ui/src/types.ts` imports `CampEvent`, the `/api/state` shape, and the rest as types), so `npm run typecheck` fails if the server and the page disagree.

## Terminal commands

In `npm start`, type a request for the Quartermaster, or:

| Command | What it does |
|---|---|
| `@scout <task>` | Talk to one crew member directly (aliases work: `@writer`, `@dev`, `@research`) |
| `@path/to/file` | Attach a project file or folder anywhere in a message |
| `/link <path> [--edit]` · `/links` · `/unlink <name>` | Link a folder on your disk as `links/<name>/` (no upload), list links, remove one |
| `/reply <message>` | Follow up on the last expedition or chat, carrying the whole conversation over |
| `/worktree [<link> new [branch] \| <link> <path or branch> \| <link> off]` | List a linked repo's worktrees; work in a new one per request, or in one you already have |
| `/diff` · `/undo` | What the last expedition's file tools changed; put those files back |
| `/review` | Approve or reject skills the Quartermaster proposed |
| `/log` | Recent quests with time, tokens, cost, and model |
| `/jobs` · `/wiki` | Scheduled jobs; the wiki index |
| `/memory <name>` | What a crew member remembers |
| `/model [name model [effort] \| name reset]` | Show or change a crew member's model |
| `/turns <name> <number \| reset>` | How many turns one run of that crew member may take (5–200) |
| `/runtime [claude-code \| api]` | Show or switch what runs the crew: your Claude subscription (default) or the API |
| `/budget [dollars \| off]` | Stop each expedition once it has spent this much |
| Ctrl+C | Stop the running expedition; press again to quit |

## How it works

- **Two runtimes, one loop** (`src/agent.ts`): on your subscription, each character runs as a Claude Code session (`src/claude-code.ts`) with the camp's own system prompt, and the camp's tools are served to it from an in-process MCP server, so every boundary and approval still applies; on the API, the camp runs the loop itself. A character is a persona, a set of tools, and some skill folders. Replies stream, tool calls in a turn run in parallel, and long runs keep their context from filling up (Claude Code compacts on its own; on the API, old tool results are cleared).
- **Dispatch keeps context clean.** An adventurer starts with no memory of the Quartermaster's conversation, works from a written brief, and returns only a report. The brief has to be self-contained, which is why the Quartermaster's prompt stresses it.
- **Identity** lives in `src/crew.ts`. Agents can grow their memory, but they can't rewrite who they are.
- **Memory** has three layers:
  - Each agent's own `camp/agents/<id>/memory.md` and session history, which carry into its next run.
  - The shared wiki in `camp/wiki/`: `facts/` for what you told the camp, `notes/` for what the crew found, always with sources.
  - Skills in `skills/<agent>/`, which the Quartermaster proposes and you approve.
- **Search that scales:** `glob` and `grep` run on ripgrep (the copy inside Claude Code is used if there's none on your PATH), so they cover a project of tens of thousands of files in under a second and skip what its `.gitignore` skips. Without ripgrep a slower built-in search takes over. `grep` can list just the matching files or show lines of context. `outline` shows a file's functions, classes, components, types, and tests with line numbers, so an agent reads the 50 lines it needs instead of the whole file.
- **Project instructions:** a top-level `AGENTS.md` or `CLAUDE.md` in the camp folder and in each linked folder is loaded into every prompt, so a repo's conventions don't have to be re-briefed.
- **Turn limits:** three turns before the limit an agent is told to land the work, and a run that still uses every turn ends its report with a handoff (files changed, last steps) for whoever continues.
- **Questions:** the Quartermaster can ask you one short question (`ask_user`) when a request could mean two different things, before it plans.
- **Quest cap:** at most 4 dispatched quests run at once across the whole camp (`"questsAtOnce"` in `camp/settings.json`); extra ones wait.
- **Scheduled jobs** run unattended. A run with nothing new to report stays quiet; reports land in `camp/inbox.md` and as a macOS notification. Only one process runs jobs at a time (`camp/scheduler.lock`), so mission control and `npm run watch` can both be open. To run jobs with nothing open on macOS, `npm run watch:install` adds a background agent that checks every minute (`npm run watch:uninstall` removes it).

## Safety

- **Files:** the file tools only work inside the camp folder. They never read secrets at any depth (`.env*`, private keys, `.netrc`, `credentials.json`…) or the camp's private configuration (`camp/mcp.json`, `camp/settings.json`), never touch another agent's memory or sessions, and can't write to `skills/`, `plugins/`, or `camp/` except an agent's own outputs folder.
- **The camp's own code is read-only** to agents (`src/`, `tests/`, `evals/`, `package.json`), so nothing they read can talk them into loosening these rules. To have the crew work on Guild Camp itself, set `"selfEdit": true` in `camp/settings.json`.
- **The Scout** reads the web, so it can only write to its own outputs folder.
- **Parallel quests** can't overwrite each other: a write to a file another quest just changed is refused until it has been read again.
- **Shell:** commands ask you first. "Always allow this command" on an approval stops the asking for that exact command (`"shell": {"exact": [...]}`). Commands run without blocking the camp, stop after 2 minutes, and stop when you press Stop. With `cwd: "links/<name>"` a command runs inside that linked folder (or the expedition's worktree of it), where read-only git commands don't ask either.
- **Sandboxed shell (macOS, off by default):** turn it on under Quests, or with `"shell": {"sandbox": true}`. Commands then run without asking, with no network (localhost still works), writes only inside the project they run in and temp folders, and no access to your keys or `.env` files. Git hooks and git config can't be written. A command that needs more, like an install or a push, is asked for the usual way. The sandbox doesn't protect the project folder itself: a command can still change or delete files there, so use a worktree for work you want kept apart. Only simple read-only commands (`ls`, `git status`, `git diff`, version checks) run without asking. Test runners aren't on that list by default, because the Artificer can edit the code they run. Add your own in `camp/settings.json` under `"shell": {"allow": ["npm test"]}`.
- **Untrusted content:** web pages, files, and connector results are treated as information, never as instructions, and agents flag suspected prompt injection.
- **Connectors** are read-only unless you allow writes, and then every write asks you first.
- **Linked folders:** system, home, and credential folders can't be linked. Inside a link, secret files (`.env`, private keys, `.netrc`…) stay off limits, symlinks can't lead outside it, and a link that contains the camp still follows the camp's rules.
- **Budgets:** set a per-expedition budget in mission control or with `/budget`. Spending is tallied after every model reply, across the Quartermaster and all its quests, and a run stops once the budget is reached.

## Approvals from your phone

Optional, through [ntfy](https://ntfy.sh). Install the ntfy app, subscribe to a long random topic, and add it to `camp/settings.json`:

```json
"phone": { "topic": "camp-3f9c1e7a52d84b06", "approve": ["plan", "job"] }
```

While mission control is open you get a notification for each approval, each job report, and each long expedition that ends, with Approve and Decline buttons for the kinds listed in `approve`. Before turning it on:

- The text of each approval (the plan, the command) is sent to the ntfy server. Use `"server"` to point at your own.
- Anyone who knows the topic can read those and press the buttons, so keep it long and random. Topics shorter than 12 characters are ignored.
- Shell commands and connector writes only notify by default. Add `"shell"` or `"tool"` to `approve` to allow them from the phone.

## Configuration

Everything in `camp/` is local to you and gitignored:

| File | Holds |
|---|---|
| `camp/settings.json` | Per-agent model, effort, and turn limit, budget, runtime, how many expeditions (`parallel`) and quests (`questsAtOnce`) run at once, extra shell commands, `selfEdit`, `phone` |
| `camp/mcp.json` | MCP connectors: copy `mcp.example.json`, then say which agents may use each server |
| `camp/links.json` | Linked folders (path, name, read-only or editable, `verify` commands) |
| `camp/jobs.json` | Scheduled jobs |
| `camp/agents/<id>/` | Each agent's memory, sessions, and outputs |
| `camp/wiki/` · `camp/inbox.md` · `camp/quest-log.jsonl` | Shared knowledge, job reports, run history |
| `camp/feed.jsonl` · `camp/threads.jsonl` · `camp/checkpoints/` | The saved feed, conversations for follow-ups, and the originals of changed files (newest 60 expeditions) |
| `camp/conversations.json` | History's projects, plus the titles and filing you've changed by hand |
| `camp/limits.json` · `camp/scheduler.lock` | Your plan's last reported usage windows; which process is running jobs |

To skip plan approval, set `CAMP_APPROVE_PLANS=0`. To use a different port, set `CAMP_PORT`.

## Tests and evals

```bash
npm test            # the camp's tests, then the page's (Vitest); about 10 seconds, no API key or Claude login needed
npm run typecheck   # source, tests, and evals, then the page in ui/
npm run eval        # 8 standard tasks against the real API (spends tokens; capped at $2 per case)
```

- **Tests** run each file in a throwaway camp, against a fake streaming API. The page's tests (`ui/src/**/*.test.ts(x)`) cover the feed: several expeditions at once, streaming replies, approvals, and Stop.
- **Evals** run each case in a throwaway camp with your current model settings. To compare models without changing your settings, use `npm run eval -- --set scout=claude-haiku-5-5:low`. Results are saved to `evals/results/`.

## Adding a crew member

1. Add an identity in `src/crew.ts`: name, role, personality, what it handles, what isn't its job.
2. Add a roster entry in `src/roster.ts` with its tools and default model.
3. Create `skills/<id>/` for its skills.
