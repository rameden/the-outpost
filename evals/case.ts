// Runs ONE eval case in a throwaway camp and prints its result as JSON (the runner calls this
// in a fresh process per case, because the camp folder is fixed when the camp's code loads).

import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { enterSandbox, REPO } from "../tests/helpers/sandbox.ts";

const id = process.argv[2];
const { CASES } = await import("./cases.ts");
const c = CASES.find((x) => x.id === id);
if (!c) throw new Error(`No eval case "${id}"`);

enterSandbox(`eval-${id}`, { keepRuntime: true });
// Measure the crew as you've configured it, plus any --set overrides from the runner.
const realSettings = join(REPO, "camp", "settings.json");
if (existsSync(realSettings)) copyFileSync(realSettings, "camp/settings.json");
const overrides = JSON.parse(process.env.EVAL_SET ?? "{}") as Record<string, { model: string; effort?: string }>;
if (Object.keys(overrides).length) {
  const s = existsSync("camp/settings.json") ? JSON.parse(readFileSync("camp/settings.json", "utf8")) : { agents: {} };
  s.agents = { ...(s.agents ?? {}), ...overrides };
  delete s.budgetUsd; // evals cap themselves below
  writeFileSync("camp/settings.json", JSON.stringify(s, null, 2));
}
for (const [path, content] of Object.entries(c.files ?? {})) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
process.env.CAMP_APPROVE_PLANS = "0"; // nobody is here to approve plans

const { runExpedition, runDirect } = await import("../src/quartermaster.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { setBudgetUsd } = await import("../src/settings.ts");
const { recentQuests, questCost } = await import("../src/questlog.ts");
const { costOf } = await import("../src/costs.ts");
const { judge } = await import("./judge.ts");
const { rl } = await import("../src/tools.ts");

setBudgetUsd(Number(process.env.EVAL_CASE_BUDGET ?? 2)); // a safety cap per case
// Approve only the shell commands this case expects; decline everything else.
setAsker(async (q) => (q.kind === "shell" && c.approveShell?.some((cmd) => q.body.trim() === cmd) ? "y" : "n"));

const tools: { who: string; tool: string; input: string }[] = [];
const dispatches: { who: string; at: number }[] = [];
onEvent((e: any) => {
  if (e.type === "tool") tools.push({ who: e.who, tool: e.tool, input: e.input });
  if (e.type === "dispatch" && e.who !== undefined && c.agent === undefined) dispatches.push({ who: e.who, at: Date.now() });
});

const t0 = Date.now();
let result: { status: string; text: string };
try {
  const r = c.agent ? await runDirect(c.agent, c.request) : await runExpedition(c.request);
  result = { status: r?.status ?? "error", text: r?.text ?? "" };
} catch (e: any) {
  result = { status: "error", text: e.message };
}
const seconds = Math.round((Date.now() - t0) / 1000);

let judgeCost = 0;
const ctx = {
  result, tools, dispatches,
  judge: async (rubric: string, evidence: string) => {
    const v = await judge(rubric, evidence);
    judgeCost += v.cost;
    return v;
  },
};
const checks = [];
for (const check of c.checks) {
  let outcome: boolean | string;
  try { outcome = await check.run(ctx); } catch (e: any) { outcome = `error: ${e.message}`; }
  checks.push({ name: check.name, required: !!check.required, pass: outcome === true, detail: outcome === true ? "" : String(outcome) });
}
const quests = recentQuests(Number.MAX_SAFE_INTEGER);
const cost = quests.reduce((sum, q) => sum + questCost(q), 0) + judgeCost;
const models = [...new Set(quests.map((q) => `${q.character}: ${q.model.replace(/^claude-/, "")}${q.effort ? ` · ${q.effort}` : ""}`))];

rl.close();
console.log("@@RESULT@@" + JSON.stringify({
  id, about: c.about, pass: checks.every((x) => x.pass || !x.required), status: result.status,
  seconds, cost, models, checks, reply: result.text.slice(0, 600),
}));
process.exit(0);
