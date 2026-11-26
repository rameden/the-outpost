// How a plan's step is said and marked, wherever it's shown: the plan card's list (Feed.tsx), its
// trail (trail/Ground.tsx) and the trail map (trail/Trail.tsx).
import { cx } from "../format.ts";
import type { StepState } from "./reducer.ts";

// A step's pill: lit while it is out, ticked when done, plain before it starts, red when it went wrong.
export const stepPill = (state: StepState) => cx("pill", state === "out" ? "live" : state === "done" ? "done" : state === "todo" ? "" : "bad");
export const STEP_SAYS: Record<StepState, string> = { todo: "Not started", out: "Out", done: "Done", failed: "Didn't finish", stopped: "Cut short" };
export const STEP_MARK: Record<StepState, string> = { todo: "○", out: "●", done: "✓", failed: "!", stopped: "–" };
