import { useEffect, useState } from "react";
import { errorText } from "../api.ts";
import { when } from "../format.ts";
import { holdDebrief, loadDebrief, type Debrief } from "../tickets.ts";
import { ReadAloud } from "./ReadAloud.tsx";

const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// The debrief as it's read aloud: the same things in the same order as the page, in sentences.
export function debriefSpeech(d: Debrief): string {
  const say = (x: string) => (/[.!?]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`);
  const list = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map(say)] : []);
  return [
    `How the crew did. ${n(d.runs, "run")} and ${n(d.quests, "quest")}, costing $${d.cost.toFixed(2)}.`,
    ...list("Went well", d.well),
    ...list("Could have gone better", d.better),
    ...(!d.well.length && !d.better.length ? ["Nothing stood out either way."] : []),
    ...list("Lessons proposed", d.proposed.map((l) => `${l.name}: ${l.text}`)),
  ].join(" ");
}

// How the crew did on a ticket that's done: what the camp's debrief found, and the lessons it
// put in front of you. stamp: changes when the tickets are read again (a debrief just written says so).
// jira: a Jira ticket, which the camp only knows is done when its pull request merges, and which
// may never have been worked on here: nothing is shown for one with no debrief and no work on record.
export function TicketDebrief({ ticketKey, stamp, jira }: { ticketKey: string; stamp?: unknown; jira?: boolean }) {
  const [d, setD] = useState<Debrief | null>(null);
  const [worked, setWorked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let on = true;
    loadDebrief(ticketKey).then((r) => { if (on) { setD(r.debrief); setWorked(!!r.worked); } }).catch(() => { /* shown as not written yet */ });
    return () => { on = false; };
  }, [ticketKey, stamp]);
  async function hold() {
    setBusy(true); setError("");
    try { setD(await holdDebrief(ticketKey)); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  if (jira && !d && !worked) return null;
  return (
    <section className="ticket-debrief" aria-label="How the crew did">
      <h3>How the crew did</h3>
      {error && <div className="form-error" role="alert">{error}</div>}
      {!d ? <div className="meta">Not debriefed yet. The camp does it within a couple of minutes of {jira ? "the ticket's pull request merging" : "a ticket being done"}, if debriefs are on (Settings, What Mae does unasked).</div> : (
        <>
          <div className="meta">{n(d.runs, "run")} ({d.asks} typed by you) and {n(d.quests, "quest")}, costing ${d.cost.toFixed(2)}. Read {when(d.written)}.</div>
          {d.well.length > 0 && <><h4>Went well</h4><ul className="jira-criteria">{d.well.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {d.better.length > 0 && <><h4>Could have gone better</h4><ul className="jira-criteria">{d.better.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
          {!d.well.length && !d.better.length && <div className="meta">Nothing stood out either way.</div>}
          {d.proposed.length > 0 && (
            <>
              <h4>Lessons proposed</h4>
              <ul className="jira-criteria">{d.proposed.map((l, i) => <li key={i}><b>{l.name}:</b> {l.text}</li>)}</ul>
              <div className="meta">None is kept until you approve it, in Settings under Memory. Once kept, it's in every prompt that crew member or project gets.</div>
            </>
          )}
        </>
      )}
      <div className="debrief-actions">
        <button type="button" className="btn small" disabled={busy} onClick={hold}>{busy ? "Reading the work…" : d ? "Debrief again" : "Debrief now"}</button>
        {d && <ReadAloud text={debriefSpeech(d)} what="Debrief" />}
      </div>
    </section>
  );
}
