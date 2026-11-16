// Where the next request works, for each linked git repository: a quiet label in the composer's
// control row that names the branch (so it's always in view next to Send), and the choices,
// which the + menu shows in its "Work in" panel. Clicking the label opens that panel. Its
// linked checkout (the default), a new worktree and branch (editable links only), or a
// worktree that already exists. A follow-up keeps working where its conversation was.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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

// Your checkout's branch, opened from the branch name beside "Branch": one box to find a
// branch or name a new one. Typing narrows the branches there are; pick one to switch to it, or
// make the branch you typed from where the checkout stands. It's `git switch`, so git refuses (and
// says why) if work you haven't committed would be overwritten. This works on a follow-up too: it's
// your checkout that changes, and the conversation carries on in it. It's tucked away behind the
// branch name because it acts at once, on your own copy, unlike the choices around it.
const SHOWN_BRANCHES = 8;
function BranchPicker({ r, onBranch, onClose }: { r: RepoInfo; onBranch: (link: string, name: string, create: boolean) => Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState("");
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
    try { await onBranch(r.link, branch, create); setTyped(""); setDone(create ? `Made ${branch} and switched to it.` : `Switched to ${branch}.`); }
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
        <input aria-label={`Switch or create a branch in ${r.link}`} placeholder="Find a branch, or name a new one" value={typed} disabled={busy} autoFocus
          spellCheck={false} autoCapitalize="off" autoComplete="off"
          onChange={(ev) => { setTyped(ev.target.value); setError(""); setDone(""); }}
          onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Escape") onClose(); }} />
      </form>
      <div className="work-branch-list" role="group" aria-label={`Branches of ${r.link}`}>
        {name && !exists && (
          <button type="button" className="work-branch-opt work-new" disabled={busy} title={`Make ${name} from ${r.branch} and switch your checkout to it`} onClick={() => go(name, true)}>
            <span>Create <span className="mono">{name}</span></span>
            <small>A new branch from {r.branch}</small>
          </button>
        )}
        {matches.slice(0, SHOWN_BRANCHES).map((b) => (
          <button key={b} type="button" className="work-branch-opt" disabled={busy} title={`Switch your checkout of ${r.link} to ${b}`} onClick={() => go(b, false)}>
            <span className="mono">{b}</span>
          </button>
        ))}
        {matches.length > SHOWN_BRANCHES && <div className="menu-tip">{matches.length - SHOWN_BRANCHES} more: type to narrow them down.</div>}
        {!matches.length && (!name || exists) && <div className="menu-tip">{name ? (name === r.branch ? "You're on that branch." : "That branch is checked out in a worktree: pick that worktree instead.") : "No other branches yet. Type a name to make one."}</div>}
      </div>
      <div className="work-branch-foot">Switches your own checkout now, like <span className="mono">git switch</span>.</div>
      {done && <div className="menu-tip work-done" role="status">{done}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
    </div>
  );
}

// Where the crew works when it's a worktree, opened from the name beside "Worktree": the same one
// box as the branch picker. Typing narrows the worktrees there are; pick one to work in it, or make a
// new worktree on a branch by the name you typed (or, with nothing typed, one named for the request).
// Unlike the branch picker this only chooses: nothing is made until the request is sent.
const SHOWN_WORKTREES = 8;
function WorktreePicker({ r, value, onPick, onClose }: { r: RepoInfo; value: string; onPick: (value: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const name = typed.trim();
  const canMake = r.access === "write";
  const find = name.toLowerCase();
  // The one chosen first, so it's in view however many there are.
  const matches = r.worktrees.filter((w) => !find || w.branch.toLowerCase().includes(find) || w.path.toLowerCase().includes(find))
    .sort((a, b) => Number(b.path === value) - Number(a.path === value));
  const exact = r.worktrees.find((w) => w.branch === name);
  const taken = !exact && (r.branches ?? []).includes(name);
  const pick = (v: string) => { onPick(v); onClose(); };
  // Enter does what you typed: the worktree on that branch if there is one, otherwise a new one by that name.
  const submit = (ev: FormEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    if (exact) pick(exact.path);
    else if (name && canMake) pick(`new:${name}`);
    else if (matches.length === 1) pick(matches[0].path);
  };
  const newName = branchOf(value);
  return (
    <div className="work-branch">
      <form className="menu-form" onSubmit={submit}>
        <input aria-label={canMake ? `Find a worktree of ${r.link}, or name a new one` : `Find a worktree of ${r.link}`} autoFocus
          placeholder={canMake ? "Find one, or name a new branch" : "Find a worktree"} value={typed}
          spellCheck={false} autoCapitalize="off" autoComplete="off"
          onChange={(ev) => setTyped(ev.target.value)}
          onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Escape") onClose(); }} />
      </form>
      <div className="work-branch-list" role="radiogroup" aria-label={`Worktrees of ${r.link}`}>
        {canMake && (name ? !exact && (
          <button type="button" role="radio" aria-checked={newName === name} className="work-branch-opt work-new" title={`A new worktree on a new branch, ${name}, made from ${r.branch} when the request is sent`} onClick={() => pick(`new:${name}`)}>
            <span><Icon name="plus" />Create <span className="mono">{name}</span></span>
            {newName === name && <Icon name="check" />}
            <small>{taken ? `${name} is a branch already, so the new one is ${name}-2` : `A new worktree and branch from ${r.branch}`}</small>
          </button>
        ) : (
          <button type="button" role="radio" aria-checked={isNewWork(value)} className="work-branch-opt work-new" title={`A fresh branch in a folder of its own, made from ${r.branch}: your checkout isn't touched`} onClick={() => pick(newName ? value : "new")}>
            <span><Icon name="plus" />New worktree{newName && <> <span className="mono">{newName}</span></>}</span>
            {isNewWork(value) && <Icon name="check" />}
            <small>{newName ? `A new branch from ${r.branch}` : `A new branch from ${r.branch}, named for the request`}</small>
          </button>
        ))}
        {matches.slice(0, SHOWN_WORKTREES).map((w) => (
          <button key={w.path} type="button" role="radio" aria-checked={value === w.path} className="work-branch-opt work-wt" title={w.path} onClick={() => pick(w.path)}>
            <span className="mono">{w.branch}</span>{value === w.path && <Icon name="check" />}
          </button>
        ))}
        {matches.length > SHOWN_WORKTREES && <div className="menu-tip">{matches.length - SHOWN_WORKTREES} more: type to narrow them down.</div>}
        {!matches.length && (!name || !canMake || exact) && <div className="menu-tip">{name ? "No worktree matches that." : "No worktrees yet. Type a name to make one."}</div>}
      </div>
      <div className="work-branch-foot">The crew works there; your checkout isn't touched.</div>
    </div>
  );
}

// One choice of where to work: a radio row, its name, and (beside it, outside the row) what it's on.
function Pick({ on, name, title, onClick }: { on: boolean; name: string; title: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="work-pick" title={title} onClick={onClick}>
      <span className="work-dot" aria-hidden="true" /><span className="work-pick-name">{name}</span>
    </button>
  );
}

// Whether a folder is used at all: on or off, so a switch (a tick box is for picking among things).
function UseSwitch({ link, on, onChange }: { link: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch work-use" title={on ? `In use. Turn off to give the crew nothing from links/${link}.` : `Not used. Turn on to use links/${link}.`}>
      <input type="checkbox" role="switch" aria-label={`Use ${link}`} checked={on} onChange={(ev) => onChange(ev.target.checked)} />
    </label>
  );
}

// The + menu's "Where to work" panel: a card for each folder. Each card answers two questions, in
// order: is the folder used at all (the switch), and if it's a git repository, where in it the crew
// works (your checkout, or a worktree: a new one or one that exists). Switching your checkout's branch is an
// action, not a choice, so it sits behind the branch name rather than in the list.
// canLeaveOut: these are a project's folders, which a conversation there gets unless it's started without them.
// without: for a follow-up, the folders its conversation is without.
// working: for a follow-up, the branch its conversation works on in a repository, when that's a worktree.
// A follow-up (locked) keeps working where it was: all that can change is whether a folder is part of
// the conversation, so each card says where it works and offers only the switch.
// plain: the project's folders that aren't git repositories: each can be used or left out.
// onPickAll: leave every folder out in one go, or bring them all back.
// optIn: outside a project, where nothing is used until it's switched on.
export function WorkOptions({ repos, choice, locked, onPick, onBranch, canLeaveOut, without, plain = [], onPickAll, optIn, working }: {
  working?: Record<string, string>; canLeaveOut?: boolean; without?: string[]; plain?: string[]; onPickAll?: (value: "" | "none") => void; optIn?: boolean;
  repos: RepoInfo[]; choice: WorkChoice; locked: boolean; onPick: (link: string, value: string) => void;
  onBranch?: (link: string, name: string, create: boolean) => Promise<void>;
}) {
  // For each repository, what's unfolded under its choices: the branch box, or the worktree box.
  const [unfolded, setUnfolded] = useState<Record<string, "branch" | "worktrees" | undefined>>({});
  const unfold = (link: string, what: "branch" | "worktrees") => setUnfolded((u) => ({ ...u, [link]: u[link] === what ? undefined : what }));
  // Where a folder worked before it was switched off, so switching it back on puts it there again.
  const before = useRef<Record<string, string>>({});
  // Where a follow-up's conversation works in a folder (its worktree, or the linked checkout), and
  // how it stands there now: that, or out of it. A folder brought back picks up where it worked.
  const home = (link: string) => repos.find((r) => r.link === link)?.worktrees.find((w) => w.branch === working?.[link])?.path ?? "";
  const stands = (link: string) => (without?.includes(link) ? LEFT_OUT : home(link));
  const valueOf = (link: string) => (!locked ? choice[link] ?? "" : choice[link] === LEFT_OUT ? LEFT_OUT : choice[link] === USED ? home(link) : stands(link));
  const every = [...repos.map((r) => r.link), ...plain];
  const allOut = every.length > 0 && every.every((l) => valueOf(l) === LEFT_OUT);
  const inUse = every.filter((l) => valueOf(l) !== LEFT_OUT).length;
  const switchable = (link: string) => !!(canLeaveOut || locked || optIn || valueOf(link) === LEFT_OUT);
  const use = (link: string, on: boolean) => {
    if (!on) { before.current[link] = valueOf(link); return onPick(link, LEFT_OUT); }
    onPick(link, locked ? home(link) : before.current[link] ?? "");
  };
  const offNote = (link: string) => (locked && stands(link) !== LEFT_OUT ? "Taken out from this message on: the crew is given nothing from it."
    : locked ? "Not part of this conversation. Turn it on to bring it in." : "Not used: the crew is given nothing from it.");
  const bulk = !!(canLeaveOut && onPickAll && (optIn ? inUse > 1 : every.length > 1));
  const showPlain = canLeaveOut || locked || plain.some((l) => valueOf(l) === LEFT_OUT);
  return (
    <>
      {/* No heading or explanation: the cards say it. Only the one bulk action, when there's something to do in bulk. */}
      {bulk && (
        <div className="work-bar">
          <button type="button" className="work-all" onClick={() => onPickAll!(allOut ? "" : LEFT_OUT)}
            title={allOut ? "Use all of this project's folders again" : optIn ? `Take out the ${inUse} in use: the crew is given nothing from them` : `Leave out all ${every.length} folders: the crew is given nothing from them`}>
            {allOut ? "Use all" : "Use none"}
          </button>
        </div>
      )}
      <div className="fly-list work-list">
        {repos.map((r) => {
          const value = valueOf(r.link);
          const off = value === LEFT_OUT;
          const open = unfolded[r.link];
          const inWorktree = !!value && !isNewWork(value) && value !== USED && !off;
          const picked = inWorktree ? r.worktrees.find((w) => w.path === value) : undefined;
          const there = locked ? home(r.link) : "";
          // What the worktree row is on: the one picked, or the new one's branch.
          const wtName = picked?.branch ?? (isNewWork(value) ? branchOf(value) || "new branch" : "");
          // The branch your checkout is on; with a way to switch it, the name is the way in.
          const branch = onBranch ? (
            <button type="button" className="work-val work-branch-btn" aria-expanded={open === "branch"} aria-label={`Switch the branch of your checkout of ${r.link} (now ${r.branch})`}
              title="Switch your checkout to another branch, or make a new one" onClick={() => unfold(r.link, "branch")}>
              <span>{r.branch}</span><Icon name={open === "branch" ? "chevronUp" : "chevron"} />
            </button>
          ) : <span className="work-val mono">{r.branch}</span>;
          const picker = open === "branch" && onBranch && <BranchPicker r={r} onBranch={onBranch} onClose={() => unfold(r.link, "branch")} />;
          return (
            <section key={r.link} className={cx("work-card", off && "off")} role="group" aria-label={r.link}>
              <div className="work-card-head">
                <Icon name="branch" /><span className="work-card-name">{r.link}</span>
                {r.access !== "write" && <small className="work-tag">read-only</small>}
                {switchable(r.link) && <UseSwitch link={r.link} on={!off} onChange={(on) => use(r.link, on)} />}
              </div>
              {off ? !optIn && <div className="work-card-note">{offNote(r.link)}</div>
                : locked ? (
                  <>
                    <div className="work-row work-fixed">
                      <span className="work-fixed-name">{there ? "Its own worktree" : "Branch"}</span>
                      {there ? <span className="work-val mono" title={there}>{working?.[r.link]}</span> : branch}
                    </div>
                    {!there && picker}
                  </>
                ) : (
                  <div className="work-choices" role="radiogroup" aria-label={`Where to work in ${r.link}`}>
                    <div className="work-row">
                      <Pick on={value === ""} name="Branch" title={`Your own checkout of ${r.link}, on the branch beside it: the crew's changes land where you work`} onClick={() => onPick(r.link, "")} />
                      {branch}
                    </div>
                    {picker}
                    {(r.access === "write" || r.worktrees.length > 0) && (
                      <div className="work-row">
                        <Pick on={inWorktree || isNewWork(value)} name="Worktree" title={`A folder of its own: a new branch made from ${r.branch}, or a worktree that's there already. Your checkout isn't touched.`}
                          onClick={() => (inWorktree || isNewWork(value) ? undefined : r.access === "write" ? onPick(r.link, "new") : unfold(r.link, "worktrees"))} />
                        <button type="button" className="work-val work-branch-btn" aria-expanded={open === "worktrees"}
                          aria-label={`Pick or make a worktree of ${r.link}${wtName ? ` (now ${wtName})` : ""}`}
                          title={r.worktrees.length ? `Pick one of the ${r.worktrees.length} worktrees, or make a new one` : "Make a new worktree, on a branch named for the request or one you name"}
                          onClick={() => unfold(r.link, "worktrees")}>
                          <span className={cx(!wtName && "work-hint")}>{wtName || (r.worktrees.length ? `${r.worktrees.length} existing` : "new")}</span>
                          <Icon name={open === "worktrees" ? "chevronUp" : "chevron"} />
                        </button>
                      </div>
                    )}
                    {open === "worktrees" && <WorktreePicker r={r} value={value} onPick={(v) => onPick(r.link, v)} onClose={() => unfold(r.link, "worktrees")} />}
                  </div>
                )}
            </section>
          );
        })}
        {/* The project's folders that aren't repositories: nothing to branch, but each can still be left out. */}
        {showPlain && plain.map((l) => {
          const off = valueOf(l) === LEFT_OUT;
          return (
            <section key={l} className={cx("work-card", off && "off")} role="group" aria-label={l}>
              <div className="work-card-head">
                <Icon name="folder" /><span className="work-card-name">{l}</span>
                {switchable(l) && <UseSwitch link={l} on={!off} onChange={(on) => use(l, on)} />}
              </div>
              {!(off && optIn) && <div className="work-card-note">{off ? offNote(l) : "Used as it is (not a git repository, so no branch to pick)."}</div>}
            </section>
          );
        })}
      </div>
    </>
  );
}
