// A project's weekly chronicle, on its page: what happened in a week, written by the Scribe from
// the camp's own record and nothing else, ending in plain bullets you can paste into a status
// update. A week is written when you ask (it uses a little of your plan), and kept.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { nameNow, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { ChroniclePage, SendResult } from "../types.ts";

import { w } from "../words.ts";
// The bullets under "In plain terms".
export function plainTerms(text: string): string {
  const m = text.match(/^#{1,4}\s*In plain terms\s*$/im);
  if (!m || m.index === undefined) return "";
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^#{1,4}\s/m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

// reloadKey: changes when the project's conversations do (the Scribe finishing is one of them).
// onOpen: go to the conversation in which a chronicle is being written.
export function ChronicleSection({ project, reloadKey, onOpen }: { project: { id: string; name: string }; reloadKey: string; onOpen: (thread: string) => void }) {
  const [page, setPage] = useState<ChroniclePage | null>(null);
  const [week, setWeek] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    let current = true;
    const load = () => api<ChroniclePage>(`/api/project/chronicle?id=${encodeURIComponent(project.id)}`).then((p) => { if (current) setPage(p); }, () => { if (current) setPage(null); });
    void load();
    const again = setTimeout(load, 1500); // a chronicle is kept a moment after its conversation ends
    return () => { current = false; clearTimeout(again); };
  }, [project.id, reloadKey]);
  if (!page?.open || !page.weeks) return null;
  // The weeks on offer: this week and last (if anything happened), and every week already written.
  const weeks = [...page.open.filter((o) => o.conversations > 0 || page.weeks.some((w) => w.week === o.week)), ...page.weeks.filter((w) => !page.open.some((o) => o.week === w.week))];
  if (!weeks.length) return null;
  const chosen = weeks.find((w) => w.week === week) ?? weeks.find((w) => page.weeks.some((x) => x.week === w.week)) ?? weeks[0];
  const written = page.weeks.find((w) => w.week === chosen.week);
  const happened = page.open.find((o) => o.week === chosen.week)?.conversations ?? 0;
  const plain = written ? plainTerms(written.text) : "";

  async function write() {
    setBusy(true); setNote("");
    try { const r = await api<SendResult>("/api/project/chronicle", { id: project.id, week: chosen.week }); onOpen(r.thread); }
    catch (e) { setNote(errorText(e)); setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(plain); setNote("Copied the plain bullets."); } catch { setNote("Couldn't copy from here: select the bullets and copy them."); }
  }
  return (
    <section className="proj-about chronicle">
      <div className="proj-section-head">
        <div className="section-label">Weekly chronicle</div>
        <span className="proj-edit-actions">
          {weeks.length > 1 && (
            <select aria-label="Week" value={chosen.week} onChange={(ev) => { setWeek(ev.target.value); setNote(""); }}>
              {weeks.map((w) => <option key={w.week} value={w.week}>{w.label}</option>)}
            </select>
          )}
          {plain && <button type="button" className="linkish" title="Copy the bullets under “In plain terms”, to paste into a status update" onClick={copy}>Copy the plain bullets</button>}
          {(happened > 0 || !written) && (
            <button type="button" className="btn small" disabled={busy || happened === 0}
              title={`The ${w("camp")} gathers what its record says happened that week, and the ${nameNow("Scribe")} writes it up from that alone. It runs as a conversation and uses a little of your plan.`}
              onClick={write}>{busy ? "Starting…" : written ? "Write it again" : "Write it up"}</button>
          )}
        </span>
      </div>
      {written
        ? <><Markdown text={written.text} /><div className="meta">{written.label} · written {when(written.written)} from the {w("camp")}'s record of that week.</div></>
        : <div className="meta">{chosen.label}: {happened} {happened === 1 ? "conversation" : "conversations"} had work in {project.name}. Nothing is written up yet.</div>}
      {note && <div className="meta" role="status">{note}</div>}
    </section>
  );
}
