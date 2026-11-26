// One plan's trail, as a piece any page can draw: its waypoints, the lines between them, and the
// quests that are on none of its steps. The plan card in the feed draws it in place (feed/Feed.tsx)
// and the trail map draws it over the whole page, alone or as a bough of the whole map (Trail.tsx).

import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { stepState, type FeedNode, type PlanNode, type PlanQuest, type StepState } from "../feed/reducer.ts";
import { STEP_MARK, STEP_SAYS, stepPill } from "../feed/steps.ts";
import { cClass, cx, leadName } from "../format.ts";
import { w } from "../words.ts";
import { layoutOf, PAD, STEP_H, STEP_W } from "./layout.ts";

// A plan in the feed: the run it belongs to (and the conversation that run is in, if any), and the
// quests of that run that are on none of its steps.
export type Trailhead = { expId: string; thread?: string; task: string; time: string; running: boolean; plan: PlanNode; loose: PlanQuest[] };
// The quests of a run that are on none of its plan's steps.
export function looseOf(nodes: FeedNode[], plan: PlanNode): PlanQuest[] {
  const onStep = new Set(plan.steps.flatMap((st) => st.quests.map((q) => q.node)));
  return nodes.flatMap((n) => (n.kind === "quest" && !onStep.has(n.id) ? [{ node: n.id, who: n.who, emoji: n.emoji, status: n.status }] : []));
}
export function plansOf(items: FeedNode[]): Trailhead[] {
  const out: Trailhead[] = [];
  for (const x of items) {
    if (x.kind !== "exp") continue;
    const plan = x.nodes.findLast((n): n is PlanNode => n.kind === "plan");
    if (!plan) continue;
    out.push({ expId: x.expId, thread: x.thread, task: x.task, time: x.time, running: x.end === null, plan, loose: looseOf(x.nodes, plan) });
  }
  return out;
}

export const QUEST_SAYS: Record<StepState, string> = { todo: "not started", out: "out now", done: "back, done", failed: "didn't finish", stopped: "cut short" };
export const questState = (q: PlanQuest, ended?: string): StepState => (q.status === null ? (ended ? "stopped" : "out") : q.status === "done" ? "done" : "failed");
export const listed = (ns: number[]) => (ns.length > 1 ? `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}` : String(ns[0]));
export type Open = (expId: string, node: string) => void;
export type CrewId = (who: string) => string | undefined;
// "4 of 6 done · 1 out · 1 didn't finish"
export function tally(states: StepState[], of = "") {
  const count = (st: StepState) => states.filter((x) => x === st).length;
  return `${count("done")} of ${states.length}${of} done${count("out") ? ` · ${count("out")} out` : ""}${count("failed") ? ` · ${count("failed")} didn't finish` : ""}${count("stopped") ? ` · ${count("stopped")} cut short` : ""}`;
}
export const statesOf = (plan: PlanNode) => plan.steps.map((s) => stepState(s, plan.ended));
// A step, said aloud: "Step 4, not started: I read the diffs. Waits for steps 2 and 3."
export const stepSays = (n: number, state: StepState, text: string, after: number[]) =>
  `Step ${n}, ${STEP_SAYS[state].toLowerCase()}: ${text.replace(/\.$/, "")}.${after.length ? ` Waits for step${after.length > 1 ? "s" : ""} ${listed(after)}.` : ""}`;
// The whole map's tree. BOUGH: how far left of a plan's ground the trunk's middle is (styles.css
// leaves that much room). RISE: how far below its first step a bough leaves the trunk.
export const BOUGH = 32, RISE = 44;
const girth = (col: number) => Math.max(2, 4.5 - col * 0.75); // a line's width, by the column it leaves

// One of the crew on a step: one chip a quest, so two quests by the same crew member are two chips,
// each going to its own block in the conversation. crewId: who they are whatever they're called
// (a colour, or anything else about a role, hangs on the id, not on the name shown).
export function Chip({ q, ended, expId, crewId, onOpen }: { q: PlanQuest; ended?: string; expId: string; crewId: CrewId; onOpen?: Open }) {
  const state = questState(q, ended), id = crewId(q.who);
  const cls = cx("trail-chip", cClass(id) || cClass(q.who), `q-${state}`);
  const inner = <><span aria-hidden="true">{q.emoji}</span><b>{q.who}</b><i aria-hidden="true">{STEP_MARK[state]}</i></>;
  if (!onOpen) return <span className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}`}>{inner}<span className="sr-only">, {QUEST_SAYS[state]}</span></span>;
  return (
    <button type="button" className={cls} data-who={id} title={`${q.who}: ${QUEST_SAYS[state]}. Go to this ${w("quest")}`} aria-label={`${q.who}, ${QUEST_SAYS[state]}: go to this ${w("quest")}`}
      onClick={() => onOpen(expId, q.node)}>{inner}</button>
  );
}

// One plan's trail: its waypoints and the lines between them. tree: it's a bough on the whole map,
// so a line grows in from the trunk on the left to each step that waits for nothing.
// inBox: it's drawn in a box of its own on a page that scrolls (the plan card), so only that box is
// scrolled to keep the step that's out in sight, never the page it's on.
export const TrailGround = memo(function TrailGround({ plan, expId, crewId, onOpen, label, tree, inBox }: {
  plan: PlanNode; expId: string; crewId: CrewId; onOpen?: Open; label: string; tree?: boolean; inBox?: boolean;
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
    const step = ground.current?.querySelector<HTMLElement>(`[data-n="${outNow}"]`), box = ground.current?.parentElement;
    // (Nothing is handed back from here: newer browsers answer scrollIntoView with a promise, and an effect may only hand back its own undoing.)
    if (!inBox) { step?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); return; }
    if (!step || !box) return;
    const b = box.getBoundingClientRect(), s = step.getBoundingClientRect(), gap = 12;
    box.scrollLeft += s.left < b.left ? s.left - b.left - gap : s.right > b.right ? s.right - b.right + gap : 0;
    box.scrollTop += s.top < b.top ? s.top - b.top - gap : s.bottom > b.bottom ? s.bottom - b.bottom + gap : 0;
  }, [outNow, plan.id, inBox]);
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
                <span className={stepPill(state)}><i aria-hidden="true">{STEP_MARK[state]}</i> {STEP_SAYS[state]}</span>
              </div>
              <p className="trail-text" title={step.text}>{step.text}</p>
              <div className="trail-crew">
                {step.quests.length
                  ? step.quests.map((q) => <Chip key={q.node} q={q} ended={plan.ended} expId={expId} crewId={crewId} onOpen={onOpen} />)
                  : <span className="trail-nobody">{state === "todo" ? "Nobody sent yet" : `The ${leadName()}'s own`}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
});

// The quests of a run that are on none of its plan's steps.
export function Loose({ at, crewId, onOpen }: { at: Pick<Trailhead, "expId" | "plan" | "loose">; crewId: CrewId; onOpen?: Open }) {
  if (!at.loose.length) return null;
  return (
    <div className="trail-loose" role="group" aria-label={`${w("Quests")} sent without a step`}>
      <span>Off the trail (sent without a step)</span>
      {at.loose.map((q) => <Chip key={q.node} q={q} ended={at.plan.ended} expId={at.expId} crewId={crewId} onOpen={onOpen} />)}
    </div>
  );
}
