// The memory, as a map: every remembered line a point, joined to the lines it's like and the lines
// it's used with. It's what the Constellation (ui/src/constellation/) draws.
//
// Nothing is stored for this. A line is who it is by the place it lives in and its words (norm, in
// memlog.ts), its origin comes from memory-log.jsonl, how often it was used from recall-log.jsonl
// (recalllog.ts), and the joins are worked out when asked:
//
//   alike      two lines share enough of their words (alike, in memfit.ts: no model is asked).
//              Each line keeps its three strongest, so one common subject doesn't tie the map in a knot.
//   together   two lines were used in the same run, at least twice.
//
// buildGraph and whyOf are pure: they're given the places, the recalls and a way to name a run's
// conversation. memoryGraph and memoryWhy at the bottom hand them the camp's own.

import { createHash } from "node:crypto";
import { history } from "./conversations.js";
import { memoryOverview, nameOf } from "./keeping.js";
import { alikeWords, wordsOf } from "./memfit.js";
import { norm, type KeptHow, type Where } from "./memlog.js";
import { readRecalls, type Recall, type RecallHow } from "./recalllog.js";
import { allTurns } from "./threads.js";

type Kind = "agent" | "project" | "about";
// What the builder needs of a place (keeping.ts's MemoryPlace has all of it).
export type GraphPlace = { where: Where; name: string; kind: Kind; emoji?: string;
  lines: { text: string; date?: string; pinned?: boolean; origin?: { how: KeptHow; run?: string; thread?: string; title?: string } }[] };

export type GraphNode = {
  id: string; where: Where; place: string; kind: Kind; emoji?: string;
  text: string; date?: string; pinned: boolean; origin?: GraphPlace["lines"][number]["origin"];
  recalls: number; lastRecalled?: string;       // how many times it was used, and when last
  lastThread?: { id: string; title?: string };  // the conversation it was last used in, when that's known
};
export type GraphEdge = { a: string; b: string; kind: "alike" | "together"; weight: number };
// since: when the recall log's oldest entry is from (nothing before that is known).
export type MemoryGraph = { nodes: GraphNode[]; edges: GraphEdge[]; since?: string };
export type Why = { time: string; how: RecallHow; score?: number; run?: string; thread?: string; title?: string };
type ThreadOf = (run: string) => { id: string; title?: string } | undefined;

// Two lines are joined as alike from here up. Tried against a real camp's memory (61 lines in 5
// places): real notes are long and rarely repeat each other's words, so 0.5 joined one pair and
// 0.4 two, and the map had no lines on it. At 0.3 there were 13, most of them ones a person would
// call the same subject (two notes on signing commits, two on where writes are allowed). At 0.25
// there were 32, and most only shared a project's name and a common verb.
export const ALIKE_AT = 0.3;
const ALIKE_EACH = 3;      // the strongest alike joins a line keeps
const TOGETHER_AT = 2;     // runs two lines must share to be joined as used together
const TOGETHER_EACH = 4;   // the strongest of those a line keeps
const RUN_LINES = 40;      // lines of one run that are paired up (a run that used more says little about any two of them)

export const nodeId = (where: Where, line: string) => "m" + createHash("sha1").update(`${where}\n${norm(line)}`).digest("hex").slice(0, 12);
const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

// The strongest first, each kept only while neither end has its fill.
function strongest(found: GraphEdge[], each: number): GraphEdge[] {
  const has = new Map<string, number>();
  const kept: GraphEdge[] = [];
  for (const e of [...found].sort((x, y) => y.weight - x.weight || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)))) {
    if ((has.get(e.a) ?? 0) >= each || (has.get(e.b) ?? 0) >= each) continue;
    has.set(e.a, (has.get(e.a) ?? 0) + 1);
    has.set(e.b, (has.get(e.b) ?? 0) + 1);
    kept.push(e);
  }
  return kept;
}

export function buildGraph(places: GraphPlace[], recalls: readonly Recall[], threadOf: ThreadOf = () => undefined): MemoryGraph {
  // How often each line was used, when last, and in which conversation (the log is oldest first).
  const used = new Map<string, { n: number; last: string; thread?: { id: string; title?: string } }>();
  const runs = new Map<string, Set<string>>();
  for (const r of recalls) {
    const id = nodeId(r.where, r.key);
    const u = used.get(id) ?? { n: 0, last: r.time };
    u.n++;
    if (r.time >= u.last) u.last = r.time;
    const thread = r.run ? threadOf(r.run) : undefined;
    if (thread) u.thread = thread;
    used.set(id, u);
    if (r.run) runs.set(r.run, (runs.get(r.run) ?? new Set()).add(id));
  }

  const nodes: GraphNode[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    for (const l of p.lines) {
      const id = nodeId(p.where, l.text);
      if (seen.has(id)) continue; // the same words twice in one place are one line here, as they are everywhere else
      seen.add(id);
      const u = used.get(id);
      nodes.push({ id, where: p.where, place: p.name, kind: p.kind, ...(p.emoji ? { emoji: p.emoji } : {}), text: l.text, ...(l.date ? { date: l.date } : {}), pinned: !!l.pinned,
        ...(l.origin ? { origin: l.origin } : {}), recalls: u?.n ?? 0, ...(u ? { lastRecalled: u.last } : {}), ...(u?.thread ? { lastThread: u.thread } : {}) });
    }
  }

  const words = nodes.map((n) => wordsOf(n.text));
  const alike: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const weight = alikeWords(words[i], words[j]);
    if (weight >= ALIKE_AT) alike.push({ a: nodes[i].id, b: nodes[j].id, kind: "alike", weight: Math.round(weight * 100) / 100 });
  }

  const shared = new Map<string, number>();
  for (const ids of runs.values()) {
    const here = [...ids].filter((id) => seen.has(id)).sort().slice(0, RUN_LINES);
    for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) shared.set(pairKey(here[i], here[j]), (shared.get(pairKey(here[i], here[j])) ?? 0) + 1);
  }
  const together: GraphEdge[] = [...shared].filter(([, n]) => n >= TOGETHER_AT).map(([k, n]) => { const [a, b] = k.split(" "); return { a, b, kind: "together", weight: n }; });

  return { nodes, edges: [...strongest(alike, ALIKE_EACH), ...strongest(together, TOGETHER_EACH)], ...(recalls.length ? { since: recalls[0].time } : {}) };
}

// One line's recalls, newest first: when, how, how well it matched, and in which conversation.
export function whyOf(recalls: readonly Recall[], where: Where, line: string, threadOf: ThreadOf = () => undefined, most = 200): Why[] {
  const key = norm(line);
  const out: Why[] = [];
  for (let i = recalls.length - 1; i >= 0 && out.length < most; i--) {
    const r = recalls[i];
    if (r.where !== where || r.key !== key) continue;
    const thread = r.run ? threadOf(r.run) : undefined;
    out.push({ time: r.time, how: r.how, ...(r.score !== undefined ? { score: r.score } : {}), ...(r.run ? { run: r.run } : {}), ...(thread ? { thread: thread.id, ...(thread.title ? { title: thread.title } : {}) } : {}) });
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

// ---------- The camp's own ----------
// A run's conversation, by the run's id.
function threads(): ThreadOf {
  const titles = new Map(history().conversations.map((c) => [c.id, c.title]));
  const of = new Map(allTurns().map((t) => [t.expedition, t.thread]));
  return (run) => { const id = of.get(run); return id ? { id, ...(titles.get(id) ? { title: titles.get(id) } : {}) } : undefined; };
}
export const memoryGraph = (): MemoryGraph => buildGraph(memoryOverview(), readRecalls(), threads());
// Throws ("There's no such memory.") for a place that isn't one.
export function memoryWhy(where: Where, line: string): Why[] {
  nameOf(where);
  return whyOf(readRecalls(), where, line, threads());
}
