// The + menu in the composer: attach files, a folder, images, a link, a Jira ticket or one of
// your notes; then, below them, pick who to talk to and where to work. A row with a chevron opens a panel that flies
// out beside the menu (the crew, where to work, a link, a ticket, notes): `view` is "main" with
// nothing out, or the name of the panel that is.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { CampState, Note, RepoInfo, JiraRef } from "../types.ts";
import { loadNotes, titleOf, useNotes } from "../notes.ts";
import { JiraPicker } from "./Jira.tsx";
import { WorkOptions, outOnReply, workingOn, type WorkChoice } from "./WorkIn.tsx";
import { Icon as LineIcon } from "./bits.tsx";

export type MenuView = "main" | "crew" | "work" | "url" | "jira" | "notes";
type Fly = Exclude<MenuView, "main">;

const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d && <path d={d} />}{children}</svg>
);
const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

export function AttachMenu({ S, view, setView, repos, work, workLocked, workOptional, workWithout, workPlain = [], workOptIn, workWorking, onWorkAll, onWork, onBranch, onJira, onConnectJira, onClose, onTalkTo, onPick, onPaste, onUrl, onNote }: {
  S: CampState | null;
  view: MenuView;
  setView: (v: MenuView) => void;
  repos: RepoInfo[];                              // linked git repositories the next request could work in
  work: WorkChoice;                               // where it will, for each
  workLocked: boolean;                            // a follow-up: it stays where its conversation was
  workOptional?: boolean;                         // these are a project's folders: a conversation can be started without one
  workWithout?: string[];                         // a follow-up: the folders its conversation was started without
  workPlain?: string[];                           // the folders that aren't git repositories (they can be left out too)
  workOptIn?: boolean;                            // outside a project: no folder is used unless it's picked
  workWorking?: Record<string, string>;           // a follow-up: the branch its conversation works on, where that's a worktree
  onWorkAll?: (value: "" | "none") => void;       // leave every folder out, or use them all again
  onWork: (link: string, value: string) => void;
  onBranch?: (link: string, name: string, create: boolean) => Promise<void>;
  onJira?: (issue: JiraRef) => void;          // a Jira ticket picked to attach
  onConnectJira?: () => void;                 // open Settings to link Jira
  onClose: () => void;
  onTalkTo: (id: string | null) => void;          // send straight to this crew member; null is the Quartermaster, as usual
  onPick: (what: "files" | "folder" | "zip" | "images") => void;
  onPaste: () => void;
  onUrl: (url: string) => void;
  onNote?: (note: Note) => void;                  // one of your notes, picked to attach as a file
}) {
  // The folders left out right now: chosen for the next request, or (a follow-up) by the conversation.
  const leftOutNow = [...repos.map((r) => r.link), ...workPlain].filter((l) => (workLocked ? outOnReply(work, workWithout, l) : work[l] === "none"));
  const usedNow = [...repos.map((r) => r.link), ...workPlain].filter((l) => !leftOutNow.includes(l));
  const usedRepo = repos.find((r) => r.link === usedNow[0]);
  const oneRepo = repos.length === 1 && !workPlain.length && !workOptIn; // then the row is about its branch
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");

  // The menu opens with the keyboard on its first row; a panel, on its first control.
  useEffect(() => {
    const first = view === "main" ? '[data-view="main"] .menu-item' : view === "notes" ? ".fly button" : view === "work" ? ".fly .work-list button, .fly .work-list input" : ".fly input";
    // Where to work: on the choice that's made, if there is one in view.
    ((view === "work" && box.current?.querySelector<HTMLElement>('.fly .work-pick[aria-checked="true"]')) || box.current?.querySelector<HTMLElement>(first))?.focus();
  }, [view]);

  // The menu opens upwards from the message box. It may be no taller than the room above it, or
  // its top rows would be off the page (a short window, or the terminal open underneath).
  useEffect(() => {
    const fit = () => {
      const bottom = box.current?.getBoundingClientRect().bottom ?? 0;
      if (bottom > 0) box.current?.style.setProperty("--room", `${Math.max(160, Math.round(bottom) - 28)}px`); // less the menu's own padding, and a gap above it
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);

  // Rows open their panel on a click, the right arrow, or a pointer that rests on them: the
  // short wait keeps a pointer crossing other rows on its way to a panel from closing it.
  const intent = useRef(0);
  const flyTo = (v: MenuView) => { window.clearTimeout(intent.current); setView(v); };
  const rest = (v: MenuView) => { window.clearTimeout(intent.current); if (v !== view) intent.current = window.setTimeout(() => setView(v), 160); };
  useEffect(() => () => window.clearTimeout(intent.current), []);
  const flyRow = (v: Fly) => ({
    className: view === v ? "menu-item has-fly open" : "menu-item has-fly", role: "menuitem" as const, "aria-haspopup": true, "aria-expanded": view === v, "data-fly": v,
    onClick: () => flyTo(v),
    onKeyDown: (ev: KeyboardEvent<HTMLButtonElement>) => { if (ev.key === "ArrowRight") { ev.preventDefault(); flyTo(v); } },
  });
  // Left arrow in a panel (not while editing text) goes back to its row.
  function onFlyKeys(ev: KeyboardEvent<HTMLDivElement>) {
    const t = ev.target as HTMLInputElement;
    if (ev.key !== "ArrowLeft" || ((t.tagName === "INPUT" || t.tagName === "TEXTAREA") && t.value)) return;
    const row = box.current?.querySelector<HTMLElement>(`[data-fly="${view}"]`);
    ev.preventDefault();
    flyTo("main");
    setTimeout(() => row?.focus(), 0);
  }

  // The crew panel: filtered by what's typed, with one row lit.
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const crew = S?.characters ?? [];
  const found = crew.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => { if (view !== "crew") { setQ(""); setAt(0); } }, [view]);
  const talkTo = (c: (typeof crew)[number]) => onTalkTo(c.id === crew[0]?.id ? null : c.id);
  function onCrewKey(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setAt((i) => Math.min(i + 1, found.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (found[at]) talkTo(found[at]); }
  }

  function submitUrl(ev: FormEvent) {
    ev.preventDefault();
    if (!url.trim()) return;
    onUrl(url.trim());
    setUrl("");
  }

  // Your notes (notes.ts), read when their panel is first opened.
  const noted = useNotes();
  useEffect(() => { if (view === "notes" && !noted.loaded) void loadNotes(); }, [view, noted.loaded]);
  const notes = noted.notes.filter((n) => n.text.trim());

  const showWork = repos.length > 0 || (!!workOptional && workPlain.length > 0);
  return (
    <div className="popover attach-menu" ref={box}>
      <div className="menu-view" data-view="main" role="menu" onMouseLeave={() => window.clearTimeout(intent.current)}
        onMouseOver={(ev) => { const item = (ev.target as HTMLElement).closest<HTMLElement>(".menu-item"); if (item) rest((item.dataset.fly as MenuView | undefined) ?? "main"); }}>
        <div className="menu-label">Attach</div>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("files")}><Icon d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"><path d="M14 3v5h5M9 13h6M9 17h6" /></Icon>Files…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("folder")}><Icon d={FOLDER} />Folder…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("zip")}><Icon d={FOLDER}><path d="M12 10v2M12 14v2" /></Icon>Folder from .zip…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("images")}><Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Icon>Images…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={onPaste}><Icon><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /></Icon>Paste image</button>
        <button type="button" {...flyRow("url")}><Icon d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Icon>URL<LineIcon name="chevronRight" /></button>
        {onJira && <button type="button" {...flyRow("jira")}><LineIcon name="check" />Jira ticket<LineIcon name="chevronRight" /></button>}
        {onNote && <button type="button" {...flyRow("notes")}><LineIcon name="note" />Note<LineIcon name="chevronRight" /></button>}
        {/* Who answers and where they work: one group, below what's attached. */}
        {(crew.length > 1 || showWork) && <div className="menu-sep" />}
        {crew.length > 1 && <button type="button" {...flyRow("crew")}><LineIcon name="users" />Crew<LineIcon name="chevronRight" /></button>}
        {showWork && (
          <button type="button" {...flyRow("work")}>
            <LineIcon name={oneRepo ? "branch" : "folder"} />{oneRepo ? "Branch" : "Folders"}
            <small className="menu-now">{!usedNow.length ? "none used"
              : oneRepo ? workingOn(repos[0], work[repos[0].link] ?? "")
              : usedNow.length === 1 ? (usedRepo ? `${usedRepo.link} · ${workingOn(usedRepo, work[usedRepo.link] ?? "")}` : usedNow[0])
              : leftOutNow.length ? `${usedNow.length} of ${usedNow.length + leftOutNow.length} used` : `${usedNow.length} used`}</small>
            <LineIcon name="chevronRight" />
          </button>
        )}
        <div className="menu-sep" />
        <div className="menu-tip">Tip: type <kbd>@</kbd> to reference files inline.</div>
      </div>

      {view === "crew" && (
        <div className="fly" role="dialog" aria-label="Talk to a crew member" onKeyDown={onFlyKeys}>
          <label className="fly-search">
            <LineIcon name="search" />
            <input role="combobox" aria-expanded="true" aria-controls="fly-crew" aria-autocomplete="list" aria-label="Find a crew member" placeholder="Enter a crew member's name"
              autoComplete="off" value={q} onChange={(ev) => { setQ(ev.target.value); setAt(0); }} onKeyDown={onCrewKey} />
          </label>
          <div className="menu-label">Crew</div>
          <div className="fly-list" id="fly-crew" role="listbox">
            {found.map((c, i) => (
              <button key={c.id} type="button" role="option" aria-selected={i === at} className={i === at ? "fly-item active" : "fly-item"}
                title={c.role} onMouseEnter={() => setAt(i)} onClick={() => talkTo(c)}>
                <span className="fly-emoji" aria-hidden="true">{c.emoji}</span>
                <span className="fly-name">{c.name}</span>
                <small>{c.id === crew[0]?.id ? "Plans and sends the others (default)" : `Goes straight to them: @${c.id}`}</small>
                {i === at && <kbd aria-hidden="true">↵</kbd>}
              </button>
            ))}
            {!found.length && <div className="menu-tip">No one in the crew by that name.</div>}
          </div>
          <div className="fly-foot" aria-hidden="true"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Select</span><span><kbd>esc</kbd> Dismiss</span></div>
        </div>
      )}

      {view === "work" && (
        <div className="fly fly-wide work-fly" role="dialog" aria-label="Where to work" onKeyDown={onFlyKeys}>
          <WorkOptions repos={repos} choice={work} locked={workLocked} onPick={onWork} onBranch={onBranch} canLeaveOut={workOptional} without={workWithout} plain={workPlain} onPickAll={onWorkAll} optIn={workOptIn} working={workWorking} />
        </div>
      )}

      {view === "url" && (
        <div className="fly" role="dialog" aria-label="Attach a link" onKeyDown={onFlyKeys}>
          <div className="fly-head">Attach a link</div>
          <form className="menu-form" onSubmit={submitUrl}>
            <input placeholder="https://…" aria-label="Link to attach" autoComplete="off" value={url} onChange={(ev) => setUrl(ev.target.value)} />
            <button className="btn small primary" type="submit">Attach</button>
          </form>
          <div className="fly-foot" aria-hidden="true"><span><kbd>↵</kbd> Attach</span><span><kbd>esc</kbd> Dismiss</span></div>
        </div>
      )}

      {view === "jira" && onJira && (
        <div className="fly fly-wide" role="dialog" aria-label="Attach a Jira ticket" onKeyDown={onFlyKeys}>
          <div className="fly-head">Attach a Jira ticket <small>read when attached</small></div>
          <JiraPicker connected={!!S?.jira?.connected} onPick={(i) => { onJira(i); onClose(); }} onConnect={() => { onConnectJira?.(); onClose(); }} />
        </div>
      )}

      {view === "notes" && onNote && (
        <div className="fly" role="dialog" aria-label="Attach a note" onKeyDown={onFlyKeys}>
          <div className="fly-head">Attach a note <small>as a file, as it stands now</small></div>
          <div className="snippet-list">
            {!noted.loaded ? <div className="menu-tip">Opening…</div>
              : !notes.length && <div className="menu-tip">No notes yet. Write one in the Notes panel (<kbd>/notes</kbd>), then attach it here.</div>}
            {notes.map((n) => (
              <div className="snippet" key={n.id}>
                <button type="button" className="use" onClick={() => onNote(n)}><strong>{titleOf(n)}</strong><span>{n.text.trim().slice(0, 200)}</span></button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
