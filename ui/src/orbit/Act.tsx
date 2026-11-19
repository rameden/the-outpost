// Acting from the full-screen view (Orbit.tsx), without going back to the page: answering what's
// waiting on you, saying something to work that's under way, stopping it, and sending a new
// request. Each posts to the camp exactly as the page's own controls do; what comes of it arrives
// on the feed like anything else, so nothing here keeps a copy of the camp's state.

import { useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { AskCard } from "../feed/AskCard.tsx";
import type { AskNode } from "../feed/reducer.ts";
import type { SendResult } from "../types.ts";

// A line to type and a button to send it. onSay: sends it, and gives back what to say about that
// (nothing, for the usual "Sent"). What you typed stays if it couldn't be sent.
export function Say({ label, placeholder, button = "Send", onSay }: { label: string; placeholder: string; button?: string; onSay: (text: string) => Promise<string | void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const sending = useRef(false); // (a second Enter before the first has gone is the same message, not another)
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const said = text.trim();
    if (!said || sending.current) return;
    sending.current = true;
    setBusy(true);
    setNote(null);
    try {
      const told = await onSay(said);
      setText("");
      setNote({ text: told || "Sent" });
    } catch (e) { setNote({ text: errorText(e), bad: true }); }
    sending.current = false;
    setBusy(false);
  }
  return (
    <form className="orb-say" onSubmit={submit}>
      <div className="orb-say-row">
        <input type="text" aria-label={label} placeholder={placeholder} value={text} disabled={busy} autoComplete="off"
          onChange={(ev) => { setText(ev.target.value); if (note) setNote(null); }} />
        <button type="submit" className="orb-btn" disabled={busy || !text.trim()}>{busy ? "Sending…" : button}</button>
      </div>
      {note && <p className={note.bad ? "orb-say-note bad" : "orb-say-note"} role={note.bad ? "alert" : "status"}>{note.text}</p>}
    </form>
  );
}

// Say something to an expedition that's running. It's heard by the whole expedition (the
// Quartermaster, and through it whoever is out), which is how the camp takes a word mid-run.
export function Steer({ expId }: { expId: string }) {
  return (
    <Say label="Say something to this expedition" placeholder="Say something to it…" button="Say"
      onSay={async (text) => { await api("/api/steer", { id: expId, text }); return "Said. It's taken up at its next step."; }} />
  );
}

// Stop one expedition: everyone it has out comes home.
export function Stop({ expId }: { expId: string }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false); // (it sits just under the box you type in, and can't be undone: it asks once)
  const [failed, setFailed] = useState("");
  async function stop() {
    setSure(false);
    setBusy(true);
    setFailed("");
    try { await api("/api/stop", { id: expId }); }
    catch (e) { setFailed(errorText(e)); setBusy(false); } // (stopped, it leaves the panel by itself)
  }
  return (
    <>
      {sure
        ? <span className="orb-sure" role="group" aria-label="Stop this expedition?"><button type="button" className="orb-btn orb-stop" onClick={stop}>Yes, stop it</button><button type="button" className="orb-btn" onClick={() => setSure(false)}>Keep it going</button></span>
        : <button type="button" className="orb-btn orb-stop" disabled={busy} onClick={() => setSure(true)}>{busy ? "Stopping…" : "Stop this expedition"}</button>}
      {failed && <p className="orb-say-note bad" role="alert">{failed}</p>}
    </>
  );
}

// Send a request: to the Quartermaster (an expedition), or straight to one of the crew.
export function Dispatch({ id, name, lead, onSent }: { id: string; name: string; lead: boolean; onSent: () => void }) {
  return (
    <Say label={lead ? `Send the ${name} on an expedition` : `Ask ${name} for something`}
      placeholder={lead ? "Send the crew on an expedition…" : `Ask ${name} directly…`}
      onSay={async (text) => {
        const sent = await api<SendResult>("/api/send", { text: lead ? text : `@${id} ${text}`, chat: !lead });
        if (sent.position > 0) return `Queued, with ${sent.position} ahead of it.`;
        onSent();
        return lead ? "Sent. The plan shows here when it's ready." : `Sent to ${name}.`;
      }} />
  );
}

// What's waiting on you from this one, to answer here.
export function Decisions({ asks }: { asks: AskNode[] }) {
  if (!asks.length) return null;
  return (
    <section className="orb-asks" aria-label="Waiting for your decision">
      <h4>{asks.length === 1 ? "Needs your decision" : `${asks.length} decisions need you`}</h4>
      {asks.map((a) => <AskCard key={a.id} ask={a} />)}
    </section>
  );
}
