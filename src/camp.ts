// The camp: talk to the Quartermaster, or straight to one adventurer.
// Run: npm start            (scheduled jobs run separately: npm run watch)

import { rl } from "./tools.js";
import { onInterrupt } from "./terminal.js";
import { CREW, CREW_IDS, findCrew } from "./crew.js";
import { readMemory, recentSessions } from "./memory.js";
import { buildRequest } from "./attachments.js";
import { listModels, resolveModel } from "./agent.js";
import { agentSettings, setAgentSettings, budgetUsd, setBudgetUsd, type Effort } from "./settings.js";
import { ROSTER } from "./roster.js";
import { QM_DEFAULTS } from "./quartermaster.js";
import type { CrewId } from "./crew.js";
import { runExpedition, runDirect } from "./quartermaster.js";
import { pendingSkills, reviewPending } from "./forge.js";
import { formatQuests } from "./questlog.js";
import { describeJobs } from "./jobs.js";
import { wikiIndex } from "./wiki.js";
import { attachConsole } from "./events.js";

attachConsole();

const HELP = `Commands:
  <request>          Send the Quartermaster on an expedition (you approve the plan first)
  @${CREW_IDS.join(" / @")} <task>
                     Talk to one crew member directly (aliases work too: @writer, @dev, @research)
  @path/to/file      Attach a project file or folder anywhere in a message (images and PDFs are shown)
  /memory <name>     What that crew member remembers, and how many sessions they've had
  /budget [dollars | off]
                     Stop each expedition once it has spent this much (all agents together)
  /model [name model [effort] | name reset]
                     Show or change which model each crew member runs on
  /review            Approve or reject skills the Quartermaster proposed
  /log               Recent quests: who went, how it ended, time, tokens, and cost
  /jobs              Scheduled jobs (they run while \`npm run watch\` is going)
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
      const custom = agentSettings(id).model || agentSettings(id).effort ? "  (custom)" : "";
      console.log(`${CREW[id].emoji} ${CREW[id].name.padEnd(14)} ${r.model} · ${r.effort ?? "default"}${custom}`);
    }
    return;
  }
  const who = findCrew(name);
  if (!who) return console.log(`No crew member named "${name}".`);
  if (model === "reset") {
    setAgentSettings(who.id, { model: null, effort: null });
    return console.log(`${who.emoji} ${who.name} is back on the default model.`);
  }
  const { models } = await listModels();
  const m = models.find((x) => x.id === model);
  if (!m) return console.log(`Pick one of: ${models.map((x) => x.id).join(", ")}`);
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
  const budget = cmd.match(/^\/budget(?:\s+(\S+))?$/);
  if (budget) return budgetCommand(budget[1]);
  const modelCmd = cmd.match(/^\/model(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+(\S+))?$/);
  if (modelCmd) return modelCommand(modelCmd[1], modelCmd[2], modelCmd[3]);
  const mem = cmd.match(/^\/memory\s+(\S+)/);
  if (mem) {
    const who = findCrew(mem[1]);
    if (!who) return console.log(`\nNo crew member named "${mem[1]}".`);
    const n = recentSessions(who.id, 100_000).length;
    return console.log(`\n${CREW[who.id].emoji} ${who.name}: ${n} session${n === 1 ? "" : "s"}\n${readMemory(who.id)}`);
  }

  // @path/to/file anywhere in the message attaches that file (images and PDFs are shown to the agent).
  const direct = cmd.match(/^@(\w+)\s+([\s\S]+)$/);
  if (direct && findCrew(direct[1])) {
    const { content, attached } = buildRequest(direct[2]);
    if (attached.length) console.log(`📎 Attached: ${attached.map((a) => a.path ?? a.url).join(", ")}`);
    await stoppable((signal) => runDirect(direct[1].toLowerCase(), content, "direct", attached, signal));
    return announcePending();
  }
  if (direct && !/[./]/.test(direct[1])) {
    console.log(`\nNo crew member named "${direct[1]}". Try @${CREW_IDS.join(", @")}.`);
    return;
  }

  // Each agent carries its own memory and session history; the wiki and skills are shared.
  const { content, attached } = buildRequest(cmd);
  if (attached.length) console.log(`📎 Attached: ${attached.map((a) => a.path ?? a.url).join(", ")}`);
  await stoppable((signal) => runExpedition(content, { attached, signal }));
  announcePending();
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
