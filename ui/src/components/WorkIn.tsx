// Under the composer: for each linked git repository, where the next request works. Its
// linked checkout (the default), a new worktree and branch (editable links only), or a
// worktree that already exists. A follow-up keeps working where its conversation was.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import type { RepoInfo } from "../types.ts";

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

export function WorkIn({ repos, choice, setChoice, followUp }: {
  repos: RepoInfo[]; choice: WorkChoice; setChoice: (fn: (c: WorkChoice) => WorkChoice) => void; followUp: boolean;
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
      {repos.map((r) => (
        <label key={r.link}>
          🌿 {r.link}:{" "}
          <select aria-label={`Where to work in ${r.link}`} value={choice[r.link] ?? ""} disabled={followUp}
            onChange={(ev) => {
              const v = ev.target.value;
              setChoice((c) => { const next = { ...c }; if (v) next[r.link] = v; else delete next[r.link]; return next; });
            }}>
            <option value="">linked checkout ({r.branch})</option>
            {r.access === "write" && <option value="new">a new worktree and branch</option>}
            {r.worktrees.map((w) => <option key={w.path} value={w.path}>{`${w.branch}  ·  …/${w.path.split("/").slice(-2).join("/")}`}</option>)}
          </select>
        </label>
      ))}
      {followUp && <span>A follow-up keeps working where its conversation was.</span>}
    </div>
  );
}
