// The camp: talk to the Quartermaster, or straight to one adventurer.
// Run: npm run cli          (scheduled jobs run in mission control, or with nothing open after npm run watch:install)

import { rl } from "./tools.js";
import { onInterrupt } from "./terminal.js";
import { CREW, CREW_IDS, activePack, findCrew } from "./crew.js";
import { say, w } from "./words.js";
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
import { dispatch, helpText, type Handlers } from "./commands.js";

// The last expedition or direct chat in this terminal, for /reply, /diff, and /undo.
let lastId: string | undefined;
// The project the next requests are filed under (/project): its folders, notes, and defaults apply.
let inProject: string | undefined;
// Where the next requests work in each linked repo (/worktree): a new worktree, or one you named.
const workIn: Record<string, WorkspaceChoice> = {};
// Set by exit (or /exit, /quit): the prompt loop ends.
let exiting = false;

attachConsole(() => ({ lead: CREW.quartermaster.name, back: w("back"), say }));

// What to type after @ for each crew member: their name now, as one word (@testpilot, @navigator),
// or their id where that wouldn't find them.
const handles = () => CREW_IDS.map((id) => {
  const h = CREW[id].name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return h && findCrew(h)?.id === id ? h : id;
});
// The mark on the terminal's own lines: the Guild's tent, or whoever leads under another pack.
const sign = () => (activePack().id === "guild" ? "🏕️" : CREW.quartermaster.emoji);

// In the active pack's words (words.ts), so it's written when it's asked for, never at import.
// What isn't a /command comes first; the commands are the registry's (commands.ts), grouped.
const help = () => say(`Commands:
  <request>          Send the Quartermaster on {an expedition} (you approve the plan first)
  @${handles().join(" / @")} <task>
                     Talk to one {crew} member directly (aliases work too: @writer, @dev, @research)
  @path/to/file      Attach a project file or folder anywhere in a message (images and PDFs are shown)

`) + helpText("cli", say);

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
  if (!who) return console.log(`No ${w("crew")} member named "${name}".`);
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
    if (!Number.isFinite(v) || v <= 0) return console.log(`Usage: /budget 2.50 (dollars per ${w("expedition")}), or /budget off`);
    setBudgetUsd(v);
  }
  const b = budgetUsd();
  console.log(b ? `💰 Each ${w("expedition")} stops once it has spent $${b.toFixed(2)} (all agents together).` : `💰 No budget per ${w("expedition")}. Set one with /budget 2.50`);
}

// What runs the crew right now, and whether it's ready.
async function describeRuntime(force = false) {
  if (campRuntime() === "api") return console.log(`   ${w("Crew")} runs on: the API (ANTHROPIC_API_KEY). Switch with /runtime claude-code`);
  const login = await claudeLogin(force);
  console.log(login.ok
    ? `   ${w("Crew")} runs on: your Claude ${login.plan ? login.plan[0].toUpperCase() + login.plan.slice(1) + " " : ""}subscription, through Claude Code. Switch with /runtime api`
    : `   ⚠️  ${login.problem}`);
}

function announcePending() {
  const n = pendingSkills().length;
  if (n) console.log(`\n📥 ${n} skill proposal${n === 1 ? "" : "s"} waiting. Type /review to look.`);
}

// What each /command does in the terminal. The registry (commands.ts) says which these are, what
// they take and what /help says of them; the type makes sure none of them is left without one.
// A required argument that's missing is answered with its usage line before these run.
const CLI: Handlers<"cli"> = {
  help: () => console.log(`\n${help()}`),
  exit: () => { exiting = true; },
  review: () => reviewPending(rl),
  log: () => console.log(`\n📒 ${w("Log")}\n${formatQuests()}`),
  jobs: () => console.log(`\n⏰ ${describeJobs()}`),
  wiki: () => console.log(`\n${wikiIndex()}`),
  // /runtime [claude-code | api]
  runtime: (arg) => {
    if (arg) {
      if (!["claude-code", "api", "subscription"].includes(arg)) return console.log("Usage: /runtime [claude-code | api]");
      if (process.env.CAMP_RUNTIME) return console.log(`CAMP_RUNTIME=${process.env.CAMP_RUNTIME} is set for this session; change it there.`);
      setRuntime(arg === "api" ? "api" : "claude-code");
    }
    return describeRuntime(true);
  },
  // /link /path/to/folder [--edit]
  link: (arg) => {
    const edit = /\s+--edit$/.test(arg);
    try {
      const l = addLink(arg.replace(/\s+--edit$/, ""), edit ? "write" : "read");
      console.log(`📁 Linked ${l.path} as links/${l.name}/ (${l.files} files, ${l.access === "write" ? "can edit" : "read-only"}). Mention @links/${l.name} in a message to attach it.`);
    } catch (e: any) {
      console.log(`Couldn't link it: ${e.message}`);
    }
  },
  links: () => {
    const links = loadLinks();
    console.log(links.length ? links.map((l) => `📁 links/${l.name}/  ${l.path}  (${l.files ?? "?"} files, ${l.access === "write" ? "can edit" : "read-only"})`).join("\n") : "No linked folders. Add one with /link /path/to/folder");
  },
  unlink: (arg) => {
    const name = arg.split(/\s+/)[0];
    console.log(removeLink(name) ? `Unlinked links/${name} (the folder itself is untouched).` : `No linked folder named "${name}".`);
  },
  budget: (arg) => budgetCommand(arg.split(/\s+/)[0] || undefined),
  // /turns <name> <number | reset>
  turns: (arg) => {
    const [name, value] = arg.split(/\s+/);
    if (!value) return console.log(`Usage: /turns ${name} <${TURNS_MIN}–${TURNS_MAX} | reset>`);
    const who = findCrew(name);
    if (!who) return console.log(`No ${w("crew")} member named "${name}".`);
    const defaults = who.id === "quartermaster" ? QM_DEFAULTS : ROSTER[who.id];
    if (value === "reset") setAgentSettings(who.id, { maxTurns: null });
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < TURNS_MIN || n > TURNS_MAX) return console.log(`Usage: /turns ${name} <${TURNS_MIN}–${TURNS_MAX}>, or /turns ${name} reset`);
      setAgentSettings(who.id, { maxTurns: n });
    }
    console.log(`${who.emoji} ${who.name} gets ${resolveTurns({ id: who.id, maxTurns: defaults?.maxTurns })} turns per run, from their next run.`);
  },
  model: (arg) => { const [name, model, effort] = arg ? arg.split(/\s+/) : []; return modelCommand(name, model, effort); },
  memory: (arg) => {
    const name = arg.split(/\s+/)[0];
    const who = findCrew(name);
    if (!who) return console.log(`\nNo ${w("crew")} member named "${name}".`);
    const n = recentSessions(who.id, 100_000).length;
    console.log(`\n${CREW[who.id].emoji} ${who.name}: ${n} session${n === 1 ? "" : "s"}\n${readMemory(who.id)}`);
  },
  // /project            list them        /project <name>   work in it        /project off   back to no project
  project: (arg) => {
    const { projects, conversations } = history();
    if (arg.toLowerCase() === "off") inProject = undefined;
    else if (arg) {
      const want = arg.toLowerCase();
      const hit = projects.find((p) => p.name.toLowerCase() === want) ?? projects.find((p) => p.name.toLowerCase().startsWith(want));
      if (!hit) return console.log(`No project named "${arg}". Type /project to list them.`);
      inProject = hit.id === "general" ? undefined : hit.id;
    }
    for (const p of projects) {
      const n = conversations.filter((c) => c.project === p.id).length;
      const here = (inProject ?? "general") === p.id ? "→" : " ";
      console.log(`${here} ${p.name.padEnd(24)} ${String(n).padStart(3)} conversation${n === 1 ? " " : "s"}${p.links?.length ? `  📁 ${p.links.map((l) => `links/${l}`).join(", ")}` : ""}`);
    }
    console.log(inProject ? `Requests are filed under ${getProject(inProject)?.name}: the ${w("crew")} sees its folders, notes, and description. /project off to stop.` : `Requests aren't filed under a project: the ${w("crew")} sees every linked folder. /project <name> to work in one.`);
  },
  worktree: async (arg) => {
    const [link, how, branch] = arg ? arg.split(/\s+/) : [];
    const repos = await linkedRepos();
    if (link && how) {
      const repo = repos.find((r) => r.link === link);
      if (!repo) return console.log(`links/${link} isn't a linked git repository. Linked repos: ${repos.map((r) => r.link).join(", ") || "none"}.`);
      if (how === "off") delete workIn[link];
      else if (how === "new") workIn[link] = { mode: "new", branch };
      else {
        const hit = repo.worktrees.find((w) => w.path === how || w.branch === how || w.path.endsWith("/" + how));
        if (!hit) return console.log(`No worktree of ${link} matches "${how}". Type /worktree to list them.`);
        workIn[link] = { mode: "existing", path: hit.path };
      }
    }
    if (!repos.length) return console.log("No linked git repositories. Link one with /link <path> --edit");
    for (const r of repos) {
      const c = workIn[r.link];
      console.log(`📁 links/${r.link}  (linked checkout on ${r.branch})  →  ${!c ? "working in the linked checkout" : c.mode === "new" ? `a new worktree for each request${c.branch ? ` (branch ${c.branch})` : ""}` : `worktree ${c.path}`}`);
      for (const w of r.worktrees) console.log(`     ${w.branch.padEnd(44)} ${w.path}`);
    }
  },
  // /good [note]   /bad [note]: rate the last answer; a note becomes a standing note.
  good: (arg) => rate("up", arg),
  bad: (arg) => rate("down", arg),
  diff: () => {
    if (!lastId) return console.log("Nothing has run in this session yet.");
    const d = checkpointDiff(lastId);
    console.log(d.files.length ? `\n${d.files.map((f) => `${f.change.padEnd(9)} ${f.path}`).join("\n")}\n\n${d.diff}` : `The last ${w("expedition")}'s file tools didn't change any files.`);
  },
  undo: () => {
    if (!lastId) return console.log("Nothing has run in this session yet.");
    const r = undoCheckpoint(lastId);
    console.log(r.restored.length ? `↩️  Put back: ${r.restored.join(", ")}${r.skipped.length ? `\n   Couldn't restore (too large to keep a copy): ${r.skipped.join(", ")}` : ""}` : "Nothing to undo.");
  },
  // /reply <message>: continue the last conversation, with whoever it was with.
  reply: (arg) => {
    const thread = threadFor(lastId);
    if (!thread) return console.log("There's nothing to reply to yet in this session.");
    return send(thread.direct && !/^@\w+\s/.test(arg) ? `@${thread.agent} ${arg}` : arg, lastId);
  },
};

function rate(rating: "up" | "down", note: string) {
  if (!lastId) return console.log("Nothing has run in this session yet.");
  try {
    const f = giveFeedback(lastId, { rating, note: note || undefined, keep: true });
    console.log(`${f.rating === "up" ? "👍" : "👎"} Noted.${f.kept ? ` Your note was added to ${f.kept}.` : " Add a note (/bad be briefer) and it's kept for next time."}`);
  } catch (e: any) {
    console.log(e.message);
  }
}

// A line typed at the prompt: a /command (the registry's), else a request.
async function handle(input: string) {
  const cmd = input.trim();
  const done = await dispatch(cmd, "cli", CLI, { fill: say });
  if (done.ran === "refused") return console.log(done.message);
  if (done.ran === "none") return send(cmd);
}

// A request: to one crew member (@name …), else the Quartermaster. replyTo continues that conversation.
async function send(text: string, replyTo?: string) {
  const paused = pausedUntil();
  if (paused && campRuntime() === "claude-code") console.log(`⏸  ${pauseMessage(paused)} (Trying anyway.)`);

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
    console.log(`\nNo ${w("crew")} member named "${direct[1]}". Try @${handles().join(", @")}.`);
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
  console.log(`${sign()}  ${w("ready")}. Type a request for the ${CREW.quartermaster.name}, or /help.`);
  await describeRuntime();
  announcePending();
  const firstTask = process.argv.slice(2).join(" ");
  let task = firstTask || (await rl.question(`\n${CREW.quartermaster.emoji} What's the ${w("expedition")}? `));

  while (task.trim() && task.trim() !== "exit" && task.trim() !== "quit") {
    await handle(task);
    if (exiting) break;
    task = await rl.question(`\n${CREW.quartermaster.emoji} Next ${w("expedition")}? (/help, or 'exit') `);
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
