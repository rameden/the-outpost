// Holds the feed outside React, so events can arrive word by word without re-rendering the
// whole page: components subscribe to just the part they show.

import { useSyncExternalStore } from "react";
import type { CampEvent } from "../types.ts";
import { addSysLine, applyEvent, emptyFeed, type FeedState } from "./reducer.ts";

export type FeedStore = ReturnType<typeof createFeedStore>;

export function createFeedStore() {
  let state = emptyFeed;
  let lastSource: string | null = null; // how the latest expedition started ("direct": you messaged an agent yourself)
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: CampEvent) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Streaming sends many events a second; tell React at most once per frame or so.
  const changed = () => {
    timer ??= setTimeout(() => { timer = null; for (const l of listeners) l(); }, 16);
  };

  return {
    getState: () => state,
    lastSource: () => lastSource,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    // Every new event as it arrives (the agent page shows its agent's work live from these).
    onEvent(l: (e: CampEvent) => void) { eventListeners.add(l); return () => { eventListeners.delete(l); }; },
    // Returns false for an event that was already applied (the feed replays on reconnect).
    apply(e: CampEvent): boolean {
      const next = applyEvent(state, e);
      if (next === state) return false;
      state = next;
      if (e.type === "expedition_start") lastSource = e.source;
      for (const l of eventListeners) l(e);
      changed();
      return true;
    },
    addSys(text: string) { state = addSysLine(state, text); changed(); },
    reset() { state = emptyFeed; changed(); }, // the camp restarted: start the feed over
  };
}

export function useFeed<T>(store: FeedStore, select: (s: FeedState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
