// Operations that change something, written down before and after they run, so a task that's
// picked up again (after a dropped connection, a crash, a switch to another model) never does the
// same thing twice: no second pull request, review, notification or command.
//
// Each side-effecting tool call gets a stable operation id: the task (its conversation and crew
// member), the tool, its input, and how many times this run has made that same call before. It's
// recorded as started before the tool runs, and done (with its result) once it has. When a run
// that didn't finish is continued, the new run's calls map onto the old run's in the same order:
//   - one that finished: its recorded result is given back, and it isn't run again;
//   - one that started but has no outcome: the tool's own reconcile check settles it if it has one
//     (an idempotency key, or something it can look at); otherwise it's not run, and the crew is
//     told to check before trying again (the next identical call then runs).
// The journal lives in camp/ops/<task>.jsonl.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendLine } from "./atomic.js";
import { autoApproval } from "./shell.js";
import type { Tool, ToolOutput } from "./tools.js";

export const OPS_DIR = "camp/ops";
// The tools whose calls change something outside the conversation.
export const JOURNALED = new Set(["bash", "write_file", "edit_file", "post_review", "describe_pull_request"]);
// A command that only reads, or checks (tests, linters, builds, type checks), is run afresh every
// time: its answer is the point, and an old one would be stale.
const VERIFYING = [
  "(npm|pnpm|yarn|bun)\\s+(run\\s+)?(test|lint|typecheck|check|build)\\b",
  "npx\\s+(tsc|eslint|jest|vitest|mocha|tsx\\s+--test)\\b",
  "(tsc|eslint|pytest|jest|vitest|mocha)\\b", "go\\s+(test|vet|build)\\b", "cargo\\s+(test|check|build|clippy)\\b",
  "make\\s+(test|check|lint)\\b", "node\\s+\\S*(test|check|spec)\\S*",
];
const anyOf = (list: string[]) => new RegExp("(^|[;&|]\\s*)(" + list.join("|") + ")");
const CHECK = anyOf([...VERIFYING, "git\\s+(status|diff|log|show)\\b"]);
// A command that puts the work to the test (tests, a linter, a build, a type check): what it says
// is whether the work holds up. Looking at git isn't one.
const VERIFIES = anyOf(VERIFYING);
export const verifies = (command: string) => VERIFIES.test(command);
export function journals(tool: string, input: any): boolean {
  // Filing or changing a Mae ticket (tickets.ts) is a change; listing or reading them isn't.
  if (tool === "tickets") return input?.action === "create" || input?.action === "update";
  if (!JOURNALED.has(tool)) return false;
  if (tool !== "bash") return true;
  const command = String(input?.command ?? "");
  let readOnly = false;
  try { readOnly = autoApproval(command) === "builtin"; } catch { /* treat as one that changes something */ }
  return !readOnly && !CHECK.test(command);
}

type Rec =
  | { kind: "run_start" | "run_end"; run: string; at: number }
  | { kind: "started"; run: string; op: string; tool: string; at: number }
  | { kind: "done"; run: string; op: string; tool: string; at: number; result: string; failed?: boolean }
  | { kind: "surfaced"; run: string; op: string; at: number };

export type Reconciled = { state: "done"; result: string } | { state: "not_done" } | { state: "unknown" };

const live = new Set<string>(); // runs going right now in this process: never someone else's to take over

// Same input, same text: keys sorted, so {a,b} and {b,a} are one operation.
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const textOf = (out: ToolOutput) => (typeof out === "string" ? out : out.map((b: any) => (b?.type === "text" ? b.text : `[${b?.type ?? "content"}]`)).join("\n"));

export class OpJournal {
  readonly path: string;
  private counts = new Map<string, number>();
  private prior = new Map<string, { started?: boolean; done?: { result: string; failed?: boolean }; surfaced?: boolean }>();
  // continues: the run this one replies to. Only that run's unfinished work is picked up, and only
  // if it was the latest run of this task and never finished.
  constructor(readonly task: string, readonly run: string, continues?: string) {
    this.path = `${OPS_DIR}/${task.replace(/[^\w.-]+/g, "_").slice(0, 120)}.jsonl`;
    const recs: Rec[] = existsSync(this.path)
      ? readFileSync(this.path, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Rec]; } catch { return []; } })
      : [];
    // Only the latest run before this one, and only if it never finished: that's the run being continued.
    const starts = recs.filter((r) => r.kind === "run_start" && r.run !== run).map((r) => r.run);
    const last = starts.at(-1);
    const ended = last && recs.some((r) => r.kind === "run_end" && r.run === last);
    if (last && !ended && !live.has(last) && continues && last.startsWith(`${continues}:`)) {
      for (const r of recs) {
        if (r.run !== last || !("op" in r)) continue;
        const slot = this.prior.get(r.op) ?? {};
        if (r.kind === "started") slot.started = true;
        if (r.kind === "done") slot.done = { result: r.result, ...(r.failed ? { failed: true } : {}) };
        if (r.kind === "surfaced") slot.surfaced = true;
        this.prior.set(r.op, slot);
      }
    }
  }
  private write(r: Rec) {
    mkdirSync(OPS_DIR, { recursive: true });
    appendLine(this.path, JSON.stringify(r));
  }
  begin() { live.add(this.run); this.write({ kind: "run_start", run: this.run, at: Date.now() }); }
  // A run that ended on its own terms (done, stopped, out of turns…): nothing of it is continued.
  end() { live.delete(this.run); this.write({ kind: "run_end", run: this.run, at: Date.now() }); }
  // A run that failed part-way: left open, so a run that continues it can reuse what it did.
  abandon() { live.delete(this.run); }
  opId(tool: string, input: unknown): string {
    const base = `${tool}\n${canonical(input)}`;
    const n = this.counts.get(base) ?? 0;
    this.counts.set(base, n + 1);
    return `op_${hash(`${this.task}\n${base}\n${n}`)}`;
  }
  priorOf(op: string) { return this.prior.get(op); }
  started(op: string, tool: string) { this.write({ kind: "started", run: this.run, op, tool, at: Date.now() }); }
  done(op: string, tool: string, out: ToolOutput, failed = false) {
    this.write({ kind: "done", run: this.run, op, tool, at: Date.now(), result: textOf(out).slice(0, 20_000), ...(failed ? { failed: true } : {}) });
  }
  surfaced(op: string) { this.write({ kind: "surfaced", run: this.run, op, at: Date.now() }); }
}

// A tool whose every call is journaled. notice: what to tell the feed when a call is reused or held back.
export function journaled(t: Tool & { reconcile?: (input: any, op: string) => Promise<Reconciled> }, j: OpJournal, notice: (text: string) => void): Tool {
  const run = t.run;
  if (!run || !("name" in t.def) || !JOURNALED.has(t.def.name)) return t;
  const name = t.def.name;
  return {
    ...t,
    run: async (input: any, ctx?: { opId?: string }) => {
      if (!journals(name, input)) return run(input, ctx);
      const op = ctx?.opId ?? j.opId(name, input);
      const before = j.priorOf(op);
      if (before?.done) {
        notice(`↩️ ${name} already ran before this task was picked up again (${op}): its recorded result is reused, and it isn't run a second time.`);
        j.done(op, name, before.done.result, before.done.failed);
        const note = `[Recorded result reused: this exact call already ran earlier in this task (operation ${op}), so it wasn't run again. If you need a fresh result, change the call.]\n`;
        if (before.done.failed) throw new Error(note + before.done.result);
        return note + before.done.result;
      }
      if (before?.started && !before.surfaced) {
        const settled = t.reconcile ? await t.reconcile(input, op).catch((): Reconciled => ({ state: "unknown" })) : { state: "unknown" as const };
        if (settled.state === "done") {
          notice(`↩️ ${name} had started before this task was picked up again (${op}); it's confirmed to have taken effect, so it isn't run again.`);
          j.done(op, name, settled.result);
          return `[Confirmed already done earlier in this task (operation ${op}): not run again.]\n${settled.result}`;
        }
        if (settled.state === "unknown") {
          j.surfaced(op);
          notice(`⚠️ ${name} had started before this task was picked up again (${op}), and whether it took effect isn't known. It wasn't run again.`);
          throw new Error(`Not run: this exact call (operation ${op}) started earlier in this task but its outcome was never recorded, so it may already have taken effect. ` +
            "Check whether it did (look for the file, commit, pull request, comment or message it would have made) before running it again. If it didn't, make the same call again and it will run.");
        }
      }
      j.started(op, name);
      try {
        const out = await run(input, { opId: op });
        j.done(op, name, out);
        return out;
      } catch (err: any) {
        j.done(op, name, `Error: ${err?.stderr || err?.message || err}`, true);
        throw err;
      }
    },
  };
}
