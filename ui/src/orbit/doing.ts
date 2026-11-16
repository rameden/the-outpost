// What one of the crew is doing right now, read out of the live feed for the full-screen view's
// panel (Orbit.tsx): each quest they have out with its last few steps, and anything they're
// working on that isn't a quest (the Quartermaster's own part of an expedition, or a crew member
// you messaged yourself). Pure: (the feed, a name) → what to show.

import { stepState, type FeedNode, type FeedState, type QuestOut } from "../feed/reducer.ts";

// One step, as a line: what it was (said, a tool, a file, a question, a notice, something you said to it) and its words.
// live: a reply that's still arriving.
export type Line = { id: string; tag: "said" | "tool" | "file" | "ask" | "note" | "you"; text: string; live?: boolean };
export type QuestDoing = QuestOut & { log: Line[] };
// An expedition they're working in outside any quest. steps: how the approved plan stands, if there is one.
export type RunDoing = { expId: string; task: string; thread?: string; started: number; log: Line[]; steps?: { done: number; out: number; total: number } };

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
    const plan = exp.nodes.find((n) => n.kind === "plan");
    const states = plan?.kind === "plan" ? plan.steps.map((st) => stepState(st)) : null;
    return [{
      expId, task: exp.task, started: o.started, log: lastLines(mine), ...(exp.thread ? { thread: exp.thread } : {}),
      ...(states ? { steps: { done: states.filter((x) => x === "done").length, out: states.filter((x) => x === "out").length, total: states.length } } : {}),
    }];
  });
}
