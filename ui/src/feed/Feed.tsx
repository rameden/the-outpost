// The live feed, as a back and forth: each run is what you asked (a message on the right) and the
// crew's answer under it (on the left: its quests, the crew's messages and tool calls, and any
// approvals waiting inside it). Several can be running at once.

import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api.ts";
import { say } from "../bus.ts";
import { AttachmentChip } from "../components/AttachmentChip.tsx";
import { ItemBoundary } from "../components/ErrorBoundary.tsx";
import { autoName, cClass, clock, crewNow, cx, leadName, plural, shortModel, spaced } from "../format.ts";
import { Icon } from "../components/bits.tsx";
import { ReadAloud } from "../components/ReadAloud.tsx";
import { MaeSystem } from "../components/MaeSystem.tsx";
import { Markdown } from "../markdown.tsx";
import { AskCard } from "./AskCard.tsx";
import { Changes } from "./Changes.tsx";
import { FileCard } from "./FileCard.tsx";
import { WorkspaceBox } from "./Workspaces.tsx";
import { AsideButton } from "./Aside.tsx";
import { ForkButton } from "./Fork.tsx";
import { cardsFor, type View } from "./conversation.ts";
import { condense, summarize, type FeedDetail, type StepsNode } from "./condense.ts";
import { stepState, type ExpNode, type FeedNode, type PlanNode, type QuestNode, type StepState } from "./reducer.ts";
import { useFeed, type FeedStore } from "./store.ts";

const EXAMPLES = [
  "Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc.",
  "Every weekday at 08:00, summarize anything new in the camp wiki's notes.",
  "@scout What's new in agent memory research this month?",
];

// Outside a project a blank page is a plain chat with a model; the crew comes in with an @.
const PLAIN_EXAMPLES = [
  "Explain the difference between a rebase and a merge, and when I'd want each.",
  "@scout What's new in agent memory research this month?",
  "@quartermaster Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc.",
];

export type OnReply = (expId: string, task: string) => void;

// The run whose Stop is in the message box (the conversation's working run): its card doesn't show one too.
const StopInBox = createContext<string | undefined>(undefined);

// Each item is drawn on its own: one that can't be (a reply the page fails to lay out) leaves a
// line saying so, and everything around it stays.
// Condensed (the default) folds the behind-the-scenes lines into one per stretch (condense.ts);
// detailed shows every one. live: the run or quest these are in is still going, so the newest
// stretch says what it's doing right now.
export const Detail = createContext<FeedDetail>("condensed");
const Nodes = ({ nodes, onReply, live }: { nodes: FeedNode[]; onReply: OnReply; live?: boolean }) => {
  const detail = useContext(Detail);
  if (detail === "detailed") return <>{nodes.map((n) => <ItemBoundary key={n.id}><NodeView node={n} onReply={onReply} /></ItemBoundary>)}</>;
  const shown = condense(nodes);
  return <>{shown.map((n, i) => (
    <ItemBoundary key={n.id}>
      {n.kind === "steps" ? <Steps steps={n} onReply={onReply} now={live && i === shown.length - 1} /> : <NodeView node={n} onReply={onReply} />}
    </ItemBoundary>
  ))}</>;
};

// A stretch of behind-the-scenes work as one line, which opens to every call in it.
const Steps = memo(function Steps({ steps, onReply, now }: { steps: StepsNode; onReply: OnReply; now?: boolean }) {
  const [open, setOpen] = useState(false);
  const sum = summarize(steps.nodes);
  const n = steps.nodes.length;
  return (
    <div className={cx("steps", open && "open", now && "now")}>
      <button type="button" className="steps-head" aria-expanded={open} title={open ? "Hide these steps" : "Show every step"} onClick={() => setOpen((o) => !o)}>
        <span className="steps-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="steps-text">{sum.text}</span>
        {sum.allowed > 0 && <span className="steps-tag">{sum.allowed} approved</span>}
        {sum.declined > 0 && <span className="steps-tag bad">{sum.declined} declined</span>}
        <span className="steps-count">{n} {plural(n, "step")}{sum.who.length > 1 ? ` · ${sum.who.join(", ")}` : ""}</span>
        {now && !open && sum.last && <code className="steps-last" title={sum.last}>{sum.last}</code>}
      </button>
      {open && <div className="steps-body">{steps.nodes.map((x) => <ItemBoundary key={x.id}><NodeView node={x} onReply={onReply} /></ItemBoundary>)}</div>}
    </div>
  );
});

const NodeView = memo(function NodeView({ node, onReply }: { node: FeedNode; onReply: OnReply }) {
  switch (node.kind) {
    case "exp": return <ExpeditionCard exp={node} onReply={onReply} />;
    case "quest": return <QuestCard quest={node} onReply={onReply} />;
    case "ask": return <AskCard ask={node} />;
    case "plan": return <PlanList plan={node} />;
    case "msg":
      return (
        <div className={cx("msg", cClass(node.who))}>
          <div className="avatar" aria-hidden="true">{node.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <div className="msg-who">{node.who}</div>
            {/* Text arriving as it's written is shown plain, then formatted once it's whole. */}
            {node.streaming ? <div className="md streaming">{node.text}</div> : <Markdown text={node.text} />}
          </div>
        </div>
      );
    case "tool": return <div className={cx("tool", cClass(node.who))}><b>{node.tool}</b><code title={node.input}>{node.input}</code></div>;
    case "file": return <FileCard file={node} />;
    case "notice": return <div className="notice">{node.text}</div>;
    case "route": return (
      <div className="notice route" title={`${autoName(node.choice)}: ${node.reason}`}>
        🧭 {node.who} {node.switched ? "switched to" : "is on"} <b>{shortModel(node.model)}{node.effort ? ` · ${node.effort}` : ""}</b> ({autoName(node.choice)}). {node.reason}
      </div>
    );
    case "sys": return <div className="sys">{node.text}</div>;
    case "steer": return <div className="steer-msg"><small>You, while it was working</small>{node.text}</div>;
  }
});

// The plan you approved, as a list that fills in while the run goes: each step says whether it's
// not started, out (and with whom), done, or didn't make it. A step with a quest goes to that
// quest's block when clicked. Steps nobody was sent on are the Quartermaster's own.
export const STEP_SAYS: Record<StepState, string> = { todo: "Not started", out: "Out", done: "Done", failed: "Didn't finish", stopped: "Cut short" };
export const STEP_MARK: Record<StepState, string> = { todo: "○", out: "●", done: "✓", failed: "!", stopped: "–" };
function PlanList({ plan }: { plan: PlanNode }) {
  const states = plan.steps.map((s) => stepState(s, plan.ended));
  const count = (st: StepState) => states.filter((x) => x === st).length;
  const goTo = (id: string) => document.getElementById(`quest-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  return (
    <div className="plan-list" role="group" aria-label="The plan, step by step">
      <div className="plan-head"><b>Plan</b><span>{count("done")} of {plan.steps.length} done{count("out") ? ` · ${count("out")} out` : ""}{count("failed") ? ` · ${count("failed")} didn't finish` : ""}</span></div>
      <ol>
        {plan.steps.map((s, i) => {
          const state = states[i];
          const who = [...new Map(s.quests.map((q) => [q.who, q])).values()];
          const target = s.quests.find((q) => q.status === null) ?? s.quests.at(-1);
          const row = (
            <>
              <span className="plan-mark" aria-hidden="true">{STEP_MARK[state]}</span>
              <span className="plan-n">{s.n}</span>
              <span className="plan-text">{s.text}</span>
              {who.length > 0 && <span className="plan-who">{who.map((q) => `${q.emoji} ${q.who}${s.quests.filter((x) => x.who === q.who).length > 1 ? ` ×${s.quests.filter((x) => x.who === q.who).length}` : ""}`).join(", ")}</span>}
              <span className={cx("pill", state === "out" ? "live" : state === "done" ? "done" : state === "todo" ? "" : "bad")}>{STEP_SAYS[state]}</span>
            </>
          );
          return (
            <li key={s.n} className={cx("plan-step", state)}>
              {target
                ? <button type="button" title="Go to this step's quest" onClick={() => goTo(target.node)}>{row}</button>
                : <div title={state === "todo" ? "Nobody has been sent on this yet: it may be the Quartermaster's own to do" : undefined}>{row}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function QuestCard({ quest, onReply }: { quest: QuestNode; onReply: OnReply }) {
  const ok = quest.status === "done";
  return (
    <section className={cx("quest", cClass(quest.who))} id={`quest-${quest.id}`}>
      <div className="quest-head">
        <span>{quest.emoji} {quest.who} sets out</span>
        {quest.step && <span className="quest-step" title={`Step ${quest.step} of the plan`}>Step {quest.step}</span>}
        {quest.brief && <span className="quest-brief" title={quest.brief}>{quest.brief}</span>}
        {quest.status === null ? <span className="pill live">On quest</span> : <span className={cx("pill", ok ? "done" : "bad")}>{ok ? "Returned" : spaced(quest.status)}</span>}
      </div>
      <div className="quest-body"><Nodes nodes={quest.nodes} onReply={onReply} live={quest.status === null} /></div>
    </section>
  );
}

// Your side of the exchange: what you asked, set as a message. It's formatted the way the message
// box showed it as you typed (code, bold, lists), and a very long one (a ticket's brief, say) is
// folded until you ask for the rest. Under it: when, and what kind of request it was if that isn't plain.
const LONG_ASK = { chars: 900, lines: 14 };
function Ask({ exp }: { exp: ExpNode }) {
  const [whole, setWhole] = useState(false);
  const long = exp.task.length > LONG_ASK.chars || exp.task.split("\n").length > LONG_ASK.lines;
  return (
    <div className="exp-ask">
      {exp.attachments.length > 0 && <div className="exp-atts">{exp.attachments.map((a, i) => <AttachmentChip key={i} a={a} big />)}</div>}
      {/* Still the run's heading, so it can be found and jumped to like one. */}
      <div className={cx("ask-bubble", long && !whole && "folded")} role="heading" aria-level={3}><Markdown text={exp.task} /></div>
      {long && <button type="button" className="linkish" aria-expanded={whole} onClick={() => setWhole((v) => !v)}>{whole ? "Show less" : "Show all of it"}</button>}
      <div className="ask-meta">
        {exp.source === "job" && <span title="Sent by a scheduled job, not typed just now">Scheduled job · {exp.job}</span>}
        {exp.followUp && <span title="Carries the earlier conversation"><Icon name="reply" /> Follow-up</span>}
        <time>{clock(exp.time)}</time>
      </div>
    </div>
  );
}

// While an expedition runs, its Stop is the message box's button. A run whose Stop isn't there (one
// in All activity, or an earlier run still going beside the newest) gets a small one under its corner.
// A scheduled job has nobody to talk to, and says so.
function RunFoot({ stop, job }: { stop: ReactNode; job: boolean }) {
  return <div className="run-stop">{job && <span className="steer-note">A scheduled job is running.</span>}{stop}</div>;
}

// Your say on a finished run: a thumb, and optionally a note. The thumb is saved the moment you
// click it; a note is saved when you press Save, and (unless you untick it) kept as a standing
// note so later runs start with it.
type Given = NonNullable<ExpNode["feedback"]>;
function FeedbackBar({ expId, given }: { expId: string; given?: Given }) {
  const [mine, setMine] = useState<Given | undefined>(given);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(given?.note ?? "");
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  // A rating that arrives from elsewhere (another tab, the saved feed) shows here too.
  useEffect(() => { if (given) { setMine(given); setNote(given.note ?? ""); } }, [given]);

  async function send(rating: "up" | "down", withNote: boolean) {
    setBusy(true);
    try {
      const r = await api<{ rating: "up" | "down"; note: string; kept: string | null }>("/api/feedback", { id: expId, rating, ...(withNote ? { note, keep } : { note: mine?.note ?? "" }) });
      setMine({ rating: r.rating, note: r.note || undefined, kept: r.kept ?? undefined });
      if (withNote) setOpen(false);
    } catch (e) { alert(errorText(e)); }
    setBusy(false);
  }
  const rate = (rating: "up" | "down") => { setOpen(true); void send(rating, false); };

  return (
    <div className="exp-feedback">
      <div className="fb-row">
        <span className="fb-ask">{mine ? "Your feedback" : "How was this?"}</span>
        <button type="button" className={cx("fb-thumb", mine?.rating === "up" && "on")} aria-pressed={mine?.rating === "up"} aria-label="Good answer" title="Good: more like this" disabled={busy} onClick={() => rate("up")}><Icon name="up" /></button>
        <button type="button" className={cx("fb-thumb", mine?.rating === "down" && "on")} aria-pressed={mine?.rating === "down"} aria-label="Not what I wanted" title="Not what I wanted" disabled={busy} onClick={() => rate("down")}><Icon name="down" /></button>
        {mine && !open && (
          <>
            {mine.note && <span className="fb-note" title={mine.note}>“{mine.note}”</span>}
            {mine.kept && <span className="fb-kept">Kept in {mine.kept}</span>}
            <button type="button" className="linkish" onClick={() => setOpen(true)}>{mine.note ? "Edit note" : "Add a note"}</button>
          </>
        )}
      </div>
      {open && mine && (
        <form className="fb-form" onSubmit={(ev) => { ev.preventDefault(); void send(mine.rating, true); }}>
          <textarea value={note} rows={2} autoFocus aria-label="Feedback note"
            placeholder={mine.rating === "up" ? "What worked? (optional)" : "What should it do differently next time? (optional)"}
            onChange={(ev) => setNote(ev.target.value)} />
          <div className="fb-form-row">
            <label className="fb-keep"><input type="checkbox" checked={keep} onChange={(ev) => setKeep(ev.target.checked)} /> Keep this as a standing note for future work</label>
            <button type="button" className="linkish" onClick={() => setOpen(false)}>Close</button>
            <button type="submit" className="btn small primary" disabled={busy || !note.trim()}>Save note</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ExpeditionCard({ exp, onReply }: { exp: ExpNode; onReply: OnReply }) {
  const [stop, setStop] = useState<"idle" | "stopping" | "gone">("idle");
  const stopInBox = useContext(StopInBox) === exp.expId;
  const [showChanges, setShowChanges] = useState(false);
  const [resuming, setResuming] = useState(false);
  const end = exp.end;
  const ok = end?.status === "done";
  const answeredBy = exp.source === "direct" ? exp.task.match(/^@(\w+)/)?.[1] : undefined; // a direct chat's own crew member
  // The answer itself: the last thing said at the top of the run (after the quests and the tool calls).
  const answer = exp.nodes.findLast((n) => n.kind === "msg");

  // Stop just this expedition (its id goes along), leaving the others running.
  async function stopIt() {
    setStop("stopping");
    try { await api("/api/stop", { id: exp.expId }); } catch { setStop("gone"); } // already finished
  }

  // Cut off, stopped, failed, or out of turns: start again from what it had done.
  async function resume() {
    setResuming(true);
    try { await api("/api/send", { resume: exp.expId }); } catch (e) { setResuming(false); alert(errorText(e)); }
  }

  return (
    <article className="exp" data-id={exp.expId}>
      <Ask exp={exp} />
      <div className="exp-reply">
        <div className="exp-body">
          {/* Nothing back yet: say so, so the answer's place isn't an empty box. */}
          {!end && exp.nodes.length === 0 ? <div className="exp-wait" role="status">{exp.source === "job" ? "Starting…" : "Reading your message…"}</div> : <Nodes nodes={exp.nodes} onReply={onReply} live={!end} />}
        </div>
        {end && showChanges && <Changes expId={exp.expId} />}
        {end && end.workspaces.length > 0 && <WorkspaceBox workspaces={end.workspaces} task={exp.task} expId={exp.expId} />}
        {end && exp.source !== "job" && <FeedbackBar expId={exp.expId} given={exp.feedback} />}
        {end && (
          <footer className="exp-foot">
            <span className={cx("pill", ok ? "done" : "bad")}>{ok ? "Complete" : spaced(end.status)}</span>
            <span>{end.seconds < 90 ? `${end.seconds}s` : `${Math.round(end.seconds / 60)} min`}</span>
            {end.changed > 0 && <span>· {end.changed} {plural(end.changed, "file")} changed</span>}
            <span className="foot-actions">
              {end.changed > 0 && <button type="button" className="btn small" onClick={() => setShowChanges((v) => !v)}>{showChanges ? "Hide changes" : "View changes"}</button>}
              {!ok && exp.source !== "job" && (
                <button type="button" className="btn small primary" title="Start again from what this run had done, without redoing finished work" disabled={resuming} onClick={resume}>Resume</button>
              )}
              {ok && exp.source !== "job" && (end.changed > 0 || end.workspaces.length > 0) && <AsideButton expId={exp.expId} kind="review" answeredBy={answeredBy} />}
              {ok && exp.source !== "job" && <AsideButton expId={exp.expId} kind="opinion" answeredBy={answeredBy} />}
              {answer?.kind === "msg" && answer.text.trim() && (
                <button type="button" className="btn small" title="Keep this answer in a note: the one you have open, or a new one" onClick={() => say({ do: "note", text: answer.text })}>Note</button>
              )}
              {answer?.kind === "msg" && answer.text.trim() && <ReadAloud text={answer.text} markdown what={exp.source === "job" ? `Job report · ${exp.job}` : `${answer.who}'s answer`} />}
              {exp.source !== "job" && <ForkButton expId={exp.expId} />}
              {exp.source !== "job" && (
                <button type="button" className="btn small" title="Follow up, carrying this whole conversation over" onClick={() => onReply(exp.expId, exp.task)}>Reply</button>
              )}
            </span>
          </footer>
        )}
      </div>
      {!end && !stopInBox && <RunFoot job={exp.source === "job"} stop={stop !== "gone" && (
        <button type="button" className="stop-btn" aria-label={stop === "stopping" ? "Stopping…" : "Stop"}
          title={stop === "stopping" ? "Stopping…" : "Stop this expedition and every quest in it"} disabled={stop === "stopping"} onClick={stopIt}>
          <Icon name="stop" />
        </button>
      )} />}
    </article>
  );
}

// Who circles the sun on a blank page: everyone in the camp's crew but the Quartermaster, who is the
// sun. Before the crew has loaded there is nobody to list, and the drawing falls back to the camp's own four.
function inRotation() {
  const crew = crewNow().filter((c) => c.id !== "quartermaster");
  return crew.length ? crew : undefined;
}

const EVERYTHING: View = { kind: "all" };
const NO_PAST: FeedNode[] = [];

// view: everything (the default), a blank page for a new conversation, or one conversation.
// past: that conversation's earlier runs, read back from history. waiting: a line for a blank page.
// plain: a blank page outside any project, where a message is a plain chat with a model.
// stopInBox: the run whose Stop is the message box's button.
export function Feed({ store, onReply, onExample, view = EVERYTHING, past = NO_PAST, waiting, plain, stopInBox, detail = "condensed" }: {
  store: FeedStore; onReply: OnReply; onExample: (text: string) => void; view?: View; past?: FeedNode[]; waiting?: string; plain?: boolean; stopInBox?: string;
  detail?: FeedDetail; // condensed (behind-the-scenes work folded) or detailed (every line)
}) {
  const live = useFeed(store, (s) => s.items);
  const items = useMemo(() => cardsFor(view, live, past), [view, live, past]);
  const viewKey = view.kind === "conversation" ? view.id : view.kind;
  const box = useRef<HTMLDivElement>(null);
  // Keep the newest lines in view, unless you've scrolled up to read something.
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Scrolling up means you're reading; coming back near the bottom means follow again. A scroll
    // that only moved down (ours, or the layout shifting under it) doesn't change your choice.
    let last = el.scrollTop;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) stick.current = true;
      else if (el.scrollTop < last - 2) stick.current = false;
      last = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // The feed's own box changes height too (the crew row loading in, attachments in the composer).
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    resized?.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); resized?.disconnect(); };
  }, []);
  // Opening another conversation starts at its newest line.
  useLayoutEffect(() => { stick.current = true; }, [viewKey]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
    // A card that's off-screen is only measured once it comes into view, so a long thread gets
    // taller just after this. Stay at the end for the few frames that takes.
    if (typeof requestAnimationFrame === "undefined") return;
    let frames = 12;
    let next = requestAnimationFrame(function again() {
      if (stick.current) el.scrollTop = el.scrollHeight;
      if (--frames > 0) next = requestAnimationFrame(again);
    });
    return () => cancelAnimationFrame(next);
  }, [items]);

  return (
    <div className="feed" id="feed" aria-live="polite" ref={box}>
      {items.length === 0 && view.kind === "conversation" ? (
        <div className="empty-feed"><div>{waiting ?? "Loading this conversation…"}</div></div>
      ) : items.length === 0 ? (
        <div className="empty-feed">
          {/* The camp at rest: the camp's crew circling the Quartermaster, taking turns with a quest. Outside a project, the orbits are empty. */}
          <MaeSystem crew={plain ? [] : inRotation()} />
          <h2>{plain ? "Ask anything" : view.kind === "new" ? "A new conversation" : "The camp is quiet"}</h2>
          <div>{waiting ?? `Send the ${leadName()} on an expedition. You'll approve the plan before anyone leaves camp, then watch the crew work here.`}</div>
          <div className="examples">
            {(plain ? PLAIN_EXAMPLES : EXAMPLES).map((text) => <button key={text} type="button" className="example" onClick={() => onExample(text)}>{text}</button>)}
          </div>
        </div>
      ) : <Detail.Provider value={detail}><StopInBox.Provider value={stopInBox}><Nodes nodes={items} onReply={onReply} /></StopInBox.Provider></Detail.Provider>}
    </div>
  );
}
