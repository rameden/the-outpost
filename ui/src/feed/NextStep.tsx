// Where a conversation's branch stands, and the one thing to do next.
//
// Work that changes a repository goes through the same stages every time: the crew works, the
// changes are committed, a pull request is opened, it's reviewed, it's merged. This strip sits
// under the conversation's title, says which stage its branch is at, and offers the next step
// as the one main button (Commit, Pull request, Bring in feedback, Resume, Remove the worktree),
// with the others behind "More". Nothing here happens by itself: every step is your click.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api.ts";
import { Confirm } from "../components/Confirm.tsx";
import { Icon } from "../components/bits.tsx";
import { cx, plural } from "../format.ts";
import { Presence } from "../motion.tsx";
import type { CampState, WorkspaceStatus } from "../types.ts";
import { CommitDialog } from "./CommitDialog.tsx";
import { PrDialog } from "./PrDialog.tsx";
import { bringFeedback } from "./Workspaces.tsx";

type Pr = CampState["prs"][number];
export type Stage = "working" | "failed" | "changes" | "committed" | "unpushed" | "feedback" | "open" | "merged" | "closed" | "clean";
export const STEPS = ["Work", "Commit", "Pull request", "Review", "Merged"] as const;
const AT: Record<Stage, number> = { working: 0, failed: 0, clean: 0, changes: 1, committed: 2, unpushed: 3, open: 3, feedback: 3, closed: 3, merged: 4 };

export function prSays(p: Pr): string {
  if (p.state === "MERGED") return "merged";
  if (p.state === "CLOSED") return "closed";
  const bits = [
    p.conflicts ? "conflicts with its base" : "",
    p.failing ? `${p.failing} failing ${plural(p.failing, "check")}` : "",
    p.review === "changes" ? "changes requested" : p.review === "approved" ? "approved" : "",
    p.comments ? `${p.comments} ${plural(p.comments, "comment")}` : "",
    !p.failing && p.pending ? "checks running" : "",
  ].filter(Boolean);
  return bits.join(" · ") || "open, nothing waiting";
}
const hasFeedback = (p: Pr) => p.conflicts || p.failing > 0 || p.comments > 0 || p.review === "changes";

// running: something is working in the conversation now. ok: its last run finished cleanly.
// st: the worktree as it stands (null until it's been looked at). pr: its pull request, if the camp has seen one.
export function stageOf(o: { running: boolean; ok: boolean; st: { changed: number; commits: number; ahead?: number } | null; pr?: Pr }): Stage {
  if (o.running) return "working";
  if (o.pr?.state === "MERGED") return "merged";
  if (!o.ok) return "failed";
  if (o.st && o.st.changed > 0) return "changes";
  if (o.pr?.state === "OPEN" && o.st && (o.st.ahead ?? 0) > 0) return "unpushed"; // the reviewers can't see it until it's pushed
  if (o.pr?.state === "OPEN") return hasFeedback(o.pr) && o.pr.attention ? "feedback" : "open";
  if (o.pr?.state === "CLOSED") return "closed";
  if (o.st && o.st.commits > 0) return "committed";
  return "clean";
}

// Where a commit message starts: the conversation's title, led by its ticket (once).
export function commitStart(title: string, ticket?: string): string {
  const plain = title.replace(/^work on\s+/i, "").replace(/…$/, "");
  return !ticket || plain.includes(ticket) ? plain : `${ticket}: ${plain}`;
}

export type Place = { link: string; path: string; branch: string; base?: string; created?: boolean };
type Action = "commit" | "push" | "pr" | "feedback" | "resume" | "remove";
const LABEL: Record<Action, string> = { commit: "Commit…", push: "Push", pr: "Pull request…", feedback: "Bring in feedback", resume: "Resume", remove: "Remove the worktree" };

// ws: the worktree the conversation works in (none: it works in your own checkout, where only a failed run has a next step).
// title: the conversation's (the start of a commit message). ticket: its Jira key. lastRun: its latest run.
export function NextStep({ ws, pr, running, status, title, ticket, lastRun }: {
  ws?: Place; pr?: Pr; running: boolean; status: string; title: string; ticket?: string; lastRun?: string;
}) {
  const [st, setSt] = useState<{ branch: string; changed: number; commits: number; exists: boolean; ahead?: number } | null>(null);
  const [looks, setLooks] = useState(0);
  const [open, setOpen] = useState<"commit" | "pr" | "remove" | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const menu = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(null), []);

  // Look at the worktree when the conversation changes (a run ends), its pull request does, or you've just done something.
  const stamp = `${ws?.path ?? ""}|${running}|${status}|${pr?.checked ?? ""}|${looks}`;
  useEffect(() => {
    if (!ws) return setSt(null);
    let gone = false;
    const q = new URLSearchParams({ link: ws.link, path: ws.path, ...(ws.base ? { base: ws.base } : {}) });
    api<WorkspaceStatus>(`/api/repo/status?${q}`).then((s) => { if (!gone) setSt(s); }, () => { if (!gone) setSt(null); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  // What your last click came to is said in place of the stage, until things move on by themselves.
  useEffect(() => { setNote(""); }, [pr?.checked, pr?.state, status, running]);
  useEffect(() => {
    if (!more) return;
    const away = (ev: MouseEvent) => { if (!menu.current?.contains(ev.target as Node)) setMore(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [more]);

  const ok = status === "done";
  if (!ws && (running || ok)) return null; // nothing to step through
  if (ws && st && !st.exists) return null;   // the worktree is gone
  const stage = stageOf({ running, ok, st, pr });
  const branch = st?.branch || ws?.branch || "";

  const says: Record<Stage, string> = {
    working: "The crew is working.",
    failed: `The last run ended as ${status === "running" ? "interrupted" : status.replace(/_/g, " ")}.`,
    changes: `${st?.changed} uncommitted ${plural(st?.changed ?? 0, "file")}.`,
    committed: `${st?.commits} ${plural(st?.commits ?? 0, "commit")}, and no pull request yet.`,
    unpushed: pr ? `${st?.ahead} ${plural(st?.ahead ?? 0, "commit")} not pushed to pull request #${pr.number} yet.` : "",
    feedback: pr ? `Pull request #${pr.number}: ${prSays(pr)}.` : "",
    open: pr ? `Pull request #${pr.number}: ${prSays(pr)}.` : "",
    merged: pr ? `Pull request #${pr.number} was merged.` : "",
    closed: pr ? `Pull request #${pr.number} was closed without merging.` : "",
    clean: "Nothing has changed here yet.",
  };
  const next: Action | null = stage === "failed" ? (lastRun ? "resume" : null) : stage === "changes" ? "commit" : stage === "committed" ? "pr" : stage === "unpushed" ? "push" : stage === "feedback" ? "feedback"
    : stage === "merged" && ws?.created ? "remove" : null;
  // Everything else that can be done from where it stands.
  const others = (ws ? [
    st && st.changed > 0 ? "commit" : null,
    st && (st.ahead ?? 0) > 0 ? "push" : null,
    st && st.commits > 0 && !st.changed && pr?.state !== "MERGED" ? "pr" : null,
    pr?.state === "OPEN" && hasFeedback(pr) ? "feedback" : null,
    ws.created && !running ? "remove" : null,
  ] : []).filter((a): a is Action => !!a && a !== next);

  async function act(a: Action) {
    setMore(false); setNote("");
    if (a === "commit" || a === "pr" || a === "remove") return setOpen(a);
    setBusy(true);
    try {
      if (a === "feedback" && ws) setNote(await bringFeedback(ws, running ? undefined : lastRun, title));
      if (a === "resume") await api("/api/send", { resume: lastRun });
      if (a === "push" && ws) { const r = await api<{ pushed: string }>("/api/repo/push", { link: ws.link, path: ws.path }); setNote(`Pushed ${r.pushed}.`); setLooks((n) => n + 1); }
    } catch (e) { setNote(errorText(e)); }
    setBusy(false);
  }
  async function remove() {
    if (!ws) return;
    setBusy(true);
    try { await api("/api/repo/remove", { link: ws.link, path: ws.path }); setOpen(null); setLooks((n) => n + 1); }
    catch (e) { setOpen(null); setNote(errorText(e)); }
    setBusy(false);
  }
  const hint: Record<Action, string> = {
    commit: "Commit everything in this worktree to its branch",
    push: "Push the new commits to where this branch already goes, so its pull request has them",
    pr: pr?.state === "OPEN" ? "Change this pull request's title and description" : "Push the branch and open a pull request, with the description drafted from the record",
    feedback: "Read the review comments and failing checks into the message box, for you to send on",
    resume: "Start again from what the last run had done, without redoing finished work",
    remove: "Remove this worktree's folder (its branch is kept). Git refuses if there are uncommitted changes.",
  };

  return (
    <div className={cx("next-step", stage)} role="group" aria-label="Where this work stands">
      {ws && (
        <ol className="next-steps" aria-label="Stages">
          {STEPS.map((s, i) => <li key={s} className={cx(i < AT[stage] && "done", i === AT[stage] && "now")} aria-current={i === AT[stage] ? "step" : undefined}>{s}</li>)}
        </ol>
      )}
      <span className="next-says">
        <span role="status">{note || says[stage]}</span>
        {branch && <code title={ws?.path}><Icon name="branch" /> {branch}</code>}
        {pr && <a href={pr.url} target="_blank" rel="noopener noreferrer" title="Open the pull request">Open it <Icon name="link" /></a>}
      </span>
      <span className="next-actions">
        {next && <button type="button" className="btn small primary" disabled={busy} title={hint[next]} onClick={() => act(next)}>{busy ? "Working…" : LABEL[next]}</button>}
        {others.length > 0 && (
          <span className="next-more" ref={menu}>
            <button type="button" className="btn small" aria-haspopup="menu" aria-expanded={more} onClick={() => setMore((m) => !m)}>More</button>
            {more && (
              <span className="popover next-menu" role="menu" aria-label="Other steps">
                {others.map((a) => <button key={a} type="button" role="menuitem" className="mention-item" title={hint[a]} onClick={() => act(a)}><span>{a === "pr" && pr?.state === "OPEN" ? "Update the pull request…" : LABEL[a]}</span></button>)}
              </span>
            )}
          </span>
        )}
      </span>
      {open === "commit" && ws && st && (
        <CommitDialog w={ws} branch={branch} changed={st.changed} start={commitStart(title, ticket)} onClose={close}
          onDone={(commit) => { setOpen(null); setNote(`Committed: ${commit}`); setLooks((n) => n + 1); }} />
      )}
      {open === "pr" && ws && (
        <PrDialog w={ws} expId={lastRun} onClose={close}
          onDone={(r) => { setOpen(null); setNote(`${r.updated ? "Pull request updated" : "Pull request opened"}: ${r.url}${r.jira ? ` · ${r.jira}` : ""}`); setLooks((n) => n + 1); }} />
      )}
      <Presence>{open === "remove" && ws && (
        <Confirm title="Remove this worktree?" action="Remove the worktree" danger busy={busy} onConfirm={remove} onCancel={close}>
          <p>The folder <code>{ws.path}</code> is removed. Its branch, <code>{branch}</code>, stays in the repository.</p>
          <p className="meta">Git refuses if the worktree has uncommitted changes, and nothing is lost.</p>
        </Confirm>
      )}</Presence>
    </div>
  );
}
