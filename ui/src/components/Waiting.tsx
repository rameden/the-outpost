// Chained requests that haven't started: each is waiting for another piece of work to finish.
// If the work it waited on was stopped or failed, it's held rather than started on the back of
// something that didn't land: start it anyway, or take it off.
//
// Chained is the list itself, with its buttons: it lives in the Inbox (Inbox.tsx), with everything
// else that waits on you. Waiting is the one line above the message box wherever you are, so a
// request you queued an hour ago isn't forgotten: how many there are, and the way to the Inbox.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import { plural } from "../format.ts";
import type { CampState } from "../types.ts";
import { Icon } from "./bits.tsx";
import { queueBehind } from "./StatusStack.tsx";

export const chainedOf = (S: CampState) => (S.queued ?? []).filter((q) => q.after);

export function Chained({ S, onOpen, refresh }: { S: CampState; onOpen: (id: string) => void; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const chained = chainedOf(S);
  if (!chained.length) return null;
  const all = [...S.running, ...S.queued];
  const act = async (path: string, id: string) => {
    setBusy(id); setError("");
    try { await api(path, { id }); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  return (
    <div className="waiting-list" role="group" aria-label="Waiting to start">
      {chained.map((q) => {
        const before = all.find((w) => w.id === q.after);
        return (
          <div key={q.id} className={q.held ? "waiting-row held" : "waiting-row"}>
            <Icon name="clock" />
            <span className="waiting-what">
              <button type="button" className="linkish" title="Open it" onClick={() => onOpen(q.id)}>{q.task || q.label}</button>
              <small>{q.held ? `The work it was waiting on ended as ${q.held}, so it hasn't started.` : `Starts when ${before?.task ? `"${before.task}"` : "the work before it"} has finished.`}</small>
            </span>
            <button type="button" className="btn small" disabled={busy === q.id} title="Start it without waiting any longer" onClick={() => act("/api/queue/release", q.id)}>{q.held ? "Start it anyway" : "Start now"}</button>
            <button type="button" className="btn small" disabled={busy === q.id} title="Take it off the queue: it won't run" onClick={() => act("/api/stop", q.id)}>Take it off</button>
          </div>
        );
      })}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

// The line above the message box: what's chained, in a sentence, and the Inbox to start one or take it off.
// here: the run this conversation's queue lines up behind. That line is in the message box's own
// status stack (StatusStack.tsx), with its buttons, so it isn't counted again here.
export function Waiting({ S, onOpenInbox, here }: { S: CampState; onOpenInbox: () => void; here?: string | null }) {
  const shown = new Set(queueBehind(S.queued, here).map((q) => q.id));
  const chained = chainedOf(S).filter((q) => !shown.has(q.id));
  if (!chained.length) return null;
  const held = chained.filter((q) => q.held).length;
  const one = chained.length === 1 ? chained[0] : null;
  return (
    <div className="waiting-list" role="group" aria-label="Waiting to start">
      <div className={held ? "waiting-row held" : "waiting-row"}>
        <Icon name="clock" />
        <span className="waiting-what">
          <span>{one ? one.task || one.label : `${chained.length} chained requests are waiting to start`}</span>
          <small>{held
            ? `${one ? "Held" : `${held} held`}: the work ${held === 1 ? "it was" : "they were"} waiting on didn't finish cleanly. Start ${held === 1 ? "it" : "them"} anyway or take ${held === 1 ? "it" : "them"} off in the Inbox.`
            : `${one ? "Starts" : "Each starts"} when the work before it has finished. Start ${plural(chained.length, "it", "one")} now or take ${plural(chained.length, "it", "one")} off in the Inbox.`}</small>
        </span>
        <button type="button" className="btn small" title="Activity, Inbox: everything waiting on you" onClick={onOpenInbox}>Open the inbox</button>
      </div>
    </div>
  );
}
