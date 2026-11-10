// The page's connection to the camp: the panels' state (/api/state) and the live event stream.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, eventsUrl } from "./api.ts";
import { ASK_NOTIFY_TITLES } from "./feed/asks.ts";
import type { FeedStore } from "./feed/store.ts";
import { spaced } from "./format.ts";
import { notify } from "./notifications.ts";
import type { CampEvent, CampState } from "./types.ts";

export type Connection = "connecting" | "live" | "reconnecting";

// Everything the side panels, the crew cards, and the header chips show. `refresh` reloads it
// (a moment later, so a burst of events means one request); `patch` changes it in place.
export function useCampState() {
  const [S, setS] = useState<CampState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setS(await api<CampState>("/api/state")); } catch (e) { console.warn(e); }
    }, 150);
  }, []);
  const patch = useCallback((fn: (s: CampState) => CampState) => setS((s) => (s ? fn(s) : s)), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { S, refresh, patch };
}

// One event from the stream: into the feed, plus what the feed itself doesn't do (pings, and
// reloading the panels when something they show has changed).
export function handleEvent(store: FeedStore, e: CampEvent, opts: { replaying: boolean; refresh: () => void }) {
  const before = store.getState();
  if (!store.apply(e)) return;
  if (e.type === "ask" && !opts.replaying) notify(`Satchel: ${ASK_NOTIFY_TITLES[e.kind] ?? "Decision needed"}`, e.body);
  if (e.type === "expedition_end") {
    const started = before.open[e.id]?.started;
    if (started && Date.now() - started > 60_000 && !opts.replaying) notify(`Satchel: expedition ${e.status === "done" ? "finished" : spaced(e.status)}`, e.text);
  }
  // "changed" includes the queue: something started, finished, or was stopped.
  if (e.type === "expedition_end" || e.type === "job" || e.type === "changed") opts.refresh();
}

// The live stream. The server replays its saved feed after every (re)connect; events already
// applied are skipped by number. A different bootId means the camp restarted: start over.
export function useCampEvents(store: FeedStore, refresh: () => void): Connection {
  const [conn, setConn] = useState<Connection>("connecting");
  useEffect(() => {
    let bootId: string | null = null;
    let replaying = true; // the saved feed arrives right after hello; only new questions should ping
    let settle: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource(eventsUrl());
    es.addEventListener("hello", (m) => {
      const hello = JSON.parse((m as MessageEvent).data) as { bootId: string };
      if (bootId && hello.bootId !== bootId) store.reset();
      bootId = hello.bootId;
      setConn("live");
      replaying = true;
      clearTimeout(settle);
      settle = setTimeout(() => { replaying = false; }, 1500);
      refresh();
    });
    es.onmessage = (m) => handleEvent(store, JSON.parse(m.data) as CampEvent, { replaying, refresh });
    es.onerror = () => setConn("reconnecting");
    return () => { es.close(); clearTimeout(settle); };
  }, [store, refresh]);
  return conn;
}
