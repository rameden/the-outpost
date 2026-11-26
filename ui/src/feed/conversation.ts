// One conversation's view of the feed.
//
// The live feed holds what's running and what the camp server still has in memory. An older
// conversation's runs are read back from the camp's saved feed and turned into the same cards
// by the same reducer, so a conversation looks the same whether it happened a minute or a month ago.

import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { CampEvent } from "../types.ts";
import { applyEvent, emptyFeed, type ExpNode, type FeedNode, type FeedState } from "./reducer.ts";

// What the middle of the page shows: Today (your brief, and where things stand), everything, a
// blank page for a new conversation (optionally filed under a project), one conversation, one
// project's page, or all your projects.
export type View = { kind: "home" } | { kind: "all" } | { kind: "new"; project?: string } | { kind: "conversation"; id: string }
  | { kind: "project"; id: string } | { kind: "projects" } | { kind: "tickets" } | { kind: "releases" }
  | { kind: "memory"; tab?: MemoryTab; member?: string; page?: string } // Memory: the list, the map, or one member's; a wiki page being read
  | { kind: "activity"; tab?: ActivityTab }; // Activity: usage, stats, scheduled jobs, inbox
export const MEMORY_TABS = ["list", "map", "member"] as const;
export type MemoryTab = (typeof MEMORY_TABS)[number];
export const ACTIVITY_TABS = ["usage", "stats", "unasked", "jobs", "inbox"] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

// Where a message sent from Today starts: the project you last worked in (the latest
// conversation's), or outside any project if that was General or there's nothing yet.
export function homeProject(history: { conversations: { project: string }[] } | undefined): string | undefined {
  const last = history?.conversations[0]?.project; // they're newest first
  return last && last !== "general" ? last : undefined;
}

export function parseView(saved: string | null): View {
  try {
    const v = JSON.parse(saved ?? "") as View;
    if (v?.kind === "all") return { kind: "all" };
    if (v?.kind === "new") return { kind: "new" };
    if (v?.kind === "home") return { kind: "home" };
    if (v?.kind === "projects") return { kind: "projects" };
    if (v?.kind === "releases") return { kind: "releases" };
    if (v?.kind === "tickets" || (v?.kind as string) === "jira") return { kind: "tickets" }; // "jira": the page before it held Mae's tickets too
    if ((v?.kind as string) === "wiki" || v?.kind === "memory") { // "wiki": the page before Memory held the wiki alone
      const m = v as { tab?: unknown; member?: unknown; page?: unknown };
      return { kind: "memory", ...(MEMORY_TABS.includes(m.tab as MemoryTab) ? { tab: m.tab as MemoryTab } : {}), ...(typeof m.member === "string" ? { member: m.member } : {}), ...(typeof m.page === "string" ? { page: m.page } : {}) };
    }
    if (v?.kind === "activity") return { kind: "activity", ...(ACTIVITY_TABS.includes(v.tab as ActivityTab) ? { tab: v.tab as ActivityTab } : {}) };
    if ((v?.kind === "conversation" || v?.kind === "project") && typeof v.id === "string") return { kind: v.kind, id: v.id };
  } catch { /* nothing saved */ }
  return { kind: "home" }; // the page the camp opens on
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
//
// The feed changes many times a second while an answer is being written, and almost none of
// those changes touch this. So when the answer comes out the same as last time, the very same
// object is handed back: whatever reads it (the whole page does) isn't drawn again for nothing.
export type Activity = Record<string, { running: boolean; needs: number }>;
let memo: { items: FeedNode[]; asks: FeedState["asks"]; out: Activity } | null = null;
function sameActivity(a: Activity, b: Activity): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => !!b[k] && a[k].running === b[k].running && a[k].needs === b[k].needs);
}
export function activityOf(s: FeedState): Activity {
  if (memo && memo.items === s.items && memo.asks === s.asks) return memo.out;
  let out: Activity = {};
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
  if (memo && sameActivity(memo.out, out)) out = memo.out;
  memo = { items: s.items, asks: s.asks, out };
  return out;
}
