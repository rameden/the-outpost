// The + menu in the composer: attach files, a folder, images, a link; link a folder on your
// disk without uploading it; and reuse saved prompt snippets.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import type { CampState, Link, PickResult, Snippet } from "../types.ts";

export type MenuView = "main" | "url" | "link" | "snippets";

const Icon = ({ d, children }: { d?: string; children?: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d && <path d={d} />}{children}</svg>
);
const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

const Back = ({ onClick }: { onClick: () => void }) => <button type="button" className="att-x" aria-label="Back" onClick={onClick}>←</button>;

export function AttachMenu({ S, view, setView, text, onClose, onPick, onPaste, onUrl, onAttachLink, onLinked, onInsertSnippet, onSnippets }: {
  S: CampState | null;
  view: MenuView;
  setView: (v: MenuView) => void;
  text: string;                                   // the message being written (to save as a snippet)
  onClose: () => void;
  onPick: (what: "files" | "folder" | "images") => void;
  onPaste: () => void;
  onUrl: (url: string) => void;
  onAttachLink: (link: Link) => void;             // attach a folder that's already linked
  onLinked: (link: Link) => void;                 // a folder was just linked: attach it and reload the list
  onInsertSnippet: (text: string) => void;
  onSnippets: (fn: (list: Snippet[]) => Snippet[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [access, setAccess] = useState<"read" | "write">("read");
  const [path, setPath] = useState("");
  const [linkError, setLinkError] = useState("");
  const [picking, setPicking] = useState(false);
  const [manual, setManual] = useState(false);
  const pathInput = useRef<HTMLInputElement>(null);

  // Each view starts with the keyboard on its first control.
  useEffect(() => {
    const first = view === "url" ? "input" : view === "link" ? ".pick-folder" : view === "main" ? ".menu-item" : null;
    if (first) box.current?.querySelector<HTMLElement>(`[data-view="${view}"] ${first}`)?.focus();
  }, [view]);

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

  const links = S?.links ?? [];
  const snippets = S?.snippets ?? [];
  return (
    <div className="popover attach-menu" ref={box}>
      <div className="menu-view" data-view="main" role="menu" hidden={view !== "main"}>
        <div className="menu-label">Attach</div>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("files")}><Icon d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"><path d="M14 3v5h5M9 13h6M9 17h6" /></Icon>Files…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("folder")}><Icon d={FOLDER} />Folder…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => setView("link")}>
          <Icon d={FOLDER}><path d="M10.5 14.5l3-3M9.5 12.5l-1 1a1.6 1.6 0 0 0 2.3 2.3l1-1M14.5 12.5l1-1a1.6 1.6 0 0 0-2.3-2.3l-1 1" /></Icon>
          Link a folder… <small style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 11.5 }}>no upload</small>
        </button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => onPick("images")}><Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Icon>Images…</button>
        <button type="button" className="menu-item" role="menuitem" onClick={onPaste}><Icon><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /></Icon>Paste image</button>
        <button type="button" className="menu-item" role="menuitem" onClick={() => setView("url")}><Icon d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Icon>URL…</button>
        <div className="menu-sep" />
        <button type="button" className="menu-item" role="menuitem" onClick={() => setView("snippets")}><Icon d="M4 5h16v11H8l-4 4z"><path d="M8 9h8M8 12h5" /></Icon>Prompt snippets…</button>
        <div className="menu-sep" />
        <div className="menu-tip">Tip: type <kbd>@</kbd> to reference files inline.</div>
      </div>

      <div className="menu-view" data-view="url" hidden={view !== "url"}>
        <div className="menu-head"><Back onClick={() => setView("main")} />Attach a link</div>
        <form className="menu-form" onSubmit={submitUrl}>
          <input placeholder="https://…" aria-label="Link to attach" autoComplete="off" value={url} onChange={(ev) => setUrl(ev.target.value)} />
          <button className="btn small primary" type="submit">Attach</button>
        </form>
      </div>

      <div className="menu-view" data-view="link" hidden={view !== "link"}>
        <div className="menu-head"><Back onClick={() => setView("main")} />Link a folder</div>
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
        <div className="snippet-list">
          {links.length > 0 && <div className="menu-label">Already linked</div>}
          {links.map((l) => (
            <div className="snippet" key={l.name}>
              <button type="button" className="use" onClick={() => onAttachLink(l)}>
                <strong>📁 {l.name}</strong><span>{l.path} · {l.files ?? "?"} files · {l.access === "write" ? "can edit" : "read-only"}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="menu-view" data-view="snippets" hidden={view !== "snippets"}>
        <div className="menu-head"><Back onClick={() => setView("main")} />Prompt snippets</div>
        <div className="snippet-list">
          {!snippets.length && <div className="menu-tip">No snippets yet. Write a message, then save it here.</div>}
          {snippets.map((s) => (
            <div className="snippet" key={s.id}>
              <button type="button" className="use" onClick={() => { onInsertSnippet(s.text); onClose(); }}><strong>{s.title}</strong><span>{s.text}</span></button>
              <button type="button" className="att-x" title="Delete this snippet" aria-label={`Delete snippet ${s.title}`} onClick={() => deleteSnippet(s.id)}>×</button>
            </div>
          ))}
        </div>
        <div className="menu-footer"><button type="button" className="btn small" disabled={!text.trim()} onClick={saveSnippet}>Save current message as a snippet</button></div>
      </div>
    </div>
  );
}
