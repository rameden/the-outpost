# Commands

[← Back to the README](../README.md)

## In the terminal

In `npm run cli`, type a request for the Quartermaster, or:

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
| `/goal [rounds] <goal>` | Work towards a goal: after each run a small model judges whether it's met, and the crew carries on until it is (10 rounds unless you say) |
| `/pause [why]` · `/resume` | Pause everything: no job, trigger, queued or new request starts (what's running finishes) until `/resume` |
| `/log` · `/jobs` · `/wiki` · `/memory <name>` | Recent quests; scheduled jobs; the wiki index; what a crew member remembers |
| `/model [name model [effort] \| name auto[:economy\|balanced\|quality] \| name reset]` · `/turns <name> <n \| reset>` | A crew member's model (or Auto), or how many turns one run may take |
| `/runtime [claude-code \| api]` · `/budget [dollars \| off]` | What runs the crew; a spending cap per expedition |
| Ctrl+C | Stop the running expedition; press again to quit |

## In the page

⌘P (Ctrl+P) opens the command palette, and a message starting with `/` is a command for the page: `/new`, `/find`, `/next`, `/settings`, `/today`, `/orbit`, `/trail`, `/constellation`, `/notes`… [How Outpost works](how-it-works.md#the-page) says what each view shows.

## Headless runs

For scripts, CI, and GitHub Actions ([an example workflow](github-action.md)):

```bash
npm run headless -- --json --approve-plan --worktree web "Fix the flaky date test in links/web"
echo "Tidy the README" | npm run headless -- --agent scribe -
```

- `--approve-plan` approves the plan; nothing else is approved for you. Shell commands run only if your allow-list or the sandbox lets them, and each decline is listed.
- `--json` prints one object at the end (`id`, `status`, `text`, `costUsd`, `changed`, `worktrees`, `declined`); progress goes to stderr.
- `--project <id>`, `--worktree <link>` and `--agent <name>` work as they do in the page.
- Exit codes: 0 finished, 1 failed or refused, 2 stopped short (budget, turn limit, cut off).
