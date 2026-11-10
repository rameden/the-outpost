// Run context: which expedition and which quest a piece of work belongs to, carried
// automatically through async calls. That's what lets quests (and whole expeditions) run in
// parallel: each event and approval knows its expedition and quest, every agent in an
// expedition adds to one shared spending tally, one Stop cancels that expedition and its
// quests, and a scheduled job's "nobody is at the keyboard" mode stays with that job.

import { AsyncLocalStorage } from "node:async_hooks";

export type Ledger = { spent: number; budget?: number };
type RunContext = { ledger: Ledger; expeditionId?: string; questId?: string; signal?: AbortSignal; unattended?: boolean };

const store = new AsyncLocalStorage<RunContext>();

export const currentExpeditionId = () => store.getStore()?.expeditionId;
export const currentQuestId = () => store.getStore()?.questId;
export const currentLedger = () => store.getStore()?.ledger;
export const currentSignal = () => store.getStore()?.signal;
export const isUnattended = () => store.getStore()?.unattended ?? false;
// One key per running agent: its quest, else its expedition. Used to tell quests apart when they touch the same file.
export const currentRunKey = () => store.getStore()?.questId ?? store.getStore()?.expeditionId ?? "solo";

export type ExpeditionOpts = { id?: string; budget?: number; signal?: AbortSignal; unattended?: boolean };

// A new expedition: fresh tally, optional budget in dollars, stop signal, and unattended mode.
export function withExpedition<T>(opts: ExpeditionOpts, fn: () => Promise<T>): Promise<T> {
  return store.run({ ledger: { spent: 0, budget: opts.budget }, expeditionId: opts.id, signal: opts.signal, unattended: opts.unattended }, fn);
}

// A quest inside the current expedition (same tally, stop signal, and mode; its own id).
export function withQuest<T>(questId: string, fn: () => Promise<T>): Promise<T> {
  const parent = store.getStore();
  return store.run({ ...parent, ledger: parent?.ledger ?? { spent: 0 }, questId }, fn);
}
