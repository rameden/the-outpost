// A Jira ticket in full (JiraTicket), and what starting work on any ticket drafts: the brief and the branch.
// The cards themselves are on the Tickets page (TicketsPage.tsx), beside Mae's. Nothing here writes to Jira.
//
// Epics: an epic opens like any ticket, listing the tickets in it.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, JiraCard, JiraDetail, JiraRef } from "../types.ts";
import { Icon } from "./bits.tsx";

export const GROUPS = { todo: "To do", doing: "In progress", done: "Done" } as const;
export const pillOf = (g: JiraCard["group"]) => (g === "done" ? "pill done" : g === "doing" ? "pill live" : "pill");

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

// One ticket in full, over the page.
// onOpen: go to another ticket from this one (its epic, or one of the tickets in it).
// onAttach / onStart: left out where there's no message being written to attach it to (a
// ticket opened from its conversation, which is already about it).
export function JiraTicket({ id, summary, onClose, onAttach, onOpen, onStart }: {
  id: string; summary: string; S?: CampState; onClose: () => void; onAttach?: (issue: JiraRef) => void; onOpen: (key: string) => void; onStart?: (start: TicketStart) => void;
}) {
  const [t, setT] = useState<JiraDetail | null>(null);
  const [error, setError] = useState("");
  // Jira is asked once per ticket. (Escape has its own effect: what closes the ticket is a new
  // function each time the page behind it is drawn, and tied together that asked Jira again each time.)
  useEffect(() => {
    let gone = false;
    api<JiraDetail>(`/api/jira/ticket?key=${encodeURIComponent(id)}`).then((d) => { if (!gone) setT(d); }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [id]);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
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
