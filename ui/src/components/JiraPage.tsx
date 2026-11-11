// The Jira page: the tickets the camp's filter pulls in, as cards, and any one of them in full.
//
// Which tickets those are is one setting for the whole camp, kept with the Jira account under
// Settings → Connectors; this page says which filter is in use and links there. The cards on
// the page can be narrowed by words, status and type without asking Jira again. A card opens
// the whole ticket (description, comments), from where it can be attached to your message or
// opened in Jira. Nothing here writes to Jira.
//
// Epics: a card says which epic its ticket is in, the cards can be grouped under their epics
// (or narrowed to one), and an epic opens like any ticket, listing the tickets in it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { cx, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { Presence } from "../motion.tsx";
import type { CampState, JiraCard, JiraDetail, JiraPull, JiraRef } from "../types.ts";
import { Icon } from "./bits.tsx";
import { filterName } from "./Jira.tsx";

const GROUPS = { todo: "To do", doing: "In progress", done: "Done" } as const;
const pillOf = (g: JiraCard["group"]) => (g === "done" ? "pill done" : g === "doing" ? "pill live" : "pill");

// The ticket to start work on: "Start work…" hands it to the kickoff stepper (TicketWizard.tsx).
export type TicketStart = { key: string; summary: string };

// The brief for work on a ticket, drafted for you to read and change before it's sent. The
// ticket itself rides along as an attachment. notes: anything you added for the crew.
// extras: the names of what you attached for context (designs, a spec, a link), so the crew is told to look.
export function startBrief(t: { key: string; summary: string; criteria: string[] }, notes = "", extras: string[] = []): string {
  const list = t.criteria.length
    ? `Acceptance criteria (from the ticket):\n${t.criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\n`
    : "The ticket lists no acceptance criteria: before changing anything, tell me what you take \"done\" to mean here.\n\n";
  const more = notes.trim() ? `Also, from me:\n${notes.trim()}\n\n` : "";
  const context = extras.length ? `I've also attached ${extras.length === 1 ? "this" : "these"} for context (designs, references): ${extras.join(", ")}. Look at ${extras.length === 1 ? "it" : "them"} before you plan, and say so if ${extras.length === 1 ? "it disagrees" : "any of them disagree"} with the ticket.\n\n` : "";
  return `Work on ${t.key}: ${t.summary}\n\nThe ticket is attached: read it first.\n\n${context}${list}${more}` +
    "When you're done, go through the criteria one by one and say which are met (with the file or test that shows it) and which aren't.";
}
export const ticketBranch = (key: string, summary: string) =>
  `${key}-${summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "")}`.replace(/-$/, "");

// onFilter: go and change which tickets are pulled in (Settings → Connectors).
// onStart: pick a ticket up (the kickoff stepper, on that ticket). onKickoff: the stepper from its first step.
export function JiraPage({ S, onAttach, onFilter, onStart, onKickoff }: { S: CampState; onAttach: (issue: JiraRef) => void; onFilter: () => void; onStart: (start: TicketStart) => void; onKickoff?: () => void }) {
  const [pull, setPull] = useState<JiraPull | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState("");       // narrowing what's on the page
  const [group, setGroup] = useState<JiraCard["group"] | "">("");
  const [type, setType] = useState("");
  const [epic, setEpic] = useState("");          // an epic's key, or "none" for tickets in no epic
  const [byEpic, setByEpic] = useState(() => storeGet("camp-jira-by-epic") === "1");
  const [open, setOpen] = useState<string | null>(null);

  // Ask Jira for what the filter matches: on arriving, when the filter is changed in Settings, and on Refresh.
  const filter = S.jira?.filter ?? "";
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setPull(await api<JiraPull>("/api/jira/tickets")); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load, filter]);

  const tickets = pull?.tickets ?? [];
  const types = useMemo(() => [...new Set(tickets.map((t) => t.type).filter((t): t is string => !!t))].sort(), [tickets]);
  const counts = useMemo(() => ({ todo: tickets.filter((t) => t.group === "todo").length, doing: tickets.filter((t) => t.group === "doing").length, done: tickets.filter((t) => t.group === "done").length }), [tickets]);
  // The epics the tickets on the page are in, the busiest first.
  const epics = useMemo(() => {
    const by = new Map<string, { key: string; summary: string; type: string | null; n: number }>();
    for (const t of tickets) if (t.epic) by.set(t.epic.key, { ...t.epic, n: (by.get(t.epic.key)?.n ?? 0) + 1 });
    return [...by.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  }, [tickets]);
  const shown = useMemo(() => {
    const w = words.toLowerCase().split(/\s+/).filter(Boolean);
    return tickets.filter((t) => (!group || t.group === group) && (!type || t.type === type) && (!epic || (epic === "none" ? !t.epic : t.epic?.key === epic))
      && w.every((x) => `${t.key} ${t.summary} ${t.assignee ?? ""} ${t.labels.join(" ")} ${t.status ?? ""} ${t.epic?.key ?? ""} ${t.epic?.summary ?? ""}`.toLowerCase().includes(x)));
  }, [tickets, words, group, type, epic]);
  const narrowed = !!(words.trim() || group || type || epic);
  // Grouped: one section per epic, then the tickets that are in none.
  const sections = useMemo(() => {
    if (!byEpic) return [{ epic: null as (typeof epics)[number] | null, list: shown, titled: false }];
    const out = epics.map((e) => ({ epic: e as (typeof epics)[number] | null, list: shown.filter((t) => t.epic?.key === e.key), titled: true })).filter((x) => x.list.length);
    const loose = shown.filter((t) => !t.epic);
    return loose.length ? [...out, { epic: null, list: loose, titled: true }] : out;
  }, [byEpic, epics, shown]);
  return (
    <div className="feed proj-page jira-page">
      <header className="proj-head">
        <div>
          <h2>Jira</h2>
          <div className="meta">{S.jira?.siteUrl?.replace(/^https?:\/\//, "")}{S.jira?.displayName ? ` · ${S.jira.displayName}` : ""} · {S.settings?.jiraWrite?.on ? "the camp comments on a ticket when work starts and when its pull request opens." : "read-only: nothing here changes a ticket."}</div>
        </div>
        <div className="proj-actions">
          {onKickoff && <button type="button" className="btn small primary" title="Pick up a ticket: choose it, check its details, say where and who, and start" onClick={onKickoff}>Start a ticket…</button>}
          <button type="button" className="btn small" disabled={busy} title="Ask Jira again" onClick={() => load()}>{busy ? "Asking Jira…" : "Refresh"}</button>
        </div>
      </header>

      <div className="proj-about jira-using">
        <span><span className="section-label">Showing</span> {filterName(filter) ?? <code>{filter}</code>}</span>
        <button type="button" className="linkish" title="Which tickets are pulled in is a setting for the whole camp, kept with the Jira account" onClick={onFilter}>Change the filter in Settings</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}

      {pull && (
        <div className="jira-narrow" role="group" aria-label="Narrow what's shown">
          <input aria-label="Narrow by words" className="hist-search" placeholder="Narrow by key, words, person or label…" value={words} onChange={(ev) => setWords(ev.target.value)} />
          {(Object.keys(GROUPS) as JiraCard["group"][]).filter((g) => counts[g] > 0).map((g) => (
            <button key={g} type="button" className={cx("jira-chip", group === g && "on")} aria-pressed={group === g} onClick={() => setGroup(group === g ? "" : g)}>{GROUPS[g]} <small>{counts[g]}</small></button>
          ))}
          {/* Type and epic sit together and stay on one line: an epic's name can be long, and would otherwise push its dropdown down a row. */}
          {(types.length > 1 || epics.length > 0) && (
            <span className="jira-selects">
              {types.length > 1 && (
                <select aria-label="Type" value={type} onChange={(ev) => setType(ev.target.value)}>
                  <option value="">Every type</option>
                  {types.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
              {epics.length > 0 && (
                <select aria-label="Epic" value={epic} title={epics.find((e) => e.key === epic)?.summary} onChange={(ev) => setEpic(ev.target.value)}>
                  <option value="">Every epic</option>
                  {epics.map((e) => <option key={e.key} value={e.key}>{e.key} · {e.summary} ({e.n})</option>)}
                  <option value="none">In no epic</option>
                </select>
              )}
            </span>
          )}
          {epics.length > 0 && (
            <button type="button" className={cx("jira-chip", byEpic && "on")} aria-pressed={byEpic} title="Put the cards under the epic each is in"
              onClick={() => setByEpic((on) => { storeSet("camp-jira-by-epic", on ? "0" : "1"); return !on; })}>Group by epic</button>
          )}
          <span className="meta jira-count">{narrowed ? `${shown.length} of ${tickets.length}` : `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}{pull.more ? " (the first 60: narrow the filter for the rest)" : ""}</span>
        </div>
      )}

      {!pull && !error && <div className="meta">Asking Jira…</div>}
      {pull && !tickets.length && <div className="hist-empty">No tickets match this filter.</div>}
      {pull && tickets.length > 0 && !shown.length && <div className="hist-empty">Nothing on the page matches. <button type="button" className="linkish" onClick={() => { setWords(""); setGroup(""); setType(""); setEpic(""); }}>Show them all</button></div>}
      {sections.map((sec) => (
        <section key={sec.epic?.key ?? "none"} className="jira-section" aria-label={sec.titled ? (sec.epic ? `${sec.epic.key}: ${sec.epic.summary}` : "In no epic") : undefined}>
          {sec.titled && (sec.epic ? (
            <button type="button" className="jira-epic-head" title="Open this epic" onClick={() => setOpen(sec.epic!.key)}>
              <span className="jira-key">{sec.epic.key}</span><b>{sec.epic.summary || sec.epic.type || "Epic"}</b><span className="meta">{sec.list.length} {sec.list.length === 1 ? "ticket" : "tickets"} here</span>
            </button>
          ) : <div className="jira-epic-head loose"><b>In no epic</b><span className="meta">{sec.list.length} {sec.list.length === 1 ? "ticket" : "tickets"}</span></div>)}
          <div className="proj-grid jira-grid">
            {sec.list.map((t) => (
              <button key={t.key} type="button" className="proj-card jira-card" aria-label={`${t.key}: ${t.summary}`} onClick={() => setOpen(t.key)}>
                <span className="jira-card-top"><span className="jira-key">{t.key}</span>{t.type && <span className="meta">{t.type}</span>}<span className={pillOf(t.group)}>{t.status ?? GROUPS[t.group]}</span></span>
                <b>{t.summary}</b>
                {t.epic && !sec.titled && <span className="jira-epic" title={`In ${t.epic.type ?? "its parent"} ${t.epic.key}`}><Icon name="bookmark" />{t.epic.key}{t.epic.summary ? ` · ${t.epic.summary}` : ""}</span>}
                {t.labels.length > 0 && <span className="jira-labels">{t.labels.slice(0, 4).map((l) => <span key={l} className="jira-label">{l}</span>)}{t.labels.length > 4 && <span className="meta">+{t.labels.length - 4}</span>}</span>}
                <span className="meta">{[t.priority, t.assignee ?? "Unassigned", t.updated ? `changed ${when(t.updated)}` : ""].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <Presence>{open && <JiraTicket key={open} id={open} summary={tickets.find((t) => t.key === open)?.summary ?? epics.find((e) => e.key === open)?.summary ?? ""}
        onClose={() => setOpen(null)} onOpen={setOpen} onAttach={(i) => { onAttach(i); setOpen(null); }} onStart={(st) => { setOpen(null); onStart(st); }} />}</Presence>
    </div>
  );
}

// One ticket in full, over the page.
// onOpen: go to another ticket from this one (its epic, or one of the tickets in it).
// onAttach / onStart: left out where there's no message being written to attach it to (a
// ticket opened from its conversation, which is already about it).
export function JiraTicket({ id, summary, onClose, onAttach, onOpen, onStart }: {
  id: string; summary: string; S?: CampState; onClose: () => void; onAttach?: (issue: JiraRef) => void; onOpen: (key: string) => void; onStart?: (start: TicketStart) => void;
}) {
  const [t, setT] = useState<JiraDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let gone = false;
    api<JiraDetail>(`/api/jira/ticket?key=${encodeURIComponent(id)}`).then((d) => { if (!gone) setT(d); }, (e) => { if (!gone) setError(errorText(e)); });
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { gone = true; document.removeEventListener("keydown", esc); };
  }, [id, onClose]);
  const facts: [string, string | null | undefined][] = t ? [["Status", t.status], ["Type", t.type], ["Priority", t.priority], ["Assignee", t.assignee ?? "Unassigned"], ["Reporter", t.reporter],
    ["Project", t.project], ["Changed", t.updated ? when(t.updated) : null]] : [];
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="dialog file-view jira-ticket" role="dialog" aria-modal="true" aria-label={`${id}: ${t?.summary ?? summary}`}>
        <header className="file-head">
          <span className="jira-key">{id}</span>
          <b>{t?.summary ?? summary}</b>
          {t && <span className={pillOf(t.group)}>{t.status ?? GROUPS[t.group]}</span>}
          <button type="button" className="hist-icon" aria-label="Close the ticket" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="file-body jira-body">
          {error ? <div className="form-error" role="alert">{error}</div> : !t ? <div className="ft-note">Asking Jira…</div> : (
            <>
              <dl className="jira-facts">{facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              {t.labels.length > 0 && <div className="jira-labels">{t.labels.map((l) => <span key={l} className="jira-label">{l}</span>)}</div>}
              {t.epic && (
                <button type="button" className="jira-epic jira-epic-link" title={`Open ${t.epic.key}`} onClick={() => onOpen(t.epic!.key)}>
                  <Icon name="bookmark" /><span className="meta">{t.epic.type ?? "Parent"}</span> <span className="jira-key">{t.epic.key}</span> {t.epic.summary}
                </button>
              )}
              <h3>Description</h3>
              {t.description ? <Markdown text={t.description} /> : <div className="meta">No description.</div>}
              {t.criteria.length > 0 && (
                <>
                  <h3>Acceptance criteria ({t.criteria.length})</h3>
                  <ul className="jira-criteria">{t.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </>
              )}
              {t.children.length > 0 && (
                <>
                  <h3>{t.type === "Epic" ? "In this epic" : "Under this ticket"} ({t.children.length}{t.moreChildren ? "+" : ""})</h3>
                  <ul className="jira-children">
                    {t.children.map((c) => (
                      <li key={c.key}>
                        <button type="button" title={`Open ${c.key}`} onClick={() => onOpen(c.key)}>
                          <span className="jira-key">{c.key}</span><span className="jira-summary">{c.summary}</span><span className={pillOf(c.group)}>{c.status ?? GROUPS[c.group]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {t.moreChildren && <div className="meta">The first {t.children.length}; the rest are in Jira.</div>}
                </>
              )}
              <h3>Comments{t.comments.length ? ` (${t.comments.length + t.earlierComments})` : ""}</h3>
              {t.earlierComments > 0 && <div className="meta">The latest {t.comments.length}; {t.earlierComments} earlier ones are in Jira.</div>}
              {!t.comments.length && <div className="meta">None yet.</div>}
              {t.comments.map((c, i) => (
                <div key={i} className="jira-comment">
                  <div className="meta"><b>{c.author}</b>{c.created ? ` · ${when(c.created)}` : ""}</div>
                  <Markdown text={c.text} />
                </div>
              ))}
            </>
          )}
        </div>
          <div className="dialog-actions">
            {t && <a className="btn" href={t.url} target="_blank" rel="noopener noreferrer">Open in Jira <Icon name="link" /></a>}
            {onAttach && <button type="button" className="btn" disabled={!t} title="Attach this ticket to the message you're writing" onClick={() => t && onAttach(t)}>Attach to message</button>}
            {onStart && <button type="button" className="btn primary" disabled={!t} title="Pick this ticket up: check what done means, say where and who, and start" onClick={() => t && onStart({ key: t.key, summary: t.summary })}>Start work…</button>}
          </div>
      </div>
    </>
  );
}
