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

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import { cx, money, plural, when } from "../format.ts";
import { outpostName } from "../outpost.ts";
import { w } from "../words.ts";
import type { View } from "../feed/conversation.ts";
import { OfferCard } from "../settings/DrivePage.tsx";
import type { Brief, BriefLine, CampState, HomePage } from "../types.ts";
import { Icon } from "./bits.tsx";
import { Confirm } from "./Confirm.tsx";
import { HomeSky, type HomeSkyHandle } from "./HomeSky.tsx";
import { NightCard } from "./NightCard.tsx";

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
  const sky = useRef<HomeSkyHandle>(null); // the stars drift as the page scrolls
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
  // A plan held for later, taken off Ready to start without starting it (its conversation stays).
  const [removing, setRemoving] = useState<HomePage["held"][number] | null>(null);
  const removePlan = (h: HomePage["held"][number]) => doing(`aside:${h.ask}`, async () => {
    setRemoving(null);
    await api("/api/plans/aside", { ask: h.ask });
    await load();
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
            {l.act && !day && <button type="button" className="btn small" disabled={busy === l.title} aria-label={busy === l.title ? undefined : `${ACT[l.act.do].replace("…", "")}: ${l.title}`} onClick={() => act(l)}>{busy === l.title ? "Starting…" : ACT[l.act.do]}</button>}
          </li>
        ))}
      </ul>
      {hint && <div className="meta">{hint}</div>}
    </section>
  );

  // Cards in the Tickets page's grid (TicketsPage.tsx), for your tickets, what's upcoming and your recent work: a
  // key and where it stands on top, the title, then a line on it with its link and its one next step. A card with
  // somewhere to go opens it from anywhere on the card; the link and the step sit above that.
  type Card = { id: string; tag?: string; meta?: string; pill?: ReactNode; title: string; name?: string; open?: () => void; foot?: string; url?: string; urlTitle?: string; line?: BriefLine };
  const card = (c: Card) => (
    <li className={cx("proj-card jira-card home-card", c.open && "opens")} key={c.id}>
      <span className="jira-card-top">
        {c.tag && <span className="jira-key">{c.tag}</span>}
        {c.meta && <span className="meta">{c.meta}</span>}
        {c.pill}
      </span>
      {c.open
        ? <button type="button" className="home-card-title" aria-label={c.name ?? c.title} title="Open its conversation" onClick={c.open}>{c.title}</button>
        : <b className="home-card-title">{c.title}</b>}
      <span className="home-card-foot">
        <span className="meta">{c.foot}</span>
        {c.url && <a className="home-line-out" href={c.url} target="_blank" rel="noopener noreferrer" title={c.urlTitle} aria-label={`Open ${c.name ?? c.title} in a new tab`}><Icon name="link" /></a>}
        {c.line?.act && !day && <button type="button" className="btn small" disabled={busy === c.line.title} aria-label={busy === c.line.title ? undefined : `${ACT[c.line.act.do].replace("…", "")}: ${c.title}`} onClick={() => act(c.line!)}>{busy === c.line.title ? "Starting…" : ACT[c.line.act.do]}</button>}
      </span>
    </li>
  );
  const cards = (title: string, items: Card[], count = true) => !!items.length && (
    <section>
      <div className="section-label">{title}{count ? ` · ${items.length}` : ""}</div>
      <ul className="proj-grid jira-grid home-cards">{items.map(card)}</ul>
    </section>
  );
  // A ticket's line says where Jira has it ("In Progress · High") and, for one under way, where it stands here last.
  const ticketCard = (l: BriefLine, underWay: boolean): Card => {
    const [, key = "", summary = l.title] = /^([A-Z][A-Z0-9]+-\d+)\s+(.*)$/.exec(l.title) ?? [];
    const parts = l.says.split(" · "), here = underWay ? parts.pop() : undefined, [status, ...rest] = parts;
    return { id: l.title, tag: key, meta: rest.join(" · "), pill: status && <span className="pill">{status}</span>, title: summary, name: l.title, foot: here, url: l.url, urlTitle: "Open the ticket", line: l, ...(l.conversation ? { open: () => setView({ kind: "conversation", id: l.conversation! }) } : {}) };
  };
  // A scheduled job: what it is, and when it runs.
  const jobCard = (l: BriefLine): Card => ({ id: `job:${l.title}`, pill: <span className="pill">Scheduled</span>, title: l.title, foot: l.says, line: l });

  return (<>
    <HomeSky ref={sky} />
    <div className="feed proj-page home" onScroll={(ev) => sky.current?.scrolled(ev.currentTarget.scrollTop)}>
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
                <span className="home-held-actions">
                  <button type="button" className="btn small" disabled={busy === `aside:${h.ask}`} aria-label={`Remove ${h.title}`} onClick={() => setRemoving(h)}>Remove</button>
                  <button type="button" className="btn small primary" disabled={busy === h.ask} aria-label={busy === h.ask ? undefined : `Start the plan for ${h.title}`} onClick={() => void startPlan(h)}>{busy === h.ask ? "Starting…" : "Start plan"}</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {removing && (
        <Confirm title="Remove this plan?" action="Remove the plan" danger onConfirm={() => void removePlan(removing)} onCancel={() => setRemoving(null)}>
          <p>“{removing.title}”, approved {when(removing.held)}, comes off Ready to start and won't be started. Its conversation stays as it is.</p>
        </Confirm>
      )}

      {!day && home?.offers.map((o) => <OfferCard key={o.key} offer={o} onDone={() => void load()} />)}
      {!day && home?.night && <NightCard night={home.night} onOpenMemory={onOpenMemory} onDone={() => void load()} />}

      {brief && (
        <>
          {section("Waiting on you", brief.needs)}
          {section("In motion", brief.moving)}
          {cards("Your tickets", brief.tickets.map((l) => ticketCard(l, true)))}
          {cards("Upcoming", brief.next.map((l) => l.kind === "job" ? jobCard(l) : ticketCard(l, false)))}
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
              <div className="meta">{brief.done.requests} {plural(brief.done.requests, "request")}{brief.done.byMae ? `, ${brief.done.byMae} of them started by ${outpostName()}` : ""}{brief.done.cost ? ` · ${money(brief.done.cost)} at API prices` : ""}</div>
            </section>
          )}
          {!!brief.news?.length && (
            <section>
              <div className="section-label">AI news for {outpostName()} · {brief.news.length}</div>
              <ul className="list home-lines">
                {brief.news.map((x) => (
                  <li className="home-line" key={x.url}>
                    <span className="home-line-text">
                      <span className="home-line-title">{x.title}</span>
                      <span className="meta">{[x.says, x.why].filter(Boolean).join(" ")}</span>
                    </span>
                    <a className="home-line-out" href={x.url} target="_blank" rel="noopener noreferrer" title="Open the source" aria-label={`Open ${x.title} in a new tab`}><Icon name="link" /></a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {waiting > 0 && !day && (
            <div className="meta">{waiting} {plural(waiting, "suggestion")} from the {w("crew")} {waiting === 1 ? "is" : "are"} waiting for your say. <button type="button" className="linkish" onClick={onOpenMemory}>Look them over</button></div>
          )}
          {brief.notes.map((n) => <div className="meta bad" key={n}>{n}</div>)}
        </>
      )}

      {!day && cards("Recent work", recent.map((c) => ({
        id: c.id, tag: c.jira, meta: nameOf(c.project), pill: status(c), title: c.title,
        open: () => setView({ kind: "conversation", id: c.id }), foot: when(c.updated),
      })), false)}
    </div>
  </>);
}
