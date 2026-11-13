# Mae

Mae (**M**y **A**lter **E**go) is a small, hackable multi-agent harness built on Claude. A **Quartermaster** plans your request, gets your OK on the plan, and sends specialist adventurers out on quests, several at once when the work allows. Each crew member has a fixed identity, its own memory and workspace, and clear limits on what it does.

| | Crew member | Does | Doesn't |
|---|---|---|---|
| 🧭 | **Quartermaster** | Plans, briefs the crew, reviews reports, schedules recurring jobs | Specialist work (dispatches it instead) |
| 🏹 | **Scout** | Research: web search and fetch, local files, cited findings | Polished writing, code |
| 🪶 | **Scribe** | Writing and editing docs, posts, emails, READMEs, PR descriptions | Code, new research |
| 🔨 | **Artificer** | Code: reads, edits, runs, and tests, with shell commands you approve | Prose, open-ended research |
| 🛡️ | **Warden** | Reviews pull requests and changes, raising only what would matter if it shipped | Nitpicks, fixing the code, posting anything you haven't approved |

Ask a crew member for work outside its role and it declines in one line, naming the right teammate. You can add crew members of your own from the **+** on the crew bar.

**For a tour of what it does, open mission control and click _Tour_ in the header** (it's [`docs/index.html`](docs/index.html)).

## Quick start

Requires Node 22.9 or later, and either a Claude subscription (Pro or Max) or an Anthropic API key. Mae uses **npm**; pnpm and yarn stop with a message.

```bash
npm install
claude auth login   # once: the crew runs through Claude Code on your subscription
npm run ui          # mission control in your browser: open the link it prints
```

On your subscription, usage counts against your plan's limits, and costs in the camp are estimates at API prices. Your own Claude Code settings, hooks, `CLAUDE.md` and MCP servers aren't loaded for the crew.

**On the API instead:** put `ANTHROPIC_API_KEY=sk-ant-...` in `.env` and switch the runtime in Settings → General (or `/runtime api` in the terminal camp).

Other ways in:

```bash
npm start           # the camp in your terminal
npm run headless -- "…"   # one request, nobody at the keyboard (see below)
npm run watch       # scheduled jobs from the terminal (mission control runs them too)
```

Try: *"Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc."*

**On Windows** it works the same way. The crew's commands run in Git Bash (or PowerShell without it; set `CAMP_SHELL` to choose), there's no sandbox (run inside WSL 2 for one), and `npm run watch:install` prints a Task Scheduler command instead of installing a macOS agent.

**From your other machines at home (LAN mode):** by default only the machine the camp runs on can reach it. Put `CAMP_LAN=1` in `.env` and start it with `npm run ui:serve`: it prints the address your other machines use (for example `http://winbox:4747/`) and a sign-in link for it. It's plain HTTP, so it's for a home network you trust: never an office or shared network, and never a port forwarded to the internet. The terminal pane only opens on the camp's own machine (it's a shell there), and from another machine you paste a folder's path instead of using the folder dialog. Each browser signs in once with a one-time link: the camp's terminal prints one, or make one under Settings → General → Other devices. On Windows, allow Node through the firewall for private networks when it asks.

## Terminal commands

In `npm start`, type a request for the Quartermaster, or:

| Command | What it does |
|---|---|
| `@scout <task>` | Talk to one crew member directly (aliases work: `@writer`, `@dev`, `@research`) |
| `@path/to/file` | Attach a project file or folder anywhere in a message |
| `/link <path> [--edit]` · `/links` · `/unlink <name>` | Link a folder on your disk as `links/<name>/`, list links, remove one |
| `/reply <message>` | Follow up on the last expedition or chat |
| `/project [name \| off]` | List your projects, or work in one |
| `/worktree [<link> new [branch] \| <link> <path or branch> \| <link> off]` | Work in a new or existing worktree of a linked repo |
| `/good [note]` · `/bad [note]` | Rate the last answer |
| `/diff` · `/undo` | What the last expedition changed; put those files back |
| `/review` | Approve or reject skills the Quartermaster proposed |
| `/log` · `/jobs` · `/wiki` · `/memory <name>` | Recent quests; scheduled jobs; the wiki index; what a crew member remembers |
| `/model [name model [effort] \| name reset]` · `/turns <name> <n \| reset>` | A crew member's model, or how many turns one run may take |
| `/runtime [claude-code \| api]` · `/budget [dollars \| off]` | What runs the crew; a spending cap per expedition |
| Ctrl+C | Stop the running expedition; press again to quit |

In mission control, ⌘P (Ctrl+P) opens the command palette, and a message starting with `/` is a command for the page (`/new`, `/find`, `/next`, `/settings`…).

## Headless runs

For scripts, CI, and GitHub Actions ([an example workflow](docs/github-action.md)):

```bash
npm run headless -- --json --approve-plan --worktree web "Fix the flaky date test in links/web"
echo "Tidy the README" | npm run headless -- --agent scribe -
```

- `--approve-plan` approves the plan; nothing else is approved for you. Shell commands run only if your allow-list or the sandbox lets them, and each decline is listed.
- `--json` prints one object at the end (`status`, `text`, `costUsd`, `changed`, `worktrees`, `declined`); progress goes to stderr.
- `--project <id>`, `--worktree <link>` and `--agent <name>` work as they do in mission control.
- Exit codes: 0 finished, 1 failed or refused, 2 stopped short (budget, turn limit, cut off).

## How it works

- **Two runtimes, one loop** (`src/agent.ts`). On your subscription each character runs as a Claude Code session (`src/claude-code.ts`), with the camp's tools served from an in-process MCP server so every boundary and approval still applies. On the API the camp runs the loop itself. Other providers (Gemini, Groq, OpenRouter) can be connected under Settings → Models.
- **Dispatch keeps context clean.** An adventurer starts with no memory of the Quartermaster's conversation, works from a self-contained brief, and returns only a report.
- **Identity** lives in `src/crew.ts` and tools in `src/roster.ts`. Agents can grow their memory, but they can't rewrite who they are.
- **Memory** has three layers: each agent's own `camp/agents/<id>/memory.md` and sessions; the shared wiki in `camp/wiki/` (`facts/` from you, `notes/` the crew found, with sources); and skills in `skills/<agent>/`, proposed by the Quartermaster and approved by you. `recall` searches what no longer fits in a prompt.
- **Projects** decide what the crew sees: their folders (and those folders' `AGENTS.md` / `CLAUDE.md`), a description, notes the crew keeps, and defaults. A conversation outside a project gets no linked folder unless you bring one in.
- **Scheduled jobs** run unattended and report to `camp/inbox.md`. Only one process runs them at a time. On macOS, `npm run watch:install` runs them with nothing open.

## Safety

- **Files:** file tools only work inside the camp folder and linked folders. They never read secrets (`.env*`, keys, credentials) at any depth, never touch another agent's memory, and can't write to `skills/`, `plugins/`, or `camp/` except an agent's own outputs folder. Symlinks are checked where they really lead.
- **The camp's own code is read-only** to agents (`src/`, `tests/`, `evals/`, `package.json`). Set `"selfEdit": true` in `camp/settings.json` to let the crew work on Mae itself.
- **Shell commands ask first.** Only narrow read-only commands (`ls`, `git status`, `git diff`…) and your own allow-list run without asking. **Never run** and **Always ask** patterns under Settings → Approvals come before everything else. The camp's keys and anything named like a secret are kept out of every command's environment.
- **Sandbox** (macOS, or Linux with bubblewrap; off by default): commands run without asking, with no network except hosts you list, and writes only inside the project and temp folders. It doesn't protect the project folder itself, so use a worktree for work you want kept apart.
- **Nothing leaves without your click:** agents never commit, push, or merge. Opening a pull request is your button. The Warden's review comment and the Scribe's PR description go out only after you approve the exact text. The crew can read Jira but not write to it.
- **Untrusted content** (web pages, files, connector results, tickets, review comments) is treated as information, never as instructions.
- **Connectors** are read-only unless you allow writes, and then every write asks you first.
- **Budgets** cap each expedition across the Quartermaster and all its quests.
- **Mission control** listens only on `127.0.0.1`, checks the `Host` header, needs the camp's key for everything, and runs under a Content-Security-Policy with no inline code.

## Approvals from your phone

Optional, through [ntfy](https://ntfy.sh). Subscribe to a long random topic in the ntfy app and add it to `camp/settings.json`:

```json
"phone": { "topic": "camp-3f9c1e7a52d84b06", "approve": ["plan", "job"] }
```

You get a notification for each approval, job report, and long expedition that ends, with Approve and Decline for the kinds in `approve`. The approval's text goes to the ntfy server (set `"server"` to use your own), and anyone who knows the topic can press the buttons, so keep it long. Shell commands and connector writes only notify unless you add `"shell"` or `"tool"`.

## Configuration

Everything in `camp/` is local to you and gitignored. The main files:

| File | Holds |
|---|---|
| `camp/settings.json` | Models, budget, runtime, how much runs at once, shell rules, `selfEdit`, `phone`, terminal quick actions |
| `camp/mcp.json` | MCP connectors (copy `mcp.example.json`) and which agents may use each |
| `camp/links.json` | Linked folders, their access, and their check commands |
| `camp/conversations.json` · `camp/projects/<id>/` | Projects and conversation filing; each project's survey, notes and chronicle |
| `camp/agents/<id>/` | Each agent's memory, sessions, and outputs |
| `camp/wiki/` · `camp/inbox.md` · `camp/quest-log.jsonl` | Shared knowledge, job reports, run history |
| `camp/feed.jsonl` | The saved feed, reloaded on restart |
| `camp/jira.json` · `camp/providers.json` · `camp/.token` | Credentials and the camp's key: readable only by you, off limits to the crew |

Environment: `CAMP_PORT` for another port, `CAMP_NEW_TOKEN=1` for a new key, `CAMP_APPROVE_PLANS=0` to skip plan approval, `CAMP_RUNTIME` to pin the runtime, `CAMP_SHELL_ENV_ALLOW=GH_TOKEN,…` to pass a secret to commands on purpose, `CAMP_LAN=1` to reach the camp from your other machines at home (with `CAMP_NAMES` for extra names it answers to and `CAMP_HOST` to listen on one address).

## Development

The page is a React app in `ui/` (React 19, TypeScript, plain CSS, Vite).

```bash
npm run ui          # the camp plus Vite: page edits reload live (restart it for edits under src/)
npm run ui:serve    # the camp alone, serving the built page
npm test            # the camp's tests, then the page's; no API key or Claude login needed
npm run typecheck   # source, tests, evals, and the page
npm run eval        # standard tasks against the real API (spends tokens)
```

- The feed is a pure function of the camp's events (`ui/src/feed/reducer.ts`), so that's where to look first when the feed shows something wrong.
- The page's types come from the server's code (`ui/src/types.ts`), so `npm run typecheck` fails if the two disagree.
- Tests run each file in a throwaway camp against a fake streaming API. CI (`.github/workflows/ci.yml`) runs the types and the whole suite on every pull request.
- The built-in crew is defined in `src/crew.ts` and `src/roster.ts`, with skills in `skills/<id>/`. Crew members you add from the page live in `camp/crew.json`.
