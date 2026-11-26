// Picking up a ticket, step by step: which ticket, what "done" means, where the work happens,
// who does it, and a last look before it starts.
//
// Each step is filled in already with what the camp can work out (the ticket's own acceptance
// criteria, the project you used last, a branch named after the ticket, the Quartermaster), so
// most of the time it's Next, Next, Next, Start. Anything can be changed on the way, and the
// brief on the last step is yours to edit: nothing is sent until you press Start there.
//
// The ticket is a Mae ticket (MAE-3, tickets.ts) or, with Jira connected, a Jira one. A Mae
// ticket's details are its own; starting work on it moves it to In progress.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { cx, nameNow, plural } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, JiraDetail, JiraRef, PendingAttachment, RepoInfo, SendResult, Uploaded } from "../types.ts";
import { linkAttachment, uploadFile } from "../upload.ts";
import { AttachmentChip } from "./AttachmentChip.tsx";
import { Icon } from "./bits.tsx";
import { startBrief, ticketBranch } from "./JiraPage.tsx";
import { STATUS_NAMES, isMaeKey, useTickets } from "../tickets.ts";
import { Dialog } from "./Dialog.tsx";
import { useJiraSearch } from "./useJiraSearch.ts";
import { w } from "../words.ts";
export const WIZARD_STEPS = ["Ticket", "Details", "Where", "Who", "Start"] as const;
type Criterion = { text: string; on: boolean };
// What the details step shows: a Jira ticket's, or a Mae ticket's made to look the same.
type Detail = Pick<JiraDetail, "summary" | "description" | "criteria" | "type" | "status" | "priority" | "assignee" | "epic">;

// What the wizard sends: everything /api/send needs to start the work (the ticket itself is attached first).
export function kickoff(o: { key: string; brief: string; who: string; project: string; repos: string[]; branch: string; review: boolean | null; attachment: { name: string; path: string };
  extras?: { kind: string; name: string; path?: string; url?: string }[] }) { // what you added for context: designs, files, links
  return {
    text: (o.who === "quartermaster" ? "" : `@${o.who} `) + o.brief.trim(),
    attachments: [{ kind: "file", name: o.attachment.name, path: o.attachment.path }, ...(o.extras ?? [])],
    ...(isMaeKey(o.key) ? { ticket: o.key } : { jira: o.key }),
    ...(o.project === "general" ? {} : { project: o.project }),
    ...(o.repos.length ? { workspaces: Object.fromEntries(o.repos.map((l) => [l, { mode: "new", branch: o.branch }])) } : {}),
    ...(o.who === "quartermaster" && o.review !== null ? { review: o.review } : {}),
  };
}

// start: a ticket already chosen (from its page): the wizard opens on its details.
export function TicketWizard({ S, start, onClose, onStarted }: {
  S: CampState; start?: { key: string; summary: string }; onClose: () => void; onStarted: (thread: string) => void;
}) {
  const [step, setStep] = useState(start ? 1 : 0);
  const [reached, setReached] = useState(start ? 1 : 0);
  const go = (n: number) => { setStep(n); setReached((r) => Math.max(r, n)); setError(""); };
  const [error, setError] = useState("");

  // ---------- 1: the ticket ----------
  const [query, setQuery] = useState("");
  const [ticket, setTicket] = useState<{ key: string; summary: string } | null>(start ?? null);
  const jiraOn = !!S.jira?.connected;
  const { tickets: mae } = useTickets();
  const mine = ticket && isMaeKey(ticket.key) ? mae.find((t) => t.key === ticket.key) : undefined;
  // Mae's tickets that aren't done, narrowed by what's typed: To do first, then In progress.
  const maeShown = useMemo(() => {
    const w = query.toLowerCase().split(/\s+/).filter(Boolean);
    return mae.filter((t) => t.status !== "done" && w.every((x) => `${t.key} ${t.title} ${t.labels.join(" ")}`.toLowerCase().includes(x)))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "todo" ? -1 : 1)).slice(0, 30);
  }, [mae, query]);
  const { issues } = useJiraSearch(query, step === 0 && jiraOn, setError);

  // ---------- 2: its details ----------
  const [detail, setDetail] = useState<Detail | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!ticket) return;
    if (isMaeKey(ticket.key)) {
      if (!mine) { setDetail(null); return; } // not read yet (or deleted since)
      setDetail({ summary: mine.title, description: mine.description, criteria: mine.criteria, type: "Your ticket", status: STATUS_NAMES[mine.status], priority: mine.priority ?? null, assignee: null, epic: null });
      setCriteria(mine.criteria.map((text) => ({ text, on: true })));
      setBrief(null);
      return;
    }
    let gone = false;
    setDetail(null);
    api<JiraDetail>(`/api/jira/ticket?key=${encodeURIComponent(ticket.key)}`).then((d) => {
      if (gone) return;
      setDetail(d);
      setCriteria(d.criteria.map((text) => ({ text, on: true })));
      setBrief(null);
    }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [ticket?.key, !!mine]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extra context: files, images (a design, a screenshot) and links (a Figma page) to go with the
  // ticket. They're uploaded as you add them, into one batch the ticket itself joins at the end.
  const [extras, setExtras] = useState<PendingAttachment[]>([]);
  const batch = useRef<string | undefined>(undefined);
  const nextKey = useRef(0);
  const pick = useRef<HTMLInputElement>(null);
  const [linkTyped, setLinkTyped] = useState("");
  const [dragging, setDragging] = useState(false);
  const putExtra = (a: Omit<PendingAttachment, "key">) => { const key = nextKey.current++; setExtras((l) => [...l, { ...a, key }]); setBrief(null); return key; };
  async function addFiles(files: File[]) {
    setError("");
    for (const f of files) {
      const key = putExtra({ kind: "file", name: f.name, status: "uploading", image: (f.type || "").startsWith("image/") });
      try {
        const r = await uploadFile(f, batch.current);
        batch.current = r.batch;
        setExtras((l) => l.map((a) => (a.key === key ? { ...a, path: r.path, name: r.name, status: "ready" } : a)));
      } catch (e) { setExtras((l) => l.map((a) => (a.key === key ? { ...a, status: "error" } : a))); setError(errorText(e)); }
    }
  }
  function addLink() {
    const made = linkAttachment(linkTyped);
    if (!made) return setError("That doesn't look like a link.");
    setError("");
    if (!extras.some((a) => a.url === made.url)) putExtra({ ...made, status: "ready" });
    setLinkTyped("");
  }
  const ready = extras.filter((a) => a.status === "ready");
  const uploading = extras.some((a) => a.status === "uploading");

  // ---------- 3: where ----------
  const projects = S.history.projects;
  const [project, setProject] = useState(() => { const last = storeGet("camp-jira-project"); return projects.some((p) => p.id === last) ? last! : projects.find((p) => p.links?.length)?.id ?? projects[0]?.id ?? "general"; });
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  useEffect(() => { api<{ repos: RepoInfo[] }>("/api/repos").then((r) => setRepos(r.repos), () => setRepos([])); }, []);
  // A Mae ticket filed under a project is worked on there, unless you choose otherwise.
  useEffect(() => { if (mine?.project && projects.some((p) => p.id === mine.project)) setProject(mine.project); }, [mine?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = projects.find((p) => p.id === project);
  // The project's repositories the crew may change: each can have a worktree of its own for this.
  const editable = useMemo(() => (chosen?.links ?? []).filter((l) => repos.some((r) => r.link === l && r.access === "write")), [chosen, repos]);
  const always = chosen?.settings?.workIn === "worktree"; // the project does this for every conversation anyway
  const [ownBranch, setOwnBranch] = useState(true);
  const [branchTyped, setBranchTyped] = useState("");
  const branch = branchTyped.trim() || (ticket ? ticketBranch(ticket.key, detail?.summary ?? ticket.summary) : "");
  const inWorktree = editable.length > 0 && (ownBranch || always);

  // ---------- 4: who ----------
  const [who, setWho] = useState("quartermaster");
  const reviewDefault = chosen?.settings?.review ? chosen.settings.review === "on" : !!S.settings?.reviewChanges;
  const [reviewPick, setReviewPick] = useState<boolean | null>(null); // null: as the project and camp are set
  const review = reviewPick ?? reviewDefault;
  const member = S.characters.find((c) => c.id === who);

  // ---------- 5: the brief ----------
  const drafted = ticket ? startBrief({ key: ticket.key, summary: detail?.summary ?? ticket.summary, criteria: criteria.filter((c) => c.on && c.text.trim()).map((c) => c.text.trim()) }, notes, ready.map((a) => a.name)) : "";
  const [brief, setBrief] = useState<string | null>(null); // null: as drafted from the steps before
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);

  async function startWork() {
    if (!ticket) return;
    if (uploading) return setError("Still uploading. It'll be ready in a moment.");
    setBusy(true); setError("");
    try {
      const attachment = await api<Uploaded>(isMaeKey(ticket.key) ? "/api/tickets/attach" : "/api/jira/attach", { key: ticket.key, batch: batch.current });
      storeSet("camp-jira-project", project);
      const r = await api<SendResult>("/api/send", kickoff({ key: ticket.key, brief: brief ?? drafted, who, project, repos: inWorktree ? editable : [], branch, review: reviewPick, attachment,
        extras: ready.map(({ kind, name, path, url }) => ({ kind, name, path, url })) }));
      onStarted(r.thread);
    } catch (e) { setError(errorText(e)); setBusy(false); }
  }

  const canNext = step === 0 ? !!ticket : step === 1 ? !!detail : true;
  const next = () => { if (canNext && step < 4) go(step + 1); };
  const edit = (i: number, change: Partial<Criterion>) => { setCriteria((l) => l.map((c, j) => (j === i ? { ...c, ...change } : c))); setBrief(null); };
  const included = criteria.filter((c) => c.on && c.text.trim()).length;

  return (
    <Dialog as="form" className={cx("dialog file-view wizard", dragging && "dragging")} label="Start a ticket" onClose={close}
        onDragOver={(ev) => { if (step === 1 && [...ev.dataTransfer.types].includes("Files")) { ev.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(ev) => { if (step !== 1) return; ev.preventDefault(); setDragging(false); void addFiles([...ev.dataTransfer.files].filter((f) => f.type || f.size > 0)); }}
        onPaste={(ev) => { if (step !== 1) return; const files = [...ev.clipboardData.files]; if (files.length) { ev.preventDefault(); void addFiles(files); } }}
        onSubmit={(ev) => { ev.preventDefault(); if (step === 4) void startWork(); else next(); }}>
        <header className="file-head">
          <b>Start a ticket{ticket ? `: ${ticket.key}` : ""}</b>
          <small>{ticket ? detail?.summary ?? ticket.summary : ""}</small>
          <button type="button" className="hist-icon" aria-label="Close" title="Close (Esc)" onClick={close}>×</button>
        </header>
        <ol className="wizard-steps" aria-label="Steps">
          {WIZARD_STEPS.map((name, i) => (
            <li key={name}>
              <button type="button" className={cx(i === step && "now", i < step && "done")} aria-current={i === step ? "step" : undefined} disabled={i > reached || busy}
                onClick={() => go(i)}><span>{i + 1}</span>{name}</button>
            </li>
          ))}
        </ol>

        <div className="wizard-body">
          {step === 0 && (
            <section aria-label="Choose a ticket">
              <label className="fly-search wizard-search">
                <Icon name="search" />
                <input autoFocus aria-label="Find a ticket" placeholder={jiraOn ? "A key like MAE-3 or APP-123, or words…" : "A key like MAE-3, or words…"} value={query} autoComplete="off" spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
              </label>
              <div className="wizard-list" role="listbox" aria-label="Tickets">
                {jiraOn && <div className="section-label wizard-whose">Yours</div>}
                {!maeShown.length && <div className="meta">{query.trim() ? "None of your tickets match." : "None of your tickets waiting. Make one on the Tickets page, or turn a note or a plan into some."}</div>}
                {maeShown.map((t) => (
                  <button key={t.key} type="button" role="option" aria-selected={ticket?.key === t.key} className={cx("jira-item", ticket?.key === t.key && "on")}
                    onClick={() => { setTicket({ key: t.key, summary: t.title }); go(1); }}>
                    <span className="jira-key">{t.key}</span><span className="jira-summary">{t.title}</span><small>{[STATUS_NAMES[t.status], t.priority].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
                {jiraOn && <div className="section-label wizard-whose">Jira</div>}
                {jiraOn && issues === null && !error && <div className="meta">Asking Jira…</div>}
                {jiraOn && issues?.length === 0 && !error && <div className="meta">{query.trim() ? "No Jira tickets match." : "Your filter matches nothing right now. Type a key or some words."}</div>}
                {issues?.map((i) => (
                  <button key={i.key} type="button" role="option" aria-selected={ticket?.key === i.key} className={cx("jira-item", ticket?.key === i.key && "on")}
                    onClick={() => { setTicket({ key: i.key, summary: i.summary }); go(1); }}>
                    <span className="jira-key">{i.key}</span><span className="jira-summary">{i.summary}</span><small>{[i.type, i.status].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-label="The ticket's details">
              {!detail ? <div className="meta">{error ? "" : "Reading the ticket…"}</div> : (
                <>
                  <div className="meta">{[detail.type, detail.status, detail.priority, mine ? null : detail.assignee ?? "Unassigned"].filter(Boolean).join(" · ")}{detail.epic ? ` · in ${detail.epic.key} ${detail.epic.summary}` : ""}</div>
                  <details className="wizard-desc"><summary>What the ticket says</summary>{detail.description ? <Markdown text={detail.description} /> : <div className="meta">It has no description.</div>}</details>
                  <h3>What "done" means</h3>
                  <div className="meta">{detail.criteria.length ? `From the ticket's acceptance criteria. Untick, reword or add to them: the ${w("crew")} is asked to go through these one by one at the end.` : `The ticket lists no acceptance criteria. Add your own, or leave it and the ${w("crew")} is asked to say what it takes "done" to mean before changing anything.`}</div>
                  <ul className="wizard-criteria">
                    {criteria.map((c, i) => (
                      <li key={i}>
                        <input type="checkbox" checked={c.on} aria-label={`Include: ${c.text || "this one"}`} onChange={(ev) => edit(i, { on: ev.target.checked })} />
                        <input aria-label={`Criterion ${i + 1}`} value={c.text} placeholder="What has to be true when it's done" onChange={(ev) => edit(i, { text: ev.target.value })} />
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="linkish" onClick={() => { setCriteria((l) => [...l, { text: "", on: true }]); setBrief(null); }}>Add one</button>
                  <label className="field">Anything else the {w("crew")} should know
                    <textarea aria-label={`Anything else the ${w("crew")} should know`} rows={3} value={notes} placeholder="Where to look, what to leave alone, how you want it done… (optional)" onChange={(ev) => { setNotes(ev.target.value); setBrief(null); }} />
                  </label>
                  <h3>Extra context</h3>
                  <div className="meta">Designs, screenshots, a spec, a link to the Figma page: anything the ticket doesn't carry. The {w("crew")} gets them with the ticket and is told to look before it plans. Drop files here, paste an image, or:</div>
                  <div className="wizard-extras">
                    <input ref={pick} type="file" multiple hidden aria-label="Files to attach" onChange={(ev) => { void addFiles([...(ev.target.files ?? [])]); ev.target.value = ""; }} />
                    <button type="button" className="btn small" onClick={() => pick.current?.click()}><Icon name="plus" /> Files or images…</button>
                    <span className="wizard-link">
                      <input aria-label="A link to attach" placeholder="…or paste a link (Figma, a doc)" value={linkTyped} spellCheck={false} autoCapitalize="off"
                        onChange={(ev) => setLinkTyped(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); addLink(); } }} />
                      <button type="button" className="btn small" disabled={!linkTyped.trim()} onClick={addLink}>Add link</button>
                    </span>
                  </div>
                  {extras.length > 0 && (
                    <div className="composer-atts wizard-atts" aria-label="Attached for context">
                      {extras.map((a) => <AttachmentChip key={a.key} a={a} big status={a.status} onRemove={() => { setExtras((l) => l.filter((x) => x.key !== a.key)); setBrief(null); }} />)}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {step === 2 && (
            <section aria-label="Where the work happens">
              <label className="field">Project
                <select aria-label="Project" value={project} onChange={(ev) => setProject(ev.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.links?.length ? ` (${p.links.map((l) => `links/${l}`).join(", ")})` : ""}</option>)}</select>
                <span className="field-hint">The conversation is filed there, and the {w("crew")} sees that project's folders, notes and defaults.</span>
              </label>
              {editable.length > 0 ? (
                <>
                  <label className="dialog-check"><input type="checkbox" checked={ownBranch || always} disabled={always} onChange={(ev) => setOwnBranch(ev.target.checked)} />
                    In a new worktree and branch of {editable.map((l) => `links/${l}`).join(", ")}</label>
                  <div className="field-hint">{always ? "This project starts every conversation in its own worktree." : `Ticked, your own checkout isn't touched and the work can become a pull request. Unticked, the ${w("crew")} works in your checkout as it stands.`}</div>
                  {inWorktree && <label className="field">Branch<input aria-label="Branch" className="mono" spellCheck={false} autoCapitalize="off" value={branchTyped} placeholder={ticket ? ticketBranch(ticket.key, detail?.summary ?? ticket.summary) : ""} onChange={(ev) => setBranchTyped(ev.target.value)} /></label>}
                </>
              ) : <div className="meta">{chosen?.links?.length ? `This project has no git repository the ${w("crew")} may edit, so there's no branch to make.` : `This project has no folder. The ${w("crew")} can still read the ticket and answer, but has no code to work in.`} The conversation is tied to the ticket either way.</div>}
            </section>
          )}

          {step === 3 && (
            <section aria-label="Who does it">
              <div className="wizard-who" role="radiogroup" aria-label="Who does it">
                {S.characters.map((c) => (
                  <label key={c.id} className={cx("wizard-pick", who === c.id && "on")}>
                    <input type="radio" name="who" checked={who === c.id} onChange={() => setWho(c.id)} />
                    <span><b>{c.emoji} {c.name}</b>{c.id === "quartermaster" && <span className="pill">Usual</span>}
                      <small>{c.id === "quartermaster" ? "Plans it, shows you the plan, and sends whoever each part needs." : `Straight to ${c.name}, with no plan first. ${c.role}`}</small></span>
                  </label>
                ))}
              </div>
              {who === "quartermaster" ? (
                <label className="dialog-check"><input type="checkbox" checked={review} onChange={(ev) => setReviewPick(ev.target.checked)} />
                  Have the {nameNow("Warden")} review the changes before it reports{reviewPick === null ? ` (${reviewDefault ? "on" : "off"} for this project)` : ""}</label>
              ) : <div className="meta">A review isn't part of a direct chat. When {member?.name ?? "they"} has finished, "Review changes…" on the answer asks someone else to read the diff.</div>}
            </section>
          )}

          {step === 4 && ticket && (
            <section aria-label="Check and start">
              <dl className="wizard-summary">
                <div><dt>Ticket</dt><dd><span className="jira-key">{ticket.key}</span> {detail?.summary ?? ticket.summary} <span className="meta">· attached as it stands now</span></dd></div>
                {ready.length > 0 && <div><dt>Also attached</dt><dd>{ready.map((a) => a.name).join(", ")}</dd></div>}
                <div><dt>Done means</dt><dd>{included ? `${included} ${plural(included, "criterion").replace("criterions", "criteria")}` : `the ${w("crew")} says what it takes "done" to mean first`}</dd></div>
                <div><dt>Where</dt><dd>{chosen?.name ?? "General"}{inWorktree ? <> · a new worktree on <code>{branch}</code></> : editable.length ? " · your own checkout" : ""}</dd></div>
                <div><dt>Who</dt><dd>{member ? `${member.emoji} ${member.name}` : who}{who === "quartermaster" ? (review ? ` · the ${nameNow("Warden")} reviews the changes before it reports` : " · no review before it reports") : ""}</dd></div>
                {mine && <div><dt>Ticket</dt><dd>moves to In progress as the work starts, and to Done when its pull request merges</dd></div>}
                {!mine && S.settings?.jiraWrite?.on && <div><dt>Jira</dt><dd>a comment says work has started{S.settings.jiraWrite.startStatus ? `, and the ticket moves to ${S.settings.jiraWrite.startStatus}` : ""}</dd></div>}
              </dl>
              <label className="field">The brief
                <textarea className="wizard-brief" aria-label="The brief" rows={11} value={brief ?? drafted} spellCheck={false} onChange={(ev) => setBrief(ev.target.value)} />
                <span className="field-hint">This is what's sent, word for word. {brief !== null && brief !== drafted
                  ? <button type="button" className="linkish" onClick={() => setBrief(null)}>Put back the one drafted from your choices</button>
                  : "Change anything."}</span>
              </label>
            </section>
          )}
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          {step > 0 && <button type="button" className="btn wizard-back" disabled={busy} onClick={() => go(step - 1)}>Back</button>}
          <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button>
          {step < 4
            ? <button type="submit" className="btn primary" disabled={!canNext}>Next: {WIZARD_STEPS[step + 1]}</button>
            : <button type="submit" className="btn primary" disabled={busy || uploading || !(brief ?? drafted).trim()}>{busy ? "Starting…" : uploading ? "Uploading…" : "Start the work"}</button>}
        </div>
    </Dialog>
  );
}
