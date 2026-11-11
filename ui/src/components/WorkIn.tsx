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
// | "none" (leave the folder out of this conversation altogether) | "use" (outside a project: bring
// the folder in, in its linked checkout).
// A link that isn't here works in its linked checkout in a project, and isn't used outside one.
export type WorkChoice = Record<string, string>;
export const LEFT_OUT = "none";
export const USED = "use";
export const isNewWork = (v: string) => v === "new" || v.startsWith("new:");
// The folders a new conversation is started without (what /api/send takes as `without`).
export const leftOut = (choice: WorkChoice) => { const l = Object.keys(choice).filter((k) => choice[k] === LEFT_OUT); return l.length ? l : undefined; };
// Outside a project: the folders picked to be used as they are (what /api/send takes as `use`).
export const usedIn = (choice: WorkChoice) => { const l = Object.keys(choice).filter((k) => choice[k] === USED); return l.length ? l : undefined; };
// Outside a project the picker is the other way round: what it shows is "not used" for every folder
// but the ones picked or attached to the message (a pick of "use" reads as the linked checkout)…
export function outsideChoice(picks: WorkChoice, every: string[], attached: string[]): WorkChoice {
  return Object.fromEntries(every.flatMap((l) => {
    const v = picks[l];
    return v === USED ? [] : v && v !== LEFT_OUT ? [[l, v]] : attached.includes(l) ? [] : [[l, LEFT_OUT]];
  }));
}
// …and what's kept for a choice made there: the linked checkout has to be asked for, and "not used" is no pick at all.
export const outsidePick = (v: string) => (v === LEFT_OUT ? "" : v || USED);
// On a reply one thing can change: whether a folder is part of the conversation from this message
// on (where it works stays as it was). without: is the conversation without it as things stand?
// Picking what it already is takes a pick back.
export const replyPick = (v: string, without: boolean) => (v === LEFT_OUT ? (without ? "" : LEFT_OUT) : without ? USED : "");
// Is a folder out of the conversation once this reply is sent?
export const outOnReply = (choice: WorkChoice, without: string[] | undefined, link: string) => choice[link] === LEFT_OUT || (!!without?.includes(link) && choice[link] !== USED);
const branchOf = (v: string) => (v.startsWith("new:") ? v.slice(4) : "");

export function chosenWorkspaces(choice: WorkChoice) {
  const out: Record<string, { mode: "new"; branch?: string } | { mode: "existing"; path: string }> = {};
  for (const [link, v] of Object.entries(choice)) if (v !== LEFT_OUT && v !== USED) out[link] = isNewWork(v) ? { mode: "new", ...(branchOf(v) ? { branch: branchOf(v) } : {}) } : { mode: "existing", path: v };
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
// that's a worktree rather than your linked checkout). without: the folders its conversation is
// without. On a follow-up `choice` holds only what this reply changes: a folder taken out, or brought in.
// plain: the folders that aren't git repositories (no branch to show: in a project they appear here only when left out).
// optIn: outside a project, where a conversation gets no linked folder unless one is picked: only
// the folders in use are shown, and "No folder" when there are none.
export function WorkIn({ repos, choice, setChoice, followUp, open, onOpen, working, without, plain = [], optIn }: {
  without?: string[]; plain?: string[]; optIn?: boolean;
  repos: RepoInfo[]; choice: WorkChoice; setChoice: (fn: (c: WorkChoice) => WorkChoice) => void; followUp: boolean;
  open: boolean; onOpen: () => void; // the + menu's "Work in" panel
  working?: Record<string, string>;
}) {
  // Forget a choice whose worktree is gone.
  useEffect(() => {
    setChoice((c) => {
      const stale = Object.entries(c).filter(([link, v]) => !isNewWork(v) && v !== LEFT_OUT && v !== USED && !repos.find((r) => r.link === link)?.worktrees.some((w) => w.path === v));
      if (!stale.length) return c;
      const next = { ...c };
      for (const [link] of stale) delete next[link];
      return next;
    });
  }, [repos, setChoice]);

  const isOut = (l: string) => (followUp ? outOnReply(choice, without, l) : choice[l] === LEFT_OUT);
  // What a "not used" label says on a reply: it's about to be taken out, or it already was.
  const outSays = (l: string) => (choice[l] === LEFT_OUT ? `From this message on, links/${l} is out of this conversation: the crew is given nothing from it. Click to change.`
    : `This conversation is without links/${l}: the crew sees nothing of it here. Click to bring it in.`);
  const plainOut = optIn ? [] : plain.filter(isOut);
  const plainIn = optIn ? plain.filter((l) => !isOut(l)) : [];
  const shown = optIn ? repos.filter((r) => !isOut(r.link)) : repos;
  if (!repos.length && !plain.length) return null;
  return (
    <div className="work-in">
      {/* Outside a project nothing is used until it's picked: say so, in one quiet button that opens the choices. */}
      {optIn && !shown.length && !plainIn.length && (
        <button type="button" className="work-btn none-used" aria-haspopup="dialog" aria-expanded={open} aria-label="Which folders to use: none" onClick={onOpen}
          title={followUp ? "This conversation has no linked folder. Click to bring one in."
            : "Outside a project the crew is given no linked folder unless you pick one. Click to choose."}><Icon name="folder" /><span>No folder</span></button>
      )}
      {plainIn.map((l) => (
        <button key={l} type="button" className="work-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`Folder ${l}: used`} onClick={onOpen}
          title={followUp ? (choice[l] === USED ? `From this message on, this conversation uses links/${l}. Click to change.` : `This conversation uses links/${l}. Click to take it out.`) : `The next request can use links/${l}. Click to change.`}><Icon name="folder" /><span>{l}</span></button>
      ))}
      {/* A project with folders but no repository still needs a way into the panel. */}
      {!optIn && !repos.length && !plainOut.length && (
        <button type="button" className="work-btn" aria-haspopup="dialog" aria-expanded={open} aria-label="Which of this project's folders to use" onClick={onOpen}
          title="This conversation gets this project's folders. Click to leave one out."><Icon name="folder" /><span>{plain.length === 1 ? plain[0] : `${plain.length} folders`}</span></button>
      )}
      {plainOut.map((l) => (
        <button key={l} type="button" className="work-btn left-out" aria-haspopup="dialog" aria-expanded={open} aria-label={`Folder ${l}: not used`} onClick={onOpen}
          title={followUp ? outSays(l) : `The next request leaves links/${l} out: the crew is given nothing from it. Click to change.`}>
          <Icon name="folder" /><span>{l}</span><b>not used</b>
        </button>
      ))}
      {shown.map((r) => {
        const value = choice[r.link] ?? "";
        const out = isOut(r.link);
        const there = followUp ? working?.[r.link] : undefined;
        const now = out ? "not used" : there ?? workingOn(r, value);
        return (
          <button key={r.link} type="button" className={cx("work-btn", (value || there) && !out && "changed", out && "left-out")} aria-haspopup="dialog" aria-expanded={open}
            aria-label={`Where to work in ${r.link}: ${now}`} onClick={onOpen}
            title={out ? (followUp ? outSays(r.link)
                : `The next request leaves links/${r.link} out: the crew is given nothing from it. Click to change.`)
              : followUp ? (value === USED ? `From this message on, this conversation uses links/${r.link}, on ${now}. Click to change.`
                : `A follow-up keeps working where its conversation was${there ? `: its own worktree, on ${there}` : ""}. Click to take the folder out.`)
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
// without: for a follow-up, the folders its conversation is without (shown as chosen).
// working: for a follow-up, the branch its conversation works on in a repository, when that's a worktree.
// A follow-up (locked) keeps working where it was: all that can change is whether a folder is part of
// the conversation, so the only live choices are taking one out and bringing one in.
// plain: the project's folders that aren't git repositories: each can be used or left out.
// onPickAll: leave every folder out in one go, or bring them all back.
// optIn: outside a project, where nothing is used until it's picked: "Don't use it" is each folder's
// first choice (and the one it starts on), and the switch at the top only ever takes folders out.
export function WorkOptions({ repos, choice, locked, onPick, onBranch, canLeaveOut, without, plain = [], onPickAll, optIn, working }: {
  working?: Record<string, string>; canLeaveOut?: boolean; without?: string[]; plain?: string[]; onPickAll?: (value: "" | "none") => void; optIn?: boolean;
  repos: RepoInfo[]; choice: WorkChoice; locked: boolean; onPick: (link: string, value: string) => void;
  onBranch?: (link: string, name: string, create: boolean) => Promise<void>;
}) {
  const [all, setAll] = useState<string[]>([]); // repositories whose every worktree is listed
  // Where a follow-up's conversation works in a folder (its worktree, or the linked checkout), and
  // how it stands there now: that, or out of it. A folder brought back picks up where it worked.
  const home = (link: string) => repos.find((r) => r.link === link)?.worktrees.find((w) => w.branch === working?.[link])?.path ?? "";
  const stands = (link: string) => (without?.includes(link) ? LEFT_OUT : home(link));
  const valueOf = (link: string) => (!locked ? choice[link] ?? "" : choice[link] === LEFT_OUT ? LEFT_OUT : choice[link] === USED ? home(link) : stands(link));
  // On a follow-up the live choices are two: out of the conversation, or in it where it works.
  const fixed = (link: string, v: string) => locked && v !== LEFT_OUT && v !== home(link);
  const every = [...repos.map((r) => r.link), ...plain];
  const allOut = every.length > 0 && every.every((l) => valueOf(l) === LEFT_OUT);
  const inUse = every.filter((l) => valueOf(l) !== LEFT_OUT).length;
  const leaveOut = (link: string) => [LEFT_OUT, optIn ? "Don't use it" : "Leave it out",
    locked && stands(link) !== LEFT_OUT ? `From this message on, the crew is given nothing from links/${link}`
      : optIn ? `The crew is given nothing from links/${link}` : `Don't use links/${link} here: the crew is given nothing from it`] as const;
  return (
    <>
      {/* First, so it's never below a long list of worktrees: no folders at all for this conversation. */}
      {canLeaveOut && onPickAll && (optIn ? inUse > 1 : every.length > 1) && (
        <button type="button" role="menuitemcheckbox" aria-checked={allOut} className="work-opt work-none" onClick={() => onPickAll(allOut ? "" : LEFT_OUT)}>
          <span className="work-opt-name">No folders for this conversation</span>
          <small>{optIn ? `Take out the ${inUse} in use: the crew is given nothing from them`
            : allOut ? "None of this project's folders are used. Click to use them again." : `Leave out all ${every.length} of this project's folders: the crew is given nothing from them`}</small>
          {allOut && <Icon name="check" />}
        </button>
      )}
      {locked && <div className="menu-tip">A follow-up keeps working where its conversation was{onBranch ? ". You can still switch your checkout's branch." : "."} A folder can be taken out, or brought in, from this message on.</div>}
      {optIn && !locked && <div className="menu-tip">Outside a project, the crew is given only the folders you pick here or attach to the message.</div>}
      {repos.map((r) => {
        const value = valueOf(r.link);
        const option = (v: string, name: string, note: string, mono = false) => {
          const on = value === v || (v === "new" && isNewWork(value)); // a new worktree, whatever its branch is to be called
          return (
            <button key={v} type="button" role="menuitemradio" aria-checked={on} className="work-opt" disabled={fixed(r.link, v)} onClick={() => onPick(r.link, v)}>
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
            {/* Outside a project it's where each folder starts, so it comes first. */}
            {optIn && option(...leaveOut(r.link))}
            {option("", "Linked checkout", `Your own working copy, on ${r.branch}`)}
            {onBranch && !(optIn && value === LEFT_OUT) && <BranchPicker r={r} onBranch={onBranch} />}
            {r.access === "write" && option("new", "New worktree", branchOf(value) ? `On a new branch, ${branchOf(value)}` : "A fresh branch, so your checkout isn't touched")}
            {/* Before the worktrees, which can be many: it has to be in view without scrolling. */}
            {!optIn && (canLeaveOut || locked || value === LEFT_OUT) && option(...leaveOut(r.link))}
            {listed.map((w) => option(w.path, w.branch, tail(w.path), true))}
            {more > 0 && <button type="button" className="hist-all" onClick={() => setAll((l) => [...l, r.link])}>Show {more} more {more === 1 ? "worktree" : "worktrees"}</button>}
          </div>
        );
      })}
      {/* The project's folders that aren't repositories: nothing to branch, but each can still be left out. */}
      {(canLeaveOut || locked || plain.some((l) => valueOf(l) === LEFT_OUT)) && plain.map((l) => {
        const out = valueOf(l) === LEFT_OUT;
        const row = (v: string, name: string, note: string, on: boolean) => (
          <button key={v || "use"} type="button" role="menuitemradio" aria-checked={on} className="work-opt" disabled={fixed(l, v)} onClick={() => onPick(l, v)}>
            <span className="work-opt-name">{name}</span><small>{note}</small>{on && <Icon name="check" />}
          </button>
        );
        return (
          <div key={l} role="group" aria-label={l}>
            <div className="menu-label">{l}</div>
            {optIn && row(leaveOut(l)[0], leaveOut(l)[1], leaveOut(l)[2], out)}
            {row("", "Use it", "The crew can read this folder (it isn't a git repository, so there's no branch to pick)", !out)}
            {!optIn && row(leaveOut(l)[0], leaveOut(l)[1], leaveOut(l)[2], out)}
          </div>
        );
      })}
    </>
  );
}
