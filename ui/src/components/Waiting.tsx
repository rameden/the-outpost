// Chained requests that haven't started: each is waiting for another piece of work to finish.
// Shown above the message box wherever you are, so one you queued an hour ago isn't forgotten.
// If the work it waited on was stopped or failed, it's held rather than started on the back of
// something that didn't land: start it anyway, or take it off.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import type { CampState } from "../types.ts";
import { Icon } from "./bits.tsx";

export function Waiting({ S, onOpen, refresh }: { S: CampState; onOpen: (id: string) => void; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const chained = (S.queued ?? []).filter((q) => q.after);
  if (!chained.length) return null;
  const all = [...S.running, ...S.queued];
  const act = async (path: string, id: string) => {
    setBusy(id); setError("");
    try { await api(path, { id }); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  return (
    <div className="waiting" role="group" aria-label="Waiting to start">
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
