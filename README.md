<h1><picture><source media="(prefers-color-scheme: dark)" srcset="docs/brand/mae-lockup-on-dark.svg"><img src="docs/brand/mae-lockup-on-light.svg" alt="Outpost Mae" height="64"></picture></h1>

**Outpost Mae** is a small, hackable multi-agent harness built on Claude: a place on your own machine where a crew gets your work done. (Mae is short for **M**y **A**lter **E**go.) A **Quartermaster** plans your request, gets your OK on the plan, and sends specialists out on quests, several at once when the work allows. Each crew member has a fixed identity, its own memory and workspace, and clear limits on what it does.

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

**On the API instead:** connect Anthropic in Settings → Models, then select the API runtime in Settings → General (or `/runtime api` in the terminal camp). Keys are verified before saving, kept in the owner-only `camp/providers.json`, and never returned to the page. A saved key takes precedence over `ANTHROPIC_API_KEY` in `.env`; disconnecting it falls back to the environment key. An existing environment key can be imported directly in Settings → Models without displaying it. API billing and limits are separate from your Claude subscription.

Other ways in:

```bash
npm start           # the camp in your terminal
npm run headless -- "…"   # one request, nobody at the keyboard (see below)
npm run watch       # scheduled jobs from the terminal (mission control runs them too)
```

Try: *"Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc."*

**On Windows** it works the same way. The crew's commands run in Git Bash (or PowerShell without it; set `CAMP_SHELL` to choose), there's no sandbox (run inside WSL 2 for one), and `npm run watch:install` prints a Task Scheduler command instead of installing a macOS agent.

**From your other machines at home (LAN mode):** by default only the machine the camp runs on can reach it. Put `CAMP_LAN=1` in `.env` and start it with `npm run ui:serve`: it prints the address your other machines use (for example `http://winbox:4747/`) and a sign-in link for it. It's plain HTTP, so it's for a home network you trust: never an office or shared network, and never a port forwarded to the internet. The terminal pane only opens on the camp's own machine (it's a shell there), and from another machine you paste a folder's path instead of using the folder dialog. Each browser signs in once with a one-time link: the camp's terminal prints one, or make one under Settings → General → Other devices. On Windows, allow Node through the firewall for private networks when it asks.

## Outposts

The app is Outpost, and each camp it runs is an outpost with a name of its own: one for work and one for home, say, that know nothing of each other. This checkout is the first outpost, Mae, with the `camp/` it has always had. The others live in `~/Outposts/<name>/` (set `OUTPOSTS_DIR` to put them elsewhere), each with its own crew, memory, settings, keys, jobs, skills and `.env`, and each runs as its own server on its own port.

```
npm run outpost                       # list them, and which are running
npm run outpost -- new Work           # make one, on the next free port (--port 4800 to choose)
npm run outpost -- start Work         # run it, serving the built page (like ui:serve)
npm run outpost -- start Work --dev   # run it with the page reloading as you edit (like npm run ui)
```

The header reads "Outpost" with the outpost's name under it. Rename an outpost from its Settings, General: the new name is kept in its `camp/outpost.json` and shows at once, while its folder stays where it is (`start` finds it by either name). A new outpost starts empty: connect its models and accounts from its own Settings. The crew's built-in skills are copied from this checkout and brought up to date each time an outpost starts, while skills an outpost learns stay in that outpost. The relay and Tailscale scripts (`scripts/relay`, `scripts/tailscale.sh`) reach Mae.

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
| `/model [name model [effort] \| name auto[:economy\|balanced\|quality] \| name reset]` · `/turns <name> <n \| reset>` | A crew member's model (or Auto), or how many turns one run may take |
| `/runtime [claude-code \| api]` · `/budget [dollars \| off]` | What runs the crew; a spending cap per expedition |
| Ctrl+C | Stop the running expedition; press again to quit |

Mission control opens on **Today** (the Mae logo takes you back there, or `/today`): a greeting, where things stand in a few sentences, and the morning brief: what's waiting on you, your Jira tickets, what's upcoming, your latest notes, and recent work, with the message box to start something new (in the project you last worked in).

In mission control, ⌘P (Ctrl+P) opens the command palette, and a message starting with `/` is a command for the page (`/new`, `/find`, `/next`, `/settings`…). Two views take the whole page, both in the header's **Arcade** menu (which also holds the memory's constellation, `/constellation`, and the Barnstorm game): **Orbit** (`/orbit`) shows the crew at work as a solar system, and the **trail map** (`/trail`) draws the Quartermaster's plan as a trail, one waypoint a step, with who was sent on it, how it stands, and a line from each step to the steps that wait for it (the Quartermaster marks those in the plan as "(after 1, 2)"; a plan that marks none is a straight trail), and its **Whole map** button puts every plan on one map, drawn either as rings (each plan a ring round one centre, the first asked innermost, and the runs of one conversation joined ring to ring) or as a tree that grows up from the foot of the window, each plan a bough off the trunk; **Tree** and **Rings** (or R) swap between the two. Both show the whole last day and can replay it, and live or replayed, each plan is drawn in as it joins. The Notes panel (`/notes`, or the tab on the right) is a place of your own to write things down: select text in a thread, or press Note under an answer, to keep it; a note goes into a message as text or as an attached file. The crew doesn't read your notes otherwise. Two things happen only when you ask: **Write up as a ticket** has the Scout read the project's code and turn a note into a ticket (a title, acceptance criteria, where it goes), kept beside the note with a **Start work** button; **Suggest ideas** asks what a project's record points at next, and what comes back sits in the list as suggestions until you keep or delete them.

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

- **Two runtimes, one loop** (`src/agent.ts`). On your subscription each character runs as a Claude Code session (`src/claude-code.ts`), with the camp's tools served from an in-process MCP server so every boundary and approval still applies. On the API the camp runs the loop itself. Other providers (DeepSeek, Gemini, Groq, OpenRouter) can be connected under Settings → Models.
- **Auto model selection** (`src/routing.ts`, `src/autoroute.ts`). Pick **Auto** beside the message box, in a crew member's model picker, for a project's crew, or with `/model <name> auto` (Balanced unless you say `auto:economy` or `auto:quality`). Right before each dispatch, Auto profiles the task (kind, scope, what's at stake, images and tools needed, how big the request is), drops every model that can't take it (not connected, a confidential project's unapproved provider, too small a context, cooling down, over budget, or listed in `autoExclude` in `camp/settings.json`), and scores the rest on the odds of finishing (a model must clear the task's bar on its own), the expected cost including a possible rescue by another model, and time. It keeps the model through routine reads, edits and tests, and looks again when the task changes, a failing check shows the work is riskier than it looked, distinct fixes keep reproducing one failure, the request outgrows the model, or the provider is unavailable; a switch between healthy models has to be worth replaying the conversation. Each run says which model it used and why (in the feed and in Quests). Estimates start from labelled priors in a versioned policy and shift, within a limit, with graded outcomes (`camp/routing-evidence.json`): a run counts as a success only if its last check passed, and is weighed against what was expected on a task that hard; decisions and outcomes go to `camp/routing.jsonl` (no prompts, no keys), and `GET /api/routing` compares Auto with fixed models on matched tasks. A model you pick yourself stays pinned: if its provider fails, the run says so and suggests Auto. On your subscription Auto chooses at the start of a run; mid-run switching needs the API runtime. Settings → Models explains Auto and shows how its runs have gone; the camp's own small jobs (naming a conversation, tidying a memory) can use it too, where it means the cheapest small model that's connected and up to the job.
- **Nothing done twice** (`src/oplog.ts`). In a conversation, every command, file write and review a crew member makes is journaled before and after it runs (`camp/ops/`). When a run that didn't finish is picked up again, a call that already ran gets its recorded result back instead of running again, and one whose outcome was never recorded is checked (or held back with an explanation) before it can be retried.
- **Dispatch keeps context clean.** A crew member starts with no memory of the Quartermaster's conversation, works from a self-contained brief, and returns only a report.
- **Identity** lives in `src/crew.ts` and tools in `src/roster.ts`. Agents can grow their memory, but they can't rewrite who they are.
- **Theme packs** (`src/packs.ts`; Settings → General → Theme pack) rename the camp's own five and a few of the page's words. **Guild** is the original; **Starship** makes them a Commander, Navigator, Comms Officer, Engineer and Security Chief; **Newsroom** an Editor, Reporter, Columnist, Typesetter and Fact Checker; **Studio** a Director, Location Scout, Screenwriter, Set Builder and Script Supervisor; **Lab** a Lab Lead, Field Researcher, Author, Technician and Peer Reviewer; **Pirate** a Commodore, Spyglass, Logkeeper, Rigger and First Mate. The names change for the crew too (their prompts use them), ids never change, and every pack's names keep working after `@`. A pack can also name crew members you've added, by handle (`extras`): today the Test Pilot (`@wizard`) becomes a Stringer, Stunt Double, Tinkerer or Powder Monkey, for as long as they still have the name they came with: Test Pilot, or Wizard, which is what Guild called them before. `camp/crew.json` keeps the name you gave them, and a name of your own is kept under every pack. The plane game (the plane in the top bar) dresses for the pack as well (`ui/src/egg/skins/`): on the Starship you fly a four-winged fighter against an empire's grey fleet, in the Newsroom you're a kid on a bike throwing papers with the whole street after you (the old man, the mail man, the mail cart), in the Studio a star throwing stars, in the Lab a mech dog with lasers for eyes, and under the Pirate flag a ship firing cannonballs; Guild and packs of your own keep the plane. You can make a pack of your own beside those six (Settings → General → **New pack…**, or the pencil beside one you made): names and icons for the five and the Test Pilot, the five words, the line the crew reads about where they work, and the colours it suggests, starting from any pack if you like. Yours are kept in `camp/packs.json` and checked when the camp starts and when you save: a name, run-together name or short handle can't be one another crew member has, in that pack or any other, and a pack that doesn't pass is left out with the reason logged and shown in Settings, the rest of the file untouched. A pack of your own leaves the orb's colours as they are. Change or delete one and the names it gave still work after `@` and keep their colours in history; delete the one that's on and the camp goes back to Guild.
- **Decorations** (`ui/src/seasons.ts`; Settings → General → Decorations) are holiday dressing and nothing else: **Winter** (snow), **Halloween** (a few bats) and **New Year** (confetti when an expedition finishes), each with a string of lights under the top bar and a tint on the orb. Off by default; pick one, or "Follow the calendar" to have each appear in its own days. They sit on top of any theme pack, colours and light or dark, are kept in this browser only, and change nothing the crew reads or writes. Nothing moves if your system asks for reduced motion.
- **Memory** has three layers: each agent's own `camp/agents/<id>/memory.md` and sessions; the shared wiki in `camp/wiki/` (`facts/` from you, `notes/` the crew found, with sources); and skills in `skills/<agent>/`, proposed by the Quartermaster and approved by you. `recall` searches what no longer fits in a prompt. In mission control, `/constellation` (or **Open the map** in Settings → Memory) draws every remembered line as a star, grouped by where it lives and joined to the lines it's like or used with: pick one to see where it came from and when it was used, and to pin, forget or merge it. A star grows each time its line is used, counted from `camp/recall-log.jsonl` (written from the day you update; nothing earlier is known).
- **Projects** decide what the crew sees: their folders (and those folders' `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md`, loaded whole; a folder's guides for parts of it and its own skills under `.claude/skills`, `.agents/skills` or `.github/skills`, listed by name to read when they apply), a description, notes the crew keeps, and defaults. A conversation outside a project gets no linked folder unless you bring one in.
- **Scheduled jobs** run unattended and report to `camp/inbox.md`. Only one process runs them at a time. On macOS, `npm run watch:install` runs them with nothing open.
- **What it does unasked** (while mission control is open). It follows the pull requests you opened in linked repositories, wherever their branches live (`src/pulls.ts`). A **pull-request trigger** (Settings → Jobs) carries new review comments or a failed check to the conversation that did the work, as a plan for you to approve, and can have the Scribe redraft the description after a push. A **morning brief** each weekday (`src/brief.ts`) says what's waiting on you, what's in motion, your tickets, what's upcoming and your latest notes, from the record and one look at GitHub and Jira: no model is called, and your notes stay on the page (they aren't sent to the inbox or your phone). A **weekly retro** (`src/retro.ts`) has the smallest model read the week's requests and what reviewers said, and propose what's worth keeping, for you to approve. When the same kind of work was asked for three times or more in the last four weeks, it also drafts a how-to for it, which waits under Settings → Skills. The **scoreboard** (`src/scoreboard.ts`, under Settings → Stats) counts how much of what you typed was operating the pipeline rather than deciding something. The switches for all of it are under Settings → What Mae does unasked.
  - The **night shift** (`src/nightshift.ts`) is off unless you switch it on. Between the hours you set (01:00 to 05:00 unless you change them), once nothing has been asked, running or queued for half an hour, it drafts shorter versions of up to three memories that are past 60% of what a prompt loads, lists unpinned lines more than 90 days old, and runs housekeeping's report. It only drafts and reports: nothing is applied, deleted or changed until you approve it. It makes at most three small model calls a night and none while your usage limit is used up. Each night is written to `camp/night/<day>.json`, and Today shows a "While you were away" card for what you haven't seen.

## Safety

- **Files:** file tools only work inside the camp folder and linked folders. They never read secrets (`.env*`, keys, credentials) at any depth, never touch another agent's memory, and can't write to `skills/`, `plugins/`, or `camp/` except an agent's own outputs folder. Symlinks are checked where they really lead.
- **The camp's own code is read-only** to agents (`src/`, `tests/`, `evals/`, `package.json`). Set `"selfEdit": true` in `camp/settings.json` to let the crew work on Mae itself.
- **Shell commands ask first.** Only narrow read-only commands (`ls`, `git status`, `git diff`…) and your own allow-list run without asking. **Never run** and **Always ask** patterns under Settings → Approvals come before everything else. The camp's keys and anything named like a secret are kept out of every command's environment.
- **Sandbox** (macOS, or Linux with bubblewrap; off by default): commands run without asking, with no network except hosts you list, and writes only inside the project and temp folders. It doesn't protect the project folder itself, so use a worktree for work you want kept apart.
- **Nothing leaves without your click:** agents never commit, push, or merge. Opening a pull request is your button. The Warden's review comment and the Scribe's PR description go out only after you approve the exact text. The crew can read Jira but not write to it; if you turn write-back on, the camp itself leaves a fixed-wording comment on a ticket when its work starts, is ready to look over, gets a pull request, and is merged.
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
| `camp/settings.json` | Models, budget, runtime, how much runs at once, shell rules, `selfEdit`, `phone`, terminal quick actions, `autoExclude` (models Auto never picks) |
| `camp/mcp.json` | MCP connectors (copy `mcp.example.json`) and which agents may use each |
| `camp/links.json` | Linked folders, their access, and their check commands |
| `camp/conversations.json` · `camp/projects/<id>/` | Projects and conversation filing; each project's survey, notes and chronicle |
| `camp/agents/<id>/` | Each agent's memory, sessions, and outputs |
| `camp/wiki/` · `camp/inbox.md` · `camp/quest-log.jsonl` | Shared knowledge, job reports, run history |
| `camp/feed.jsonl` | The saved feed, reloaded on restart |
| `camp/briefs/` · `camp/pulls.json` | Each day's brief; your pull requests in linked repositories, as last read |
| `camp/notes.json` | Your own notes (the Notes panel): off limits to the crew unless you put one in a message |
| `camp/jira.json` · `camp/providers.json` · `camp/.token` | Credentials and the camp's key: readable only by you, off limits to the crew |

Environment: `CAMP_PORT` for another port, `CAMP_NEW_TOKEN=1` for a new key, `CAMP_APPROVE_PLANS=0` to skip plan approval, `CAMP_RUNTIME` to pin the runtime, `CAMP_SHELL_ENV_ALLOW=GH_TOKEN,…` to pass a secret to commands on purpose, `CAMP_LAN=1` to reach the camp from your other machines at home (with `CAMP_NAMES` for extra names it answers to and `CAMP_HOST` to listen on one address).

## Development

The page is a React app in `ui/` (React 19, TypeScript, plain CSS, Vite).

```bash
npm run ui          # the camp plus Vite: page edits reload live (restart it for edits under src/)
npm run ui:serve    # the camp alone, serving the built page
npm run prod        # production: typecheck, build the page and the server (dist/server.js), run it with plain node
npm run prod:start  # run the last prod build again, without rebuilding (a restart in ~0.3 s)
npm test            # the camp's tests, then the page's; no API key or Claude login needed
npm run typecheck   # source, tests, evals, and the page
npm run eval        # standard tasks against the real API (spends tokens)
```

- The feed is a pure function of the camp's events (`ui/src/feed/reducer.ts`), so that's where to look first when the feed shows something wrong.
- The page's types come from the server's code (`ui/src/types.ts`), so `npm run typecheck` fails if the two disagree.
- Tests run each file in a throwaway camp against a fake streaming API. CI (`.github/workflows/ci.yml`) runs the types and the whole suite on every pull request.
- The built-in crew is defined in `src/crew.ts` and `src/roster.ts`, with skills in `skills/<id>/`. Crew members you add from the page live in `camp/crew.json`.
