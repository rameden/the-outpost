// The command palette: one box to jump to a page, a conversation, a project, a crew member, a
// file, a ticket, a note, a memory, a Settings section or an Activity tab, or to run one of the
// page's commands (the registry's, src/commands.ts). ⌘K or ⌘P (Ctrl+K, Ctrl+P elsewhere).
//
// Type to narrow it, loosely: each word you type has to be found in an item, in order, starting at
// the start of a word ("nw conv" finds "Start a new conversation"); closer matches come first.
// Arrows (and Home/End) move, Enter goes, Esc closes, Tab stays inside. Starting with / shows only
// the commands, all of them (that's /help). Files are looked for by name in the folders attached
// where you are, and Jira tickets by key or title, once you've typed two letters. Settings,
// Activity, Tickets, Notes and Memory only show once you type, so the box opens short.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, treeQuery } from "../api.ts";
import { cx } from "../format.ts";
import { Icon, type IconName } from "./bits.tsx";
import type { FileRoot } from "./Files.tsx";
import { Dialog } from "./Dialog.tsx";
import { w } from "../words.ts";

export type PaletteGroup = "Do" | "Pages" | "Activity" | "Settings" | "Conversations" | "Projects" | "Crew" | "Tickets" | "Notes" | "Memory" | "Files";
export type PaletteItem = { id: string; group: PaletteGroup; label: string; hint?: string; icon: IconName; run: () => void };

const PER_GROUP = 7;
const QUIET_PER_GROUP = 5;
// The groups in the order they show. The quiet ones are left out until something is typed.
const GROUPS: PaletteGroup[] = ["Do", "Pages", "Conversations", "Crew", "Projects", "Activity", "Settings", "Tickets", "Notes", "Memory", "Files"];
const QUIET = new Set<PaletteGroup>(["Activity", "Settings", "Tickets", "Notes", "Memory"]);

// How well what's typed fits an item (its label, then its hint): 0 for not at all. Every word has
// to be found; a word found whole beats one found in pieces, and the label beats the hint.
export function score(item: { label: string; hint?: string }, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = item.label.toLowerCase(), hint = (item.hint ?? "").toLowerCase();
  let total = 0;
  for (const word of words) {
    const best = Math.max(fit(label, word) * 1.5, fit(hint, word));
    if (!best) return 0;
    total += best;
  }
  return total;
}
export const matches = (item: { label: string; hint?: string }, query: string): boolean => score(item, query) > 0;

// One word in one text: whole (best at the very start, then at a word's start, then anywhere),
// else its letters in order, the first at a word's start ("nw" in "new", "nconv" in "new
// conversation", not "tartnew" in "Start a new"). Fewer jumps, and jumps to a word's start, fit better.
const startsWord = (text: string, i: number) => i === 0 || !/[a-z0-9]/.test(text[i - 1]);
function fit(text: string, word: string): number {
  if (!text) return 0;
  const at = text.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) return text.includes(` ${word}`) || startsWord(text, at) ? 80 : 50;
  let i = 0, cost = 0;
  for (let k = 0; k < word.length; k++) {
    if (k > 0 && text[i] === word[k]) { i++; continue; }
    let j = i;
    while (j < text.length && !(text[j] === word[k] && startsWord(text, j))) j++;
    if (j >= text.length) {
      if (k === 0) return 0; // the first letter starts a word
      j = text.indexOf(word[k], i);
      if (j < 0) return 0;
      cost += 12;
    } else cost += k ? 6 : 0;
    i = j + 1;
  }
  return Math.max(5, 40 - cost);
}

export function Palette({ items, roots, start = "", jira = false, onOpenFile, onOpenJira, onClose }: {
  items: PaletteItem[]; roots: FileRoot[]; start?: string; jira?: boolean; onOpenFile: (root: FileRoot, rel: string) => void; onOpenJira?: (key: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(start);
  const [at, setAt] = useState(0);
  const [files, setFiles] = useState<{ root: FileRoot; rel: string }[]>([]);
  const [issues, setIssues] = useState<{ key: string; summary: string }[]>([]);
  const list = useRef<HTMLDivElement>(null);

  // Jira tickets by key or title, a moment after you stop typing (when Jira is linked).
  useEffect(() => {
    const q = query.trim();
    if (!jira || q.length < 2) return setIssues([]);
    let gone = false;
    const t = setTimeout(() => {
      api<{ issues: { key: string; summary: string }[] }>(`/api/jira/issues?q=${encodeURIComponent(q)}`).then((r) => { if (!gone) setIssues(r.issues ?? []); }, () => { if (!gone) setIssues([]); });
    }, 200);
    return () => { gone = true; clearTimeout(t); };
  }, [query, jira]);

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
    // "/…": the commands only, all of them, narrowed by what follows the slash.
    const slash = query.trimStart().startsWith("/");
    const q = slash ? query.trim().slice(1) : query.trim();
    const fileItems: PaletteItem[] = slash ? [] : files.map(({ root, rel }) => ({
      id: `file:${root.link}:${rel}`, group: "Files", icon: "file", label: rel.slice(rel.lastIndexOf("/") + 1),
      hint: `links/${root.link}/${rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""}`, run: () => onOpenFile(root, rel),
    }));
    const jiraItems: PaletteItem[] = slash ? [] : issues.map((t) => ({ id: `jira:${t.key}`, group: "Tickets", icon: "flag", label: `${t.key}: ${t.summary}`, hint: "Jira", run: () => onOpenJira?.(t.key) }));
    const groups: { group: PaletteGroup; items: PaletteItem[]; best: number }[] = [];
    for (const group of GROUPS) {
      if (slash && group !== "Do") continue;
      if (QUIET.has(group) && !q) continue;
      const pool = group === "Files" ? fileItems : items.filter((i) => i.group === group);
      // Best first while you type; as they come otherwise.
      const scored = pool.map((item, i) => ({ item, s: group === "Files" ? 1 : score(item, q), i })).filter((x) => x.s > 0);
      if (q) scored.sort((a, b) => b.s - a.s || a.i - b.i);
      const cap = slash ? Infinity : group === "Files" ? 12 : QUIET.has(group) ? QUIET_PER_GROUP : PER_GROUP;
      const mine = [...scored.slice(0, cap).map((x) => x.item), ...(group === "Tickets" ? jiraItems : [])];
      if (mine.length) groups.push({ group, items: mine, best: scored[0]?.s ?? 1 });
    }
    // While you type, the group with the closest match comes first (files keep their place at the end).
    if (q) groups.sort((a, b) => (a.group === "Files" ? 1 : 0) - (b.group === "Files" ? 1 : 0) || b.best - a.best || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    return groups.flatMap((g) => g.items);
  }, [items, files, issues, query, onOpenFile, onOpenJira]);
  useEffect(() => { setAt(0); }, [query]);
  useEffect(() => { list.current?.querySelector(".active")?.scrollIntoView?.({ block: "nearest" }); }, [at, shown]);

  const go = (item?: PaletteItem) => { if (!item) return; onClose(); item.run(); };
  function onKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === "Escape") { ev.preventDefault(); onClose(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if ((ev.key === "Home" || ev.key === "End") && ev.ctrlKey) { ev.preventDefault(); setAt(ev.key === "Home" ? 0 : Math.max(0, shown.length - 1)); }
    else if (ev.key === "PageDown") { ev.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 8)); }
    else if (ev.key === "PageUp") { ev.preventDefault(); setAt((i) => Math.max(0, i - 8)); }
    else if (ev.key === "Enter") { ev.preventDefault(); go(shown[at]); }
  }

  return (
    <Dialog className="dialog palette" backdropClass="layout-backdrop" label="Go to anything" onClose={onClose}>
        <label className="fly-search">
          <Icon name="search" />
          <input autoFocus role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" aria-label={`Go to a page, conversation, ${w("member")}, project, file, ticket, note, setting or command`}
            aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
            placeholder="Go to a page, conversation or setting, or do something (/ for commands)…" value={query} onChange={(ev) => setQuery(ev.target.value)} onKeyDown={onKeyDown} />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {shown.map((item, i) => (
            <div key={item.id}>
              {shown[i - 1]?.group !== item.group && <div className="menu-label">{item.group}</div>}
              <button type="button" role="option" id={`palette-${i}`} tabIndex={-1} aria-selected={i === at} className={cx("palette-item", i === at && "active")}
                onMouseMove={() => setAt(i)} onClick={() => go(item)}>
                <Icon name={item.icon} /><span className="palette-label">{item.label}</span>{item.hint && <small>{item.hint}</small>}
              </button>
            </div>
          ))}
          {!shown.length && <div className="ft-note">Nothing matches{query.trim().length < 2 && roots.length ? ". Type a little more to look for files." : "."}</div>}
        </div>
    </Dialog>
  );
}
