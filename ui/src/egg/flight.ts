// Barnstorm, the easter egg: the parts that are only arithmetic (no page, no canvas), so they
// can be tested as they are. The plane's flight, the code that starts it, and where a word
// begins and ends.

// ---------- The code that starts it ----------
export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

// Feed it each key as it's pressed; it answers true on the key that completes the code.
export function konami(): (key: string) => boolean {
  let at = 0;
  return (key) => {
    const k = key.length === 1 ? key.toLowerCase() : key;
    // A wrong key starts over, unless it's the code's own first key (so ↑↑↑ still counts as two).
    if (k === KONAMI[at]) at++;
    else if (k === KONAMI[0]) at = at >= 2 ? 2 : 1;
    else at = 0;
    if (at < KONAMI.length) return false;
    at = 0;
    return true;
  };
}

// ---------- Flight ----------
// The arrows push the plane; it keeps what speed it has and bleeds it off, so it glides and
// overshoots a little. The nose swings round to where you're pushing, and that's where the gun points.
export type Plane = { x: number; y: number; vx: number; vy: number; heading: number; bank: number };
export type Stick = { x: number; y: number }; // each -1, 0 or 1
export type Sky = { width: number; height: number };

export const THRUST = 1500; // px/s², while an arrow is held
export const DRAG = 2.6; // per second: top speed settles near THRUST / DRAG
export const TURN = 9; // radians a second
export const EDGE = 26; // how close to the edge of the window the plane's middle may come
export const UP = -Math.PI / 2;

export const newPlane = (sky: Sky): Plane => ({ x: sky.width / 2, y: sky.height / 2, vx: 0, vy: 0, heading: UP, bank: 0 });

// The shortest way round from one angle to another.
export function turnBetween(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function stepPlane(p: Plane, stick: Stick, dt: number, sky: Sky): Plane {
  const pushing = stick.x !== 0 || stick.y !== 0;
  const len = Math.hypot(stick.x, stick.y) || 1;
  const ax = (stick.x / len) * THRUST, ay = (stick.y / len) * THRUST;
  const slow = Math.exp(-DRAG * dt);
  let vx = (p.vx + (pushing ? ax * dt : 0)) * slow;
  let vy = (p.vy + (pushing ? ay * dt : 0)) * slow;
  let x = p.x + vx * dt, y = p.y + vy * dt;
  // The edge of the window: stop there, with a small bounce back.
  if (x < EDGE) { x = EDGE; vx = Math.abs(vx) * 0.3; } else if (x > sky.width - EDGE) { x = sky.width - EDGE; vx = -Math.abs(vx) * 0.3; }
  if (y < EDGE) { y = EDGE; vy = Math.abs(vy) * 0.3; } else if (y > sky.height - EDGE) { y = sky.height - EDGE; vy = -Math.abs(vy) * 0.3; }

  let heading = p.heading, turning = 0;
  if (pushing) {
    const want = turnBetween(p.heading, Math.atan2(stick.y, stick.x));
    const most = TURN * dt;
    turning = Math.max(-most, Math.min(most, want));
    heading = p.heading + turning;
  }
  // The roll into a turn (-1 left, 1 right), eased so the wings don't snap.
  const lean = dt > 0 ? Math.max(-1, Math.min(1, turning / (TURN * dt))) : 0;
  const bank = p.bank + (lean - p.bank) * Math.min(1, dt * 12);
  return { x, y, vx, vy, heading, bank };
}

// ---------- The plane, a pixel at a time ----------
// Nose up. Each letter is a colour in PAINT; a dot is nothing.
export const SPRITE = [
  "........D........",
  ".....YYYDYYY.....",
  ".......DLD.......",
  ".......DLD.......",
  ".......DCD.......",
  ".DDDDDDDCDDDDDDD.",
  "DGGRGGGLLLGGGRGGD",
  "DGGGGGGLLLGGGGGGD",
  ".DDDDDGGLGGDDDDD.",
  "......DGLGD......",
  "......DGLGD......",
  ".......DLD.......",
  ".....DDGLGDD.....",
  "....DGGGLGGGD....",
  ".....DDDDDDD.....",
];
export const PAINT: Record<string, string> = { D: "#16233f", G: "#b9c0cc", L: "#f3f5f8", C: "#4fb3e8", R: "#d8402f", Y: "#f0c040" };
export const PIXEL = 3; // page pixels to one of the plane's
// The one gun is in the nose, so the shots leave along the line the plane is pointing: this far
// ahead of its middle, just clear of the propeller.
export const GUN_AHEAD = 8 * PIXEL;

export const BULLET_SPEED = 950; // px/s
export const FIRE_EVERY = 0.09; // seconds between shots while space is held

// Where the gun's muzzle is right now: dead ahead of the plane's middle.
export function muzzle(p: Plane): { x: number; y: number } {
  return { x: p.x + Math.cos(p.heading) * GUN_AHEAD, y: p.y + Math.sin(p.heading) * GUN_AHEAD };
}

// ---------- Words ----------
// The word (a run of anything but spaces) that the caret at `offset` is in or touching, as
// [start, end), or null where there's only space.
export function wordAt(text: string, offset: number): [number, number] | null {
  const solid = (i: number) => i >= 0 && i < text.length && !/\s/.test(text[i]);
  let at = solid(offset) ? offset : solid(offset - 1) ? offset - 1 : -1;
  if (at < 0) return null;
  let start = at, end = at + 1;
  while (solid(start - 1)) start--;
  while (solid(end)) end++;
  return [start, end];
}

// Every word in a piece of text, as [start, end).
export function wordsIn(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/\S+/g)) out.push([m.index, m.index + m[0].length]);
  return out;
}

// ---------- The score ----------
export const POINTS = { word: 10, edge: 15, part: 25, shell: 50 } as const;
export const GREMLIN_POINTS = 40; // for shooting one of the gremlins that mend the page (gremlins.ts)
export type Kind = keyof typeof POINTS;
export const scoreText = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");
