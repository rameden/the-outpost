// The trail map: the Quartermaster's plan drawn as a trail, over the whole page. Each step is a
// waypoint (its number, what it is, who was sent on it and how it stands), and a line runs from a
// step to each step that has to wait for it, so you can see at a glance what's done, what's out
// now, and what's held up behind what. It's the same plan the feed lists (feed/Feed.tsx), read
// from the same feed, so it fills in as the crew works.
//
// Which plan: the newest one in the feed, unless you pick an earlier one. Replay plays the last
// day back through it, with Orbit's own reel and timeline (orbit/replay.ts, orbit/Timeline.tsx),
// into a feed of its own; nothing in a replay can be opened, because none of it is happening now.
//
// A quest the Quartermaster sent without saying which step it's for belongs to no waypoint: those
// are listed under the map ("off the trail") rather than guessed onto a step.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, errorText } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { STEP_MARK, STEP_SAYS } from "../feed/Feed.tsx";
import { stepState, type FeedNode, type PlanNode, type PlanQuest, type StepState } from "../feed/reducer.ts";
import { createFeedStore, useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, clock, cx } from "../format.ts";
import { reelOf, type Reel } from "../orbit/replay.ts";
import { Timeline, type Time } from "../orbit/Timeline.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { layoutOf, STEP_H, STEP_W } from "./layout.ts";

// A plan in the feed: the run it belongs to, and the quests of that run that are on none of its steps.
export type Trailhead = { expId: string; task: string; time: string; running: boolean; plan: PlanNode; loose: PlanQuest[] };
export function plansOf(items: FeedNode[]): Trailhead[] {
  const out: Trailhead[] = [];
  for (const x of items) {
    if (x.kind !== "exp") continue;
    const plan = x.nodes.findLast((n): n is PlanNode => n.kind === "plan");
    if (!plan) continue;
    const onStep = new Set(plan.steps.flatMap((st) => st.quests.map((q) => q.node)));
    const loose = x.nodes.flatMap((n) => (n.kind === "quest" && !onStep.has(n.id) ? [{ node: n.id, who: n.who, emoji: n.emoji, status: n.status }] : []));
    out.push({ expId: x.expId, task: x.task, time: x.time, running: x.end === null, plan, loose });
  }
  return out;
}

const QUEST_SAYS: Record<StepState, string> = { todo: "not started", out: "out now", done: "back, done", failed: "didn't finish", stopped: "cut short" };
const questState = (q: PlanQuest, ended?: string): StepState => (q.status === null ? (ended ? "stopped" : "out") : q.status === "done" ? "done" : "failed");
const listed = (ns: number[]) => (ns.length > 1 ? `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}` : String(ns[0]));

// One of the crew on a step: one chip a quest, so two quests by the same crew member are two chips,
// each going to its own block in the conversation. crewId: who they are whatever they're called
// (a colour, or anything else about a role, hangs on the id, not on the name shown).
function Chip({ q, ended, crewId, onOpen }: { q: PlanQuest; ended?: string; crewId: (who: string) => string | undefined; onOpen?: (node: string) => void }) {
  const state = questState(q, ended), id = crewId(q.who);
  const cls = cx("trail-chip", cClass(id) || cClass(q.who), `q-${state}`);
  const inner = <><span aria-hidden="true">{q.emoji}</span><b>{q.who}</b><i aria-hidden="true">{STEP_MARK[state]}</i></>;
  if (!onOpen) return <span className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}`}>{inner}<span className="sr-only">, {QUEST_SAYS[state]}</span></span>;
  return (
    <button type="button" className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}. Go to this quest`} aria-label={`${q.who}, ${QUEST_SAYS[state]}: go to this quest`}
      onClick={() => onOpen(q.node)}>{inner}</button>
  );
}

const TrailMap = memo(function TrailMap({ plan, loose, crewId, onOpen }: {
  plan: PlanNode; loose: PlanQuest[]; crewId: (who: string) => string | undefined; onOpen?: (node: string) => void;
}) {
  // Laid out again only when the plan's shape changes, not each time one of its quests moves.
  const shape = plan.steps.map((s) => `${s.n}:${s.after?.join(",") ?? ""}`).join("|");
  const lay = useMemo(() => layoutOf(plan.steps), [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  const byN = new Map(plan.steps.map((s) => [s.n, s]));
  const states = new Map(plan.steps.map((s) => [s.n, stepState(s, plan.ended)]));
  // The step that's out now is kept in sight on a trail longer than the screen.
  const ground = useRef<HTMLDivElement>(null);
  const outNow = plan.steps.find((s) => states.get(s.n) === "out")?.n;
  useEffect(() => {
    if (outNow === undefined) return;
    ground.current?.querySelector<HTMLElement>(`[data-n="${outNow}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [outNow, plan.id]);
  return (
    <div className="trail-map">
      <div className="trail-ground" ref={ground} style={{ width: lay.width, height: lay.height, "--step-w": `${STEP_W}px`, "--step-h": `${STEP_H}px` } as CSSProperties}>
        <svg className="trail-lines" width={lay.width} height={lay.height} viewBox={`0 0 ${lay.width} ${lay.height}`} aria-hidden="true">
          {lay.edges.map((e) => (
            <g key={`${e.from}-${e.to}`} data-line={`${e.from}-${e.to}`} className={cx("trail-edge", states.get(e.from) === "done" && "walked", states.get(e.from) === "done" && states.get(e.to) === "out" && "live")}>
              <path d={e.d} /><path className="tip" d={e.tip} />
            </g>
          ))}
        </svg>
        <ol className="trail-steps" aria-label="The plan's steps">
          {lay.spots.map((spot) => {
            const step = byN.get(spot.n)!, state = states.get(spot.n)!;
            const waits = spot.after.length ? ` Waits for step${spot.after.length > 1 ? "s" : ""} ${listed(spot.after)}.` : "";
            return (
              <li key={spot.n} className={cx("trail-step", state)} data-n={spot.n} data-col={spot.col} data-row={spot.row} data-state={state} tabIndex={0}
                style={{ left: spot.x, top: spot.y }} aria-label={`Step ${spot.n}, ${STEP_SAYS[state].toLowerCase()}: ${step.text.replace(/\.$/, "")}.${waits}`}>
                <div className="trail-step-head">
                  <span className="trail-n">{spot.n}</span>
                  <span className={cx("pill", state === "out" ? "live" : state === "done" ? "done" : state === "todo" ? "" : "bad")}><i aria-hidden="true">{STEP_MARK[state]}</i> {STEP_SAYS[state]}</span>
                </div>
                <p className="trail-text" title={step.text}>{step.text}</p>
                <div className="trail-crew">
                  {step.quests.length
                    ? step.quests.map((q) => <Chip key={q.node} q={q} ended={plan.ended} crewId={crewId} onOpen={onOpen} />)
                    : <span className="trail-nobody">{state === "todo" ? "Nobody sent yet" : "The Quartermaster's own"}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {loose.length > 0 && (
        <div className="trail-loose" role="group" aria-label="Quests sent without a step">
          <span>Off the trail (sent without a step)</span>
          {loose.map((q) => <Chip key={q.node} q={q} ended={plan.ended} crewId={crewId} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
});

// onOpenQuest: go to a quest's own block, on the page underneath (whoever shows this closes it as they go).
export function Trail({ S, store, onClose, onOpenQuest }: {
  S: CampState | null; store: FeedStore; onClose: () => void; onOpenQuest?: (q: { expId: string; node: string }) => void;
}) {
  // A replay: the last day's events, played into a feed of its own (the Timeline plays them in).
  const [replay, setReplay] = useState<{ reel: Reel; store: FeedStore } | null>(null);
  const [told, setTold] = useState(""); // something to say along the top (there was nothing to replay)
  const time = useRef<Time>({ now: null, quiet: false }).current;
  const [picked, setPicked] = useState<string | null>(null); // the run whose plan you chose to look at (none: the newest)
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  const items = useFeed(replay?.store ?? store, (s) => s.items);
  const plans = useMemo(() => plansOf(items), [items]);
  const shown = plans.find((p) => p.expId === picked) ?? plans.at(-1);
  // The same list of loose quests for as long as none of them changes, so the map isn't drawn again for nothing.
  const looseKey = shown?.loose.map((q) => `${q.node}:${q.status}`).join("|") ?? "";
  const loose = useMemo(() => shown?.loose ?? [], [looseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const crew = S?.characters;
  const crewId = useCallback((who: string) => crew?.find((c) => c.name === who)?.id, [crew]);
  const expId = shown?.expId, live = !replay;
  const open = useMemo(() => (live && onOpenQuest && expId ? (node: string) => onOpenQuest({ expId, node }) : undefined), [live, onOpenQuest, expId]);

  const startReplay = useCallback(async () => {
    setTold("");
    try {
      const reel = reelOf((await api<{ events: CampEvent[] }>("/api/feed/day")).events);
      if (!reel.events.length) return setTold("Nothing has happened in the last day to replay.");
      setPicked(null);
      setReplay({ reel, store: createFeedStore() });
    } catch (e) { setTold(`The replay couldn't be fetched: ${errorText(e)}`); }
  }, []);
  const leaveReplay = useCallback(() => { setPicked(null); setReplay(null); }, []);
  const toggleReplay = () => { if (replay) leaveReplay(); else void startReplay(); };

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // In a box (the plan picker, the timeline), a key is for the box (Esc steps out of it).
    if (ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select")) {
      if (ev.key === "Escape") { root.current?.focus({ preventScroll: true }); ev.preventDefault(); ev.stopPropagation(); }
      return;
    }
    if (ev.key === "Escape") { if (replay) leaveReplay(); else onClose(); }
    else if (ev.key === "p" || ev.key === "P") toggleReplay();
  };

  const states = shown?.plan.steps.map((s) => stepState(s, shown.plan.ended)) ?? [];
  const count = (st: StepState) => states.filter((x) => x === st).length;
  return (
    <div className={cx("trail", replay && "replaying")} ref={root} role="dialog" aria-modal="true" aria-label="Trail map: the plan, step by step" tabIndex={-1} onKeyDown={onKey}>
      <header className="trail-top">
        <div className="trail-title"><h2>Trail map</h2>
          {replay ? <span className="trail-note" role="status">Replay: the last day, played back. None of this is happening now.</span>
            : told ? <span className="trail-note" role="status">{told}</span>
            : <span>The Quartermaster's plan, as the crew walks it</span>}</div>
        <div className="trail-tools">
          {plans.length > 1 && shown && (
            <select className="trail-pick" aria-label="Which plan" title="Look at another plan" value={shown.expId}
              onChange={(ev) => setPicked(ev.target.value === plans.at(-1)!.expId ? null : ev.target.value)}>
              {plans.toReversed().map((p, i) => <option key={p.expId} value={p.expId}>{clock(p.time)} · {p.task.replace(/\s+/g, " ").slice(0, 60)}{i === 0 ? " (newest)" : ""}</option>)}
            </select>
          )}
          <button type="button" className="trail-btn" aria-pressed={!!replay} title={replay ? "End the replay and show the plan as it is now (P)" : "Replay: watch the last day's plans fill in again, in about half a minute (P)"} onClick={toggleReplay}>Replay</button>
          <button type="button" className="icon-btn" aria-label="Leave the trail map" title="Back to the page (Esc)" onClick={onClose}><Icon name="x" /></button>
        </div>
      </header>
      {shown ? (
        <>
          <div className="trail-ask">
            <b title={shown.task}>{shown.task}</b>
            <span className="trail-count" role="status">{count("done")} of {states.length} done{count("out") ? ` · ${count("out")} out` : ""}{count("failed") ? ` · ${count("failed")} didn't finish` : ""}{count("stopped") ? ` · ${count("stopped")} cut short` : ""}</span>
          </div>
          <TrailMap plan={shown.plan} loose={loose} crewId={crewId} onOpen={open} />
        </>
      ) : (
        <div className="trail-empty">
          <Icon name="trail" />
          <b>{replay ? "No plan yet at this point in the day" : "No plan yet"}</b>
          <p>{replay ? "Plans appear here as the day plays on." : "When the Quartermaster's plan is approved, its steps appear here as a trail, and fill in as the crew works."}</p>
        </div>
      )}
      {replay && <Timeline reel={replay.reel} store={replay.store} time={time} onLeave={leaveReplay} />}
    </div>
  );
}
