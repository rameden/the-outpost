// The live feed, as a back and forth: each run is what you asked (a message on the right) and the
// crew's answer under it (on the left: its quests, the crew's messages and tool calls, and any
// approvals waiting inside it). Several can be running at once.

import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { say } from "../bus.ts";
import { AttachmentChip } from "../components/AttachmentChip.tsx";
import { ItemBoundary } from "../components/ErrorBoundary.tsx";
import { autoName, cClass, clock, crewId, crewNow, cx, emojiNow, handleFor, handlesNow, leadName, nameNow, plural, shortModel, shown, spaced } from "../format.ts";
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
import { Resend, useEditAsk, type ResendFrom } from "./EditAsk.tsx";
import { cardsFor, type View } from "./conversation.ts";
import { condense, summarize, type FeedDetail, type StepsNode } from "./condense.ts";
import { stepState, worksInRepo, type ExpNode, type FeedNode, type PlanNode, type QuestNode, type QuestTree } from "./reducer.ts";
import { WorksInRepo } from "./Findings.tsx";
import { STEP_MARK, STEP_SAYS, stepPill } from "./steps.ts";
import { Loose, looseOf, tally, TrailGround } from "../trail/Ground.tsx";
import { useFeed, type FeedStore } from "./store.ts";
import { complain } from "../components/StatusLine.tsx";

import { w, a as an } from "../words.ts";
// Also what Today offers a newcomer to try (components/Home.tsx).
export const examples = () => [
  `Have the ${nameNow("Scout")} look into how other agent harnesses handle memory, then the ${nameNow("Scribe")} write it up as a short doc.`,
  `Every weekday at 08:00, summarize anything new in the ${w("camp")} wiki's notes.`,
  `@${handleFor("scout")} What's new in agent memory research this month?`,
];

// Outside a project a blank page is a plain chat with a model; the crew comes in with an @.
const plainExamples = () => [
  "Explain the difference between a rebase and a merge, and when I'd want each.",
  `@${handleFor("scout")} What's new in agent memory research this month?`,
  `@${handleFor("quartermaster")} Have the ${nameNow("Scout")} look into how other agent harnesses handle memory, then the ${nameNow("Scribe")} write it up as a short doc.`,
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
        <span className="steps-count">{n} {plural(n, "step")}{sum.who.length > 1 ? ` · ${sum.who.map(nameNow).join(", ")}` : ""}</span>
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
          <div className="avatar" aria-hidden="true">{emojiNow(node.who, node.emoji)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="msg-who">{nameNow(node.who)}</div>
            {/* Text arriving as it's written is shown plain, then formatted once it's whole. */}
            {node.streaming ? <div className="md streaming">{node.text}</div> : <Markdown text={node.text} />}
          </div>
        </div>
      );
    case "tool": return <div className={cx("tool", cClass(node.who))}><b>{node.tool}</b><code title={node.input}>{node.input}</code></div>;
    case "file": return <FileCard file={node} />;
    case "notice": return <div className="notice">{shown(node.kept ?? node.text)}</div>;
    case "route": return (
      <div className="notice route" title={`${autoName(node.choice)}: ${node.reason}`}>
        🧭 {nameNow(node.who)} {node.switched ? "switched to" : "is on"} <b>{shortModel(node.model)}{node.effort ? ` · ${node.effort}` : ""}</b> ({autoName(node.choice)}). {node.reason}
      </div>
    );
    case "sys": return <div className="sys">{shown(node.text)}</div>;
    case "steer": return <div className="steer-msg"><small>You, while it was working</small>{node.text}</div>;
  }
});

// The plan you approved, as a card that fills in while the run goes. As a list, each step says
// whether it's not started, out (and with whom), done, or didn't make it; a step with a quest goes
// to that quest's block when clicked, and steps nobody was sent on are the Quartermaster's own.
// As a trail, the same steps are waypoints with a line from each to the steps that wait for it
// (trail/Ground.tsx), drawn here in the card. List or trail is yours to pick, and is remembered.
// "Full screen" opens the trail map over the page, on this plan (trail/Trail.tsx): the other plans,
// the whole map and the replay are there.
export { STEP_MARK, STEP_SAYS, stepPill } from "./steps.ts";
// The run a plan card is in: what "Full screen" opens the map on, and where the quests that are on
// none of the plan's steps are found.
const RunOf = createContext<ExpNode | null>(null);
type PlanView = "list" | "trail";
const PLAN_VIEW = "camp-plan-view";
const goToQuest = (id: string) => document.getElementById(`quest-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
// Any name one of the six has had, in any pack (so a trail drawn after a switch keeps its colours), or someone you added.
const crewIdOf = (who: string) => crewId(who) ?? crewNow().find((c) => c.name === who)?.id;
const openQuest = (_expId: string, node: string) => goToQuest(node);
function PlanList({ plan }: { plan: PlanNode }) {
  const run = useContext(RunOf);
  const [view, setView] = useState<PlanView>(() => (storeGet(PLAN_VIEW) === "trail" ? "trail" : "list"));
  const show = (v: PlanView) => { setView(v); storeSet(PLAN_VIEW, v); };
  const states = plan.steps.map((s) => stepState(s, plan.ended));
  // Quests sent without a step are listed under the trail of the run's newest plan (an earlier one didn't know of them).
  const loose = useMemo(() => (run && view === "trail" && run.nodes.findLast((n) => n.kind === "plan")?.id === plan.id ? looseOf(run.nodes, plan) : []), [run, view, plan]);
  return (
    <div className="plan-list" role="group" aria-label="The plan, step by step">
      <div className="plan-head">
        <b>Plan</b><span>{tally(states)}</span>
        <span className="plan-views" role="group" aria-label="How the plan is shown">
          <button type="button" className="plan-view" aria-pressed={view === "list"} title="The steps as a list" onClick={() => show("list")}>List</button>
          <button type="button" className="plan-view" aria-pressed={view === "trail"} title="The steps as a trail: what waits for what" onClick={() => show("trail")}>Trail</button>
        </span>
        <button type="button" className="plan-view plan-full" aria-label="Open the trail map, full screen" title="The trail map, over the whole page: this plan, the others, the whole map and the replay"
          onClick={() => say({ do: "command", name: "trail", arg: run?.expId })}><Icon name="focus" /><span>Full screen</span></button>
      </div>
      {view === "trail" ? (
        <>
          <div className="plan-trail" role="group" aria-label="The plan as a trail" tabIndex={0}>
            <TrailGround plan={plan} expId={run?.expId ?? ""} crewId={crewIdOf} onOpen={openQuest} label="The plan's steps, as a trail" inBox />
          </div>
          <Loose at={{ expId: run?.expId ?? "", plan, loose }} crewId={crewIdOf} onOpen={openQuest} />
        </>
      ) : (
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
                {who.length > 0 && <span className="plan-who">{who.map((q) => `${emojiNow(q.who, q.emoji)} ${nameNow(q.who)}${s.quests.filter((x) => x.who === q.who).length > 1 ? ` ×${s.quests.filter((x) => x.who === q.who).length}` : ""}`).join(", ")}</span>}
                <span className={stepPill(state)}>{STEP_SAYS[state]}</span>
              </>
            );
            return (
              <li key={s.n} className={cx("plan-step", state)}>
                {target
                  ? <button type="button" title={`Go to this step's ${w("quest")}`} onClick={() => goToQuest(target.node)}>{row}</button>
                  : <div title={state === "todo" ? `Nobody has been sent on this yet: it may be the ${leadName()}'s own to do` : undefined}>{row}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// Where a quest works when others change the same repository at once, and what became of it.
const TREE_SAYS = { working: "own worktree", merged: "merged back", kept: "kept on branch", unchanged: "no changes" } as const;
function TreeChip({ tree }: { tree: QuestTree }) {
  const title = tree.state === "working" ? `Working in its own worktree of links/${tree.link}, on the branch ${tree.branch}`
    : tree.state === "merged" ? `Its changes to links/${tree.link} are merged back into the folder${tree.files ? ` (${tree.files} file${tree.files === 1 ? "" : "s"})` : ""}. The worktree and branch are gone.`
    : tree.state === "kept" ? `Not merged into links/${tree.link}: ${tree.reason ?? "see the note below"}. Its changes are on the branch ${tree.branch}.`
    : `It changed nothing in links/${tree.link}. The worktree and branch are gone.`;
  return <span className={cx("quest-tree", tree.state)} title={title}><code>{tree.state === "merged" || tree.state === "unchanged" ? `links/${tree.link}` : tree.branch}</code> {TREE_SAYS[tree.state]}</span>;
}

function QuestCard({ quest, onReply }: { quest: QuestNode; onReply: OnReply }) {
  const ok = quest.status === "done";
  return (
    <section className={cx("quest", cClass(quest.who))} id={`quest-${quest.id}`}>
      <div className="quest-head">
        <span>{emojiNow(quest.who, quest.emoji)} {nameNow(quest.who)} {w("depart")}</span>
        {quest.step && <span className="quest-step" title={`Step ${quest.step} of the plan`}>Step {quest.step}</span>}
        {quest.helper && <span className="quest-step" title={`Sent by another ${w("quest")} as its helper`}>Helper</span>}
        {quest.brief && <span className="quest-brief" title={quest.brief}>{quest.brief}</span>}
        {quest.trees?.map((t) => <TreeChip key={t.link} tree={t} />)}
        {quest.status === null ? <span className="pill live">On {w("quest")}</span> : <span className={cx("pill", ok ? "done" : "bad")}>{ok ? "Returned" : spaced(quest.status)}</span>}
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
  // In a conversation, a message you sent can be changed and sent again (EditAsk.tsx).
  const edit = useEditAsk(exp);
  return (
    <div className="exp-ask">
      {exp.attachments.length > 0 && <div className="exp-atts">{exp.attachments.map((a, i) => <AttachmentChip key={i} a={a} big />)}</div>}
      {/* Still the run's heading, so it can be found and jumped to like one. */}
      <div className={cx("ask-bubble", long && !whole && "folded")} role="heading" aria-level={3}><Markdown text={handlesNow(exp.task)} /></div>
      {long && <button type="button" className="linkish" aria-expanded={whole} onClick={() => setWhole((v) => !v)}>{whole ? "Show less" : "Show all of it"}</button>}
      {edit.editor}
      <div className="ask-meta">
        {exp.source === "job" && <span title="Sent by a scheduled job, not typed just now">Scheduled job · {exp.job}</span>}
        {exp.followUp && <span title="Carries the earlier conversation"><Icon name="reply" /> Follow-up</span>}
        {edit.button}
        {/* How long the answer took lives here, on hover, not under the answer. */}
        <time title={exp.end ? `Answered in ${took(exp.end.seconds)}` : undefined}>{clock(exp.time)}</time>
      </div>
    </div>
  );
}

const took = (s: number) => s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;

// While an expedition runs, its Stop is the message box's button. A run whose Stop isn't there (one
// in All runs, or an earlier run still going beside the newest) gets a small one under its corner.
// A scheduled job has nobody to talk to, and says so.
function RunFoot({ stop, job }: { stop: ReactNode; job: boolean }) {
  return <div className="run-stop">{job && <span className="steer-note">A scheduled job is running.</span>}{stop}</div>;
}

// Your say on a finished run: a thumb, and optionally a note. The thumb is saved the moment you
// click it; a note is saved when you press Save, and (unless you untick it) kept as a standing
// note so later runs start with it. The thumbs sit in the answer's row of icons; the note's box,
// and the note once saved, go under that row.
type Given = NonNullable<ExpNode["feedback"]>;
function useFeedback(expId: string, given?: Given) {
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
    } catch (e) { complain(errorText(e)); }
    setBusy(false);
  }
  // A thumb (again, to change the note) opens the note's box.
  const rate = (rating: "up" | "down") => { setOpen(true); void send(rating, false); };

  const thumbs = (
    <span className="fb-row" role="group" aria-label={mine ? "Your feedback" : "How was this?"}>
      <button type="button" className={cx("icon-btn", mine?.rating === "up" && "on")} aria-pressed={mine?.rating === "up"} aria-label="Good answer" title="Good: more like this" disabled={busy} onClick={() => rate("up")}><Icon name="up" /></button>
      <button type="button" className={cx("icon-btn", mine?.rating === "down" && "on")} aria-pressed={mine?.rating === "down"} aria-label="Not what I wanted" title="Not what I wanted" disabled={busy} onClick={() => rate("down")}><Icon name="down" /></button>
    </span>
  );
  const below = open && mine ? (
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
  ) : mine && (mine.note || mine.kept) ? (
    <div className="fb-saved">
      {mine.note && <span className="fb-note" title={mine.note}>“{mine.note}”</span>}
      {mine.kept && <span className="fb-kept">Kept in {mine.kept}</span>}
      <button type="button" className="linkish" onClick={() => setOpen(true)}>Edit note</button>
    </div>
  ) : null;
  return { thumbs, below };
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
  const rated = exp.source !== "job"; // a scheduled job has nobody to rate it
  const feedback = useFeedback(exp.expId, exp.feedback);

  // Stop just this expedition (its id goes along), leaving the others running.
  async function stopIt() {
    setStop("stopping");
    try { await api("/api/stop", { id: exp.expId }); } catch { setStop("gone"); } // already finished
  }

  // Cut off, stopped, failed, or out of turns: start again from what it had done.
  async function resume() {
    setResuming(true);
    try { await api("/api/send", { resume: exp.expId }); } catch (e) { setResuming(false); complain(errorText(e)); }
  }

  return (
    <article className="exp" data-id={exp.expId}>
      <Ask exp={exp} />
      <div className="exp-reply">
        <div className="exp-body">
          {/* Nothing back yet: say so, so the answer's place isn't an empty box. */}
          {!end && exp.nodes.length === 0 ? <div className="exp-wait" role="status">{exp.source === "job" ? "Starting…" : "Reading your message…"}</div> : <RunOf.Provider value={exp}><Nodes nodes={exp.nodes} onReply={onReply} live={!end} /></RunOf.Provider>}
        </div>
        {end && showChanges && <Changes expId={exp.expId} />}
        {end && end.workspaces.length > 0 && <WorkspaceBox workspaces={end.workspaces} task={exp.task} expId={exp.expId} />}
        {end && (
          <footer className="exp-foot">
            {rated && feedback.thumbs}
            {!ok && <span className={cx("pill", "bad")}>{spaced(end.status)}</span>}
            {!ok && exp.source !== "job" && (
              <button type="button" className="btn small primary" title={`Start again from what this ${w("expedition")} had done, without redoing finished work`} disabled={resuming} onClick={resume}>Resume</button>
            )}
            <span className="foot-actions">
              {end.changed > 0 && (
                <button type="button" className={cx("icon-btn", "foot-changes", showChanges && "on")} aria-pressed={showChanges}
                  aria-label={showChanges ? "Hide changes" : "View changes"} title={`${end.changed} ${plural(end.changed, "file")} changed`} onClick={() => setShowChanges((v) => !v)}>
                  <Icon name="diff" /><span>{end.changed}</span>
                </button>
              )}
              {ok && exp.source !== "job" && (end.changed > 0 || end.workspaces.length > 0) && <AsideButton expId={exp.expId} kind="review" answeredBy={answeredBy} />}
              {ok && exp.source !== "job" && <AsideButton expId={exp.expId} kind="opinion" answeredBy={answeredBy} />}
              {answer?.kind === "msg" && answer.text.trim() && (
                <button type="button" className="icon-btn" aria-label="Note" title="Keep this answer in a note: the one you have open, or a new one" onClick={() => say({ do: "note", text: answer.text })}><Icon name="note" /></button>
              )}
              {answer?.kind === "msg" && answer.text.trim() && <ReadAloud icon text={answer.text} markdown what={exp.source === "job" ? `Job report · ${exp.job}` : `${nameNow(answer.who)}'s answer`} />}
              {exp.source !== "job" && <ForkButton expId={exp.expId} />}
              {exp.source !== "job" && (
                <button type="button" className="icon-btn" aria-label="Reply" title="Follow up, carrying this whole conversation over" onClick={() => onReply(exp.expId, exp.task)}><Icon name="reply" /></button>
              )}
            </span>
          </footer>
        )}
        {end && rated && feedback.below}
      </div>
      {!end && !stopInBox && <RunFoot job={exp.source === "job"} stop={stop !== "gone" && (
        <button type="button" className="stop-btn" aria-label={stop === "stopping" ? "Stopping…" : "Stop"}
          title={stop === "stopping" ? "Stopping…" : `Stop this ${w("expedition")} and every ${w("quest")} in it`} disabled={stop === "stopping"} onClick={stopIt}>
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
// project: the conversation's project (a changed first message starts a new conversation there).
export function Feed({ store, onReply, onExample, view = EVERYTHING, past = NO_PAST, waiting, plain, stopInBox, detail = "condensed", project }: {
  store: FeedStore; onReply: OnReply; onExample: (text: string) => void; view?: View; past?: FeedNode[]; waiting?: string; plain?: boolean; stopInBox?: string;
  detail?: FeedDetail; // condensed (behind-the-scenes work folded) or detailed (every line)
  project?: string;
}) {
  const live = useFeed(store, (s) => s.items);
  const items = useMemo(() => cardsFor(view, live, past), [view, live, past]);
  const inRepo = useMemo(() => worksInRepo(items), [items]);
  // In a conversation: its runs in order, so a message can be changed and sent again from where it was.
  // (Made again only when that changes, not with every word streamed in, so the messages aren't drawn again.)
  const runsKey = view.kind !== "conversation" ? "" : items.flatMap((n) => (n.kind === "exp" ? [`${n.expId}${n.end ? "" : "*"}`] : [])).join(" ");
  const resend = useMemo<ResendFrom | null>(() => {
    if (view.kind !== "conversation") return null;
    const runs = runsKey ? runsKey.split(" ") : [];
    return { runs: runs.map((r) => r.replace(/\*$/, "")), project, busy: runs.some((r) => r.endsWith("*")) };
  }, [view.kind, runsKey, project]);
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
          <h2>{plain ? "Ask anything" : view.kind === "new" ? "A new conversation" : `The ${w("camp")} is quiet`}</h2>
          <div>{waiting ?? `Send the ${leadName()} on ${an("expedition")}. You'll approve the plan before anyone leaves ${w("camp")}, then watch the ${w("crew")} work here.`}</div>
          <div className="examples">
            {(plain ? plainExamples() : examples()).map((text) => <button key={text} type="button" className="example" onClick={() => onExample(text)}>{text}</button>)}
          </div>
        </div>
      ) : <Detail.Provider value={detail}><StopInBox.Provider value={stopInBox}><Resend.Provider value={resend}><WorksInRepo.Provider value={inRepo}><Nodes nodes={items} onReply={onReply} /></WorksInRepo.Provider></Resend.Provider></StopInBox.Provider></Detail.Provider>}
    </div>
  );
}
