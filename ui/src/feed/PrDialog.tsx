// A pull request before it's opened: its title and description, drafted by the camp from the
// record (the ticket and its acceptance criteria, what changed, how your checks came out, what
// the crew reported) for you to read and change. Nothing is pushed until you press the button.
// If the branch has a pull request already, the button updates that one instead.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, errorText } from "../api.ts";
import type { PrDraft } from "../types.ts";

export type PrDone = { url: string; updated?: boolean; jira?: string };

export function PrDialog({ w, expId, onClose, onDone }: {
  w: { link: string; path: string; base?: string }; expId?: string; onClose: () => void; onDone: (r: PrDone) => void;
}) {
  const [draft, setDraft] = useState<PrDraft | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The draft is asked for once per branch. (Escape has its own effect: what closes the dialog is
  // a new function each time the feed behind it is drawn, and tied together that asked for the
  // draft again each time, and put it back over whatever you'd changed.)
  useEffect(() => {
    let gone = false;
    api<PrDraft>("/api/repo/pr/draft", { link: w.link, path: w.path, base: w.base, expedition: expId })
      .then((d) => { if (!gone) { setDraft(d); setTitle(d.title); setBody(d.body); } }, (e) => { if (!gone) setError(errorText(e)); });
    return () => { gone = true; };
  }, [w.link, w.path, w.base, expId]);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const existing = draft?.existing ?? null;
  // A click outside closes it, but not once you've changed something: that would throw your
  // wording away on a stray click. Cancel and Escape still close it.
  const edited = !!draft && (title !== draft.title || body !== draft.body);
  async function go() {
    setBusy(true); setError("");
    try { onDone(await api<PrDone>("/api/repo/pr", { link: w.link, path: w.path, title, body, expedition: expId, ...(existing ? { update: true } : {}) })); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={() => { if (!edited) onClose(); }} />
      <form className="dialog pr-dialog" role="dialog" aria-modal="true" aria-label={existing ? `Update pull request #${existing.number}` : "Open a pull request"}
        onSubmit={(ev) => { ev.preventDefault(); void go(); }}>
        <h2>{existing ? `Update pull request #${existing.number}` : "Open a pull request"}</h2>
        {!draft && !error && <div className="meta">Reading what changed…</div>}
        {draft && (
          <>
            <div className="meta">{existing
              ? <>The branch <code>{draft.branch}</code> already has a pull request. This changes its title and description; nothing is pushed.</>
              : <>This pushes <code>{draft.branch}</code> to origin and opens a pull request with the GitHub CLI.</>} The description was drafted from the record: change anything that's off.</div>
            <label className="field">Title<input value={title} maxLength={200} autoFocus onChange={(ev) => setTitle(ev.target.value)} /></label>
            <label className="field">Description<textarea className="pr-body" value={body} rows={16} spellCheck={false} onChange={(ev) => setBody(ev.target.value)} /></label>
          </>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!draft || busy || !title.trim()}>{busy ? "Working…" : existing ? "Update the pull request" : "Push and open it"}</button>
        </div>
      </form>
    </>, document.body);
}
