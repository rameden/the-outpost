// Change an earlier message and send it again. The conversation is forked just before that
// message (with the fork machinery, Fork.tsx), and the changed message is sent in the copy, so
// the original conversation stays as it was. Optionally the files go back too: what that run and
// every later one changed is put back first, so the new answer starts from the files as they were.

import { createContext, useContext, useState, type KeyboardEvent } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { Confirm } from "../components/Confirm.tsx";
import { plural } from "../format.ts";
import { w } from "../words.ts";
import type { Attached, SendResult } from "../types.ts";
import type { ExpNode } from "./reducer.ts";

// The conversation's runs, oldest first, and the project it's in (for one whose first message is
// changed: there's nothing before it to fork, so it starts afresh in the same project).
export type ResendFrom = { runs: string[]; project?: string; busy: boolean };
export const Resend = createContext<ResendFrom | null>(null);

type ForkResult = { ok: true; thread: string; expedition: string; restored: string[]; skipped: string[] };

// What can be sent again: files, folders and links attached to it (not a pasted note's text, say,
// which the message itself carries).
const again = (a: Attached[]) => a.filter((x) => x.path || x.url).map(({ kind, name, path, url }) => ({ kind, name, path, url }));

// The plan for a resend, worked out from where the run sits in its conversation.
export function resendPlan(runs: string[], expId: string) {
  const at = runs.indexOf(expId);
  return { before: at > 0 ? runs[at - 1] : null, later: at >= 0 ? runs.length - at - 1 : 0 };
}

// The Edit button under your message, and the box that opens in its place.
export function useEditAsk(exp: ExpNode) {
  const from = useContext(Resend);
  const [text, setText] = useState<string | null>(null);
  const [rewind, setRewind] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Only a message you sent, in a conversation, once its run (and every run in the conversation) has finished.
  const can = !!from && exp.source !== "job" && !!exp.end && !from.busy && from.runs.includes(exp.expId);
  const { before, later } = from ? resendPlan(from.runs, exp.expId) : { before: null, later: 0 };

  async function resend() {
    if (text === null || !from) return;
    const said = text.trim();
    if (!said) return setError("Nothing to send.");
    setBusy(true); setError("");
    try {
      const attachments = again(exp.attachments);
      let thread: string;
      if (before) {
        const f = await api<ForkResult>("/api/fork", { id: before, rewind });
        const r = await api<SendResult>("/api/send", { text: said, attachments, replyTo: f.expedition });
        thread = r.thread;
      } else {
        const r = await api<SendResult>("/api/send", { text: said, attachments, ...(from.project ? { project: from.project } : {}) });
        thread = r.thread;
      }
      setText(null); setAsking(false);
      say({ do: "open-conversation", id: thread });
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setText(null); setError(""); }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); if (rewind) setAsking(true); else void resend(); }
  };
  const runs = later + 1; // this run and the ones after it

  const button = can && text === null
    ? <button type="button" className="linkish ask-edit" title="Change this message and send it again, in a copy of the conversation from just before it" onClick={() => { setText(exp.task); setRewind(false); setError(""); }}>Edit</button>
    : null;

  const editor = text === null ? null : (
    <div className="ask-editor">
      <textarea autoFocus aria-label="Your message, changed" value={text} rows={Math.min(10, Math.max(3, text.split("\n").length + 1))} onChange={(ev) => setText(ev.target.value)} onKeyDown={onKey} />
      <p className="ask-editor-note">
        {before
          ? "It's sent in a new conversation: a copy of this one up to the message before, then yours as you've changed it. This conversation stays as it is."
          : "This is the first message, so it starts a new conversation. This one stays as it is."}
      </p>
      {before && (
        <fieldset className="ask-editor-files">
          <legend>Files</legend>
          <label><input type="radio" name={`files-${exp.expId}`} checked={!rewind} onChange={() => setRewind(false)} /> Leave them as they are now</label>
          <label><input type="radio" name={`files-${exp.expId}`} checked={rewind} onChange={() => setRewind(true)} />
            {` Put back what ${runs === 1 ? "this run" : `this run and the ${later} after it`} changed`}</label>
        </fieldset>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="ask-editor-actions">
        <button type="button" className="btn small" disabled={busy} onClick={() => { setText(null); setError(""); }} title="Leave it as it was (Esc)">Cancel</button>
        <button type="button" className="btn small primary" disabled={busy || !text.trim()} title="Send it (⌘Enter)" onClick={() => (rewind ? setAsking(true) : void resend())}>{busy ? "Sending…" : "Send"}</button>
      </div>
      {asking && (
        <Confirm title="Put the files back and send?" action="Put back and send" danger busy={busy} onConfirm={() => void resend()} onCancel={() => setAsking(false)}>
          <p>{`Every file that ${runs === 1 ? "this run" : `this run and the ${later} ${plural(later, "run")} after it`} changed is put back to how it was before this message, then your changed message is sent in a new conversation.`}</p>
          <p>{`This conversation stays in your history as it is. A file someone has changed since a run ended is left alone. The ${w("crew")} starts from the files as they were.`}</p>
        </Confirm>
      )}
    </div>
  );
  return { button, editor };
}
