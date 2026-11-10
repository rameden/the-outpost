// An approval card: a plan, a shell command, a new job, a connector call, or a question.
// The buttons post the answer; the card closes when the camp confirms it (an "answered" event),
// so it also closes when you answer from the terminal or your phone.

import { memo, useState } from "react";
import { api, errorText } from "../api.ts";
import { cx } from "../format.ts";
import { ASK_LABELS } from "./asks.ts";
import type { AskNode } from "./reducer.ts";

export const AskCard = memo(function AskCard({ ask }: { ask: AskNode }) {
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const kind = ask.askKind;
  const resolved = ask.outcome !== null;

  async function answer(value: string) {
    setSending(true);
    try { await api("/api/answer", { id: ask.askId, answer: value }); }
    catch (e) { setSending(false); alert(errorText(e)); }
  }
  const typed = draft.trim();
  // A typed "y" or "n" would read as approve or stop, so those go through the buttons.
  const sendChanges = () => { if (typed && typed.toLowerCase() !== "n" && typed.toLowerCase() !== "y") void answer(typed); };
  const sendAnswer = () => { if (typed) void answer(typed); };

  return (
    <div className={cx("ask", resolved && "resolved")} id={`ask-${ask.askId}`} data-kind={kind}>
      <div className="ask-title">{ask.title.replace(/^\S+\s+/, "")}</div>
      <div className={kind === "shell" || kind === "tool" ? "ask-body cmd" : "ask-body"}>{ask.body}</div>
      {resolved ? <div className="ask-outcome">{ask.outcome}</div> : (
        <>
          <div className="ask-note">{ASK_LABELS[kind]?.note ?? ""}</div>
          <div className="ask-row">
            {kind === "plan" ? (
              <>
                <button type="button" className="btn primary" disabled={sending} onClick={() => answer("")}>Approve plan</button>
                <button type="button" className="btn danger" disabled={sending} onClick={() => answer("n")}>Stop</button>
                <input placeholder="Or describe changes…" aria-label="Changes to the plan" value={draft} disabled={sending}
                  onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") sendChanges(); }} />
                <button type="button" className="btn" disabled={sending} onClick={sendChanges}>Request changes</button>
              </>
            ) : kind === "question" ? (
              <>
                <input placeholder="Type your answer…" aria-label="Your answer" value={draft} disabled={sending}
                  onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") sendAnswer(); }} />
                <button type="button" className="btn primary" disabled={sending} onClick={sendAnswer}>Answer</button>
                <button type="button" className="btn" disabled={sending} onClick={() => answer("")}>Skip (let them decide)</button>
              </>
            ) : (
              <>
                <button type="button" className="btn primary" disabled={sending} onClick={() => answer("y")}>{ASK_LABELS[kind]?.yes ?? "Allow"}</button>
                {kind === "shell" && (
                  <button type="button" className="btn" disabled={sending} onClick={() => answer("always")}
                    title="Run it, and stop asking about this exact command (saved in camp/settings.json)">Always allow this command</button>
                )}
                <button type="button" className="btn danger" disabled={sending} onClick={() => answer("n")}>Decline</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
});
