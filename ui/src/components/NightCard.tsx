// "While you were away": what the night shift (src/nightshift.ts) left for the morning, on Today.
//
// The night shift only drafts and reports, so everything here is something to look at, not
// something that happened to your camp: memory tidies drafted and waiting for your say, old
// lines worth a look, and what housekeeping could clear. Dismiss marks it read; the drafts and
// the lines stay where they are, in Settings → Memory.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import { plural, when } from "../format.ts";
import type { HomePage } from "../types.ts";
import { Icon } from "./bits.tsx";

import { a as an } from "../words.ts";
export type Night = NonNullable<HomePage["night"]>;
const names = (list: { name: string }[]) => list.map((x) => x.name).join(", ");

export function NightCard({ night, onOpenMemory, onDone }: { night: Night; onOpenMemory: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function dismiss() {
    setBusy(true); setNote("");
    try { await api("/api/night/seen", {}); onDone(); } catch (e) { setNote(errorText(e)); }
    setBusy(false);
  }
  const { tidied, stale, housekeeping } = night;
  return (
    <section className="home-night" aria-label="While you were away">
      <div className="card-top"><span className="who"><Icon name="clock" /> While you were away</span><span className="meta">Night shift, {when(night.finished)}</span></div>
      <ul className="night-lines">
        {tidied.length > 0 && (
          <li>
            <span>Drafted {plural(tidied.length, "a shorter version of 1 memory", `shorter versions of ${tidied.length} memories`)} <span className="meta">({names(tidied)})</span></span>
            <button type="button" className="linkish" onClick={onOpenMemory}>Look {tidied.length === 1 ? "it" : "them"} over</button>
          </li>
        )}
        {stale.length > 0 && (
          <li>
            <details className="night-old">
              <summary>{plural(stale.length, "1 old line", `${stale.length} old lines`)} worth a look</summary>
              <ul>
                {stale.map((s) => <li key={`${s.where}|${s.text}`}><span>{s.text}</span><span className="meta">{s.name} · {s.date}</span></li>)}
              </ul>
              <p className="meta">Not pinned, and more than 90 days old. Nothing was changed: keep, pin or remove them in <button type="button" className="linkish" onClick={onOpenMemory}>Memory</button>.</p>
            </details>
          </li>
        )}
        {housekeeping.length > 0 && (
          <li>
            <span>Housekeeping could {housekeeping.map((f) => f.title).join("; ")}{night.frees ? ` (about ${night.frees})` : ""}. <span className="meta">Nothing was cleared: ask for {an("camp")} cleanup when you want it done.</span></span>
          </li>
        )}
        {night.notes.map((n) => <li key={n}><span className="meta">{n}</span></li>)}
      </ul>
      <div className="card-actions">
        <button type="button" className="btn small" disabled={busy} onClick={dismiss}>{busy ? "Dismissing…" : "Dismiss"}</button>
        <span className="meta" role={note ? "alert" : undefined}>{note || "It only drafted and reported. Nothing was applied or deleted."}</span>
      </div>
    </section>
  );
}
