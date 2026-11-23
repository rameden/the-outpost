// What the page says back to you, just above the message box: "Queued (#2)", "Rated 👍", "Couldn't
// find that file". These lines also go into the feed, but only All activity shows them there (a
// conversation's view is its own runs and nothing else), so without this they were said to nobody.
//
// A plain line goes by itself after a few seconds. Something that went wrong stays until you
// dismiss it.

import { useEffect, useState } from "react";
import { hear, say } from "../bus.ts";
import type { FeedStore } from "../feed/store.ts";

const SHOWN_MS = 4000;
const KEPT = 3; // at most this many at once: the oldest makes way

// Say it in both places: the feed (All activity) and the line by the message box.
export function tell(store: FeedStore, text: string, error?: boolean) {
  store.addSys(text);
  say({ do: "tell", text, error, inFeed: true });
}

// The same line when there's no feed to hand: a failed save, a button that didn't work. It
// shows by the message box, and in Settings, until you dismiss it.
export function complain(text: string) {
  say({ do: "tell", text, error: true });
}

type Line = { id: number; text: string; error: boolean; until: number };
let nextId = 1;

// skipFed: leave out lines the feed already shows (All activity).
export function StatusLine({ skipFed }: { skipFed?: boolean } = {}) {
  const [lines, setLines] = useState<Line[]>([]);
  useEffect(() => hear((ask) => {
    if (ask.do !== "tell" || (skipFed && ask.inFeed)) return;
    const line = { id: nextId++, text: ask.text, error: !!ask.error, until: Date.now() + SHOWN_MS };
    setLines((list) => [...list, line].slice(-KEPT));
  }), [skipFed]);
  // One clock, for the plain line that's due to go first.
  const due = lines.find((l) => !l.error);
  useEffect(() => {
    if (!due) return;
    const t = setTimeout(() => setLines((list) => list.filter((l) => l.error || l.until > Date.now())), Math.max(0, due.until - Date.now()));
    return () => clearTimeout(t);
  }, [due]);
  // Always on the page, even when empty: a screen reader announces what appears inside it.
  return (
    <div className="status-line" role="status" aria-live="polite">
      {lines.map((l) => (
        <div key={l.id} className={l.error ? "status-msg bad" : "status-msg"}>
          <span>{l.text}</span>
          <button type="button" className="att-x" aria-label="Dismiss" title="Dismiss" onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
