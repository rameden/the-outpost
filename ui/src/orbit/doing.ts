// What one of the crew is doing right now, read out of the live feed for the full-screen view's
// panel (Orbit.tsx): each quest they have out with its last few steps, and anything they're
// working on that isn't a quest (the Quartermaster's own part of an expedition, or a crew member
// you messaged yourself). Pure: (the feed, a name) → what to show.

import { findNodes, stepState, type FeedNode, type FeedState, type QuestOut, type StepState } from "../feed/reducer.ts";

// One step, as a line: what it was (said, a tool, a file, a question, a notice, something you said to it) and its words.
// live: a reply that's still arriving.
export type Line = { id: string; tag: "said" | "tool" | "file" | "ask" | "note" | "you"; text: string; live?: boolean };
export type QuestDoing = QuestOut & { log: Line[] };
// A step of an approved plan, and how it stands.
export type Step = { n: number; text: string; state: StepState };
// An expedition they're working in outside any quest. steps: how the approved plan stands, if there is one (plan: step by step).
export type RunDoing = { expId: string; task: string; thread?: string; started: number; log: Line[]; steps?: { done: number; out: number; total: number }; plan?: Step[] };
// A running expedition's plan, as the waypoints round the sun show it.
export type Way = { expId: string; task: string; steps: Step[] };

export const LOG_LINES = 6;
const WORDS = 180;
const flat = (text: string) => text.replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();

function lineOf(n: FeedNode): Line | null {
  switch (n.kind) {
    case "msg": {
      const text = flat(n.text);
      if (!text) return null;
      // A finished reply is known by how it opens; one still arriving, by its latest words.
      const shown = text.length <= WORDS ? text : n.streaming ? `…${text.slice(-WORDS)}` : `${text.slice(0, WORDS)}…`;
      return { id: n.id, tag: "said", text: shown, ...(n.streaming ? { live: true } : {}) };
    }
    case "tool": return { id: n.id, tag: "tool", text: `${n.tool} ${n.input}`.trim().slice(0, WORDS) };
    case "file": return { id: n.id, tag: "file", text: `${n.change === "created" ? "Created" : "Updated"} ${n.path}` };
    case "ask": return { id: n.id, tag: "ask", text: n.outcome ? `${n.title}: ${n.outcome}` : `${n.title}: waiting for your OK` };
    case "notice": return { id: n.id, tag: "note", text: flat(n.text).slice(0, WORDS) };
    case "route": return { id: n.id, tag: "note", text: `${n.switched ? "Switched to" : "On"} ${n.model}: ${flat(n.reason)}`.slice(0, WORDS) };
    case "steer": return { id: n.id, tag: "you", text: flat(n.text).slice(0, WORDS) };
    default: return null;
  }
}
const lastLines = (nodes: FeedNode[]) => nodes.map(lineOf).filter((l): l is Line => !!l).slice(-LOG_LINES);
const expOf = (items: FeedNode[], node: string) => { const n = items.findLast((x) => x.id === node); return n?.kind === "exp" ? n : undefined; };
const byName = (n: FeedNode, name: string) => (n.kind === "msg" || n.kind === "tool" || n.kind === "file" || n.kind === "ask") && n.who === name;

// Their quests that are out, each with its last few steps (newest last).
export function questsOf(s: Pick<FeedState, "items" | "open" | "quests">, name: string): QuestDoing[] {
  return s.quests.filter((q) => q.who === name).map((q) => {
    const exp = s.open[q.expId] && expOf(s.items, s.open[q.expId].node);
    const quest = exp?.nodes.find((n) => n.id === q.node);
    return { ...q, log: quest?.kind === "quest" ? lastLines(quest.nodes) : [] };
  });
}

// The running expeditions they have a hand in outside a quest. For the Quartermaster that is every
// expedition the crew is on (it plans them all); for anyone else, only where they've said or done something.
export function runsOf(s: Pick<FeedState, "items" | "open">, name: string): RunDoing[] {
  const lead = name === "Quartermaster";
  return Object.entries(s.open).flatMap(([expId, o]) => {
    const exp = expOf(s.items, o.node);
    if (!exp || !o.members.includes(name)) return [];
    const mine = exp.nodes.filter((n) => byName(n, name) || (lead && n.kind === "steer"));
    if (!lead && !mine.length) return [];
    const plan = planOf(exp.nodes);
    const states = plan?.map((st) => st.state);
    return [{
      expId, task: exp.task, started: o.started, log: lastLines(mine), ...(exp.thread ? { thread: exp.thread } : {}),
      ...(states && plan ? { plan, steps: { done: states.filter((x) => x === "done").length, out: states.filter((x) => x === "out").length, total: states.length } } : {}),
    }];
  });
}
function planOf(nodes: FeedNode[]): Step[] | null {
  const plan = nodes.find((n) => n.kind === "plan");
  return plan?.kind === "plan" && plan.steps.length ? plan.steps.map((st) => ({ n: st.n, text: flat(st.text), state: stepState(st, plan.ended) })) : null;
}

// The plans of the expeditions that are running, oldest first: what the waypoints round the sun are drawn from.
export function waysOf(s: Pick<FeedState, "items" | "open">): Way[] {
  return Object.entries(s.open).flatMap(([expId, o]) => {
    const exp = o.plan ? expOf(s.items, o.node) : undefined;
    const steps = exp && planOf(exp.nodes);
    return exp && steps ? [{ expId, task: exp.task, steps }] : [];
  });
}
// The same, as a word that changes only when a step does (so whoever draws them needn't look again until then).
export const waysKey = (s: Pick<FeedState, "items" | "open">) => waysOf(s).map((w) => `${w.expId}:${w.steps.map((st) => st.state[0]).join("")}`).join("|");

// The decisions waiting on you, as their cards: all of them, or one crew member's.
export function asksOf(s: Pick<FeedState, "items" | "asks">, mine: (who: string) => boolean = () => true) {
  const ids = new Set(s.asks.filter((a) => mine(a.who)).map((a) => a.node));
  return ids.size ? findNodes(s.items, "ask").filter((n) => ids.has(n.id)) : [];
}
