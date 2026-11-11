// The live feed, as a pure function of the camp's events: (feed so far, next event) → feed.
//
// Several expeditions run at once, so nothing here assumes "the current one". Each event names
// its expedition (expeditionId) and, inside it, its quest (questId), and lands in that card.
// The same events also say what each crew member is doing, and which approvals are waiting.
//
// It never changes the state it's given, so React can skip every card an event didn't touch.

import type { AskKind, Attached, CampEvent, EventOf, Workspaces } from "../types.ts";
import { askOutcome } from "./asks.ts";

export type CrewStatus = { status: "idle" | "active" | "waiting"; line: string };

export type MsgNode = { kind: "msg"; id: string; who: string; emoji: string; text: string; streaming: boolean };
export type ToolNode = { kind: "tool"; id: string; who: string; tool: string; input: string };
// A file the crew wrote whole: a card that opens it. It takes the place of the write_file line it came from.
export type FileNode = { kind: "file"; id: string; who: string; path: string; change: "created" | "updated"; bytes: number };
export type NoticeNode = { kind: "notice"; id: string; text: string };
export type SysNode = { kind: "sys"; id: string; text: string };
export type SteerNode = { kind: "steer"; id: string; text: string }; // what you said to it while it worked
// listed: an approved plan whose steps are shown as the live list under it (so the card itself folds its text away).
export type AskNode = { kind: "ask"; id: string; askId: string; askKind: AskKind; title: string; body: string; who: string; outcome: string | null; listed?: boolean };
// The plan you approved, as a list that fills in: each numbered step, and the quests carrying it out.
// ended: how the run finished, once it has (a step still out then was cut short).
export type PlanQuest = { node: string; who: string; emoji: string; status: string | null };
export type PlanStep = { n: number; text: string; quests: PlanQuest[] };
export type PlanNode = { kind: "plan"; id: string; steps: PlanStep[]; ended?: string };
export type StepState = "todo" | "out" | "done" | "failed" | "stopped";
// How a step stands. With no quest of its own it's the Quartermaster's to do: done when the run finishes well.
export function stepState(step: PlanStep, ended?: string): StepState {
  if (!step.quests.length) return ended === "done" ? "done" : ended ? "stopped" : "todo";
  if (step.quests.some((q) => q.status === null)) return ended ? "stopped" : "out";
  return step.quests.every((q) => q.status === "done") ? "done" : "failed";
}
// status null: still out. brief: the quest in a line. started: when it set out.
export type QuestNode = { kind: "quest"; id: string; who: string; emoji: string; status: string | null; nodes: FeedNode[]; brief?: string; started?: string; step?: number };
// A quest that's out right now: whose it is, what it's for, and what it's doing this moment. Two
// quests by the same crew member are two of these, which the crew's own status (one per member) can't show.
export type QuestOut = { id: string; expId: string; node: string; who: string; emoji: string; brief: string; started: number; line: string; waiting: boolean; step?: number };
export type ExpNode = {
  kind: "exp"; id: string; expId: string; task: string; source: "user" | "direct" | "job"; job?: string; followUp: boolean;
  thread?: string; // the conversation it belongs to (jobs have none)
  attachments: Attached[]; time: string; nodes: FeedNode[];
  end: { status: string; seconds: number; changed: number; workspaces: Workspaces } | null; // null: still running
  feedback?: { rating: "up" | "down"; note?: string; kept?: string }; // what you said about it once it finished
};
export type FeedNode = MsgNode | ToolNode | FileNode | PlanNode | NoticeNode | SysNode | SteerNode | AskNode | QuestNode | ExpNode;

// A running expedition: where its card is, its quests by id, and who is working in it.
type OpenExpedition = { node: string; started: number; members: string[]; quests: Record<string, { node: string; who: string }>; plan?: string };
export type OpenAsk = { id: string; node: string; who: string; expId?: string; questId?: string };

export type FeedState = {
  lastSeq: number;                        // events at or below this were already applied (replay after a reconnect)
  items: FeedNode[];                      // the feed, top to bottom
  open: Record<string, OpenExpedition>;   // running expeditions by id
  live: Record<string, string>;           // replies streaming in right now: expedition + quest (or + "top:<who>") → message
  asks: OpenAsk[];                        // approvals waiting for you, oldest first
  crew: Record<string, CrewStatus>;       // by name
  quests: QuestOut[];                     // every quest that's out right now, in the order they set out
  localSeq: number;                       // for lines the page adds itself ("Queued (#2)…")
};

export const emptyFeed: FeedState = { lastSeq: 0, items: [], open: {}, live: {}, asks: [], crew: {}, quests: [], localSeq: 0 };

export const liveKey = (e: { expeditionId?: string; questId?: string; who: string }) => `${e.expeditionId ?? ""}|${e.questId || `top:${e.who}`}`;
export const runningCount = (s: FeedState) => Object.keys(s.open).length;

// ---------- Building the next state ----------

function isBranch(n: FeedNode): n is ExpNode | QuestNode { return n.kind === "exp" || n.kind === "quest"; }

// A copy of `nodes` with the node called `id` replaced (wherever it sits); only the path down
// to it is copied. Returns `nodes` itself when there's no such node.
function replaceNode(nodes: FeedNode[], id: string, fn: (n: FeedNode) => FeedNode): FeedNode[] {
  const at = nodes.findLastIndex((n) => n.id === id);
  if (at >= 0) return nodes.with(at, fn(nodes[at]));
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!isBranch(n)) continue;
    const inner = replaceNode(n.nodes, id, fn);
    if (inner !== n.nodes) return nodes.with(i, { ...n, nodes: inner });
  }
  return nodes;
}

const appendTo = (id: string, child: FeedNode) => (nodes: FeedNode[]) =>
  replaceNode(nodes, id, (n) => (isBranch(n) ? { ...n, nodes: [...n.nodes, child] } : n));

// Put a node where it belongs: in its quest, else in its expedition, else at the end of the feed
// (an event for an expedition that already ended, or whose start fell out of the replay buffer).
function place(s: FeedState, node: FeedNode, questId?: string, expeditionId?: string) {
  const exp = expeditionId ? s.open[expeditionId] : undefined;
  if (!exp) { s.items = [...s.items, node]; return; }
  const quest = questId ? exp.quests[questId] : undefined;
  s.items = appendTo(quest?.node ?? exp.node, node)(s.items);
}

// The card for a written file goes where its write_file line was (the newest of that crew member's
// that names it), so it reads as what that call made; failing that, at the end, like anything else.
function addFile(s: FeedState, e: EventOf<"file">) {
  const node: FileNode = { kind: "file", id: `f${e.seq}`, who: e.who, path: e.path, change: e.change, bytes: e.bytes };
  const exp = e.expeditionId ? s.open[e.expeditionId] : undefined;
  const home = exp && ((e.questId ? exp.quests[e.questId]?.node : undefined) ?? exp.node);
  const name = JSON.stringify(e.path.split("/").pop()).slice(1, -1);
  const itsCall = (n: FeedNode) => n.kind === "tool" && n.tool === "write_file" && n.who === e.who && n.input.includes(name);
  if (home) {
    let swapped = false;
    s.items = replaceNode(s.items, home, (h) => {
      if (!isBranch(h)) return h;
      const at = h.nodes.findLastIndex(itsCall);
      if (at < 0) return h;
      swapped = true;
      return { ...h, nodes: h.nodes.with(at, node) };
    });
    if (swapped) return;
  }
  place(s, node, e.questId, e.expeditionId);
}

function setCrew(s: FeedState, name: string, status: CrewStatus["status"], line?: string) {
  s.crew = { ...s.crew, [name]: { status, line: line ?? s.crew[name]?.line ?? "" } };
}

// What a quest that's out is doing now (or that it's waiting on you).
function touchQuest(s: FeedState, e: { expeditionId?: string; questId?: string }, change: Partial<Pick<QuestOut, "line" | "waiting">>) {
  if (!e.questId || !s.quests.some((q) => q.id === e.questId && q.expId === e.expeditionId)) return;
  s.quests = s.quests.map((q) => (q.id === e.questId && q.expId === e.expeditionId ? { ...q, ...change } : q));
}
const snippet = (text: string) => text.replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

// A reply cut off mid-stream (Stop, budget, error) never gets its final text: close it out as it is.
function finishLive(s: FeedState, match: (key: string) => boolean) {
  const keys = Object.keys(s.live).filter(match);
  if (!keys.length) return;
  const live = { ...s.live };
  for (const key of keys) {
    s.items = replaceNode(s.items, live[key], (n) => (n.kind === "msg" ? { ...n, streaming: false } : n));
    delete live[key];
  }
  s.live = live;
}

function startExpedition(s: FeedState, e: EventOf<"expedition_start">) {
  const node: ExpNode = {
    kind: "exp", id: `x${e.seq}`, expId: e.id, task: e.task, source: e.source, job: e.job, followUp: !!e.replyTo, thread: e.thread,
    attachments: e.attachments ?? [], time: e.time, nodes: [], end: null,
  };
  s.items = [...s.items, node];
  s.open = { ...s.open, [e.id]: { node: node.id, started: new Date(e.time).getTime(), members: e.source === "direct" ? [] : ["Quartermaster"], quests: {} } };
  if (e.source !== "direct") setCrew(s, "Quartermaster", "active", "Planning the expedition");
}

function endExpedition(s: FeedState, e: EventOf<"expedition_end">) {
  const exp = s.open[e.id];
  if (!exp) return;
  const seconds = Math.max(1, Math.round((new Date(e.time).getTime() - exp.started) / 1000));
  const failed = e.status === "error" || e.status === "interrupted";
  s.items = replaceNode(s.items, exp.node, (n) => n.kind !== "exp" ? n : {
    ...n,
    nodes: failed ? [...n.nodes, { kind: "notice", id: `n${e.seq}`, text: e.text }] : n.nodes,
    end: { status: e.status, seconds, changed: e.changed ?? 0, workspaces: e.workspaces ?? [] },
  });
  if (exp.plan) s.items = replaceNode(s.items, exp.plan, (n) => (n.kind === "plan" ? { ...n, ended: e.status } : n));
  const { [e.id]: _ended, ...stillOpen } = s.open;
  s.open = stillOpen;
  if (s.quests.some((q) => q.expId === e.id)) s.quests = s.quests.filter((q) => q.expId !== e.id); // stopped mid-quest: nobody's out any more
  finishLive(s, (key) => key.startsWith(`${e.id}|`));
  // Crew who worked here go back to camp, unless they're still busy in another expedition.
  const elsewhere = new Set(Object.values(s.open).flatMap((o) => o.members));
  const crew = { ...s.crew };
  for (const name of exp.members) if (!elsewhere.has(name) && crew[name] && crew[name].status !== "idle") crew[name] = { ...crew[name], status: "idle" };
  s.crew = crew;
}

function addDelta(s: FeedState, e: EventOf<"text_delta">) {
  const key = liveKey(e);
  const id = s.live[key];
  if (id) {
    s.items = replaceNode(s.items, id, (n) => (n.kind === "msg" ? { ...n, text: n.text + e.delta } : n));
  } else {
    const node: MsgNode = { kind: "msg", id: `m${e.seq}`, who: e.who, emoji: e.emoji, text: e.delta, streaming: true };
    place(s, node, e.questId, e.expeditionId);
    s.live = { ...s.live, [key]: node.id };
    touchQuest(s, e, { line: "Writing…" });
  }
  if (s.crew[e.who]?.status !== "active") setCrew(s, e.who, "active", "Writing…");
}

// The finished reply: it replaces what streamed in (or arrives whole, on replay).
function addText(s: FeedState, e: EventOf<"text">) {
  const key = liveKey(e);
  const id = s.live[key];
  if (id) {
    s.items = replaceNode(s.items, id, (n) => (n.kind === "msg" ? { ...n, text: e.text, streaming: false } : n));
    const { [key]: _done, ...live } = s.live;
    s.live = live;
  } else {
    place(s, { kind: "msg", id: `m${e.seq}`, who: e.who, emoji: e.emoji, text: e.text, streaming: false }, e.questId, e.expeditionId);
  }
  setCrew(s, e.who, "active", snippet(e.text));
  touchQuest(s, e, { line: snippet(e.text) });
}

function addDispatch(s: FeedState, e: EventOf<"dispatch">) {
  const exp = e.expeditionId ? s.open[e.expeditionId] : undefined;
  if (exp && e.expeditionId) {
    const node: QuestNode = { kind: "quest", id: `q${e.seq}`, who: e.who, emoji: e.emoji, status: null, nodes: [], ...(e.brief ? { brief: e.brief } : {}), started: e.time, ...(e.step ? { step: e.step } : {}) };
    // It's carrying out a step of the plan: the plan's list shows it against that step.
    if (e.step && exp.plan) {
      s.items = replaceNode(s.items, exp.plan, (n) => n.kind !== "plan" ? n
        : { ...n, steps: n.steps.map((st) => (st.n === e.step ? { ...st, quests: [...st.quests, { node: node.id, who: e.who, emoji: e.emoji, status: null }] } : st)) });
    }
    s.items = appendTo(exp.node, node)(s.items); // quests sit side by side in the expedition, never inside each other
    const questId = e.questId ?? `q${Object.keys(exp.quests).length}`;
    s.quests = [...s.quests, { id: questId, expId: e.expeditionId, node: node.id, who: e.who, emoji: e.emoji, brief: e.brief ?? "", started: new Date(e.time).getTime(), line: "Setting out", waiting: false, ...(e.step ? { step: e.step } : {}) }];
    s.open = { ...s.open, [e.expeditionId]: { ...exp, quests: { ...exp.quests, [questId]: { node: node.id, who: e.who } } } };
  }
  setCrew(s, e.who, "active", "Setting out");
}

function addReturn(s: FeedState, e: EventOf<"return">) {
  const key = liveKey(e);
  finishLive(s, (k) => k === key);
  const quest = e.expeditionId && e.questId ? s.open[e.expeditionId]?.quests[e.questId] : undefined;
  if (quest) s.items = replaceNode(s.items, quest.node, (n) => (n.kind === "quest" ? { ...n, status: e.status } : n));
  const plan = quest && e.expeditionId ? s.open[e.expeditionId]?.plan : undefined;
  if (quest && plan) {
    s.items = replaceNode(s.items, plan, (n) => n.kind !== "plan" ? n
      : { ...n, steps: n.steps.map((st) => (st.quests.some((q) => q.node === quest.node) ? { ...st, quests: st.quests.map((q) => (q.node === quest.node ? { ...q, status: e.status } : q)) } : st)) });
  }
  if (e.questId) s.quests = s.quests.filter((q) => !(q.id === e.questId && q.expId === e.expeditionId));
  // Back from this one, but still out on another: they aren't at camp yet.
  const still = s.quests.find((q) => q.who === e.who);
  if (still) return setCrew(s, e.who, still.waiting ? "waiting" : "active", still.line);
  setCrew(s, e.who, "idle", e.status === "done" ? "Returned with a report" : `Returned (${e.status.replace(/_/g, " ")})`);
}

// The plan stands: its steps become a list in the run, right where the approved plan's card is.
// A plan submitted again (after changes) replaces the list, keeping the quests already sent against their steps.
function addPlan(s: FeedState, e: EventOf<"plan">) {
  const exp = e.expeditionId ? s.open[e.expeditionId] : undefined;
  if (!exp || !e.expeditionId) return;
  let before: PlanStep[] = [];
  s.items = replaceNode(s.items, exp.node, (x) => {
    if (x.kind !== "exp") return x;
    const old = x.nodes.find((n): n is PlanNode => n.kind === "plan");
    before = old?.steps ?? [];
    const node: PlanNode = { kind: "plan", id: `p${e.seq}`, steps: e.steps.map((st) => ({ n: st.n, text: st.text, quests: before.find((b) => b.n === st.n)?.quests ?? [] })) };
    // The card it was approved on folds its text away: the list says it now. (The newest approved plan card.)
    const card = x.nodes.findLastIndex((n) => n.kind === "ask" && n.askKind === "plan" && n.outcome !== null);
    const approved = card >= 0 ? x.nodes[card] : null;
    const nodes = x.nodes.filter((n) => n.kind !== "plan").map((n) => (n === approved && n.kind === "ask" ? { ...n, listed: true } : n));
    return { ...x, nodes: [...nodes, node] };
  });
  s.open = { ...s.open, [e.expeditionId]: { ...s.open[e.expeditionId], plan: `p${e.seq}` } };
}

function addAsk(s: FeedState, e: EventOf<"ask">) {
  // Whoever is asking: the Quartermaster for plans and jobs, otherwise the quest's adventurer.
  const questOwner = e.expeditionId && e.questId ? s.open[e.expeditionId]?.quests[e.questId]?.who : undefined;
  const who = e.kind === "plan" || e.kind === "job" ? "Quartermaster" : questOwner ?? "Quartermaster";
  const node: AskNode = { kind: "ask", id: `a${e.seq}`, askId: e.id, askKind: e.kind, title: e.title, body: e.body, who, outcome: null };
  place(s, node, e.questId, e.expeditionId);
  s.asks = [...s.asks, { id: e.id, node: node.id, who, expId: e.expeditionId, questId: e.questId }];
  setCrew(s, who, "waiting");
  touchQuest(s, e, { waiting: true });
}

function resolveAsk(s: FeedState, e: EventOf<"answered">) {
  const ask = s.asks.find((a) => a.id === e.id);
  if (!ask) return;
  s.items = replaceNode(s.items, ask.node, (n) => (n.kind === "ask" ? { ...n, outcome: askOutcome(n.askKind, e.answer, e.lapsed) } : n));
  s.asks = s.asks.filter((a) => a.id !== e.id);
  setCrew(s, ask.who, "active");
  // Still waiting only if another of its questions is open.
  if (!s.asks.some((a) => a.questId === ask.questId && a.expId === ask.expId)) touchQuest(s, { expeditionId: ask.expId, questId: ask.questId }, { waiting: false });
}

const JOB_LINES = {
  running: (e: EventOf<"job">) => `⏰ Scheduled job "${e.name}" is running`,
  quiet: (e: EventOf<"job">) => `🤫 "${e.name}" found nothing new`,
  reported: (e: EventOf<"job">) => `📨 "${e.name}" left a report in the inbox`,
  failed: (e: EventOf<"job">) => `💥 "${e.name}" failed: ${e.text ?? ""}`,
};

export function applyEvent(state: FeedState, e: CampEvent): FeedState {
  if (e.seq <= state.lastSeq) return state; // already seen (the feed is replayed on every reconnect)
  const s: FeedState = { ...state, lastSeq: e.seq };

  if ("who" in e && e.expeditionId && s.open[e.expeditionId] && !s.open[e.expeditionId].members.includes(e.who)) {
    const exp = s.open[e.expeditionId];
    s.open = { ...s.open, [e.expeditionId]: { ...exp, members: [...exp.members, e.who] } };
  }

  switch (e.type) {
    case "expedition_start": startExpedition(s, e); break;
    case "expedition_end": endExpedition(s, e); break;
    case "text_delta": addDelta(s, e); break;
    case "text": addText(s, e); break;
    case "tool":
      finishLive(s, (k) => k === liveKey(e)); // the next words after a tool call start a new message
      place(s, { kind: "tool", id: `t${e.seq}`, who: e.who, tool: e.tool, input: e.input }, e.questId, e.expeditionId);
      setCrew(s, e.who, "active", `Using ${e.tool}`);
      touchQuest(s, e, { line: `Using ${e.tool}` });
      break;
    case "file": addFile(s, e); break;
    case "notice": place(s, { kind: "notice", id: `n${e.seq}`, text: e.text }, e.questId, e.expeditionId); break;
    case "dispatch": addDispatch(s, e); break;
    case "plan": addPlan(s, e); break;
    case "return": addReturn(s, e); break;
    case "ask": addAsk(s, e); break;
    case "answered": resolveAsk(s, e); break;
    case "steer": place(s, { kind: "steer", id: `s${e.seq}`, text: e.text }, undefined, e.id); break;
    case "feedback": {
      // On a finished run, so it's found by its expedition id rather than among the open ones.
      const at = s.items.findLastIndex((n) => n.kind === "exp" && n.expId === e.id);
      if (at >= 0) s.items = s.items.with(at, { ...(s.items[at] as ExpNode), feedback: { rating: e.rating, note: e.note, kept: e.kept } });
      break;
    }
    case "job": s.items = [...s.items, { kind: "sys", id: `j${e.seq}`, text: JOB_LINES[e.outcome](e) }]; break;
    case "changed": break; // "refresh the panels": nothing for the feed
  }
  return s;
}

// A line the page adds on its own, like "Queued (#2)…" after you send a request.
export function addSysLine(state: FeedState, text: string): FeedState {
  const localSeq = state.localSeq + 1;
  return { ...state, localSeq, items: [...state.items, { kind: "sys", id: `local${localSeq}`, text }] };
}

// Every ask node in the feed, in order (for tests and for finding a card on screen).
export function findNodes<K extends FeedNode["kind"]>(nodes: FeedNode[], kind: K): Extract<FeedNode, { kind: K }>[] {
  return nodes.flatMap((n) => [
    ...(n.kind === kind ? [n as Extract<FeedNode, { kind: K }>] : []),
    ...(isBranch(n) ? findNodes(n.nodes, kind) : []),
  ]);
}
