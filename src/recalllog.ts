// When a remembered line was actually used.
//
//   camp/recall-log.jsonl   one line each time a memory line bore on the request a prompt was
//                           built for ("relevant"), or came back from the recall tool ("recall"):
//                           { time, where, key, how, score?, run? }
//
// where is the place the line lives in ("agent:<id>", "project:<id>", "about") and key is the line
// by its words alone (norm, in memlog.ts): the same way memory-log.jsonl finds a line's origin.
// A line that is in a prompt only because it's pinned or among the newest is not written down:
// that would be every line on every prompt, and would say nothing about which ones earn their keep.
//
// The same line is written once per run, the file keeps its newest RECALL_MAX entries, and nothing
// here ever throws: a prompt is never held up for the sake of this log.
//
// To read it: readRecalls() (everything, oldest first) and recallsOf(where, line) (one line's,
// newest first). It depends only on memlog.ts, memfit.ts and atomic.ts.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { fitMemory, parseEntry } from "./memfit.js";
import { norm, readAbout, type Where } from "./memlog.js";

export type RecallHow = "relevant" | "recall";
export type Recall = { time: string; where: Where; key: string; how: RecallHow; score?: number; run?: string };

export const RECALL_LOG = join("camp", "recall-log.jsonl");
export const RECALL_MAX = 5000;  // entries kept: the oldest make way
const SLACK = 500;               // how far past that the file may grow before it's cut back (so it isn't rewritten on every prompt)

// One (line, run) is written once. Without a run to go by (the terminal camp), once a day.
const once = (r: Pick<Recall, "time" | "where" | "key" | "run">) => `${r.run ?? `day:${r.time.slice(0, 10)}`}\n${r.where}\n${r.key}`;

type Loaded = { stamp: string; list: Recall[]; seen: Set<string> };
let cache: Loaded | null = null;
const stampOf = () => { const st = statSync(RECALL_LOG); return `${process.cwd()}|${st.mtimeMs}:${st.size}`; };
function load(): Loaded {
  if (!existsSync(RECALL_LOG)) return (cache = { stamp: `${process.cwd()}|none`, list: [], seen: new Set() });
  const stamp = stampOf();
  if (cache?.stamp === stamp) return cache;
  const list = readFileSync(RECALL_LOG, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { const r = JSON.parse(l) as Recall; return r && typeof r.key === "string" && typeof r.where === "string" && typeof r.time === "string" ? [r] : []; } catch { return []; }
  });
  return (cache = { stamp, list, seen: new Set(list.map(once)) });
}

// Every recall on record, oldest first. Empty if there's none, or the file can't be read.
export function readRecalls(): readonly Recall[] {
  try { return load().list; } catch { return []; }
}
// One line's recalls, newest first. line: the line as written, or its text alone.
export function recallsOf(where: Where, line: string): Recall[] {
  const key = norm(line);
  return readRecalls().filter((r) => r.where === where && r.key === key).reverse();
}

// Write down that these lines of one place were used. Never throws.
export function logRecalls(where: Where, lines: { text: string; score?: number }[], how: RecallHow, run?: string): void {
  try {
    if (!lines.length) return;
    const have = load();
    const time = new Date().toISOString();
    const fresh: Recall[] = [];
    for (const l of lines) {
      const key = norm(String(l.text ?? ""));
      const r: Recall = { time, where, key, how, ...(typeof l.score === "number" && isFinite(l.score) ? { score: Math.round(l.score * 100) / 100 } : {}), ...(run ? { run } : {}) };
      if (!key || have.seen.has(once(r))) continue;
      have.seen.add(once(r));
      fresh.push(r);
    }
    if (!fresh.length) return;
    mkdirSync("camp", { recursive: true });
    have.list.push(...fresh);
    if (have.list.length > RECALL_MAX + SLACK) {
      have.list = have.list.slice(-RECALL_MAX);
      have.seen = new Set(have.list.map(once));
      writeAtomic(RECALL_LOG, have.list.map((r) => JSON.stringify(r)).join("\n") + "\n");
    } else appendFileSync(RECALL_LOG, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
    cache = { stamp: stampOf(), list: have.list, seen: have.seen };
  } catch { cache = null; /* a recall that isn't written down is no loss */ }
}

// After a memory was fitted to a prompt (fitMemory): write down the lines that bore on the request.
// text: the memory as it was fitted. Lines there only for being pinned or new aren't in fit.relevant.
export function logRelevant(where: Where, text: string, fit: { relevant: Map<number, number> }, run?: string): void {
  try {
    if (!fit.relevant.size) return;
    const rows = text.split("\n");
    const lines = [...fit.relevant].flatMap(([i, score]) => (parseEntry(rows[i] ?? "") ? [{ text: rows[i], score }] : []));
    logRecalls(where, lines, "relevant", run);
  } catch { /* never in a prompt's way */ }
}
// The note about you is loaded whole, whatever the request: the lines of it that bear on this one.
export function logAboutRelevant(task: string, run?: string): void {
  try {
    const text = readAbout();
    if (text && task) logRelevant("about", text, fitMemory(text, Infinity, task), run);
  } catch { /* never in a prompt's way */ }
}
