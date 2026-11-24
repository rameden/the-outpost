// Headless: one request, start to finish, with nobody at the keyboard. For scripts, CI, and
// GitHub Actions.
//
//   npm run headless -- "Fix the failing date test in links/web"
//   npm run headless -- --json --approve-plan --project web --worktree web "…"
//   npm run headless -- --agent scribe "Tidy the README"
//   echo "…" | npm run headless -- --json -
//
// Flags:
//   --json            print one JSON object at the end (status, the report, cost, files changed, worktrees)
//                     instead of the report as text. Progress always goes to stderr.
//   --approve-plan    approve the Quartermaster's plan (otherwise it's declined, and the run ends
//                     with the plan as its report: useful for "what would you do?")
//   --project <id>    file it under that project: its folders, notes and defaults apply
//   --worktree <link> work in a new worktree and branch of that linked repository (repeatable)
//   --agent <name>    send it straight to one crew member instead of the Quartermaster
//   --quiet           no progress on stderr
//
// Nothing else is approved for you. Shell commands still need approval, so they're declined
// here unless the shell sandbox is on (then sandboxed commands run as usual) or they're on your
// allow list. Connector writes and new scheduled jobs are declined. Every decline is listed in
// the output so you can see what it wanted.
//
// Exit codes: 0 finished, 1 failed or refused, 2 stopped short (budget, turn limit, cut off).

import { rl } from "./tools.js";
import { setAsker } from "./ask.js";
import { attachConsole } from "./events.js";
import { CREW, findCrew } from "./crew.js";
import { w } from "./words.js";
import { runDirect, runExpedition } from "./quartermaster.js";
import { prepareWorkspaces, workspaceStatus, type WorkspaceChoice } from "./repos.js";
import { changedFiles } from "./checkpoints.js";
import { getProject } from "./conversations.js";
import { costOf } from "./costs.js";
import { questsCostOf } from "./questlog.js";
import { randomUUID } from "node:crypto";
import type { AgentResult } from "./agent.js";

export type HeadlessArgs = { task: string; json: boolean; approvePlan: boolean; project?: string; worktrees: string[]; agent?: string; quiet: boolean };

export function parseArgs(argv: string[]): HeadlessArgs | { error: string } {
  const out: HeadlessArgs = { task: "", json: false, approvePlan: false, worktrees: [], quiet: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value.`); return v; };
    try {
      if (a === "--json") out.json = true;
      else if (a === "--approve-plan") out.approvePlan = true;
      else if (a === "--quiet") out.quiet = true;
      else if (a === "--project") out.project = value();
      else if (a === "--worktree") out.worktrees.push(value());
      else if (a === "--agent") out.agent = value();
      else if (a.startsWith("--")) return { error: `Unknown flag ${a}.` };
      else words.push(a);
    } catch (e: any) { return { error: e.message }; }
  }
  out.task = words.join(" ").trim();
  return out;
}

export type HeadlessResult = {
  id: string; status: AgentResult["status"] | "error"; text: string; costUsd: number;
  changed: { path: string; change: string }[];
  worktrees: { link: string; path: string; branch: string; changed: number; commits: number }[];
  declined: { kind: string; body: string }[];
};

export const exitCode = (status: HeadlessResult["status"]) =>
  status === "done" ? 0 : status === "error" || status === "refused" ? 1 : 2;

// The run itself, without touching stdin, stdout or the process (so it can be tested).
export async function runHeadless(a: HeadlessArgs, signal?: AbortSignal): Promise<HeadlessResult> {
  const declined: HeadlessResult["declined"] = [];
  setAsker(async (q) => {
    if (q.kind === "plan" && a.approvePlan) return "";
    declined.push({ kind: q.kind, body: q.body.slice(0, 2000) });
    return q.kind === "plan" ? "n" : q.kind === "question" ? "Nobody is at the keyboard (a headless run). Make the most reasonable choice and say which you made." : "n";
  });
  const id = randomUUID();
  if (a.project && !getProject(a.project)) throw new Error(`No project named "${a.project}".`);
  const choices: Record<string, WorkspaceChoice> = Object.fromEntries(a.worktrees.map((l) => [l, { mode: "new" as const }]));
  const workspaces = a.worktrees.length ? await prepareWorkspaces(choices, a.task, id) : undefined;
  const where = { ...(a.project ? { project: a.project } : {}), ...(workspaces ? { links: Object.keys(workspaces) } : {}) };
  let result: AgentResult | null;
  try {
    if (a.agent) {
      const who = findCrew(a.agent);
      if (!who) throw new Error(`No ${w("crew")} member called "${a.agent}".`);
      result = await runDirect(who.id, a.task, "direct", undefined, signal, id, undefined, { workspaces, ...where });
    } else {
      result = await runExpedition(a.task, { signal, id, workspaces, ...where });
    }
  } catch (e: any) {
    return { id, status: "error", text: e.message, costUsd: questsCostOf(id), changed: [], worktrees: [], declined };
  }
  if (!result) throw new Error("Nothing ran.");
  const worktrees = await Promise.all(Object.values(workspaces ?? {}).map(async (w) => {
    const s = await workspaceStatus(w);
    return { link: w.link, path: w.path, branch: w.branch, changed: s.changed, commits: s.commits };
  }));
  return {
    id, status: result.status, text: result.text,
    costUsd: Math.round(((result.costUsd ?? costOf(result.model, result.usage)) + questsCostOf(id)) * 10_000) / 10_000,
    changed: changedFiles(id), worktrees, declined,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) { console.error(parsed.error); process.exit(1); }
  const a = parsed;
  if (a.task === "-") a.task = (await readStdin()).trim();
  if (!a.task) { console.error('Say what to do: npm run headless -- "…" (or pipe it in with -).'); process.exit(1); }
  // Progress on stderr, so stdout is only the answer (written with process.stdout below).
  console.log = (...args: unknown[]) => console.error(...args);
  if (!a.quiet) attachConsole(() => ({ lead: CREW.quartermaster.name, back: w("back") }));
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const r = await runHeadless(a, controller.signal);
  if (a.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else {
    process.stdout.write(r.text.trim() + "\n");
    if (r.declined.length) process.stderr.write(`\nDeclined (nobody here to approve): ${r.declined.map((d) => `${d.kind}: ${d.body.split("\n")[0]}`).join("; ")}\n`);
  }
  rl.close();
  process.exit(exitCode(r.status));
}

if (process.argv[1] && /headless\.(ts|js)$/.test(process.argv[1])) void main();
