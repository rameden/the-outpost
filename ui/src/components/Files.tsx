// The Files flyout on the right of the page: the folders attached to where you are (the project's
// own, ones attached to the conversation or sitting in the message box), as a tree you can open.
//
// Folders load one level at a time as you open them. A file opens in a viewer; the @ beside a
// row puts a reference to it in your message. Files git reports as changed carry a letter
// (M modified, A added, U untracked), so you can see what the crew touched. When a conversation
// worked in its own worktree, the tree shows that worktree. Hide it with » or Ctrl+Shift+E. Its
// size is its zone's: drag the line beside it.
//
// While anything has changed, the foot of the drawer lists every changed file in one place
// (Changes.tsx): a section you can size, or fold down to a rail.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { api, errorText, storeGet, storeSet, treeQuery } from "../api.ts";
import { cx } from "../format.ts";
import type { Listing, TreeEntry } from "../types.ts";
import { Drawer, Icon } from "./bits.tsx";
import { Presence } from "../motion.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { Changes, type Change } from "./Changes.tsx";

// path and branch: a worktree of that linked folder, shown in its place.
export type FileRoot = { link: string; path?: string; branch?: string };

const rootKey = (r: FileRoot) => `${r.link}|${r.path ?? ""}`;
const keyOf = (r: FileRoot, rel: string) => `${rootKey(r)}\n${rel}`;
const join = (rel: string, name: string) => (rel ? `${rel}/${name}` : name);
// How the crew (and your message) names a place in a linked folder.
// (A file the camp keeps itself, such as a crew member's output, is under camp/: FileRoot link "@camp".)
export const CAMP_FILES = "@camp";
export const refOf = (r: FileRoot, rel: string, dir: boolean) => (r.link === CAMP_FILES ? `camp/${rel}` : `links/${r.link}/${rel}${dir && rel ? "/" : ""}`);
export const sizeText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const isImage = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);

// What kind of thing a file or folder is, for the colour of its icon (see .fk-… in styles.css).
// Folders are told apart by what they hold; files by what they're written in.
const FOLDERS: [RegExp, string][] = [
  [/^(node_modules|dist|build|out|coverage|target|vendor|\.next|\.turbo|\.cache|\.yarn|\.pnpm-store|__pycache__)$/i, "dim"],
  [/^\./, "config"],
  [/^(src|app|apps|lib|libs|packages|components|pages|server|client|api|core)$/i, "code"],
  [/^(tests?|__tests__|specs?|e2e|playwright|cypress|__mocks__|fixtures)$/i, "test"],
  [/^(docs?|documentation|wiki|notes)$/i, "doc"],
  [/^(public|static|assets|images?|img|icons|fonts|media)$/i, "media"],
  [/^(scripts?|bin|tools|ci|hooks)$/i, "script"],
  [/^(config|configs|settings|env|environments)$/i, "config"],
];
const FILES: [RegExp, string][] = [
  [/\.(test|spec)\.[cm]?[jt]sx?$|\.snap$/i, "test"],
  [/\.d\.ts$|\.[cm]?tsx?$/i, "ts"],
  [/\.[cm]?jsx?$/i, "js"],
  [/\.(json|jsonc|json5|ya?ml|toml|ini|xml|plist|csv|tsv)$/i, "data"],
  [/\.(md|mdx|markdown|txt|rst|adoc)$|^(readme|license|licence|changelog|notice|authors|contributing)(\..*)?$/i, "doc"],
  [/\.(css|scss|sass|less|styl|pcss)$/i, "style"],
  [/\.(html?|vue|svelte|astro|ejs|hbs|pug)$/i, "markup"],
  [/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|tiff?|mp4|mov|webm|mp3|wav|woff2?|ttf|otf|eot)$/i, "media"],
  [/\.(sh|bash|zsh|fish|ps1|bat|cmd)$|^(makefile|dockerfile|justfile|procfile)$/i, "script"],
  [/\.(py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|lua|ex|exs|erl|scala|dart|sql|graphql|gql|proto)$/i, "code"],
  [/\.(lock|log|map|min\.js|tsbuildinfo)$|-lock\.(json|ya?ml)$|^\.ds_store$/i, "dim"],
  [/^\.|\.(config|rc)\.[cm]?[jt]s$|rc$|\.(conf|cfg|env|editorconfig|properties)$/i, "config"],
];
export function kindOf(name: string, folder: boolean): string {
  for (const [re, kind] of folder ? FOLDERS : FILES) if (re.test(name)) return kind;
  return folder ? "folder" : "file";
}

function remembered(): string[] {
  try { const v = JSON.parse(storeGet("camp-files-open") ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}

type Folder = { entries?: TreeEntry[]; more?: number; error?: string };
type Item = { kind: "root" | "dir" | "file"; key: string; root: FileRoot; rel: string; name: string; depth: number; open?: boolean; entry?: TreeEntry; mark?: string };
type Row = Item | { kind: "note"; key: string; depth: number; text: string; bad?: boolean };

// The slim tab down the right edge that brings the flyout back.
export function FilesRail({ onShow }: { onShow: () => void }) {
  return (
    <button type="button" className="zone-rail" aria-label="Show files" title="Show files (Ctrl+Shift+E)" onClick={onShow}>
      <Icon name="folder" /><span>Files</span>
    </button>
  );
}

// refreshKey: changes when the crew starts or finishes a run, so the tree is read again.
// rootExtra: something to show under a root's row (where a worktree's branch stands, from App).
export const FilesPanel = memo(function FilesPanel({ roots: asked, refreshKey = 0, onHide, onMention, rootExtra }: {
  roots: FileRoot[]; refreshKey?: number; onHide: () => void; onMention: (path: string) => void; rootExtra?: (root: FileRoot) => ReactNode;
}) {
  const [dirs, setDirs] = useState<Record<string, Folder>>({});
  const [changed, setChanged] = useState<Record<string, Record<string, string>>>({});
  const [open, setOpen] = useState<Set<string>>(() => new Set(remembered())); // folders you opened
  const [shut, setShut] = useState<Set<string>>(new Set());                   // top folders you closed (they start open)
  const [gone, setGone] = useState<Set<string>>(new Set());                   // worktrees that aren't there any more
  const [tick, setTick] = useState(0);
  const [viewing, setViewing] = useState<{ root: FileRoot; rel: string; changes?: boolean } | null>(null);
  const closeViewing = useCallback(() => setViewing(null), []);
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

  // Every changed file in the folders on show, for the list at the foot of the drawer.
  const changes = useMemo(() => roots.flatMap((root): Change[] => Object.entries(changed[rootKey(root)] ?? {}).map(([path, mark]) => ({ root, path, mark }))), [roots, changed]);
  const openChange = useCallback((c: Change) => setViewing({ root: c.root, rel: c.path, changes: true }), []);
  // A new folder in that list: open the tree down to it.
  const reveal = useCallback((c: Change) => {
    setShut((s) => { if (!s.has(rootKey(c.root))) return s; const n = new Set(s); n.delete(rootKey(c.root)); return n; });
    setOpen((s) => {
      const n = new Set(s);
      const parts = c.path.replace(/\/$/, "").split("/");
      for (let i = 1; i <= parts.length; i++) n.add(keyOf(c.root, parts.slice(0, i).join("/")));
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
    <Drawer icon="folder" label="Files" onHide={onHide} hideLabel="Hide the files" hideTitle="Hide the files (Ctrl+Shift+E)"
      tools={<button type="button" className="hist-icon" aria-label="Refresh the files" title="Read the folders again" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" /></button>}>
      <aside className="files" aria-label="Files">
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
              <Fragment key={row.key}>
              <div role="treeitem" aria-level={row.depth + 1}
                className={cx("ft-row", row.kind === "root" && "ft-root", locked && "locked", row.mark && row.mark !== "•" && `ft-${row.mark}`, `fk-${row.kind === "root" ? "root" : kindOf(row.name, folder)}`)} style={indent}>
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
              {row.kind === "root" && rootExtra && <div className="ft-stage" role="none">{rootExtra(row.root)}</div>}
              </Fragment>
            );
          })}
        </div>
        {changes.length > 0 && <Changes changes={changes} onOpen={openChange} onReveal={reveal} onMention={onMention} />}
        <Presence>{viewing && <FileViewer root={viewing.root} rel={viewing.rel} changes={viewing.changes} onClose={closeViewing} onMention={(p) => { onMention(p); setViewing(null); }} />}</Presence>
      </aside>
    </Drawer>
  );
});
