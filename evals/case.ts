// Runs ONE eval case in a throwaway camp and prints its result as JSON (the runner calls this
// in a fresh process per case, because the camp folder is fixed when the camp's code loads).

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, copyFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { enterSandbox, REPO } from "../tests/helpers/sandbox.ts";
import type { CaseContext, Moment } from "./cases.ts";

const id = process.argv[2];
const { CASES, approvesShell } = await import("./cases.ts");
const c = CASES.find((x) => x.id === id);
if (!c) throw new Error(`No eval case "${id}"`);

enterSandbox(`eval-${id}`, { keepRuntime: true });
// Measure the crew as you've configured it, plus any --set overrides from the runner.
// (EVAL_PLAIN=1 leaves your settings out: the tests use it, so they never read a real camp.)
const realSettings = join(REPO, "camp", "settings.json");
if (process.env.EVAL_PLAIN !== "1" && existsSync(realSettings)) copyFileSync(realSettings, "camp/settings.json");
const overrides = JSON.parse(process.env.EVAL_SET ?? "{}") as Record<string, { model: string; effort?: string }>;
if (Object.keys(overrides).length) {
  const s = existsSync("camp/settings.json") ? JSON.parse(readFileSync("camp/settings.json", "utf8")) : { agents: {} };
  s.agents = { ...(s.agents ?? {}), ...overrides };
  delete s.budgetUsd; // evals cap themselves below
  writeFileSync("camp/settings.json", JSON.stringify(s, null, 2));
}
const put = (root: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};
put(".", c.files ?? {});
// Nobody is here to approve plans, so they aren't asked for; a case about the plan itself keeps
// the approval step, and the stand-in for the user below says yes to it.
process.env.CAMP_APPROVE_PLANS = c.plans ? "1" : "0";

const { runExpedition, runDirect } = await import("../src/quartermaster.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { setBudgetUsd } = await import("../src/settings.ts");
const { recentQuests, questCost } = await import("../src/questlog.ts");
const { judge } = await import("./judge.ts");
const { rl } = await import("../src/tools.ts");

// A safety cap per case, or the budget the case is about.
setBudgetUsd(c.budgetUsd ?? Number(process.env.EVAL_CASE_BUDGET ?? 2));

// A linked folder of the case's own: a small git repo beside the camp, linked for writing, with
// its checks set. The crew works on it in place, so the rules can look at it afterwards.
let linkPath = "";
if (c.link) {
  const { addLink, setLinkVerify } = await import("../src/links.ts");
  linkPath = join(realpathSync.native(mkdtempSync(join(tmpdir(), "mae-eval-link-"))), c.link.name);
  mkdirSync(linkPath);
  put(linkPath, c.link.files);
  const git = (...args: string[]) => spawnSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.invalid", ...args], { cwd: linkPath, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("commit", "-q", "-m", "The folder as the case starts");
  const link = addLink(linkPath, "write");
  if (link.name !== c.link.name) throw new Error(`The linked folder was named ${link.name}, not ${c.link.name}`);
  if (c.link.verify?.length) setLinkVerify(link.name, c.link.verify);
}
const linkPrefix = c.link ? `links/${c.link.name}` : "";
const onDisk = (path: string) => (linkPrefix && (path === linkPrefix || path.startsWith(`${linkPrefix}/`)) ? join(linkPath, path.slice(linkPrefix.length)) : path);

// A task that was cut off: the conversation has a turn that never ended, and the journal holds
// what that run had already done. The case's request then replies to it.
const BEFORE = "eval-before", NOW = "eval-now";
if (c.resume && c.agent) {
  const { recordTurn } = await import("../src/threads.ts");
  const { OpJournal } = await import("../src/oplog.ts");
  recordTurn({ thread: BEFORE, expedition: BEFORE, agent: c.agent, direct: true, task: c.resume.earlier, reply: "", status: "running" });
  const journal = new OpJournal(`${BEFORE}:${c.agent}`, `${BEFORE}:-:${c.agent}:1`);
  journal.begin();
  for (const d of c.resume.done) {
    const op = journal.opId(d.tool, d.input);
    journal.started(op, d.tool);
    journal.done(op, d.tool, d.result);
  }
  if (c.resume.transcript) {
    // The transcript as the run last saved it: the task, then each thing it did with its result.
    const { RunStore } = await import("../src/runstore.ts");
    const messages: any[] = [{ role: "user", content: c.resume.earlier }];
    c.resume.done.forEach((d, i) => messages.push(
      { role: "assistant", content: [{ type: "tool_use", id: `toolu_before_${i + 1}`, name: d.tool, input: d.input }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_before_${i + 1}`, content: d.result }] }));
    const store = new RunStore(BEFORE, c.agent, `${BEFORE}:-:${c.agent}:1`);
    store.save({ model: "", turn: c.resume.done.length, messages, authorOf: () => undefined, ops: journal.callCounts() });
    store.abandon();
  }
  journal.abandon();
}

// Everything that happens, in order: what the loop cases' rules read.
const trail: Moment[] = [];
// Approve only the shell commands this case expects (see approvesShell), and the tool calls whose
// approval card names one of the things it expects (approveTools); answer a question with the
// case's answer; say no to everything else. Every one is noted, and the ones told no go in the
// result, so a run that stopped because something was refused shows what it was.
const asked: { kind: string; title: string; answer: string }[] = [];
const declined: { kind: string; title: string; body: string }[] = [];
setAsker(async (q) => {
  const yes = (q.kind === "shell" && approvesShell(q.body, c.approveShell, process.cwd()))
    || (q.kind === "tool" && c.approveTools?.some((part) => q.title.includes(part)));
  const answer = q.kind === "question" && c.answer ? c.answer : yes || (q.kind === "plan" && c.plans) ? "y" : "n";
  asked.push({ kind: q.kind, title: q.title, answer });
  if (answer === "n") declined.push({ kind: q.kind, title: q.title.slice(0, 160), body: q.body.trim().slice(0, 400) });
  trail.push({ type: "ask", kind: q.kind, title: q.title, body: q.body, answer });
  return answer;
});

const tools: { who: string; tool: string; input: string }[] = [];
const dispatches: { who: string; at: number }[] = [];
onEvent((e: any) => {
  if (e.type === "tool") { tools.push({ who: e.who, tool: e.tool, input: e.input }); trail.push({ type: "tool", who: e.who, tool: e.tool, input: String(e.input ?? "") }); }
  if (e.type === "dispatch" && e.who !== undefined) {
    if (c.agent === undefined) dispatches.push({ who: e.who, at: Date.now() });
    trail.push({ type: "dispatch", who: e.who, ...(e.questId ? { quest: e.questId } : {}), ...(e.step ? { step: e.step } : {}), ...(e.helperOf ? { helperOf: e.helperOf } : {}) });
  }
  if (e.type === "quest_tree") trail.push({ type: "tree", who: e.who, quest: e.questId, link: e.link, branch: e.branch, state: e.state });
  if (e.type === "return" && e.who !== undefined) trail.push({ type: "return", who: e.who, ...(e.questId ? { quest: e.questId } : {}), status: String(e.status ?? "") });
  if (e.type === "plan" && Array.isArray(e.steps)) trail.push({ type: "plan", steps: e.steps.map((s: any) => ({ n: s.n, text: s.text, ...(s.after?.length ? { after: s.after } : {}) })) });
  if (e.type === "notice" && typeof e.text === "string") trail.push({ type: "notice", who: e.who ?? "", text: e.text });
});

const t0 = Date.now();
let result: { status: string; text: string };
try {
  const r = c.agent
    ? await runDirect(c.agent, c.request, "direct", [], undefined, NOW, c.resume ? BEFORE : undefined)
    : await runExpedition(c.request, c.review === undefined ? {} : { review: c.review });
  result = { status: r?.status ?? "error", text: r?.text ?? "" };
} catch (e: any) {
  result = { status: "error", text: e.message };
}
const seconds = Math.round((Date.now() - t0) / 1000);

const quests = recentQuests(Number.MAX_SAFE_INTEGER);
const spent = quests.reduce((sum, q) => sum + questCost(q), 0);
let judgeCost = 0;
const ctx: CaseContext = {
  result, tools, dispatches, asked, trail, spent,
  read: (path) => { try { return readFileSync(onDisk(path), "utf8"); } catch { return null; } },
  ok: (command, cwd) => spawnSync(command, { shell: true, cwd: cwd ? onDisk(cwd) : process.cwd(), stdio: "ignore", timeout: 60_000 }).status === 0,
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
const cost = spent + judgeCost;
// Everything sent to and got back from the models the crew ran on (the judge is not counted).
const tokens = quests.reduce((t, q) => ({
  in: t.in + (q.usage?.input ?? 0) + (q.usage?.cacheRead ?? 0) + (q.usage?.cacheWrite ?? 0),
  out: t.out + (q.usage?.output ?? 0),
}), { in: 0, out: 0 });
const models = [...new Set(quests.map((q) => `${q.character}: ${q.model.replace(/^claude-/, "")}${q.effort ? ` · ${q.effort}` : ""}`))];

rl.close();
console.log("@@RESULT@@" + JSON.stringify({
  id, about: c.about, pass: checks.every((x) => x.pass || !x.required), status: result.status,
  seconds, cost, tokens, models, checks, reply: result.text.slice(0, 600), declined,
}));
process.exit(0);
