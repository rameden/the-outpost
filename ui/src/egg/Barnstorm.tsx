// Barnstorm, the easter egg: a little pixel plane you fly over the page with the arrow keys
// (↑ throttle, ← → turn, ↓ brake: flight.ts), shooting it to bits with the space bar, a word and
// a button at a time. Started from the plane
// in the top bar, or by typing the Konami code (↑ ↑ ↓ ↓ ← → ← → B A) anywhere.
//
// It's a race: gremlins (little dwarf builders, by the look of them) turn out to mend what
// you've shot (gremlins.ts), more of them the more of the page is down. They can be shot too.
//
// And there are power-ups (powerups.ts): crates to fly through for a fan of shots, a faster
// gun, a tea break for the builders, or a bomb.
//
// The page underneath is never changed for real (targets.ts): Reset puts it all back, and so
// does leaving. The plane, its bullets, the gremlins and the debris are drawn on one canvas over
// the page that lets every click through; only the bar along the bottom (Bar.tsx) takes the mouse.

import { useCallback, useEffect, useRef, useState } from "react";
import { storeGet, storeSet } from "../api.ts";
import {
  BULLET_SPEED, FIRE_EVERY, GREMLIN_POINTS, PAINT, PIXEL, SPRITE, UP, konami, muzzle, newPlane, scoreText, stepPlane,
  type Plane,
} from "./flight.ts";
import {
  BANG, BUBBLES_MAX, BUBBLE_LASTS, CHATTER, GREMLIN_DUCK, GREMLIN_FRAMES, GREMLIN_PAINT, GREMLIN_RADIUS, HEAD_START, HOP, HUSH, NEAR_MISS, NOTE, SPAWN_EVERY, TOOL,
  crewFor, dropJob, ladderPhase, newGremlin, onLadder, pickLine, startle, stepGremlin,
  type Box, type Gremlin, type QuoteKind,
} from "./gremlins.ts";
import {
  BIG_ACROSS, BLAST, BOOM, CRATE, CRATE_EVERY, CRATE_LIFE, CRATE_MAX, DROP_CHANCE, FIRST_CRATE, POWERS, RAPID_RATE, activeText, blastPoints, newCrate, pickKind,
  shotAngles, showing, tick as tickPowers, touching, type Active, type Crate,
} from "./powerups.ts";
import { Wreckage, type Hit, type Wreck } from "./targets.ts";
import { cx } from "../format.ts";
import { EggBar, PausedPill, usePause, type GameProps, type Mode } from "./Bar.tsx";
import { Sortie } from "./Sortie.tsx";

const BEST = "camp-barnstorm-best";
const FLY: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const FIRE = " ";

// Calls `start` when the Konami code is typed, wherever the keyboard happens to be.
export function useKonami(start: () => void) {
  const go = useRef(start);
  go.current = start;
  useEffect(() => {
    const next = konami();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || !next(ev.key)) return;
      ev.preventDefault(); // the last letter of the code isn't typed…
      // …and the one before it is taken back out of a text box it landed in.
      const box = document.activeElement;
      if ((box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) && box.selectionStart && box.selectionStart === box.selectionEnd
        && box.value[box.selectionStart - 1]?.toLowerCase() === "b") document.execCommand?.("delete");
      go.current();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);
}

// over: what on the page it was last seen over (so it's noticed when that changes).
type Bullet = { x: number; y: number; vx: number; vy: number; big: boolean; boom: boolean; hops: number; over?: Element | null };
const LOOK_EVERY = 3; // px of a bullet's flight between looks at what's under it
const CLEARED_EVERY = 0.4; // seconds between checks that there's still something left to shoot
type Bit = { x: number; y: number; vx: number; vy: number; size: number; color: string; age: number; life: number; falls: boolean; hat?: boolean };
const WET_PAINT = "#e85d9a"; // what the builders repaint the letters with, whatever colour they were
const SAWDUST = "#c9a36b";
type Tally = { x: number; y: number; text: string; age: number };
type Ring = { x: number; y: number; age: number; reach: number }; // a bomb (or an exploding shot) going off
const RING_LASTS = 0.35;
type Bubble = { who: Gremlin<Wreck>; text: string; age: number }; // a builder, shouting

// The easter egg, whichever of its two games is on: wrecking the page (below), or the Sortie
// (Sortie.tsx). It always starts on the first; the bar along the bottom switches between them.
//
// It can be paused, to get on with something and come back: the game stops where it is and
// gets out of the way (no plane, no bar, the keyboard back to the page, and the page put back
// whole if it was being wrecked), leaving a pill in the corner to resume from. Nothing about
// the game is lost: it's all still here, just not running. (paused / onPause / onResume: whoever
// shows this can keep the pause themselves, as the app does for the plane in its top bar;
// left out, it's kept here.)
export function Barnstorm({ onClose, paused, onPause, onResume }: { onClose: () => void; paused?: boolean; onPause?: () => void; onResume?: () => void }) {
  const [mode, setMode] = useState<Mode>("wreck");
  const [own, setOwn] = useState(false);
  const game: GameProps = { paused: paused ?? own, onPause: onPause ?? (() => setOwn(true)), onResume: onResume ?? (() => setOwn(false)), onClose, onMode: setMode };
  return mode === "sortie" ? <Sortie {...game} /> : <WreckThePage {...game} />;
}

function WreckThePage({ paused, onPause, onResume, onClose, onMode }: GameProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [wrecked, setWrecked] = useState(0);
  const [rebuilt, setRebuilt] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [powers, setPowers] = useState(""); // the power-ups running now, with their seconds left
  const [best, setBest] = useState(() => Number(storeGet(BEST)) || 0);
  // Reset, as the running game does it (set up with the game, below).
  const again = useRef<() => void>(() => {});
  const reset = useCallback(() => again.current(), []);
  const close = useRef(onClose);
  close.current = onClose;
  const pause = useRef(onPause);
  pause.current = onPause;
  const ctl = usePause(paused);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext?.("2d") ?? null;
    // The game's own corner of the page, which nothing hits: its root here; or, where it's shown
    // inside a shadow root (the browser extension does, to keep the page's styles off it), the
    // element that root hangs from, since that's all the page can see of it.
    const own = () => { const top = root.current?.getRootNode(); return top instanceof ShadowRoot ? top.host : root.current; };
    const wreckage = new Wreckage(own);
    let stopped = false; // paused: nothing moves, and the keys are the page's
    let sky = { width: innerWidth, height: innerHeight };
    let plane: Plane = newPlane(sky);
    let bullets: Bullet[] = [], bits: Bit[] = [], tallies: Tally[] = [];
    let gremlins: Gremlin<Wreck>[] = [];
    let points = 0, top = Number(storeGet(BEST)) || 0;
    let cooling = 0, puffing = 0, clock = 0;
    let since = -1; // seconds since the first hit (-1: nothing's been hit yet), for the gremlins' late start
    let nextGremlin = 0, mends = 0, shown = 0;
    let crates: Crate[] = [], rings: Ring[] = [];
    let bubbles: Bubble[] = [], hush = 0, lastLine = "";
    const leaving = new WeakSet<Gremlin<Wreck>>(); // who has already said their goodbyes
    let active: Active = {}, nextCrate = FIRST_CRATE, running = "";
    const held = new Set<string>();

    // The keyboard is the plane's while it's up: nothing is left typing into the message box.
    (document.activeElement as HTMLElement | null)?.blur?.();

    const size = () => {
      sky = { width: innerWidth, height: innerHeight };
      const dpr = devicePixelRatio || 1;
      cv.width = Math.round(sky.width * dpr);
      cv.height = Math.round(sky.height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    again.current = () => {
      wreckage.restore();
      plane = newPlane(sky);
      bullets = []; bits = []; tallies = []; gremlins = []; crates = []; rings = []; bubbles = []; hush = 0;
      points = 0; cooling = 0; since = -1; mends = 0; shown = 0;
      active = {}; nextCrate = FIRST_CRATE; running = "";
      setScore(0); setWrecked(0); setRebuilt(0); setCleared(false); setPowers("");
    };

    const mine = (ev: KeyboardEvent) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    const onDown = (ev: KeyboardEvent) => {
      if (stopped || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "Escape") { mine(ev); close.current(); return; }
      if (ev.key === "p" || ev.key === "P") { mine(ev); pause.current(); return; }
      if (!(ev.key in FLY) && ev.key !== FIRE) return;
      mine(ev);
      held.add(ev.key);
    };
    const onUp = (ev: KeyboardEvent) => {
      if (stopped || (!(ev.key in FLY) && ev.key !== FIRE)) return;
      mine(ev); // (a space let go over a focused button would press it)
      held.delete(ev.key);
    };
    const letGo = () => held.clear();
    addEventListener("keydown", onDown, true);
    addEventListener("keyup", onUp, true);
    addEventListener("blur", letGo);
    addEventListener("resize", size);

    // Debris flung out of where something was: more for a bigger piece (or a longer edge).
    const debris = (box: Box, color: string) => {
      const n = Math.max(6, Math.min(48, Math.round(Math.max((box.width * box.height) / 260, (box.width + box.height) / 14))));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 220;
        bits.push({
          x: box.left + Math.random() * box.width, y: box.top + Math.random() * box.height,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, size: Math.random() < 0.5 ? 3 : 4,
          color: i % 5 === 0 ? PAINT.Y : color || PAINT.G, age: 0, life: 0.35 + Math.random() * 0.5, falls: true,
        });
      }
    };
    const award = (n: number, x: number, y: number) => {
      tallies.push({ x, y, text: `+${n}`, age: 0 });
      points += n;
      if (points > top) { top = points; storeSet(BEST, String(top)); setBest(top); }
      setScore(points);
    };
    // The builders have opinions, now and then (CHATTER in gremlins.ts): one says its piece in
    // a speech bubble, with a good pause before the next, only a couple up together, and
    // nobody talking over themselves. (always: this one's worth breaking the quiet for.)
    const yell = (who: Gremlin<Wreck> | undefined, kind: QuoteKind, always = false) => {
      if (!who || Math.random() > CHATTER[kind] || (hush > 0 && !always) || bubbles.length >= BUBBLES_MAX || bubbles.some((b) => b.who === who)) return;
      lastLine = pickLine(kind, lastLine);
      bubbles.push({ who, text: lastLine, age: 0 });
      hush = HUSH;
    };
    const nearest = (x: number, y: number) => gremlins.reduce<Gremlin<Wreck> | undefined>((best, it) =>
      !best || Math.hypot(it.x - x, it.y - y) < Math.hypot(best.x - x, best.y - y) ? it : best, undefined);

    const burst = (hit: Hit) => {
      debris(hit.box, hit.color);
      award(hit.points, hit.box.left + hit.box.width / 2, hit.box.top);
      yell(nearest(hit.box.left + hit.box.width / 2, hit.box.top + hit.box.height / 2), "wrecked");
      if (since < 0) since = 0;
      hitSince = true;
    };
    // A gremlin, shot: what it was mending stays down for the next one.
    const swat = (g: Gremlin<Wreck>) => {
      dropJob(g);
      gremlins = gremlins.filter((other) => other !== g);
      debris({ left: g.x - 10, top: g.y - 12, width: 20, height: 24 }, GREMLIN_PAINT.B);
      award(GREMLIN_POINTS, g.x, g.y - 16);
      // Its hard hat goes up in the air and comes down on its own.
      bits.push({ x: g.x, y: g.y - 16, vx: (Math.random() - 0.5) * 180, vy: -320, size: PIXEL, color: GREMLIN_PAINT.H, age: 0, life: 1, falls: true, hat: true });
      yell(nearest(g.x, g.y), "mate", true); // whoever's nearest has something to say about it
      // Now and then it leaves a crate behind.
      if (Math.random() < DROP_CHANCE) crates.push({ kind: pickKind(), x: g.x, y: g.y, age: 0 });
    };
    // Something a gremlin has just put back: a few sparks drifting up off it.
    const sparkle = (box: Box) => {
      const n = Math.max(5, Math.min(20, Math.round((box.width + box.height) / 12)));
      for (let i = 0; i < n; i++) bits.push({
        x: box.left + Math.random() * box.width, y: box.top + Math.random() * box.height,
        vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 50, size: 3,
        color: i % 2 ? "#ffffff" : "#ffd84a", age: 0, life: 0.3 + Math.random() * 0.35, falls: false,
      });
    };

    // A bomb, going off at (x, y): everything its blast reaches goes at once, builders included.
    // (Twice over the same ground, so what the first pass empties the second can take.)
    const blast = (x: number, y: number, reach = BLAST) => {
      rings.push({ x, y, age: 0, reach });
      let total = 0, drawn = 0;
      for (let pass = 0; pass < 2; pass++) for (const p of blastPoints(x, y, sky, reach)) {
        const hit = wreckage.strike(p.x, p.y);
        if (!hit) continue;
        total += hit.points;
        if (drawn++ < 18) debris(hit.box, hit.color); // enough to see, not a blizzard
      }
      for (const g of gremlins.filter((it) => Math.hypot(it.x - x, it.y - y) <= reach)) swat(g);
      if (!total) return;
      award(total, x, y - 30);
      if (since < 0) since = 0;
      hitSince = true;
    };
    // A crate, flown through.
    const take = (crate: Crate) => {
      const power = POWERS[crate.kind];
      tallies.push({ x: crate.x, y: crate.y - 20, text: `${power.name.toUpperCase()}!`, age: -0.4 }); // (it lingers a little longer than a score)
      sparkle({ left: crate.x - 14, top: crate.y - 14, width: 28, height: 28 });
      if (crate.kind === "bomb") blast(crate.x, crate.y);
      else active = { ...active, [crate.kind]: power.lasts };
      if (crate.kind === "tea") yell(nearest(crate.x, crate.y), "tea", true);
    };

    // Whether there's anything left to shoot is worth knowing, but not after every single hit:
    // on a long page it means looking over a good deal of it.
    let hitSince = false, clearedIn = 0;

    const step = (dt: number) => {
      clock += dt;
      wreckage.tick();
      if ((clearedIn -= dt) <= 0 && hitSince) { clearedIn = CLEARED_EVERY; hitSince = false; if (wreckage.cleared()) setCleared(true); }
      const stick = { x: 0, y: 0 };
      for (const k of held) { const d = FLY[k]; if (d) { stick.x += d[0]; stick.y += d[1]; } }
      plane = stepPlane(plane, stick, dt, sky);

      // A puff of exhaust behind the tail while the throttle's open.
      puffing -= dt;
      if (stick.y < 0 && puffing <= 0) {
        puffing = 0.045;
        const back = 7 * PIXEL;
        bits.push({
          x: plane.x - Math.cos(plane.heading) * back, y: plane.y - Math.sin(plane.heading) * back,
          vx: -plane.vx * 0.15 + (Math.random() - 0.5) * 30, vy: -plane.vy * 0.15 + (Math.random() - 0.5) * 30,
          size: 3, color: "rgba(140, 146, 158, .7)", age: 0, life: 0.3, falls: false,
        });
      }

      cooling -= dt;
      if (held.has(FIRE) && cooling <= 0) {
        cooling = FIRE_EVERY * (active.rapid ? RAPID_RATE : 1);
        for (const a of shotAngles(plane.heading, !!active.spread)) bullets.push({
          ...muzzle(plane), vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, big: !!active.big, boom: !!active.boom, hops: 0,
        });
      }

      // Power-ups: crates turn up once the shooting's started, wait a while, and are taken by
      // flying through them. The ones that last count down.
      if (since >= 0) nextCrate -= dt;
      if (nextCrate <= 0) {
        nextCrate = CRATE_EVERY + Math.random() * 5;
        if (crates.length < CRATE_MAX) crates.push(newCrate(sky));
      }
      crates = crates.filter((c) => {
        c.age += dt;
        if (!touching(plane, c)) return c.age < CRATE_LIFE;
        take(c);
        return false;
      });
      active = tickPowers(active, dt);
      const now = activeText(active);
      if (now !== running) { running = now; setPowers(now); }
      rings = rings.filter((r) => (r.age += dt) < RING_LASTS);

      // A bullet looks at what's under it every few pixels, not every one: asking the page is
      // the slow part of all this, and with a lot of shots in the air it adds up to a frame's
      // worth. Whenever what it's over has changed since its last look, it goes back over the
      // pixels in between, so the border it crossed on the way in (or a hairline it clipped)
      // is still hit exactly where it is.
      bullets = bullets.filter((b) => {
        const far = Math.hypot(b.vx, b.vy) * dt, ux = b.vx / BULLET_SPEED, uy = b.vy / BULLET_SPEED;
        for (let left = far; left > 0; ) {
          const go = Math.min(LOOK_EVERY, left), fromX = b.x, fromY = b.y;
          left -= go;
          b.x += ux * go; b.y += uy * go;
          if (b.x < 0 || b.y < 0 || b.x > sky.width || b.y > sky.height) return false;
          const g = gremlins.find((it) => Math.hypot(it.x - b.x, it.y - b.y) < GREMLIN_RADIUS + (b.big ? 12 : 0));
          if (g) { swat(g); if (b.boom) blast(b.x, b.y, BOOM); return false; }
          const over = wreckage.under(b.x, b.y);
          let hit: Hit | null = null;
          if (over !== b.over) for (let d = 1; d < go && !hit; d++) hit = wreckage.strike(fromX + ux * d, fromY + uy * d);
          hit ??= wreckage.strike(b.x, b.y, over);
          b.over = over;
          if (hit) burst(hit);
          let struck = !!hit;
          // A big shot takes what's either side of its middle too. (Looked for every few
          // pixels, which is close enough to catch a word, and whenever its middle hits.)
          if (b.big && (struck || b.hops++ % 2 === 0)) {
            const ax = -b.vy / BULLET_SPEED, ay = b.vx / BULLET_SPEED; // across its path
            for (const off of BIG_ACROSS) { const side = wreckage.strike(b.x + ax * off, b.y + ay * off); if (side) { burst(side); struck = true; } }
          }
          if (struck) { if (b.boom) blast(b.x, b.y, BOOM); return false; }
        }
        // Still going: any builder it has just whistled past gets its head down.
        for (const it of gremlins) if (Math.hypot(it.x - b.x, it.y - b.y) < NEAR_MISS && startle(it)) yell(it, "miss");
        return true;
      });

      // The gremlins: they start turning out a moment after the first hit, one at a time, as
      // many as there's wreckage to keep busy. Each walks to something that's down and mends it.
      if (since >= 0) since += dt;
      nextGremlin -= dt;
      const teaBreak = !!active.tea; // tools down, and nobody new turns out
      if (!teaBreak && since >= HEAD_START && nextGremlin <= 0 && gremlins.length < crewFor(wreckage.count)) {
        gremlins.push(newGremlin<Wreck>(sky));
        yell(gremlins.at(-1), "arrive");
        nextGremlin = SPAWN_EVERY;
      }
      for (const g of teaBreak ? [] : gremlins) {
        const fixed = stepGremlin(g, dt, wreckage, sky);
        if (fixed.length) { fixed.forEach(sparkle); mends += fixed.length; setRebuilt(mends); setCleared(false); yell(g, "done"); }
        // Something flying off the job now and then: sparks from a hammer, paint off a brush,
        // sawdust. (From up the ladder, if that's where the work is; and not while it's still climbing.)
        else if (g.state === "fix" && g.job && g.duck <= 0 && Math.random() < dt * 9) {
          const tool = TOOL[g.job.kind], up = onLadder(g) ? ladderPhase(g) : null;
          if (!up || up.working) bits.push({
            x: g.x + g.facing * 16, y: g.y + 4 - (up ? up.rung * PIXEL : 0), vx: g.facing * (20 + Math.random() * 60), vy: -60 - Math.random() * 60,
            size: tool === "brush" ? 3 : 2, color: tool === "brush" ? WET_PAINT : tool === "saw" ? SAWDUST : "#ffd84a", age: 0, life: tool === "hammer" ? 0.25 : 0.45, falls: true,
          });
        }
        // Off home: a parting word, once (and once more if it's called back and leaves again).
        if (g.state !== "leave") leaving.delete(g);
        else if (!leaving.has(g)) { leaving.add(g); yell(g, "leave"); }
      }
      hush -= dt;
      bubbles = bubbles.filter((b) => (b.age += dt) < BUBBLE_LASTS && gremlins.includes(b.who) && !b.who.gone);
      gremlins = gremlins.filter((g) => !g.gone); // (the ones that have walked off home)
      if (wreckage.count !== shown) { shown = wreckage.count; setWrecked(shown); }

      bits = bits.filter((p) => {
        p.age += dt;
        if (p.falls) p.vy += 700 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        return p.age < p.life;
      });
      tallies = tallies.filter((t) => { t.age += dt; t.y -= 40 * dt; return t.age < 0.7; });
    };

    const drawPlane = (g: CanvasRenderingContext2D, silhouette?: string) => {
      const w = SPRITE[0].length, h = SPRITE.length;
      const spin = Math.floor(clock * 24) % 2 === 0; // the propeller, flickering
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = SPRITE[r][c];
        if (ch === ".") continue;
        if (ch === "Y" && spin && (c < 6 || c > 10)) continue;
        g.fillStyle = silhouette ?? PAINT[ch];
        g.fillRect((c - w / 2) * PIXEL, (r - h / 2) * PIXEL, PIXEL, PIXEL);
      }
    };

    // A picture from rows of letters, its middle at (0, 0): every X in `ink`.
    const drawGlyph = (g: CanvasRenderingContext2D, rows: string[], px: number, ink: string) => {
      g.fillStyle = ink;
      rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== ".") g.fillRect((c - row.length / 2) * px, (r - rows.length / 2) * px, px, px); }));
    };
    const drawCrate = (g: CanvasRenderingContext2D, c: Crate) => {
      if (!showing(c)) return;
      const power = POWERS[c.kind], half = (CRATE / 2) * PIXEL;
      g.save();
      g.translate(Math.round(c.x), Math.round(c.y + Math.sin((clock + c.x) * 4) * 2)); // bobbing a little
      g.fillStyle = "rgba(0, 0, 0, .2)"; g.fillRect(-half + 4, -half + 5, half * 2, half * 2);
      g.fillStyle = PAINT.D; g.fillRect(-half, -half, half * 2, half * 2);
      g.fillStyle = "#f3f5f8"; g.fillRect(-half + PIXEL, -half + PIXEL, half * 2 - 2 * PIXEL, half * 2 - 2 * PIXEL);
      g.fillStyle = power.color; g.fillRect(-half + 2 * PIXEL, -half + 2 * PIXEL, half * 2 - 4 * PIXEL, half * 2 - 4 * PIXEL);
      drawGlyph(g, power.glyph, PIXEL, power.ink);
      g.restore();
    };

    // A builder, with whatever it's carrying or up to. Its boots stay on the ground line under
    // (x, y) unless it's up its ladder or mid-jump.
    const WOOD = "#a8733a", RUNG = "#c49556", STEEL = "#9aa3b2", FEET = 5; // (FEET: rows from its middle down to its soles)
    const LADDER_ROWS = 14;
    const drawGremlin = (g: CanvasRenderingContext2D, it: Gremlin) => {
      const onBreak = !!active.tea;
      const ducking = !onBreak && it.duck > 0;
      const busy = !onBreak && !ducking;
      const tool = it.job ? TOOL[it.job.kind] : null;
      const atJob = it.state === "fix";
      const walking = busy && (it.state === "walk" || it.state === "leave");
      const ladder = onLadder(it);
      // A job from a ladder: stand it up, climb, work at the top, climb down. (Even its tea is had up there.)
      const up = atJob && ladder ? ladderPhase(it) : null;
      const working = busy && atJob && (!up || up.working);
      const rows = ducking ? GREMLIN_DUCK : GREMLIN_FRAMES[walking || (busy && up && !up.working && !up.lean) ? Math.floor(it.clock * 10) % 2 : 0];
      const px = PIXEL, top = (FEET - rows.length) * px;
      const climb = up ? up.rung * px : 0;
      const hop = it.hop > 0 ? Math.sin(Math.PI * (1 - it.hop / HOP)) * 9 : 0; // job done: a little jump
      const box = (c: number, r: number, w: number, h: number, color: string) => { g.fillStyle = color; g.fillRect(c * px, r * px, w * px, h * px); };
      // A ladder, its foot at (0, 0) and the rest of it going up.
      const drawLadder = () => {
        for (let r = -3; r > -LADDER_ROWS; r -= 3) box(-2, r, 4, 1, RUNG);
        box(-3, -LADDER_ROWS, 1, LADDER_ROWS, WOOD); box(2, -LADDER_ROWS, 1, LADDER_ROWS, WOOD);
      };

      g.save();
      g.translate(Math.round(it.x), Math.round(it.y));
      g.scale(it.facing, 1);
      box(-3.5, FEET, 7, 1, "rgba(0, 0, 0, .2)"); // its shadow, at its feet
      if (up) {
        // The ladder: swung up from flat to standing, then planted behind it (and not quite steady).
        g.save();
        g.translate((up.lean ? 0 : Math.sin(it.clock * 11) > 0.8 ? 1 : 0), FEET * px);
        g.rotate(up.lean * 1.2);
        drawLadder();
        g.restore();
      } else if (working && tool === "brush") {
        box(-8, FEET - 3, 3, 3, STEEL); box(-8, FEET - 3, 3, 1, WET_PAINT); // the paint pot, beside it
      }
      g.translate(0, -climb - hop);
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === ".") continue;
        g.fillStyle = GREMLIN_PAINT[ch];
        g.fillRect((c - rows[r].length / 2) * px, top + r * px, px, px);
      }
      if (ladder && !atJob) {
        // Not at a job: the ladder's carried under one arm, level, sticking out in front and
        // behind and bouncing as it goes. It's drawn across the body, and then the arm over its
        // top rail, with a hand round it underneath: that's what tucks it in.
        const bounce = walking && Math.floor(it.clock * 10) % 2 ? -1 / 3 : 0;
        const at = FEET - (ducking ? 3 : 4) + bounce; // the row its top rail is at: just under the shoulder
        for (let c = -5; c <= 7; c += 3) box(c, at, 1, 3, RUNG);
        box(-7, at, 16, 1, WOOD); box(-7, at + 2, 16, 1, WOOD);
        box(2, at - 1, 2, 2, GREMLIN_PAINT.T); // the arm over it
        box(2, at + 1, 2, 1, GREMLIN_PAINT.S); // and the hand
      }
      if (working && tool === "hammer") {
        // Its hammer: up, then down on the job.
        if (Math.floor(it.clock * 9) % 2 === 0) { box(4, 1, 3, 1, WOOD); box(7, 0, 2, 3, STEEL); }
        else { box(4, -3, 1, 4, WOOD); box(3, -5, 3, 2, STEEL); }
      } else if (working && tool === "brush") {
        // A paintbrush, dabbing up and down: the letters go back on in whatever's in the pot.
        const dab = Math.floor(it.clock * 8) % 2 ? -2 : 0;
        box(5, -1 + dab, 1, 3, WOOD); box(4.5, -3 + dab, 2, 2, WET_PAINT);
      } else if (working && tool === "saw") {
        // A saw, back and forth.
        const slide = Math.floor(it.clock * 10) % 2;
        box(4 + slide, 0, 2, 3, WOOD); box(6 + slide, 1, 5, 1, "#c9d0da");
        for (let c = 0; c < 5; c += 2) box(6 + slide + c, 2, 1, 1, "#7d8796"); // its teeth
      }
      // Over its head: tea on its break, "!" when a shot has just missed, a tune on the way home.
      g.scale(it.facing, 1); // (not mirrored)
      const overhead = top - 4 * px;
      if (onBreak) { g.translate(0, overhead); drawGlyph(g, POWERS.tea.glyph, 2, POWERS.tea.color); }
      else if (ducking) { g.translate(0, overhead); drawGlyph(g, BANG, px, "#d8402f"); }
      else if (it.state === "leave" && Math.floor(it.clock * 2) % 3 !== 2) {
        g.translate(6 + Math.sin(it.clock * 5) * 3, overhead - Math.abs(Math.sin(it.clock * 4)) * 4);
        drawGlyph(g, NOTE, 2, "#7a4bd6");
      }
      g.restore();
    };

    // What a builder is shouting: a square speech bubble over its head, kept inside the window.
    const drawBubble = (g: CanvasRenderingContext2D, b: Bubble) => {
      if (b.age > BUBBLE_LASTS - 0.3 && Math.floor(b.age * 14) % 2) return; // it flickers out
      g.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
      g.textAlign = "left";
      const up = b.who.state === "fix" && onLadder(b.who) ? ladderPhase(b.who).rung * PIXEL : 0;
      const w = Math.ceil(g.measureText(b.text).width) + 12, h = 18;
      const tipX = Math.round(b.who.x), tipY = Math.round(b.who.y) - 8 * PIXEL - up;
      const left = Math.max(4, Math.min(sky.width - w - 4, tipX - Math.round(w / 2))), bottom = Math.max(h + 4, tipY - 5);
      g.fillStyle = PAINT.D; g.fillRect(left - 2, bottom - h - 2, w + 4, h + 4);
      g.fillRect(Math.max(left + 2, Math.min(left + w - 8, tipX - 3)), bottom, 6, 5); // its tail
      g.fillStyle = "#fffdf5"; g.fillRect(left, bottom - h, w, h);
      g.fillStyle = PAINT.D; g.fillText(b.text, left + 6, bottom - 5);
    };

    const draw = (g: CanvasRenderingContext2D) => {
      g.clearRect(0, 0, sky.width, sky.height);
      g.imageSmoothingEnabled = false;

      for (const p of bits) {
        // Fading in steps, the way an old machine would.
        g.globalAlpha = p.age / p.life < 0.5 ? 1 : p.age / p.life < 0.8 ? 0.6 : 0.3;
        g.fillStyle = p.color;
        if (p.hat) {
          // A builder's hard hat, on its own.
          g.fillRect(Math.round(p.x) - 1.5 * PIXEL, Math.round(p.y), 3 * PIXEL, PIXEL);
          g.fillRect(Math.round(p.x) - 2.5 * PIXEL, Math.round(p.y) + PIXEL, 5 * PIXEL, PIXEL);
          g.fillStyle = GREMLIN_PAINT.D; g.fillRect(Math.round(p.x) - 3.5 * PIXEL, Math.round(p.y) + 2 * PIXEL, 7 * PIXEL, PIXEL);
          continue;
        }
        g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      g.globalAlpha = 1;

      for (const c of crates) drawCrate(g, c);
      for (const it of gremlins) drawGremlin(g, it);

      // A bomb's blast: a ring of squares, widening.
      for (const r of rings) {
        const out = r.reach * (r.age / RING_LASTS), dots = Math.round(12 + r.reach / 4);
        g.fillStyle = r.age < RING_LASTS / 2 ? "#ffffff" : "#ffd84a";
        for (let i = 0; i < dots; i++) {
          const a = (i / dots) * Math.PI * 2;
          g.fillRect(Math.round(r.x + Math.cos(a) * out) - 3, Math.round(r.y + Math.sin(a) * out) - 3, 6, 6);
        }
      }

      for (const b of bullets) {
        g.save();
        g.translate(b.x, b.y);
        g.rotate(Math.atan2(b.vy, b.vx) - UP);
        if (b.big) g.scale(3, 2); // a big shot: fat, and a bit longer
        g.fillStyle = PAINT.D; g.fillRect(-2.5, -6, 5, 12);
        g.fillStyle = b.boom ? "#e8792a" : "#ffd84a"; g.fillRect(-1.5, -5, 3, 10);
        if (b.boom) { g.fillStyle = "#ffffff"; g.fillRect(-1.5, -5, 3, 3); } // an exploding one has a hot tip
        g.restore();
      }

      // The plane turns in sixteenths of a half-turn, so its pixels stay pixels; and it narrows as it rolls.
      const notch = Math.PI / 16;
      const angle = Math.round((plane.heading - UP) / notch) * notch;
      const roll = 1 - 0.32 * Math.abs(plane.bank);
      // Its shadow on the page below is what says it's flying.
      g.save(); g.translate(plane.x + 9, plane.y + 12); g.rotate(angle); g.scale(roll * 0.9, 0.9); drawPlane(g, "rgba(0, 0, 0, .22)"); g.restore();
      g.save(); g.translate(plane.x, plane.y); g.rotate(angle); g.scale(roll, 1); drawPlane(g); g.restore();

      for (const b of bubbles) drawBubble(g, b);

      g.font = "bold 12px ui-monospace, Menlo, Consolas, monospace";
      g.textAlign = "center";
      for (const t of tallies) {
        if (t.age < 0 && Math.floor(t.age * 12) % 2) continue; // (a power-up's name flashes first)
        g.globalAlpha = t.age < 0.5 ? 1 : 0.5;
        g.lineWidth = 3; g.strokeStyle = PAINT.D; g.strokeText(t.text, t.x, t.y);
        g.fillStyle = "#ffd84a"; g.fillText(t.text, t.x, t.y);
      }
      g.globalAlpha = 1;
    };

    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      step(Math.min(0.033, Math.max(0, (now - last) / 1000))); // a stalled tab doesn't fling the plane across the page
      last = now;
      if (ctx) draw(ctx);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Pausing stops the clock, lets go of the keys, clears the sky and puts the page back whole;
    // resuming takes the page apart again as it was and carries on from the same moment.
    ctl.current = {
      pause() {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        held.clear();
        ctx?.clearRect(0, 0, sky.width, sky.height);
        wreckage.suspend();
      },
      resume() {
        if (!stopped) return;
        stopped = false;
        wreckage.resume();
        (document.activeElement as HTMLElement | null)?.blur?.();
        last = performance.now(); // (the time away doesn't count)
        frame = requestAnimationFrame(tick);
      },
    };

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("keydown", onDown, true);
      removeEventListener("keyup", onUp, true);
      removeEventListener("blur", letGo);
      removeEventListener("resize", size);
      wreckage.dispose();
    };
  }, []);

  return (
    <div className={cx("barnstorm", paused && "paused")} ref={root}>
      <canvas className="barnstorm-sky" ref={canvas} aria-hidden="true" />
      {paused ? <PausedPill says={`Wreck · ${scoreText(score)}`} onResume={onResume} onClose={onClose} /> : <EggBar mode="wreck" onMode={onMode}
        stats={[
          { label: "Score", value: scoreText(score) },
          { label: "Best", value: scoreText(best) },
          { label: "Wrecked", value: wrecked, title: "How much of the page is down right now" },
          { label: "Rebuilt", value: rebuilt, title: "How much the dwarf builders have put back. They mend what you wreck: shoot them too, and fly through crates for power-ups." },
        ]}
        status={cleared ? { text: "Camp flattened. Nothing left to shoot.", loud: true } : powers ? { text: powers } : null}
        keys={[["↑", "throttle"], ["←→", "turn"], ["↓", "brake"], ["Space", "fire"], ["P", "pause"], ["Esc", "land"]]}
        resetTitle="Put the page back together and start again" onReset={reset} onPause={onPause} onClose={onClose} />}
    </div>
  );
}
