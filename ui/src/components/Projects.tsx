// A project's own page, and the page that lists them all.
//
// A project's page shows what you've told the crew about it (its description and folder) and
// every conversation filed under it. Sending from here starts a new conversation in the project.

import { activityOf, type View } from "../feed/conversation.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cx, plural, spaced, when } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import type { CampState, Conversation, Project } from "../types.ts";

// A description as one plain line, for a card (the project's page shows it formatted).
const plain = (text?: string) => (text ?? "").replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
const ofProject = (S: CampState, id: string) => S.history.conversations.filter((c) => c.project === id);

function FolderLine({ S, project }: { S: CampState; project: Project }) {
  if (!project.link) return null;
  const link = S.links.find((l) => l.name === project.link);
  return (
    <div className="proj-folder" title={link?.path}>
      📁 <code>links/{project.link}/</code>
      {link ? <span>{link.path} · {link.access === "write" ? "the crew can edit" : "read-only"}</span> : <span>This folder isn't linked any more.</span>}
    </div>
  );
}

export function ProjectPage({ S, store, project, setView, onEdit, onDelete }: {
  S: CampState; store: FeedStore; project: Project; setView: (v: View) => void; onEdit: (p: Project) => void; onDelete: (p: Project) => void;
}) {
  const activity = useFeed(store, activityOf);
  const list = ofProject(S, project.id);
  const general = project.id === "general";
  return (
    <div className="feed proj-page">
      <header className="proj-head">
        <div>
          <h2>{project.name}</h2>
          <div className="meta">{list.length} {plural(list.length, "conversation")}{general ? " · anything not filed under a project" : ""}</div>
        </div>
        <div className="proj-actions">
          <button type="button" className="btn small primary" onClick={() => setView({ kind: "new", project: general ? undefined : project.id })}>New conversation</button>
          <button type="button" className="btn small" onClick={() => onEdit(project)}>Edit…</button>
          {!general && <button type="button" className="btn small danger" onClick={() => onDelete(project)}>Delete</button>}
        </div>
      </header>
      <FolderLine S={S} project={project} />
      <section className="proj-about">
        <div className="section-label">What the crew is told about it</div>
        {project.description
          ? <Markdown text={project.description} />
          : <div className="meta">Nothing yet. <button type="button" className="linkish" onClick={() => onEdit(project)}>Add a description</button> and the Quartermaster will have it at the start of every conversation here.</div>}
      </section>
      <section>
        <div className="section-label">Conversations</div>
        {list.length === 0
          ? <div className="meta">None yet. Type below to start one.</div>
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
          <div className="meta">Each project keeps its conversations together and tells the crew what it's about.</div>
        </div>
        <div className="proj-actions"><button type="button" className="btn small primary" onClick={onNew}>New project</button></div>
      </header>
      <div className="proj-grid">
        {S.history.projects.map((p) => {
          const list = ofProject(S, p.id);
          return (
            <button key={p.id} type="button" className={cx("proj-card")} onClick={() => setView({ kind: "project", id: p.id })}>
              <b>{p.name}</b>
              {p.link && <code>links/{p.link}/</code>}
              <span className="proj-card-desc">{plain(p.description) || (p.id === "general" ? "Anything not filed under a project." : "No description yet.")}</span>
              <span className="meta">{list.length} {plural(list.length, "conversation")}{list[0] ? ` · last ${when(list[0].updated)}` : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
