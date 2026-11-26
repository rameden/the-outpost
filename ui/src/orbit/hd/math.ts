// The arithmetic of Orbit's HD view: a camera in three dimensions, and where a point of the
// system lands on the screen through it. Plain numbers, nothing of the page or of WebGL in it,
// so it can be checked by itself (the drawing is renderer.ts).
//
// The system lies flat on the plane y = 0: what the flat view calls (x, y) is (x, 0, z) here, so
// looking straight down on it with the camera's yaw at a quarter turn shows exactly the flat
// view's layout. That is how HD opens, before it tilts.

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array; // column-major, as WebGL takes it

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

// The camera: where it is, the way it faces, and the two matrices that put the world on the screen.
// shift: how far off the middle of the screen what it looks at lands (the panel takes the room on one side).
export type Camera3 = {
  eye: Vec3; right: Vec3; up: Vec3; fwd: Vec3; view: Mat4; proj: Mat4; viewProj: Mat4;
  tanHalf: number; aspect: number; shift: [number, number]; near: number;
};

export const NEAR = 2, FAR = 9000;

// It looks at `target` from `dist` away: `yaw` round it (a quarter turn puts it on the near side,
// as the flat view is drawn), `pitch` up from the plane (a quarter turn is straight down).
// (cx, cy): where on the screen the target lands.
export function camera3(o: { target: Vec3; yaw: number; pitch: number; dist: number; fov: number; w: number; h: number; cx?: number; cy?: number }): Camera3 {
  const pitch = Math.min(Math.PI / 2 - 0.001, Math.max(0.02, o.pitch));
  const eye: Vec3 = [
    o.target[0] + o.dist * Math.cos(pitch) * Math.cos(o.yaw),
    o.target[1] + o.dist * Math.sin(pitch),
    o.target[2] + o.dist * Math.cos(pitch) * Math.sin(o.yaw),
  ];
  const fwd = unit(sub(o.target, eye));
  // Straight down there's no "up" to take from the world: screen-up is then away from where the camera stands.
  const right = unit(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  const view = new Float32Array([
    right[0], up[0], -fwd[0], 0,
    right[1], up[1], -fwd[1], 0,
    right[2], up[2], -fwd[2], 0,
    -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1,
  ]);
  const tanHalf = Math.tan(o.fov / 2), aspect = o.w / Math.max(1, o.h), f = 1 / tanHalf;
  const shift: [number, number] = [((o.cx ?? o.w / 2) - o.w / 2) / (o.w / 2), -((o.cy ?? o.h / 2) - o.h / 2) / (o.h / 2)];
  const proj = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    -shift[0], -shift[1], (FAR + NEAR) / (NEAR - FAR), -1,
    0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0,
  ]);
  return { eye, right, up, fwd, view, proj, viewProj: multiply(proj, view), tanHalf, aspect, shift, near: NEAR };
}

// How far back the camera stands for what it looks at to be drawn `k` screen pixels to one of the
// drawing's units, on a screen `h` pixels tall: the HD view's zoom is the flat view's, said this way.
export const distFor = (k: number, h: number, fov: number) => h / 2 / (Math.tan(fov / 2) * Math.max(k, 1e-6));

// Where a point lands on a screen w by h, and how many pixels one of the drawing's units is at its
// depth (so a body's radius can be drawn, or hit). behind: it's behind the camera, and isn't on the screen at all.
export function project(cam: Camera3, p: Vec3, w: number, h: number): { x: number; y: number; scale: number; behind: boolean } {
  const m = cam.viewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const d = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]; // how far in front of the camera
  if (d <= cam.near) return { x: -1e5, y: -1e5, scale: 0, behind: true };
  return { x: (x / d * 0.5 + 0.5) * w, y: (1 - (y / d * 0.5 + 0.5)) * h, scale: h / 2 / (cam.tanHalf * d), behind: false };
}

// The difference between two angles, the short way round.
export const turnTo = (from: number, to: number) => { const d = (from - to) % (2 * Math.PI); return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d; };

// A colour as the stylesheet writes it (#rgb, #rrggbb, rgb(r, g, b)), as three numbers from 0 to 1.
export function rgbOf(css: string): Vec3 | null {
  const s = css.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Vec3;
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return rgb ? [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255] : null;
}
