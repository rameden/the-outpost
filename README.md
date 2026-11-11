# Satchel

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

Satchel uses **npm** (`package.json` pins it, so pnpm and yarn stop with a message instead of half-installing). No dependency install scripts are needed: esbuild, fsevents, and node-pty are marked as reviewed and denied under `allowScripts`, and the app makes node-pty's helper executable itself.

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
npm run ui      # mission control in your browser (open the link it prints); it reloads as you edit the page. npm run dev does the same
npm start       # the camp in your terminal
npm run watch   # run scheduled jobs from the terminal (mission control runs them too)
```

Try: *"Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc."*

## Mission control

`npm run ui` serves a local dashboard on `127.0.0.1`. It has:

- **History, down the left:** every conversation you've had with the camp, filed under projects. **New conversation** gives you a clean page, so unrelated work stays out of each other's context; opening a conversation shows only that one, and what you send there continues it with everything said so far. **All activity** shows everything at once, scheduled jobs included. A dot marks a conversation with something running, and a number marks decisions waiting on you. Each project lists its newest five conversations, with **View all** for the rest. **Search** looks through titles and through what was asked and answered. The **⋯** menu on a conversation renames it, moves it to another project, or removes it from the list (its record stays in the camp folder).
- **Feedback:** a finished expedition or direct chat asks "How was this?". A 👍 or 👎 is saved the moment you click it, and you can add a note. Whoever answered sees their recent feedback at the top of their next prompts: your notes, every 👎, and how their last rated answers went. Feedback given inside a project is shown only in that project. Unless you untick it, a note is also kept as a standing note straight away (in the project's notes, or in the memory of whoever answered), so it stays for good instead of ageing out of the recent list. In the terminal: `/good [note]` and `/bad [note]`.
- **Projects:** see [Projects](#projects) below.
- **Pages have no message box:** the message box belongs to conversations. On Projects, a project's page, Jira and the wiki there isn't one (each has its own way to start something: **New conversation**, **Start a ticket**). What you'd attached or half-written is kept and is there when you're back in a conversation; **Attach to message** on a ticket takes you back to the one you were in.
- **Terminal, along the bottom:** your own shell on this machine, in the page. Hide it with its **⌄** button or Ctrl+`; while it's hidden it leaves a slim **Terminal** tab where it was, and clicking that (or Ctrl+` again) brings it back. Drag the line above it to resize it. Tabs are separate sessions, and a new one starts in the folder of the project you're in. Sessions belong to the camp server, so hiding the pane or reloading the page doesn't end them; they end when you close the tab, exit the shell, or stop the camp. The terminal is yours alone: no crew member can see or type into it, and nothing from it goes into the camp's feed.
- **Add to the crew:** the **+** at the end of the crew bar adds a crew member of your own (see [Adding a crew member](#adding-a-crew-member)).
- **The crew, across the top:** a slim strip by default: each agent's icon and name with a status dot, and what they're doing spelled out while they're working or waiting on you (hover any of them for the rest). The chevron at the end opens it up into cards with live status for each agent, XP, and a picker to change its model, effort level, and turn limit (how many replies one run may take; the Artificer gets 60, others 20 or 30); the same chevron folds it back, and your choice is remembered.
- **Live feed:** it reads as a back and forth. What you asked is a message on the right, formatted the way the message box showed it (code, bold, lists), with the time under it; a very long one, like a ticket's brief, is folded until you click **Show all of it**. The crew's answer is under it on the left: replies stream in as they're written, and each quest gets its own block (parallel quests run side by side in the feed). While an answer is being worked on, the bar at its foot takes a message to the run, with **Stop** beside it.
- **Approvals as buttons:** plans, shell commands, new scheduled jobs, and connector tools that make changes.
- **Several at once:** expeditions, direct chats, and scheduled jobs run side by side, up to 3 at a time by default (change it under Quests, 1–8); the rest wait their turn. Each has its own block in the feed, its own approvals, and its own budget. More at once uses up your plan's limits (or API spend) faster.
- **Stop button** on each running expedition, which cancels it and every quest in it and leaves the others running.
- **Attachments:** a **+** menu for files, folders, images, pasted images, links, and prompt snippets; `@path` references project files inline; drag and drop works too. Images and PDFs reach the model as real image and document blocks.
- **Linked folders:** for big folders (hundreds of files), use **Link a folder…** instead of uploading: **Choose folder…** opens your system's folder picker (or paste a path), and agents read it where it lives as `links/<name>/…`. They get an overview and explore it with `list_dir`, `glob`, and `grep`. Read-only unless you choose "Can edit".
- **Worktrees:** when a linked folder is a git repository, a picker under the composer chooses where the next request works: the linked checkout, a new worktree and branch (`<repo>-camp/<branch>` beside the repo, branch `camp/<task>`), or a worktree you already have. The file tools and the shell follow it, and a follow-up stays in the same worktree. When the expedition ends its card shows the branch, with **Commit…**, **Open PR…** (pushes and uses the GitHub CLI), and **Remove worktree**. Those three are yours to press; agents never commit or push on their own. A new worktree has no installed dependencies until you install them.
- **Steer:** a box on each running expedition sends a message to the agents working in it; they see it on their next step.
- **Resume:** an expedition that was cut off by a restart, stopped, failed, or ran out of turns gets a **Resume** button, which starts again from what the feed recorded of it (the plan, who was sent, what they did) in the same worktree.
- **Checks after changes:** on a linked folder's card (Connectors tab), list commands such as `npm run typecheck`. The camp runs them by itself after any quest changes files there and attaches the results to the quest's report.
- **Files, on the right:** when a folder is attached to where you are (the project's folders, one attached to the conversation, or one sitting in the message box), a **Files** tab appears down the right edge. Open it (or the panel button in the header, or Ctrl+Shift+E) for a tree of that folder; drag the line beside it to resize it. Folders load as you open them. Click a file to read it: its text with line numbers and its code coloured by language (told from the file's name, with a light and a dark set of colours), or the image; the **@** beside any row puts a reference to it in your message. Icons are coloured by what a thing is (source, tests, docs, data, styles, media, scripts, config; build output and lock files are dimmed), and folders by what they hold. Files git reports as changed carry a letter (**M** modified, **A** added, **U** untracked) and the folders around them a dot, and the tree is read again whenever the crew starts or finishes a run, so you can see what was touched. A conversation that worked in its own worktree shows that worktree, with its branch. It reads only inside folders you linked: nothing leads out through a symlink, `.git` is left out, and secrets (`.env`, keys, credentials) are listed but never opened, the same files that are off limits to the crew.
- **Layout, yours to arrange:** the page is made of zones, each showing one part: **Chat**, **History**, the **Agent roster**, **Files**, or the **Terminal**. Drag the line between two zones to resize them (or focus it and use the arrow keys). The layout button in the header opens the editor: a small map of the page where you click a zone to choose what it shows, add a zone to its left, right, above or below (up to 8), remove it, or set whether it keeps a fixed size, shares the leftover space, or fits what's in it. Choosing a part that's already on the page swaps the two. Chat always has a zone; anything else can be taken off the page and put back later. The roster turns from a bar into a list when its zone is narrow; as a bar it's always as tall as what's in it (slim, or opened up into cards), so it has no height to set. Changes apply as you make them and are remembered in this browser; **Reset** goes back to the default (roster on top, history left, chat in the middle, files right, terminal along the bottom). In a narrow window the zones stack down the page instead.
- **Motion:** things ease rather than pop. Dialogs, the agent drawer and Settings fade and settle in, and out again when closed; the terminal and Files slide into their zones and back out; when the crew bar opens up or folds down, the rest of the page glides to its new place; menus, tree rows and "show more" sections unfold. It's brief (about a fifth of a second), it moves things with transforms and fades only (so it stays smooth beside a long conversation), and it's switched off completely if your system is set to reduce motion.
- **Panels that close, and focus mode:** History, Files and the terminal each close to a slim tab where they were (History with the **«** beside New conversation), and the tab brings them back. The **focus** button in the header closes whichever of the three are open in one go, leaving the conversation; press it again and the ones it closed come back. In a narrow window a closed panel is a bar in the stack instead.
- **The message box styles markdown as you type:** `` `code` `` is set as code, a line of three backticks opens a code block (and another closes it), and `**bold**`, `*italic*`, `~~struck~~`, `# headings`, `> quotes`, list markers, `[links](url)` and `@mentions` are styled too. Once a pair of markers takes effect it goes out of sight: code shows without its ticks, bold without its stars, and a code block without its ``` lines (those show only while the cursor is on one, and the language you named moves to the block's corner). They're still in the message, so what's sent is exactly what you typed; Backspace over a marker brings the plain text back, and Backspace at the very start of a block's code unwraps the block. Heading, quote and link markers stay visible, dimmed. Shortcuts: ⌘B bold, ⌘I italic, ⌘E code, ⌘⇧X strike, ⌘K link (Ctrl on Windows and Linux), each again to take it off; ⌘Z and ⌘⇧Z undo and redo. Shift+Enter is a new line and carries a list or quote on (an empty item ends it). Press Enter after the three backticks and the block's closing line is added for you, with the cursor inside. Inside a block, Enter is a new line of code and Tab indents; move below the block and Enter sends again, or press ⌘Enter (Ctrl+Enter) to send from anywhere. Three backticks around something on one line, like `` ```npm test``` ``, is inline code, not a block.
- **Getting about from the keyboard:** ⌘P (Ctrl+P) opens the command palette: type to jump to a conversation, a project, or a file by name in the folders attached where you are, or to do something (new conversation, focus mode, a panel, Settings). Ctrl+Shift+A goes to the next decision waiting on you, in whichever conversation it's in, with its first button focused so Enter approves. A message that starts with `/` is a command for the page, with suggestions as you type: `/new`, `/focus`, `/files`, `/terminal`, `/history`, `/find <name>`, `/next`, `/good [note]`, `/bad [note]`, `/layout`, `/settings`.
- **Drafts are kept:** what you've typed and not sent stays with the conversation (or new page, or project) you typed it in, in this browser, through a reload or a trip elsewhere.
- **File paths in answers open:** a path the crew writes as code (`src/app.ts`, `links/site/README.md`, `lib/a.ts:42`) is a link: click it and the file opens in the viewer, at that line if it named one. The viewer's **Changes** tab shows what's different in the file since the last commit, old beside new.
- **A failed check is sent back to be fixed:** when a folder's own checks fail after a quest, the same crew member gets the failing output and fixes what it broke, and the checks run again (once by default; change it, or turn it off, under Settings). Optionally the Scout **reviews the change** before the Quartermaster reports, which is off unless you turn it on, since each review is another quest's worth of usage.
- **One next step:** a conversation that works in its own worktree has a strip under its title: the stages its work goes through (Work, Commit, Pull request, Review, Merged) with the one it's at underlined, a line saying where its branch stands, and the next step as the one main button: **Commit…** when there are uncommitted files, **Pull request…** once they're committed, **Push** when you've committed since (answering review feedback, say) and the pull request doesn't have those commits yet, **Bring in feedback** when the pull request has something new, **Resume** when the last run didn't finish, **Remove the worktree** once it's merged. Anything else you could do from there is under **More**. Commit has its own dialog (the message starts from the ticket and the conversation's title). Every step is still your click.
- **What needs you, in one place:** the chip in the header counts what's waiting on you across every conversation and lists it: a decision the crew is waiting on, a pull request with new feedback, a chained request that's held, and a run that failed. Runs that finished since you last had their conversation open are listed with them but counted apart ("2 things need you · 3 finished"), since they're news rather than a job; **Mark what's finished as seen** clears them. A row goes to where the thing is. In History the same conversations are marked (**PR**, **!**, or a dot). `/next`, or Ctrl+Shift+A, goes to the most pressing one. "Since you last looked" is kept in this browser.
- **Switch branches from the composer:** the branch label beside Send opens "Where to work". Right under each repository's **Linked checkout** is a box: click it for the repository's other local branches, type to narrow them, and pick one to switch your checkout to it; type a name that isn't there and **Create** makes that branch from where the checkout stands (Enter does whichever fits what you typed). It's `git switch`, so nothing uncommitted is thrown away: if a switch would overwrite your work, git refuses and the panel shows what it said. It works on a follow-up too. A repository with many worktrees lists the first few, with the rest a click away.
- **Leave a folder out:** in a project, the "Where to work" menu (the label beside Send) has **Leave it out** for each of the project's folders: under New worktree for a repository (above its worktrees, so it's in view however many there are), and as Use it / Leave it out for a folder that isn't a repository. With more than one folder, **No folders for this conversation** at the top leaves them all out in one click. A conversation started that way doesn't get the folder at all: none of its files, not its `AGENTS.md`, and the crew is told it was left out on purpose. It's still filed under the project, with the project's description and notes. The label beside Send reads "not used", and replies in that conversation stay that way until you bring the folder in.
- **Take a folder out, or bring one in, part-way:** the same menu works on a reply. Where a conversation works is fixed once it has started (its worktree and branch stay), but what it's given isn't: **Leave it out** (or **Don't use it**) on a reply takes that folder out of the conversation from that message on, and **Linked checkout** / **Use it** on a folder it's without brings it in; attaching or mentioning a folder (`@links/<name>`) brings it in too. Until you send, picking the row it was on puts it back. Once it's out, the crew has none of its files or its `AGENTS.md`, stops working in its worktree, and is told you took it out on purpose (what was already said about it earlier in the conversation is still there to read). The worktree and its changes stay on disk, and the conversation's commit and pull request strip still shows them. Outside a project (General, or a new conversation in no project) it works the other way round: a conversation there gets no linked folder until you bring one in, so the label reads **No folder** and the menu lists every linked folder starting on **Don't use it**. Pick **Linked checkout**, **New worktree** or a worktree (or **Use it** for a folder that isn't a repository) to bring it in, and **Don't use it** to take it out again before you send; that also drops the folder if you'd attached it to the message. Only the folders in use show beside Send.
- **Chats with a crew member are grouped:** under each project, the Quartermaster's conversations are listed as they are, and your direct chats with a crew member are kept behind that crew member's name, in their colour, with a count. Click the name to open the group (it stays open in this browser, and the group you're in is always open).
- **Jira:** link your Jira Cloud account under Settings → Connectors: your Jira address (`https://yourteam.atlassian.net`), your Atlassian account email, and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). The camp checks them with Jira before keeping them. Then **Jira ticket** in the + menu attaches a ticket to your message (the ones you looked at last, a key like `APP-123`, or words to search for), and the crew has a read-only `jira` tool to look a ticket up or search. Once it's linked, a **Jira** tab appears under Projects: the tickets the camp pulls in, as cards (key, type, status, summary, labels, priority, who has it, when it changed), which you can narrow by words, status and type; a card opens the whole ticket (its details, description and comments) to attach to your message or open in Jira. **Epics** show too: a card says which epic its ticket is in, **Group by epic** puts the cards under their epics (or narrow to one epic, or to tickets in none), and an epic opens like any ticket, listing the tickets in it; from a ticket you can step up to its epic and back. **Which tickets are pulled in** is one setting for the whole camp, kept beside the account under Settings → Connectors: a filter in Jira's query language (JQL), starting as "assigned to me, not done", with the usual ones a pick away. Try a filter to see what it matches, then keep it; Jira runs it first, so one it rejects isn't kept. The Jira tab and the + menu's first list both follow it. Nothing is written to Jira. The token stays in `camp/jira.json` on your machine, readable only by you and off limits to every crew member; it's never sent to the page. `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` set where the camp starts are used instead when all three are there. A ticket's text reaches the crew marked as the ticket's own content, to be read, not obeyed.
- **Start a ticket, step by step:** **Start a ticket** in the sidebar (also on the Jira page, **Start work…** on any ticket, or `/ticket`) opens a five-step dialog, each step already filled in so it's usually Next, Next, Next, Start. **Ticket:** the ones your filter pulls in, or search by key or words. **Details:** the ticket's acceptance criteria (the list under that heading in its description) as a checklist you can untick, reword or add to, and a box for anything else the crew should know. **Where:** the project (the one you used last), and a new worktree on a branch named after the ticket when the project has a repository the crew may edit. **Who:** the Quartermaster (plans it and sends whoever each part needs) or straight to one crew member, and whether the Scout reviews the changes before the report. **Start:** what will happen, and the brief word for word, yours to edit. Nothing is sent until you press **Start the work** there. The conversation stays tied to the ticket: its key shows at the top (click it for the ticket), and it's what a pull request and the chronicle name.
- **The wiki has its own page:** **Wiki** in the sidebar, under Jira. Every page is a card under Facts (what you told the crew or decided) or Notes (what the crew found, with sources); narrow them by name or words, and click one to read it. **New page** adds one of your own: a title (it becomes the file's name), whether it's a fact (something you're telling the crew, treated as true) or a note (something found, treated as a claim), a one-line summary (what the crew sees in the list at the start of every run), and the page in Markdown. Any page can be **Edit**ed or **Delete**d from where you read it. `/wiki` goes there too.
- **Pull requests with a real description:** **Pull request…** on a worktree opens a dialog with the title and description already drafted from the record: the ticket and its acceptance criteria (left unticked, for you), the files changed with their line counts, the commits, how your checks came out, and what the crew reported. Change anything, then **Push and open it**. If the branch has a pull request already, the same dialog updates that one's title and description instead.
- **The review loop:** every few minutes while mission control is open, the camp looks (with the GitHub CLI, as you) at the pull requests of worktrees the crew worked in lately. The strip at the top of the conversation says where its pull request stands: failing checks, review comments, changes requested, a conflict with its base, or merged. When there's something new, **Bring in feedback** reads it into a reply for you to read and send (it isn't sent for you: anyone who can comment on the pull request wrote it). The camp only looks: it never answers a review, pushes, or merges. Turn it off under Settings → Limits & budget ("Watch open pull requests").
- **Second opinions and reviews:** a finished answer has **Second opinion…**: pick a crew member and they step into the conversation for one turn, check the same code themselves, and say where the answer is wrong or thin. When files changed, **Review changes…** has them read the diff and end with findings, which the page shows as a list (must fix, should fix, small) with each file a click away; tick the ones you agree with and **Ask for these to be fixed** puts them in the message box as a change request. The conversation stays with whoever it was with, and they're told who said what. With "Review changes before reporting" on, the Quartermaster's own review is asked for in the same form, so findings it left unfixed show up as the same list.
- **Chains:** while something is running or queued, **Start after…** beside Send holds your next request until that work has finished. It then starts by itself, told what the work before it did and working where it worked. If that work was stopped or failed, the chained request is held instead, with **Start it anyway** and **Take it off**; what's waiting is listed above the message box wherever you are.
- **Jira write-back (off unless you turn it on):** under the Jira account in Settings → Connectors. On, a ticket you start work from gets a short comment saying work has started and on which branch, and another with the link when you open its pull request; name a status for either moment and the ticket is moved there too (left alone, and you're told, if your workflow has no such step). The comments are the camp's own fixed words, posted as you. The crew still has no way to write to Jira.
- **Packaged skills:** Settings → Skills → **Import a packaged skill** takes a `.skill` file (a zip of a skill's folder: `SKILL.md` beside its scripts and reference pages). Choosing one only opens it: you see its description, its files, and each script's text. Installing puts it in `skills/<owner>/<name>/` for everyone or one crew member, and you choose what it may run without asking: any of its own scripts (each pinned to the file as it is then, so a changed script asks again) and other command prefixes such as `pnpm add`. Those are listed with the skill and go when you **Remove** it.
- **Skills that are always on:** a skill is normally listed for the crew by name and description, and opened when a task seems to match. Under Settings → Skills, tick a crew member beside **Always on for** and that skill's instructions go into every one of their prompts in full, so they follow it without having to notice it applies (a shared skill can be always on for anyone; a crew member's own, for them). Their page marks it. Each one makes every prompt a little longer, so keep it to the ones that really do apply to everything.
- **Edit a skill in the page:** every installed skill (imported, approved from a proposal, or one that came with the camp) has **Edit** under Settings → Skills. It opens the skill's `SKILL.md` and the text files beside it in an editor; pick a file on the left, change it, and **Save** (⌘S / Ctrl+S), or **Add a file…** for a new reference page or script. `SKILL.md` has to keep its front matter (its name, which is its folder, and a one-line description), and the crew reads the new version from their next run. A script you let run without asking stays approved when you change it here, since the change is yours; changed any other way, it asks again.
- **Follow-ups:** **Reply** on a finished expedition continues that conversation, with every earlier request and full answer carried over (in the terminal: `/reply <message>`).
- **Changes you can review and undo:** when an expedition's file tools change files, its card shows how many, with **View changes** (a diff) and **Undo** (puts every file back). This covers `write_file` and `edit_file`, not changes made by shell commands.
- **Plan usage:** on your subscription, the Quests tab shows your 5-hour and weekly windows as Claude Code reports them. If one is used up, the camp pauses: queued work and scheduled jobs wait for the reset instead of failing ("Try anyway" overrides it).
- **Notifications:** the 🔔 button turns on browser notifications for approvals and long expeditions finishing while the tab is in the background. For your phone, see [Approvals from your phone](#approvals-from-your-phone).
- **The feed is kept:** it's saved to `camp/feed.jsonl` and reloaded when mission control restarts.
- **Agent pages:** click any crew card to chat with that agent directly, browse its runs and each run's steps, edit its memory, see its output files, and check its tools, skills, and stats.
- **Tabs:** Quests (cost, tokens, cache rate, model per run, plus a spending summary and per-expedition budget), Memory, Jobs, Skills, Connectors, and Inbox.

It only listens on `127.0.0.1`, checks the `Host` header, and requires a key that changes every launch (for the page's own scripts and styles too), so other websites in your browser can't drive the camp. The page runs under a Content-Security-Policy that allows no inline code, only the scripts and styles the camp itself serves.

### Working on the page

The page is a React app in `ui/` (React 19, TypeScript, plain CSS, built with Vite). `npm run ui` runs the camp with Vite's dev server in front of it, so the page reloads as you edit; `npm run ui:serve` runs the camp alone, serving the built files from `ui/dist` with no second server.

```bash
npm run ui         # the camp plus Vite: a saved change in ui/src shows up in the open page
npm run ui:serve   # the camp alone, serving the last build (builds first if ui/dist is missing or older than ui/src)
npm run ui:build   # just build it
```

- `npm run ui` starts the camp as usual and puts Vite's dev server in front of it. Vite serves the page from `ui/src` and passes `/api` and `/events` through to the camp; the link it prints carries the launch key, which the page sends itself, so the dev server is no way around the key. Only the page reloads: the camp server keeps running until you restart it, so an edit under `src/` doesn't cut off an expedition. The page Vite serves doesn't carry the built page's Content-Security-Policy; use `npm run ui:serve` when you want exactly what a build gives you.
- The feed is a pure function of the camp's events (`ui/src/feed/reducer.ts`): each event names its expedition and quest, and lands in that card. That's where to look first when the feed shows something wrong.
- The page's types come from the server's code (`ui/src/types.ts` imports `CampEvent`, the `/api/state` shape, and the rest as types), so `npm run typecheck` fails if the server and the page disagree.

## Projects

A project decides what the crew sees and remembers. **Projects** in the sidebar lists them; **New project** opens the dialog; a project's name opens its page.

- **Folders:** the linked folders a project is about (one or several). A conversation in the project can use those folders and no others, and only their `AGENTS.md` / `CLAUDE.md` are loaded. A conversation outside any project sees no linked folders unless you bring one in (`@links/<name>`, the + menu, or the "work in" picker, which starts every folder on "Don't use it" there); what you bring in stays for that conversation until you take it out again from the same picker. This keeps projects apart, and keeps one project's instructions from being paid for in another's conversations.
- **Description:** your own words about it. The whole crew reads it at the start of every conversation there.
- **Survey:** **Survey this project** has the Scout read through the folders and write a brief (stack, layout, commands), which the crew then starts from. Run it again when the project has moved on; you can edit it by hand.
- **What the crew has learned:** notes the crew keeps about the project with `project_remember`, loaded only in that project. They sit beside each agent's own memory, which stays for how they work in general. You can edit these too.
- **Pinned references:** files (as the crew sees them) shown in full in every conversation there, and web addresses listed for the Scout to fetch.
- **Defaults:** where to work (the linked checkout, or a new worktree and branch for each conversation), web access (on, confidential, or off), how shell commands are approved, whether changes are reviewed before the Quartermaster reports (always, never, or as the camp is set), a budget per expedition, and a model per crew member. "Confidential" is an instruction to the crew to keep the project's names and code out of searches; nothing checks what they search for. "Off" removes the web tools.
- **The page** also shows what the project has used (runs are tagged with their project from now on), the worktrees and branches its conversations worked in, files changed recently, its scheduled jobs (a job scheduled in a project runs with that project's folders and notes), and each folder's checks.
- **Weekly chronicle:** once a project has had work in a week, its page offers to **write it up**. The camp gathers that week from its own record (each conversation and how it ended, tickets, branches, pull requests as last seen, who worked, your ratings, the estimated cost) and the Scribe writes it up from that alone, ending with **In plain terms**: a few bullets you can copy straight into a status update. Each week's is kept in `camp/projects/<id>/chronicle/`, and written again only when you ask.
- **Is it paying off?** once a project has had more than plain work, its page counts the last 30 days from the record: the reviews you asked for (how many findings, how many must-fix, how often you sent them back), second opinions, failed checks sent back to be fixed, pull request feedback rounds, chronicles, each beside what it used; its pull requests (opened, merged, how long from the first message to the pull request); your ratings; and the share of the project's usage that went on checking rather than doing. It's there so you can turn down what rarely finds anything.
- **Filing:** pin a project to keep it at the top. A conversation in General that used one project's folder offers to move there.
- **Titles:** a conversation is named after the first line of its first request. Settings → General → "Name conversations automatically" has the smallest model write a short title instead (a little usage per conversation; off by default).

Projects live in `camp/conversations.json`; a project's survey and notes are in `camp/projects/<id>/`.

## Terminal commands

In `npm start`, type a request for the Quartermaster, or:

| Command | What it does |
|---|---|
| `@scout <task>` | Talk to one crew member directly (aliases work: `@writer`, `@dev`, `@research`) |
| `@path/to/file` | Attach a project file or folder anywhere in a message |
| `/link <path> [--edit]` · `/links` · `/unlink <name>` | Link a folder on your disk as `links/<name>/` (no upload), list links, remove one |
| `/reply <message>` | Follow up on the last expedition or chat, carrying the whole conversation over |
| `/project [name \| off]` | List your projects, or work in one: its folders, notes, and defaults apply to what you send |
| `/worktree [<link> new [branch] \| <link> <path or branch> \| <link> off]` | List a linked repo's worktrees; work in a new one per request, or in one you already have |
| `/good [note]` · `/bad [note]` | Rate the last answer; a note is kept as a standing note for future work |
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
- **The camp's own code is read-only** to agents (`src/`, `tests/`, `evals/`, `package.json`), so nothing they read can talk them into loosening these rules. To have the crew work on Satchel itself, set `"selfEdit": true` in `camp/settings.json`.
- **The Scout** reads the web, so it can only write to its own outputs folder.
- **Read-only git for everyone:** every crew member can run `git status`, `diff`, `log`, `show`, and `blame` (in the camp or `links/<name>`) to see what a change added instead of guessing from the code as it is now. It never asks, so it's narrow: no other subcommands, no flags that run programs or read outside the repository, and secret files are left out of every result, even ones committed by mistake.
- **Git's own data** (`.git/config`, hooks, a worktree's `.git` file) is never written by file tools, even in a folder linked with edit access.
- **Parallel quests** can't overwrite each other: a write to a file another quest just changed is refused until it has been read again.
- **Shell:** commands ask you first. "Always allow this command" on an approval stops the asking for that exact command (`"shell": {"exact": [...]}`). Commands run without blocking the camp, stop after 2 minutes, and stop when you press Stop. With `cwd: "links/<name>"` a command runs inside that linked folder (or the expedition's worktree of it), where read-only git commands don't ask either.
- **Sandboxed shell (macOS, off by default):** turn it on under Quests, or with `"shell": {"sandbox": true}`. Commands then run without asking, with no network (localhost still works), writes only inside the project they run in and temp folders, and no access to your keys or `.env` files. Git hooks and git config can't be written. A command that needs more, like an install or a push, is asked for the usual way. The sandbox doesn't protect the project folder itself: a command can still change or delete files there, so use a worktree for work you want kept apart. Only simple read-only commands (`ls`, `git status`, `git diff`, version checks) run without asking. Test runners aren't on that list by default, because the Artificer can edit the code they run. Add your own in `camp/settings.json` under `"shell": {"allow": ["npm test"]}`.
- **Imported skills:** a `.skill` archive is unpacked in memory by the camp's own code, never by an unzip program, so it can't plant a link or a path that climbs out of its folder; hidden files are left out, and the size limits hold while it's being unpacked. Nothing in it runs on import. Its files land in `skills/`, which no crew member's file tools can change. A command you pre-approve for a skill still has to pass the same test as every auto-approved command (one simple command, inside the camp, nowhere near a secret); a bare interpreter or the likes of `rm`, `sudo`, or `git push` is refused as a prefix; and a pre-approved script that has changed since you approved it asks again. Editing a skill in the page writes only inside that skill's own folder (no `..`, no hidden files, no following a link), and it's still only you who can: the crew's file tools can't write under `skills/`.
- **Jira and pull requests are yours to write to:** the crew can read Jira and nothing more. The only writes are the camp's two fixed comments (and a status change you named), and only with write-back turned on. Opening or updating a pull request happens from your own button, and review comments are brought to you as text to read, labelled as someone else's words, never acted on by themselves.
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
| `camp/feedback.jsonl` | Your ratings and notes on finished work |
| `camp/crew.json` | Crew members you added: who they are, how they work, and what they can do |
| `camp/conversations.json` · `camp/projects/<id>/` | Your projects (folders, description, pinned references, defaults) and the titles and filing you've changed; each project's survey and the crew's notes about it |
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

**From mission control:** the **+** at the end of the crew bar opens a dialog for a new crew member: an icon, a name, a handle (what you type after `@`), a colour, one line on what they're for, and how they work. Then tick what they can do:

- search the web and fetch pages;
- write files (not at all, only in their own outputs folder, or in projects too);
- run shell commands (they ask you first, like the Artificer);
- save findings to the camp wiki's notes.

Everyone can read and search files and keeps their own memory. The Quartermaster can send a new crew member straight away, and you can message them with `@handle`. Their model, effort, and turn limit are set from their card, like anyone's. The pencil on their card edits or removes them; removing leaves their memory and files in `camp/agents/<handle>/`. The dialog warns when a crew member both reads the web and can change things, since a page they read could try to talk them into a change you didn't ask for.

Crew members you add live in `camp/crew.json` (up to 12). The terminal camp and the watcher pick them up when they start.

**In code:** the four the camp starts with are defined in `src/crew.ts` (who they are) and `src/roster.ts` (their tools and default model), with skills in `skills/<id>/`. They can't be changed or removed from the page.
