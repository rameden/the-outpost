// The + menu in the composer: pick who to talk to, attach files, a folder, images, a link; link
// a folder on your disk without uploading it; attach one of your notes; and reuse saved prompt snippets. A row with a
// chevron opens a panel that flies out beside the menu (the crew, where to work, a link, a
// linked folder, snippets): `view` is "main" with nothing out, or the name of the panel that is.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, Link, Note, PickResult, RepoInfo, Snippet, JiraRef } from "../types.ts";
import { loadNotes, titleOf, useNotes } from "../notes.ts";
import { JiraPicker } from "./Jira.tsx";
import { WorkOptions, outOnReply, workingOn, type WorkChoice } from "./WorkIn.tsx";
import { Icon as LineIcon } from "./bits.tsx";

export type MenuView = "main" | "crew" | "work" | "url" | "link" | "jira" | "notes" | "snippets";
type Fly = Exclude<MenuView, "main">;

const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d && <path d={d} />}{children}</svg>
);
const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

export function AttachMenu({ S, view, setView, text, repos, work, workLocked, workOptional, workWithout, workPlain = [], workOptIn, workWorking, onWorkAll, onWork, onBranch, onJira, onConnectJira, onClose, onTalkTo, onPick, onPaste, onUrl, onAttachLink, onLinked, onInsertSnippet, onSnippets, onNote }: {
  S: CampState | null;
  view: MenuView;
  setView: (v: MenuView) => void;
  text: string;                                   // the message being written (to save as a snippet)
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
  onPick: (what: "files" | "folder" | "images") => void;
  onPaste: () => void;
  onUrl: (url: string) => void;
  onAttachLink: (link: Link) => void;             // attach a folder that's already linked
  onLinked: (link: Link) => void;                 // a folder was just linked: attach it and reload the list
  onInsertSnippet: (text: string) => void;
  onSnippets: (fn: (list: Snippet[]) => Snippet[]) => void;
  onNote?: (note: Note) => void;                  // one of your notes, picked to attach as a file
}) {
  // The folders left out right now: chosen for the next request, or (a follow-up) by the conversation.
  const leftOutNow = [...repos.map((r) => r.link), ...workPlain].filter((l) => (workLocked ? outOnReply(work, workWithout, l) : work[l] === "none"));
  const usedNow = [...repos.map((r) => r.link), ...workPlain].filter((l) => !leftOutNow.includes(l));
  const usedRepo = repos.find((r) => r.link === usedNow[0]);
  const oneRepo = repos.length === 1 && !workPlain.length && !workOptIn; // then the row is about its branch
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [path, setPath] = useState("");
  const [linkError, setLinkError] = useState("");
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState(false);
  const pathInput = useRef<HTMLInputElement>(null);

  // The menu opens with the keyboard on its first row; a panel, on its first control.
  useEffect(() => {
    const first = view === "main" ? '[data-view="main"] .menu-item' : view === "link" ? ".fly .pick-folder" : view === "snippets" || view === "notes" ? ".fly button" : view === "work" ? ".fly .work-list button, .fly .work-list input" : ".fly input";
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

  async function linkFolder(folder: string) {
    setLinkError("");
    try {
      const link = await api<Link>("/api/links", { path: folder, access });
      setPath("");
      onLinked(link);
    } catch (e) {
      setPath(folder); // keep it, so a bad pick can be fixed by hand
      setLinkError(errorText(e));
    }
  }
  // The browser can't see a folder's real path, so the camp opens your system's folder dialog.
  async function chooseFolder() {
    setLinkError("");
    setPicking(true);
    try {
      const r = await api<PickResult>("/api/links/pick", {});
      if ("path" in r) await linkFolder(r.path);
      else if ("unsupported" in r) { setLinkError(r.unsupported); setManual(true); setTimeout(() => pathInput.current?.focus(), 0); }
    } catch (e) { setLinkError(errorText(e)); setManual(true); }
    finally { setPicking(false); }
  }
  function submitPath(ev: FormEvent) {
    ev.preventDefault();
    if (path.trim()) void linkFolder(path.trim());
  }
  function submitUrl(ev: FormEvent) {
    ev.preventDefault();
    if (!url.trim()) return;
    onUrl(url.trim());
    setUrl("");
  }
  async function saveSnippet() {
    const body = text.trim();
    if (!body) return;
    const s = await api<Snippet>("/api/snippets", { action: "add", title: body.split("\n")[0].slice(0, 48), text: body });
    onSnippets((list) => [...list, s]);
  }
  async function deleteSnippet(id: string) {
    await api("/api/snippets", { action: "delete", id });
    onSnippets((list) => list.filter((z) => z.id !== id));
  }

  // Your notes (notes.ts), read when their panel is first opened.
  const noted = useNotes();
  useEffect(() => { if (view === "notes" && !noted.loaded) void loadNotes(); }, [view, noted.loaded]);
  const notes = noted.notes.filter((n) => n.text.trim());

  const links = S?.links ?? [];
  const snippets = S?.snippets ?? [];
  return (
    <div className="popover attach-menu" ref={box}>
      <div className="menu-view" data-view="main" role="menu" onMouseLeave={() => window.clearTimeout(intent.current)}
        onMouseOver={(ev) => { const item = (ev.target as HTMLElement).closest<HTMLElement>(".menu-item"); if (item) rest((item.dataset.fly as MenuView | undefined) ?? "main"); }}>
        {crew.length > 1 && <>
          <div className="menu-label">Talk to</div>
          <button type="button" {...flyRow("crew")}><LineIcon name="users" />Crew<LineIcon name="chevronRight" /></button>
          <div className="menu-sep" />
        </>}
        {(repos.length > 0 || (workOptional && workPlain.length > 0)) && <>
          <div className="menu-label">Work in</div>
          <button type="button" {...flyRow("work")}>
            <LineIcon name={oneRepo ? "branch" : "folder"} />{oneRepo ? "Branch" : "Folders"}
            <small className="menu-now">{!usedNow.length ? "none used"
              : oneRepo ? workingOn(repos[0], work[repos[0].link] ?? "")
              : usedNow.length === 1 ? (usedRepo ? `${usedRepo.link} · ${workingOn(usedRepo, work[usedRepo.link] ?? "")}` : usedNow[0])
              : leftOutNow.length ? `${usedNow.length} of ${usedNow.length + leftOutNow.length} used` : `${usedNow.length} used`}</small>
            <LineIcon name="chevronRight" />
          </button>
          <div className="menu-sep" />
        </>}
        <div className="menu-label">Attach</div>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("files")}><Icon d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"><path d="M14 3v5h5M9 13h6M9 17h6" /></Icon>Files…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("folder")}><Icon d={FOLDER} />Folder…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("images")}><Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Icon>Images…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={onPaste}><Icon><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /></Icon>Paste image</button>
        <button type="button" {...flyRow("link")}>
          <Icon d={FOLDER}><path d="M10.5 14.5l3-3M9.5 12.5l-1 1a1.6 1.6 0 0 0 2.3 2.3l1-1M14.5 12.5l1-1a1.6 1.6 0 0 0-2.3-2.3l-1 1" /></Icon>
          Link a folder<LineIcon name="chevronRight" />
        </button>
        <button type="button" {...flyRow("url")}><Icon d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Icon>URL<LineIcon name="chevronRight" /></button>
        {onJira && <button type="button" {...flyRow("jira")}><LineIcon name="check" />Jira ticket<LineIcon name="chevronRight" /></button>}
        {onNote && <button type="button" {...flyRow("notes")}><LineIcon name="note" />Note<LineIcon name="chevronRight" /></button>}
        <div className="menu-sep" />
        <button type="button" {...flyRow("snippets")}><Icon d="M4 5h16v11H8l-4 4z"><path d="M8 9h8M8 12h5" /></Icon>Prompt snippets<LineIcon name="chevronRight" /></button>
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

      {view === "link" && (
        <div className="fly fly-wide" role="dialog" aria-label="Link a folder" onKeyDown={onFlyKeys}>
          <div className="fly-head">Link a folder <small>no upload</small></div>
          <form className="link-form" onSubmit={submitPath}>
            <div className="link-access">
              <label><input type="radio" name="linkAccess" value="read" checked={access === "read"} onChange={() => setAccess("read")} /> Read-only</label>
              <label><input type="radio" name="linkAccess" value="write" checked={access === "write"} onChange={() => setAccess("write")} /> Can edit</label>
            </div>
            <button className="btn small primary pick-folder" type="button" disabled={picking} onClick={chooseFolder}>{picking ? "Waiting for the folder dialog…" : "Choose folder…"}</button>
            <div className="menu-tip" style={{ padding: "2px 0 0" }}>Opens your system's folder picker. Agents read the folder where it is; nothing is uploaded.</div>
            <details className="link-manual" open={manual} onToggle={(ev) => setManual(ev.currentTarget.open)}>
              <summary>Or paste a path</summary>
              <div className="link-manual-row">
                <input id="linkPath" ref={pathInput} placeholder="/Users/you/Projects/site" aria-label="Folder path" autoComplete="off" spellCheck={false} value={path} onChange={(ev) => setPath(ev.target.value)} />
                <button className="btn small" type="submit">Link</button>
              </div>
            </details>
            {linkError && <div className="form-error">{linkError}</div>}
          </form>
          {links.length > 0 && <div className="menu-label">Already linked</div>}
          <div className="snippet-list">
            {links.map((l) => (
              <div className="snippet" key={l.name}>
                <button type="button" className="use" onClick={() => onAttachLink(l)}>
                  <strong><LineIcon name="folder" /> {l.name}</strong><span>{l.path} · {l.files ?? "?"} files · {l.access === "write" ? "can edit" : "read-only"}</span>
                </button>
              </div>
            ))}
          </div>
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

      {view === "snippets" && (
        <div className="fly" role="dialog" aria-label="Prompt snippets" onKeyDown={onFlyKeys}>
          <div className="fly-head">Prompt snippets</div>
          <div className="snippet-list">
            {!snippets.length && <div className="menu-tip">No snippets yet. Write a message, then save it here.</div>}
            {snippets.map((sn) => (
              <div className="snippet" key={sn.id}>
                <button type="button" className="use" onClick={() => { onInsertSnippet(sn.text); onClose(); }}><strong>{sn.title}</strong><span>{sn.text}</span></button>
                <button type="button" className="att-x" title="Delete this snippet" aria-label={`Delete snippet ${sn.title}`} onClick={() => deleteSnippet(sn.id)}>×</button>
              </div>
            ))}
          </div>
          <div className="menu-footer"><button type="button" className="btn small" disabled={!text.trim()} onClick={saveSnippet}>Save current message as a snippet</button></div>
        </div>
      )}
    </div>
  );
}
