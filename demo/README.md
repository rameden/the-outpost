# The Mae demo

A camp of its own, pointed at a small sample project with seven bugs in it, so you can watch Mae take a ticket from the board to a reviewed pull request. Four are ordinary bug reports. Three came out of a readiness review for a SOC 2 Type I audit and ISO 27001 certification, and each names the controls it is evidence for.

Nothing here needs a Jira or GitHub account. Tickets and pull requests are stand-ins that run on this machine, and nothing is pushed anywhere else. Your own camp (`camp/`) isn't touched, and the demo uses its own ports, so both can be open at once.

## Start it

You need what Mae needs: Node 22.9 or later, `npm install` done once, and a Claude login (`claude auth login`) or an API key in `.env`. It runs on macOS and Linux (the stand-in for the GitHub CLI is a shell script).

```bash
npm run demo
```

The first start sets everything up. It prints two addresses:

| | Address | What it is |
|---|---|---|
| Mission control | the sign-in link it prints (`http://127.0.0.1:4848/…`) | The demo's camp |
| Tickets and pull requests | `http://127.0.0.1:4849/` | The stand-in for Jira and GitHub: the board, each ticket, and each pull request with its diff and reviews |

Stop it with Ctrl+C. To use other ports, set `MAE_DEMO_PORT` and `MAE_DEMO_STANDIN_PORT`.

## The tickets

The sample project is **Ledgerline**, a small invoicing library (eight source files, 51 tests, no dependencies). Each ticket is one bug. They are independent, so you can run them in any order, one at a time or side by side.

| Ticket | What the reporter saw | Tests that fail until it's fixed |
|---|---|---|
| LED-101 | An invoice shows $10.50 where the amount is $10.05 | 2 |
| LED-102 | The code STUDIO15 is refused on an order of exactly $500 | 1 |
| LED-103 | A monthly plan billed on January 31 skips February | 2 |
| LED-104 | The CSV export splits "Acme, Inc." across two columns | 2 |
| LED-105 | An account with no role can void invoices | 2 |
| LED-106 | Voiding an invoice leaves no entry in the audit trail | 2 |
| LED-107 | Bank account numbers appear in full on receipts and in the audit trail | 4 |

The tickets are the Markdown files in [`tickets/`](tickets). Each gives the symptom, how to reproduce it, what should happen, and acceptance criteria. None says where the fault is.

LED-105 to LED-107 are the compliance ones. Each came from the readiness review and lists, under "Controls this is evidence for", what a fix helps to show:

| Ticket | About | SOC 2 | ISO/IEC 27001:2022, Annex A |
|---|---|---|---|
| LED-105 | Access control: deny unless a role grants it | CC6.3 | 5.15 (access control), 8.3 (information access restriction) |
| LED-106 | Audit trail: every step is recorded | CC7.2 | 8.15 (logging) |
| LED-107 | Data masking: account numbers show only their last four characters | C1.1 | 8.11 (data masking) |

Fixing these bugs is evidence for those controls in this sample project. It is not an audit, and the demo doesn't apply for or grant any certification.

Each ticket's tests are already in the project, marked with the ticket's key (`{ todo: "LED-103" }`). Node runs a test marked that way and shows its failure, but doesn't count it against the build. A fix removes the marker, so the test counts from then on. That is what lets each ticket go green on its own branch while the other six are still open. To see where things stand:

```bash
npm run demo:check
```

It lists each ticket and which of its tests fail. Give it a folder to check a branch Mae worked on: `npm run demo:check -- demo/.instance/ledgerline-camp/<branch>`.

## A run, step by step

1. Open mission control with the sign-in link.
2. Go to the **Jira** page. The seven tickets are there. Open one and press **Start work…** (or use **Start a ticket** in the sidebar).
3. Go through the steps (Details, Where, Who) and press **Start** on the last one. The defaults are right: the ticket's acceptance criteria as what "done" means, the Ledgerline project, a new worktree on a branch named after the ticket, and the Quartermaster in charge.
4. The Quartermaster shows its plan. Approve it.
5. Watch the crew work. The Artificer changes the code and runs the tests; the camp runs `npm test` again by itself afterwards; the Warden reviews the change before the Quartermaster reports. A plain `npm test` runs without asking. The Artificer often chains it with something else (`npm test 2>&1 | tail -40; git diff --stat`), and a chained command always asks: read the card and approve it.
6. Read the report: it goes through the ticket's acceptance criteria one by one.
7. Press **Commit…** on the conversation, then **Pull request…**. The description is drafted from the record for you to edit.
8. Ask for the write-up and the review by replying in the same conversation:

   > The fix is committed and pull request #1 is open. Have the Scribe write its description and update it, then have the Warden review the pull request and post the review.

   The Scribe's description and the Warden's review each come to you as a card with the exact text. Nothing changes on the pull request until you press Update or Post.
9. Open `http://127.0.0.1:4849/` to see the pull request with its check, its description, the Warden's review, and the diff. The ticket has moved to In Review.

For a small bug the Quartermaster often sends the Artificer straight in. To see the Scout range ahead first, add a line under **Anything else the crew should know** on the Details step, such as: *Have the Scout find the cause before anything is changed.*

## What a successful run looks like

- The plan names who does what, and nothing happens until you approve it.
- The change is small and in one source file, plus the ticket's tests losing their `todo` marker. The test's expectations are not changed.
- `✓ check: npm test` appears on the quest, and `npm run demo:check -- <the worktree>` says the ticket has been fixed in that copy while the other six are still open.
- The Warden's review is in the report, with any findings listed.
- The commit and the pull request exist only because you pressed the buttons. The pull request and the review comment say what you approved, word for word.
- The pull request's page shows `✓ npm test passed`: the stand-in ran the tests on the branch as it was pushed.
- On the stand-in board the ticket went To Do → In Progress (when work started) → In Review (when the pull request opened).
- Your checkout of the sample project (`demo/.instance/ledgerline`, on `main`) is unchanged: the work is on its own branch, in its own worktree.

## Reset

Stop the demo, then:

```bash
npm run demo:reset
```

This puts the sample project back on `main` with its seven bugs, removes every branch, worktree and pull request, moves the tickets back to To Do, and gives the demo's camp a clean start: no conversations, and no memory of where the bugs were. A browser that was signed in stays signed in.

## What is real and what is a stand-in

Mae itself is the real thing, running from this repository's source, with the real crew on your Claude subscription or API key. A run uses your usage like any other: taking one ticket all the way to a reviewed pull request came to about $0.60 at API prices when this was put together.

| Part | In the demo |
|---|---|
| Jira | [`standins/server.mjs`](standins/server.mjs) answers the Jira calls Mae makes, from the files in `tickets/`. The camp is pointed at it with `JIRA_ALLOW_ANY_HOST=1`, the switch Mae's own tests use. |
| GitHub | [`standins/bin/gh`](standins/bin/gh) is run where Mae would run the GitHub CLI. A branch is pushed to a bare repository in `demo/.instance/forge/`, and pull requests and reviews are kept in a file beside it. |
| The pull request's check | A real run: the stand-in clones the pushed branch into a temporary folder and runs `npm test` there, once for each commit. |
| Pull request links | Mission control shows a pull request as `https://github.com/mae_demo/ledgerline/pull/1`. That address is made up (GitHub doesn't allow an underscore in an account's name, so it can't be anyone's). The pull request is really at `http://127.0.0.1:4849/pulls/1`. |
| Commits | Made in the sample project's own repository, as "Demo User". |

The demo's camp differs from a new camp of your own in four ways, all set in [`demo.mjs`](demo.mjs):

- `npm test` runs without asking in the sample project, and is the automatic check after each change. Every other shell command still asks.
- The Ledgerline project starts each conversation in its own worktree, and has the Warden review changes before the Quartermaster reports.
- Jira write-back is on, so starting work and opening a pull request move the ticket and leave a comment on it. It writes only to the stand-in.
- Any `JIRA_*` settings and LAN mode in your environment are ignored, so the demo never reads your real Jira and never listens beyond this machine.

Everything the demo makes is in `demo/.instance/`, which git ignores:

| Folder | Holds |
|---|---|
| `ledgerline/` | The sample project, as a git repository of its own (a copy of [`sample/ledgerline/`](sample/ledgerline)) |
| `ledgerline-camp/` | The worktrees Mae makes, one per conversation |
| `forge/` | The bare repository branches are pushed to, the pull requests, and the tickets' status and comments |
| `mae/` | The demo's camp folder: its settings, conversations, and the crew's memory |

## For the presenter: where each bug is

Don't show this part. The crew can't read it: this folder is outside the demo's camp and the sample project.

| Ticket | File | The fault | The fix |
|---|---|---|---|
| LED-101 | `src/money.js` | `formatMoney` pads the cents on the right (`padEnd`), so 5 becomes "50" | Pad on the left (`padStart`) |
| LED-102 | `src/discounts.js` | `applyDiscount` asks for a subtotal over the minimum (`>`) | Reaching the minimum counts (`>=`). Mae also kept a $0 subtotal from qualifying for a code with no minimum, as it didn't before. |
| LED-103 | `src/billing.js` | `nextBillingDate` adds a month with `setUTCMonth`, which rolls January 31 over into March | Clamp to the last day of the next month |
| LED-104 | `src/export.js` | `toCsv` joins fields with commas and never quotes them | Quote a field that has a comma, a quote or a line break, doubling inner quotes |
| LED-105 | `src/access.js` | `can` returns `true` for a role that isn't in `ROLES` (or for none) | Return `false`: deny unless a role grants it. Mae has also added a check that the role is a string, so a list such as `["admin"]` isn't read as the admin role. |
| LED-106 | `src/lifecycle.js` | `voidInvoice` returns the trail it was given, with no new entry | Add a "voided" entry whose note is the reason |
| LED-107 | `src/receipt.js` | `maskAccount` returns anything that isn't all digits as it was written | Drop spaces and dashes, show only the last four characters, and hide a number of four or fewer completely |

## If something goes wrong

- **"Port 4848 is taken"** (or 4849): something else is using it. Set `MAE_DEMO_PORT` or `MAE_DEMO_STANDIN_PORT` and start again.
- **"The demo is already running"**: stop the other one first (Ctrl+C in its terminal).
- **The crew can't start**: the demo runs the crew the way your own camp does. Check `claude auth status`, or put `ANTHROPIC_API_KEY` in the repository's `.env` and switch the runtime under Settings → General in the demo's mission control.
- **A run went sideways**: stop the demo and `npm run demo:reset`.
