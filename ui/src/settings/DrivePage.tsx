// Two pages of Settings about the camp's own initiative.
//
// Stats: the scoreboard (src/reports.ts). How much of what you typed in a week was deciding
// something and how much was operating the pipeline, what the camp started by itself, how the
// pull requests went, and who on the crew did the work. It follows the chart rules the rest of
// the page keeps: figures wear text ink, one hue carries magnitude, a bar is thin, square at the
// baseline and rounded at the end that says how much, and every week is also there as a table.
//
// Automatic work (Settings → Automatic work): the switches for what Mae does without being asked.
// The morning brief and its time, the weekly retro, the ticket debrief, the night shift, and the
// watch on your pull requests, with the trigger that turns their feedback into work. Each says what
// it is in a line, with how it works behind a disclosure. Nothing here starts work that doesn't then
// wait for your OK. Activity keeps a summary of what's on, with a link here (AutomaticSummary).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { leadName, money, nameNow, plural, when } from "../format.ts";
import type { CampState, HomePage, Kind, Offer, WeekScore } from "../types.ts";

import { w } from "../words.ts";
export const KIND: Record<Kind, string> = {
  work: "Building and changing", feedback: "Bringing in review feedback", writeup: "Asking for a write-up",
  goahead: "Saying “go ahead”", question: "Asking how something is", review: "Asking for a review",
};
// The week the numbers are shown for: this one once it has anything in it, otherwise the last that had.
export function shownWeek(weeks: WeekScore[]): { week: WeekScore; before?: WeekScore } | null {
  for (let i = weeks.length - 1; i >= 0; i--) if (weeks[i].requests || weeks[i].byMae) return { week: weeks[i], before: weeks[i - 1] };
  return null;
}
const hours = (seconds: number) => (seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`);
const versus = (now: number, was: number | undefined, unit = "") => (was === undefined ? "" : now === was ? "same as the week before" : `${now > was ? "up" : "down"} from ${was}${unit} the week before`);

// The page both sections read (the same one Today reads).
export function useHome(project?: string) {
  const [home, setHome] = useState<HomePage | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => api<HomePage>(`/api/home${project ? `?project=${encodeURIComponent(project)}` : ""}`).then((h) => { setHome(h); setNote(""); }, (e) => setNote(errorText(e))), [project]);
  useEffect(() => { void load(); }, [load]);
  return { home, note, setNote, load };
}

// One headline number: what it is, the figure, and how it compares with the week before.
function Tile({ label, value, note, title }: { label: string; value: string; note?: string; title?: string }) {
  return (
    <div className="home-tile" title={title}>
      <div className="home-tile-label">{label}</div>
      <div className="home-tile-value">{value}</div>
      {note && <div className="home-tile-note">{note}</div>}
    </div>
  );
}

// Ranked bars on one baseline: a name, a bar, and its figure, largest first.
function Bars({ rows, total, unit }: { rows: { name: string; n: number }[]; total: number; unit: string }) {
  const most = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="home-bars" role="list">
      {rows.map((r) => (
        <div className="home-bar-row" role="listitem" key={r.name} title={`${r.name}: ${r.n} ${plural(r.n, unit)}${total ? ` (${Math.round((100 * r.n) / total)}%)` : ""}`}>
          <span className="home-bar-name">{r.name}</span>
          <span className="home-bar-track"><span className="home-bar" style={{ width: `${(100 * r.n) / most}%` }} /></span>
          <span className="home-bar-n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Stats ----------
export function StatsPage({ S }: { S: CampState }) {
  const [project, setProject] = useState("");
  const { home, note } = useHome(project || undefined);
  const projects = S.history.projects.filter((p) => p.id !== "general");
  const shown = home ? shownWeek(home.board.weeks) : null;
  return (
    <div className="stats-page">
      <p className="panel-note">How much of what you type is deciding something, and how much is operating the pipeline: counted from the {w("camp")}'s own record, week by week. What kind a request is, is read from how it's worded: a rough sort, good for a trend.</p>
      {projects.length > 0 && (
        <label className="stats-pick">Show{" "}
          <select value={project} onChange={(ev) => setProject(ev.target.value)}>
            <option value="">everything</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {note && <div className="meta bad" role="alert">{note}</div>}
      {!home ? <div className="meta">Counting…</div> : !shown ? <div className="meta">Nothing has been asked of the {w("crew")} in the last five weeks, so there's nothing to count yet.</div> : (
        <>
          <div className="section-label">The week of {shown.week.label}</div>
          <div className="home-tiles">
            <Tile label="Requests you typed" value={String(shown.week.requests)} note={versus(shown.week.requests, shown.before?.requests || undefined)} />
            <Tile label="Spent operating" value={`${shown.week.operating}%`} note={versus(shown.week.operating, shown.before?.requests ? shown.before.operating : undefined, "%")}
              title="The share of what you typed that was running the pipeline (bringing in review feedback, asking for a write-up, saying go ahead) rather than deciding something. Lower is better." />
            <Tile label="Started by Mae" value={String(shown.week.byMae)} note={shown.week.byMae ? "runs a trigger began for you" : "nothing yet: no trigger is on"} />
            {shown.week.perTicket !== null && <Tile label="Requests per ticket" value={String(Math.round(shown.week.perTicket * 10) / 10)} note="the typical ticket this week" />}
            <Tile label="Pull requests merged" value={String(shown.week.prs.merged)}
              note={shown.week.prs.merged ? [shown.week.prs.rounds !== null ? `${shown.week.prs.rounds} ${plural(shown.week.prs.rounds, "round")} of review` : "", shown.week.prs.hoursToMerge !== null ? `${Math.round(shown.week.prs.hoursToMerge)} h open` : ""].filter(Boolean).join(", ") : `${shown.week.prs.opened} opened`} />
            <Tile label={`${w("Crew")} time`} value={hours(shown.week.seconds)} note={`${money(shown.week.cost)} at API prices`} />
          </div>
          <div className="home-breakdown">
            <div>
              <div className="home-sub">What you asked for</div>
              <Bars unit="request" total={shown.week.requests} rows={(Object.entries(shown.week.kinds) as [Kind, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ name: KIND[k], n }))} />
            </div>
            <div>
              <div className="home-sub">Who did the work</div>
              <Bars unit="run" total={shown.week.crew.reduce((n, c) => n + c.runs, 0)} rows={shown.week.crew.map((c) => ({ name: c.who, n: c.runs }))} />
            </div>
          </div>
          <div className="section-label">Week by week</div>
          <table className="payoff stats-weeks">
            <thead><tr><th scope="col">Week of</th><th scope="col">You typed</th><th scope="col">Operating</th><th scope="col">Started by Mae</th><th scope="col">Merged</th><th scope="col">{w("Crew")} time</th><th scope="col">Used</th></tr></thead>
            <tbody>
              {[...home.board.weeks].reverse().map((w) => (
                <tr key={w.week}><th scope="row">{w.label.replace(/,.*$/, "")}</th><td>{w.requests}</td><td>{w.requests ? `${w.operating}%` : "–"}</td><td>{w.byMae}</td><td>{w.prs.merged}</td><td>{w.seconds ? hours(w.seconds) : "–"}</td><td>{w.cost ? money(w.cost) : "–"}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ---------- Automatic work ----------
// One thing the camp could take over, with the one click that turns it on (also shown on Today).
export function OfferCard({ offer, onDone }: { offer: Offer; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function on() {
    setBusy(true); setNote("");
    try { await api("/api/triggers", { action: "add", trigger: offer.trigger }); onDone(); } catch (e) { setNote(errorText(e)); }
    setBusy(false);
  }
  return (
    <section className="home-offer">
      <div className="card-top"><span className="who"><Icon name="spark" /> {offer.what}</span><span className="pill live">Mae could take this over</span></div>
      <p>{offer.why}</p>
      <div className="card-actions">
        <button type="button" className="btn small primary" disabled={busy} onClick={on}>{busy ? "Turning it on…" : "Turn it on"}</button>
        <span className="meta">{note || "It only starts work for what arrives from now on, and you can switch it off again here."}</span>
      </div>
    </section>
  );
}

// The rest of what a switch does, one press away: the line above it says what it is.
function More({ children }: { children: ReactNode }) {
  return <details className="set-more"><summary>How it works</summary><p>{children}</p></details>;
}

export function AutomaticPage({ S, refresh, onOpenSection }: { S: CampState; refresh: () => void; onOpenSection: (s: "memory" | "jobs" | "inbox" | "skills") => void }) {
  const { home, note, setNote, load } = useHome();
  const [busy, setBusy] = useState<string | null>(null);
  const doing = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setNote("");
    try { await work(); await load(); refresh(); } catch (e) { setNote(errorText(e)); }
    setBusy(null);
  };
  const projects = S.history.projects.filter((p) => p.id !== "general");
  const watching = (S.triggers ?? []).filter((t) => t.kind === "github-pr");
  if (!home) return <div className="meta" role="status">{note || "Loading…"}</div>;
  const d = home.drive;
  return (
    <div className="unasked-page">
      <p className="panel-note">What the {w("camp")} does before you ask, while {w("hq")} is open. All of it prepares and proposes: nothing is kept or sent until you approve it.</p>
      {note && <div className="meta bad" role="alert">{note}</div>}

      <div className="set-row">
        <div className="set-label"><b>Morning brief</b>
          <p>Each weekday, where your work stands: what's waiting on you, your tickets and your latest notes.</p>
          <More>Written from the {w("camp")}'s record and one look at GitHub and Jira; no model is called. It lists what's waiting on you, your tickets, what's upcoming and your latest notes. It opens on Today, and goes to the inbox and your phone (without your notes).</More></div>
        <div className="set-control unasked-control">
          <label className="switch"><input type="checkbox" checked={d.brief} disabled={busy === "drive"} onChange={(ev) => doing("drive", () => api("/api/drive", { brief: ev.target.checked }))} /> {d.brief ? "On, at" : "Off"}</label>
          {d.brief && <input type="time" aria-label="When the morning brief is written" value={d.briefAt} disabled={busy === "drive"} onChange={(ev) => ev.target.value && doing("drive", () => api("/api/drive", { briefAt: ev.target.value }))} />}
          <button type="button" className="btn small" disabled={busy === "brief"} onClick={() => doing("brief", () => api("/api/brief", {}))}>{busy === "brief" ? "Writing…" : "Write one now"}</button>
        </div>
      </div>

      {d.brief && (
        <div className="set-row">
          <div className="set-label"><b>AI news in the brief</b>
            <p>The brief also lists up to six recent things in AI that could help this {w("camp")}.</p>
            <More>News, new model and API features, best practices for agents, and trends, each with its link and a line on how it could help here. This part is a model call: once a day the smallest model searches the web (a few searches). Links aren't repeated from the last two weeks, and nothing changes because of them: they're for you to read.</More></div>
          <div className="set-control unasked-control">
            <label className="switch"><input type="checkbox" checked={!!d.briefNews} disabled={busy === "drive"} onChange={(ev) => doing("drive", () => api("/api/drive", { briefNews: ev.target.checked }))} /> {d.briefNews ? "On" : "Off"}</label>
          </div>
        </div>
      )}

      <div className="set-row">
        <div className="set-label"><b>Weekly retro</b>
          <p>On Friday afternoon, up to five things from the week worth keeping, for you to approve.</p>
          <More>The smallest model reads what you asked for that week and what reviewers said on your pull requests, and proposes up to five things worth keeping. If you asked for the same kind of work three times or more in the last four weeks, it also drafts a how-to for it. Two small calls per project per week; nothing is kept until you approve it in the Inbox.</More>
          {home.retros.map((r) => (
            <p key={`${r.project}:${r.week}`}>{r.name}, {r.label}: read {r.requests} {plural(r.requests, "request")} and {r.heard} reviewer {plural(r.heard, "comment")}, and proposed {r.proposed.length} {plural(r.proposed.length, "thing")} to keep.
              {r.proposed.length > 0 && <> <button type="button" className="linkish" onClick={() => onOpenSection("memory")}>Look them over</button></>}
              {r.skill && <> It drafted a how-to, <code>{r.skill}</code>, for work you kept asking for. <button type="button" className="linkish" onClick={() => onOpenSection("skills")}>Review the draft</button></>}</p>
          ))}
        </div>
        <div className="set-control unasked-control">
          <label className="switch"><input type="checkbox" checked={d.retro} disabled={busy === "drive"} onChange={(ev) => doing("drive", () => api("/api/drive", { retro: ev.target.checked }))} /> {d.retro ? "On" : "Off"}</label>
          {projects.map((p) => (
            <button key={p.id} type="button" className="btn small" disabled={busy === `retro:${p.id}`} onClick={() => doing(`retro:${p.id}`, () => api("/api/retro", { id: p.id }))}>{busy === `retro:${p.id}` ? "Reading the week…" : `Hold ${p.name}'s now`}</button>
          ))}
        </div>
      </div>

      <div className="set-row">
        <div className="set-label"><b>Ticket debrief</b>
          <p>When a ticket is done, what went well and what could have gone better, written on the ticket.</p>
          <More>When a ticket is done (a Mae ticket reaching Done, or a Jira ticket's pull request merging), the smallest model reads how the {w("crew")} did on it (the plan, each {w("quest")} and how it ended, what reviews and checks caught, what you had to ask for twice) and writes what went well and what could have gone better on the ticket. It proposes up to four lessons for the {leadName()}, the {w("crew")} or the project. One small call per ticket; nothing is kept until you approve it in the Inbox.</More>
        </div>
        <div className="set-control unasked-control">
          <label className="switch"><input type="checkbox" checked={d.debrief} disabled={busy === "drive"} onChange={(ev) => doing("drive", () => api("/api/drive", { debrief: ev.target.checked }))} /> {d.debrief ? "On" : "Off"}</label>
        </div>
      </div>

      <div className="set-row">
        <div className="set-label"><b>Night shift</b>
          <p>While the {w("camp")} sits idle at night, it drafts memory tidy-ups for you to approve.</p>
          <More>Off unless you turn it on. Between these hours, once the {w("camp")} has sat idle for half an hour, it drafts shorter versions of the memories that are getting full, lists old lines worth a look, and notes what housekeeping could clear. It only drafts and reports: nothing is applied, deleted or changed until you approve it. It makes at most three small model calls a night, and waits while your usage limit is used up.</More>
          {home.lastNight && <p className="night-last">Last night shift, {when(home.lastNight.finished)}: {home.lastNight.line}</p>}
        </div>
        <div className="set-control unasked-control">
          <label className="switch"><input type="checkbox" checked={d.night === true} disabled={busy === "drive"} onChange={(ev) => doing("drive", () => api("/api/drive", { night: ev.target.checked }))} /> {d.night ? "On, from" : "Off"}</label>
          {d.night && <>
            <input type="time" aria-label="When the night shift may start" value={d.nightFrom ?? "01:00"} disabled={busy === "drive"} onChange={(ev) => ev.target.value && doing("drive", () => api("/api/drive", { nightFrom: ev.target.value }))} />
            <span className="meta">to</span>
            <input type="time" aria-label="When the night shift stops" value={d.nightTo ?? "05:00"} disabled={busy === "drive"} onChange={(ev) => ev.target.value && doing("drive", () => api("/api/drive", { nightTo: ev.target.value }))} />
          </>}
          <button type="button" className="btn small" disabled={busy === "night"} onClick={() => doing("night", () => api("/api/night", {}))}>{busy === "night" ? "Working…" : "Run it now"}</button>
        </div>
      </div>

      <div className="set-row">
        <div className="set-label"><b>Your pull requests</b>
          <p>The {w("camp")} follows the pull requests you opened in linked repositories. {home.pulls.error ? `They couldn't be read: ${home.pulls.error}` : home.pulls.fetched ? `Last read ${when(home.pulls.fetched)}: ${home.pulls.count} open.` : "They haven't been read yet."}</p>
          <More>It follows them wherever their branches live, reading them again every ten minutes. One that needs you (review comments, a failed check, ready to merge) is listed in the Inbox.</More></div>
        <div className="set-control unasked-control">
          <label className="switch"><input type="checkbox" checked={S.settings.prWatch} disabled={busy === "watch"} onChange={(ev) => doing("watch", () => api("/api/pr-watch", { on: ev.target.checked }))} /> {S.settings.prWatch ? "Watching" : "Not watching"}</label>
        </div>
      </div>

      <div className="set-row wide">
        <div className="set-label"><b>Feedback on a pull request starts work</b>
          <p>A trigger per repository: new review comments or a failed check become a plan for you to approve.</p>
          <More>New review comments or a failed check carry on the conversation that did the work, as a plan for you to approve. It can also have the {nameNow("Scribe")} redraft the description after each push, for you to approve.</More></div>
        <div className="set-control">
          {watching.length > 0 && (
            <ul className="list">
              {watching.map((t) => (
                <li className="card" key={t.name}>
                  <div className="card-top"><span className="who"><Icon name="flag" /> {t.name}</span><span className="pill">links/{t.link}{t.describe ? " · descriptions kept current" : ""}</span></div>
                  <div className="meta">{t.lastPoll ? `Checked ${when(t.lastPoll)}` : "Not checked yet"}{t.lastError ? ` · last check failed: ${t.lastError}` : ""}</div>
                  <div className="card-actions">
                    <label className="switch"><input type="checkbox" checked={t.enabled} disabled={busy === t.name} onChange={(ev) => doing(t.name, () => api("/api/triggers", { name: t.name, action: ev.target.checked ? "enable" : "disable" }))} /> {t.enabled ? "On" : "Off"}</label>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {home.offers.map((o) => <OfferCard key={o.key} offer={o} onDone={() => { void load(); refresh(); }} />)}
          {!watching.length && !home.offers.length && <div className="meta">No repository has one yet. The {w("camp")} offers it here once it sees you bringing review comments in by hand.</div>}
          <div className="meta">Change what a trigger says, or add one for issues or Jira tickets, under <button type="button" className="linkish" onClick={() => onOpenSection("jobs")}>Scheduled jobs</button>.</div>
        </div>
      </div>
    </div>
  );
}

// What Activity shows of it: which of these are on, and the way to the switches.
export function AutomaticSummary({ S, onOpen }: { S: CampState; onOpen: () => void }) {
  const { home, note } = useHome();
  if (!home) return <div className="meta" role="status">{note || "Loading…"}</div>;
  const d = home.drive;
  const rows: [string, string, boolean][] = [
    ["Morning brief", d.brief ? `On, at ${d.briefAt}` : "Off", d.brief],
    ...(d.brief ? [["AI news in the brief", d.briefNews ? "On" : "Off", !!d.briefNews] as [string, string, boolean]] : []),
    ["Weekly retro", d.retro ? "On" : "Off", d.retro],
    ["Ticket debrief", d.debrief ? "On" : "Off", d.debrief],
    ["Night shift", d.night ? `On, from ${d.nightFrom ?? "01:00"} to ${d.nightTo ?? "05:00"}` : "Off", d.night === true],
    ["Your pull requests", S.settings.prWatch ? "Watching" : "Not watching", S.settings.prWatch],
  ];
  const triggers = (S.triggers ?? []).filter((t) => t.kind === "github-pr" && t.enabled).length;
  return (
    <div className="unasked-page auto-summary">
      <p className="panel-note">What the {w("camp")} does before you ask. The switches are in Settings. <button type="button" className="linkish" onClick={onOpen}>Open Settings, Automatic work</button></p>
      <ul className="auto-list" aria-label="Automatic work">
        {rows.map(([name, state, on]) => <li key={name}><b>{name}</b><span className={on ? "auto-on" : "meta"}>{state}</span></li>)}
        <li><b>Feedback on a pull request starts work</b><span className={triggers ? "auto-on" : "meta"}>{triggers ? `On for ${triggers} ${plural(triggers, "repository", "repositories")}` : "Off"}</span></li>
      </ul>
    </div>
  );
}
