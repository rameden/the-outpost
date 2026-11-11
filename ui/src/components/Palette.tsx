// The command palette: one box to jump to a conversation, a project or a file, or to do
// something (new conversation, focus mode, the next decision…). ⌘P, or Ctrl+P.
//
// Type to narrow it; arrows move, Enter goes, Esc closes. Files are looked for by name in the
// folders attached where you are, once you've typed two letters.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, treeQuery } from "../api.ts";
import { cx } from "../format.ts";
import { Icon, type IconName } from "./bits.tsx";
import type { FileRoot } from "./Files.tsx";

export type PaletteItem = { id: string; group: "Do" | "Conversations" | "Projects" | "Files"; label: string; hint?: string; icon: IconName; run: () => void };

const PER_GROUP = 7;
// Every word typed has to be somewhere in the label (or its hint).
export function matches(item: { label: string; hint?: string }, query: string): boolean {
  const hay = `${item.label} ${item.hint ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function Palette({ items, roots, start = "", onOpenFile, onClose }: {
  items: PaletteItem[]; roots: FileRoot[]; start?: string; onOpenFile: (root: FileRoot, rel: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(start);
  const [at, setAt] = useState(0);
  const [files, setFiles] = useState<{ root: FileRoot; rel: string }[]>([]);
  const list = useRef<HTMLDivElement>(null);

  // Files by name, a moment after you stop typing.
  const rootsKey = roots.map((r) => `${r.link}|${r.path ?? ""}`).join(",");
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !roots.length) return setFiles([]);
    let gone = false;
    const t = setTimeout(async () => {
      const found = await Promise.all(roots.map((root) =>
        api<{ files: string[] }>(`/api/tree/find?${treeQuery(root.link, root.path, "")}&q=${encodeURIComponent(q)}`).then((r) => r.files.map((rel) => ({ root, rel })), () => [])));
      if (!gone) setFiles(found.flat());
    }, 120);
    return () => { gone = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rootsKey]);

  const shown = useMemo(() => {
    const q = query.trim();
    const fileItems: PaletteItem[] = files.map(({ root, rel }) => ({
      id: `file:${root.link}:${rel}`, group: "Files", icon: "file", label: rel.slice(rel.lastIndexOf("/") + 1),
      hint: `links/${root.link}/${rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""}`, run: () => onOpenFile(root, rel),
    }));
    const out: PaletteItem[] = [];
    for (const group of ["Do", "Conversations", "Projects", "Files"] as const) {
      const pool = group === "Files" ? fileItems : items.filter((i) => i.group === group && (!q || matches(i, q)));
      out.push(...pool.slice(0, group === "Files" ? 12 : PER_GROUP));
    }
    return out;
  }, [items, files, query, onOpenFile]);
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => { list.current?.querySelector(".active")?.scrollIntoView?.({ block: "nearest" }); }, [at, shown]);

  const go = (item?: PaletteItem) => { if (!item) return; onClose(); item.run(); };
  function onKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") { ev.preventDefault(); onClose(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); go(shown[at]); }
  }

  return (
    <>
      <div className="drawer-backdrop layout-backdrop" onClick={onClose} />
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Go to anything">
        <label className="fly-search">
          <Icon name="search" />
          <input autoFocus role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-label="Go to a conversation, project, file or command"
            placeholder="Go to a conversation, project or file, or do something…" value={query} onChange={(ev) => setQuery(ev.target.value)} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.map((item, i) => (
            <div key={item.id}>
              {shown[i - 1]?.group !== item.group && <div className="menu-label">{item.group}</div>}
              <button type="button" role="option" aria-selected={i === at} className={cx("palette-item", i === at && "active")}
                onMouseMove={() => setAt(i)} onClick={() => go(item)}>
                <Icon name={item.icon} /><span className="palette-label">{item.label}</span>{item.hint && <small>{item.hint}</small>}
              </button>
            </div>
          ))}
          {!shown.length && <div className="ft-note">Nothing matches{query.trim().length < 2 && roots.length ? ". Type a little more to look for files." : "."}</div>}
        </div>
      </div>
    </>
  );
}
