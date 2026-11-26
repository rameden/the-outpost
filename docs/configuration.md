# Configuration

[← Back to the README](../README.md)

Most of this is set from the page, under **Settings**. This is what sits underneath.

## Subscription or API key

On your subscription the crew runs through Claude Code: usage counts against your plan's limits, and costs shown in the outpost are estimates at API prices. Your own Claude Code settings, hooks, `CLAUDE.md` and MCP servers aren't loaded for the crew.

**On the API instead:** connect Anthropic in Settings → Models, then select the API runtime in Settings → General (or `/runtime api` in the terminal). Keys are verified before saving, kept in the owner-only `camp/providers.json`, and never returned to the page. A saved key takes precedence over `ANTHROPIC_API_KEY` in `.env`; disconnecting it falls back to the environment key. An existing environment key can be imported directly in Settings → Models without displaying it. API billing and limits are separate from your Claude subscription.

## Windows and Linux

**On Windows** it works the same way. The crew's commands run in Git Bash (or PowerShell without it; set `CAMP_SHELL` to choose), there's no sandbox (run inside WSL 2 for one), and `npm run watch:install` prints a Task Scheduler command instead of installing a macOS agent.

**On Linux** it hasn't been tested yet. Two things to know: the sandbox uses bubblewrap (install your distribution's `bubblewrap` package), and the terminal pane needs `node-pty`, which ships ready-built for macOS and Windows only, so on Linux it has to be compiled (`npm rebuild node-pty`, with a C++ toolchain and Python installed; `package.json`'s `allowScripts` turns its build script off by default). Everything but the terminal pane works without it.

## Files

Everything in `camp/` is local to you and gitignored. The main files:

| File | Holds |
|---|---|
| `camp/outpost.json` | The outpost's name and port |
| `camp/settings.json` | Models, budget, runtime, how much runs at once, shell rules, `selfEdit`, `phone`, terminal quick actions, `autoExclude` (models Auto never picks) |
| `camp/mcp.json` | MCP connectors (copy `mcp.example.json`) and which agents may use each |
| `camp/links.json` | Linked folders, their access, and their check commands |
| `camp/conversations.json` · `camp/projects/<id>/` | Projects and conversation filing; each project's survey, notes and chronicle |
| `camp/agents/<id>/` | Each agent's memory, sessions, and outputs |
| `camp/wiki/` · `camp/inbox.md` · `camp/quest-log.jsonl` | Shared knowledge, job reports, run history |
| `camp/feed.jsonl` | The saved feed, reloaded on restart |
| `camp/briefs/` · `camp/pulls.json` | Each day's brief; your pull requests in linked repositories, as last read |
| `camp/notes.json` | Your own notes (the Notes panel): off limits to the crew unless you put one in a message |
| `camp/tickets.json` · `camp/packs.json` · `camp/night/` | The outpost's own tickets; theme packs you made; what each night shift left |
| `camp/jira.json` · `camp/providers.json` · `camp/.token` | Credentials and the outpost's key: readable only by you, off limits to the crew |

## Environment

Put these in `.env` in the folder an outpost runs in (this checkout for Mae), or in the shell that starts it. The star chart and `npm run outpost` don't read `.env`, so `HUB_PORT` and `OUTPOSTS_DIR` go in the shell. [`.env.example`](../.env.example) has the ones most people touch. None is required on a Claude subscription.

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | An Anthropic API key for the API runtime. A key saved in Settings → Models is used first. |
| `CAMP_RUNTIME` | Pins the runtime: `claude-code` (your subscription) or `api`. |
| `CAMP_PORT` | The port for an outpost you start by itself (`npm run ui`, `npm run ui:serve`). Started from the star chart or `npm run outpost`, it uses the port in its `camp/outpost.json` (4747 for Mae when there's no file). |
| `CAMP_UI_PORT` | The live-reload page's port under `npm run ui`. |
| `HUB_PORT` | The star chart's port (`npm start`), 4700 unless you set another between 1024 and 65535. |
| `OUTPOSTS_DIR` | Where outposts other than the first are kept. `~/Outposts` unless set. |
| `CAMP_NEW_TOKEN` | `=1` makes a new key for the outpost on its next start, signing every browser out. |
| `CAMP_APPROVE_PLANS` | `=0` skips plan approval. |
| `CAMP_SHELL_ENV_ALLOW` | Names of secrets to pass to the crew's commands on purpose, comma-separated (`GH_TOKEN,…`). Everything else that looks like a secret is left out. |
| `CAMP_LAN` | `=1` lets your other machines at home reach the outpost ([Remote access](remote-access.md)). |
| `CAMP_HOST` · `CAMP_NAMES` | With `CAMP_LAN`: listen on one address instead of all of them; extra names the outpost answers to. |
| `CAMP_PROXY_NAMES` | The names a proxy in front of the outpost, on the same machine, serves it under. The Tailscale and relay scripts set it. |
| `CAMP_SHELL` | On Windows, the shell the crew's commands run in. |
| `CLAUDE_CODE_EXECUTABLE` | The `claude` to run when it isn't on your PATH. `claude` unless set. |
| `CAMP_GH` | The `gh` to run when it isn't on your PATH. |
| `ELEVENLABS_API_KEY` | A key for read-aloud voices, without saving one in Settings → Voice. |
| `ELEVENLABS_BASE_URL` | Where the ElevenLabs API is. `https://api.elevenlabs.io` unless set; the tests point it at a stand-in. |
| `JIRA_BASE_URL` · `JIRA_EMAIL` · `JIRA_API_TOKEN` | Jira's address and credentials from the environment. All three together are used ahead of what Settings saved. |
| `JIRA_ALLOW_ANY_HOST` | `=1` lets Jira be a stand-in on this machine. For tests only. |
| `CAMP_CHART` | Set by the star chart on each outpost it starts, so the header can link back to it. Not one to set yourself. |
| `EVAL_SET` · `EVAL_CASE_BUDGET` · `EVAL_JUDGE_MODEL` · `EVAL_NO_JUDGE` | Read by `npm run eval`. |

The relay, Tailscale and site scripts read a few of their own (`RELAY_ZONE`, `RELAY_DOMAIN`, `RELAY_NAME`, `RELAY_REGION`, `SITE_DOMAIN`, `OUTPOST`): see [the relay runbook](remote-relay.md) and each script's header.
