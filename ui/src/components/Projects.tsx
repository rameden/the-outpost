// A project's own page, and the page that lists them all.
//
// A project's page shows everything the crew is given about it (your description, the survey of
// its folders, the notes the crew has kept, your pinned references), what it has cost, the
// worktrees and files its conversations have touched, its scheduled jobs, and every conversation
// filed under it. Sending from here starts a new conversation in the project.

import { useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { activityOf, type View } from "../feed/conversation.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { WorkspaceBox } from "../feed/Workspaces.tsx";
import { money, plural, shortModel, spaced, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, Conversation, History, Project, ProjectPageData, SendResult } from "../types.ts";
import { Icon } from "./bits.tsx";
import { LinkCommands } from "../panels/Records.tsx";
import { Confirm } from "./Confirm.tsx";
import { ChronicleSection } from "./Chronicle.tsx";
import { PayoffSection } from "./Payoff.tsx";
import { Presence } from "../motion.tsx";

// A description as one plain line, for a card (the project's page shows it formatted).
const plain = (text?: string) => (text ?? "").replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
const ofProject = (S: CampState, id: string) => S.history.conversations.filter((c) => c.project === id);

// The project's defaults, as short labels.
function defaultsOf(p: Project): string[] {
  const s = p.settings ?? {};
  return [
    s.workIn === "worktree" ? "New worktree per conversation" : "",
    s.web === "careful" ? "Confidential web searches" : s.web === "off" ? "Web off" : "",
    s.approval ? `Shell: ${s.approval === "ask" ? "ask every time" : s.approval === "sandbox" ? "sandboxed" : "read-only runs"}` : "",
    s.budgetUsd ? `Budget ${money(s.budgetUsd)} per expedition` : "",
    s.review ? `Changes reviewed before reporting: ${s.review === "on" ? "always" : "never"}` : "",
    ...Object.entries(s.agents ?? {}).map(([id, a]) => `${id}: ${shortModel(a.model ?? "")}${a.effort ? ` · ${a.effort}` : ""}`),
  ].filter(Boolean);
}

function Folder({ S, name, refresh }: { S: CampState; name: string; refresh: () => void }) {
  const link = S.links.find((l) => l.name === name);
  if (!link) return <div className="proj-folder"><Icon name="folder" /> <code>links/{name}/</code><span>This folder isn't linked any more.</span></div>;
  return (
    <div className="proj-folder" title={link.path}>
      <Icon name="folder" /> <code>links/{name}/</code><span>{link.path} · {link.access === "write" ? "the crew can edit" : "read-only"}</span>
      <LinkCommands link={link} kind="verify" refresh={refresh} open={false} />
      <LinkCommands link={link} kind="setup" refresh={refresh} open={false} />
    </div>
  );
}

// Text the crew keeps (or you edit by hand): shown formatted, with an Edit that turns it into a box.
function Editable({ label, hint, text, empty, onSave }: { label: string; hint: string; text: string; empty: React.ReactNode; onSave: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <section className="proj-about">
      <div className="proj-section-head">
        <div className="section-label">{label}</div>
        {draft === null
          ? <button type="button" className="linkish" onClick={() => setDraft(text)}>Edit</button>
          : <span className="proj-edit-actions">
              <button type="button" className="linkish" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="btn small primary" onClick={async () => { try { await onSave(draft); setDraft(null); } catch (e) { alert(errorText(e)); } }}>Save</button>
            </span>}
      </div>
      {draft !== null
        ? <><textarea className="proj-edit" aria-label={label} value={draft} onChange={(ev) => setDraft(ev.target.value)} /><div className="meta">{hint}</div></>
        : text ? <Markdown text={text} /> : <div className="meta">{empty}</div>}
    </section>
  );
}

export function ProjectPage({ S, store, project, setView, refresh, patch, onEdit, onDelete }: {
  S: CampState; store: FeedStore; project: Project; setView: (v: View) => void; refresh: () => void;
  patch: (fn: (s: CampState) => CampState) => void; onEdit: (p: Project) => void; onDelete: (p: Project) => void;
}) {
  const activity = useFeed(store, activityOf);
  const list = ofProject(S, project.id);
  const general = project.id === "general";
  const [page, setPage] = useState<ProjectPageData | null>(null);
  const [surveying, setSurveying] = useState(false);
  // Reloaded when anything about the project's conversations changes (a run ends, a note is saved).
  const stamp = `${list.length}:${list[0]?.updated ?? ""}:${list[0]?.status ?? ""}`;
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    let current = true;
    api<ProjectPageData>(`/api/project?id=${encodeURIComponent(project.id)}`).then((p) => { if (current) setPage(p); }, () => { if (current) setPage(null); });
    return () => { current = false; };
  }, [project.id, stamp, saves]);

  const save = (action: "project.notes" | "project.brief", body: object) => async (text: string) => {
    const r = await api<{ history: History }>("/api/history", { action, id: project.id, ...body, [action === "project.notes" ? "notes" : "brief"]: text });
    patch((s) => ({ ...s, history: r.history }));
    setSaves((n) => n + 1);
  };
  // Surveying is asked about first: it sends the Scout through the project's folders, which uses some of your plan.
  const [askSurvey, setAskSurvey] = useState(false);
  async function survey() {
    setAskSurvey(false);
    setSurveying(true);
    try {
      const r = await api<SendResult>("/api/project/survey", { id: project.id });
      refresh();
      setView({ kind: "conversation", id: r.thread });
    } catch (e) { alert(errorText(e)); setSurveying(false); }
  }
  const defaults = defaultsOf(project);
  const hasFolders = !!project.links?.length;

  return (
    <div className="feed proj-page">
      <Presence>{askSurvey && (
        <Confirm title={page?.brief ? `Survey ${project.name} again?` : `Survey ${project.name}?`} action={page?.brief ? "Survey again" : "Survey"} busy={surveying}
          onConfirm={survey} onCancel={() => setAskSurvey(false)}>
          <p>The Scout reads through {(project.links ?? []).map((l) => `links/${l}/`).join(", ") || "the project's folders"} and writes up the stack, the layout and the commands that work.
            The crew is given that at the start of every conversation here, so it stops rediscovering them.</p>
          {page?.brief ? <p><b>The survey you have now is replaced</b> when the new one comes back.</p> : null}
          <p className="meta">It runs as a conversation with the Scout, which opens when you start it, and uses some of your plan.</p>
        </Confirm>
      )}</Presence>
      <header className="proj-head">
        <div>
          <h2>{project.pinned && <><Icon name="pin" /> </>}{project.name}</h2>
          <div className="meta">{list.length} {plural(list.length, "conversation")}{general ? " · anything not filed under a project" : ""}</div>
        </div>
        <div className="proj-actions">
          <button type="button" className="btn small primary" onClick={() => setView({ kind: "new", project: general ? undefined : project.id })}>New conversation</button>
          {hasFolders && <button type="button" className="btn small" disabled={surveying} title="The Scout reads through the project's folders and writes a brief for the crew" onClick={() => setAskSurvey(true)}>{page?.brief ? "Survey again" : "Survey this project"}</button>}
          <button type="button" className="btn small" onClick={() => onEdit(project)}>Edit…</button>
          {!general && <button type="button" className="btn small danger quiet" onClick={() => onDelete(project)}>Delete</button>}
        </div>
      </header>

      {(project.links ?? []).map((l) => <Folder key={l} S={S} name={l} refresh={refresh} />)}
      {defaults.length > 0 && <div className="tool-chips proj-defaults" aria-label="This project's defaults">{defaults.map((d) => <code key={d}>{d}</code>)}</div>}

      <section className="proj-about">
        <div className="proj-section-head"><div className="section-label">What you've told the crew</div><button type="button" className="linkish" onClick={() => onEdit(project)}>Edit</button></div>
        {project.description
          ? <Markdown text={project.description} />
          : <div className="meta">Nothing yet. Add a description and the crew will have it at the start of every conversation here.</div>}
        {!!project.pins?.length && (
          <div className="proj-pins"><b>Pinned references</b>{project.pins.map((p) => /^https?:\/\//i.test(p)
            ? <a key={p} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
            : <code key={p}>{p}</code>)}</div>
        )}
      </section>

      {!general && hasFolders && (
        <Editable label="Survey of the project" text={page?.brief ?? ""} onSave={save("project.brief", {})}
          hint="Markdown. The crew sees this in every conversation in the project."
          empty={<>Not surveyed yet. <button type="button" className="linkish" disabled={surveying} onClick={() => setAskSurvey(true)}>Survey this project</button> and the Scout will write up its stack, layout, and commands, so the crew stops rediscovering them.</>} />
      )}
      {!general && (
        <Editable label="What the crew has learned here" text={page?.notes ?? ""} onSave={save("project.notes", {})}
          hint="One lesson per line. The crew adds to this with project_remember; it's loaded only in this project."
          empty="Nothing yet. As the crew works here they keep what's worth remembering about this project: its layout, the commands that work, how you like things done." />
      )}

      {!general && <ChronicleSection project={project} reloadKey={stamp} onOpen={(thread) => { refresh(); setView({ kind: "conversation", id: thread }); }} />}

      {page && page.usage.runs > 0 && (
        <section>
          <div className="section-label">Usage</div>
          <div className="stat-grid">
            <div className="stat"><b>{money(page.usage.week)}</b><span>last 7 days{S.runtime === "claude-code" ? " (est.)" : ""}</span></div>
            <div className="stat"><b>{money(page.usage.cost)}</b><span>all time{S.runtime === "claude-code" ? " (est.)" : ""}</span></div>
            <div className="stat"><b>{page.usage.runs}</b><span>{plural(page.usage.runs, "run")}{page.usage.lastRun ? ` · last ${when(page.usage.lastRun)}` : ""}</span></div>
          </div>
        </section>
      )}

      <PayoffSection project={project} reloadKey={stamp} estimated={S.runtime === "claude-code"} />

      {page && page.workspaces.length > 0 && (
        <section>
          <div className="section-label">Worktrees and branches</div>
          <div className="proj-box"><WorkspaceBox workspaces={page.workspaces} task={project.name} /></div>
        </section>
      )}

      {page && page.changed.length > 0 && (
        <section>
          <div className="section-label">Files changed recently</div>
          <ul className="proj-files">
            {page.changed.map((f) => (
              <li key={f.path}><span className="chg">{f.change === "modified" ? "changed" : f.change}</span><code>{f.path}</code>
                <button type="button" className="linkish" onClick={() => setView({ kind: "conversation", id: f.conversation })}>{f.title}</button></li>
            ))}
          </ul>
        </section>
      )}

      {page && page.jobs.length > 0 && (
        <section>
          <div className="section-label">Scheduled jobs</div>
          <ul className="proj-files">
            {page.jobs.map((j) => <li key={j.name}><span className="chg">{j.enabled ? "on" : "off"}</span><code>{j.name}</code><span className="meta">{j.schedule}{j.lastRun ? ` · last ran ${when(j.lastRun)}` : " · hasn't run yet"}</span></li>)}
          </ul>
        </section>
      )}

      <section>
        <div className="section-label">Conversations</div>
        {list.length === 0
          ? <div className="meta">None yet. <button type="button" className="linkish" onClick={() => setView({ kind: "new", project: general ? undefined : project.id })}>Start one</button></div>
          : <ul className="proj-list">{list.map((c) => <ConversationRow key={c.id} c={c} activity={activity[c.id]} onOpen={() => setView({ kind: "conversation", id: c.id })} />)}</ul>}
      </section>
    </div>
  );
}

function ConversationRow({ c, activity, onOpen }: { c: Conversation; activity?: { running: boolean; needs: number }; onOpen: () => void }) {
  const running = activity?.running;
  const ok = c.status === "done";
  return (
    <li>
      <button type="button" className="proj-row" onClick={onOpen}>
        <span className="proj-row-title">{c.direct ? `@${c.agent} · ` : ""}{c.title}</span>
        {activity?.needs ? <span className="hist-needs" title={`${activity.needs} waiting for your decision`}>{activity.needs}</span> : null}
        {running ? <span className="pill live">Running</span> : !ok && <span className="pill bad">{spaced(c.status === "running" ? "interrupted" : c.status)}</span>}
        <span className="meta">{c.expeditions.length > 1 ? `${c.expeditions.length} runs · ` : ""}{when(c.updated)}</span>
      </button>
    </li>
  );
}

export function ProjectsOverview({ S, setView, onNew }: { S: CampState; setView: (v: View) => void; onNew: () => void }) {
  return (
    <div className="feed proj-page">
      <header className="proj-head">
        <div>
          <h2>Projects</h2>
          <div className="meta">Each project keeps its conversations together and decides what the crew sees: its folders, your notes, and what they've learned there.</div>
        </div>
        <div className="proj-actions"><button type="button" className="btn small primary" onClick={onNew}><span aria-hidden="true">＋ </span>New project</button></div>
      </header>
      <div className="proj-grid">
        {S.history.projects.map((p) => {
          const list = ofProject(S, p.id);
          return (
            <button key={p.id} type="button" className="proj-card" onClick={() => setView({ kind: "project", id: p.id })}>
              <b>{p.pinned && <><Icon name="pin" /> </>}{p.name}</b>
              {!!p.links?.length && <code>{p.links.map((l) => `links/${l}/`).join("  ")}</code>}
              <span className="proj-card-desc">{plain(p.description) || (p.id === "general" ? "Anything not filed under a project." : "No description yet.")}</span>
              <span className="meta">{list.length} {plural(list.length, "conversation")}{list[0] ? ` · last ${when(list[0].updated)}` : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
