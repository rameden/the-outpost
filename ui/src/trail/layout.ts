// Where each step of a plan sits on the trail map (Trail.tsx), and the lines between them. Pure:
// (the plan's steps) → a column and a row for each, and a curve for each "this waits for that".
//
// The trail runs left to right. A step's column is one past the furthest column of anything it
// waits for, so a step is always to the right of what it needs; steps that share a column are
// stacked, in the plan's own order, and each column is centred on the tallest one.

import type { PlanStep } from "../feed/reducer.ts";

export const STEP_W = 248, STEP_H = 116, GAP_X = 76, GAP_Y = 22, PAD = 28;

type Step = Pick<PlanStep, "n" | "after">;
export type Spot = { n: number; col: number; row: number; x: number; y: number; after: number[] }; // col, row: from one. after: what it waits for
export type Edge = { from: number; to: number; d: string; tip: string }; // d: the curve. tip: the arrowhead at its end
export type Layout = { spots: Spot[]; edges: Edge[]; cols: number; width: number; height: number };

// What each step waits for. A plan that says nothing about order is a straight trail: each step
// after the one before. One that does say is taken at its word, so a step it marks nothing on can
// start right away. Only steps listed above a step count (so nothing can wait in a circle).
export function waitsOf(steps: Step[]): Map<number, number[]> {
  const marked = steps.some((s) => s.after?.length);
  const waits = new Map<number, number[]>();
  steps.forEach((s, i) => {
    const earlier = new Set(steps.slice(0, i).map((x) => x.n));
    const after = marked ? [...new Set(s.after ?? [])].filter((n) => earlier.has(n)) : i ? [steps[i - 1].n] : [];
    if (!waits.has(s.n)) waits.set(s.n, after);
  });
  return waits;
}

// The lines worth drawing: "3 after 1 and 2", when 2 is itself after 1, is drawn as 1 → 2 → 3.
// The line from 1 to 3 says nothing the other two don't, and would run behind step 2's card.
function direct(waits: Map<number, number[]>): Map<number, number[]> {
  const reach = new Map<number, Set<number>>(); // everything a step waits for, however far back
  for (const [n, after] of waits) reach.set(n, new Set(after.flatMap((a) => [a, ...(reach.get(a) ?? [])])));
  return new Map([...waits].map(([n, after]) => [n, after.filter((a) => !after.some((b) => b !== a && reach.get(b)?.has(a)))]));
}

export function layoutOf(steps: Step[]): Layout {
  const waits = waitsOf(steps), lines = direct(waits);
  const col = new Map<number, number>();
  for (const n of waits.keys()) col.set(n, 1 + Math.max(0, ...waits.get(n)!.map((a) => col.get(a) ?? 0)));
  const cols = Math.max(0, ...col.values());
  const inCol = (c: number) => [...col].filter(([, x]) => x === c).map(([n]) => n);
  const tallest = Math.max(0, ...Array.from({ length: cols }, (_, i) => inCol(i + 1).length));
  const spots: Spot[] = [];
  for (let c = 1; c <= cols; c++) {
    const mine = inCol(c), top = PAD + ((tallest - mine.length) * (STEP_H + GAP_Y)) / 2;
    mine.forEach((n, i) => spots.push({ n, col: c, row: i + 1, x: PAD + (c - 1) * (STEP_W + GAP_X), y: top + i * (STEP_H + GAP_Y), after: waits.get(n)! }));
  }
  const at = new Map(spots.map((s) => [s.n, s]));
  const edges: Edge[] = [];
  for (const [to, after] of lines) for (const from of after) {
    const a = at.get(from)!, b = at.get(to)!, y1 = a.y + STEP_H / 2, y2 = b.y + STEP_H / 2;
    let x = a.x + STEP_W, y = y1, d = `M${x} ${y}`;
    const curveTo = (tx: number, ty: number) => { const bend = (tx - x) / 2; d += `C${x + bend} ${y} ${tx - bend} ${ty} ${tx} ${ty}`; x = tx; y = ty; };
    // A line to a step more than one column on goes between the cards of the columns it passes, not behind
    // them: straight across each column in the gap (above, between or below its cards) nearest its way.
    for (let c = a.col + 1; c < b.col; c++) {
      const cards = spots.filter((s) => s.col === c), straight = y1 + ((y2 - y1) * (c - a.col)) / (b.col - a.col);
      const gaps = [cards[0].y - GAP_Y / 2, ...cards.map((s) => s.y + STEP_H + GAP_Y / 2)];
      curveTo(cards[0].x, gaps.reduce((best, g) => (Math.abs(g - straight) < Math.abs(best - straight) ? g : best)));
      x += STEP_W; d += `L${x} ${y}`;
    }
    curveTo(b.x, y2);
    edges.push({ from, to, d, tip: `M${b.x - 7} ${y2 - 4.5}L${b.x} ${y2}L${b.x - 7} ${y2 + 4.5}` });
  }
  spots.sort((a, b) => steps.findIndex((s) => s.n === a.n) - steps.findIndex((s) => s.n === b.n));
  return {
    spots, edges, cols,
    width: cols ? PAD * 2 + cols * STEP_W + (cols - 1) * GAP_X : 0,
    height: tallest ? PAD * 2 + tallest * STEP_H + (tallest - 1) * GAP_Y : 0,
  };
}
