// Run context: which expedition and which quest a piece of work belongs to, carried
// automatically through async calls. That's what lets quests run in parallel: each event and
// approval knows its quest, every agent in an expedition adds to one shared spending tally,
// and one Stop cancels the whole expedition, quests included.

import { AsyncLocalStorage } from "node:async_hooks";

export type Ledger = { spent: number; budget?: number };
type RunContext = { ledger: Ledger; questId?: string; signal?: AbortSignal };

const store = new AsyncLocalStorage<RunContext>();

export const currentQuestId = () => store.getStore()?.questId;
export const currentLedger = () => store.getStore()?.ledger;
export const currentSignal = () => store.getStore()?.signal;

// A new expedition: fresh tally, optional budget in dollars, optional stop signal.
export function withExpedition<T>(budget: number | undefined, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return store.run({ ledger: { spent: 0, budget }, signal }, fn);
}

// A quest inside the current expedition (same tally and stop signal, its own id).
export function withQuest<T>(questId: string, fn: () => Promise<T>): Promise<T> {
  const parent = store.getStore();
  return store.run({ ledger: parent?.ledger ?? { spent: 0 }, questId, signal: parent?.signal }, fn);
}
