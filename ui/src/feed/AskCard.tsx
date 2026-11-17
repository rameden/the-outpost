// An approval card: a plan, a shell command, a new job, a connector call, a question, or a
// review to post, or a pull request description to put up, on GitHub as you.
// The buttons post the answer; the card closes when the camp confirms it (an "answered" event),
// so it also closes when you answer from the terminal or your phone.

import { memo, useState } from "react";
import { api, errorText } from "../api.ts";
import { cx, when } from "../format.ts";
import { ASK_LABELS, REPLACE_LATER, REPLACE_START, START_LATER, heldAnswer } from "./asks.ts";
import type { AskNode } from "./reducer.ts";
import { turnIntoTickets } from "../tickets.ts";

export const AskCard = memo(function AskCard({ ask }: { ask: AskNode }) {
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);
  // Approving a plan when its conversation already has one waiting to start: which approve you
  // pressed, while the card asks whether this plan replaces the waiting one or joins it.
  const [choosing, setChoosing] = useState<"start" | "later" | null>(null);
  const kind = ask.askKind;
  const resolved = ask.outcome !== null;

  async function answer(value: string) {
    setSending(true);
    try { await api("/api/answer", { id: ask.askId, answer: value }); }
    catch (e) { setSending(false); alert(errorText(e)); }
  }
  const typed = draft.trim();
  // A typed "y", "n" or "later" would read as approve, stop or hold, so those go through the buttons.
  const sendChanges = () => { const t = typed.toLowerCase(); if (typed && t !== "n" && t !== "y" && t !== REPLACE_START && !heldAnswer(typed)) void answer(typed); };
  const earlier = ask.waiting ?? [];
  const approve = (how: "start" | "later") => { if (earlier.length) setChoosing(how); else void answer(how === "later" ? START_LATER : ""); };
  // A plan held for later, started now: it carries on this conversation, already approved.
  async function start() {
    setStarting(true);
    try { await api("/api/send", { start: ask.askId }); }
    catch (e) { setStarting(false); alert(errorText(e)); }
  }
  const waiting = !!ask.held && !ask.started && !ask.aside; // approved, and waiting for you to start it
  const sendAnswer = () => { if (typed) void answer(typed); };

  // A command that's been answered is a record, and a run can have dozens: each folds to one
  // line (what you said, and the start of the command) that opens to the whole card.
  if (resolved && !ask.listed && (kind === "shell" || kind === "tool")) {
    return (
      <details className="ask resolved folded" id={`ask-${ask.askId}`} data-kind={kind}>
        <summary><span className="ask-outcome">{ask.outcome}</span><code>{ask.body.split("\n").find((l) => l.trim()) ?? ""}</code></summary>
        <div className="ask-title">{ask.title.replace(/^\S+\s+/, "")}</div>
        {ask.plain && (
          <div className="ask-plain" role="note" aria-label="In plain words">
            <div className="ask-plain-head">In plain words</div>
            <dl>{ask.plain.split("\n").map((line, i) => { const at = line.indexOf(":"); return <div key={i}><dt>{line.slice(0, at)}</dt><dd>{line.slice(at + 1).trim()}</dd></div>; })}</dl>
          </div>
        )}
        <div className="ask-body cmd">{ask.body}</div>
      </details>
    );
  }

  return (
    <div className={cx("ask", resolved && "resolved", waiting && "held")} id={`ask-${ask.askId}`} data-kind={kind}>
      <div className="ask-title">{ask.title.replace(/^\S+\s+/, "")}</div>
      {/* An approved plan is shown as the live list under this card: its own wording folds away. */}
      {ask.plain && (
        <div className="ask-plain" role="note" aria-label="In plain words">
          <div className="ask-plain-head">In plain words</div>
          <dl>{ask.plain.split("\n").map((line, i) => { const at = line.indexOf(":"); return <div key={i}><dt>{line.slice(0, at)}</dt><dd>{line.slice(at + 1).trim()}</dd></div>; })}</dl>
          <div className="ask-plain-foot">A summary by the small model, and it can be wrong. What runs is exactly the {kind === "tool" ? "call" : "command"} below.</div>
        </div>
      )}
      {ask.listed
        ? <details className="ask-written"><summary>The plan as it was written</summary><div className="ask-body">{ask.body}</div></details>
        : <div className={kind === "shell" || kind === "tool" ? "ask-body cmd" : "ask-body"}>{ask.body}</div>}
      {/* A plan's steps can be tracked as Mae tickets, approved or not (the app files them under this conversation). */}
      {kind === "plan" && ask.body.trim() && (
        <div className="ask-tickets">
          <button type="button" className="linkish" title="Split this plan into Mae tickets, one per piece of work: you choose which to file"
            onClick={() => turnIntoTickets({ text: ask.body, kind: "plan" })}>Turn into tickets</button>
        </div>
      )}
      {resolved ? (
        <>
          <div className="ask-outcome">{ask.started ? "▶ Plan approved, and started" : ask.aside === "replaced" ? "↺ Set aside: a newer plan took its place" : ask.aside === "removed" ? "✕ Removed from Ready to start" : ask.outcome}</div>
          {waiting && (
            <div className="ask-start">
              <button type="button" className="btn primary" disabled={starting} onClick={start}>{starting ? "Starting…" : "Start plan"}</button>
              <span className="ask-note">It carries on this conversation. Nobody has left camp yet.</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ask-note">{ASK_LABELS[kind]?.note ?? ""}</div>
          <div className="ask-row">
            {kind === "plan" && choosing ? (
              <>
                <span className="ask-question">
                  {earlier.length === 1
                    ? `This conversation already has a plan waiting to start (approved ${when(earlier[0].held)}). Does this one update it, or is it a new plan?`
                    : `This conversation already has ${earlier.length} plans waiting to start. Does this one replace them, or is it a new plan?`}
                </span>
                <button type="button" className="btn primary" disabled={sending} onClick={() => answer(choosing === "later" ? REPLACE_LATER : REPLACE_START)}
                  title="The waiting plan comes off Ready to start, and this one takes its place">{earlier.length === 1 ? "Update the waiting plan" : "Replace them"}</button>
                <button type="button" className="btn" disabled={sending} onClick={() => answer(choosing === "later" ? START_LATER : "")}
                  title="Keep the waiting plan as it is, and add this one">Keep both</button>
                <button type="button" className="btn" disabled={sending} onClick={() => setChoosing(null)}>Back</button>
              </>
            ) : kind === "plan" ? (
              <>
                {/* No Stop here: the message box's Stop ends the run, plan and all. */}
                <button type="button" className="btn primary" disabled={sending} onClick={() => approve("start")}>Approve and start</button>
                <button type="button" className="btn" disabled={sending} onClick={() => approve("later")}
                  title="Approve it now, and start it yourself from this card whenever you're ready">Approve, start later</button>
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
            ) : kind === "post" || kind === "describe" ? (
              <>
                <button type="button" className="btn primary" disabled={sending} onClick={() => answer("y")}>{kind === "post" ? "Post as me" : "Update as me"}</button>
                <button type="button" className="btn danger" disabled={sending} onClick={() => answer("n")}>{kind === "post" ? "Don't post" : "Don't update"}</button>
                <input placeholder="Or say what to change…" aria-label={kind === "post" ? "Changes to the review" : "Changes to the description"} value={draft} disabled={sending}
                  onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") sendChanges(); }} />
                <button type="button" className="btn" disabled={sending} onClick={sendChanges}>Request changes</button>
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
