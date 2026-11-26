// What the HD view draws this frame, worked out from what Orbit knows: where the camera is, where
// each planet and its moons are in three dimensions, what's crossing the sky, and (back the other
// way) where each body lands on the screen, so its name can be put by it and a click can find it.
// Pure: nothing of WebGL in it, so it can be checked by itself. The drawing is renderer.ts.

import { ease, orbitOf, type Spot } from "../scene.ts";
import { camera3, distFor, project, type Vec3 } from "./math.ts";
import type { HdFrame, HdPlanet, HdPoint } from "./renderer.ts";
import { NO_TURN, TABLE_FADE, onOrbit, orbitTurn, sunWake, worldWake } from "./spiral.ts";
import { MINE, laidOut, type World } from "./worlds.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const HD_FOV = 0.66;                 // the camera's field of view, top to bottom (about 38°)
export const HD_SUN = 24, HD_PLANET = 14;   // bigger than the flat view's: there's a world to look at now (HD_PLANET: the usual size; each world has its own)
// A planet's moons (one for each quest out): how long each takes round it (s), where it starts (°), and how its path is tipped.
const MOONS: [number, number, number][] = [[5.5, 0, 0.5], [7.5, 100, 0.95], [9.5, 240, 0.25], [11.5, 140, 1.25], [13.5, 310, 0.7]];
const TRAIL = 18, TRAIL_LAG = 24;           // a comet: this many points of light, each this many ms behind the one ahead
const STREAM = 26;                          // the stream from the sun to someone at work: this many points along it
// What's in orbit round a planet. None of it is drawn until the planet is big enough on the screen to see it by
// (CLOSE: its radius in pixels where it starts to show, and where it's all there), so the whole system isn't
// dusted with specks. And all of it follows the work: a couple of satellites at camp and more as its crew member
// gets busy; ships going out to each quest's moon and back, more of them the busier it is, and none to a quest
// that's waiting on you.
const CLOSE: [number, number] = [26, 70];
// A satellite: how far out (in the planet's radii), how long a lap takes (s), where it starts, and how its path is turned and tipped.
const SATS: [number, number, number, number, number][] = [
  [1.24, 7, 0.4, 0.3, 0.35], [1.36, 9.5, 2.9, 2.2, 1.15], [1.3, 8.2, 5.1, 4.0, 0.75], [1.48, 12, 1.7, 1.1, 1.45], [1.42, 10.6, 4.2, 5.3, 0.2],
  [1.58, 14, 0.9, 3.1, 0.95], [1.27, 7.6, 3.6, 5.9, 1.3], [1.52, 12.8, 5.7, 0.8, 0.55], [1.33, 8.9, 1.2, 2.9, 0.1], [1.45, 11.3, 2.3, 4.6, 1.0],
];
const SATS_AT_WORK = 4; // as many more join a world's own satellites when its crew member is at their busiest (none, if it has none)
const SHIPS = 3, SHIP_LAP = 5.2;            // as many ships to a moon as there are at the busiest, and how long one takes each way (s)
// A cluster of asteroids being mined: haulers go between the main rock and this many of the others, and (at work) the rig
// cuts at this many with a beam, in bursts. The beams can be seen from far off, fainter; the haulers only close to.
const HAULED = 3, CUT = 2, BEAM = 12;
const PALE: Vec3 = [0.82, 0.88, 1], WARM: Vec3 = [1, 0.86, 0.62];
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// One of the crew, as Orbit has them this frame. world: what theirs is like (worlds.ts). turned: how far it has turned on its axis. angle: how far round its orbit (degrees, as the flat view turns it).
// glow: 0 at camp … 1 at work, eased. blip / land: 0 → 1 while a tool call's flash or a landing's ring lasts, else -1.
// quests: one for each quest out, true if it's waiting on you. flight: a comet to it or from it, and how long it has been going.
export type HdBody = {
  id: string; i: number; angle: number; color: Vec3; world: World; turned: number; glow: number; waiting: boolean; focused: boolean;
  blip: number; land: number; quests: boolean[]; flight: { kind: "out" | "home"; since: number } | null;
  // What Orbit knows beyond the look of it, when it knows: sats, how many satellites it really has (one for each skill
  // and connector, in place of its world's own count and the ones that come with work; each can be found on the screen
  // while it's the one looked at, as "sat:0", "sat:1"…); moonSize, how big each quest's moon has grown (1: just out);
  // grown, how far its settlements have spread (0 … 1, by its level).
  sats?: number; moonSize?: number[]; grown?: number;
};
export type HdInput = {
  seconds: number; w: number; h: number; cx: number; cy: number; // the clock, the screen, and where on it the camera's target lands
  at: { x: number; y: number }; k: number; yaw: number; pitch: number; // what it looks at (in the flat view's units), how close, and from where
  lead: string; sun: { glow: number; waiting: boolean; light?: number }; // light: how bright it is set (1, as made, unless said)
  spiral?: number; // how much of the corkscrew wakes shows (0: none, the usual … 1: all of it), eased as it's turned on and off
  bodies: HdBody[];
  lines: { rot: number; lit: number; body: number }[]; // the contour lines outwards: turned by, lit by the sun's ring, and whose (an index into bodies, or -1)
  ping: { r: number; a: number }; reach: number; flightMs: number;
  // Places on the table (in the flat view's units) that Orbit marks itself and only needs found on the screen: the ships holding at the edge.
  marks?: { id: string; x: number; y: number; r: number }[];
};

const GREY: Vec3 = [0.3, 0.37, 0.52];
const GROWN_USUAL = 0.3; // how settled a world looks when nobody has said how far along its crew member is
// Whether a ball (at c, of radius R) is between the eye and a point.
function hidden(eye: Vec3, p: Vec3, c: Vec3, R: number): boolean {
  const d: Vec3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], far = Math.hypot(...d) || 1, to: Vec3 = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]];
  const along = (to[0] * d[0] + to[1] * d[1] + to[2] * d[2]) / far;
  return along > 0 && along < far && Math.hypot(...to) ** 2 - along * along < R * R;
}

export function hdFrame(o: HdInput): { frame: HdFrame; spots: Spot[] } {
  const spiral = clamp01(o.spiral ?? 0);
  // Where each world is: round its own orbit, tipped off the table as far as the spiral says.
  const turns = o.bodies.map((b) => orbitTurn(b.i, spiral));
  const placed = o.bodies.map((b, j) => onOrbit(turns[j], b.i, (b.angle * Math.PI) / 180));
  // The camera looks at a place on the table; one that's going to a world that has tipped off it goes with the world,
  // as much as it has got there (so it's on the world once it's arrived, and comes to it smoothly).
  const target: Vec3 = [o.at.x, 0, o.at.y];
  o.bodies.forEach((b, j) => {
    if (!b.focused || spiral <= 0) return;
    const a = (b.angle * Math.PI) / 180, r = orbitOf(b.i), flat = [Math.cos(a) * r, Math.sin(a) * r], p = placed[j];
    const there = clamp01(1 - Math.hypot(o.at.x - flat[0], o.at.y - flat[1]) / (HD_PLANET * 4));
    target[0] += (p[0] - flat[0]) * there; target[1] += p[1] * there; target[2] += (p[2] - flat[1]) * there;
  });
  const cam = camera3({ target, yaw: o.yaw, pitch: o.pitch, dist: distFor(o.k, o.h, HD_FOV), fov: HD_FOV, w: o.w, h: o.h, cx: o.cx, cy: o.cy });
  const spot = (id: string, p: Vec3, radius: number): Spot => { const s = project(cam, p, o.w, o.h); return { id, x: s.x, y: s.y, r: radius * s.scale }; };
  const two = 2 * Math.PI;
  const spots: Spot[] = [spot(o.lead, [0, 0, 0], HD_SUN)];
  const points: HdPoint[] = sunWake(spiral, HD_SUN), sats: Spot[] = []; // (the spiral's wakes, spiral.ts, when it's shown)

  const planets = o.bodies.map((b, bj): HdPlanet => {
    const a = (b.angle * Math.PI) / 180, r = orbitOf(b.i), pos = placed[bj];
    const dir: Vec3 = [pos[0] / r, pos[1] / r, pos[2] / r], world = b.world, R = HD_PLANET * world.size; // R: this world's radius; dir: the way to it from the sun
    const here = spot(b.id, pos, R);
    spots.push(here);
    points.push(...worldWake(b.i, turns[bj], a, b.color, b.glow, spiral));
    // A comet: out from the sun's edge to the planet's, or home, in an arc that lifts off the table; each point of it a moment behind the last.
    if (b.flight) for (let j = 0; j < TRAIL; j++) {
      const q = (b.flight.since - j * TRAIL_LAG) / o.flightMs;
      if (q <= 0 || q >= 1) continue;
      const along = b.flight.kind === "home" ? 1 - ease(q) : ease(q), d = HD_SUN + (r - R - HD_SUN) * along, fade = 1 - j / TRAIL;
      points.push({ pos: [dir[0] * d, dir[1] * d + Math.sin(Math.PI * along) * r * 0.16, dir[2] * d], size: 2 + 5 * fade, color: b.color, a: 1.6 * fade * fade * Math.min(1, q / 0.06, (1 - q) / 0.06) });
    }
    // The stream: light running out along the line from the sun to whoever is at work.
    if (b.glow > 0.02) for (let j = 1; j < STREAM; j++) {
      const along = j / STREAM, d = HD_SUN + (r - R - HD_SUN) * along;
      const pulse = Math.max(0, Math.sin((along * 3 - o.seconds * 0.9) * 2 * Math.PI)) ** 4;
      points.push({ pos: [dir[0] * d, dir[1] * d + 0.5, dir[2] * d], size: 1.6 + 2.6 * pulse, color: b.color, a: (0.07 + 0.8 * pulse) * b.glow });
    }
    const round = (far: number, t: number, tip: number): Vec3 => [pos[0] + far * Math.cos(t), pos[1] + far * Math.sin(t) * Math.sin(tip), pos[2] + far * Math.sin(t) * Math.cos(tip)];
    // A ship from here (leaving from so far off its middle) to a place (stopping short of it by so much), in a shallow arc, and
    // back; with a short burn behind it. t: how many times it has been there or back.
    const shuttle = (leave: number, to: Vec3, short: number, t: number, there: number) => {
      const gap: Vec3 = [to[0] - pos[0], to[1] - pos[1], to[2] - pos[2]], far = Math.hypot(...gap) || 1, u = t % 1, back = Math.floor(t) % 2 === 1;
      for (let m = 0; m < 5; m++) { // the ship, and four points of its burn
        const q = clamp01(u - m * 0.022), along = back ? 1 - ease(q) : ease(q);
        const d = leave + (far - leave - short) * along, lift = Math.sin(Math.PI * along) * far * 0.1;
        points.push({ pos: [pos[0] + (gap[0] / far) * d, pos[1] + (gap[1] / far) * d + lift, pos[2] + (gap[2] / far) * d], size: m ? 0.7 - m * 0.1 : 0.85, color: m ? mix3(WARM, b.color, 0.5) : WARM,
          a: (m ? 0.55 - m * 0.11 : 1.25) * there * Math.sin(Math.PI * u) ** 0.5 });
      }
    };
    // A moon for each quest out, close in, in its crew member's colour (the drawing's doing)…
    const moons = b.quests.slice(0, MOONS.length).map((waiting, j) => {
      const [lap, start, tip] = MOONS[j], t = ((start + (o.seconds * 360) / lap) * Math.PI) / 180;
      return { pos: round(R + 8 + j * 5, t, tip), radius: 2.2 * (b.moonSize?.[j] ?? 1), waiting };
    });
    // …and the world's own moons, further out and slower, which are always there.
    const own = world.moons.map((m) => ({ pos: round(m.far * R, m.start + (o.seconds * 2 * Math.PI) / m.lap, m.tip), radius: m.size * R, waiting: false, own: true }));
    const close = clamp01((here.r - CLOSE[0]) / (CLOSE[1] - CLOSE[0]));
    if (close > 0) {
      // Satellites, low over it: each a speck with a light that blinks. Its own are always there; more come as the work picks up.
      SATS.forEach(([far, lap, start, turn, tip], j) => {
        const there = clamp01((b.sats ?? world.sats + (world.sats ? SATS_AT_WORK * b.glow : 0)) - j) * close;
        if (there <= 0) return;
        const t = start + (o.seconds * two) / lap + b.i, d = far * R, ct = Math.cos(turn), st = Math.sin(turn);
        const x = Math.cos(t), y = Math.sin(t) * Math.cos(tip), up = Math.sin(t) * Math.sin(tip); // round a circle, tipped, then turned about
        const at: Vec3 = [pos[0] + d * (x * ct - y * st), pos[1] + d * up, pos[2] + d * (x * st + y * ct)];
        points.push({ pos: at, size: 0.55, color: PALE, a: 0.8 * there });
        // One that's really something can be pressed, unless the world is in the way of it.
        if (b.sats !== undefined && b.focused && there > 0.5 && !hidden(cam.eye, at, pos, R)) sats.push(spot(`sat:${j}`, at, 1));
        if ((o.seconds * 0.7 + j * 0.37) % 1 < 0.1) points.push({ pos: at, size: 1.5, color: mix3(PALE, b.color, 0.6), a: 1.3 * there });
      });
      // Ships: out from the side of it that faces a quest's moon, over to it, and back.
      const busy = clamp01(0.3 + 0.7 * b.glow) * close;
      moons.forEach((moon, j) => {
        if (moon.waiting) return; // (nothing moves on a quest that's waiting for your OK)
        for (let k = 0; k < SHIPS; k++) {
          const there = clamp01(1 + (SHIPS - 1) * b.glow - k) * busy;
          if (there > 0) shuttle(R * 1.03, moon.pos, moon.radius * 1.4, o.seconds / (SHIP_LAP + k * 1.3) + k * 0.37 + j * 0.21 + b.i * 0.13, there);
        }
      });
    }
    // A cluster of asteroids: the main rock where the planet would be, the rest going slowly round it, each tumbling.
    let rocks: HdPlanet["rocks"];
    if (world.kind === MINE) {
      const [count, spread, main] = world.p, from = laidOut(world.seed, "rocks");
      rocks = [{ pos, radius: main * R, seed: world.seed, turned: b.turned * 0.5, rig: true }];
      for (let j = 1; j < Math.round(count); j++) {
        const u = [from(), from(), from(), from(), from()];
        rocks.push({
          pos: round(R * spread * (0.62 + 0.4 * u[0]), u[2] * two + (o.seconds * two) / (46 + 60 * u[1]), (u[3] - 0.5) * 1.1),
          radius: R * (0.1 + 0.17 * u[4]), seed: world.seed + j * 17, turned: b.turned * (0.6 + u[1] * 1.8) + j, rig: false,
        });
      }
      // Haulers, between the main rock and the nearest few: one each at camp, more as the work picks up.
      if (close > 0) rocks.slice(1, 1 + HAULED).forEach((rock, j) => {
        for (let k = 0; k < SHIPS; k++) {
          const there = clamp01(1 + (SHIPS - 1) * b.glow - k) * clamp01(0.35 + 0.65 * b.glow) * close;
          if (there > 0) shuttle(main * R * 0.9, rock.pos, rock.radius, o.seconds / (SHIP_LAP * 0.8 + k * 1.1) + k * 0.41 + j * 0.27, there);
        }
      });
      // At work, the rig cuts at a couple of them with a beam, in bursts: a line of light, and a spark where it lands.
      const work = b.glow * Math.max(close, 0.35);
      if (work > 0.02) rocks.slice(1, 1 + CUT).forEach((rock, j) => {
        if ((o.seconds * 0.31 + j * 0.5) % 1 > 0.62) return;
        const gap: Vec3 = [rock.pos[0] - pos[0], rock.pos[1] - pos[1], rock.pos[2] - pos[2]], far = Math.hypot(...gap) || 1;
        const flicker = 0.65 + 0.35 * Math.sin(o.seconds * 41 + j * 5), hot = mix3(b.color, [1, 1, 1], 0.45);
        for (let m = 0; m <= BEAM; m++) {
          const d = main * R * 0.7 + (far - main * R * 0.7 - rock.radius * 0.6) * (m / BEAM);
          points.push({ pos: [pos[0] + (gap[0] / far) * d, pos[1] + (gap[1] / far) * d, pos[2] + (gap[2] / far) * d], size: m === BEAM ? 2.4 : 0.75, color: hot, a: (m === BEAM ? 2.2 : 1.3) * work * flicker });
        }
      });
    }
    return {
      pos, radius: R, color: b.color, kind: world.kind, seed: world.seed, spin: b.turned,
      tilt: world.tilt, p: world.p, scale: world.scale, color2: world.color2, ring: world.ring, air: world.air,
      active: b.glow, waiting: b.waiting ? 1 : 0, blip: b.blip, land: b.land, moons: [...moons, ...own], grown: b.grown ?? GROWN_USUAL,
      ...(rocks ? { rocks, rough: world.p[3] } : {}),
    };
  });

  const lines = o.lines.map((l) => {
    const b = o.bodies[l.body];
    return { rot: l.rot, turn: b ? turns[l.body] : NO_TURN, lit: l.lit, color: b?.color ?? GREY, tone: b && (b.glow > 0.3 || b.waiting || b.focused) ? 0.75 : 0, tail: !!b };
  });
  return {
    frame: { time: o.seconds, cam, sun: { radius: HD_SUN, active: o.sun.glow, waiting: o.sun.waiting ? 1 : 0, light: o.sun.light ?? 1 }, planets, lines, ping: o.ping, reach: o.reach, table: 1 - TABLE_FADE * spiral, points },
    spots: [...spots, ...sats, ...(o.marks ?? []).map((m) => spot(m.id, [m.x, 0, m.y], m.r))],
  };
}
