// The page's connection to the camp: the panels' state (/api/state) and the live event stream.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, eventsUrl } from "./api.ts";
import { ASK_NOTIFY_TITLES } from "./feed/asks.ts";
import type { FeedStore } from "./feed/store.ts";
import { spaced } from "./format.ts";
import { loadNotes } from "./notes.ts";
import { loadTickets } from "./tickets.ts";
import { notify } from "./notifications.ts";
import type { CampEvent, CampState } from "./types.ts";

// "offline": the stream has been down long enough that the camp has most likely been stopped.
// The page keeps trying quietly; the header says what to do meanwhile.
export type Connection = "connecting" | "live" | "reconnecting" | "offline";

// Everything the side panels, the crew cards, and the header chips show. `refresh` reloads it
// (a moment later, so a burst of events means one request); `patch` changes it in place.
// The records only Settings shows (memories, the quest log, the wiki…) come with the first load
// and then only while `records` is on; other refreshes skip them and keep what was there.
// `stale`: the latest reload failed, so what's shown may be behind (cleared by the next that works).
export function useCampState(records = false) {
  const [S, setS] = useState<CampState | null>(null);
  const [stale, setStale] = useState(false);
  // Requests are numbered: an answer that arrives after a newer one has been shown is dropped,
  // so a slow reply can't put the panels back to how they were a moment ago.
  const asked = useRef(0);
  const shown = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const want = useRef(records);
  const loaded = useRef(false);
  const historySeen = useRef<string | undefined>(undefined);
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const full = want.current || !loaded.current;
      const n = ++asked.current;
      try {
        // A light refresh says which history it has, so an unchanged one isn't sent again.
        const seen = historySeen.current;
        const next = await api<CampState>(full ? "/api/state" : `/api/state?full=0${seen ? `&history=${encodeURIComponent(seen)}` : ""}`);
        if (n < shown.current) return; // a newer answer is already on the page
        shown.current = n;
        setStale(false);
        loaded.current = true;
        historySeen.current = next.historyVersion;
        // A light answer leaves the records out (undefined): keep the ones already here.
        setS((was) => (was && !full ? { ...was, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) } as CampState : next));
      } catch (e) {
        console.warn(e);
        if (n > shown.current) setStale(true); // (an old request failing late says nothing about now)
      }
    }, 150);
  }, []);
  useEffect(() => { want.current = records; if (records && loaded.current) refresh(); }, [records, refresh]);
  const patch = useCallback((fn: (s: CampState) => CampState) => setS((s) => (s ? fn(s) : s)), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { S, refresh, patch, stale };
}

// One event from the stream: into the feed, plus what the feed itself doesn't do (pings, and
// reloading the panels when something they show has changed).
export function handleEvent(store: FeedStore, e: CampEvent, opts: { replaying: boolean; refresh: () => void }) {
  const before = store.getState();
  if (!store.apply(e)) return;
  if (e.type === "ask" && !opts.replaying) notify(`Mae: ${ASK_NOTIFY_TITLES[e.kind] ?? "Decision needed"}`, e.body);
  if (e.type === "expedition_end") {
    const started = before.open[e.id]?.started;
    if (started && Date.now() - started > 60_000 && !opts.replaying) notify(`Mae: expedition ${e.status === "done" ? "finished" : spaced(e.status)}`, e.text);
  }
  // "changed" includes the queue: something started, finished, or was stopped.
  if (e.type === "expedition_end" || e.type === "job" || e.type === "changed") opts.refresh();
  // The camp changed a note itself (a ticket it was writing is done): the Notes panel reads them again.
  if (e.type === "changed" && e.what === "notes") void loadNotes();
  // Mae tickets changed (filed by the crew, or moved along as their work started or merged).
  if (e.type === "changed" && e.what === "tickets") void loadTickets();
}

// How long to wait before opening the stream again once the browser has given up on it: a
// second, two, five, then every ten for as long as the page is open.
const RETRY_MS = [1000, 2000, 5000];
const RETRY_STEADY_MS = 10_000;
const OFFLINE_AFTER_MS = 30_000;
const CLOSED = 2; // EventSource.CLOSED

// The live stream. The server replays its saved feed after every (re)connect; events already
// applied are skipped by number. A different bootId means the camp restarted: start over.
//
// A dropped connection the browser retries by itself. An error *answer* (the camp's port giving a
// 401 or 502 while it restarts) it doesn't: the stream is closed for good. So when that happens a
// new one is opened here, after a pause. The camp keeps its link's token across restarts, so the
// same address works again once it's back.
export function useCampEvents(store: FeedStore, refresh: () => void): Connection {
  const [conn, setConn] = useState<Connection>("connecting");
  useEffect(() => {
    let bootId: string | null = null;
    let replaying = true; // the saved feed arrives right after hello; only new questions should ping
    let settle: ReturnType<typeof setTimeout> | undefined;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined; // not on trying: on saying "reconnecting"
    let tries = 0;
    let down = false;
    let gone = false;

    const open = () => {
      const stream = new EventSource(eventsUrl());
      es = stream;
      stream.addEventListener("hello", (m) => {
        const hello = JSON.parse((m as MessageEvent).data) as { bootId: string };
        if (bootId && hello.bootId !== bootId) store.reset();
        bootId = hello.bootId;
        tries = 0;
        down = false;
        clearTimeout(giveUp);
        setConn("live");
        replaying = true;
        clearTimeout(settle);
        settle = setTimeout(() => { replaying = false; }, 1500);
        refresh();
      });
      stream.onmessage = (m) => handleEvent(store, JSON.parse(m.data) as CampEvent, { replaying, refresh });
      stream.onerror = () => {
        if (gone || stream !== es) return;
        if (!down) {
          down = true;
          setConn("reconnecting");
          giveUp = setTimeout(() => setConn("offline"), OFFLINE_AFTER_MS);
        }
        // Still CONNECTING: the browser is retrying by itself. CLOSED: it won't, so we do.
        if (stream.readyState !== CLOSED) return;
        stream.close();
        clearTimeout(retry);
        retry = setTimeout(open, RETRY_MS[tries++] ?? RETRY_STEADY_MS);
      };
    };
    open();
    return () => { gone = true; es?.close(); clearTimeout(settle); clearTimeout(retry); clearTimeout(giveUp); };
  }, [store, refresh]);
  return conn;
}
