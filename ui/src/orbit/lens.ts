// A lens: another way of drawing Orbit, brought by a plugin (plugins/orbit-hd is one: the same
// system in three dimensions). Orbit itself is the flat view, and stays the whole of it without
// one: the clock, the crew, the names, the panel, the demo and the replay are all Orbit's. A lens
// only draws the sky, a frame at a time, from what Orbit hands it, and says back where everything
// landed on the screen, so the names can be put by each body and a click can find it.
//
// Turned on (its button in Orbit's top bar, or its key), Orbit gives it a canvas behind the
// names and mounts its Layer. The Layer attaches what draws (LensRuntime) and can put buttons of
// its own in Orbit's top bar (tools) and in the panel of whoever you're looking at (maker), as
// portals into those two places.

import type { ComponentType } from "react";
import type { Camera, Point, Spot } from "./scene.ts";

// One of the crew, this frame. i: which line they're on (0 nearest the sun); angle: where they are round it, in degrees.
export type LensBody = {
  id: string; i: number; angle: number;
  busy: boolean; quiet: boolean; waiting: boolean; focused: boolean;
  blip: number; land: number;                                   // how far a tool call's ring and a landing's ring have grown (0 to 1), or -1
  quests: boolean[];                                            // each quest they have out: whether it's waiting on you
  flight: { kind: "out" | "home"; since: number } | null;       // a comet on its way out to them, or home
  moonSize: number[]; grown?: number; sats?: number;
};

export type LensFrame = {
  seconds: number; dt: number; moving: boolean; turning: boolean;
  w: number; h: number; centre: Point; cam: Camera;
  lead: string; focus: string | null; focusAngle: number | null; // focusAngle: where whoever you're with is round the sun (degrees), when it's a planet
  sun: { leading: boolean; waiting: boolean; light: number };
  bodies: LensBody[];
  lines: { rot: number; lit: number; body: number }[];          // each line round the sun: how far it's turned (radians), how lit, and whose it is (-1: nobody's)
  ping: { r: number; a: number };                               // the ring the sun sends out: how far it's got, and how bright
  reach: number; flightMs: number;
  marks: (Point & { id: string; r: number })[];                 // what's holding at the edge of the system
};

export type LensRuntime = {
  // Draw this moment; answer where everything is on the screen (the sun first).
  frame(f: LensFrame): Spot[];
  // A drag across the sky, while it's on: it's the lens's to say what that does (HD turns the camera).
  drag(dx: number, dy: number, focus: string | null): void;
  // A key Orbit doesn't use itself: true if the lens took it.
  key?(key: string, shift: boolean): boolean;
};

export type LensProps = {
  canvas: HTMLCanvasElement;
  lead: string;
  bodies: { id: string; name: string }[];
  points: [number, number][][];                                  // each line round the sun, as points
  labelOf: (id: string) => HTMLElement | null | undefined;       // each one's name on the page (their colour is its --c)
  looking: { id: string; name: string } | null;                  // whose panel is open
  kitCount?: number;                                             // how many things they carry, when that's known
  tools: HTMLElement | null;                                     // in Orbit's top bar
  maker: HTMLElement | null;                                     // in the panel of whoever you're looking at (a planet)
  attach: (lens: LensRuntime) => () => void;
  unavailable: (why: string) => void;                            // it can't draw here: Orbit goes back to flat, and says why (until it's opened again)
  off: () => void;                                               // it stopped drawing (the browser took its canvas back): Orbit goes back to flat
};

export type OrbitLens = {
  id: string;            // a class on Orbit while it's on, and what it's remembered by
  label: string;         // its button
  key: string;           // its key (a letter)
  title: string;         // its button's explanation
  hint?: string;         // what a drag does while it's on ("turn")
  Layer: ComponentType<LensProps>;
};
