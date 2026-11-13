// What has changed, at the foot of the Files drawer: every file git reports as changed in the
// folders on show, as a flat list (the tree above marks the same files, but there you have to go
// looking for them). It's there only while something has changed.
//
// Each row is a file: the folder it's in (dimmed, and the first thing to give way when there
// isn't room), its name, and what happened to it. Click one for what changed in it, old beside
// new; the @ puts it in your message. The box above the list narrows it to the paths that hold
// what you type.
//
// It starts at 30% of the drawer's height: drag the line above it to change that. Its header
// folds it down to a rail along the bottom of the drawer, which says how many files changed and
// how (a count beside each kind's square: the drawer is too narrow to spell it out, so the words
// are in its tooltip), and opens it again. Both are remembered.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { storeGet, storeSet } from "../api.ts";
import { cx } from "../format.ts";
import { DrawerHead, Icon } from "./bits.tsx";
import { refOf, type FileRoot } from "./Files.tsx";

// path: from the top of its folder. One that ends in / is a whole folder git doesn't know yet.
export type Change = { root: FileRoot; path: string; mark: string };

const WHAT: Record<string, string> = { M: "Modified", A: "Added", U: "New (git doesn't know it yet)", D: "Deleted" };
const DEFAULT_SHARE = 0.3, MIN_SHARE = 0.12, MAX_SHARE = 0.8;
const MAX_ROWS = 500; // drawn at once; the rest is counted, and the filter reaches all of it

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// How many changed, by what happened to them (a file git doesn't know yet counts as new).
export function changeCounts(changes: Change[]): { mark: string; n: number; what: string }[] {
  const n = (...marks: string[]) => changes.filter((c) => marks.includes(c.mark)).length;
  return [{ mark: "M", n: n("M"), what: "modified" }, { mark: "A", n: n("A", "U"), what: "new" }, { mark: "D", n: n("D"), what: "deleted" }].filter((k) => k.n > 0);
}
// The same in words: "8 files · 5 modified · 3 new".
export const changesSummary = (changes: Change[]) =>
  [count(changes.length, "file"), ...changeCounts(changes).map((k) => `${k.n} ${k.what}`)].join(" · ");

function rememberedShare(): number {
  const n = Number(storeGet("camp-changes-share"));
  return n >= MIN_SHARE && n <= MAX_SHARE ? n : DEFAULT_SHARE;
}

// What happened to a file, as a small square: a plus (new), a dot (modified), a minus (deleted).
// quiet: decoration beside a count that's already put in words elsewhere.
function Mark({ mark, quiet = false }: { mark: string; quiet?: boolean }) {
  return (
    <svg className={cx("ch-mark", `ch-${mark}`)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      {...(quiet ? { "aria-hidden": true } : { role: "img", "aria-label": WHAT[mark] ?? "Changed" })}>
      {!quiet && <title>{WHAT[mark] ?? "Changed"}</title>}
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3" />
      {mark === "M" ? <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" /> : <path d={mark === "D" ? "M5 8h6" : "M8 5v6M5 8h6"} />}
    </svg>
  );
}

// onOpen: a file, at what changed in it. onReveal: a new folder, opened in the tree above.
export function Changes({ changes, onOpen, onReveal, onMention }: {
  changes: Change[]; onOpen: (c: Change) => void; onReveal: (c: Change) => void; onMention: (path: string) => void;
}) {
  const [open, setOpen] = useState(() => storeGet("camp-changes") !== "closed");
  const [share, setShare] = useState(rememberedShare);
  const [filter, setFilter] = useState("");
  const box = useRef<HTMLElement>(null);

  const sorted = useMemo(() => [...changes].sort((a, b) => a.root.link.localeCompare(b.root.link) || a.path.localeCompare(b.path)), [changes]);
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? sorted.filter((c) => words.every((w) => c.path.toLowerCase().includes(w))) : sorted;
  const shown = hits.slice(0, MAX_ROWS);
  // With more than one folder on show, each folder's changes sit under its name.
  const several = new Set(sorted.map((c) => `${c.root.link}|${c.root.path ?? ""}`)).size > 1;
  const summary = changesSummary(changes);

  const toggle = () => setOpen((on) => { storeSet("camp-changes", on ? "closed" : "open"); return !on; });

  // Drag the line above the section: it's worked out from where the drag started, as a share of
  // the drawer's height, so it keeps its proportion when the drawer changes size.
  const resize = (px: number, total: number) => {
    const next = Math.min(MAX_SHARE, Math.max(MIN_SHARE, px / Math.max(1, total)));
    setShare(next);
    return next;
  };
  const sizes = () => ({ own: box.current?.getBoundingClientRect().height ?? 0, total: box.current?.parentElement?.getBoundingClientRect().height ?? 0 });
  function startDrag(ev: ReactPointerEvent<HTMLElement>) {
    ev.preventDefault();
    const from = ev.clientY, { own, total } = sizes();
    let last = share;
    const move = (m: PointerEvent) => { last = resize(own - (m.clientY - from), total); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); storeSet("camp-changes-share", String(+last.toFixed(4))); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
  function onLineKey(ev: KeyboardEvent<HTMLElement>) {
    const step = { ArrowUp: 16, ArrowDown: -16 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    const { own, total } = sizes();
    // Where the page has no sizes to measure, a step is a fixed share.
    const next = total > 0 ? resize(own + step, total) : resize(share + Math.sign(step) * 0.04, 1);
    storeSet("camp-changes-share", String(+next.toFixed(4)));
  }

  if (!open) {
    return (
      <button type="button" className="zone-rail changes-rail" aria-expanded="false" aria-label={`Show the changed files (${summary})`} title={`${summary}\n\nShow the changed files.`} onClick={toggle}>
        <Icon name="diff" /><span>Changes</span>
        <span className="rail-counts">
          <b>{changes.length}</b>
          {changeCounts(changes).map((k) => <i key={k.mark}><Mark mark={k.mark} quiet />{k.n}</i>)}
        </span>
      </button>
    );
  }
  let lastRoot = "";
  return (
    <>
      <div className="changes-line" role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Resize the changed files" title="Drag to resize"
        aria-valuenow={Math.round(share * 100)} aria-valuemin={MIN_SHARE * 100} aria-valuemax={MAX_SHARE * 100}
        onPointerDown={startDrag} onKeyDown={onLineKey} />
      <section className="changes" aria-label="Changed files" ref={box} style={{ flexBasis: `${+(share * 100).toFixed(2)}%` }}>
        <DrawerHead icon="diff" label="Changes" hideLabel="Hide the changed files" hideTitle="Fold the changed files down to a rail" onHide={toggle} />
        <label className="hist-search-row changes-filter">
          <Icon name="filter" />
          <input className="hist-search" type="search" placeholder="Filter" aria-label="Filter the changed files" value={filter} onChange={(ev) => setFilter(ev.target.value)} />
        </label>
        <div className="changes-sum" aria-live="polite">
          {words.length ? `${hits.length} of ${count(changes.length, "changed file")}` : count(changes.length, "changed file")}
        </div>
        <ul className="changes-list">
          {shown.map((c) => {
            const rootKey = `${c.root.link}|${c.root.path ?? ""}`;
            const head = several && rootKey !== lastRoot;
            lastRoot = rootKey;
            const folder = c.path.endsWith("/");
            const clean = c.path.replace(/\/$/, "");
            const cut = clean.lastIndexOf("/");
            const dir = cut < 0 ? "" : clean.slice(0, cut), name = clean.slice(cut + 1) + (folder ? "/" : "");
            const ref = refOf(c.root, clean, folder);
            const gone = c.mark === "D";
            return (
              <li key={`${rootKey}\n${c.path}`}>
                {head && <div className="ch-root"><Icon name="folder" />{c.root.link}{c.root.branch && <span className="ft-branch"><Icon name="branch" />{c.root.branch}</span>}</div>}
                <div className="ch-row">
                  <button type="button" className="ch-open" aria-disabled={gone || undefined}
                    aria-label={`${clean}${folder ? "/" : ""}: ${(WHAT[c.mark] ?? "Changed").toLowerCase()}`}
                    title={gone ? `${ref}\nDeleted, so there's nothing to open.` : folder ? `${ref}\nA new folder: show it in the tree above.` : `${ref}\nShow what changed in it.`}
                    onClick={() => { if (gone) return; if (folder) onReveal(c); else onOpen(c); }}>
                    <span className="ch-path">
                      {dir && <span className="ch-dir">{dir}</span>}
                      <span className="ch-name">{dir && <i>/</i>}{name}</span>
                    </span>
                    <Mark mark={c.mark} />
                  </button>
                  {!gone && <button type="button" className="ft-at" aria-label={`Mention the changed ${folder ? "folder" : "file"} ${clean} in your message`} title={`Put ${ref} in your message`} onClick={() => onMention(ref)}>@</button>}
                </div>
              </li>
            );
          })}
          {!hits.length && <li className="ft-note">Nothing matches “{filter.trim()}”.</li>}
          {hits.length > shown.length && <li className="ft-note">…and {hits.length - shown.length} more: type in the filter to find them.</li>}
        </ul>
      </section>
    </>
  );
}
