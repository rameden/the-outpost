// History, down the left side: your conversations with the camp, filed under projects.
//
// "New conversation" gives you a clean page, so unrelated work stays out of each other's
// context; picking a conversation shows just that one, and what you send there continues it.
// "Projects" opens the page that lists your projects (that page's "New project" button, or the
// + on this row, opens the project dialog). "All activity" is everything at once, scheduled jobs
// included. Clicking a project's name opens that project's page.
// A dot marks a conversation with something running; a number, decisions waiting on you.

import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { activityOf, type View } from "../feed/conversation.ts";
import type { Need } from "../needs.ts";
import { runningCount } from "../feed/reducer.ts";
import { useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, when } from "../format.ts";
import { Drawer, Icon } from "./bits.tsx";
import type { CampState, Conversation, History as HistoryData, Project } from "../types.ts";
import { ask } from "./Confirm.tsx";
import { usePopover } from "./usePopover.ts";
import { complain } from "./StatusLine.tsx";

import { w } from "../words.ts";
const GENERAL = "general";
const SHOWN = 5; // conversations listed under a project before "View all"

// A "⋯" button with a small menu under it. Closes on a click anywhere else, or Escape.
function Menu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const { open, setOpen, box } = usePopover();
  return (
    <span className="hist-menu" ref={box}>
      <button type="button" className="hist-icon" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v); }}>⋯</button>
      {open && <div className="hist-pop" role="menu" onClick={(ev) => ev.stopPropagation()}>{children(() => setOpen(false))}</div>}
    </span>
  );
}

// The slim tab History leaves behind while it's closed.
export function HistoryRail({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="zone-rail" aria-label="Show history" title="Show your conversations and projects" onClick={onShow}>
      <Icon name="list" /><span>History</span>
    </button>
  );
}

// needs: what's waiting on you (needs.ts), for the marks beside a conversation's title.
// onOpenWiki: go to the wiki's page. onStartTicket: open the ticket kickoff stepper.
export const History = memo(function History({ S, store, view, setView, patch, onNewProject, onEditProject, onHide, needs, onOpenWiki, onStartTicket }: {
  needs?: Need[]; onOpenWiki?: () => void; onStartTicket?: () => void;
  S: CampState | null; store: FeedStore; view: View; setView: (v: View) => void; patch: (fn: (s: CampState) => CampState) => void;
  onNewProject: () => void; onEditProject: (p: Project) => void;
  onHide?: () => void; // clicking History's rail closes it
}) {
  const activity = useFeed(store, activityOf);
  const running = useFeed(store, runningCount);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  // Search looks inside conversations too (their requests and answers), so it asks the camp.
  const [found, setFound] = useState<{ query: string; results: { id: string; snippet: string }[] } | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return void setFound(null);
    let current = true;
    const t = setTimeout(() => {
      api<{ results: { id: string; snippet: string }[] }>(`/api/history/search?q=${encodeURIComponent(q)}`)
        .then((r) => { if (current) setFound({ query: q, results: r.results }); }, () => { if (current) setFound({ query: q, results: [] }); });
    }, 180);
    return () => { current = false; clearTimeout(t); };
  }, [query]);
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(storeGet("camp-projects-closed") ?? "[]") as string[]; } catch { return []; } });
  const history = S?.history;

  const grouped = useMemo(() => {
    const by = new Map<string, Conversation[]>();
    for (const c of history?.conversations ?? []) by.set(c.project, [...(by.get(c.project) ?? []), c]);
    return by;
  }, [history]);

  // Every change goes to the camp and comes back as the new list.
  async function change(body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await api<{ history: HistoryData }>("/api/history", body);
      patch((s) => ({ ...s, history: r.history }));
      return true;
    } catch (e) { complain(errorText(e)); return false; }
  }

  function toggle(id: string) {
    setClosed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      storeSet("camp-projects-closed", JSON.stringify(next));
      return next;
    });
  }

  const selected = view.kind === "conversation" ? view.id : null;
  const projects = history?.projects ?? [];

  // Projects can be dragged into the order you want, within their part of the list (General and
  // pinned ones on top, the rest below), or moved a step at a time from their ⋯ menu.
  const tier = (p: Project) => (p.id === GENERAL || p.pinned ? 0 : 1);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  function reorder(id: string, target: string, after: boolean) {
    if (id === target) return;
    const rest = projects.filter((p) => p.id !== id);
    const moved = projects.find((p) => p.id === id);
    const at = rest.findIndex((p) => p.id === target);
    if (!moved || at < 0) return;
    const next = [...rest.slice(0, at + (after ? 1 : 0)), moved, ...rest.slice(at + (after ? 1 : 0))];
    if (next.every((p, i) => p.id === projects[i].id)) return;
    patch((s) => ({ ...s, history: { ...s.history, projects: next } })); // show it at once; the camp's answer follows
    void change({ action: "project.order", ids: next.map((p) => p.id) });
  }
  const neighbour = (p: Project, step: -1 | 1) => {
    const same = projects.filter((x) => tier(x) === tier(p));
    return same[same.indexOf(p) + step];
  };

  // Chats you had with one crew member directly are kept together under the project, behind
  // that crew member's name; they open when you click it (and stay open, in this browser).
  const [agentsOpen, setAgentsOpen] = useState<string[]>(() => { try { return JSON.parse(storeGet("camp-agents-open") ?? "[]") as string[]; } catch { return []; } });
  function toggleAgent(key: string) {
    setAgentsOpen((list) => {
      const next = list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
      storeSet("camp-agents-open", JSON.stringify(next.slice(-100)));
      return next;
    });
  }

  // What needs you in each conversation, other than a decision (which has its own count).
  const marks = new Map<string, Need[]>();
  for (const n of needs ?? []) if (n.kind !== "decision" && n.kind !== "held") marks.set(n.conversation, [...(marks.get(n.conversation) ?? []), n]);

  // Renaming happens in the row itself: Enter keeps it, Escape leaves it as it was.
  const [renaming, setRenamingNow] = useState<{ id: string; title: string } | null>(null);
  const renamingRef = useRef(renaming);
  const setRenaming = (r: { id: string; title: string } | null) => { renamingRef.current = r; setRenamingNow(r); };
  const finishRename = (keep: boolean) => {
    const r = renamingRef.current; // read here, so Enter followed by the field losing focus keeps it once
    if (!r) return;
    setRenaming(null);
    if (keep && r && r.title.trim()) void change({ action: "conversation.rename", id: r.id, title: r.title });
  };

  // grouped: it sits under its crew member's name already, so the title doesn't repeat it.
  const row = (c: Conversation, grouped = false) => {
    const a = activity[c.id];
    return (
      <li key={c.id} className={cx("hist-row", selected === c.id && "selected")}>
        {renaming?.id === c.id
          ? <input className="hist-search" autoFocus aria-label="Rename this conversation" value={renaming.title} maxLength={200}
              onFocus={(ev) => ev.currentTarget.select()} onChange={(ev) => setRenaming({ id: c.id, title: ev.target.value })} onBlur={() => finishRename(true)}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); finishRename(true); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finishRename(false); } }} />
          : (
          <button type="button" className="hist-open" title={`${c.title}\n${when(c.updated)}`} aria-current={selected === c.id ? "page" : undefined}
            onClick={() => setView({ kind: "conversation", id: c.id })}>
            {a?.running && <span className="dot live" title="Something is running here" />}
            <span className="hist-title">{c.direct && !grouped ? `@${c.agent} · ` : ""}{c.title}</span>
            {a?.needs ? <span className="hist-needs" title={`${a.needs} waiting for your decision`}>{a.needs}</span> : null}
            {!a?.needs && marks.get(c.id)?.map((n) => (
              <span key={n.key} className={cx("hist-mark", n.kind)} title={n.says}>{n.kind === "pr" ? "PR" : n.kind === "failed" ? "!" : ""}<span className="sr-only">{n.says}</span></span>
            ))}
          </button>
          )}
        <Menu label={`Options for ${c.title}`}>{(close) => (
          <>
            <button type="button" role="menuitem" onClick={() => { close(); setRenaming({ id: c.id, title: c.title }); }}>Rename…</button>
            {projects.filter((p) => p.id !== c.project).length > 0 && <div className="hist-pop-label">Move to</div>}
            {projects.filter((p) => p.id !== c.project).map((p) => (
              <button key={p.id} type="button" role="menuitem" onClick={() => { close(); void change({ action: "conversation.move", id: c.id, project: p.id }); }}>{p.name}</button>
            ))}
            <div className="hist-pop-sep" />
            <button type="button" role="menuitem" className="danger" onClick={async () => {
              close();
              if (!await ask({ title: `Remove "${c.title}" from your history?`, body: `The ${w("crew")}'s files and its record in the ${w("camp")} folder stay.`, action: "Remove", danger: true })) return;
              if (await change({ action: "conversation.remove", id: c.id }) && selected === c.id) setView({ kind: "new" });
            }}>Remove from history</button>
          </>
        )}</Menu>
      </li>
    );
  };

  const section = (p: Project) => {
    const list = grouped.get(p.id) ?? [];
    const open = !closed.includes(p.id);
    // The Quartermaster's conversations are listed as they are; a direct chat with a crew member
    // goes in that crew member's group.
    const own = list.filter((c) => !c.direct);
    const byAgent = new Map<string, Conversation[]>();
    for (const c of list) if (c.direct) byAgent.set(c.agent, [...(byAgent.get(c.agent) ?? []), c]);
    // The newest few, plus the one you're in if it's further down.
    const shown = own.filter((c, i) => i < SHOWN || c.id === selected);
    const onPage = view.kind === "project" && view.id === p.id;
    const group = ([agent, chats]: [string, Conversation[]]) => {
      const key = `${p.id}:${agent}`;
      const who = S?.characters.find((c) => c.id === agent);
      const here = chats.some((c) => c.id === selected);
      const isOpen = agentsOpen.includes(key) || here; // the one you're in is never hidden from you
      const running = chats.some((c) => activity[c.id]?.running);
      const needs = chats.reduce((n, c) => n + (activity[c.id]?.needs ?? 0), 0);
      return (
        <li key={key} className={cx("hist-agent", who && cClass(who.name))}>
          <button type="button" className="hist-agent-head" aria-expanded={isOpen} disabled={here && !agentsOpen.includes(key)}
            title={`${chats.length} ${chats.length === 1 ? "chat" : "chats"} with ${who?.name ?? `@${agent}`} in ${p.name}${here && !agentsOpen.includes(key) ? " (open because you're in one)" : ""}`}
            onClick={() => toggleAgent(key)}>
            <span className="hist-agent-twist" aria-hidden="true"><Icon name={isOpen ? "chevron" : "chevronRight"} /></span>
            <span className="hist-agent-name">@{agent}</span>
            {running && <span className="dot live" title="Something is running here" />}
            <span className="hist-agent-count">{chats.length}</span>
            {needs ? <span className="hist-needs" title={`${needs} waiting for your decision`}>{needs}</span> : null}
          </button>
          {isOpen && <ul className="hist-list hist-agent-list">{chats.map((c) => row(c, true))}</ul>}
        </li>
      );
    };
    const up = neighbour(p, -1), down = neighbour(p, 1);
    const canDrop = (ev: DragEvent) => dragging && dragging !== p.id && tier(projects.find((x) => x.id === dragging) ?? p) === tier(p) && ev.dataTransfer.types.includes("text/plain");
    return (
      <section key={p.id} className={cx("hist-project", dragging === p.id && "dragging", dropAt?.id === p.id && (dropAt.after ? "drop-after" : "drop-before"))}
        onDragOver={(ev) => {
          if (!canDrop(ev)) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          // Above the middle of its name row goes before it; anywhere lower, after it.
          const head = ev.currentTarget.querySelector(".hist-project-head")!.getBoundingClientRect();
          const after = ev.clientY > head.top + head.height / 2;
          if (dropAt?.id !== p.id || dropAt.after !== after) setDropAt({ id: p.id, after });
        }}
        onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDropAt((d) => (d?.id === p.id ? null : d)); }}
        onDrop={(ev) => {
          if (!canDrop(ev) || !dragging) return;
          ev.preventDefault();
          reorder(dragging, p.id, dropAt?.id === p.id ? dropAt.after : true);
          setDragging(null); setDropAt(null);
        }}>
        <header className={cx("hist-project-head", onPage && "selected")} draggable title="Drag to reorder"
          onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", p.id); setDragging(p.id); }}
          onDragEnd={() => { setDragging(null); setDropAt(null); }}>
          <button type="button" className="hist-project-name" aria-current={onPage ? "page" : undefined} onClick={() => setView({ kind: "project", id: p.id })}
            title={`Open ${p.name}${p.links?.length ? ` (${p.links.map((l) => `links/${l}/`).join(", ")})` : ""}`}>
            <span>{p.pinned && <><Icon name="pin" /> </>}{p.name}</span>
          </button>
          {!open && list.length > 0 && <span className="hist-project-count" title={`${list.length} ${list.length === 1 ? "conversation" : "conversations"} folded away`} aria-hidden="true">{list.length}</span>}
          <button type="button" className="hist-icon hist-chevron" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${p.name}'s conversations${open || !list.length ? "" : ` (${list.length})`}`}
            title={open ? "Hide its conversations" : "Show its conversations"} onClick={() => toggle(p.id)}><Icon name={open ? "chevron" : "chevronRight"} /></button>
          <Menu label={`Options for ${p.name}`}>{(close) => (
            <>
              <button type="button" role="menuitem" onClick={() => { close(); onEditProject(p); }}>Edit…</button>
              {up && <button type="button" role="menuitem" onClick={() => { close(); reorder(p.id, up.id, false); }}>Move up</button>}
              {down && <button type="button" role="menuitem" onClick={() => { close(); reorder(p.id, down.id, true); }}>Move down</button>}
              {p.id !== GENERAL && (
                <button type="button" role="menuitem" onClick={() => { close(); void change({ action: "project.pin", id: p.id, pinned: !p.pinned }); }}>{p.pinned ? "Unpin" : "Pin to the top"}</button>
              )}
              {p.id !== GENERAL && (
                <button type="button" role="menuitem" className="danger" onClick={async () => {
                  close();
                  if (await ask({ title: `Delete the project "${p.name}"?`, body: "Its conversations move to General. The folder itself isn't touched.", action: "Delete project", danger: true }) && await change({ action: "project.remove", id: p.id }) && onPage) setView({ kind: "projects" });
                }}>Delete project</button>
              )}
            </>
          )}</Menu>
          <button type="button" className="hist-icon" aria-label={`New conversation in ${p.name}`} title={`New conversation in ${p.name}`}
            onClick={() => setView({ kind: "new", project: p.id })}>+</button>
        </header>
        {open && (list.length
          ? <ul className="hist-list">{shown.map((c) => row(c))}{[...byAgent].map(group)}</ul>
          : <div className="hist-empty">No conversations yet.</div>)}
        {open && own.length > shown.length && (
          <button type="button" className="hist-all" onClick={() => setView({ kind: "project", id: p.id })}>View all {list.length}</button>
        )}
      </section>
    );
  };

  const panel = (
    <aside className="history" aria-label="History">
      <nav className="hist-nav">
        <div className="hist-top">
          <button type="button" className={cx("hist-nav-item", "hist-new", view.kind === "new" && !view.project && "selected")} onClick={() => setView({ kind: "new" })}>
            <Icon name="plus" />New conversation
          </button>
        </div>
        {onStartTicket && (
          <button type="button" className="hist-nav-item hist-ticket" title="Pick up a ticket: choose it, check its details, say where and who, and start" onClick={onStartTicket}>
            <Icon name="spark" />Start a ticket
          </button>
        )}
        <div className={cx("hist-nav-row", view.kind === "projects" && "selected")}>
          <button type="button" className="hist-nav-item" aria-current={view.kind === "projects" ? "page" : undefined} onClick={() => setView({ kind: "projects" })}>
            <Icon name="folder" />Projects
          </button>
          <button type="button" className="hist-icon" aria-label="Create project" title="Create project" onClick={onNewProject}>+</button>
        </div>
        <button type="button" className={cx("hist-nav-item", view.kind === "tickets" && "selected")} aria-current={view.kind === "tickets" ? "page" : undefined}
          title={S?.jira?.connected ? "Mae's own tickets, and Jira's" : "Mae's own tickets: work to do, being done, and done"} onClick={() => setView({ kind: "tickets" })}>
          <Icon name="check" />Tickets
        </button>
        {onOpenWiki && (
          <button type="button" className={cx("hist-nav-item", view.kind === "wiki" && "selected")} aria-current={view.kind === "wiki" ? "page" : undefined}
            title={`The ${w("camp")}'s wiki: facts you've told the ${w("crew")}, and notes it brought back`} onClick={onOpenWiki}>
            <Icon name="book" />Wiki
          </button>
        )}
        {/* Search turns into its own box, in place: nothing under it moves, and it isn't lit like the page you're on. */}
        {searching ? (
          <div className="hist-search-row">
            <Icon name="search" />
            <input className="hist-search" autoFocus value={query} placeholder="Search titles and what was said…" aria-label="Search conversations"
              onChange={(ev) => setQuery(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Escape") { setSearching(false); setQuery(""); } }} />
            <button type="button" className="hist-icon" aria-label="Close the search" title="Close the search (Esc)" onClick={() => { setSearching(false); setQuery(""); }}><Icon name="x" /></button>
          </div>
        ) : (
          <button type="button" className="hist-nav-item" onClick={() => { setSearching(true); setQuery(""); }}>
            <Icon name="search" />Search
          </button>
        )}
        <button type="button" className={cx("hist-nav-item", view.kind === "all" && "selected")} title="Everything at once, scheduled jobs included" onClick={() => setView({ kind: "all" })}>
          <Icon name="list" />All activity
          {running > 0 && <span className="hist-count">{running} running</span>}
        </button>
      </nav>
      <div className="hist-projects">
        {found ? (
          <>
            {found.results.length === 0 && <div className="hist-empty">Nothing mentions "{found.query}".</div>}
            <ul className="hist-list">
              {found.results.map((r) => {
                const c = history?.conversations.find((x) => x.id === r.id);
                if (!c) return null;
                return (
                  <li key={r.id} className={cx("hist-row", selected === r.id && "selected")}>
                    <button type="button" className="hist-open hist-found" title={c.title} onClick={() => setView({ kind: "conversation", id: r.id })}>
                      <span className="hist-title">{c.title}</span>
                      <small>{projects.find((p) => p.id === c.project)?.name} · {r.snippet}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : projects.map(section)}
      </div>
    </aside>
  );
  return onHide
    ? <Drawer icon="list" label="History" onHide={onHide} hideLabel="Hide the history" hideTitle="Hide the history. Its tab brings it back.">{panel}</Drawer>
    : panel;
});
