// Committing a worktree's changes: the message, yours to write (it starts from the ticket or the
// conversation's title). Everything in the worktree is committed to its branch; nothing is pushed.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorText } from "../api.ts";

export function CommitDialog({ w, branch, changed, start, onClose, onDone }: {
  w: { link: string; path: string }; branch: string; changed: number; start: string; onClose: () => void; onDone: (commit: string) => void;
}) {
  const [message, setMessage] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  async function go() {
    setBusy(true); setError("");
    try { onDone((await api<{ commit: string }>("/api/repo/commit", { link: w.link, path: w.path, message })).commit); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <form className="dialog pr-dialog commit-dialog" role="dialog" aria-modal="true" aria-label={`Commit to ${branch}`} onSubmit={(ev) => { ev.preventDefault(); void go(); }}>
        <h2>Commit to {branch}</h2>
        <div className="meta">Commits {changed === 1 ? "the 1 changed file" : `all ${changed} changed files`} in this worktree to its branch. Your own git hooks run as usual, and nothing is pushed.</div>
        <label className="field">Message
          <textarea value={message} rows={3} autoFocus onChange={(ev) => setMessage(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); if (message.trim() && !busy) void go(); } }} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !message.trim()}>{busy ? "Committing…" : "Commit"}</button>
        </div>
      </form>
    </>, document.body);
}
