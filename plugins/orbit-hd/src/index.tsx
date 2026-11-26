// HD Orbit, the plugin: a lens for Orbit (ui/src/orbit/lens.ts) that draws the same system in
// three dimensions, as lit worlds round a sun of plasma (renderer.ts, WebGL 2). Orbit keeps all
// that it is, the clock, the crew, the names, the panel and the demo, and lays them over this.
// It opens looking straight down, which is the flat view exactly, and tips over into depth; there,
// dragging turns the camera about what it's looking at. A browser that can't draw it stays flat,
// and says so.
//
// What each world is like is made up from a number (worlds.ts): Reroll (or R) picks another number
// and so other worlds, and Shift+R goes back to the camp's own. The number is remembered, so the
// worlds you settle on are the ones you come back to. Any one world can be made your own as well:
// the panel of whoever you're looking at has a world maker (Maker.tsx) to roll that one again by
// itself, or change it a setting at a time. What you've changed is remembered for that crew
// member, and stays theirs when the rest are rerolled. Spiral (or S) shows the corkscrew each
// world really makes as the sun carries the system along.

import "./orbit-hd.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nameNow, storeGet, storeSet, w, type LensProps, type OrbitLens, type OutpostPlugin } from "@outpost/sdk";
import { hdFrame, type HdBody } from "./frame.ts";
import { rgbOf, turnTo, type Vec3 } from "./math.ts";
import { createHd, type HdRenderer } from "./renderer.ts";
import { WorldMaker } from "./Maker.tsx";
import { customised, newSeed, worldsFor, type Custom, type World } from "./worlds.ts";

const WORLDS_KEY = "camp-orbit-worlds", CUSTOM_KEY = "camp-orbit-custom", SPIRAL_KEY = "camp-orbit-spiral";
// Where the camera stands. Over the whole system it looks down from a little above (and drifts round slowly); with a
// planet, from low and to one side of the line to the sun, so the planet is half lit with the sun in the sky behind it.
const OVER = 0.6, NEAR = 0.2, SUNWARD = 0.34, SIDE = 1.62, DRIFT = 0.022;
const CLOSER = 1.2;   // a little closer than the flat view's zoom: there's a world to look at now
const SETTLE_S = 0.62; // how quickly it turns to where it's headed (a little slower than Orbit's camera moves)
const NO_COLOUR: Vec3 = [0.49, 0.72, 0.77];

// What you've changed about each crew member's world, as it's kept in this browser (nothing, if what's kept can't be read).
function keptCustom(): Record<string, Custom> {
  try { const kept = JSON.parse(storeGet(CUSTOM_KEY) ?? "{}"); return kept && typeof kept === "object" && !Array.isArray(kept) ? kept : {}; } catch { return {}; }
}

function HdLayer({ canvas, lead, bodies, points, labelOf, looking, kitCount, tools, maker, attach, unavailable, off }: LensProps) {
  // What the worlds are made up from (0: the camp's own), remembered; Reroll picks another.
  const [seed, setSeed] = useState(() => Number(storeGet(WORLDS_KEY)) || 0);
  const roll = useCallback((to: number) => { storeSet(WORLDS_KEY, String(to)); setSeed(to); }, []);
  // What you've changed about any one world (by crew member), remembered too.
  const [custom, setCustom] = useState(keptCustom);
  const recustom = useCallback((change: (was: Record<string, Custom>) => Record<string, Custom>) => setCustom((was) => { const now = change(was); storeSet(CUSTOM_KEY, JSON.stringify(now)); return now; }), []);
  const [spiral, setSpiral] = useState(() => storeGet(SPIRAL_KEY) === "1");
  const toggleSpiral = useCallback(() => setSpiral((on) => { storeSet(SPIRAL_KEY, on ? "0" : "1"); return !on; }), []);
  const spiralOn = useRef(spiral);
  spiralOn.current = spiral;
  const [made, setMade] = useState(() => new Map<string, World>()); // the worlds as they stand, for the maker to show
  const colours = useRef(new Map<string, Vec3>()), worlds = useRef(new Map<string, World>());
  const view = useRef<HdRenderer | null>(null);

  // Each one's colour, as the stylesheet has it for their class (read off their name on the page), and their world.
  useLayoutEffect(() => {
    colours.current = new Map(bodies.flatMap((b) => {
      const el = labelOf(b.id), c = el ? rgbOf(getComputedStyle(el).getPropertyValue("--c")) : null;
      return c ? [[b.id, c] as [string, Vec3]] : [];
    }));
    const crewNow = bodies.filter((b) => b.id !== lead).map((b) => ({ id: b.id, color: colours.current.get(b.id) ?? NO_COLOUR }));
    worlds.current = new Map(worldsFor(seed, crewNow).map((world, i) => [crewNow[i].id, customised(world, custom[crewNow[i].id], crewNow[i])]));
    setMade(worlds.current);
  }, [bodies, lead, labelOf, seed, custom]);

  // The renderer, and what draws with it a frame at a time.
  useEffect(() => {
    const hd = createHd(canvas);
    if (!hd) { unavailable("HD needs WebGL 2, which this browser isn't offering"); return; }
    view.current = hd;
    hd.setLines(points); sent.current = points;
    // The camera's own: free of anyone, a yaw (a quarter turn is the flat view's way up) and a height; with a planet,
    // a yaw measured from the line out from the sun, so it goes round with it. `off`: how far it still has to turn.
    // It opens looking straight down, which is the flat view exactly, and tips over into depth from there.
    const cam = { yawFree: Math.PI / 2, pitchFree: OVER, yawRel: SIDE, pitchRel: NEAR, yaw: Math.PI / 2, pitch: Math.PI / 2 - 0.01, off: { yaw: 0, pitch: 0 }, focus: undefined as string | null | undefined };
    const glows: Record<string, number> = {}, turned: Record<string, number> = {};
    let wake = 0;
    const lost = (ev: Event) => { ev.preventDefault(); off(); };
    canvas.addEventListener("webglcontextlost", lost);
    const detach = attach({
      frame(f) {
        const planet = !!f.focus && f.focus !== f.lead && f.focusAngle !== null;
        const target = () => ({
          yaw: planet ? ((f.focusAngle ?? 0) * Math.PI) / 180 + cam.yawRel : cam.yawFree,
          pitch: planet ? cam.pitchRel : f.focus === f.lead ? SUNWARD : cam.pitchFree,
        });
        if (f.focus !== cam.focus) { // a new thing to look at: each planet is first seen from the same side, low down, and it turns there from where it is
          if (planet) { cam.yawRel = SIDE; cam.pitchRel = NEAR; }
          cam.focus = f.focus;
          const at = target();
          cam.off = { yaw: turnTo(cam.yaw, at.yaw), pitch: cam.pitch - at.pitch };
        }
        if (f.moving && !f.focus && !f.turning) cam.yawFree += f.dt * DRIFT; // over the whole system, it drifts round
        const at = target(), slow = f.moving ? Math.exp(-f.dt / SETTLE_S) : 0;
        cam.off.yaw *= slow; cam.off.pitch *= slow;
        cam.yaw = at.yaw + cam.off.yaw; cam.pitch = at.pitch + cam.off.pitch;
        const rise = f.moving ? 1 - Math.exp(-f.dt / 0.45) : 1; // how quickly a world lights up as its crew member starts work, and dims after
        const glow = (id: string, to: number) => (glows[id] = (glows[id] ?? 0) + (to - (glows[id] ?? 0)) * rise);
        const lit: HdBody[] = f.bodies.map((b) => {
          const world = worlds.current.get(b.id) ?? worldsFor(0, [{ id: b.id, color: NO_COLOUR }])[0];
          turned[b.id] = (turned[b.id] ?? b.i * 1.7) + (f.moving ? f.dt * world.spin : 0); // (kept, so changing how fast it spins doesn't fling it round)
          return {
            id: b.id, i: b.i, angle: b.angle, color: colours.current.get(b.id) ?? NO_COLOUR, world, turned: turned[b.id],
            glow: glow(b.id, b.busy ? (b.quiet ? 0.25 : 1) : 0), waiting: b.waiting, focused: b.focused, blip: b.blip, land: b.land,
            quests: b.quests, flight: b.flight, moonSize: b.moonSize, grown: b.grown, sats: b.sats,
          };
        });
        wake += ((spiralOn.current ? 1 : 0) - wake) * (f.moving ? 1 - Math.exp(-f.dt / 0.6) : 1);
        const drawn = hdFrame({
          seconds: f.seconds, w: f.w, h: f.h, cx: f.centre.x, cy: f.centre.y, at: f.cam, k: f.cam.k * CLOSER, yaw: cam.yaw, pitch: cam.pitch,
          lead: f.lead, sun: { glow: glow(f.lead, f.sun.leading ? 1 : 0), waiting: f.sun.waiting, light: f.sun.light }, spiral: wake, bodies: lit,
          lines: f.lines, ping: f.ping, reach: f.reach, flightMs: f.flightMs, marks: f.marks,
        });
        hd.resize(f.w, f.h, window.devicePixelRatio || 1);
        hd.draw(drawn.frame);
        return drawn.spots;
      },
      // A drag turns the camera about what it's looking at (and stays with whoever that is).
      drag(dx, dy, focus) {
        if (focus && focus !== lead) { cam.yawRel -= dx * 0.006; cam.pitchRel = Math.min(1.5, Math.max(0.04, cam.pitchRel + dy * 0.005)); }
        else { cam.yawFree -= dx * 0.006; if (!focus) cam.pitchFree = Math.min(1.5, Math.max(0.08, cam.pitchFree + dy * 0.005)); }
      },
      key(key, shift) {
        if (key === "r" || key === "R") roll(shift ? 0 : newSeed());
        else if (key === "s" || key === "S") toggleSpiral();
        else return false;
        return true;
      },
    });
    return () => { detach(); canvas.removeEventListener("webglcontextlost", lost); view.current = null; hd.dispose(); };
  }, [canvas]); // eslint-disable-line react-hooks/exhaustive-deps
  // Later changes only: a new renderer is handed the lines as it's made.
  const sent = useRef(points);
  useEffect(() => { if (sent.current !== points) { sent.current = points; view.current?.setLines(points); } }, [points]);

  const mine = looking && looking.id !== lead ? made.get(looking.id) : undefined;
  return <>
    {tools && createPortal(<>
      <button type="button" className="orb-tool worded" onClick={(ev) => roll(ev.shiftKey ? 0 : newSeed())}
        title={`Reroll: make up other worlds for the ${w("crew")} (R). Each keeps its ${w("crew")} member's colour, the ${nameNow("Artificer")} keeps a station, and a world you've made your own stays as you made it.${seed ? ` Shift-click (or Shift+R) for the ${w("camp")}'s own.` : ""}`}>Reroll</button>
      <button type="button" className="orb-tool worded" aria-pressed={spiral} onClick={toggleSpiral}
        title={spiral ? "Back to flat rings (S)" : "Spiral: the sun carries the system through space, so each world really travels a corkscrew round its path. Shows the wake each one leaves (S)"}>Spiral</button>
    </>, tools)}
    {maker && looking && mine && createPortal(
      <WorldMaker name={looking.name} world={mine} changed={!!custom[looking.id]} kit={kitCount}
        onChange={(c) => recustom((was) => ({ ...was, [looking.id]: { ...was[looking.id], ...c } }))}
        onRoll={() => recustom((was) => ({ ...was, [looking.id]: { roll: newSeed(), ...(was[looking.id]?.kind !== undefined ? { kind: was[looking.id].kind } : {}) } }))} // (it stays the kind of thing you said it was)
        onReset={() => recustom(({ [looking.id]: _gone, ...rest }) => rest)} />, maker)}
  </>;
}

export const orbitLens: OrbitLens = {
  id: "hd", label: "HD", key: "h", hint: "turn", Layer: HdLayer,
  title: "HD: the same system in three dimensions, as lit worlds round a sun (H). A proof of concept.",
};
const plugin: OutpostPlugin = { orbitLens };
export default plugin;
