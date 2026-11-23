// The camp: talk to the Quartermaster, or straight to one adventurer.
// Run: npm run cli          (scheduled jobs run in mission control, or with nothing open after npm run watch:install)

import { rl } from "./tools.js";
import { onInterrupt } from "./terminal.js";
import { CREW, CREW_IDS, findCrew } from "./crew.js";
import { readMemory, recentSessions } from "./memory.js";
import { buildRequest } from "./attachments.js";
import { addLink, loadLinks, removeLink } from "./links.js";
import { listModels, resolveModel, resolveTurns } from "./agent.js";
import { isAutoChoice } from "./routing.js";
import { agentSettings, setAgentSettings, budgetUsd, setBudgetUsd, campRuntime, setRuntime, TURNS_MIN, TURNS_MAX, type Effort } from "./settings.js";
import { claudeLogin } from "./claude-code.js";
import { ROSTER } from "./roster.js";
import { QM_DEFAULTS } from "./quartermaster.js";
import type { CrewId } from "./crew.js";
import { runExpedition, runDirect } from "./quartermaster.js";
import { pendingSkills, reviewPending } from "./forge.js";
import { formatQuests } from "./questlog.js";
import { describeJobs } from "./jobs.js";
import { wikiIndex } from "./wiki.js";
import { attachConsole } from "./events.js";
import { randomUUID } from "node:crypto";
import { threadFor } from "./threads.js";
import { linkedRepos, prepareWorkspaces, type WorkspaceChoice } from "./repos.js";
import { history, fileConversation, getProject } from "./conversations.js";
import { giveFeedback } from "./feedback.js";
import { checkpointDiff, undoCheckpoint } from "./checkpoints.js";
import { pausedUntil, pauseMessage } from "./limits.js";

// The last expedition or direct chat in this terminal, for /reply, /diff, and /undo.
let lastId: string | undefined;
// The project the next requests are filed under (/project): its folders, notes, and defaults apply.
let inProject: string | undefined;
// Where the next requests work in each linked repo (/worktree): a new worktree, or one you named.
const workIn: Record<string, WorkspaceChoice> = {};

attachConsole();

const HELP = `Commands:
  <request>          Send the Quartermaster on an expedition (you approve the plan first)
  @${CREW_IDS.join(" / @")} <task>
                     Talk to one crew member directly (aliases work too: @writer, @dev, @research)
  @path/to/file      Attach a project file or folder anywhere in a message (images and PDFs are shown)
  /link <path> [--edit]
                     Let the crew read a folder on your disk as links/<name>/ (no upload); /links, /unlink <name>
  /reply <message>   Follow up on the last expedition or chat, with that whole conversation carried over
  /diff · /undo      What the last expedition's file tools changed; put those files back
  /good [note] · /bad [note]
                     Rate the last answer. A note is kept as a standing note, so the next runs start with it
  /project [name | off]
                     List your projects, or work in one: its folders, notes, and defaults apply to what you send
  /worktree [<link> new [branch] | <link> <path> | <link> off]
                     Work in a git worktree of a linked repo: a new one per request, or one you already have
  /memory <name>     What that crew member remembers, and how many sessions they've had
  /runtime [claude-code | api]
                     Show or switch what runs the crew: your Claude subscription (default) or the API
  /budget [dollars | off]
                     Stop each expedition once it has spent this much (all agents together)
  /model [name model [effort] | name reset]
                     Show or change which model each crew member runs on
  /turns <name> <number | reset>
                     How many turns one run of that crew member may take before it stops
  /review            Approve or reject skills the Quartermaster proposed
  /log               Recent quests: who went, how it ended, time, tokens, and cost
  /jobs              Scheduled jobs (they run while mission control is open; npm run watch:install for always)
  /wiki              The camp wiki's index (pages live in camp/wiki/)
  /help              This list
  exit               Break camp`;

// /model                         list each crew member's model and effort
// /model <name> <model> [effort] change one (applies from their next run)
// /model <name> reset            back to the default in code
async function modelCommand(name?: string, model?: string, effort?: string) {
  const defaults = (id: CrewId) => (id === "quartermaster" ? QM_DEFAULTS : ROSTER[id]);
  if (!name) {
    for (const id of CREW_IDS) {
      const r = resolveModel({ id, ...defaults(id) });
      const o = agentSettings(id);
      const custom = o.model || o.effort || o.maxTurns ? "  (custom)" : "";
      console.log(`${CREW[id].emoji} ${CREW[id].name.padEnd(14)} ${r.model} · ${r.effort ?? "default"} · ${resolveTurns({ id, ...defaults(id) })} turns${custom}`);
    }
    return;
  }
  const who = findCrew(name);
  if (!who) return console.log(`No crew member named "${name}".`);
  if (model === "reset") {
    setAgentSettings(who.id, { model: null, effort: null, maxTurns: null });
    return console.log(`${who.emoji} ${who.name} is back on the default model and turn limit.`);
  }
  // Auto ("auto", or "auto:economy" / "auto:balanced" / "auto:quality") picks the model and effort for each task.
  if (isAutoChoice(model)) {
    const choice = model === "auto" ? "auto:balanced" : model;
    setAgentSettings(who.id, { model: choice, effort: null });
    return console.log(`${who.emoji} ${who.name} now runs on ${choice}: a model and effort chosen for each task, from their next run.`);
  }
  const { models } = await listModels();
  const m = models.find((x) => x.id === model);
  if (!m) return console.log(`Pick auto, auto:economy, auto:balanced, auto:quality, or one of: ${models.map((x) => x.id).join(", ")}`);
  if (effort && !m.efforts.includes(effort as Effort)) return console.log(`${m.name} supports effort: ${m.efforts.join(", ") || "none"}`);
  setAgentSettings(who.id, { model: m.id, effort: (effort as Effort) ?? null });
  console.log(`${who.emoji} ${who.name} now runs on ${m.id}${effort ? ` · ${effort}` : ""}, from their next run.`);
}

// /budget            show the per-expedition budget
// /budget 2.50       stop each expedition once it has spent $2.50 (all agents together)
// /budget off        no budget
function budgetCommand(arg?: string) {
  if (arg === "off") setBudgetUsd(null);
  else if (arg) {
    const v = Number(arg.replace(/^\$/, ""));
    if (!Number.isFinite(v) || v <= 0) return console.log("Usage: /budget 2.50 (dollars per expedition), or /budget off");
    setBudgetUsd(v);
  }
  const b = budgetUsd();
  console.log(b ? `💰 Each expedition stops once it has spent $${b.toFixed(2)} (all agents together).` : "💰 No per-expedition budget. Set one with /budget 2.50");
}

// What runs the crew right now, and whether it's ready.
async function describeRuntime(force = false) {
  if (campRuntime() === "api") return console.log("   Crew runs on: the API (ANTHROPIC_API_KEY). Switch with /runtime claude-code");
  const login = await claudeLogin(force);
  console.log(login.ok
    ? `   Crew runs on: your Claude ${login.plan ? login.plan[0].toUpperCase() + login.plan.slice(1) + " " : ""}subscription, through Claude Code. Switch with /runtime api`
    : `   ⚠️  ${login.problem}`);
}

function announcePending() {
  const n = pendingSkills().length;
  if (n) console.log(`\n📥 ${n} skill proposal${n === 1 ? "" : "s"} waiting. Type /review to look.`);
}

async function handle(input: string) {
  const cmd = input.trim();
  if (cmd === "/help") return console.log(`\n${HELP}`);
  if (cmd === "/review") return reviewPending(rl);
  if (cmd === "/log") return console.log(`\n📒 Quest log\n${formatQuests()}`);
  if (cmd === "/jobs") return console.log(`\n⏰ ${describeJobs()}`);
  if (cmd === "/wiki") return console.log(`\n${wikiIndex()}`);
  // /runtime [claude-code | api]
  const rt = cmd.match(/^\/runtime(?:\s+(claude-code|api|subscription))?$/);
  if (rt) {
    if (rt[1]) {
      if (process.env.CAMP_RUNTIME) return console.log(`CAMP_RUNTIME=${process.env.CAMP_RUNTIME} is set for this session; change it there.`);
      setRuntime(rt[1] === "api" ? "api" : "claude-code");
    }
    return describeRuntime(true);
  }
  // /link /path/to/folder [--edit]   /links   /unlink <name>
  const link = cmd.match(/^\/link\s+(.+?)(\s+--edit)?$/);
  if (link) {
    try {
      const l = addLink(link[1], link[2] ? "write" : "read");
      return console.log(`📁 Linked ${l.path} as links/${l.name}/ (${l.files} files, ${l.access === "write" ? "can edit" : "read-only"}). Mention @links/${l.name} in a message to attach it.`);
    } catch (e: any) {
      return console.log(`Couldn't link it: ${e.message}`);
    }
  }
  if (cmd === "/links") {
    const links = loadLinks();
    return console.log(links.length ? links.map((l) => `📁 links/${l.name}/  ${l.path}  (${l.files ?? "?"} files, ${l.access === "write" ? "can edit" : "read-only"})`).join("\n") : "No linked folders. Add one with /link /path/to/folder");
  }
  const unlink = cmd.match(/^\/unlink\s+(\S+)$/);
  if (unlink) return console.log(removeLink(unlink[1]) ? `Unlinked links/${unlink[1]} (the folder itself is untouched).` : `No linked folder named "${unlink[1]}".`);
  const budget = cmd.match(/^\/budget(?:\s+(\S+))?$/);
  if (budget) return budgetCommand(budget[1]);
  // /turns <name> <number | reset>
  const turns = cmd.match(/^\/turns\s+(\S+)\s+(\S+)$/);
  if (turns) {
    const who = findCrew(turns[1]);
    if (!who) return console.log(`No crew member named "${turns[1]}".`);
    const defaults = who.id === "quartermaster" ? QM_DEFAULTS : ROSTER[who.id];
    if (turns[2] === "reset") setAgentSettings(who.id, { maxTurns: null });
    else {
      const n = Number(turns[2]);
      if (!Number.isInteger(n) || n < TURNS_MIN || n > TURNS_MAX) return console.log(`Usage: /turns ${turns[1]} <${TURNS_MIN}–${TURNS_MAX}>, or /turns ${turns[1]} reset`);
      setAgentSettings(who.id, { maxTurns: n });
    }
    return console.log(`${who.emoji} ${who.name} gets ${resolveTurns({ id: who.id, maxTurns: defaults?.maxTurns })} turns per run, from their next run.`);
  }
  const modelCmd = cmd.match(/^\/model(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?$/);
  if (modelCmd) return modelCommand(modelCmd[1], modelCmd[2], modelCmd[3]);
  const mem = cmd.match(/^\/memory\s+(\S+)/);
  if (mem) {
    const who = findCrew(mem[1]);
    if (!who) return console.log(`\nNo crew member named "${mem[1]}".`);
    const n = recentSessions(who.id, 100_000).length;
    return console.log(`\n${CREW[who.id].emoji} ${who.name}: ${n} session${n === 1 ? "" : "s"}\n${readMemory(who.id)}`);
  }

  // /project            list them        /project <name>   work in it        /project off   back to no project
  const proj = cmd.match(/^\/projects?(?:\s+(.+))?$/);
  if (proj) {
    const { projects, conversations } = history();
    if (proj[1]?.trim().toLowerCase() === "off") inProject = undefined;
    else if (proj[1]) {
      const want = proj[1].trim().toLowerCase();
      const hit = projects.find((p) => p.name.toLowerCase() === want) ?? projects.find((p) => p.name.toLowerCase().startsWith(want));
      if (!hit) return console.log(`No project named "${proj[1].trim()}". Type /project to list them.`);
      inProject = hit.id === "general" ? undefined : hit.id;
    }
    for (const p of projects) {
      const n = conversations.filter((c) => c.project === p.id).length;
      const here = (inProject ?? "general") === p.id ? "→" : " ";
      console.log(`${here} ${p.name.padEnd(24)} ${String(n).padStart(3)} conversation${n === 1 ? " " : "s"}${p.links?.length ? `  📁 ${p.links.map((l) => `links/${l}`).join(", ")}` : ""}`);
    }
    return console.log(inProject ? `Requests are filed under ${getProject(inProject)?.name}: the crew sees its folders, notes, and description. /project off to stop.` : "Requests aren't filed under a project: the crew sees every linked folder. /project <name> to work in one.");
  }
  const wt = cmd.match(/^\/worktree(?:\s+(\S+)(?:\s+(\S+)(?:\s+(\S+))?)?)?$/);
  if (wt) {
    const repos = await linkedRepos();
    if (wt[1] && wt[2]) {
      const repo = repos.find((r) => r.link === wt[1]);
      if (!repo) return console.log(`links/${wt[1]} isn't a linked git repository. Linked repos: ${repos.map((r) => r.link).join(", ") || "none"}.`);
      if (wt[2] === "off") delete workIn[wt[1]];
      else if (wt[2] === "new") workIn[wt[1]] = { mode: "new", branch: wt[3] };
      else {
        const hit = repo.worktrees.find((w) => w.path === wt[2] || w.branch === wt[2] || w.path.endsWith("/" + wt[2]));
        if (!hit) return console.log(`No worktree of ${wt[1]} matches "${wt[2]}". Type /worktree to list them.`);
        workIn[wt[1]] = { mode: "existing", path: hit.path };
      }
    }
    if (!repos.length) return console.log("No linked git repositories. Link one with /link <path> --edit");
    for (const r of repos) {
      const c = workIn[r.link];
      console.log(`📁 links/${r.link}  (linked checkout on ${r.branch})  →  ${!c ? "working in the linked checkout" : c.mode === "new" ? `a new worktree for each request${c.branch ? ` (branch ${c.branch})` : ""}` : `worktree ${c.path}`}`);
      for (const w of r.worktrees) console.log(`     ${w.branch.padEnd(44)} ${w.path}`);
    }
    return;
  }
  // /good [note]   /bad [note]: rate the last answer; a note becomes a standing note.
  const rate = cmd.match(/^\/(good|bad)(?:\s+([\s\S]+))?$/);
  if (rate) {
    if (!lastId) return console.log("Nothing has run in this session yet.");
    try {
      const f = giveFeedback(lastId, { rating: rate[1] === "good" ? "up" : "down", note: rate[2], keep: true });
      return console.log(`${f.rating === "up" ? "👍" : "👎"} Noted.${f.kept ? ` Your note was added to ${f.kept}.` : " Add a note (/bad be briefer) and it's kept for next time."}`);
    } catch (e: any) {
      return console.log(e.message);
    }
  }
  if (cmd === "/diff" || cmd === "/undo") {
    if (!lastId) return console.log("Nothing has run in this session yet.");
    if (cmd === "/diff") {
      const d = checkpointDiff(lastId);
      return console.log(d.files.length ? `\n${d.files.map((f) => `${f.change.padEnd(9)} ${f.path}`).join("\n")}\n\n${d.diff}` : "The last expedition's file tools didn't change any files.");
    }
    const r = undoCheckpoint(lastId);
    return console.log(r.restored.length ? `↩️  Put back: ${r.restored.join(", ")}${r.skipped.length ? `\n   Couldn't restore (too large to keep a copy): ${r.skipped.join(", ")}` : ""}` : "Nothing to undo.");
  }
  const paused = pausedUntil();
  if (paused && campRuntime() === "claude-code") console.log(`⏸  ${pauseMessage(paused)} (Trying anyway.)`);

  // /reply <message>: continue the last conversation, with whoever it was with.
  let replyTo: string | undefined;
  let text = cmd;
  const reply = cmd.match(/^\/reply\s+([\s\S]+)$/);
  if (reply) {
    const thread = threadFor(lastId);
    if (!thread) return console.log("There's nothing to reply to yet in this session.");
    replyTo = lastId;
    text = thread.direct && !/^@\w+\s/.test(reply[1]) ? `@${thread.agent} ${reply[1]}` : reply[1];
  }

  // @path/to/file anywhere in the message attaches that file (images and PDFs are shown to the agent).
  const direct = text.match(/^@(\w+)\s+([\s\S]+)$/);
  if (direct && findCrew(direct[1])) {
    const { content, attached } = buildRequest(direct[2]);
    if (attached.length) console.log(`📎 Attached: ${attached.map((a) => a.path ?? a.url).join(", ")}`);
    const id = (lastId = randomUUID());
    const workspaces = await chosenWorkspaces(direct[2], id, replyTo);
    if (workspaces === null) return;
    if (inProject && !replyTo) fileConversation(id, inProject);
    await stoppable((signal) => runDirect(direct[1].toLowerCase(), content, "direct", attached, signal, id, replyTo, { workspaces, ...(inProject ? { project: inProject } : {}) }));
    return announcePending();
  }
  if (direct && !/[./]/.test(direct[1])) {
    console.log(`\nNo crew member named "${direct[1]}". Try @${CREW_IDS.join(", @")}.`);
    return;
  }

  // Each agent carries its own memory and session history; the wiki and skills are shared.
  const { content, attached } = buildRequest(text);
  if (attached.length) console.log(`📎 Attached: ${attached.map((a) => a.path ?? a.url).join(", ")}`);
  const id = (lastId = randomUUID());
  const workspaces = await chosenWorkspaces(text, id, replyTo);
  if (workspaces === null) return;
  if (inProject && !replyTo) fileConversation(id, inProject);
  await stoppable((signal) => runExpedition(content, { attached, signal, id, replyTo, workspaces, ...(inProject ? { project: inProject } : {}) }));
  announcePending();
}

// The worktrees this request works in (from /worktree). A reply stays where its conversation was.
// null: a worktree couldn't be set up, and the reason was printed.
async function chosenWorkspaces(task: string, id: string, replyTo?: string) {
  if (replyTo || !Object.keys(workIn).length) return undefined;
  try {
    const ws = await prepareWorkspaces(workIn, task, id);
    for (const w of Object.values(ws)) console.log(`🌿 links/${w.link}: ${w.created ? "new worktree" : "worktree"} ${w.path} (branch ${w.branch})`);
    return ws;
  } catch (e: any) {
    console.log(`Couldn't set up the worktree: ${e.message}`);
    return null;
  }
}

// Run something that the first Ctrl+C stops (instead of quitting the camp).
async function stoppable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  onInterrupt(() => {
    controller.abort();
    return true;
  });
  try {
    return await run(controller.signal);
  } finally {
    onInterrupt(null);
  }
}

async function main() {
  console.log("🏕️  The camp is set. Type a request for the Quartermaster, or /help.");
  await describeRuntime();
  announcePending();
  const firstTask = process.argv.slice(2).join(" ");
  let task = firstTask || (await rl.question("\n🧭 What's the expedition? "));

  while (task.trim() && task.trim() !== "exit") {
    await handle(task);
    task = await rl.question("\n🧭 Next expedition? (/help, or 'exit') ");
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
