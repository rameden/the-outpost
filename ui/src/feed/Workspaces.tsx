// The worktrees a finished expedition worked in: its branch, what's uncommitted, and your own
// git actions (Commit, Open PR, Remove worktree). Nothing here runs unless you click it.

import { useState } from "react";
import { api, errorText } from "../api.ts";
import { plural } from "../format.ts";
import type { Workspaces, WorkspaceStatus } from "../types.ts";

type Workspace = Workspaces[number];
type Shown = { branch: string; changed: number; commits: number };

// A short default for commit messages and PR titles: the request, without an @crew prefix.
const titleFrom = (task: string) => task.replace(/^@\w+\s+/, "").slice(0, 72);

function WorkspaceRow({ w, task }: { w: Workspace; task: string }) {
  const [st, setSt] = useState<Shown>(w);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);

  const again = async (said: string) => {
    const q = new URLSearchParams({ link: w.link, path: w.path, ...(w.base ? { base: w.base } : {}) });
    setSt(await api<WorkspaceStatus>(`/api/repo/status?${q}`));
    setNote(said);
  };
  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(errorText(e)); }
    setBusy(false);
  };

  const commit = act(async () => {
    const message = prompt(`Commit message for ${st.branch}:`, titleFrom(task));
    if (!message) return;
    const r = await api<{ commit: string }>("/api/repo/commit", { link: w.link, path: w.path, message });
    await again(`Committed: ${r.commit}`);
  });
  const openPr = act(async () => {
    const title = prompt(`This pushes ${st.branch} to origin and opens a pull request.\n\nPull request title:`, titleFrom(task));
    if (!title) return;
    const r = await api<{ url: string }>("/api/repo/pr", { link: w.link, path: w.path, title, body: "" });
    await again(`Pull request: ${r.url}`);
  });
  const remove = act(async () => {
    if (!confirm(`Remove the worktree at ${w.path}? Its branch ${st.branch} is kept.`)) return;
    await api("/api/repo/remove", { link: w.link, path: w.path });
    setRemoved(true);
  });

  if (removed) return <div className="ws"><span>🌿 Worktree removed. The branch <code>{st.branch}</code> is still in the repository.</span></div>;
  return (
    <div className="ws">
      <span>🌿 <code>{st.branch}</code> in links/{w.link}{w.created ? " (new worktree)" : ""}</span>
      <span>
        {st.changed ? `${st.changed} uncommitted ${plural(st.changed, "file")}` : "nothing uncommitted"}
        {st.commits ? ` · ${st.commits} new ${plural(st.commits, "commit")}` : ""}
      </span>
      <span className="ws-actions">
        {st.changed > 0 && <button type="button" className="btn small" disabled={busy} title="Commit everything in this worktree to its branch" onClick={commit}>Commit…</button>}
        {st.commits > 0 && !st.changed && <button type="button" className="btn small" disabled={busy} title="Push this branch to origin and open a pull request with the GitHub CLI" onClick={openPr}>Open PR…</button>}
        {w.created && <button type="button" className="btn small" disabled={busy} title="Remove this worktree folder (the branch is kept). Git refuses if there are uncommitted changes." onClick={remove}>Remove worktree</button>}
      </span>
      <span className="ws-note meta">{note ?? w.path}</span>
    </div>
  );
}

export function WorkspaceBox({ workspaces, task }: { workspaces: Workspaces; task: string }) {
  return <div className="exp-work">{workspaces.map((w) => <WorkspaceRow key={w.path} w={w} task={task} />)}</div>;
}
