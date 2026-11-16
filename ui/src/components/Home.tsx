// Today: the page the camp opens on, and where the logo takes you.
//
// Everything else on the page waits to be asked. This is where the camp speaks first: it greets
// you, says in a few plain sentences where things stand, and lays out the morning brief
// (brief.ts) to start the day from:
//   - where you left off, to step straight back in;
//   - plans you approved to start later, as cards under it, each with its Start button;
//   - what's waiting on you, each line with its one next step as a button;
//   - your Jira tickets under way, and what's upcoming;
//   - your latest notes;
//   - what happened since last time.
// The message box sits under it, so a new conversation starts from here too.
//
// The week's numbers and the switches for what the camp does unasked live in Settings
// (settings/DrivePage.tsx: Stats, and What Mae does unasked). Nothing here starts by itself: a button brings feedback to the crew,
// resumes a run, or opens the ticket kickoff, and what follows waits for your OK like any other work.

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { cx, money, plural, when } from "../format.ts";
import type { View } from "../feed/conversation.ts";
import { OfferCard } from "../settings/DrivePage.tsx";
import type { Brief, BriefLine, CampState, HomePage } from "../types.ts";
import { Icon } from "./bits.tsx";

const ACT: Record<NonNullable<BriefLine["act"]>["do"], string> = { address: "Address it", resume: "Resume", start: "Start…" };
const said = (status: string) => { const s = status.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }; // "Stopped", "Over budget"
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const count = (n: number, one: string, many = `${one}s`) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "Good morning, Ryley." by the clock on your wall.
export function greeting(now: Date, name?: string): string {
  const h = now.getHours();
  return `Good ${h < 5 ? "evening" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"}${name ? `, ${name}` : ""}.`;
}
// Where things stand, in a few plain sentences: what the brief says, the way you'd say it.
// held: how many plans you approved to start later are still waiting (they're live, not in the brief).
export function kickoff(b: Brief, held = 0): string {
  const out: string[] = [];
  const first = b.needs[0];
  if (first) out.push(`${count(b.needs.length, "thing")} ${b.needs.length === 1 ? "is" : "are"} waiting on you${b.needs.length === 1 ? ":" : ", starting with"} ${first.title} (${lower(first.says)}).`);
  else if (!held) out.push("Nothing is waiting on you.");
  if (held) out.push(heldLine(held));
  if (b.moving.length) out.push(`${count(b.moving.length, "pull request")} ${b.moving.length === 1 ? "is" : "are"} with reviewers.`);
  if (b.tickets.length) out.push(`You're in the middle of ${lower(count(b.tickets.length, "ticket"))}.`);
  const next = b.next.find((l) => l.kind === "ticket");
  if (next) out.push(`${next.title} is next up.`);
  const d = b.done;
  if (d.finished.length || d.merged.length) {
    out.push(`Since last time, ${[d.finished.length ? `${lower(count(d.finished.length, "conversation"))} had work finish` : "", d.merged.length ? `${lower(count(d.merged.length, "pull request"))} merged` : ""].filter(Boolean).join(" and ")}.`);
  }
  if (!first && !held && !b.moving.length && !b.tickets.length && !next) out.push("A good day to start something.");
  return out.join(" ");
}

const heldLine = (n: number) => `${count(n, "plan")} you approved ${n === 1 ? "is" : "are"} ready to start when you are.`;

export function Home({ S, setView, onStartTicket, onOpenNote, onOpenMemory }: {
  S: CampState; setView: (v: View) => void;
  onStartTicket: (t: { key: string; summary: string }) => void;
  onOpenNote: (id: string) => void; onOpenMemory: () => void; // onOpenMemory: where the crew's suggestions wait for your say
}) {
  const [home, setHome] = useState<HomePage | null>(null);
  const [day, setDay] = useState<string | null>(null);     // an earlier day's brief, picked from the list
  const [earlier, setEarlier] = useState<Brief | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Read again when the record moves: a run ends, a conversation appears, a suggestion is settled.
  const stamp = `${S.history.conversations.length}|${S.history.conversations[0]?.updated ?? ""}|${S.memoryProposals?.length ?? 0}|${S.triggers?.length ?? 0}`;
  const load = useCallback(() => api<HomePage>("/api/home").then(setHome, (e) => setNote(errorText(e))), []);
  useEffect(() => { void load(); }, [load, stamp]);
  useEffect(() => {
    if (!day) return setEarlier(null);
    let current = true;
    api<Brief>(`/api/brief?day=${day}`).then((b) => { if (current) setEarlier(b); }, () => { if (current) setEarlier(null); });
    return () => { current = false; };
  }, [day]);

  const doing = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setNote("");
    try { await work(); } catch (e) { setNote(errorText(e)); }
    setBusy(null);
  };
  const act = (l: BriefLine) => {
    const a = l.act;
    if (!a) return;
    if (a.do === "start") return onStartTicket({ key: a.jira, summary: l.title.replace(`${a.jira} `, "") });
    void doing(l.title, async () => {
      const r = a.do === "address" ? await api<{ thread: string }>("/api/pulls/address", { url: a.url }) : await api<{ thread: string }>("/api/send", { resume: a.run });
      setView({ kind: "conversation", id: r.thread });
    });
  };
  // A plan held for later, started from here: it carries on its conversation, which opens.
  const startPlan = (h: HomePage["held"][number]) => doing(h.ask, async () => {
    const r = await api<{ thread: string }>("/api/send", { start: h.ask });
    setView({ kind: "conversation", id: r.thread });
  });
  const held = home?.held ?? [];
  const rewrite = () => doing("brief", async () => { await api("/api/brief", {}); setDay(null); await load(); });

  const brief = day ? earlier : home?.brief ?? null;
  const fresh = !!home?.brief && home.brief.day === home.today;
  const [last, ...recent] = S.history.conversations.slice(0, 5);
  const nameOf = (id: string) => S.history.projects.find((p) => p.id === id)?.name;
  const now = new Date();
  const waiting = brief ? brief.waiting.memory + brief.waiting.skills : 0;
  const status = (c: { status: string }) => <span className={cx("pill", c.status === "done" ? "done" : c.status === "running" ? "live" : "bad")}>{c.status === "done" ? "Finished" : c.status === "running" ? "Running" : said(c.status)}</span>;

  const section = (title: string, lines: BriefLine[], hint?: string) => !!lines.length && (
    <section>
      <div className="section-label">{title} · {lines.length}</div>
      <ul className="list home-lines">
        {lines.map((l) => (
          <li className="home-line" key={`${l.kind}:${l.title}`}>
            <span className="home-line-text">
              {l.conversation
                ? <button type="button" className="home-line-title" title="Open its conversation" onClick={() => setView({ kind: "conversation", id: l.conversation! })}>{l.title}</button>
                : <span className="home-line-title">{l.title}</span>}
              <span className="meta">{l.says}</span>
            </span>
            {l.url && <a className="home-line-out" href={l.url} target="_blank" rel="noopener noreferrer" title={l.kind === "ticket" ? "Open the ticket" : "Open the pull request"} aria-label={`Open ${l.title} in a new tab`}><Icon name="link" /></a>}
            {l.act && !day && <button type="button" className="btn small" disabled={busy === l.title} onClick={() => act(l)}>{busy === l.title ? "Starting…" : ACT[l.act.do]}</button>}
          </li>
        ))}
      </ul>
      {hint && <div className="meta">{hint}</div>}
    </section>
  );

  return (
    <div className="feed proj-page home">
      <header className="home-hero">
        <div className="home-date">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
        <h2>{greeting(now, home?.name)}</h2>
        <p className="home-kickoff" role="status">
          {!home ? "One moment: reading where things stand…" : brief ? kickoff(brief, day ? 0 : held.length) : held.length ? `${heldLine(held.length)} There's no brief yet.` : "There's no brief yet. Write one, and this is where your day starts: what's waiting on you, your tickets, what's upcoming and your notes."}
        </p>
        <div className="home-hero-foot">
          <span className="meta">{brief ? (day ? `The brief for ${day}.` : fresh ? `Written ${when(brief.written)}.` : `This is the brief from ${brief.day}.`) : ""}</span>
          {!!home?.days.length && (
            <select aria-label="Which day's brief" value={day ?? ""} onChange={(ev) => setDay(ev.target.value || null)}>
              <option value="">Latest brief</option>
              {home.days.filter((d) => d !== home.brief?.day).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button type="button" className="btn small" disabled={busy === "brief"} title="Look at GitHub and Jira again and write today's brief now" onClick={rewrite}>{busy === "brief" ? "Writing…" : fresh ? "Write it again" : "Write today's brief"}</button>
        </div>
      </header>
      {note && <div className="meta bad" role="alert">{note}</div>}

      {last && !day && (
        <section>
          <div className="section-label">Where you left off</div>
          <div className="home-last">
            <span className="home-line-text">
              <span className="home-last-title">{last.title}</span>
              <span className="meta">{[nameOf(last.project), last.jira, when(last.updated)].filter(Boolean).join(" · ")}</span>
            </span>
            {status(last)}
            <button type="button" className="btn small primary" onClick={() => setView({ kind: "conversation", id: last.id })}>Pick it back up</button>
          </div>
        </section>
      )}

      {held.length > 0 && !day && (
        <section>
          <div className="section-label">Ready to start · {held.length}</div>
          <div className="home-held-cards">
            {held.map((h) => (
              <div className="home-last home-held" key={h.ask}>
                <span className="home-line-text">
                  <button type="button" className="home-last-title" title="Open its conversation" onClick={() => setView({ kind: "conversation", id: h.conversation })}>{h.title}</button>
                  <span className="meta">{[h.steps ? `${h.steps} ${plural(h.steps, "step")}` : "", nameOf(h.project), `approved ${when(h.held)}`].filter(Boolean).join(" · ")}</span>
                  <details className="home-held-plan"><summary>The plan</summary><div className="ask-body">{h.plan}</div></details>
                </span>
                <button type="button" className="btn small primary" disabled={busy === h.ask} onClick={() => void startPlan(h)}>{busy === h.ask ? "Starting…" : "Start plan"}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!day && home?.offers.map((o) => <OfferCard key={o.key} offer={o} onDone={() => void load()} />)}

      {brief && (
        <>
          {section("Waiting on you", brief.needs)}
          {section("In motion", brief.moving)}
          {section("Your tickets", brief.tickets)}
          {section("Upcoming", brief.next)}
          {brief.yourNotes.length > 0 && (
            <section>
              <div className="section-label">Your notes · {brief.yourNotes.length}</div>
              <div className="home-notes">
                {brief.yourNotes.map((n) => (
                  <button type="button" key={n.id} className="home-note" title="Open this note" onClick={() => onOpenNote(n.id)}>
                    <b>{n.title}</b>
                    {n.text && n.text !== n.title && <span>{n.text}</span>}
                    <span className="meta">{when(n.updated)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {(brief.done.finished.length > 0 || brief.done.merged.length > 0) && (
            <section>
              <div className="section-label">Since last time</div>
              <div className="home-since">
                {brief.done.finished.map((f) => <button type="button" key={f.conversation} className="pill pill-link" onClick={() => setView({ kind: "conversation", id: f.conversation })}>{f.title} · {f.runs} {plural(f.runs, "run")} finished</button>)}
                {brief.done.merged.map((m) => <a key={m.url} className="pill pill-link" href={m.url} target="_blank" rel="noopener noreferrer">{m.title} · merged</a>)}
              </div>
              <div className="meta">{brief.done.requests} {plural(brief.done.requests, "request")}{brief.done.byMae ? `, ${brief.done.byMae} of them started by Mae` : ""}{brief.done.cost ? ` · ${money(brief.done.cost)} at API prices` : ""}</div>
            </section>
          )}
          {waiting > 0 && !day && (
            <div className="meta">{waiting} {plural(waiting, "suggestion")} from the crew {waiting === 1 ? "is" : "are"} waiting for your say. <button type="button" className="linkish" onClick={onOpenMemory}>Look them over</button></div>
          )}
          {brief.notes.map((n) => <div className="meta bad" key={n}>{n}</div>)}
        </>
      )}

      {recent.length > 0 && !day && (
        <section>
          <div className="section-label">Recent work</div>
          <ul className="list home-lines">
            {recent.map((c) => (
              <li className="home-line" key={c.id}>
                <span className="home-line-text">
                  <button type="button" className="home-line-title" onClick={() => setView({ kind: "conversation", id: c.id })}>{c.title}</button>
                  <span className="meta">{[nameOf(c.project), c.jira, when(c.updated)].filter(Boolean).join(" · ")}</span>
                </span>
                {status(c)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
