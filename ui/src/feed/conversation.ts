// One conversation's view of the feed.
//
// The live feed holds what's running and what the camp server still has in memory. An older
// conversation's runs are read back from the camp's saved feed and turned into the same cards
// by the same reducer, so a conversation looks the same whether it happened a minute or a month ago.

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { CampEvent } from "../types.ts";
import { applyEvent, emptyFeed, type ExpNode, type FeedNode, type FeedState } from "./reducer.ts";

// What the middle of the page shows: everything, a blank page for a new conversation (optionally
// filed under a project), one conversation, one project's page, or all your projects.
export type View = { kind: "all" } | { kind: "new"; project?: string } | { kind: "conversation"; id: string }
  | { kind: "project"; id: string } | { kind: "projects" };

export function parseView(saved: string | null): View {
  try {
    const v = JSON.parse(saved ?? "") as View;
    if (v?.kind === "all") return { kind: "all" };
    if (v?.kind === "projects") return { kind: "projects" };
    if ((v?.kind === "conversation" || v?.kind === "project") && typeof v.id === "string") return { kind: v.kind, id: v.id };
  } catch { /* nothing saved */ }
  return { kind: "new" };
}

// Saved events → feed cards. They're renumbered far above the live feed's numbers, so a card
// read back from history never shares an id with a live one.
export function cardsFrom(events: CampEvent[]): FeedNode[] {
  return events.reduce((s, e, i) => applyEvent(s, { ...e, seq: 1_000_000_000 + i }), emptyFeed).items;
}

// A conversation's earlier runs, read back from the camp (empty until they arrive).
export function usePast(thread: string | null): FeedNode[] {
  const [past, setPast] = useState<{ thread: string; items: FeedNode[] } | null>(null);
  useEffect(() => {
    if (!thread) return;
    let current = true;
    api<{ events: CampEvent[] }>(`/api/conversation?id=${encodeURIComponent(thread)}`)
      .then((r) => { if (current) setPast({ thread, items: cardsFrom(r.events) }); })
      .catch(() => { if (current) setPast({ thread, items: [] }); });
    return () => { current = false; };
  }, [thread]);
  return past && past.thread === thread ? past.items : NONE;
}
const NONE: FeedNode[] = [];

const isRun = (n: FeedNode): n is ExpNode => n.kind === "exp";

// The cards to show: a conversation's earlier runs from history, then whatever of it is in the
// live feed (a run that's in both is shown live, since that copy keeps updating).
export function cardsFor(view: View, live: FeedNode[], past: FeedNode[]): FeedNode[] {
  if (view.kind === "all") return live;
  if (view.kind !== "conversation") return NONE;
  const mine = live.filter((n) => isRun(n) && n.thread === view.id);
  const have = new Set(mine.map((n) => (n as ExpNode).expId));
  return [...past.filter((n) => isRun(n) && !have.has(n.expId)), ...mine];
}

// The newest run of a conversation that's in the live feed (what a reply should follow).
export function latestLiveRun(live: FeedNode[], thread: string): string | undefined {
  for (let i = live.length - 1; i >= 0; i--) {
    const n = live[i];
    if (isRun(n) && n.thread === thread) return n.expId;
  }
  return undefined;
}

// What's happening in each conversation right now, for the sidebar: is something running in it,
// and how many decisions are waiting on you.
export type Activity = Record<string, { running: boolean; needs: number }>;
let memo: { items: FeedNode[]; asks: FeedState["asks"]; out: Activity } | null = null;
export function activityOf(s: FeedState): Activity {
  if (memo && memo.items === s.items && memo.asks === s.asks) return memo.out;
  const out: Activity = {};
  const threadOf = new Map<string, string>();
  for (const n of s.items) {
    if (!isRun(n) || !n.thread) continue;
    threadOf.set(n.expId, n.thread);
    if (!n.end) (out[n.thread] ??= { running: false, needs: 0 }).running = true;
  }
  for (const a of s.asks) {
    const thread = a.expId ? threadOf.get(a.expId) : undefined;
    if (thread) (out[thread] ??= { running: false, needs: 0 }).needs++;
  }
  memo = { items: s.items, asks: s.asks, out };
  return out;
}
