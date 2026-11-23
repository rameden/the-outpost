// Settings → Memory: what the crew remembers, and your say over it.
//
// At the top, whatever is waiting for you: a tidied version of a memory that's filling up, or
// something from a run that might be worth keeping. Nothing there has been applied. Then the
// note about you that the whole crew shares (yours to write), each crew member's own memory, and
// each project's notes: every line with where it came from, how much of it a prompt still loads,
// a way to forget one line, and a way to ask for a tidy.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { cClass, cx } from "../format.ts";
import type { CampState, MemoryLine, MemoryPlace, Proposal } from "../types.ts";
import { complain } from "../components/StatusLine.tsx";

import { w } from "../words.ts";
const HOW: Record<string, string> = { get remember() { return `the ${w("crew")} noted it`; }, feedback: "your feedback", suggestion: "a suggestion you approved", you: "you", tidy: "a shorter version you approved" };
const linesOf = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, ""));

// Where a line came from: the conversation (a link to it), or how it got here.
function Origin({ line }: { line: MemoryLine }) {
  const o = line.origin;
  if (!o) return null;
  return (
    <span className="mem-origin">
      {HOW[o.how] ?? o.how}
      {o.thread && <>, in <button type="button" className="linkish" title="Open that conversation" onClick={() => say({ do: "open-conversation", id: o.thread! })}>{o.title || "a conversation"}</button></>}
    </span>
  );
}

function Waiting({ p, refresh }: { p: Proposal; refresh: () => void }) {
  const [text, setText] = useState(p.kind === "tidy" ? p.after : p.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const settle = async (action: "approve" | "dismiss") => {
    setBusy(true); setError("");
    try { await api("/api/memory/proposal", { id: p.id, action, ...(action === "approve" ? { text } : {}) }); refresh(); }
    catch (e) { setError(errorText(e)); refresh(); }
    setBusy(false);
  };
  if (p.kind === "keep") {
    return (
      <li className="mem-wait" aria-label={`Suggested for ${p.name}`}>
        <div className="mem-wait-head"><b>Worth keeping?</b><span>for {p.name}{p.thread && <> · from <button type="button" className="linkish" onClick={() => say({ do: "open-conversation", id: p.thread! })}>{p.title || "a conversation"}</button></>}</span></div>
        <textarea rows={2} value={text} aria-label="What to keep" onChange={(ev) => setText(ev.target.value)} />
        <div className="mem-wait-actions">
          <button type="button" className="btn small primary" disabled={busy || !text.trim()} onClick={() => settle("approve")}>Keep it</button>
          <button type="button" className="btn small" disabled={busy} onClick={() => settle("dismiss")}>Don't keep</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </li>
    );
  }
  // Two lines you asked to merge (on the memory map): the one line drafted to take their place.
  if (p.kind === "merge") {
    return (
      <li className="mem-wait" aria-label={`A merge in ${p.name}`}>
        <div className="mem-wait-head"><b>Merge these two?</b><span>in {p.name}</span></div>
        <ul className="mem-left">{p.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <p className="mem-wait-note">Drafted by the smallest model to say what both say. Approve it and it takes both lines' place; you can edit it here first.</p>
        <textarea rows={2} value={text} aria-label="The merged line" onChange={(ev) => setText(ev.target.value)} />
        <div className="mem-wait-actions">
          <button type="button" className="btn small primary" disabled={busy || !text.trim()} onClick={() => settle("approve")}>Merge them</button>
          <button type="button" className="btn small" disabled={busy} onClick={() => settle("dismiss")}>Keep both</button>
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
      </li>
    );
  }
  const was = linesOf(p.before), now = linesOf(text);
  // It had outgrown what a prompt loads, so the draft was cut to fit, not only merged.
  const cut = !!p.limit && p.before.length > p.limit;
  const over = p.limit ? text.trim().length - p.limit : 0;
  const leftOut = p.leftOut ?? [];
  return (
    <li className="mem-wait" aria-label={`A shorter version of ${p.name}`}>
      <div className="mem-wait-head"><b>Tidy {p.name}?</b><span>{was.length} lines to {now.length} · {p.before.length.toLocaleString()} characters to {text.length.toLocaleString()}{cut && ` · a prompt loads ${p.limit!.toLocaleString()}`}</span></div>
      <p className="mem-wait-note">{cut
        ? "This had outgrown what a prompt loads, so the smallest model drafted it to fit: lines on one subject merged, each said in fewer words, and the least lasting dropped. More goes than usual, so read it before you approve: you can edit it here, and anything added since it was drafted is kept."
        : "Duplicates merged and superseded lines dropped, drafted by the smallest model. Read it before you approve: you can edit it here, and anything added since it was drafted is kept."}</p>
      {leftOut.length > 0 && (
        <div className="mem-warn" role="status">
          The draft was still too long, so {leftOut.length === 1 ? "the oldest unpinned line was" : `the ${leftOut.length} oldest unpinned lines were`} left out to make it fit. Put back what you'd rather keep:
          <ul className="mem-left">{leftOut.map((l, i) => <li key={i}>{l.replace(/^-\s*/, "")}</li>)}</ul>
        </div>
      )}
      {over > 0 && <div className="mem-warn" role="status">As edited, this is {over.toLocaleString()} characters over what a prompt loads: the oldest lines would be loaded only when a request is about them.</div>}
      <textarea rows={Math.min(12, Math.max(4, now.length + 1))} value={text} aria-label={`The tidied ${p.name}`} spellCheck={false} onChange={(ev) => setText(ev.target.value)} />
      <button type="button" className="linkish" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Hide what's there now" : "Show what's there now"}</button>
      {open && <pre className="mem-before">{p.before}</pre>}
      <div className="mem-wait-actions">
        <button type="button" className="btn small primary" disabled={busy || !text.trim()} onClick={() => settle("approve")}>Replace it with this</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => settle("dismiss")}>Leave it as it is</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </li>
  );
}

function Place({ m, refresh, waiting }: { m: MemoryPlace; refresh: () => void; waiting: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const full = Math.min(100, Math.round((m.size / m.limit) * 100));
  const newest = [...m.lines].reverse();
  const shown = all ? newest : newest.slice(0, 8);
  const forget = async (line: MemoryLine) => {
    setBusy(line.text); setError("");
    try { await api("/api/memory/forget", { where: m.where, line: line.text }); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  // Pinned: it's in every prompt, however long this gets. (The note about you is loaded as written: nothing to pin.)
  const pin = async (line: MemoryLine) => {
    setBusy(line.text); setError("");
    try { await api("/api/memory/pin", { where: m.where, line: line.text, on: !line.pinned }); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  const lists = m.kind !== "about";
  const tidy = async () => {
    setBusy("tidy"); setError("");
    try { await api("/api/memory/tidy", { where: m.where }); refresh(); } catch (e) { setError(errorText(e)); }
    setBusy("");
  };
  return (
    <section className={cx("mem-place", m.kind === "agent" && cClass(m.name.replace(/'s memory$/, "")))} aria-label={m.name}>
      <div className="mem-place-head">
        <h4>{m.emoji ? `${m.emoji} ` : ""}{m.name}</h4>
        <span className={cx("mem-meter", m.unloaded > 0 ? "over" : full >= 80 && "near")} title={lists ? `A prompt loads up to ${m.limit.toLocaleString()} characters: pinned lines, the newest, and older ones that bear on the request.` : `A prompt loads the newest ${m.limit.toLocaleString()} characters.`}>
          <span className="mem-bar"><span style={{ width: `${full}%` }} /></span>
          {m.size.toLocaleString()} of {m.limit.toLocaleString()} characters
        </span>
        {m.lines.length >= 4 && <button type="button" className="btn small" disabled={!!busy || waiting} title={waiting ? "A shorter version is already waiting above" : "Have the smallest model draft a merged version, for you to approve"} onClick={tidy}>{busy === "tidy" ? "Drafting…" : "Tidy…"}</button>}
      </div>
      {m.unloaded > 0 && (lists
        ? <div className="mem-warn" role="status">This no longer all fits in a prompt. {m.unloaded} older {m.unloaded === 1 ? "line is" : "lines are"} loaded only when a request is about {m.unloaded === 1 ? "it" : "them"} (recall can still find {m.unloaded === 1 ? "it" : "them"}). Pin a line to load it every time; a shorter version makes room.</div>
        : <div className="mem-warn" role="status">The oldest {m.unloaded} {m.unloaded === 1 ? "line no longer fits" : "lines no longer fit"} in a prompt, so the {w("crew")} doesn't start with {m.unloaded === 1 ? "it" : "them"} (recall can still find {m.unloaded === 1 ? "it" : "them"}). A shorter version makes room.</div>)}
      {!m.lines.length && <div className="meta">{m.kind === "about" ? `Nothing yet. Write what's true of you whoever you're working with, or let the ${w("crew")} note it as they learn.` : "Nothing remembered yet."}</div>}
      <ul className="mem-lines">
        {shown.map((l, i) => (
          <li key={`${l.date}|${l.text}|${i}`} className={cx(!l.loaded && "unloaded")}>
            <div><span>{l.text}</span><small>{l.date && <time>{l.date}</time>}<Origin line={l} />{l.pinned && <span className="mem-pinned">pinned</span>}{!l.loaded && <span className="mem-out">{lists ? "only when relevant" : "not loaded"}</span>}</small></div>
            {lists && <button type="button" className={cx("att-x mem-pin", l.pinned && "on")} aria-pressed={!!l.pinned} aria-label={`${l.pinned ? "Unpin" : "Pin"}: ${l.text}`} title={l.pinned ? "Pinned: in every prompt. Click to unpin." : "Pin: keep this line in every prompt"} disabled={!!busy} onClick={() => pin(l)}>📌</button>}
            <button type="button" className="att-x" aria-label={`Forget: ${l.text}`} title="Forget this line" disabled={!!busy} onClick={() => forget(l)}>×</button>
          </li>
        ))}
      </ul>
      {newest.length > shown.length && <button type="button" className="hist-all" onClick={() => setAll(true)}>Show {newest.length - shown.length} older</button>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

function AboutYou({ m, refresh }: { m: MemoryPlace; refresh: () => void }) {
  const current = m.raw ?? "";
  const [text, setText] = useState(current);
  const [seen, setSeen] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // The crew added to it (or a suggestion was approved) while you weren't editing: show that.
  useEffect(() => { if (current !== seen && text === seen) { setText(current); setSeen(current); } }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setError("");
    try { await api("/api/memory/about", { text }); setSeen(text); setSaved(true); refresh(); } catch (e) { setError(errorText(e)); }
  };
  return (
    <section className="mem-place" aria-label="About you">
      <div className="mem-place-head"><h4>About you</h4><span className="mem-meter">{m.size.toLocaleString()} of {m.limit.toLocaleString()} characters</span></div>
      <p className="set-note">One short note that every {w("crew")} member starts with: how you like answers, what you call things, what never to do. Write it here, one line each; the {w("crew")} can add to it too, and you can take any line out.</p>
      <textarea className="mem-about" rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} value={text} aria-label="About you" placeholder={"- Keep answers short, and lead with the answer.\n- I work in Eastern time."}
        onChange={(ev) => { setText(ev.target.value); setSaved(false); }} />
      <div className="set-actions">
        <button type="button" className="btn small primary" disabled={text === seen} onClick={save}>Save</button>
        {saved && text === seen && <span className="work-done" role="status">Saved. The {w("crew")} starts with it from their next run.</span>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
    </section>
  );
}

export function MemoryPage({ S, refresh }: { S: CampState; refresh: () => void }) {
  const places = S.memory ?? [];
  const waiting = S.memoryProposals ?? [];
  const care = S.settings.memoryCare ?? { tidy: true, suggest: false };
  const about = places.find((p) => p.kind === "about");
  const setCare = (change: { tidy?: boolean; suggest?: boolean }) => api("/api/memory/care", change).then(refresh, (e) => complain(errorText(e)));
  return (
    <>
      <p className="set-note">What the {w("crew")} starts each run knowing. Only the newest part of each memory fits in a prompt; the rest is still on disk, and the {w("crew")} can search it with <code>recall</code> (along with past sessions, this project's earlier conversations and the wiki).</p>
      <p className="set-note"><button type="button" className="btn small" onClick={() => say({ do: "command", name: "constellation" })}>Open the map</button> Every line as a star, grouped by where it lives: see what's alike, what gets used, and pin, forget or merge from there.</p>
      {waiting.length > 0 && (
        <section aria-label="Waiting for you">
          <h4 className="set-sub">Waiting for you <span className="count needs">{waiting.length}</span></h4>
          <ul className="mem-waiting">{waiting.map((p) => <Waiting key={p.id} p={p} refresh={refresh} />)}</ul>
        </section>
      )}
      <div className="mem-care">
        <label className="switch"><input type="checkbox" checked={care.tidy} onChange={(ev) => setCare({ tidy: ev.target.checked })} /> Offer a shorter version when a memory is nearly full</label>
        <span className="field-hint">The smallest model drafts it, and it waits here for you. It runs rarely: only when a memory passes four fifths of what a prompt loads.</span>
        <label className="switch"><input type="checkbox" checked={care.suggest} onChange={(ev) => setCare({ suggest: ev.target.checked })} /> After each run, suggest what's worth keeping</label>
        <span className="field-hint">Up to three suggestions a run, waiting here for you; most runs have none. It's one small call per run, so it uses a little of your plan each time.</span>
      </div>
      {about && <AboutYou m={about} refresh={refresh} />}
      {places.filter((p) => p.kind !== "about").map((m) => <Place key={m.where} m={m} refresh={refresh} waiting={waiting.some((p) => p.kind === "tidy" && p.where === m.where)} />)}
    </>
  );
}
