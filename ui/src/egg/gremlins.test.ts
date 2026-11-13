// Barnstorm's gremlins: how many turn out, and one's day (find a wreck, walk to it, mend it).
import { expect, test } from "vitest";
import {
  BUBBLES_MAX, CHATTER, CREW_MAX, DUCK, HUSH, LADDER_CREW, LADDER_TIME, LADDER_TOP, MEND_BATCH, MEND_REACH, MEND_TIME, NERVE, PATIENCE, QUOTES, REACH, TOOL,
  crewFor, dropJob, ladderPhase, mendTime, newGremlin, onLadder, pickLine, startle, stepGremlin,
  type Box, type Job, type QuoteKind, type Site,
} from "./gremlins.ts";

const sky = { width: 1000, height: 800 };
type Wreck = Job & { box: Box | null };
const wreck = (left: number, top: number, kind: Job["kind"] = "word"): Wreck => ({ kind, claimed: false, mended: false, box: { left, top, width: 20, height: 10 } });

// A site with these wrecks on it, handing out the nearest unclaimed one.
function siteOf(wrecks: Wreck[]): Site<Wreck> & { mended: Wreck[] } {
  const mended: Wreck[] = [];
  return {
    mended,
    pick(x, y) {
      const free = wrecks.filter((w) => !w.claimed && !w.mended && w.box);
      free.sort((a, b) => Math.hypot(a.box!.left - x, a.box!.top - y) - Math.hypot(b.box!.left - x, b.box!.top - y));
      if (free[0]) free[0].claimed = true;
      return free[0] ?? null;
    },
    where: (w) => (w.mended ? null : w.box),
    mend(w) { w.mended = true; mended.push(w); return w.box; },
  };
}
const run = (g: ReturnType<typeof newGremlin<Wreck>>, site: Site<Wreck>, seconds: number) => {
  const done: Box[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) done.push(...stepGremlin(g, 1 / 60, site, sky));
  return done;
};

test("more wreckage brings more gremlins, up to a full crew", () => {
  expect(crewFor(0)).toBe(0);
  expect(crewFor(1)).toBe(1);
  expect(crewFor(6)).toBe(1);
  expect(crewFor(7)).toBe(2);
  expect(crewFor(5000)).toBe(CREW_MAX);
});

test("a gremlin arrives at an edge of the window", () => {
  for (const r of [0, 0.3, 0.6, 0.9]) {
    const g = newGremlin(sky, () => r);
    expect(g.x <= 4 || g.x >= sky.width - 4 || g.y <= 4 || g.y >= sky.height - 4).toBe(true);
    expect(g.state).toBe("idle");
  }
});

test("a gremlin walks to the nearest wreck, hammers at it, and it's mended", () => {
  const near = wreck(300, 400), far = wreck(900, 100);
  const site = siteOf([far, near]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 100, y: 400 };
  stepGremlin(g, 1 / 60, site, sky);
  expect(g.job).toBe(near);
  expect(near.claimed).toBe(true);
  expect(g.state).toBe("walk");

  // It gets there in about a second (it's 210px off, at 170px a second and up), facing the way it's going.
  run(g, site, 1.3);
  expect(Math.hypot(g.x - 310, g.y - 405)).toBeLessThanOrEqual(REACH);
  expect(g.facing).toBe(1);
  expect(g.state).toBe("fix");
  expect(site.mended).toEqual([]); // not done yet: mending takes a moment

  expect(run(g, site, MEND_TIME.word + 0.1)).toEqual([near.box]);
  expect(site.mended).toEqual([near]);
  // Then straight on to the next one.
  run(g, site, 0.5);
  expect(g.job).toBe(far);
});

test("a whole panel takes longer to put back: it's a ladder job, whoever's on it", () => {
  const shell = wreck(100, 400, "shell");
  const site = siteOf([shell]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 110, y: 405 };
  expect(g.ladder).toBe(false); // not ladder crew, but a panel wants one all the same
  run(g, site, 0.1);
  expect(onLadder(g)).toBe(true);
  expect(mendTime("shell", false)).toBe(MEND_TIME.shell + LADDER_TIME);
  run(g, site, MEND_TIME.shell);
  expect(site.mended).toEqual([]);
  run(g, site, LADDER_TIME + 0.1);
  expect(site.mended).toEqual([shell]);
});

test("ladder crew do everything from the ladder: stand it up, climb, work at the top, climb down", () => {
  // About one builder in three carries one.
  const crew = Array.from({ length: 300 }, (_, i) => newGremlin(sky, () => (i + 0.5) / 300).ladder).filter(Boolean).length;
  expect(crew).toBe(Math.round(300 * LADDER_CREW));

  const word = wreck(100, 400);
  const site = siteOf([word]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 110, y: 405, ladder: true };
  stepGremlin(g, 1 / 60, site, sky);
  stepGremlin(g, 1 / 60, site, sky);
  expect([g.state, onLadder(g)]).toEqual(["fix", true]);
  expect(g.total).toBeCloseTo(MEND_TIME.word + LADDER_TIME); // slower than a builder on foot, and it doesn't care

  // The whole job, a frame at a time: what the ladder and the builder are doing.
  const seen: string[] = [];
  let top = 0;
  while (g.state === "fix") {
    const p = ladderPhase(g);
    const now = p.lean > 0 ? "stand it up" : p.working ? "work" : seen.includes("work") ? "down" : "up";
    if (seen.at(-1) !== now) seen.push(now);
    if (p.working) expect(p.rung).toBe(LADDER_TOP); // the work's done from the top
    if (p.lean > 0) expect(p.rung).toBe(0); // and nobody climbs a ladder that's still going up
    top = Math.max(top, p.rung);
    stepGremlin(g, 1 / 60, site, sky);
  }
  expect(seen).toEqual(["stand it up", "up", "work", "down"]);
  expect(top).toBe(LADDER_TOP);
  expect(site.mended).toEqual([word]);
});

test("the builders have plenty to shout, and never the same line twice running", () => {
  for (const kind of Object.keys(QUOTES) as QuoteKind[]) {
    expect(QUOTES[kind].length).toBeGreaterThanOrEqual(5);
    expect(new Set(QUOTES[kind]).size).toBe(QUOTES[kind].length);
    expect(QUOTES[kind].every((l) => l.length <= 34)).toBe(true); // short enough for a bubble
    let last = "";
    for (let i = 0; i < 40; i++) {
      const line = pickLine(kind, last, () => (i * 0.37) % 1);
      expect(QUOTES[kind]).toContain(line);
      expect(line).not.toBe(last);
      last = line;
    }
  }
  expect(QUOTES.wrecked).toContain("Oi! Stop that!");
  expect(QUOTES.wrecked).toContain("We'll never get any work done now!");
  expect(pickLine("leave", "", () => 0.9999)).toBe(QUOTES.leave.at(-1));
});

test("they don't go on about it: a bubble now and then, with a good quiet after", () => {
  // Shooting something is what happens most, so it's what they remark on least often.
  expect(CHATTER.wrecked).toBeLessThanOrEqual(0.15);
  expect(CHATTER.done).toBeLessThanOrEqual(0.1);
  for (const kind of Object.keys(QUOTES) as QuoteKind[]) expect(CHATTER[kind]).toBeGreaterThan(0);
  expect(HUSH).toBeGreaterThanOrEqual(3);
  expect(BUBBLES_MAX).toBe(2);
});

test("a builder puts right a few things a visit: its job, and what's down within reach of it", () => {
  // Six words down along one line, and one a long way off.
  const line = [0, 1, 2, 3, 4, 5].map((i) => wreck(300 + i * 20, 400));
  const far = wreck(300 + MEND_REACH * 3, 400);
  const site = siteOf([...line, far]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 300, y: 405 };
  const done = run(g, site, MEND_TIME.word + 0.2);
  expect(done.length).toBe(MEND_BATCH); // all back in the one go
  expect(site.mended.length).toBe(MEND_BATCH);
  expect(site.mended.every((w) => line.includes(w))).toBe(true); // the nearest ones, not the far one
  expect(line.filter((w) => !w.mended).every((w) => !w.claimed)).toBe(true); // and the rest are left for anyone
  expect(far.claimed).toBe(false);

  // On its own with nothing near, a job is just the one thing.
  const lone = siteOf([wreck(100, 100), wreck(100 + MEND_REACH * 2, 100)]);
  const h = { ...newGremlin<Wreck>(sky, () => 0), x: 110, y: 105 };
  expect(run(h, lone, MEND_TIME.word + 0.2).length).toBe(1);
});

test("two gremlins don't go for the same wreck, and one with nothing to do waits", () => {
  const only = wreck(500, 400);
  const site = siteOf([only]);
  const a = { ...newGremlin<Wreck>(sky, () => 0), x: 400, y: 400 }, b = { ...newGremlin<Wreck>(sky, () => 0), x: 600, y: 400 };
  stepGremlin(a, 1 / 60, site, sky);
  run(b, site, 1);
  expect(a.job).toBe(only);
  expect(b.job).toBeNull();
  expect([b.x, b.y, b.state]).toEqual([600, 400, "idle"]);
});

test("a gremlin that's shot lets go of its job, and one whose job has gone looks for another", () => {
  const first = wreck(500, 400), second = wreck(520, 400);
  const site = siteOf([first, second]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 100, y: 400 };
  stepGremlin(g, 1 / 60, site, sky);
  expect(g.job).toBe(first);
  dropJob(g);
  expect([first.claimed, g.job, g.state]).toEqual([false, null, "idle"]);

  // The page redrew what it was walking to (nothing there any more): it drops it and takes the next.
  run(g, site, 0.4);
  expect(g.job).toBe(first);
  first.box = null;
  run(g, site, 0.8);
  expect(g.job).toBe(second);
});

test("with nothing left to mend a gremlin walks off the page, and turns back if something else goes down", () => {
  const wrecks: Wreck[] = [];
  const site = siteOf(wrecks);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 120, y: 400 };
  run(g, site, PATIENCE - 0.2);
  expect([g.state, g.x]).toEqual(["idle", 120]); // it hangs about a moment first
  run(g, site, 0.5);
  expect(g.state).toBe("leave");
  expect(g.x).toBeLessThan(120); // off towards the nearest edge (the left one)
  expect(g.facing).toBe(-1);
  expect(g.gone).toBe(false);

  // Something's shot behind it: back to work.
  const late = wreck(300, 400);
  wrecks.push(late);
  run(g, site, 0.4);
  expect([g.state, g.job]).toEqual(["walk", late]);
  run(g, site, 3);
  expect(site.mended).toEqual([late]);

  // And with that done and nothing else, it's gone for good.
  run(g, site, PATIENCE + 3);
  expect(g.gone).toBe(true);
  expect(g.x).toBeLessThan(0);
});

test("a shot that just misses makes it duck: nothing gets done with its head down, and it can't be pinned for good", () => {
  const job = wreck(400, 400);
  const site = siteOf([job]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 100, y: 400 };
  run(g, site, 0.2);
  const at = g.x;
  expect(startle(g)).toBe(true);
  run(g, site, DUCK - 0.1);
  expect(g.x).toBe(at); // crouched where it was
  expect(startle(g)).toBe(false); // already down: more shots change nothing
  run(g, site, 0.3);
  expect(g.x).toBeGreaterThan(at); // up and off again
  expect(startle(g)).toBe(false); // and it has its nerve for a bit
  run(g, site, NERVE);
  expect(startle(g)).toBe(true);
});

test("each job has its tool, and a finished one gets a little jump", () => {
  expect(TOOL).toEqual({ word: "brush", edge: "saw", part: "hammer", shell: "hammer" });
  const site = siteOf([wreck(100, 400)]);
  const g = { ...newGremlin<Wreck>(sky, () => 0), x: 110, y: 405 };
  expect(g.hop).toBe(0);
  run(g, site, MEND_TIME.word + 0.1);
  expect(site.mended.length).toBe(1);
  expect(g.hop).toBeGreaterThan(0);
  run(g, site, 0.5);
  expect(g.hop).toBeLessThanOrEqual(0);
});
