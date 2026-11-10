// The Files flyout on the right of the page: the folders attached to where you are (the project's
// own, ones attached to the conversation or sitting in the message box), as a tree you can open.
//
// Folders load one level at a time as you open them. A file opens in a viewer; the @ beside a
// row puts a reference to it in your message. Files git reports as changed carry a letter
// (M modified, A added, U untracked), so you can see what the crew touched. When a conversation
// worked in its own worktree, the tree shows that worktree. Hide it with » or Ctrl+Shift+E. Its
// size is its zone's: drag the line beside it.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, errorText, storeGet, storeSet, treeImageUrl, treeQuery } from "../api.ts";
import { cx } from "../format.ts";
import type { FilePreview, Listing, TreeEntry } from "../types.ts";
import { Icon } from "./bits.tsx";

// path and branch: a worktree of that linked folder, shown in its place.
export type FileRoot = { link: string; path?: string; branch?: string };

const rootKey = (r: FileRoot) => `${r.link}|${r.path ?? ""}`;
const keyOf = (r: FileRoot, rel: string) => `${rootKey(r)}\n${rel}`;
const join = (rel: string, name: string) => (rel ? `${rel}/${name}` : name);
// How the crew (and your message) names a place in a linked folder.
const refOf = (r: FileRoot, rel: string, dir: boolean) => `links/${r.link}/${rel}${dir && rel ? "/" : ""}`;
const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const isImage = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);

function remembered(): string[] {
  try { const v = JSON.parse(storeGet("camp-files-open") ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

type Folder = { entries?: TreeEntry[]; more?: number; error?: string };
type Item = { kind: "root" | "dir" | "file"; key: string; root: FileRoot; rel: string; name: string; depth: number; open?: boolean; entry?: TreeEntry; mark?: string };
type Row = Item | { kind: "note"; key: string; depth: number; text: string; bad?: boolean };

// The slim tab down the right edge that brings the flyout back.
export function FilesRail({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="files-rail" aria-label="Show files" title="Show files (Ctrl+Shift+E)" onClick={onShow}>
      <Icon name="folder" /><span>Files</span>
    </button>
  );
}

// refreshKey: changes when the crew starts or finishes a run, so the tree is read again.
export function FilesPanel({ roots: asked, refreshKey = 0, onHide, onMention }: {
  roots: FileRoot[]; refreshKey?: number; onHide: () => void; onMention: (path: string) => void;
}) {
  const [dirs, setDirs] = useState<Record<string, Folder>>({});
  const [changed, setChanged] = useState<Record<string, Record<string, string>>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(remembered())); // folders you opened
  const [shut, setShut] = useState<Set<string>>(new Set());                   // top folders you closed (they start open)
  const [gone, setGone] = useState<Set<string>>(new Set());                   // worktrees that aren't there any more
  const [tick, setTick] = useState(0);
  const [viewing, setViewing] = useState<{ root: FileRoot; rel: string } | null>(null);
  const tree = useRef<HTMLDivElement>(null);

  // A worktree that has been removed since: show the linked folder itself instead.
  const roots = useMemo(() => {
    const seen = new Set<string>();
    return asked.map((r) => (gone.has(rootKey(r)) ? { link: r.link } : r)).filter((r) => !seen.has(rootKey(r)) && !!seen.add(rootKey(r)));
  }, [asked, gone]);

  const load = useCallback(async (root: FileRoot, rel: string) => {
    try {
      const r = await api<Listing>(`/api/tree?${treeQuery(root.link, root.path, rel)}`);
      setDirs((d) => ({ ...d, [keyOf(root, rel)]: { entries: r.entries, more: r.more } }));
      if (!rel) setChanged((c) => ({ ...c, [rootKey(root)]: r.changed ?? {} }));
    } catch (e) {
      if (!rel && root.path) return setGone((g) => new Set(g).add(rootKey(root)));
      setDirs((d) => ({ ...d, [keyOf(root, rel)]: { error: errorText(e) } }));
    }
  }, []);

  // Read every folder that's open and on show; again when asked, when the crew starts or
  // finishes a run, and when you come back to the window.
  const stamp = `${tick}:${refreshKey}`;
  const read = useRef(new Map<string, string>());
  useEffect(() => {
    for (const r of roots) {
      const rk = rootKey(r);
      if (shut.has(rk)) continue;
      const shown = (rel: string) => rel.split("/").every((_, i, parts) => open.has(`${rk}\n${parts.slice(0, i + 1).join("/")}`));
      const rels = ["", ...[...open].filter((k) => k.startsWith(rk + "\n")).map((k) => k.slice(rk.length + 1)).filter(shown)];
      for (const rel of rels) {
        const key = keyOf(r, rel);
        if (read.current.get(key) === stamp) continue;
        read.current.set(key, stamp);
        void load(r, rel);
      }
    }
  }, [roots, open, shut, stamp, load]);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    addEventListener("focus", again);
    return () => removeEventListener("focus", again);
  }, []);

  const toggle = useCallback((row: Item) => {
    if (row.kind === "root") return setShut((s) => { const n = new Set(s); if (!n.delete(rootKey(row.root))) n.add(rootKey(row.root)); return n; });
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(row.key)) n.add(row.key);
      storeSet("camp-files-open", JSON.stringify([...n].slice(-200)));
      return n;
    });
  }, []);

  // The tree as the rows on show, top to bottom.
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const root of roots) {
      const rk = rootKey(root);
      const marks = changed[rk] ?? {};
      const touched = new Set<string>(); // folders with a change somewhere inside
      const fresh: string[] = [];        // whole folders git doesn't know yet
      for (const p of Object.keys(marks)) {
        if (p.endsWith("/")) fresh.push(p);
        const parts = p.replace(/\/$/, "").split("/");
        for (let i = 1; i < parts.length; i++) touched.add(parts.slice(0, i).join("/"));
      }
      const markOf = (rel: string, dir: boolean) =>
        fresh.some((f) => (rel + "/").startsWith(f)) ? "U" : dir ? (touched.has(rel) ? "•" : undefined) : marks[rel];
      const walk = (rel: string, depth: number) => {
        const f = dirs[keyOf(root, rel)];
        if (!f) return out.push({ kind: "note", key: `${keyOf(root, rel)}\nloading`, depth, text: "Loading…" });
        if (f.error) return out.push({ kind: "note", key: `${keyOf(root, rel)}\nerror`, depth, text: f.error, bad: true });
        if (!f.entries?.length) out.push({ kind: "note", key: `${keyOf(root, rel)}\nempty`, depth, text: "Empty" });
        for (const e of f.entries ?? []) {
          const at = join(rel, e.name), key = keyOf(root, at);
          const isOpen = e.dir && open.has(key);
          out.push({ kind: e.dir ? "dir" : "file", key, root, rel: at, name: e.name, depth, open: isOpen, entry: e, mark: markOf(at, e.dir) });
          if (isOpen) walk(at, depth + 1);
        }
        if (f.more) out.push({ kind: "note", key: `${keyOf(root, rel)}\nmore`, depth, text: `…and ${f.more} more, not shown` });
      };
      const isOpen = !shut.has(rk);
      out.push({ kind: "root", key: keyOf(root, ""), root, rel: "", name: root.link, depth: 0, open: isOpen, mark: Object.keys(marks).length ? "•" : undefined });
      if (isOpen) walk("", 1);
    }
    return out;
  }, [roots, dirs, changed, open, shut]);

  // Arrow keys move through the rows; right and left open and close folders.
  function onKeyDown(ev: KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(ev.key)) return;
    const buttons = [...(tree.current?.querySelectorAll<HTMLButtonElement>("button.ft-open") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    ev.preventDefault();
    const here = buttons[i], depth = Number(here.dataset.depth), isOpen = here.getAttribute("aria-expanded");
    if (ev.key === "ArrowDown") buttons[i + 1]?.focus();
    else if (ev.key === "ArrowUp") buttons[i - 1]?.focus();
    else if (ev.key === "ArrowRight") { if (isOpen === "false") here.click(); else buttons[i + 1]?.focus(); }
    else if (isOpen === "true") here.click();
    else buttons.slice(0, i).reverse().find((b) => Number(b.dataset.depth) < depth)?.focus();
  }

  return (
    <aside className="files" aria-label="Files">
      <header className="files-head">
        <span className="term-label">Files</span>
        <button type="button" className="hist-icon" aria-label="Refresh the files" title="Read the folders again" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" /></button>
        <button type="button" className="hist-icon" aria-label="Hide the files" title="Hide (Ctrl+Shift+E)" onClick={onHide}>»</button>
      </header>
      <div className="files-tree" role="tree" aria-label="Attached folders" ref={tree} onKeyDown={onKeyDown}>
        {rows.map((row) => {
          const indent = { "--depth": row.depth } as CSSProperties;
          if (row.kind === "note") return <div key={row.key} className={cx("ft-note", row.bad && "bad")} style={indent}>{row.text}</div>;
          const folder = row.kind !== "file";
          const e = row.entry;
          const locked = !!e?.secret || !!e?.outside;
          const ref = refOf(row.root, row.rel, folder);
          const title = e?.secret ? "A secret (keys, .env, credentials): listed, but not opened here or by the crew"
            : e?.outside ? "A link that leads outside this folder, so it isn't followed"
            : row.kind === "root" ? `${row.root.path ?? ref}${row.root.branch ? ` (worktree on ${row.root.branch})` : ""}`
            : `${ref}${e?.size != null ? ` · ${sizeText(e.size)}` : ""}`;
          return (
            <div key={row.key} role="treeitem" aria-level={row.depth + 1}
              className={cx("ft-row", row.kind === "root" && "ft-root", locked && "locked", row.mark && row.mark !== "•" && `ft-${row.mark}`)} style={indent}>
              <button type="button" className="ft-open" data-depth={row.depth} aria-expanded={folder && !locked ? !!row.open : undefined} aria-disabled={locked || undefined} title={title}
                onClick={() => { if (locked) return; if (row.kind === "file") setViewing({ root: row.root, rel: row.rel }); else toggle(row); }}>
                <span className="ft-twist">{folder && !locked && <Icon name={row.open ? "chevron" : "chevronRight"} />}</span>
                <Icon name={folder ? "folder" : isImage(row.name) ? "image" : "file"} />
                <span className="ft-name">{row.name}</span>
                {row.kind === "root" && row.root.branch && <span className="ft-branch"><Icon name="branch" />{row.root.branch}</span>}
                {row.mark && <span className="ft-mark" title={row.mark === "•" ? "Has changes inside" : { M: "Modified", A: "Added", U: "Untracked", D: "Deleted" }[row.mark]}>{row.mark}</span>}
              </button>
              {!locked && (
                <button type="button" className="ft-at" aria-label={`Mention ${row.name} in your message`} title={`Put ${ref} in your message`} onClick={() => onMention(ref)}>@</button>
              )}
            </div>
          );
        })}
      </div>
      {viewing && <FileViewer root={viewing.root} rel={viewing.rel} onClose={() => setViewing(null)} onMention={(p) => { onMention(p); setViewing(null); }} />}
    </aside>
  );
}

// One file, opened over the page: its text with line numbers, or the image.
function FileViewer({ root, rel, onClose, onMention }: { root: FileRoot; rel: string; onClose: () => void; onMention: (path: string) => void }) {
  const [file, setFile] = useState<FilePreview | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const ref = refOf(root, rel, false);

  useEffect(() => {
    let gone = false;
    api<FilePreview>(`/api/tree/file?${treeQuery(root.link, root.path, rel)}`).then((f) => { if (!gone) setFile(f); }, (e) => { if (!gone) setError(errorText(e)); });
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => { gone = true; document.removeEventListener("keydown", esc); };
  }, [root.link, root.path, rel, onClose]);

  const lines = file && "text" in file ? file.text.replace(/\n$/, "").split("\n") : null;
  async function copy() {
    try { await navigator.clipboard.writeText(file?.abs ?? ref); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard here */ }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="dialog file-view" role="dialog" aria-modal="true" aria-label={ref}>
        <header className="file-head">
          <Icon name={isImage(rel) ? "image" : "file"} />
          <b title={file?.abs}>{ref}</b>
          {file && <small>{sizeText(file.size)}{lines ? ` · ${lines.length} ${lines.length === 1 ? "line" : "lines"}` : ""}</small>}
          <button type="button" className="hist-icon" aria-label="Close the file" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="file-body">
          {error ? <div className="form-error" role="alert">{error}</div>
            : !file ? <div className="ft-note">Loading…</div>
            : lines ? (
              <div className="file-text">
                <pre className="file-nums" aria-hidden="true">{lines.map((_, i) => i + 1).join("\n")}</pre>
                <pre className="file-code">{lines.join("\n")}</pre>
              </div>
            )
            : "image" in file ? <img className="file-image" alt={rel} src={treeImageUrl(root.link, root.path, rel)} />
            : <div className="ft-note">{"tooLarge" in file ? `This file is ${sizeText(file.size)}, too large to show here.` : "This isn't a text file, so there's nothing to show."} The crew can still read it.</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={copy} disabled={!file}>{copied ? "Copied" : "Copy path"}</button>
          <button type="button" className="btn primary" onClick={() => onMention(ref)}>Mention in message</button>
        </div>
      </div>
    </>
  );
}
