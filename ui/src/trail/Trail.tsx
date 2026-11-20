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
//
// Or as rings, the way Orbit draws the crew (rings.ts): one centre, each plan a ring round it, the
// first asked innermost, its steps waypoints on the ring with the crew sent on each as moons. The
// runs of one conversation start on one bearing and are joined ring to ring, so a conversation
// reaches further out the longer it went. Tree or rings is yours to pick, and is remembered.
//
// The map moves as the plans do, live or in a replay (styles.css, under reduced motion's "no
// preference"): a plan that joins grows in (a ring opens out from the one inside it and its
// waypoints land round it one by one; a bough grows from the trunk and its steps come out along
// it), the plans already there glide to make room, and one that goes (the day wound back) fades
// where it stood first. Changing how you look at the map (one plan or all, tree or rings, bigger or
// smaller, into or out of a replay) moves nothing: that view is simply there.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { Icon } from "../components/bits.tsx";
import { STEP_MARK, STEP_SAYS } from "../feed/Feed.tsx";
import { stepState, type FeedNode, type PlanNode, type PlanQuest, type StepState } from "../feed/reducer.ts";
import { createFeedStore, useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, clock, cx } from "../format.ts";
import { reelOf, type Reel } from "../orbit/replay.ts";
import { STARS, wrap } from "../orbit/scene.ts";
import { Timeline, type Time } from "../orbit/Timeline.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { motionOK, useLingering } from "../motion.tsx";
import { layoutOf, PAD, STEP_H, STEP_W } from "./layout.ts";
import { DISC, MOON, moonsOf, ringsOf } from "./rings.ts";

// A plan in the feed: the run it belongs to (and the conversation that run is in, if any), and the
// quests of that run that are on none of its steps.
export type Trailhead = { expId: string; thread?: string; task: string; time: string; running: boolean; plan: PlanNode; loose: PlanQuest[] };
export function plansOf(items: FeedNode[]): Trailhead[] {
  const out: Trailhead[] = [];
  for (const x of items) {
    if (x.kind !== "exp") continue;
    const plan = x.nodes.findLast((n): n is PlanNode => n.kind === "plan");
    if (!plan) continue;
    const onStep = new Set(plan.steps.flatMap((st) => st.quests.map((q) => q.node)));
    const loose = x.nodes.flatMap((n) => (n.kind === "quest" && !onStep.has(n.id) ? [{ node: n.id, who: n.who, emoji: n.emoji, status: n.status }] : []));
    out.push({ expId: x.expId, thread: x.thread, task: x.task, time: x.time, running: x.end === null, plan, loose });
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
const brief = (task: string) => task.replace(/\s+/g, " ").slice(0, 60);
// A step, said aloud: "Step 4, not started: I read the diffs. Waits for steps 2 and 3."
const stepSays = (n: number, state: StepState, text: string, after: number[]) =>
  `Step ${n}, ${STEP_SAYS[state].toLowerCase()}: ${text.replace(/\.$/, "")}.${after.length ? ` Waits for step${after.length > 1 ? "s" : ""} ${listed(after)}.` : ""}`;
const pillOf = (state: StepState) => cx("pill", state === "out" ? "live" : state === "done" ? "done" : state === "todo" ? "" : "bad");
// The whole map's tree. BOUGH: how far left of a plan's ground the trunk's middle is (styles.css
// leaves that much room). RISE: how far below its first step a bough leaves the trunk.
const BOUGH = 32, RISE = 44;
const girth = (col: number) => Math.max(2, 4.5 - col * 0.75); // a line's width, by the column it leaves
// How small the whole map can be drawn.
const ZOOMS = [1, 0.8, 0.65, 0.5];
// How the whole map is drawn, and where that's remembered.
type Draw = "tree" | "rings";
const DRAW_KEY = "camp-trail-whole";
// How long a plan that has gone stays on the whole map while it fades (styles.css has the same).
const GO_MS = 260;

// In a replay, when a plan joins a list or goes from it, the ones already there glide to where they
// now sit instead of jumping. list: its rows, each marked with its plan (data-exp). zoom: how big
// the list is drawn. Places are read from the layout, not from the screen, so a row that's still
// gliding is read as where it will end up.
// Have `el` glide to where it now is from (dx, dy) back, in its own px; or, if an earlier glide of
// it is still going, from wherever that had got it to.
const gliding = new WeakMap<HTMLElement, Animation>();
function glideFrom(el: HTMLElement, dx: number, dy: number) {
  if (typeof el.animate !== "function") return;
  const going = gliding.get(el);
  if (going?.playState === "running") {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    dx += m.m41; dy += m.m42;
    going.cancel();
  }
  gliding.set(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)" }));
}

// foot: the list stands on its last row (the tree, which grows upward), so a row has moved when it's
// a different height above that, not when rows joining overhead have pushed the list's top up.
function useSettle(list: RefObject<HTMLElement | null>, zoom = 1, foot = false) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const now = new Map<string, number>(), was = tops.current;
    if (list.current && motionOK()) {
      const rows = (Array.from(list.current.children) as HTMLElement[]).filter((row) => row.dataset.exp && row.offsetHeight);
      const last = rows.at(-1), ground = foot && last ? last.offsetTop + last.offsetHeight : 0;
      for (const row of rows) {
        const id = row.dataset.exp!;
        // (Browsers differ on whether offsetTop counts the zoom: the row's own two heights say which.)
        const top = ((row.offsetTop - ground) * row.getBoundingClientRect().height) / row.offsetHeight / zoom, from = was.get(id);
        now.set(id, top);
        if (from !== undefined && Math.abs(from - top) > 1) glideFrom(row, 0, from - top);
      }
    }
    tops.current = now;
  });
}

// The same for the one thing a box holds in its middle, as the ring map is: it grows as rings join,
// and once it's bigger than its box its middle moves, and every ring with it.
function useMiddle(el: RefObject<HTMLElement | null>, zoom: number) {
  const at = useRef<{ x: number; y: number; zoom: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const it = el.current, box = it?.parentElement, was = at.current;
    at.current = null;
    if (!it || !box || !it.offsetHeight || !motionOK()) return;
    const k = it.getBoundingClientRect().height / it.offsetHeight / zoom; // (as above)
    const now = at.current = { x: (it.offsetLeft + it.offsetWidth / 2) * k, y: (it.offsetTop + it.offsetHeight / 2) * k, zoom, w: box.clientWidth, h: box.clientHeight };
    // Not when the zoom or the box itself has changed: then it hasn't moved, the room has.
    if (was && was.zoom === zoom && was.w === now.w && was.h === now.h && Math.hypot(was.x - now.x, was.y - now.y) > 1) glideFrom(it, was.x - now.x, was.y - now.y);
  });
}

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
          return <path key={s.n} className="trail-bough" pathLength={1} d={`M${-BOUGH} ${knot}C${-BOUGH + 12} ${knot - (knot - y) * 0.7} ${PAD - 36} ${y} ${PAD} ${y}`} />;
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
          return (
            <li key={spot.n} className={cx("trail-step", state)} data-n={spot.n} data-col={spot.col} data-row={spot.row} data-state={state} tabIndex={0}
              style={{ left: spot.x, top: spot.y, "--col": spot.col } as CSSProperties} aria-label={stepSays(spot.n, state, step.text, spot.after)}>
              <div className="trail-step-head">
                <span className="trail-n">{spot.n}</span>
                <span className={pillOf(state)}><i aria-hidden="true">{STEP_MARK[state]}</i> {STEP_SAYS[state]}</span>
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

// One of the crew on a step, on the rings: a moon by its waypoint, in their own colour, and (where
// there's somewhere to go) a button to their quest. at: where it sits, from the waypoint's middle.
function Moon({ q, at, ended, expId, crewId, onOpen }: { q: PlanQuest; at: { dx: number; dy: number }; ended?: string; expId: string; crewId: CrewId; onOpen?: Open }) {
  const state = questState(q, ended), id = crewId(q.who);
  const cls = cx("trail-moon", cClass(id) || cClass(q.who), `q-${state}`), style = { left: `calc(50% + ${at.dx}px)`, top: `calc(50% + ${at.dy}px)` };
  const inner = <><span aria-hidden="true">{q.emoji}</span><i aria-hidden="true">{STEP_MARK[state]}</i></>;
  if (!onOpen) return <span className={cls} style={style} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}`}>{inner}<span className="sr-only">{q.who}, {QUEST_SAYS[state]}</span></span>;
  return (
    <button type="button" className={cls} style={style} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}. Go to this quest`} aria-label={`${q.who}, ${QUEST_SAYS[state]}: go to this quest`}
      onClick={() => onOpen(expId, q.node)}>{inner}</button>
  );
}

// The whole map as rings. Down the side, every plan by name (newest first), with what a ring is too
// small to say: when it was asked, how it stands, the quests sent without a step, and the way back
// to that plan on its own. Beside it the rings themselves, and under them what the waypoint you're
// pointing at (or have tabbed to) says in full. sky: the drawing, for the map to be fitted to the window.
// going: the plans that have just gone, still drawn while they fade. The plans by name, and the
// map itself, glide to make room when one joins or goes.
// How far each sheet of stars drifts for a pixel the rings are scrolled: Orbit's depths, made big enough to be felt.
const STAR_DRIFT = 2.4;

function TrailRings({ plans, going, crewId, openIn, onOnly, zoom, sky }: {
  plans: Trailhead[]; going: Set<string>; crewId: CrewId; openIn: (p: Trailhead) => Open | undefined; onOnly: (expId: string) => void; zoom: number; sky: RefObject<HTMLDivElement | null>;
}) {
  const runs = useRef<HTMLOListElement>(null), stars = useRef<(HTMLDivElement | null)[]>([]);
  useSettle(runs);
  useMiddle(sky, zoom);
  const drift = (box: HTMLElement) => STARS.forEach(([tile, depth], j) => {
    const el = stars.current[j];
    if (el) el.style.transform = `translate3d(${wrap(-box.scrollLeft * depth * STAR_DRIFT, tile).toFixed(1)}px, ${wrap(-box.scrollTop * depth * STAR_DRIFT, tile).toFixed(1)}px, 0)`;
  });
  // Laid out again only when a plan's shape changes or one joins, not each time a quest moves.
  const shape = JSON.stringify(plans.map((p) => [p.expId, p.thread, p.plan.steps.map((s) => [s.n, s.after])]));
  const map = useMemo(() => ringsOf(plans.map((p) => ({ expId: p.expId, thread: p.thread, steps: p.plan.steps }))), [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hot, setHot] = useState<{ expId: string; n?: number } | null>(null); // the plan (and step) under the pointer or the keyboard
  const by = new Map(plans.map((p) => [p.expId, p])), ringNo = new Map(map.rings.map((x) => [x.expId, x.ring]));
  const over = (expId: string, n?: number) => ({ onMouseEnter: () => setHot({ expId, n }), onMouseLeave: () => setHot(null), onFocus: () => setHot({ expId, n }), onBlur: () => setHot(null) });
  const hotPlan = hot && by.get(hot.expId), hotStep = hotPlan?.plan.steps.find((s) => s.n === hot?.n);
  const hotState = hotPlan && hotStep ? stepState(hotStep, hotPlan.plan.ended) : undefined;
  const { c, size } = map, far = c - 14; // far: the rim
  return (
    <div className="trail-map whole rings">
      <ol className="trail-runs" ref={runs} aria-label="Every plan, newest first">
        {map.rings.toReversed().map((ring) => {
          const p = by.get(ring.expId);
          if (!p) return null;
          return (
            <li key={p.expId} className={cx("trail-run", p.running && "running", hot?.expId === p.expId && "hot", going.has(p.expId) && "leaving")} data-exp={p.expId} data-ring={ring.ring}
              inert={going.has(p.expId) || undefined} {...over(p.expId)}>
              <div className="trail-run-head">
                <span className="trail-ring-no"><span className="sr-only">Ring </span>{ring.ring}</span>
                <time dateTime={p.time}>{clock(p.time)}</time>
                <b title={p.task}>{p.task}</b>
              </div>
              <div className="trail-run-foot">
                <span className="trail-count">{tally(statesOf(p.plan))}</span>
                {ring.follows && <span className="trail-follows">Follows ring {ringNo.get(ring.follows)}</span>}
                <button type="button" className="trail-btn" aria-label={`Just this plan: ${brief(p.task)}`} title="Look at this plan on its own" onClick={() => onOnly(p.expId)}>Just this one</button>
              </div>
              <Loose at={p} crewId={crewId} onOpen={openIn(p)} />
            </li>
          );
        })}
      </ol>
      <div className="trail-sky-side">
        <div className="trail-sky-well">
          {/* Orbit's night sky behind the rings: its three sheets of stars, drifting as you scroll round the map, the nearer ones further. */}
          <div className="trail-stars" aria-hidden="true">
            {STARS.map((_, j) => <div key={j} className={`orb-stars s${j + 1}`} ref={(el) => { stars.current[j] = el; }} />)}
          </div>
          <div className="trail-sky-box" onScroll={(e) => drift(e.currentTarget)}>
            <div className="trail-sky" ref={sky} style={{ width: size, height: size, zoom, "--disc": `${DISC}px`, "--moon": `${MOON}px` } as CSSProperties}>
              <svg className="trail-lines" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                {/* The instrument behind it all, as in Orbit: bearings, and a rim with its ticks. */}
                {[0, 30, 60, 90, 120, 150].map((a) => <line key={a} className="trail-bearing" x1={c - far} y1={c} x2={c + far} y2={c} transform={`rotate(${a} ${c} ${c})`} />)}
                <circle className="trail-rim" cx={c} cy={c} r={far} />
                <circle className="trail-ticks" cx={c} cy={c} r={far - 3} pathLength={360} strokeDasharray="0.4 4.6" />
                <circle className="trail-ticks long" cx={c} cy={c} r={far - 5} pathLength={360} strokeDasharray="0.5 29.5" />
                {/* The sun: the Quartermaster, whose plans these are. */}
                <circle className="trail-sun-dial" cx={c} cy={c} r={31} strokeDasharray="14 5 2 5" />
                <circle className="trail-sun-dial inner" cx={c} cy={c} r={23} strokeDasharray="2 4.5" />
                <circle className="trail-sun" cx={c} cy={c} r={14} />
                {map.links.map((l) => <path key={l.to} className={cx("trail-link", hot && (hot.expId === l.from || hot.expId === l.to) && "hot", (going.has(l.from) || going.has(l.to)) && "leaving")} data-join={`${l.from}>${l.to}`} d={l.d} />)}
                {map.rings.map((ring) => {
                  const p = by.get(ring.expId);
                  if (!p) return null;
                  const state = new Map(p.plan.steps.map((s) => [s.n, stepState(s, p.plan.ended)]));
                  return (
                    <g key={ring.expId} className={cx("trail-ring", p.running && "running", hot?.expId === ring.expId && "hot", going.has(ring.expId) && "leaving")} data-exp={ring.expId}>
                      <circle className="trail-orbit" cx={c} cy={c} r={ring.r} />
                      {ring.edges.map((e) => (
                        <g key={`${e.from}-${e.to}`} data-line={`${e.from}-${e.to}`} data-lane={e.lane} className={cx("trail-edge", state.get(e.from) === "done" && "walked", state.get(e.from) === "done" && state.get(e.to) === "out" && "live")}>
                          <path d={e.d} /><path className="tip" d={e.tip} />
                        </g>
                      ))}
                    </g>
                  );
                })}
              </svg>
              <ol className="trail-ring-list" aria-label="Every plan as a ring, the first asked innermost">
                {map.rings.map((ring) => {
                  const p = by.get(ring.expId);
                  if (!p) return null;
                  const stepOf = new Map(p.plan.steps.map((s) => [s.n, s]));
                  return (
                    <li key={ring.expId} className={cx("trail-ring-run", p.running && "running", hot?.expId === ring.expId && "hot", going.has(ring.expId) && "leaving")} data-exp={ring.expId}
                      inert={going.has(ring.expId) || undefined}>
                      <span className="trail-ring-no" style={{ left: ring.gate.x, top: ring.gate.y }} aria-hidden="true">{ring.ring}</span>
                      {ring.ways.length === 0 ? <span className="sr-only">Ring {ring.ring}, no steps: {brief(p.task)}</span> : (
                        <ol className="trail-ways" aria-label={`Ring ${ring.ring}, the steps of: ${brief(p.task)}`}>
                          {ring.ways.map((w) => {
                            const step = stepOf.get(w.n)!, state = stepState(step, p.plan.ended), moons = moonsOf(w.a, step.quests.length);
                            return (
                              <li key={w.n} className={cx("trail-way", state)} data-n={w.n} data-slot={w.slot} data-state={state} tabIndex={0} style={{ left: w.x, top: w.y, "--slot": w.slot } as CSSProperties}
                                title={`${w.n}. ${step.text}`} aria-label={stepSays(w.n, state, step.text, w.after)} {...over(ring.expId, w.n)}>
                                <b>{w.n}</b>{state !== "todo" && <i aria-hidden="true">{STEP_MARK[state]}</i>}
                                {step.quests.map((q, i) => <Moon key={q.node} q={q} at={moons[i]} ended={p.plan.ended} expId={ring.expId} crewId={crewId} onOpen={openIn(p)} />)}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
        {/* What's under the pointer or the keyboard, in full. Not read out: the waypoint itself says all of it. */}
        <p className="trail-readout" aria-hidden="true">
          {hotPlan && hotStep && hotState ? (
            <><b>Ring {ringNo.get(hotPlan.expId)} · Step {hotStep.n}</b><span className={pillOf(hotState)}><i>{STEP_MARK[hotState]}</i> {STEP_SAYS[hotState]}</span>
              <span className="trail-readout-text">{hotStep.text}</span>
              <span className="trail-readout-who">{hotStep.quests.length ? [...new Set(hotStep.quests.map((q) => `${q.emoji} ${q.who}`))].join(", ") : hotState === "todo" ? "Nobody sent yet" : "The Quartermaster's own"}</span></>
          ) : hotPlan ? (
            <><b>Ring {ringNo.get(hotPlan.expId)}</b><span className="trail-readout-text">{hotPlan.task}</span><span className="trail-readout-who">{tally(statesOf(hotPlan.plan))}</span></>
          ) : <span className="trail-readout-text hint">Each ring is a plan, the first asked innermost. Point at a waypoint, or Tab to one, to read its step.</span>}
        </p>
      </div>
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
  const [draw, setDraw] = useState<Draw>(() => (storeGet(DRAW_KEY) === "tree" ? "tree" : "rings")); // how the whole map is drawn
  const root = useRef<HTMLDivElement>(null), all = useRef<HTMLOListElement>(null), sky = useRef<HTMLDivElement>(null);
  const byHand = useRef(false), fitted = useRef(""), grew = useRef(false); // the size: yours? fitted for which view? just refitted as a plan joined?
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  const feed = replay?.store ?? store;
  const items = useFeed(feed, (s) => s.items);
  // The page's own feed holds only the newest stretch of events, so on a busy day the morning's
  // plans have scrolled out of it. The day's are fetched as the map opens (the same day a replay
  // plays, read the same way) and stand before the page's own. Where both have a plan the page's
  // is drawn: it's the one still hearing what happens.
  const [day, setDay] = useState<Trailhead[]>([]);
  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const earlier = createFeedStore();
        for (const e of reelOf((await api<{ events: CampEvent[] }>("/api/feed/day")).events).events) earlier.apply(e);
        if (!gone) setDay(plansOf(earlier.getState().items));
      } catch { /* the map shows what the page has */ }
    })();
    return () => { gone = true; };
  }, []);
  const [plans, old] = useMemo(() => {
    const here = plansOf(items), have = new Set(here.map((p) => p.expId));
    const before = replay ? [] : day.filter((p) => !have.has(p.expId));
    return [before.length ? [...before, ...here] : here, new Set(before.map((p) => p.expId))] as const;
  }, [items, day, replay]);
  const shown = plans.find((p) => p.expId === picked) ?? plans.at(-1);
  // On the whole map, a plan that goes (the day wound back, in a replay) is drawn while it fades.
  // Not across the change from today to a replay or back: those are different days' plans.
  const lingering = useLingering(plans, (p) => p.expId, feed, GO_MS);
  const drawn = lingering.map((x) => x.item), going = new Set(lingering.filter((x) => x.leaving).map((x) => x.item.expId));
  useSettle(all, zoom, true);
  // The tree stands on the foot of the window and opens there, at the day's first plans. When a new
  // plan joins at its tip, the map climbs to it.
  const tip = plans.at(-1)?.expId, tipWas = useRef<{ feed: FeedStore; tip?: string } | null>(null);
  useEffect(() => {
    const was = tipWas.current;
    tipWas.current = { feed, tip };
    if (!whole || draw !== "tree" || !tip || !was || was.feed !== feed || was.tip === tip) return;
    const list = all.current, box = list?.parentElement, row = (Array.from(list?.children ?? []) as HTMLElement[]).find((r) => r.dataset.exp === tip);
    if (!list || !box || !row) return;
    // (Moved at once and then glided from where it was: the browser's own smooth scroll is dropped
    // when the map is redrawn under it, as it is all through a replay.)
    const x = box.scrollLeft, y = box.scrollTop;
    row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const dx = box.scrollLeft - x, dy = box.scrollTop - y;
    if ((dx || dy) && motionOK()) glideFrom(list, dx / zoom, dy / zoom);
  }, [tip, feed, whole, draw, zoom]);
  // The map moves when the plans do, not when you change how you're looking at them: whatever a
  // new view would play as it's first drawn (this one included, as the map opens) is skipped to
  // its end. The map's own fade as it opens is left to play, and so is anything that never ends.
  useLayoutEffect(() => {
    const el = root.current;
    if (grew.current) { grew.current = false; return; } // (resized because a plan joined: that's the plans moving)
    if (typeof el?.getAnimations !== "function") return;
    for (const a of el.getAnimations({ subtree: true })) {
      const fx = a.effect;
      if (fx instanceof KeyframeEffect && fx.target !== el && Number.isFinite(fx.getComputedTiming().endTime as number)) a.finish();
    }
  }, [whole, draw, zoom, picked, feed]);

  const crew = S?.characters;
  const crewId = useCallback((who: string) => crew?.find((c) => c.name === who)?.id, [crew]);
  const live = !replay;
  // A quest opens on the page underneath, so only where the page has it: not in a replay, and not
  // in a plan from earlier in the day than the page's feed goes back.
  const opens = useMemo<Open | undefined>(() => (live && onOpenQuest ? (expId, node) => onOpenQuest({ expId, node }) : undefined), [live, onOpenQuest]);
  const openIn = (p: Trailhead) => (old.has(p.expId) ? undefined : opens);

  // The whole map is drawn as big as it can be with all of it in sight; failing that, with its width
  // in sight (it scrolls down); failing that, as small as it goes. It's fitted again whenever a plan
  // joins or goes, so a map that grew a plan at a time (a replay, or the day arriving) ends the size
  // it would have opened at. Once you've set the size yourself it's yours, until the map is opened
  // or redrawn afresh.
  const toggleWhole = () => { byHand.current = false; setZoom(1); setWhole((on) => !on); };
  useLayoutEffect(() => {
    const list = draw === "rings" ? sky.current : all.current, box = list?.parentElement;
    const view = `${whole} ${draw}`, same = fitted.current === view;
    fitted.current = view;
    if (!whole || byHand.current || !list || !box?.clientWidth) return;
    const pad = getComputedStyle(box), px = (v: string) => parseFloat(v) || 0;
    const wide = box.clientWidth - px(pad.paddingLeft) - px(pad.paddingRight), tall = box.clientHeight - px(pad.paddingTop) - px(pad.paddingBottom);
    // (Measured at full size, whatever size it's drawn at now.)
    const drawnAt = list.style.zoom;
    list.style.zoom = "1";
    const w = list.scrollWidth, h = list.scrollHeight;
    list.style.zoom = drawnAt;
    const fits = (z: number, down: boolean) => w * z <= wide && (!down || h * z <= tall);
    const best = ZOOMS.find((z) => fits(z, true)) ?? ZOOMS.find((z) => fits(z, false)) ?? ZOOMS.at(-1)!;
    if (same && best !== zoom) grew.current = true;
    setZoom(best);
  }, [whole, draw, drawn.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tree or rings: remembered for next time, and fitted to the window afresh.
  const drawAs = (d: Draw) => { if (d === draw) return; byHand.current = false; setZoom(1); setDraw(d); storeSet(DRAW_KEY, d); };
  const zoomBy = (d: 1 | -1) => { byHand.current = true; setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) - d))]); };
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
    else if (whole && (ev.key === "r" || ev.key === "R")) drawAs(draw === "rings" ? "tree" : "rings");
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
          {whole && (
            <span className="trail-draw" role="group" aria-label="How the whole map is drawn">
              <button type="button" className="trail-btn" aria-pressed={draw === "tree"} title="As a tree: the day is the trunk, each plan a bough (R)" onClick={() => drawAs("tree")}>Tree</button>
              <button type="button" className="trail-btn" aria-pressed={draw === "rings"} title="As rings: each plan a ring, the first asked innermost (R)" onClick={() => drawAs("rings")}>Rings</button>
            </span>
          )}
          {plans.length > 1 && shown && !whole && (
            <select className="trail-pick" aria-label="Which plan" title="Look at another plan" value={shown.expId}
              onChange={(ev) => setPicked(ev.target.value === plans.at(-1)!.expId ? null : ev.target.value)}>
              {plans.toReversed().map((p, i) => <option key={p.expId} value={p.expId}>{clock(p.time)} · {brief(p.task)}{i === 0 ? " (newest)" : ""}</option>)}
            </select>
          )}
          {(whole || plans.length > 1) && (
            <button type="button" className="trail-btn" aria-pressed={whole} title={whole ? "Back to one plan at a time (M)" : "Every plan at once, on one map (M)"} onClick={toggleWhole}>Whole map</button>
          )}
          <button type="button" className="trail-btn" aria-pressed={!!replay} title={replay ? "End the replay and show the plan as it is now (P)" : "Replay: watch the last day's plans fill in again, in about half a minute (P)"} onClick={toggleReplay}>Replay</button>
          <button type="button" className="icon-btn" aria-label="Leave the trail map" title="Back to the page (Esc)" onClick={onClose}><Icon name="x" /></button>
        </div>
      </header>
      {whole && drawn.length ? (
        <>
          <div className="trail-ask">
            <b>{plans.length === 0 ? "No plan at this point in the day" : plans.length === 1 ? "The one plan so far" : draw === "rings" ? `All ${plans.length} plans, a ring each: the first asked innermost` : `All ${plans.length} plans, newest first`}</b>
            <span className="trail-count" role="status">{tally(plans.flatMap((p) => statesOf(p.plan)), " steps")}</span>
          </div>
          {draw === "rings" ? <TrailRings plans={drawn} going={going} crewId={crewId} openIn={openIn} onOnly={only} zoom={zoom} sky={sky} /> : (
          <div className="trail-map whole">
            <ol className="trail-all" ref={all} style={{ zoom }} aria-label="Every plan, newest first">
              {drawn.toReversed().map((p) => (
                <li key={p.expId} className={cx("trail-branch", p.running && "running", going.has(p.expId) && "leaving")} data-exp={p.expId} inert={going.has(p.expId) || undefined}>
                  <div className="trail-branch-head">
                    <time dateTime={p.time}>{clock(p.time)}</time>
                    <b title={p.task}>{p.task}</b>
                    <span className="trail-count">{tally(statesOf(p.plan))}</span>
                    <button type="button" className="trail-btn" aria-label={`Just this plan: ${brief(p.task)}`} title="Look at this plan on its own" onClick={() => only(p.expId)}>Just this one</button>
                  </div>
                  <TrailGround plan={p.plan} expId={p.expId} crewId={crewId} onOpen={openIn(p)} label={`The steps of: ${brief(p.task)}`} tree />
                  <Loose at={p} crewId={crewId} onOpen={openIn(p)} />
                </li>
              ))}
            </ol>
          </div>
          )}
        </>
      ) : shown ? (
        <>
          <div className="trail-ask">
            <b title={shown.task}>{shown.task}</b>
            <span className="trail-count" role="status">{tally(statesOf(shown.plan))}</span>
          </div>
          <div className="trail-map">
            <TrailGround key={shown.expId} plan={shown.plan} expId={shown.expId} crewId={crewId} onOpen={openIn(shown)} label="The plan's steps" />
            <Loose at={shown} crewId={crewId} onOpen={openIn(shown)} />
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
