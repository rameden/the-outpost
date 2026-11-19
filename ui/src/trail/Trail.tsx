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
//
// The whole map: every plan in the feed at once, drawn as a tree. The trunk up the left is the day
// (oldest at the foot, newest at the tip) and each plan is a bough growing off it, so you can see
// all of what was asked and how each went without picking through them. It can be drawn smaller,
// to get more of it on the screen.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, errorText } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { STEP_MARK, STEP_SAYS } from "../feed/Feed.tsx";
import { stepState, type FeedNode, type PlanNode, type PlanQuest, type StepState } from "../feed/reducer.ts";
import { createFeedStore, useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, clock, cx } from "../format.ts";
import { reelOf, type Reel } from "../orbit/replay.ts";
import { Timeline, type Time } from "../orbit/Timeline.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { layoutOf, PAD, STEP_H, STEP_W } from "./layout.ts";

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
type Open = (expId: string, node: string) => void;
type CrewId = (who: string) => string | undefined;
// "4 of 6 done · 1 out · 1 didn't finish"
function tally(states: StepState[], of = "") {
  const count = (st: StepState) => states.filter((x) => x === st).length;
  return `${count("done")} of ${states.length}${of} done${count("out") ? ` · ${count("out")} out` : ""}${count("failed") ? ` · ${count("failed")} didn't finish` : ""}${count("stopped") ? ` · ${count("stopped")} cut short` : ""}`;
}
const statesOf = (plan: PlanNode) => plan.steps.map((s) => stepState(s, plan.ended));
// The whole map's tree. BOUGH: how far left of a plan's ground the trunk's middle is (styles.css
// leaves that much room). RISE: how far below its first step a bough leaves the trunk.
const BOUGH = 32, RISE = 44;
const girth = (col: number) => Math.max(2, 4.5 - col * 0.75); // a line's width, by the column it leaves
// How small the whole map can be drawn.
const ZOOMS = [1, 0.8, 0.65, 0.5];

// One of the crew on a step: one chip a quest, so two quests by the same crew member are two chips,
// each going to its own block in the conversation. crewId: who they are whatever they're called
// (a colour, or anything else about a role, hangs on the id, not on the name shown).
function Chip({ q, ended, expId, crewId, onOpen }: { q: PlanQuest; ended?: string; expId: string; crewId: CrewId; onOpen?: Open }) {
  const state = questState(q, ended), id = crewId(q.who);
  const cls = cx("trail-chip", cClass(id) || cClass(q.who), `q-${state}`);
  const inner = <><span aria-hidden="true">{q.emoji}</span><b>{q.who}</b><i aria-hidden="true">{STEP_MARK[state]}</i></>;
  if (!onOpen) return <span className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}`}>{inner}<span className="sr-only">, {QUEST_SAYS[state]}</span></span>;
  return (
    <button type="button" className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}. Go to this quest`} aria-label={`${q.who}, ${QUEST_SAYS[state]}: go to this quest`}
      onClick={() => onOpen(expId, q.node)}>{inner}</button>
  );
}

// One plan's trail: its waypoints and the lines between them. tree: it's a bough on the whole map,
// so a line grows in from the trunk on the left to each step that waits for nothing.
const TrailGround = memo(function TrailGround({ plan, expId, crewId, onOpen, label, tree }: {
  plan: PlanNode; expId: string; crewId: CrewId; onOpen?: Open; label: string; tree?: boolean;
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
  // On the whole map a plan is a bough of the tree: it leaves the trunk at a knot below its first
  // steps and grows up and out to each of them, and its lines thin the further out they run.
  const firsts = lay.spots.filter((s) => s.col === 1), colOf = new Map(lay.spots.map((s) => [s.n, s.col]));
  const knot = Math.max(0, ...firsts.map((s) => s.y)) + STEP_H / 2 + RISE;
  return (
    <div className="trail-ground" ref={ground} style={{ width: lay.width, height: lay.height, "--step-w": `${STEP_W}px`, "--step-h": `${STEP_H}px` } as CSSProperties}>
      <svg className="trail-lines" width={lay.width} height={lay.height} viewBox={`0 0 ${lay.width} ${lay.height}`} aria-hidden="true">
        {tree && firsts.map((s) => {
          const y = s.y + STEP_H / 2;
          return <path key={s.n} className="trail-bough" d={`M${-BOUGH} ${knot}C${-BOUGH + 12} ${knot - (knot - y) * 0.7} ${PAD - 36} ${y} ${PAD} ${y}`} />;
        })}
        {tree && firsts.length > 0 && <circle className="trail-knot" cx={-BOUGH} cy={knot} r={6} />}
        {lay.edges.map((e) => (
          <g key={`${e.from}-${e.to}`} data-line={`${e.from}-${e.to}`} className={cx("trail-edge", states.get(e.from) === "done" && "walked", states.get(e.from) === "done" && states.get(e.to) === "out" && "live")}>
            <path d={e.d} style={tree ? { strokeWidth: girth(colOf.get(e.from) ?? 1) } : undefined} /><path className="tip" d={e.tip} />
          </g>
        ))}
      </svg>
      <ol className="trail-steps" aria-label={label}>
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
                  ? step.quests.map((q) => <Chip key={q.node} q={q} ended={plan.ended} expId={expId} crewId={crewId} onOpen={onOpen} />)
                  : <span className="trail-nobody">{state === "todo" ? "Nobody sent yet" : "The Quartermaster's own"}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
});

// The quests of a run that are on none of its plan's steps.
function Loose({ at, crewId, onOpen }: { at: Trailhead; crewId: CrewId; onOpen?: Open }) {
  if (!at.loose.length) return null;
  return (
    <div className="trail-loose" role="group" aria-label="Quests sent without a step">
      <span>Off the trail (sent without a step)</span>
      {at.loose.map((q) => <Chip key={q.node} q={q} ended={at.plan.ended} expId={at.expId} crewId={crewId} onOpen={onOpen} />)}
    </div>
  );
}

// onOpenQuest: go to a quest's own block, on the page underneath (whoever shows this closes it as they go).
export function Trail({ S, store, onClose, onOpenQuest }: {
  S: CampState | null; store: FeedStore; onClose: () => void; onOpenQuest?: (q: { expId: string; node: string }) => void;
}) {
  // A replay: the last day's events, played into a feed of its own (the Timeline plays them in).
  const [replay, setReplay] = useState<{ reel: Reel; store: FeedStore } | null>(null);
  const [told, setTold] = useState(""); // something to say along the top (there was nothing to replay)
  const time = useRef<Time>({ now: null, quiet: false }).current;
  const [picked, setPicked] = useState<string | null>(null); // the run whose plan you chose to look at (none: the newest)
  const [whole, setWhole] = useState(false); // every plan at once, on one map
  const [zoom, setZoom] = useState(1); // how big the whole map is drawn (one of ZOOMS)
  const root = useRef<HTMLDivElement>(null), all = useRef<HTMLOListElement>(null);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  const items = useFeed(replay?.store ?? store, (s) => s.items);
  const plans = useMemo(() => plansOf(items), [items]);
  const shown = plans.find((p) => p.expId === picked) ?? plans.at(-1);

  const crew = S?.characters;
  const crewId = useCallback((who: string) => crew?.find((c) => c.name === who)?.id, [crew]);
  const live = !replay;
  const open = useMemo<Open | undefined>(() => (live && onOpenQuest ? (expId, node) => onOpenQuest({ expId, node }) : undefined), [live, onOpenQuest]);

  // The whole map opens as big as it can be with all of it in sight; failing that, with its width
  // in sight (it scrolls down); failing that, as small as it goes. After that the size is yours.
  const toggleWhole = () => { setZoom(1); setWhole((on) => !on); };
  useLayoutEffect(() => {
    const list = all.current, box = list?.parentElement;
    if (!whole || !list || !box?.clientWidth) return;
    const pad = getComputedStyle(box), px = (v: string) => parseFloat(v) || 0;
    const wide = box.clientWidth - px(pad.paddingLeft) - px(pad.paddingRight), tall = box.clientHeight - px(pad.paddingTop) - px(pad.paddingBottom);
    const fits = (z: number, down: boolean) => list.scrollWidth * z <= wide && (!down || list.scrollHeight * z <= tall);
    setZoom(ZOOMS.find((z) => fits(z, true)) ?? ZOOMS.find((z) => fits(z, false)) ?? ZOOMS.at(-1)!);
  }, [whole]);
  const zoomBy = (d: 1 | -1) => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) - d))]);
  const only = (expId: string) => { setPicked(expId === plans.at(-1)?.expId ? null : expId); setWhole(false); };

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
    else if ((ev.key === "m" || ev.key === "M") && (whole || plans.length > 1)) toggleWhole();
    else if (whole && (ev.key === "-" || ev.key === "_")) zoomBy(-1);
    else if (whole && (ev.key === "+" || ev.key === "=")) zoomBy(1);
  };

  return (
    <div className={cx("trail", replay && "replaying")} ref={root} role="dialog" aria-modal="true" aria-label="Trail map: the plan, step by step" tabIndex={-1} onKeyDown={onKey}>
      <header className="trail-top">
        <div className="trail-title"><h2>Trail map</h2>
          {replay ? <span className="trail-note" role="status">Replay: the last day, played back. None of this is happening now.</span>
            : told ? <span className="trail-note" role="status">{told}</span>
            : <span>The Quartermaster's plan, as the crew walks it</span>}</div>
        <div className="trail-tools">
          {whole && (
            <span className="trail-zoom" role="group" aria-label="How big the map is drawn">
              <button type="button" className="trail-btn" aria-label="Draw the map smaller" title="Smaller (-)" disabled={zoom === ZOOMS.at(-1)} onClick={() => zoomBy(-1)}>−</button>
              <output aria-label="Size">{Math.round(zoom * 100)}%</output>
              <button type="button" className="trail-btn" aria-label="Draw the map bigger" title="Bigger (+)" disabled={zoom === ZOOMS[0]} onClick={() => zoomBy(1)}>+</button>
            </span>
          )}
          {plans.length > 1 && shown && !whole && (
            <select className="trail-pick" aria-label="Which plan" title="Look at another plan" value={shown.expId}
              onChange={(ev) => setPicked(ev.target.value === plans.at(-1)!.expId ? null : ev.target.value)}>
              {plans.toReversed().map((p, i) => <option key={p.expId} value={p.expId}>{clock(p.time)} · {p.task.replace(/\s+/g, " ").slice(0, 60)}{i === 0 ? " (newest)" : ""}</option>)}
            </select>
          )}
          {(whole || plans.length > 1) && (
            <button type="button" className="trail-btn" aria-pressed={whole} title={whole ? "Back to one plan at a time (M)" : "Every plan at once, on one map (M)"} onClick={toggleWhole}>Whole map</button>
          )}
          <button type="button" className="trail-btn" aria-pressed={!!replay} title={replay ? "End the replay and show the plan as it is now (P)" : "Replay: watch the last day's plans fill in again, in about half a minute (P)"} onClick={toggleReplay}>Replay</button>
          <button type="button" className="icon-btn" aria-label="Leave the trail map" title="Back to the page (Esc)" onClick={onClose}><Icon name="x" /></button>
        </div>
      </header>
      {shown && whole ? (
        <>
          <div className="trail-ask">
            <b>{plans.length === 1 ? "The one plan so far" : `All ${plans.length} plans, newest first`}</b>
            <span className="trail-count" role="status">{tally(plans.flatMap((p) => statesOf(p.plan)), " steps")}</span>
          </div>
          <div className="trail-map whole">
            <ol className="trail-all" ref={all} style={{ zoom }} aria-label="Every plan, newest first">
              {plans.toReversed().map((p) => (
                <li key={p.expId} className={cx("trail-branch", p.running && "running")} data-exp={p.expId}>
                  <div className="trail-branch-head">
                    <time dateTime={p.time}>{clock(p.time)}</time>
                    <b title={p.task}>{p.task}</b>
                    <span className="trail-count">{tally(statesOf(p.plan))}</span>
                    <button type="button" className="trail-btn" aria-label={`Just this plan: ${p.task.replace(/\s+/g, " ").slice(0, 60)}`} title="Look at this plan on its own" onClick={() => only(p.expId)}>Just this one</button>
                  </div>
                  <TrailGround plan={p.plan} expId={p.expId} crewId={crewId} onOpen={open} label={`The steps of: ${p.task.replace(/\s+/g, " ").slice(0, 60)}`} tree />
                  <Loose at={p} crewId={crewId} onOpen={open} />
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : shown ? (
        <>
          <div className="trail-ask">
            <b title={shown.task}>{shown.task}</b>
            <span className="trail-count" role="status">{tally(statesOf(shown.plan))}</span>
          </div>
          <div className="trail-map">
            <TrailGround plan={shown.plan} expId={shown.expId} crewId={crewId} onOpen={open} label="The plan's steps" />
            <Loose at={shown} crewId={crewId} onOpen={open} />
          </div>
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
