// A run's transcript, saved as it goes, so a task that's picked up again (after a crash, a dropped
// connection, a restart) carries on from the messages it had instead of starting over from a
// summary of the conversation. The operation journal (oplog.ts) still guards what the tools
// changed; this keeps what the model knew.
//
// One file per task: camp/runs/<thread>_<agent>.json, written atomically after every turn and
// removed when the run ends on its own terms (done, stopped, out of turns…). A run that failed
// part-way leaves its file, exactly as the journal leaves that run open. It's restored under the
// journal's own rule: only by a run that replies to the one that broke off, and never while that
// one is still going in this process. With no file, a task is picked up the way it always was.

import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { readJsonFile, writeJsonAtomic } from "./atomic.js";
import { isLiveRun } from "./oplog.js";

export const RUNS_DIR = "camp/runs";
export const RUN_KEEP_DAYS = 7; // a transcript nobody came back for in a week is removed; the journal still covers its side effects
const SWEEP_EVERY = 6 * 3_600_000;
const DAY = 86_400_000;

type Msg = Anthropic.MessageParam;
export type SavedRun = {
  v: 1;
  run: string;                  // the run's id (expedition:quest:agent:n), as in the journal
  agent: string;
  model: string;
  turn: number;
  savedAt: number;
  messages: Msg[];
  authors: (string | null)[];   // which model wrote each assistant message (a switch of model keeps reasoning with its author)
  ops: [string, number][];      // the journal's call counts as of these messages
};

const held = new Set<string>(); // files a run in this process is writing to
const baseOf = (thread: string, agent: string) => `${thread}_${agent}`.replace(/[^\w.-]+/g, "_").slice(0, 120);
// The task's file, and the ones beside it when the same crew member has two quests going in one conversation.
const candidates = (base: string): string[] => {
  let names: string[];
  try { names = readdirSync(RUNS_DIR); } catch { return []; }
  return names.filter((n) => n === `${base}.json` || (n.startsWith(`${base}.`) && /^\.\d+\.json$/.test(n.slice(base.length)))).sort().map((n) => `${RUNS_DIR}/${n}`);
};
const valid = (v: any): v is SavedRun => !!v && v.v === 1 && typeof v.run === "string" && Array.isArray(v.messages) && v.messages.length > 0
  && v.messages.every((m: any) => m && (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)));

export class RunStore {
  readonly path: string;
  readonly restored: SavedRun | null = null;
  private closed = false;
  // continues: the run this one replies to (as for the journal).
  constructor(thread: string, readonly agent: string, readonly run: string, continues?: string) {
    const base = baseOf(thread, agent);
    const files = candidates(base);
    if (continues) {
      for (const path of files) {
        if (held.has(path)) continue;
        const saved = readJsonFile<SavedRun | null>(path, null);
        if (!valid(saved) || !saved.run.startsWith(`${continues}:`) || isLiveRun(saved.run)) continue;
        this.restored = saved;
        this.path = path; // carried on in the same file
        held.add(path);
        return;
      }
    }
    // A fresh file. One left by a run nobody is continuing is written over, unless a run here holds it.
    let path = `${RUNS_DIR}/${base}.json`;
    for (let n = 2; held.has(path); n++) path = `${RUNS_DIR}/${base}.${n}.json`;
    this.path = path;
    held.add(path);
  }
  // After every turn. Never a reason for the run to fail.
  save(s: { model: string; turn: number; messages: Msg[]; authorOf: (m: Msg) => string | undefined; ops: [string, number][] }) {
    if (this.closed) return;
    try {
      mkdirSync(RUNS_DIR, { recursive: true });
      const out: SavedRun = { v: 1, run: this.run, agent: this.agent, model: s.model, turn: s.turn, savedAt: Date.now(),
        messages: s.messages, authors: s.messages.map((m) => s.authorOf(m) ?? null), ops: s.ops };
      writeJsonAtomic(this.path, out);
      sweep();
    } catch { /* the run goes on without a saved copy */ }
  }
  // The run ended on its own terms: nothing of it is continued.
  finish() {
    this.closed = true;
    held.delete(this.path);
    try { rmSync(this.path, { force: true }); } catch { /* pruned later */ }
  }
  // The run failed part-way: its transcript stays for the run that picks it up.
  abandon() { this.closed = true; held.delete(this.path); }
}

const INTERRUPTED = "[Interrupted: this task broke off before a result for this call was recorded. If you still need it, make the call again: anything that already changed something is not done a second time.]";
export const RESTORED_NOTE = "[Outpost note: this task broke off part-way and was picked up again. The messages above are its transcript as it stood, restored. " +
  "Carry on from where it stopped: don't redo steps that already finished, and check anything you're unsure of before repeating it. What was said on picking it up again follows.]";

// A saved transcript made ready to carry on: every tool call answered (one that was under way when
// the run broke off gets a note in place of its result), then the new message on the end.
export function resumeMessages(saved: Msg[], task: string | Anthropic.ContentBlockParam[]): Msg[] {
  const out: Msg[] = saved.slice();
  // A reply the run never got to act on (cut off mid-thought, with nothing called): dropped.
  while (out.length > 1 && out.at(-1)!.role === "assistant" && !hasToolUse(out.at(-1)!)) out.pop();
  const last = out.at(-1)!;
  const taskBlocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: RESTORED_NOTE }, ...(typeof task === "string" ? [{ type: "text" as const, text: task }] : task)];
  if (last.role === "assistant") {
    const answers = (last.content as any[]).filter((b) => b?.type === "tool_use").map((b) => ({ type: "tool_result" as const, tool_use_id: String(b.id), content: INTERRUPTED, is_error: true }));
    out.push({ role: "user", content: [...answers, ...taskBlocks] });
    return out;
  }
  // The last word was the user's side (tool results, a note): the new message joins it, so the roles still take turns.
  const before: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
  const prev = out.at(-2);
  const answered = new Set(before.flatMap((b: any) => (b?.type === "tool_result" ? [String(b.tool_use_id)] : [])));
  const missing = prev?.role === "assistant" && Array.isArray(prev.content)
    ? (prev.content as any[]).filter((b) => b?.type === "tool_use" && !answered.has(String(b.id))).map((b) => ({ type: "tool_result" as const, tool_use_id: String(b.id), content: INTERRUPTED, is_error: true }))
    : [];
  const results = before.filter((b: any) => b?.type === "tool_result");
  const rest = before.filter((b: any) => b?.type !== "tool_result");
  out[out.length - 1] = { role: "user", content: [...results, ...missing, ...rest, ...taskBlocks] };
  return out;
}
const hasToolUse = (m: Msg) => Array.isArray(m.content) && (m.content as any[]).some((b) => b?.type === "tool_use");

// A restored transcript as words, for a runtime that can't be handed messages (Claude Code keeps
// its own): what was said, what was called, and the start of what came back. The latest of it is
// kept when it's too long.
export function transcriptText(messages: Msg[], max = 60_000): string {
  const lines: string[] = [];
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [${(s.length - n).toLocaleString()} more characters]` : s);
  const textOf = (c: any): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : `[${b?.type ?? "content"}]`)).join("\n") : "");
  for (const m of messages) {
    const blocks: any[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as any[]);
    for (const b of blocks) {
      if (b?.type === "text" && b.text?.trim()) lines.push(`${m.role === "assistant" ? "You" : "User"}: ${clip(b.text.trim(), 4_000)}`);
      else if (b?.type === "tool_use") lines.push(`You called ${String(b.name).replace(/^mcp__camp__/, "")}: ${clip(JSON.stringify(b.input ?? {}), 600)}`);
      else if (b?.type === "tool_result") lines.push(`Result${b.is_error ? " (failed)" : ""}: ${clip(textOf(b.content).trim(), 1_200)}`);
    }
  }
  let text = lines.join("\n");
  if (text.length > max) text = `[…the earlier part is left out…]\n${text.slice(-max)}`;
  return text;
}

// Remove transcripts nobody came back for. Never one a run here is writing to.
export function pruneRuns(now = Date.now()): { files: number; bytes: number } {
  const gone = { files: 0, bytes: 0 };
  let names: string[];
  try { names = readdirSync(RUNS_DIR); } catch { return gone; }
  for (const name of names) {
    const path = `${RUNS_DIR}/${name}`;
    try {
      const st = statSync(path);
      if (!st.isFile() || held.has(path) || now - st.mtimeMs < RUN_KEEP_DAYS * DAY) continue;
      rmSync(path);
      gone.files++;
      gone.bytes += st.size;
    } catch { /* gone meanwhile */ }
  }
  return gone;
}
const swept = new Map<string, number>();
function sweep(now = Date.now()) {
  const camp = process.cwd();
  if (now - (swept.get(camp) ?? -Infinity) < SWEEP_EVERY) return;
  swept.set(camp, now);
  try { pruneRuns(now); } catch { /* an old file left lying is no loss */ }
}
