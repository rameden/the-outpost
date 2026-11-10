// Where the next request works, for each linked git repository: a quiet label in the composer's
// control row that names the branch (so it's always in view next to Send), and the choices,
// which the + menu shows in its "Work in" panel. Clicking the label opens that panel. Its
// linked checkout (the default), a new worktree and branch (editable links only), or a
// worktree that already exists. A follow-up keeps working where its conversation was.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import type { RepoInfo } from "../types.ts";
import { Icon } from "./bits.tsx";

// link → "new" | a worktree's path. A link that isn't here works in its linked checkout.
export type WorkChoice = Record<string, string>;

export function chosenWorkspaces(choice: WorkChoice) {
  const out: Record<string, { mode: "new" } | { mode: "existing"; path: string }> = {};
  for (const [link, v] of Object.entries(choice)) out[link] = v === "new" ? { mode: "new" } : { mode: "existing", path: v };
  return Object.keys(out).length ? out : undefined;
}

// The linked repositories, reloaded when `reloadKey` changes (links added or removed, a send).
export function useRepos(reloadKey: unknown) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const load = useCallback(async () => {
    try { setRepos((await api<{ repos: RepoInfo[] }>("/api/repos")).repos); } catch { setRepos([]); }
  }, []);
  useEffect(() => { void load(); }, [load, reloadKey]);
  return { repos, reload: load };
}

// What the next request will work on in this repository: "" is the linked checkout, "new" a
// fresh worktree and branch, anything else an existing worktree's path.
export function workingOn(r: RepoInfo, value: string) {
  return value === "new" ? "new branch" : r.worktrees.find((w) => w.path === value)?.branch ?? r.branch;
}

export function WorkIn({ repos, choice, setChoice, followUp, open, onOpen }: {
  repos: RepoInfo[]; choice: WorkChoice; setChoice: (fn: (c: WorkChoice) => WorkChoice) => void; followUp: boolean;
  open: boolean; onOpen: () => void; // the + menu's "Work in" panel
}) {
  // Forget a choice whose worktree is gone.
  useEffect(() => {
    setChoice((c) => {
      const stale = Object.entries(c).filter(([link, v]) => v !== "new" && !repos.find((r) => r.link === link)?.worktrees.some((w) => w.path === v));
      if (!stale.length) return c;
      const next = { ...c };
      for (const [link] of stale) delete next[link];
      return next;
    });
  }, [repos, setChoice]);

  if (!repos.length) return null;
  return (
    <div className="work-in">
      {repos.map((r) => {
        const value = choice[r.link] ?? "";
        const now = workingOn(r, value);
        return (
          <button key={r.link} type="button" className={value ? "work-btn changed" : "work-btn"} aria-haspopup="dialog" aria-expanded={open}
            aria-label={`Where to work in ${r.link}: ${now}`} onClick={onOpen}
            title={followUp ? "A follow-up keeps working where its conversation was."
              : value ? `The next request works on ${now} in ${r.link}, not your linked checkout. Click to change.`
              : `The next request works in your linked checkout of ${r.link}, on ${r.branch}. Click to change.`}>
            <Icon name="branch" /><span>{r.link}</span><b>{now}</b>
          </button>
        );
      })}
    </div>
  );
}

const tail = (path: string) => `…/${path.split("/").slice(-2).join("/")}`;

// The choices, one group per repository, for the + menu's "Work in" panel.
export function WorkOptions({ repos, choice, locked, onPick }: {
  repos: RepoInfo[]; choice: WorkChoice; locked: boolean; onPick: (link: string, value: string) => void;
}) {
  return (
    <>
      {locked && <div className="menu-tip">A follow-up keeps working where its conversation was.</div>}
      {repos.map((r) => {
        const value = choice[r.link] ?? "";
        const option = (v: string, name: string, note: string, mono = false) => (
          <button key={v} type="button" role="menuitemradio" aria-checked={value === v} className="work-opt" disabled={locked} onClick={() => onPick(r.link, v)}>
            <span className={mono ? "work-opt-name mono" : "work-opt-name"}>{name}</span>
            <small>{note}</small>
            {value === v && <Icon name="check" />}
          </button>
        );
        return (
          <div key={r.link} role="group" aria-label={r.link}>
            <div className="menu-label">{r.link}</div>
            {option("", "Linked checkout", `Your own working copy, on ${r.branch}`)}
            {r.access === "write" && option("new", "New worktree", "A fresh branch, so your checkout isn't touched")}
            {r.worktrees.map((w) => option(w.path, w.branch, tail(w.path), true))}
          </div>
        );
      })}
    </>
  );
}
