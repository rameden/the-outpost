// Run context: which expedition and which quest a piece of work belongs to, carried
// automatically through async calls. That's what lets quests (and whole expeditions) run in
// parallel: each event and approval knows its expedition and quest, every agent in an
// expedition adds to one shared spending tally, one Stop cancels that expedition and its
// quests, and a scheduled job's "nobody is at the keyboard" mode stays with that job.

import { AsyncLocalStorage } from "node:async_hooks";

export type Ledger = { spent: number; budget?: number };
// Where an expedition works inside a linked repo: its own worktree and branch instead of the
// folder that was linked. Keyed by link name; the file tools and the shell follow it.
// ready: the camp has run the link's setup commands in this (new) worktree, so a follow-up doesn't run them again.
export type Workspace = { link: string; path: string; branch: string; base?: string; created?: boolean; ready?: boolean };
// Messages the user sends to an expedition while it runs. Every agent working in it sees them.
export type Steering = { messages: { text: string; at: number }[]; waiters: Set<() => void> };
// project: the project this run's conversation is filed under.
// scope: the linked folders this run may see and use (by name). Undefined means all of them (the
// terminal camp, and jobs that don't belong to a project); mission control always sets it.
type RunContext = { ledger: Ledger; expeditionId?: string; questId?: string; signal?: AbortSignal; unattended?: boolean;
  workspaces?: Record<string, Workspace>; steering?: Steering; project?: string; scope?: string[];
  without?: string[];   // folders the user left out of this conversation, or took out of it part-way
  model?: string };     // the model you picked for this conversation: whoever you're talking to answers on it (the quests they send keep their own)

const store = new AsyncLocalStorage<RunContext>();

export const currentExpeditionId = () => store.getStore()?.expeditionId;
export const currentQuestId = () => store.getStore()?.questId;
export const currentLedger = () => store.getStore()?.ledger;
export const currentSignal = () => store.getStore()?.signal;
export const isUnattended = () => store.getStore()?.unattended ?? false;
// One key per running agent: its quest, else its expedition. Used to tell quests apart when they touch the same file.
export const currentRunKey = () => store.getStore()?.questId ?? store.getStore()?.expeditionId ?? "solo";

export const currentWorkspaces = () => store.getStore()?.workspaces ?? {};
export const currentSteering = () => store.getStore()?.steering;
export const currentProjectId = () => store.getStore()?.project;
export const currentScope = () => store.getStore()?.scope;
export const inScope = (link: string) => { const s = store.getStore()?.scope; return !s || s.includes(link); };
// The folders the user left or took out of this conversation (so the crew can be told it was on purpose).
export const leftOutHere = () => store.getStore()?.without ?? [];
// The model picked for this conversation, for whoever it's with (not for the quests they send out).
export const conversationModel = () => store.getStore()?.model;

export type ExpeditionOpts = { id?: string; budget?: number; signal?: AbortSignal; unattended?: boolean;
  workspaces?: Record<string, Workspace>; steering?: Steering; project?: string; scope?: string[]; without?: string[]; model?: string };

export const newSteering = (): Steering => ({ messages: [], waiters: new Set() });
export function steer(s: Steering, text: string) {
  s.messages.push({ text, at: Date.now() });
  for (const wake of [...s.waiters]) wake();
}

// A new expedition: fresh tally, optional budget in dollars, stop signal, and unattended mode.
export function withExpedition<T>(opts: ExpeditionOpts, fn: () => Promise<T>): Promise<T> {
  return store.run({ ledger: { spent: 0, budget: opts.budget }, expeditionId: opts.id, signal: opts.signal, unattended: opts.unattended,
    workspaces: opts.workspaces, steering: opts.steering, project: opts.project, scope: opts.scope, without: opts.without, model: opts.model }, fn);
}

// A quest inside the current expedition (same tally, stop signal, and mode; its own id).
// lead: this quest is whoever you're talking to yourself (a direct chat), so the model you picked
// for the conversation is theirs. A quest the Quartermaster sends out isn't: it keeps its own model.
export function withQuest<T>(questId: string, fn: () => Promise<T>, lead = false): Promise<T> {
  const parent = store.getStore();
  return store.run({ ...parent, ledger: parent?.ledger ?? { spent: 0 }, questId, model: lead ? parent?.model : undefined }, fn);
}
