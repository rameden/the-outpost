# Safety

[← Back to the README](../README.md)

The limits below are kept by Outpost's own code, not by asking the crew nicely.

- **Files:** file tools only work inside the outpost folder and linked folders. They never read secrets (`.env*`, keys, credentials) at any depth, never touch another agent's memory, and can't write to `skills/`, `plugins/`, or `camp/` except an agent's own outputs folder. Symlinks are checked where they really lead.
- **The outpost's own code is read-only** to agents (`src/`, `tests/`, `evals/`, `package.json`). Set `"selfEdit": true` in `camp/settings.json` to let the crew work on Outpost itself.
- **Shell commands ask first.** Only narrow read-only commands (`ls`, `git status`, `git diff`…) and your own allow-list run without asking. **Never run** and **Always ask** patterns under Settings → Approvals come before everything else. Commands stop after two minutes, and when you press Stop. The outpost's keys and anything named like a secret are kept out of every command's environment.
- **Sandbox** (macOS, or Linux with bubblewrap; off by default): commands run without asking, with no network except hosts you list, and writes only inside the project and temp folders. It doesn't protect the project folder itself, so use a worktree for work you want kept apart.
- **Nothing leaves without your click:** agents never commit, push, or merge. Opening a pull request is your button. The Warden's review comment and the Scribe's PR description go out only after you approve the exact text. The crew can read Jira but not write to it; if you turn write-back on, the outpost itself leaves a fixed-wording comment on a ticket when its work starts, is ready to look over, gets a pull request, and is merged.
- **Untrusted content** (web pages, files, connector results, tickets, review comments) is treated as information, never as instructions.
- **Connectors** are read-only unless you allow writes, and then every write asks you first.
- **Budgets** cap each expedition across the Quartermaster and all its quests.
- **The page's server** listens only on `127.0.0.1` unless you turn on LAN mode (`CAMP_LAN=1`, which listens on your home network over plain HTTP). The relay and Tailscale leave it on `127.0.0.1` and put a proxy on the same machine in front of it. Either way it checks the `Host` header, needs the outpost's key for everything, and runs under a Content-Security-Policy with no inline code. From another machine you can make the crew's limits stricter but not looser: raising the approval level, loosening the shell rules, turning on the approval reviewer or self-editing, and setting the Anthropic key are done only on the outpost's own machine. [Remote access](remote-access.md) has the details.

## Approvals from your phone

Optional, through [ntfy](https://ntfy.sh). Set it up under **Settings → Phone**:

1. **Topic**: press **Generate** for a long random one, and subscribe to it in the ntfy app. Leave it empty to turn phone approvals off.
2. **Server**: your own ntfy server, or leave it empty for `https://ntfy.sh`.
3. **Approve from the phone**: tick the kinds you want Approve and Decline buttons for. Anything not ticked only notifies, and you answer it at your desk.

You get a notification for each approval, job report, and long expedition that ends. The approval's text goes to the ntfy server, and anyone who knows the topic can read it and press the buttons, so keep it long and random. Plans and new scheduled jobs can be approved from the phone unless you untick them; shell commands and connector writes only notify unless you tick them. Questions need typing, and what goes on GitHub under your name (a review, a pull request description) is always read and approved in the page.

The page writes this to `camp/settings.json`, where it looks like this (there's no need to edit it by hand):

```json
"phone": { "topic": "camp-3f9c1e7a52d84b06", "approve": ["plan", "job"] }
```
