// The Tickets page: Mae's own tickets, for work that isn't tracked in Jira, and (when Jira is
// connected) the tickets the camp's Jira filter pulls in, as one set of cards. A Mae ticket
// carries Mae's mark; the Mae / Jira chips narrow the page to one or the other.
//
// Mae tickets: starting work on one moves it to In progress, and its pull request merging moves
// it to Done; you can move it either way yourself. A Mae ticket opens over whatever page you're
// on (MaeTicketDialog), so a note that was filed as one can open it too. Notes and plans become
// tickets through DraftTicketsDialog: the small model splits the text into pieces of work, and
// you choose which to file.
//
// Jira tickets: which ones is one setting for the whole camp, kept with the Jira account under
// Settings → Connectors; the page says which filter is in use and links there. Narrowing what's
// on the page never asks Jira again. A Jira card opens the whole ticket (JiraTicket.tsx), and
// the cards can be grouped under their epics. Nothing here writes to Jira.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { cx, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { Presence } from "../motion.tsx";
import { loadNotes, titleOf, useNotes } from "../notes.ts";
import type { CampState, JiraCard, JiraPull, JiraRef, MaeTicket, TicketDraft, TicketFrom, TicketStatus } from "../types.ts";
import {
  STATUS_NAMES, STATUS_ORDER, closeDrafting, closeTicket, createTicket, createTickets, draftTicket, draftTickets, loadPlans, loadTickets, newTicket, removeTicket, roughTicket, showTicket,
  turnIntoTickets, updateTicket, useTickets, type DraftAsk, type PlanSource, type TicketInput,
} from "../tickets.ts";
import { Icon } from "./bits.tsx";
import { ask } from "./Confirm.tsx";
import { filterName } from "./Jira.tsx";
import { GROUPS, JiraTicket, pillOf, type TicketStart } from "./JiraPage.tsx";
import { MaeMark } from "./MaeLogo.tsx";
import { TicketDebrief } from "./TicketDebrief.tsx";

const DONE_SHOWN = 12; // Mae's Done grows for ever: the latest few, and the rest on asking
const SOURCE_KEY = "camp-tickets-source";
const EPIC_KEY = "camp-jira-by-epic";
// What's being worked on first, then what's waiting, then what's done; each kind keeps its own order within.
const RANK: Record<TicketStatus, number> = { doing: 0, todo: 1, done: 2 };

// The ticket as Markdown, as it's copied out (the camp's own copy, attached to a message, is the same).
export function ticketMarkdown(t: MaeTicket, projectName?: string): string {
  const facts = [`Status: ${STATUS_NAMES[t.status]}`, t.priority && `Priority: ${t.priority}`, projectName && `Project: ${projectName}`, t.labels.length && `Labels: ${t.labels.join(", ")}`].filter(Boolean).join(" · ");
  const criteria = t.criteria.length ? `## Acceptance criteria\n${t.criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\n` : "";
  return `# ${t.key}: ${t.title}\n\n${facts}\n\n${criteria}${t.description ? `${t.description}\n` : ""}`;
}

// One card on the page, whichever kind of ticket it is.
type Card =
  | { source: "mae"; key: string; title: string; group: TicketStatus; labels: string[]; text: string; mae: MaeTicket }
  | { source: "jira"; key: string; title: string; group: TicketStatus; labels: string[]; text: string; jira: JiraCard };
type Source = "" | "mae" | "jira";

// onAttach: put a ticket on the message being written. onFilter: go and change which Jira tickets
// are pulled in (Settings → Connectors). onStart: pick a ticket up (the kickoff stepper, on that
// ticket). onKickoff: the stepper from its first step.
type PageProps = {
  S: CampState;
  onAttach: (issue: Pick<JiraRef, "key" | "summary">) => void;
  onFilter: () => void;
  onStart: (start: TicketStart) => void;
  onKickoff?: () => void;
};

export function TicketsPage({ S, onAttach, onFilter, onStart, onKickoff }: PageProps) {
  const jiraOn = !!S.jira?.connected;
  const { tickets: mae, loaded, error: maeError } = useTickets();
  useEffect(() => { if (!loaded) void loadTickets(); }, [loaded]);

  // Ask Jira for what the filter matches: on arriving, when the filter is changed in Settings, and on Refresh.
  const [pull, setPull] = useState<JiraPull | null>(null);
  const [jiraError, setJiraError] = useState("");
  const [busy, setBusy] = useState(false);
  const filter = S.jira?.filter ?? "";
  const load = useCallback(async () => {
    setBusy(true); setJiraError("");
    try { setPull(await api<JiraPull>("/api/jira/tickets")); } catch (e) { setJiraError(errorText(e)); }
    setBusy(false);
  }, []);
  useEffect(() => { if (jiraOn) void load(); }, [load, filter, jiraOn]);

  const [words, setWords] = useState("");       // narrowing what's on the page
  const [source, setSourceNow] = useState<Source>(() => { const s = storeGet(SOURCE_KEY); return s === "mae" || s === "jira" ? s : ""; });
  const setSource = (s: Source) => { setSourceNow(s); storeSet(SOURCE_KEY, s); };
  const [group, setGroup] = useState<TicketStatus | "">("");
  const [type, setType] = useState("");         // Jira's issue types: Mae tickets have none
  const [epic, setEpic] = useState("");          // an epic's key, or "none" for tickets in no epic
  const [project, setProject] = useState("");    // the camp's projects: Jira tickets are in none
  const [byEpic, setByEpic] = useState(() => storeGet(EPIC_KEY) === "1");
  const [allDone, setAllDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // the Jira ticket open over the page
  const projects = S.history.projects.filter((p) => p.id !== "general");
  const nameOf = (id?: string) => (id ? projects.find((p) => p.id === id)?.name ?? id : undefined);

  const jira = useMemo(() => (jiraOn ? pull?.tickets ?? [] : []), [jiraOn, pull]);
  const all = useMemo<Card[]>(() => {
    const ours: Card[] = mae.map((t) => ({ source: "mae", key: t.key, title: t.title, group: t.status, labels: t.labels, mae: t,
      text: `${t.key} ${t.title} ${t.labels.join(" ")} ${t.priority ?? ""} ${t.description} mae` }));
    const theirs: Card[] = jira.map((t) => ({ source: "jira", key: t.key, title: t.summary, group: t.group, labels: t.labels, jira: t,
      text: `${t.key} ${t.summary} ${t.assignee ?? ""} ${t.labels.join(" ")} ${t.status ?? ""} ${t.epic?.key ?? ""} ${t.epic?.summary ?? ""} jira` }));
    return [...ours, ...theirs].sort((a, b) => RANK[a.group] - RANK[b.group]);
  }, [mae, jira]);
  const types = useMemo(() => [...new Set(jira.map((t) => t.type).filter((t): t is string => !!t))].sort(), [jira]);
  // The epics the Jira tickets on the page are in, the busiest first.
  const epics = useMemo(() => {
    const by = new Map<string, { key: string; summary: string; type: string | null; n: number }>();
    for (const t of jira) if (t.epic) by.set(t.epic.key, { ...t.epic, n: (by.get(t.epic.key)?.n ?? 0) + 1 });
    return [...by.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }, [jira]);

  // A filter a ticket has nothing for leaves it out: a type or an epic means Jira's, a project means Mae's.
  const fits = (c: Card) => {
    if (type && (c.source !== "jira" || c.jira.type !== type)) return false;
    if (epic && (c.source !== "jira" || (epic === "none" ? !!c.jira.epic : c.jira.epic?.key !== epic))) return false;
    if (project && (c.source !== "mae" || (project === "none" ? !!c.mae.project : c.mae.project !== project))) return false;
    const w = words.toLowerCase().split(/\s+/).filter(Boolean);
    return w.every((x) => c.text.toLowerCase().includes(x));
  };
  const whose = all.filter((c) => !source || c.source === source);
  const counts = { todo: 0, doing: 0, done: 0 }; // what the status chips count: whose they are, and nothing narrower
  for (const c of whose) counts[c.group]++;
  const shown = whose.filter((c) => fits(c) && (!group || c.group === group));
  const narrowed = !!(words.trim() || group || type || epic || project);
  // Done Mae tickets pile up: unless Done is asked for, the latest few.
  const doneMae = shown.flatMap((c) => (c.source === "mae" && c.group === "done" ? [c.mae] : []));
  const cut = !allDone && group !== "done" && doneMae.length > DONE_SHOWN;
  const kept = cut ? new Set(doneMae.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, DONE_SHOWN).map((t) => t.key)) : null;
  const drawn = kept ? shown.filter((c) => c.source !== "mae" || c.group !== "done" || kept.has(c.key)) : shown;

  // Grouped: one section per epic, then the tickets that are in none (Mae's among them).
  const grouped = byEpic && epics.length > 0 && source !== "mae";
  type Section = { epic: (typeof epics)[number] | null; list: Card[]; titled: boolean };
  let sections: Section[] = [{ epic: null, list: drawn, titled: false }];
  if (grouped) {
    const loose = drawn.filter((c) => c.source === "mae" || !c.jira.epic);
    sections = epics.map((e) => ({ epic: e, list: drawn.filter((c) => c.source === "jira" && c.jira.epic?.key === e.key), titled: true })).filter((x) => x.list.length);
    if (loose.length) sections.push({ epic: null, list: loose, titled: true });
  }
  const clear = () => { setWords(""); setGroup(""); setType(""); setEpic(""); setProject(""); setSource(""); };

  const maeCount = all.filter((c) => c.source === "mae").length;
  const jiraCount = all.length - maeCount;
  const jiraShown = jiraOn && source !== "mae";
  const nothing = loaded && !maeCount && (!jiraOn || (pull && !jiraCount));
  return (
    <div className="feed proj-page jira-page tickets-page">
      <header className="proj-head">
        <div>
          <h2>Tickets</h2>
          <div className="meta">Mae's own tickets, for work that isn't in Jira: starting work on one moves it to In progress, and its pull request merging moves it to Done.</div>
          {jiraOn && <div className="meta">Jira: {S.jira?.siteUrl?.replace(/^https?:\/\//, "")}{S.jira?.displayName ? ` · ${S.jira.displayName}` : ""} · {S.settings?.jiraWrite?.on ? "the camp comments on a ticket as its work moves along (started, ready to look over, pull request opened, merged)." : "read-only: nothing here changes a ticket."}</div>}
        </div>
        <div className="proj-actions">
          {onKickoff && <button type="button" className="btn small" title="Pick up a ticket: choose it, check its details, say where and who, and start" onClick={onKickoff}>Start a ticket…</button>}
          {jiraOn && <button type="button" className="btn small" disabled={busy} title="Ask Jira again" onClick={() => load()}>{busy ? "Asking Jira…" : "Refresh"}</button>}
          <button type="button" className="btn small primary" onClick={() => newTicket(project && project !== "none" ? { project } : {})}><Icon name="plus" /> New ticket</button>
        </div>
      </header>

      {jiraShown && (
        <div className="proj-about jira-using">
          <span><span className="section-label">Jira shows</span> {filterName(filter) ?? <code>{filter}</code>}</span>
          <button type="button" className="linkish" title="Which tickets are pulled in is a setting for the whole camp, kept with the Jira account" onClick={onFilter}>Change the filter in Settings</button>
        </div>
      )}
      {maeError && <div className="form-error" role="alert">{maeError}</div>}
      {jiraShown && jiraError && <div className="form-error" role="alert">{jiraError}</div>}

      {all.length > 0 && (
        <div className="jira-narrow" role="group" aria-label="Narrow what's shown">
          <input aria-label="Narrow by words" className="hist-search" placeholder={jiraOn ? "Narrow by key, words, person or label…" : "Narrow by key, words or label…"} value={words} onChange={(ev) => setWords(ev.target.value)} />
          {jiraOn && (
            <span className="ticket-sources" role="group" aria-label="Whose tickets">
              <button type="button" className={cx("jira-chip", source === "mae" && "on")} aria-pressed={source === "mae"} title="Only Mae's own tickets" onClick={() => setSource(source === "mae" ? "" : "mae")}><MaeMark />Mae <small>{maeCount}</small></button>
              <button type="button" className={cx("jira-chip", source === "jira" && "on")} aria-pressed={source === "jira"} title="Only the tickets from Jira" onClick={() => setSource(source === "jira" ? "" : "jira")}>Jira <small>{jiraCount}</small></button>
            </span>
          )}
          {STATUS_ORDER.filter((g) => counts[g] > 0 || group === g).map((g) => (
            <button key={g} type="button" className={cx("jira-chip", group === g && "on")} aria-pressed={group === g} onClick={() => setGroup(group === g ? "" : g)}>{GROUPS[g]} <small>{counts[g]}</small></button>
          ))}
          {/* The selects sit together and stay on one line: an epic's name can be long, and would otherwise push its dropdown down a row. */}
          {((jiraShown && (types.length > 1 || epics.length > 0)) || (source !== "jira" && maeCount > 0 && projects.length > 0)) && (
            <span className="jira-selects">
              {jiraShown && types.length > 1 && (
                <select aria-label="Type" value={type} onChange={(ev) => setType(ev.target.value)}>
                  <option value="">Every type</option>
                  {types.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
              {jiraShown && epics.length > 0 && (
                <select aria-label="Epic" value={epic} title={epics.find((e) => e.key === epic)?.summary} onChange={(ev) => setEpic(ev.target.value)}>
                  <option value="">Every epic</option>
                  {epics.map((e) => <option key={e.key} value={e.key}>{e.key} · {e.summary} ({e.n})</option>)}
                  <option value="none">In no epic</option>
                </select>
              )}
              {source !== "jira" && maeCount > 0 && projects.length > 0 && (
                <select aria-label="Project" title="The camp project a Mae ticket is filed under" value={project} onChange={(ev) => setProject(ev.target.value)}>
                  <option value="">Every project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="none">In no project</option>
                </select>
              )}
            </span>
          )}
          {jiraShown && epics.length > 0 && (
            <button type="button" className={cx("jira-chip", byEpic && "on")} aria-pressed={byEpic} title="Put the Jira cards under the epic each is in"
              onClick={() => setByEpic((on) => { storeSet(EPIC_KEY, on ? "0" : "1"); return !on; })}>Group by epic</button>
          )}
          <span className="meta jira-count">{narrowed || source ? `${shown.length} of ${all.length}` : `${all.length} ${all.length === 1 ? "ticket" : "tickets"}`}{jiraShown && pull?.more ? " (Jira's first 60: narrow the filter for the rest)" : ""}</span>
        </div>
      )}

      {(!loaded || (jiraShown && !pull && !jiraError)) && <div className="meta">{!loaded ? "Loading the tickets…" : "Asking Jira…"}</div>}
      {nothing && (
        <div className="hist-empty tickets-empty">
          <b>No tickets yet.</b>
          <span>Write one with New ticket, turn a note or a plan into tickets (Turn into tickets, on the note or the plan), or ask the Quartermaster to file them.{jiraOn ? " Jira's filter matches nothing right now." : ""}</span>
        </div>
      )}
      {all.length > 0 && !shown.length && <div className="hist-empty">Nothing on the page matches. <button type="button" className="linkish" onClick={clear}>Show them all</button></div>}
      {sections.map((sec) => (
        <section key={sec.epic?.key ?? "none"} className="jira-section" aria-label={sec.titled ? (sec.epic ? `${sec.epic.key}: ${sec.epic.summary}` : "In no epic") : undefined}>
          {sec.titled && (sec.epic ? (
            <button type="button" className="jira-epic-head" title="Open this epic" onClick={() => setOpen(sec.epic!.key)}>
              <span className="jira-key">{sec.epic.key}</span><b>{sec.epic.summary || sec.epic.type || "Epic"}</b><span className="meta">{sec.list.length} {sec.list.length === 1 ? "ticket" : "tickets"} here</span>
            </button>
          ) : <div className="jira-epic-head loose"><b>In no epic</b><span className="meta">{sec.list.length} {sec.list.length === 1 ? "ticket" : "tickets"}</span></div>)}
          <div className="proj-grid jira-grid">
            {sec.list.map((c) => c.source === "mae" ? (
              <button key={c.key} type="button" className="proj-card jira-card ticket-card" aria-label={`${c.key}: ${c.title}`} onClick={() => showTicket(c.key)}>
                <span className="jira-card-top"><MaeMark title="Mae ticket" /><span className="jira-key">{c.key}</span>{c.mae.priority && <span className={cx("ticket-priority", c.mae.priority)}>{c.mae.priority}</span>}<span className={pillOf(c.group)}>{STATUS_NAMES[c.group]}</span></span>
                <b>{c.title}</b>
                <Labels list={c.labels} />
                <span className="meta">{[nameOf(c.mae.project), c.mae.criteria.length ? `${c.mae.criteria.length} ${c.mae.criteria.length === 1 ? "criterion" : "criteria"}` : "", `changed ${when(c.mae.updated)}`].filter(Boolean).join(" · ")}</span>
              </button>
            ) : (
              <button key={c.key} type="button" className="proj-card jira-card" aria-label={`${c.key}: ${c.title}`} onClick={() => setOpen(c.key)}>
                <span className="jira-card-top"><span className="jira-key">{c.key}</span>{c.jira.type && <span className="meta">{c.jira.type}</span>}<span className={pillOf(c.group)}>{c.jira.status ?? GROUPS[c.group]}</span></span>
                <b>{c.title}</b>
                {c.jira.epic && !sec.titled && <span className="jira-epic" title={`In ${c.jira.epic.type ?? "its parent"} ${c.jira.epic.key}`}><Icon name="bookmark" />{c.jira.epic.key}{c.jira.epic.summary ? ` · ${c.jira.epic.summary}` : ""}</span>}
                <Labels list={c.labels} />
                <span className="meta">{[c.jira.priority, c.jira.assignee ?? "Unassigned", c.jira.updated ? `changed ${when(c.jira.updated)}` : ""].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {cut && <button type="button" className="linkish tickets-more" onClick={() => setAllDone(true)}>Show all {doneMae.length} done Mae tickets</button>}
      <Presence>{open && <JiraTicket key={open} id={open} summary={jira.find((t) => t.key === open)?.summary ?? epics.find((e) => e.key === open)?.summary ?? ""}
        onClose={() => setOpen(null)} onOpen={setOpen} onAttach={(i) => { onAttach(i); setOpen(null); }} onStart={(st) => { setOpen(null); onStart(st); }} />}</Presence>
    </div>
  );
}

const Labels = ({ list }: { list: string[] }) => (list.length > 0
  ? <span className="jira-labels">{list.slice(0, 4).map((l) => <span key={l} className="jira-label">{l}</span>)}{list.length > 4 && <span className="meta">+{list.length - 4}</span>}</span>
  : null);

// One Mae ticket over the page: read it, move it along, change it, or pick it up.
// Drawn by the app for whichever ticket is showing (tickets.ts), new ones included.
export function MaeTicketDialog({ S, onAttach, onStart, onOpenConversation }: {
  S: CampState; onAttach?: (issue: Pick<JiraRef, "key" | "summary">) => void; onStart?: (start: TicketStart) => void; onOpenConversation: (id: string) => void;
}) {
  const { tickets, showing } = useTickets();
  const fresh = showing && "fresh" in showing ? showing.fresh : null;
  const t = showing && "key" in showing ? tickets.find((x) => x.key === showing.key) : undefined;
  const [editing, setEditing] = useState(!!fresh);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const projects = S.history.projects.filter((p) => p.id !== "general");
  const nameOf = (id?: string) => (id ? projects.find((p) => p.id === id)?.name ?? id : undefined);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") closeTicket(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  if (!showing) return null;
  const gone = !fresh && !t;

  async function move(status: TicketStatus) {
    if (!t || t.status === status) return;
    setError("");
    try { await updateTicket(t.key, { status }); } catch (e) { setError(errorText(e)); }
  }
  async function remove() {
    if (!t || !await ask({ title: `Delete ${t.key}?`, body: `“${t.title}” is deleted for good, and its key isn't used again.`, action: "Delete ticket", danger: true })) return;
    try { await removeTicket(t.key); closeTicket(); } catch (e) { setError(errorText(e)); }
  }
  async function copy() {
    if (!t) return;
    try { await navigator.clipboard.writeText(ticketMarkdown(t, nameOf(t.project))); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here */ }
  }
  async function save(input: TicketInput) {
    setBusy(true); setError("");
    try {
      if (t) { await updateTicket(t.key, input); setEditing(false); }
      else { const made = await createTicket(input); showTicket(made.key); setEditing(false); }
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  const worked = t ? S.history.conversations.filter((c) => c.ticket === t.key) : [];
  const title = t ? `${t.key}: ${t.title}` : "New ticket";
  return (
    <>
      <div className="drawer-backdrop" onClick={closeTicket} />
      <div className="dialog file-view jira-ticket mae-ticket" role="dialog" aria-modal="true" aria-label={title}>
        <header className="file-head">
          {t ? <><span className="jira-key">{t.key}</span><b>{t.title}</b></> : <b>{gone ? "That ticket isn't there any more" : "New ticket"}</b>}
          {t && !editing && (
            <span className="ticket-moves" role="group" aria-label="Status">
              {STATUS_ORDER.map((s) => <button key={s} type="button" className={cx("jira-chip", t.status === s && "on")} aria-pressed={t.status === s} onClick={() => void move(s)}>{STATUS_NAMES[s]}</button>)}
            </span>
          )}
          <button type="button" className="hist-icon" aria-label="Close the ticket" title="Close (Esc)" onClick={closeTicket}>×</button>
        </header>
        {error && <div className="form-error" role="alert">{error}</div>}
        {gone ? <div className="file-body"><div className="meta">It was deleted, maybe in another tab.</div></div>
          : editing || !t ? (
            <TicketForm key={t?.key ?? "new"} start={t ?? fresh ?? {}} projects={projects} busy={busy} onSave={save}
              onCancel={() => (t ? setEditing(false) : closeTicket())} saveLabel={t ? "Save" : "File the ticket"} />
          ) : (
            <>
              <div className="file-body jira-body">
                <dl className="jira-facts">
                  {([["Status", STATUS_NAMES[t.status]], ["Priority", t.priority], ["Project", nameOf(t.project) ?? "None"], ["Filed", when(t.created)],
                    ["Started", t.started && when(t.started)], ["Done", t.done && when(t.done)]] as [string, string | undefined][])
                    .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
                {t.labels.length > 0 && <div className="jira-labels">{t.labels.map((l) => <span key={l} className="jira-label">{l}</span>)}</div>}
                {t.from && (
                  <div className="meta ticket-from">
                    {t.from.kind === "note" ? <>Made from your note <b>{t.from.title || "Untitled"}</b></>
                      : <>Made from {t.from.kind === "plan" ? "a plan in" : "the conversation"} <button type="button" className="linkish" onClick={() => { closeTicket(); onOpenConversation(t.from!.id); }}>{t.from.title || "a conversation"}</button></>}
                  </div>
                )}
                <h3>Acceptance criteria{t.criteria.length ? ` (${t.criteria.length})` : ""}</h3>
                {t.criteria.length ? <ul className="jira-criteria">{t.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul> : <div className="meta">None yet: say what done means, so the crew can check its work against it.</div>}
                <h3>Description</h3>
                {t.description ? <Markdown text={t.description} /> : <div className="meta">No description.</div>}
                {worked.length > 0 && (
                  <>
                    <h3>Worked on in</h3>
                    <ul className="jira-children">
                      {worked.map((c) => (
                        <li key={c.id}><button type="button" onClick={() => { closeTicket(); onOpenConversation(c.id); }}>
                          <span className="jira-summary">{c.title}</span><span className="meta">{when(c.updated)}</span>
                        </button></li>
                      ))}
                    </ul>
                  </>
                )}
                {t.status === "done" && worked.length > 0 && <TicketDebrief ticketKey={t.key} stamp={tickets} />}
              </div>
              <div className="dialog-actions">
                <button type="button" className="hist-icon" aria-label="Delete this ticket" title="Delete this ticket" onClick={remove}><Icon name="trash" /></button>
                <button type="button" className="hist-icon" aria-label={copied ? "Copied" : "Copy the ticket"} title="Copy the ticket, as Markdown" onClick={copy}><Icon name={copied ? "check" : "copy"} /></button>
                <button type="button" className="btn ticket-edit" onClick={() => setEditing(true)}>Edit</button>
                {onAttach && <button type="button" className="btn" title="Attach this ticket to the message you're writing" onClick={() => { onAttach({ key: t.key, summary: t.title }); closeTicket(); }}>Attach to message</button>}
                {onStart && <button type="button" className="btn primary" title="Pick this ticket up: check what done means, say where and who, and start" onClick={() => { closeTicket(); onStart({ key: t.key, summary: t.title }); }}>Start work…</button>}
              </div>
            </>
          )}
      </div>
    </>
  );
}

// Writing a ticket, new or one that's there: what it is, what done means, and the rest.
// A new one can start from one of your notes or a plan you were sent: the form fills at once from
// its text (roughTicket), then from the model's write-up of it, which changes only what you haven't.
type Fields = { title: string; criteria: string; description: string; labels: string; priority: string; project: string };
type StartSource = { text: string; kind: "note" | "plan"; title: string; project?: string; from: TicketFrom };
function TicketForm({ start, projects, busy, onSave, onCancel, saveLabel }: {
  start: TicketInput | MaeTicket; projects: { id: string; name: string }[]; busy: boolean; onSave: (input: TicketInput) => void; onCancel: () => void; saveLabel: string;
}) {
  const list = (v: string | string[] | undefined, sep: string) => (Array.isArray(v) ? v.join(sep) : v ?? "");
  const [f, setF] = useState<Fields>({ title: start.title ?? "", criteria: list(start.criteria, "\n"), description: start.description ?? "",
    labels: list(start.labels, ", "), priority: start.priority ?? "", project: start.project ?? "" });
  const field = (k: keyof Fields) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }));
  const isNew = !("key" in start);
  const [from, setFrom] = useState<TicketFrom | undefined>(isNew ? start.from : undefined);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = () => onSave({ ...f, priority: f.priority || null, project: f.project || null, ...(from ? { from } : {}) });

  // What a new ticket can start from: your notes, and the plans ready to start.
  const { notes, loaded: notesLoaded } = useNotes();
  const [plans, setPlans] = useState<PlanSource[] | null>(null);
  useEffect(() => {
    if (!isNew) return;
    if (!notesLoaded) void loadNotes();
    let gone = false;
    loadPlans().then((p) => { if (!gone) setPlans(p); }, () => { if (!gone) setPlans([]); });
    return () => { gone = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shownNotes = useMemo(() => notes.filter((n) => n.title.trim() || n.text.trim()).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 40), [notes]);
  const [picked, setPicked] = useState("");
  const [source, setSource] = useState<StartSource | null>(null);
  // How the filling went: writing (the model's at it), written, kept (from the ticket on the note), or what went wrong.
  const [fill, setFill] = useState<{ state: "writing" | "written" | "kept" | "failed"; error?: string } | null>(null);
  const filled = useRef<Partial<Fields>>({}); // what was last put in each field, to tell your changes from ours
  const asking = useRef(0);
  const now = useRef(f);
  now.current = f;
  function put(next: Partial<Fields>, keepYours: boolean) {
    const out = { ...now.current };
    for (const [k, v] of Object.entries(next) as [keyof Fields, string][]) {
      if (keepYours && out[k] !== (filled.current[k] ?? "")) continue; // changed since it was filled in: it's yours
      out[k] = v; filled.current[k] = v;
    }
    now.current = out;
    setF(out);
  }
  async function write(src: StartSource) {
    const n = ++asking.current;
    setFill({ state: "writing" });
    try {
      const d = await draftTicket(src.text, src.kind, src.title, src.project);
      if (n !== asking.current) return;
      put({ title: d.title, criteria: d.criteria.join("\n"), description: d.description, ...(d.priority ? { priority: d.priority } : {}), ...(d.labels?.length ? { labels: d.labels.join(", ") } : {}) }, true);
      setFill({ state: "written" });
    } catch (e) { if (n === asking.current) setFill({ state: "failed", error: errorText(e) }); }
  }
  function choose(value: string) {
    setPicked(value);
    asking.current++;
    const [kind, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    let src: StartSource | null = null;
    if (kind === "note") {
      const n = notes.find((x) => x.id === id);
      if (n) src = { text: [n.title.trim(), n.text.trim()].filter(Boolean).join("\n\n"), kind: "note", title: titleOf(n), project: n.idea?.project, from: { kind: "note", id: n.id, title: titleOf(n) } };
    } else if (kind === "plan") {
      const p = plans?.find((x) => x.id === id);
      if (p) src = { text: p.body, kind: "plan", title: p.conversationTitle, project: p.project, from: { kind: "plan", id: p.conversation, title: p.conversationTitle } };
    }
    setSource(src); setFrom(src?.from ?? (isNew ? start.from : undefined));
    if (!src) { setFill(null); return; }
    const project = src.project && projects.some((p) => p.id === src.project) ? { project: src.project } : {};
    // A note the Scout already wrote up as a ticket (from the project's code) is used as it is.
    const kept = src.kind === "note" ? notes.find((x) => x.id === id)?.ticket : undefined;
    if (kept && !kept.stale) {
      filled.current = {};
      put({ title: kept.title, criteria: kept.criteria.join("\n"), description: kept.description, ...project }, false);
      setFill({ state: "kept" });
      return;
    }
    const r = roughTicket(src.text, src.title);
    filled.current = {};
    put({ title: r.title, criteria: r.criteria.join("\n"), description: r.description, ...project }, false);
    void write(src);
  }
  const split = () => { if (!source) return; closeTicket(); turnIntoTickets({ text: source.text, kind: source.kind, title: source.title, project: source.project, from: source.from }); };
  const what = source?.kind === "plan" ? "plan" : "note";
  const offer = isNew && (shownNotes.length > 0 || !!plans?.length);

  return (
    <form className="ticket-form" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
      <div className="file-body">
        {offer && (
          <div className="ticket-start">
            <label className="field"><span>Start from <small>one of your notes or a plan ready to start: Mae fills in what it can</small></span>
              <select value={picked} onChange={(ev) => choose(ev.target.value)}>
                <option value="">Nothing: write it from scratch</option>
                {shownNotes.length > 0 && <optgroup label="Your notes">{shownNotes.map((n) => <option key={n.id} value={`note:${n.id}`}>{titleOf(n)} · {when(n.updated)}</option>)}</optgroup>}
                {!!plans?.length && <optgroup label="Plans ready to start">{plans.map((p) => <option key={p.id} value={`plan:${p.id}`}>{p.conversationTitle} · approved {when(p.time)}</option>)}</optgroup>}
              </select>
            </label>
            {fill && (
              <div className="meta ticket-fill" role="status">
                {fill.state === "writing" ? <>Filled in from the {what}’s text; Mae is writing the rest…</>
                  : fill.state === "written" ? <>Written up from the {what}. Check it over: anything you change is yours.</>
                  : fill.state === "kept" ? <>From the ticket written up on this note.</>
                  : <span title={fill.error}>Filled in from the {what}’s text only: Mae couldn’t write the rest just now. <button type="button" className="linkish" onClick={() => source && void write(source)}>Try again</button></span>}
                {source && <> <button type="button" className="linkish" title={`Split the ${what} into several tickets, and choose which to file`} onClick={split}>Make several tickets of it instead</button></>}
              </div>
            )}
          </div>
        )}
        <label className="field"><span>Title</span>
          <input ref={first} required maxLength={200} placeholder="The thing to build, in a few words" value={f.title} onChange={field("title")} />
        </label>
        <div className="ticket-form-row">
          <label className="field"><span>Priority</span>
            <select value={f.priority} onChange={field("priority")}>
              <option value="">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <label className="field"><span>Project</span>
            <select value={f.project} onChange={field("project")}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field ticket-labels"><span>Labels</span>
            <input placeholder="ui, onboarding" value={f.labels} onChange={field("labels")} />
          </label>
        </div>
        <label className="field"><span>Acceptance criteria <small>one per line</small></span>
          <textarea rows={4} placeholder={"It follows the system's light or dark setting\nIt can be forced on in Settings"} value={f.criteria} onChange={field("criteria")} />
        </label>
        <label className="field"><span>Description <small>Markdown</small></span>
          <textarea rows={7} placeholder="Why it's wanted, what's known, links…" value={f.description} onChange={field("description")} />
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy || !f.title.trim()}>{busy ? "Saving…" : saveLabel}</button>
      </div>
    </form>
  );
}

// Turn a note or a plan into tickets: the small model splits it into pieces of work, you choose
// which to keep (and can retitle them), and they're filed together.
export function DraftTicketsDialog({ S, ask, onFiled }: { S: CampState; ask: DraftAsk; onFiled?: (made: MaeTicket[]) => void }) {
  const [drafts, setDrafts] = useState<(TicketDraft & { keep: boolean })[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const projects = S.history.projects.filter((p) => p.id !== "general");
  const [project, setProject] = useState(ask.project && ask.project !== "general" ? ask.project : "");
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let gone = false;
    setDrafts(null); setError("");
    draftTickets(ask.text, ask.kind, ask.title, project || undefined)
      .then((d) => { if (!gone) setDrafts(d.map((x) => ({ ...x, keep: true }))); }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
    // Drafted once per ask (and on Try again): changing the project afterwards only says where they're filed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, tries]);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") closeDrafting(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);
  const kept = drafts?.filter((d) => d.keep && d.title.trim()) ?? [];
  async function file() {
    setBusy(true); setError("");
    try {
      const made = await createTickets(kept.map(({ keep: _k, ...d }) => d), project || undefined, ask.from);
      closeDrafting();
      onFiled?.(made);
    } catch (e) { setError(errorText(e)); setBusy(false); }
  }
  const change = (i: number, d: Partial<TicketDraft & { keep: boolean }>) => setDrafts((all) => all && all.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const what = ask.kind === "plan" ? "the plan" : "the note";
  return (
    <>
      <div className="drawer-backdrop" onClick={closeDrafting} />
      <div className="dialog file-view jira-ticket draft-tickets" role="dialog" aria-modal="true" aria-label="Turn into tickets">
        <header className="file-head">
          <b>Turn {ask.title ? <>“{ask.title}”</> : what} into tickets</b>
          <button type="button" className="hist-icon" aria-label="Close" title="Close (Esc)" onClick={closeDrafting}>×</button>
        </header>
        <div className="file-body">
          {error && <div className="form-error" role="alert">{error} <button type="button" className="linkish" onClick={() => setTries((n) => n + 1)}>Try again</button></div>}
          {!drafts && !error && <div className="ft-note">Reading {what} and splitting it into pieces of work…</div>}
          {drafts && (
            <>
              <div className="meta">Untick any you don't want, and change a title if it's off. Nothing is filed until you say.</div>
              <ul className="draft-list">
                {drafts.map((d, i) => (
                  <li key={i} className={cx("draft", !d.keep && "off")}>
                    <input type="checkbox" aria-label={`File “${d.title}”`} checked={d.keep} onChange={(ev) => change(i, { keep: ev.target.checked })} />
                    <div className="draft-main">
                      <input className="draft-title" aria-label="Title" value={d.title} maxLength={200} onChange={(ev) => change(i, { title: ev.target.value })} />
                      <button type="button" className="linkish" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                        {d.criteria.length ? `${d.criteria.length} ${d.criteria.length === 1 ? "criterion" : "criteria"}` : "No criteria"}{d.description ? " · description" : ""}
                      </button>
                      {open === i && (
                        <div className="draft-more">
                          {d.criteria.length > 0 && <ul className="jira-criteria">{d.criteria.map((c, j) => <li key={j}>{c}</li>)}</ul>}
                          {d.description && <Markdown text={d.description} />}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="dialog-actions">
          {projects.length > 0 && (
            <label className="draft-project"><span className="meta">File under</span>
              <select value={project} onChange={(ev) => setProject(ev.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn" onClick={closeDrafting}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || !kept.length} onClick={file}>
            {busy ? "Filing…" : kept.length ? `File ${kept.length} ${kept.length === 1 ? "ticket" : "tickets"}` : "File tickets"}
          </button>
        </div>
      </div>
    </>
  );
}
