// The live feed: one card per expedition (several can be running), each with its quests, the
// crew's messages and tool calls, and any approvals waiting inside it.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "../api.ts";
import { AttachmentChip } from "../components/AttachmentChip.tsx";
import { cClass, clock, cx, plural, spaced } from "../format.ts";
import { Icon } from "../components/bits.tsx";
import { Markdown } from "../markdown.tsx";
import { AskCard } from "./AskCard.tsx";
import { Changes } from "./Changes.tsx";
import { WorkspaceBox } from "./Workspaces.tsx";
import { AsideButton } from "./Aside.tsx";
import { cardsFor, type View } from "./conversation.ts";
import type { ExpNode, FeedNode, QuestNode } from "./reducer.ts";
import { useFeed, type FeedStore } from "./store.ts";

const EXAMPLES = [
  "Scout how other agent harnesses handle memory, then have the Scribe write it up as a short doc.",
  "Every weekday at 08:00, summarize anything new in the camp wiki's notes.",
  "@scout What's new in agent memory research this month?",
];

export type OnReply = (expId: string, task: string) => void;

const Nodes = ({ nodes, onReply }: { nodes: FeedNode[]; onReply: OnReply }) => <>{nodes.map((n) => <NodeView key={n.id} node={n} onReply={onReply} />)}</>;

const NodeView = memo(function NodeView({ node, onReply }: { node: FeedNode; onReply: OnReply }) {
  switch (node.kind) {
    case "exp": return <ExpeditionCard exp={node} onReply={onReply} />;
    case "quest": return <QuestCard quest={node} onReply={onReply} />;
    case "ask": return <AskCard ask={node} />;
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
    case "notice": return <div className="notice">{node.text}</div>;
    case "sys": return <div className="sys">{node.text}</div>;
    case "steer": return <div className="steer-msg"><small>You, while it was working</small>{node.text}</div>;
  }
});

function QuestCard({ quest, onReply }: { quest: QuestNode; onReply: OnReply }) {
  const ok = quest.status === "done";
  return (
    <section className={cx("quest", cClass(quest.who))}>
      <div className="quest-head">
        <span>{quest.emoji} {quest.who} sets out</span>
        {quest.status === null ? <span className="pill live">On quest</span> : <span className={cx("pill", ok ? "done" : "bad")}>{ok ? "Returned" : spaced(quest.status)}</span>}
      </div>
      <div className="quest-body"><Nodes nodes={quest.nodes} onReply={onReply} /></div>
    </section>
  );
}

// While an expedition runs you can say something to it; the agents working in it see it on their next step.
function SteerBar({ expId }: { expId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  async function send(ev: FormEvent) {
    ev.preventDefault();
    const said = text.trim();
    if (!said) return;
    setBusy(true);
    try { await api("/api/steer", { id: expId, text: said }); setText(""); }
    catch (e) { alert(errorText(e)); }
    setBusy(false);
    box.current?.focus();
  }
  return (
    <form className="exp-steer" onSubmit={send}>
      <input ref={box} value={text} disabled={busy} onChange={(ev) => setText(ev.target.value)}
        placeholder="Say something to this expedition while it works…" aria-label="Message to the running expedition" />
      <button className="btn small" type="submit" disabled={busy}>Send</button>
    </form>
  );
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
  const [showChanges, setShowChanges] = useState(false);
  const [resuming, setResuming] = useState(false);
  const label = exp.source === "job" ? `Job · ${exp.job}` : exp.source === "direct" ? "Direct" : "Expedition";
  const end = exp.end;
  const ok = end?.status === "done";
  const answeredBy = exp.source === "direct" ? exp.task.match(/^@(\w+)/)?.[1] : undefined; // a direct chat's own crew member

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
      <header className="exp-head">
        <span className={cx("badge", exp.source === "job" ? "job" : exp.source === "direct" ? "direct" : "")}>{label}</span>
        {exp.followUp && <span className="badge follow" title="Carries the earlier conversation"><Icon name="reply" /> Follow-up</span>}
        <h3>{exp.task}</h3>
        <time>{clock(exp.time)}</time>
        {!end && stop !== "gone" && (
          <button type="button" className="btn small danger stop-btn" title="Stop this expedition and every quest in it" disabled={stop === "stopping"} onClick={stopIt}>
            {stop === "stopping" ? "Stopping…" : "Stop"}
          </button>
        )}
      </header>
      {exp.attachments.length > 0 && <div className="exp-atts">{exp.attachments.map((a, i) => <AttachmentChip key={i} a={a} big />)}</div>}
      <div className="exp-body"><Nodes nodes={exp.nodes} onReply={onReply} /></div>
      {!end && exp.source !== "job" && <SteerBar expId={exp.expId} />}
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
            {exp.source !== "job" && (
              <button type="button" className="btn small" title="Follow up, carrying this whole conversation over" onClick={() => onReply(exp.expId, exp.task)}>Reply</button>
            )}
          </span>
        </footer>
      )}
    </article>
  );
}

const EVERYTHING: View = { kind: "all" };
const NO_PAST: FeedNode[] = [];

// view: everything (the default), a blank page for a new conversation, or one conversation.
// past: that conversation's earlier runs, read back from history. waiting: a line for a blank page.
export function Feed({ store, onReply, onExample, view = EVERYTHING, past = NO_PAST, waiting }: {
  store: FeedStore; onReply: OnReply; onExample: (text: string) => void; view?: View; past?: FeedNode[]; waiting?: string;
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
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className="feed" id="feed" aria-live="polite" ref={box}>
      {items.length === 0 && view.kind === "conversation" ? (
        <div className="empty-feed"><div>{waiting ?? "Loading this conversation…"}</div></div>
      ) : items.length === 0 ? (
        <div className="empty-feed">
          <div className="fire">🔥</div>
          <h2>{view.kind === "new" ? "A new conversation" : "The camp is quiet"}</h2>
          <div>{waiting ?? "Send the Quartermaster on an expedition. You'll approve the plan before anyone leaves camp, then watch the crew work here."}</div>
          <div className="examples">
            {EXAMPLES.map((text) => <button key={text} type="button" className="example" onClick={() => onExample(text)}>{text}</button>)}
          </div>
        </div>
      ) : <Nodes nodes={items} onReply={onReply} />}
    </div>
  );
}
