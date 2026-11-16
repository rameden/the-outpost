// The HD view's camera: where it stands, and where a point of the system lands on the screen through it.
import { expect, test } from "vitest";
import { camera3, distFor, project, rgbOf, turnTo, type Vec3 } from "./math.ts";

const FOV = 0.66, W = 1440, H = 860;

test("looking straight down, a quarter turn round, it shows the flat view exactly: x across, the flat view's y down the screen", () => {
  const k = 1.5; // screen pixels to one of the drawing's units
  const cam = camera3({ target: [0, 0, 0], yaw: Math.PI / 2, pitch: Math.PI / 2, dist: distFor(k, H, FOV), fov: FOV, w: W, h: H });
  for (const [x, y] of [[0, 0], [120, 0], [0, 80], [-200, -150]]) {
    const s = project(cam, [x, 0, y], W, H);
    expect(s.x).toBeCloseTo(W / 2 + x * k, 0);
    expect(s.y).toBeCloseTo(H / 2 + y * k, 0);
    expect(s.scale).toBeCloseTo(k, 2); // and a body there is drawn at the flat view's size
    expect(s.behind).toBe(false);
  }
});

test("what it looks at lands where it's told to, and stays there however the camera is turned or tipped", () => {
  const target: Vec3 = [96, 0, -40];
  for (const [yaw, pitch] of [[Math.PI / 2, 0.6], [0.3, 0.2], [4, 1.2]]) {
    const cam = camera3({ target, yaw, pitch, dist: 300, fov: FOV, w: W, h: H, cx: 530, cy: 422 });
    const s = project(cam, target, W, H);
    expect(s.x).toBeCloseTo(530, 1);
    expect(s.y).toBeCloseTo(422, 1);
    expect(Math.hypot(cam.eye[0] - target[0], cam.eye[1] - target[1], cam.eye[2] - target[2])).toBeCloseTo(300, 3);
    expect(cam.eye[1]).toBeGreaterThan(0); // it's always above the table
  }
});

test("tipped over, what's further off is smaller and higher up the screen; what's behind the camera isn't on it at all", () => {
  const cam = camera3({ target: [0, 0, 0], yaw: Math.PI / 2, pitch: 0.5, dist: 400, fov: FOV, w: W, h: H });
  const near = project(cam, [0, 0, 150], W, H), far = project(cam, [0, 0, -150], W, H);
  expect(near.scale).toBeGreaterThan(far.scale);
  expect(near.y).toBeGreaterThan(far.y);
  expect(project(cam, [0, 0, 2000], W, H).behind).toBe(true);
});

test("the short way round between two angles, and a colour as the stylesheet writes it", () => {
  expect(turnTo(0.1, 0)).toBeCloseTo(0.1);
  expect(turnTo(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2);  // not most of a turn the other way
  expect(turnTo(-3, 3)).toBeCloseTo(2 * Math.PI - 6);
  expect(rgbOf("#93c47d")).toEqual([147 / 255, 196 / 255, 125 / 255]);
  expect(rgbOf(" #fa0 ")).toEqual([1, 170 / 255, 0]);
  expect(rgbOf("rgb(60, 143, 159)")).toEqual([60 / 255, 143 / 255, 159 / 255]);
  expect(rgbOf("")).toBe(null);
  expect(rgbOf("var(--c-other)")).toBe(null);
});
