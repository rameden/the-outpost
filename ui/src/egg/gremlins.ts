// Barnstorm's other side: the gremlins, drawn as little dwarf builders (hard hat, beard and
// tools). They scurry in from the edges of the window, each one heads for the nearest thing the
// plane has shot, works at it for a moment with the right tool for the job, and it's back.
// The more of the page is down, the more of them turn out, so it's a race: the plane to
// flatten the camp, the builders to put it up again. When there's nothing left to mend they
// pack up and walk off the page, whistling (and turn back if something else goes down).
//
// One in three is ladder crew: it carries a ladder everywhere under its arm, and for every job
// stands it up, climbs it a rung at a time, does the work from the top and climbs down again
// (which takes longer, and it doesn't care). A whole panel wants a ladder whoever's on it. And
// they have opinions about the plane, which they shout (QUOTES, at the bottom).
//
// A builder can be shot too (flight.ts has what that's worth), and what it was mending stays
// down for another to find. A shot that only just misses makes it duck for a moment, so
// keeping their heads down is worth something as well.
//
// Only arithmetic here, as in flight.ts: what a gremlin mends comes through `Site`, which the
// page (targets.ts) answers for the game and a few lines of test answer for the tests.

import type { Kind, Sky } from "./flight.ts";

export type Box = { left: number; top: number; width: number; height: number };
export type Job = { kind: Kind; claimed: boolean; mended: boolean };
export interface Site<J extends Job = Job> {
  pick(x: number, y: number): J | null; // the nearest wreck nobody's on, claimed for the asker
  where(job: J): Box | null; // where it is now, or null if it's gone from the page
  mend(job: J): Box | null; // put it back
}

export type Gremlin<J extends Job = Job> = {
  x: number; y: number; speed: number; facing: 1 | -1;
  // idle: looking for work; walk: on its way to a job; fix: at it; leave: off home, nothing left to do
  state: "idle" | "walk" | "fix" | "leave";
  job: J | null; tx: number; ty: number;
  timer: number; // with no job: until it next looks for one; fix: until the job's done
  glance: number; // until it next checks where its job has got to (the page scrolls)
  bored: number; // how long it's had nothing to do
  duck: number; // seconds left with its head down (a shot just missed it)
  nerve: number; // seconds until a near miss can make it duck again (it can't be pinned down for good)
  hop: number; // seconds left of the little jump it does when a job's done
  gone: boolean; // it has walked off the page
  ladder: boolean; // ladder crew: never without it
  total: number; // how long the job it's on takes in all (timer counts down from this)
  clock: number; // for its legs and its tools
};

export const CREW_MAX = 10;
// How many gremlins turn out for this much wreckage: one for the first piece, another for every six after.
export const crewFor = (wrecked: number) => Math.min(CREW_MAX, Math.ceil(wrecked / 6));
export const SPAWN_EVERY = 0.9; // seconds between gremlins arriving
export const HEAD_START = 1.5; // seconds the plane gets before the first one shows up
export const MEND_TIME: Record<Kind, number> = { word: 0.45, edge: 0.6, part: 0.8, shell: 0.9 };
export const LADDER_TIME = 0.9; // …and this much more wherever a ladder's involved (up it, and down again)
export const LADDER_CREW = 1 / 3; // of the builders carry one
export const LADDER_TOP = 5; // rungs up (rows of its own pixels) it works from
export const REACH = 8; // how close to its job's middle a gremlin works from
export const MEND_BATCH = 4; // how many things it puts right in one visit: the job, and what's down around it
export const MEND_REACH = 90; // …within this far of where it's standing, px
export const GREMLIN_RADIUS = 13; // how near a bullet has to pass to hit one
export const NEAR_MISS = 44; // …and how near to make it duck
export const DUCK = 0.45; // seconds it keeps its head down
export const NERVE = 2; // seconds from one duck before the next can start
export const HOP = 0.3; // seconds of the jump after a job
export const PATIENCE = 1.5; // seconds with nothing to do before it goes home
const OFF = 30; // how far past the window's edge is "off the page"

// The right tool for each job: letters are painted back on, an edge is sawn to length, and a
// part or a whole panel is hammered in.
export type Tool = "brush" | "saw" | "hammer";
export const TOOL: Record<Kind, Tool> = { word: "brush", edge: "saw", part: "hammer", shell: "hammer" };
// Does this job get done from a ladder? Every job does for ladder crew, and a whole panel does for anyone.
export const onLadder = (g: Pick<Gremlin, "ladder" | "job">) => g.ladder || g.job?.kind === "shell";
export const mendTime = (kind: Kind, ladder: boolean) => MEND_TIME[kind] + (ladder || kind === "shell" ? LADDER_TIME : 0);

// Where a job done from a ladder has got to: the ladder swung upright (lean 1 → 0), then up
// it a rung at a time, the work itself at the top, and down again.
export function ladderPhase(g: Pick<Gremlin, "timer" | "total">): { lean: number; rung: number; working: boolean } {
  const p = g.total > 0 ? 1 - Math.max(0, g.timer) / g.total : 1;
  if (p < 0.15) return { lean: 1 - p / 0.15, rung: 0, working: false };
  if (p < 0.35) return { lean: 0, rung: Math.round((LADDER_TOP * (p - 0.15)) / 0.2), working: false };
  if (p < 0.85) return { lean: 0, rung: LADDER_TOP, working: true };
  return { lean: 0, rung: Math.round((LADDER_TOP * (1 - p)) / 0.15), working: false };
}

// A new gremlin, just inside one of the four edges of the window.
export function newGremlin<J extends Job = Job>(sky: Sky, rand: () => number = Math.random): Gremlin<J> {
  const edge = Math.floor(rand() * 4), along = rand();
  const x = edge === 0 ? 4 : edge === 1 ? sky.width - 4 : along * sky.width;
  const y = edge === 2 ? 4 : edge === 3 ? sky.height - 4 : along * sky.height;
  return {
    x, y, speed: 170 + rand() * 60, facing: x > sky.width / 2 ? -1 : 1, state: "idle", job: null, tx: x, ty: y,
    timer: 0, glance: 0, bored: 0, duck: 0, nerve: 0, hop: 0, gone: false, clock: rand(),
    ladder: rand() >= 1 - LADDER_CREW, total: 0,
  };
}

// Let go of what it was on (it's been shot, or the game was reset): another gremlin can take it.
export function dropJob(g: Gremlin) {
  if (g.job) g.job.claimed = false;
  g.job = null;
  g.state = "idle";
}

// A shot has just missed it: head down, unless it has only just come up from the last one.
// Answers whether it ducked.
export function startle(g: Gremlin): boolean {
  if (g.nerve > 0) return false;
  g.duck = DUCK;
  g.nerve = NERVE;
  return true;
}

// The way out: straight to whichever edge of the window is nearest, and a little past it.
function wayOut(g: Gremlin, sky: Sky) {
  const to = [g.x, sky.width - g.x, g.y, sky.height - g.y];
  const nearest = to.indexOf(Math.min(...to));
  g.tx = nearest === 0 ? -OFF : nearest === 1 ? sky.width + OFF : g.x;
  g.ty = nearest === 2 ? -OFF : nearest === 3 ? sky.height + OFF : g.y;
}

function walk(g: Gremlin, dt: number): number {
  const dx = g.tx - g.x, dy = g.ty - g.y, far = Math.hypot(dx, dy);
  if (far > 0) {
    const go = Math.min(far, g.speed * dt);
    g.x += (dx / far) * go; g.y += (dy / far) * go;
    if (Math.abs(dx) > 1) g.facing = dx > 0 ? 1 : -1;
  }
  return Math.hypot(g.tx - g.x, g.ty - g.y);
}

// One moment of a gremlin's day. Answers the boxes of whatever it has just mended (mostly nothing).
export function stepGremlin<J extends Job>(g: Gremlin<J>, dt: number, site: Site<J>, sky: Sky): Box[] {
  g.clock += dt;
  if (g.hop > 0) g.hop -= dt;
  if (g.nerve > 0) g.nerve -= dt;
  if (g.duck > 0) { g.duck -= dt; return []; } // head down: nothing gets done
  if (g.job?.mended) { g.job = null; g.state = "idle"; } // put back some other way (a reset)
  if (!g.job) {
    // Nothing on: look for work every so often, and after a while of none, head for home
    // (still looking on the way, in case something else goes down).
    if (g.state !== "leave") g.state = "idle";
    g.bored += dt;
    g.timer -= dt;
    if (g.timer <= 0) {
      g.timer = 0.3;
      g.job = site.pick(g.x, g.y);
    }
    if (g.job) { g.state = "walk"; g.glance = 0; g.bored = 0; }
    else {
      if (g.state === "idle" && g.bored >= PATIENCE) { g.state = "leave"; wayOut(g, sky); }
      if (g.state === "leave" && walk(g, dt) < 0.5) g.gone = true;
      return [];
    }
  }
  g.glance -= dt;
  if (g.glance <= 0) {
    g.glance = 0.25;
    const box = site.where(g.job);
    if (!box) { dropJob(g); return []; }
    g.tx = Math.max(10, Math.min(sky.width - 10, box.left + box.width / 2));
    g.ty = Math.max(10, Math.min(sky.height - 10, box.top + box.height / 2));
  }
  if (g.state === "walk") {
    if (Math.hypot(g.tx - g.x, g.ty - g.y) <= REACH) { g.state = "fix"; g.timer = g.total = mendTime(g.job.kind, g.ladder); }
    else walk(g, dt);
    return [];
  }
  g.timer -= dt;
  if (g.timer > 0) return [];
  const done = g.job;
  g.job = null; g.state = "idle"; g.timer = 0.15; g.hop = HOP; // a little jump: job done
  const mended: Box[] = [];
  const first = site.mend(done);
  if (first) mended.push(first);
  // While it's there, whatever else is down within arm's reach goes back with it: a builder
  // puts right a few things a visit, not one.
  for (let i = 1; i < MEND_BATCH; i++) {
    const more = site.pick(g.x, g.y);
    if (!more) break;
    const at = site.where(more);
    if (!at || Math.hypot(at.left + at.width / 2 - g.x, at.top + at.height / 2 - g.y) > MEND_REACH) { more.claimed = false; break; }
    const box = site.mend(more);
    if (box) mended.push(box);
  }
  return mended;
}

// ---------- A gremlin, a pixel at a time ----------
// A dwarf builder: a yellow hard hat, a big ginger beard down over a blue tunic, and boots. Two
// frames for its legs, and one with its head down. Letters are colours in GREMLIN_PAINT; a dot is nothing.
const BODY = [
  "...HHH...",
  "..HHHHH..",
  ".DDDDDDD.", // the hat's brim
  "..SKSKS..", // eyes
  ".BBSNSBB.", // nose, and the beard starting either side of it
  ".BBBBBBB.",
  "TTBBBBBTT", // shoulders, behind the beard
  ".TTBBBTT.",
];
export const GREMLIN_FRAMES = [
  [...BODY, "..TT.TT..", ".FF...FF."],
  [...BODY, "...T.T...", "..FF.FF.."],
];
// Ducking: crouched on its boots, hat pulled down over its eyes.
export const GREMLIN_DUCK = ["...HHH...", "..HHHHH..", ".DDDDDDD.", ".BBSNSBB.", ".BBBBBBB.", "TTBBBBBTT", ".FF...FF."];
export const GREMLIN_PAINT: Record<string, string> = {
  H: "#f2c230", D: "#c9971a", S: "#f0b98a", K: "#14181f", N: "#d9866a", B: "#c8641e", T: "#3b6ea8", F: "#4a3220",
};
// What goes over a builder's head: "!" when a shot just missed, a note when it's whistling its way home.
export const BANG = ["X", "X", "X", ".", "X"];
export const NOTE = [".XX", ".X.", ".X.", "XX.", "XX."];

// ---------- What they shout ----------
// A builder with something to say gets a speech bubble for a moment (Barnstorm.tsx decides who
// and when). By what set it off:
export const QUOTES = {
  // the plane has just shot something nearby
  wrecked: [
    "Oi! Stop that!", "We'll never get any work done now!", "I JUST fixed that!", "Do you MIND?", "That was load-bearing!",
    "Who's paying for this?", "Oi! We're working here!", "Every. Single. Time.", "I'm telling the foreman!", "It was level, that was!",
    "This is going on the invoice!", "Not the header!", "You'll have someone's eye out!", "We had it lovely, that."],
  // a shot has just missed it
  miss: ["Mind the beard!", "Oi! Watch it!", "Missed me!", "Not the hat!", "Health and safety!", "I felt that one!"],
  // the builder next to it has just been shot
  mate: ["He owed me a pint!", "Man down!", "That was my cousin!", "He had the good hammer!", "Right, that's overtime.", "Who's doing his shift?"],
  // it has just turned up
  arrive: ["Right, what's broken?", "Who called a builder?", "Stand back. Professionals.", "Not this page again.", "Can't leave you alone, can we?"],
  // it has just finished a job
  done: ["Good as new!", "Sorted.", "Proper job.", "That'll hold. Probably.", "Don't touch it this time."],
  // nothing left to do: it's off
  leave: ["Tea time!", "That'll do.", "Home time, lads.", "Invoice is in the post.", "Back to the pub."],
  // tea break (the power-up)
  tea: ["Ahh, lovely.", "Two sugars.", "Union rules.", "Biscuit?", "Not till I've finished this."],
} as const;
export type QuoteKind = keyof typeof QUOTES;
export const BUBBLE_LASTS = 1.9; // seconds a speech bubble stays up
// How chatty they are: the odds a builder says anything when each of those happens, the quiet
// after one bubble before the next, and how many can be up at once.
export const CHATTER: Record<QuoteKind, number> = { wrecked: 0.12, miss: 0.3, mate: 0.45, arrive: 0.12, done: 0.06, leave: 0.3, tea: 1 };
export const HUSH = 3.5;
export const BUBBLES_MAX = 2;

// A line of that kind, never the same one twice running.
export function pickLine(kind: QuoteKind, not = "", rand: () => number = Math.random): string {
  const lines = QUOTES[kind].filter((l) => l !== not);
  return lines[Math.min(lines.length - 1, Math.floor(rand() * lines.length))];
}
