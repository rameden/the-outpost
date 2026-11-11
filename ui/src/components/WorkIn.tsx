// Where the next request works, for each linked git repository: a quiet label in the composer's
// control row that names the branch (so it's always in view next to Send), and the choices,
// which the + menu shows in its "Work in" panel. Clicking the label opens that panel. Its
// linked checkout (the default), a new worktree and branch (editable links only), or a
// worktree that already exists. A follow-up keeps working where its conversation was.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import type { RepoInfo } from "../types.ts";
import { cx } from "../format.ts";
import { Icon } from "./bits.tsx";

// link → "new" | "new:<branch>" (a new worktree on a branch by that name) | a worktree's path
// | "none" (leave the folder out of this conversation altogether).
// A link that isn't here works in its linked checkout.
export type WorkChoice = Record<string, string>;
export const LEFT_OUT = "none";
export const isNewWork = (v: string) => v === "new" || v.startsWith("new:");
// The folders a new conversation is started without (what /api/send takes as `without`).
export const leftOut = (choice: WorkChoice) => { const l = Object.keys(choice).filter((k) => choice[k] === LEFT_OUT); return l.length ? l : undefined; };
const branchOf = (v: string) => (v.startsWith("new:") ? v.slice(4) : "");

export function chosenWorkspaces(choice: WorkChoice) {
  const out: Record<string, { mode: "new"; branch?: string } | { mode: "existing"; path: string }> = {};
  for (const [link, v] of Object.entries(choice)) if (v !== LEFT_OUT) out[link] = isNewWork(v) ? { mode: "new", ...(branchOf(v) ? { branch: branchOf(v) } : {}) } : { mode: "existing", path: v };
  return Object.keys(out).length ? out : undefined;
}

// The linked repositories, reloaded when `reloadKey` changes (links added or removed, a send).
export function useRepos(reloadKey: unknown) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const load = useCallback(async () => {
    try { setRepos((await api<{ repos: RepoInfo[] }>("/api/repos")).repos); } catch { setRepos([]); }
  }, []);
  useEffect(() => { void load(); }, [load, reloadKey]);
  // Switch your checkout of a linked repository to a branch (or a new one), then look again.
  const switchBranch = useCallback(async (link: string, name: string, create: boolean) => {
    const r = await api<{ repos: RepoInfo[] }>("/api/repo/branch", { link, name, create });
    setRepos(r.repos);
  }, []);
  return { repos, reload: load, switchBranch };
}

// What the next request will work on in this repository: "" is the linked checkout, "new" a
// fresh worktree and branch, anything else an existing worktree's path.
export function workingOn(r: RepoInfo, value: string) {
  if (value === LEFT_OUT) return "not used";
  return isNewWork(value) ? branchOf(value) || "new branch" : r.worktrees.find((w) => w.path === value)?.branch ?? r.branch;
}

// working: for a follow-up, the branch its conversation is working on in each repository (when
// that's a worktree rather than your linked checkout). without: the folders its conversation left out.
export function WorkIn({ repos, choice, setChoice, followUp, open, onOpen, working, without }: {
  without?: string[];
  repos: RepoInfo[]; choice: WorkChoice; setChoice: (fn: (c: WorkChoice) => WorkChoice) => void; followUp: boolean;
  open: boolean; onOpen: () => void; // the + menu's "Work in" panel
  working?: Record<string, string>;
}) {
  // Forget a choice whose worktree is gone.
  useEffect(() => {
    setChoice((c) => {
      const stale = Object.entries(c).filter(([link, v]) => !isNewWork(v) && v !== LEFT_OUT && !repos.find((r) => r.link === link)?.worktrees.some((w) => w.path === v));
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
        const out = followUp ? !!without?.includes(r.link) : value === LEFT_OUT;
        const there = followUp ? working?.[r.link] : undefined;
        const now = out ? "not used" : there ?? workingOn(r, value);
        return (
          <button key={r.link} type="button" className={cx("work-btn", (value || there) && !out && "changed", out && "left-out")} aria-haspopup="dialog" aria-expanded={open}
            aria-label={`Where to work in ${r.link}: ${now}`} onClick={onOpen}
            title={out ? (followUp ? `This conversation was started without links/${r.link}: the crew sees nothing of it here. Attach the folder to bring it in.`
                : `The next request leaves links/${r.link} out: the crew is given nothing from it. Click to change.`)
              : followUp ? `A follow-up keeps working where its conversation was${there ? `: its own worktree, on ${there}` : ""}.`
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

// Your own checkout's branch, right under "Linked checkout": one box to find a branch or name a
// new one. Typing narrows the branches there are; pick one to switch to it, or make the branch
// you typed from where the checkout stands. It's `git switch`, so git refuses (and says why) if
// work you haven't committed would be overwritten. This works on a follow-up too: it's your
// checkout that changes, and the conversation carries on in it.
const SHOWN_BRANCHES = 8;
function BranchPicker({ r, onBranch }: { r: RepoInfo; onBranch: (link: string, name: string, create: boolean) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const name = typed.trim();
  // A branch that's checked out in a worktree can't be checked out here too.
  const others = (r.branches ?? []).filter((b) => b !== r.branch && !r.worktrees.some((w) => w.branch === b));
  const matches = others.filter((b) => b.toLowerCase().includes(name.toLowerCase()));
  const exists = (r.branches ?? []).includes(name) || r.worktrees.some((w) => w.branch === name);
  const go = async (branch: string, create: boolean) => {
    setBusy(true); setError(""); setDone("");
    try { await onBranch(r.link, branch, create); setTyped(""); setOpen(false); setDone(create ? `Made ${branch} and switched to it.` : `Switched to ${branch}.`); }
    catch (e) { setError(errorText(e)); }
    setBusy(false);
  };
  // Enter does what you typed: the branch by that name if there is one, otherwise a new branch by that name.
  const submit = (ev: FormEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!name || busy) return;
    if (others.includes(name)) void go(name, false);
    else if (!exists) void go(name, true);
  };
  return (
    <div className="work-branch">
      <form className="menu-form" onSubmit={submit}>
        <input aria-label={`Switch or create a branch in ${r.link}`} placeholder={`Switch branch (now ${r.branch}), or name a new one…`} value={typed} disabled={busy}
          spellCheck={false} autoCapitalize="off" autoComplete="off" onFocus={() => setOpen(true)}
          onChange={(ev) => { setTyped(ev.target.value); setOpen(true); setError(""); setDone(""); }} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Escape") { setOpen(false); (ev.target as HTMLElement).blur(); } }} />
      </form>
      {open && (
        <div className="work-branch-list" role="group" aria-label={`Branches of ${r.link}`}>
          {name && !exists && (
            <button type="button" className="work-opt work-new" disabled={busy} title={`Make ${name} from ${r.branch} and switch your checkout to it`} onClick={() => go(name, true)}>
              <span className="work-opt-name">Create <span className="mono">{name}</span></span>
              <small>A new branch from {r.branch}</small>
            </button>
          )}
          {matches.slice(0, SHOWN_BRANCHES).map((b) => (
            <button key={b} type="button" className="work-opt" disabled={busy} title={`Switch your checkout of ${r.link} to ${b}`} onClick={() => go(b, false)}>
              <span className="work-opt-name mono">{b}</span>
            </button>
          ))}
          {matches.length > SHOWN_BRANCHES && <div className="menu-tip">{matches.length - SHOWN_BRANCHES} more: type to narrow them down.</div>}
          {!matches.length && (!name || exists) && <div className="menu-tip">{name ? (name === r.branch ? "You're on that branch." : "That branch is checked out in a worktree: pick the worktree below.") : "No other branches yet. Type a name to make one."}</div>}
        </div>
      )}
      {done && <div className="menu-tip work-done" role="status">{done}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

// The choices, one group per repository, for the + menu's "Work in" panel.
const SHOWN_WORKTREES = 3;
// canLeaveOut: these are a project's folders, which a conversation there gets unless it's started without them.
// without: for a follow-up, the folders its conversation was started without (shown as chosen).
export function WorkOptions({ repos, choice, locked, onPick, onBranch, canLeaveOut, without }: {
  canLeaveOut?: boolean; without?: string[];
  repos: RepoInfo[]; choice: WorkChoice; locked: boolean; onPick: (link: string, value: string) => void;
  onBranch?: (link: string, name: string, create: boolean) => Promise<void>;
}) {
  const [all, setAll] = useState<string[]>([]); // repositories whose every worktree is listed
  return (
    <>
      {locked && <div className="menu-tip">A follow-up keeps working where its conversation was{onBranch ? ". You can still switch your checkout's branch." : "."}</div>}
      {repos.map((r) => {
        const value = locked && without?.includes(r.link) ? LEFT_OUT : choice[r.link] ?? "";
        const option = (v: string, name: string, note: string, mono = false) => {
          const on = value === v || (v === "new" && isNewWork(value)); // a new worktree, whatever its branch is to be called
          return (
            <button key={v} type="button" role="menuitemradio" aria-checked={on} className="work-opt" disabled={locked} onClick={() => onPick(r.link, v)}>
              <span className={mono ? "work-opt-name mono" : "work-opt-name"}>{name}</span>
              <small>{note}</small>
              {on && <Icon name="check" />}
            </button>
          );
        };
        // A repository can have a great many worktrees: the first few (and the one chosen), then the rest on request.
        const listed = all.includes(r.link) ? r.worktrees : r.worktrees.filter((w, i) => i < SHOWN_WORKTREES || w.path === value);
        const more = r.worktrees.length - listed.length;
        return (
          <div key={r.link} role="group" aria-label={r.link}>
            <div className="menu-label">{r.link}</div>
            {option("", "Linked checkout", `Your own working copy, on ${r.branch}`)}
            {onBranch && <BranchPicker r={r} onBranch={onBranch} />}
            {r.access === "write" && option("new", "New worktree", branchOf(value) ? `On a new branch, ${branchOf(value)}` : "A fresh branch, so your checkout isn't touched")}
            {listed.map((w) => option(w.path, w.branch, tail(w.path), true))}
            {more > 0 && <button type="button" className="hist-all" onClick={() => setAll((l) => [...l, r.link])}>Show {more} more {more === 1 ? "worktree" : "worktrees"}</button>}
            {(canLeaveOut || value === LEFT_OUT) && option(LEFT_OUT, "Leave it out", `Don't use links/${r.link} here: the crew is given nothing from it`)}
          </div>
        );
      })}
    </>
  );
}
