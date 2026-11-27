// Holds the feed outside React, so events can arrive word by word without re-rendering the
// whole page: components subscribe to just the part they show.

import { useSyncExternalStore } from "react";
import type { CampEvent } from "../types.ts";
import { addSysLine, applyEvent, emptyFeed, liveKey, type FeedState } from "./reducer.ts";

export type FeedStore = ReturnType<typeof createFeedStore>;
// you: what you said to them, when you messaged them yourself (on the run's first event).
export type RunEvent = { event: CampEvent; briefed: boolean; you?: string };

export function createFeedStore() {
  let state = emptyFeed;
  let lastSource: string | null = null; // how the latest expedition started ("direct": you messaged an agent yourself)
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: CampEvent) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Each run that's out now, by quest (two quests by the same crew member stay apart), so a
  // crew member's page can show their work even when it's opened partway through. A run is
  // dropped when it returns or its expedition ends.
  const running = new Map<string, RunEvent[]>();
  const starts = new Map<string, { source: string; task: string }>(); // expeditions out now: how each started
  const track = (e: CampEvent) => {
    if (e.type === "expedition_start") { starts.set(e.id, { source: e.source, task: e.task }); return; }
    if (e.type === "expedition_end") {
      const id = e.expeditionId ?? e.id;
      starts.delete(id);
      for (const key of running.keys()) if (key.startsWith(`${id}|`)) running.delete(key);
      return;
    }
    if (!("who" in e) || typeof e.who !== "string") return;
    const key = liveKey(e);
    if (e.type === "return") { running.delete(key); return; }
    if (e.type !== "dispatch" && e.type !== "text_delta" && e.type !== "text" && e.type !== "tool") return;
    const start = e.expeditionId ? starts.get(e.expeditionId) : undefined;
    const direct = (start?.source ?? lastSource) === "direct";
    if (e.type === "dispatch") {
      // You messaged them yourself: your message opens the run ("@comms what's new?" → "what's new?").
      const you = direct && start ? start.task.replace(/^@\S+\s*/, "") : undefined;
      running.set(key, [{ event: e, briefed: !direct, ...(you ? { you } : {}) }]);
      return;
    }
    const list = running.get(key) ?? [];
    if (list.length < 5000) list.push({ event: e, briefed: !direct });
    running.set(key, list);
  };

  // Streaming sends many events a second; tell React at most once per frame or so.
  const changed = () => {
    timer ??= setTimeout(() => { timer = null; for (const l of listeners) l(); }, 16);
  };

  return {
    getState: () => state,
    lastSource: () => lastSource,
    // What this crew member has done so far on the run they're on now (empty when they're idle).
    // Several at once come one after another, in the order they started.
    runSoFar: (who: string): readonly RunEvent[] =>
      [...running.values()].filter((l) => "who" in l[0].event && l[0].event.who === who).sort((x, y) => x[0].event.seq - y[0].event.seq).flat(),
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    // Every new event as it arrives (the agent page shows its agent's work live from these).
    onEvent(l: (e: CampEvent) => void) { eventListeners.add(l); return () => { eventListeners.delete(l); }; },
    // Returns false for an event that was already applied (the feed replays on reconnect).
    apply(e: CampEvent): boolean {
      const next = applyEvent(state, e);
      if (next === state) return false;
      state = next;
      if (e.type === "expedition_start") lastSource = e.source;
      track(e);
      for (const l of eventListeners) l(e);
      changed();
      return true;
    },
    addSys(text: string) { state = addSysLine(state, text); changed(); },
    reset() { state = emptyFeed; running.clear(); starts.clear(); changed(); }, // the camp restarted: start the feed over
  };
}

export function useFeed<T>(store: FeedStore, select: (s: FeedState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
