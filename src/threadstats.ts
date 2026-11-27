// A conversation's Status tab: what its runs cost and took, who did the work, and what fills the
// context of its latest run. Everything comes from records the camp already keeps: the quest log
// (every model run, with its tokens and cost), the conversation's turns, and the saved transcripts.

import { existsSync, readFileSync } from "node:fs";
import { allQuests, questCost, type QuestEntry } from "./questlog.js";
import { allTurns, type Turn } from "./threads.js";
import { measurePart } from "./routing.js";
import { currentName } from "./crew.js";
import { flat as clip } from "./helpers.js";

type Usage = QuestEntry["usage"];
export type StatsRun = { id: string; task: string; time: string; status: string; by: string; cost: number; seconds: number; turns: number; usage: Usage; quests: number; model?: string };
export type StatsShare = { name: string; cost: number; tokens: number; runs: number };
// setup: the system prompt, crew notes, memory, skills and tool definitions. They aren't saved with the
// transcript, so it is estimated from what the run was billed for each call (see setupOf).
export type ContextPart = { key: "setup" | "request" | "you" | "replies" | "calls" | "results"; tokens: number };
export type ThreadStats = {
  runs: StatsRun[];
  total: { cost: number; seconds: number; turns: number; usage: Usage; runs: number; quests: number; estimated: boolean };
  crew: StatsShare[];   // by crew member, most expensive first
  models: StatsShare[]; // by model, the same
  tools: { name: string; calls: number }[]; // every tool call in the conversation's transcripts, most used first
  // The latest lead run's context, by what's in it. perCall: what it read in on an average call.
  context: { run: string; tokens: number; messages: number; perCall: number; parts: ContextPart[]; heaviest: { name: string; tokens: number }[] } | null;
};

const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const add = (a: Usage, b: Usage) => { a.input += b.input; a.output += b.output; a.cacheRead += b.cacheRead ?? 0; a.cacheWrite += b.cacheWrite ?? 0; };
const tokensIn = (u: Usage) => u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + u.output;
const tok = (v: unknown) => { const p = measurePart(v); return Math.ceil(p.chars / 4) + p.images * 1_600; };
const bare = (name: unknown) => String(name ?? "").replace(/^mcp__camp__/, "");

// A run's own log line (whoever led it). Lines from before they carried their run's id are found
// by what they were asked and when they started (a turn keeps the time its run started).
function leadLine(t: Turn, quests: QuestEntry[]): QuestEntry | undefined {
  const tagged = quests.find((q) => q.kind !== "quest" && q.expedition === t.expedition);
  if (tagged) return tagged;
  const asked = clip(t.task, 200), started = Date.parse(t.time);
  return quests.find((q) => q.kind === "expedition" && !q.expedition && q.task === asked && Math.abs(Date.parse(q.time) - started) < 60_000);
}

type Msg = { role: string; content: string | { type: string; [k: string]: unknown }[] };
function readSession(path: string | undefined): Msg[] | null {
  if (!path || !existsSync(path)) return null;
  try { const j = JSON.parse(readFileSync(path, "utf8")); return Array.isArray(j.messages) ? j.messages : null; } catch { return null; }
}

export function contextOf(messages: Msg[]): Omit<NonNullable<ThreadStats["context"]>, "run" | "perCall"> {
  const parts: Record<ContextPart["key"], number> = { setup: 0, request: 0, you: 0, replies: 0, calls: 0, results: 0 };
  const names = new Map<string, string>(), heavy = new Map<string, number>();
  messages.forEach((m, i) => {
    if (typeof m.content === "string") { parts[m.role === "assistant" ? "replies" : i === 0 ? "request" : "you"] += tok(m.content); return; }
    for (const b of m.content) {
      const n = tok(b);
      if (b.type === "tool_use") { names.set(String(b.id), bare(b.name)); parts.calls += n; }
      else if (b.type === "tool_result") { parts.results += n; const name = names.get(String(b.tool_use_id)) ?? "tool"; heavy.set(name, (heavy.get(name) ?? 0) + n); }
      else if (m.role === "assistant") parts.replies += n;
      else parts[i === 0 ? "request" : "you"] += n;
    }
  });
  const list = (Object.keys(parts) as ContextPart["key"][]).map((key) => ({ key, tokens: parts[key] }));
  return {
    tokens: list.reduce((s, p) => s + p.tokens, 0), messages: messages.length, parts: list,
    heaviest: [...heavy].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens).slice(0, 5),
  };
}

// Every call reads the set-up and the transcript so far, which grows from nothing to all of it: on
// average, the set-up and about half the transcript. So the set-up is roughly what an average call
// read in, less half the transcript. A rough figure, labelled as one on the page.
export function setupOf(perCall: number, transcript: number): number {
  return Math.max(0, Math.round(perCall - transcript / 2));
}
function withSetup(run: string, lead: QuestEntry, c: ReturnType<typeof contextOf>): NonNullable<ThreadStats["context"]> {
  const u = lead.usage, perCall = lead.turns ? Math.round((u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)) / lead.turns) : 0;
  const setup = setupOf(perCall, c.tokens);
  return { run, ...c, tokens: c.tokens + setup, perCall, parts: c.parts.map((p) => (p.key === "setup" ? { ...p, tokens: setup } : p)) };
}

function toolCalls(messages: Msg[], into: Map<string, number>) {
  for (const m of messages) if (m.role === "assistant" && typeof m.content !== "string")
    for (const b of m.content) if (b.type === "tool_use") { const n = bare(b.name); into.set(n, (into.get(n) ?? 0) + 1); }
}

export function threadStats(thread: string): ThreadStats {
  const turns = allTurns().filter((t) => t.thread === thread);
  const quests = allQuests();
  const runs: StatsRun[] = [];
  const total = { cost: 0, seconds: 0, turns: 0, usage: zero(), runs: turns.length, quests: 0, estimated: false };
  const crew = new Map<string, StatsShare>(), models = new Map<string, StatsShare>(), tools = new Map<string, number>();
  const share = (m: Map<string, StatsShare>, name: string, q: QuestEntry) => {
    const s = m.get(name) ?? { name, cost: 0, tokens: 0, runs: 0 };
    s.cost += questCost(q); s.tokens += tokensIn(q.usage); s.runs++; m.set(name, s);
  };
  let latest: { run: string; lead: QuestEntry } | null = null;
  for (const t of turns) {
    const lead = leadLine(t, quests);
    const sent = quests.filter((q) => q.kind === "quest" && q.expedition === t.expedition);
    const lines = lead ? [lead, ...sent] : sent;
    const run: StatsRun = { id: t.expedition, task: t.task, time: t.time, status: t.status, by: currentName(lead?.character ?? t.agent), cost: 0, seconds: lead?.seconds ?? 0, turns: 0, usage: zero(), quests: sent.length, model: lead?.model };
    for (const q of lines) {
      run.cost += questCost(q); run.turns += q.turns; add(run.usage, q.usage);
      if (q.runtime === "claude-code") total.estimated = true;
      share(crew, currentName(q.character), q); share(models, q.model, q);
      toolCalls(readSession(q.session) ?? [], tools);
    }
    if (!lead) run.seconds = sent.reduce((s, q) => s + q.seconds, 0);
    total.cost += run.cost; total.seconds += run.seconds; total.turns += run.turns; total.quests += sent.length; add(total.usage, run.usage);
    if (lead?.session) latest = { run: t.expedition, lead };
    runs.push(run);
  }
  const messages = latest ? readSession(latest.lead.session) : null;
  const byCost = (m: Map<string, StatsShare>) => [...m.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  return {
    runs, total, crew: byCost(crew), models: byCost(models),
    tools: [...tools].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
    context: latest && messages ? withSetup(latest.run, latest.lead, contextOf(messages)) : null,
  };
}
