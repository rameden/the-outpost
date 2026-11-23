// Orbit: the camp at rest (components/MaeSystem.tsx), grown to fill the screen and wired to what
// the crew is really doing. The Quartermaster is the sun and everyone else circles it on their own
// contour line, as on the blank page, but here nothing is acted out: a planet lights up while its
// crew member is working, carries a moon for each quest they have out, and shows what they're doing
// under its name. When the Quartermaster sends a quest, a comet in that crew member's colour really
// does leave the sun for their planet; when they report, one flies home and the sun sends a ring
// out, lighting each line as it passes. A tool call is a small ring off the planet.
//
// You can look closer. Scroll to zoom and drag to move; click a planet (or its cell along the
// bottom, or press its number) and the camera flies to it and stays with it as it goes round, and
// a panel opens with what that crew member is doing: each quest that's out, how long for, its last
// few steps, and the words of a reply as they arrive. The sun's panel is the Quartermaster's: the
// expeditions under way and how each plan stands. Esc steps back out to the whole system, and
// again leaves.
//
// It opens over the page and under everything that opens over the page, so an agent's page, the
// command palette or Settings can be opened from here and sit on top of it. It is always dark,
// whatever the theme: it's the night sky.
//
// And it has HD (the HD button, or H): a proof of concept that draws the same system in three
// dimensions (hd/), as lit worlds round a sun of plasma. Everything else is as it was: the same
// clock, the same crew, the same names, panel and demo laid over it. It opens looking straight
// down, which is the flat view exactly, and tips over into depth; there, dragging turns the
// camera about what it's looking at. A browser that can't draw it stays flat, and says so.
// What each world is like there is made up from a number (hd/worlds.ts): Reroll (or R) picks
// another number and so other worlds, and Shift+R goes back to the camp's own. The number is
// remembered, so the worlds you settle on are the ones you come back to.
// Any one world can be made your own as well: with HD on, the panel of whoever you're looking at
// has a world maker (hd/Maker.tsx) to roll that one again by itself, or change it a setting at a
// time, rings and moons and satellites and all. What you've changed is remembered for that crew
// member, and stays theirs when the rest are rerolled.
//
// It has a demo (the Demo button, D, or /orbit demo): a pretend camp, playing one expedition after
// another, for seeing the view busy without sending anyone anywhere (demo.ts). The demo has a feed
// of its own, so nothing of it reaches the real one, and it says plainly that it's pretend. What
// would take you to the work (a quest in its conversation, a decision) isn't offered there: there
// is no such work.
//
// How it's drawn: the system is SVG, and everything in it that moves is moved from here, a frame
// at a time, off one clock (scene.ts has the arithmetic): the planets, their moons, the sun's
// dials, a comet in flight, and the camera looking at it all. None of it is left to the
// stylesheet, as the small drawing's motion is, and that matters: the browser runs a stylesheet's
// animation on its own, a frame apart from anything a script moves, so a moon turned by the
// stylesheet round a planet the camera is following shakes against it. The names are HTML laid
// over the drawing, so they stay the same size at any zoom. For anyone who has asked their system
// for less motion the planets rest where they start, the camera cuts rather than flies, and
// nothing is sent across the sky; what each is doing is still all there.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { api, errorText, storeGet, storeSet } from "../api.ts";
import { contour, contourPoints, LAP, MARKS, stretch, TAIL } from "../components/MaeSystem.tsx";
import { Icon } from "../components/bits.tsx";
import { runningCount, type CrewStatus, type QuestOut } from "../feed/reducer.ts";
import { createFeedStore, useFeed, type FeedStore } from "../feed/store.ts";
import { calledEver, cClass, cx, money } from "../format.ts";
import { w } from "../words.ts";
import { motionOK } from "../motion.tsx";
import type { CampEvent, CampState } from "../types.ts";
import { direct, type Cut } from "./ambient.ts";
import { DEMO_CREW, demoCamp, runDemo } from "./demo.ts";
import { waysKey, waysOf } from "./doing.ts";
import { hdFrame, type HdBody } from "./hd/frame.ts";
import { rgbOf, turnTo, type Vec3 } from "./hd/math.ts";
import { createHd, type HdRenderer } from "./hd/renderer.ts";
import { Slide, WorldMaker } from "./hd/Maker.tsx";
import { customised, newSeed, worldsFor, type Custom, type World } from "./hd/worlds.ts";
import { grownOf, kitOf, SATS_MAX } from "./kit.ts";
import { arc, moonOf, sayOf, shipAt, shipsOf, spendOf, stalled, tightest, wayAt, MOON_R, NEAR_FULL, SHIP_OUT, SHIPS, WAY_APART, WAY_R, WAY_SIZE, WAYS, type Ship } from "./meaning.ts";
import { Panel, useNow, type Body } from "./Panel.tsx";
import { reelOf, type Reel } from "./replay.ts";
import { Timeline, type Time } from "./Timeline.tsx";
import {
  PLANET_R, STARS, SUN_R, angleAt, clampZoom, closeZoom, ease, fitZoom, hit, lapOf, linesFor, orbitOf, placeAt, reachOf, toScreen, withinReach, wrap, zoomAbout,
  type Camera, type Point, type Spot,
} from "./scene.ts";

const LEAD = "quartermaster";
const IDLE: CrewStatus = { status: "idle", line: "" };

export const FLIGHT_MS = 1600; // a quest's flight out to its planet, or a report's flight home
export const RING_MS = 900;    // the ring a planet gives as a quest lands, or (smaller) for a tool call
export const PING_MS = 3400;   // the ring the sun sends out…
const PING_SPEED = 122;        // …and how fast it grows, in the drawing's units a second
const LIT_MS = 550;            // how long a line stays lit as that ring passes through it
const ALONE_MS = 9000;         // with nothing running, the sun sends a ring this often
const FRESH_MS = 5000;         // an event older than this is the feed catching up, not something happening now
// A comet: a head and three smaller dots, each a moment behind the one ahead and fainter.
const COMET: [number, number, number][] = [[3.2, 0, 1], [2.6, 70, 0.6], [2, 140, 0.4], [1.4, 210, 0.25]]; // size, how far behind (ms), how bright
const COMET_MS = FLIGHT_MS + 210;
// As many moons as a planet is drawn with, however many quests it has out: how long each takes round it, and where it starts.
const MOON: [number, number][] = [[5.5, 0], [7.5, 100], [9.5, 240], [11.5, 140], [13.5, 310]];
const DRIFT = [150, -190, 230, -270]; // seconds for a line with nobody on it to drift once round (one way, then the other)
// HD: where the camera stands. Over the whole system it looks down from a little above (and drifts round slowly);
// with a planet, from low and to one side of the line to the sun, so the planet is half lit with the sun in the sky behind it.
const HD_KEY = "camp-orbit-hd", WORLDS_KEY = "camp-orbit-worlds", CUSTOM_KEY = "camp-orbit-custom", SUN_KEY = "camp-orbit-sun";
// How bright the sun can be set, in either view: from nearly out to as it's made (1).
export const SUN_LIGHT = [0.15, 1] as const;
// What you've changed about each crew member's world, as it's kept in this browser (nothing, if what's kept can't be read).
function keptCustom(): Record<string, Custom> {
  try { const kept = JSON.parse(storeGet(CUSTOM_KEY) ?? "{}"); return kept && typeof kept === "object" && !Array.isArray(kept) ? kept : {}; } catch { return {}; }
}
const HD_OVER = 0.6, HD_NEAR = 0.2, HD_SUNWARD = 0.34, HD_SIDE = 1.62, HD_DRIFT = 0.022, HD_CLOSER = 1.2;
const NO_COLOUR: Vec3 = [0.49, 0.72, 0.77];
const EASE_S = 0.26;           // how quickly the camera settles on what it's looking at
const FAR = 0.7;               // below this many screen pixels to one of the drawing's units, the names lose their second line
const WIDE = 900, PANEL = 380; // from this width the panel sits beside the system, and is this wide
const SPOKES = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
const WAY_PX = 7; // as big as a waypoint is drawn, in pixels
const BEAT_MS = 15_000;        // how often the picture looks again at how long things have been out, or quiet
// On the flat view the satellites of the one you're with go round it this far out (in the drawing's units), a lap in this many seconds.
const SAT_OUT = 36, SAT_LAP = 48;
// What's holding at the edge, by what it is: a request in the queue (a square), a job on a schedule (a diamond), a pull request (a craft).
const SHIP_SHAPE: Record<Ship["kind"], string> = { queued: "M-4 -4h8v8h-8z", job: "M0 -5.5L5.5 0L0 5.5L-5.5 0z", pr: "M-5 4.5L0 -5.5L5 4.5L0 2z" };
const SHIP_KIND: Record<Ship["kind"], string> = { queued: "queued", job: "scheduled", pr: "pull request" };
const short = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text);

// The time (a replay's, while one is playing).
function Clock({ clock }: { clock: () => number }) {
  const now = useNow(true, clock);
  return <>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</>;
}

// What's waiting at the edge of the system, as a list: the same things as the ships out there, each of which opens.
function Holding({ ships, open, live, onOpen }: { ships: Ship[]; open: string | null; live: boolean; onOpen: (id: string | null) => void }) {
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState("");
  async function release(s: Ship) {
    setBusy(s.id);
    setFailed("");
    try { await api("/api/queue/release", { id: s.ref }); } catch (e) { setFailed(errorText(e)); }
    setBusy("");
  }
  return (
    <aside className="orb-holding" aria-label="Waiting at the edge of the system">
      <h4>Holding at the edge</h4>
      <ul>
        {ships.map((s) => {
          const on = open === s.id;
          return (
            <li key={s.id} className={cx(`ship-${s.kind}`, s.bad && "bad", s.held && "held", on && "on")}>
              <button type="button" aria-expanded={on} onClick={() => onOpen(on ? null : s.id)}><i aria-hidden="true" /><span>{s.name}</span><em>{SHIP_KIND[s.kind]}</em></button>
              {on && (
                <div className="orb-holding-about">
                  <p>{s.detail}</p>
                  {live && s.kind === "queued" && s.ref && <button type="button" className="orb-btn" disabled={busy === s.id} onClick={() => release(s)}>{busy === s.id ? "Starting…" : "Start it without waiting"}</button>}
                  {s.url && <a className="orb-btn" href={s.url} target="_blank" rel="noreferrer">Open the pull request</a>}
                  {failed && <p className="orb-say-note bad" role="alert">{failed}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// onOpenAgent: an agent's page, which opens over this. onOpenQuest / onOpenConversation: go to where the
// work is, on the page underneath (whoever shows this closes it as they go). A decision that's waiting
// is answered here, in the panel of whoever asked. demo: open it on the demo.
export function Orbit({ S, store, onClose, onOpenAgent, onOpenQuest, onOpenConversation, demo: startInDemo = false }: {
  S: CampState | null; store: FeedStore; onClose: () => void; demo?: boolean;
  onOpenAgent?: (id: string) => void; onOpenQuest?: (q: QuestOut) => void; onOpenConversation?: (id: string) => void;
}) {
  const [demo, setDemo] = useState(startInDemo);
  // A replay: the last day's events, played into a feed of its own (Timeline.tsx plays them, and keeps the time it's showing).
  const [replay, setReplay] = useState<{ reel: Reel; store: FeedStore } | null>(null);
  const [told, setTold] = useState(""); // something to say along the top (there was nothing to replay)
  // Ambient: nobody is driving, and the camera goes to whoever just did something (ambient.ts decides who).
  const [ambient, setAmbient] = useState(false);
  const time = useRef<Time>({ now: null, quiet: false }).current;
  const clock = useCallback(() => time.now ?? Date.now(), [time]);
  const live = !demo && !replay; // the real camp as it is now: the only one that can be acted on
  // Who's in the sky: the Quartermaster in the middle, then everyone else from the nearest orbit out.
  // The demo is played by your own crew, or by the camp's own crew if there's nobody yet to play it.
  const bodies = useMemo<Body[]>(() => {
    const mine = S?.characters ?? [];
    const all: Body[] = demo && !mine.some((c) => c.id !== LEAD) ? DEMO_CREW : mine;
    const lead = all.find((c) => c.id === LEAD);
    return [lead ?? { id: LEAD, name: "Quartermaster" }, ...all.filter((c) => c.id !== LEAD)];
  }, [S?.characters, demo]);
  // The demo's own feed, played into for as long as the demo is on (and started over if the crew playing it changes).
  const cast = bodies.map((b) => `${b.name}\u0000${b.emoji ?? ""}`).join("\u0001");
  const pretend = useMemo(() => (demo ? createFeedStore() : null), [demo, cast]); // eslint-disable-line react-hooks/exhaustive-deps
  const actors = useRef(bodies);
  actors.current = bodies;
  useEffect(() => (pretend ? runDemo(pretend, actors.current[0], actors.current.slice(1)) : undefined), [pretend]);
  const feed = replay?.store ?? pretend ?? store;
  if (!live) onOpenQuest = onOpenConversation = onOpenAgent = undefined; // (there's no such work to go to)

  const crew = useFeed(feed, (s) => s.crew);
  const quests = useFeed(feed, (s) => s.quests);
  const asks = useFeed(feed, (s) => s.asks);
  const running = useFeed(feed, runningCount);
  // The plans of what's running, as waypoints round the sun (looked at again only when a step changes).
  const wayKey = useFeed(feed, waysKey);
  const ways = useMemo(() => waysOf(feed.getState()).slice(-WAYS), [feed, wayKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // How long something has been out, or quiet, changes with nothing happening: the picture looks again every so often.
  const [, setBeat] = useState(0);
  useEffect(() => { const t = setInterval(() => setBeat((n) => n + 1), replay ? 1000 : BEAT_MS); return () => clearInterval(t); }, [replay]);
  const now = clock();
  const statusOf = (b: Body) => crew[b.name] ?? IDLE;
  const outOf = (b: Body) => quests.filter((q) => q.who === b.name);
  const says = new Map(bodies.map((b) => [b.id, sayOf(statusOf(b), outOf(b), now)]));
  // What the camp reports besides the work: what each carries, how far along they are, what today has cost, and
  // what's waiting. The demo has a pretend camp's; a replay shows none of what is only true now.
  const pretence = useMemo(() => (demo ? demoCamp(bodies) : null), [demo, cast]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = !!pretence || !!(S?.installedSkills || S?.connectors); // (a camp that hasn't said what they carry keeps the world's own satellites)
  const xpOf = (b: Body): number | null => (pretence ? pretence.xp[b.name] ?? 0 : S ? S.xp?.[b.name] ?? 0 : null);
  const kits = useMemo(() => new Map(bodies.map((b) => [b.id, pretence ? pretence.kit[b.id] ?? [] : kitOf(S, b.id)])), [pretence, S?.installedSkills, S?.connectors, cast]); // eslint-disable-line react-hooks/exhaustive-deps
  const spend = pretence ? pretence.spend : live ? S?.spend ?? null : null;
  const limit = pretence ? pretence.limit : live ? tightest(S?.limits) : null;
  const ships = useMemo(() => (pretence ? pretence.ships : replay ? [] : shipsOf(S)).slice(0, SHIPS), [pretence, replay, S?.queued, S?.jobs, S?.prs]); // eslint-disable-line react-hooks/exhaustive-deps
  const planets = bodies.slice(1);
  const lines = linesFor(planets.length);
  const reach = reachOf(lines);
  const contours = useMemo(() => Array.from({ length: lines + 1 }, (_, i) => contour(i < lines ? orbitOf(i) : orbitOf(lines - 1) + 30, i)), [lines]);
  const grid = useMemo(() => SPOKES.map((a) => `M${((SUN_R + 26) * Math.cos(a)).toFixed(1)} ${((SUN_R + 26) * Math.sin(a)).toFixed(1)}L${(reach * Math.cos(a)).toFixed(1)} ${(reach * Math.sin(a)).toFixed(1)}`).join(""), [reach]);
  // What the drawing needs to know, wherever it's called from.
  const sceneNow = {
    ids: planets.map((p) => p.id), names: new Map(bodies.flatMap((b) => [...calledEver(b.id), b.name].map((n) => [n, b.id]))), lines, reach, running,
    busy: new Set(planets.filter((p) => crew[p.name]?.status === "active").map((p) => p.id)), leading: crew[bodies[0].name]?.status === "active",
    waiting: new Set(bodies.filter((b) => crew[b.name]?.status === "waiting").map((b) => b.id)),            // (HD draws from these two as well)
    quiet: new Set(planets.filter((p) => says.get(p.id)?.quiet).map((p) => p.id)),                          // at work, but all they have out has gone quiet
    out: new Map(planets.map((p) => [p.id, outOf(p).map((q) => q.waiting)])),
    // Each moon: how big it has grown (against a new one), and whether its quest has gone quiet.
    moons: new Map(planets.map((p) => [p.id, outOf(p).map((q) => ({ size: moonOf(now - q.started).r / MOON_R, stalled: stalled(q, now) }))])),
    grown: new Map(planets.map((p) => { const xp = xpOf(p); return [p.id, xp === null ? null : grownOf(xp)]; })),
    sats: new Map(planets.map((p) => [p.id, known ? Math.min(SATS_MAX, kits.get(p.id)?.length ?? 0) : null])),
    ships: ships.map((s) => s.id), ways: ways.length,
  };
  const scene = useRef(sceneNow);
  scene.current = sceneNow;

  // ---------- The camera ----------
  // What it's looking at: one of the crew (it stays with them), or a place you dragged it to. It
  // doesn't jump there: `off` is how far it still is from where it's headed, and that shrinks
  // away a frame at a time, so it arrives exactly, however the planet moves meanwhile.
  const [focus, setFocus] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [ship, setShip] = useState<string | null>(null);     // which of what's holding at the edge is open
  const [picked, setPicked] = useState<string | null>(null); // which satellite of the one you're with is open
  const v = useRef({
    focus: null as string | null, over: null as string | null, pan: { x: 0, y: 0 }, zoom: 1,
    off: { x: 0, y: 0, lk: Math.log(0.4), cx: 0, cy: 0, yaw: 0, pitch: 0 }, // (it opens from further out, and comes in)
    cam: { x: 0, y: 0, k: 1 } as Camera, centre: { x: 0, y: 0 }, spots: [] as Spot[],
    w: 0, h: 0, began: 0, last: 0, seconds: 0,
    // HD: where the camera stands round what it's looking at. Free of anyone, a yaw of its own (a quarter turn is the flat
    // view's way up) and a height; with a planet, a yaw measured from the line out from the sun, so it goes round with it.
    yawFree: Math.PI / 2, pitchFree: HD_OVER, yawRel: HD_SIDE, pitchRel: HD_NEAR, yaw: Math.PI / 2, pitch: Math.PI / 2, turning: false,
    bare: false, // nothing is open beside the system (ambient), so it has the whole screen
    sun: 1,      // how bright the sun is set (SUN_LIGHT)
  }).current;
  v.bare = ambient;
  const canvas = useRef<HTMLCanvasElement>(null);
  const hdView = useRef<HdRenderer | null>(null);
  const colours = useRef(new Map<string, Vec3>()), worlds = useRef(new Map<string, World>()), glows = useRef<Record<string, number>>({}).current;
  const turned = useRef<Record<string, number>>({}).current; // how far each world has turned on its axis (kept, so changing how fast it spins doesn't fling it round)
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<SVGGElement>(null);
  type Part = { orbit?: SVGGElement | null; upright?: SVGGElement | null; label?: HTMLElement | null; busy?: SVGGElement | null; comet?: SVGGElement | null; land?: SVGCircleElement | null; blip?: SVGCircleElement | null; gauge?: SVGGElement | null; moons: (SVGGElement | null)[] };
  const parts = useRef<Record<string, Part>>({}).current;
  const part = (id: string) => (parts[id] ??= { moons: [] });
  const sheets = useRef<(HTMLElement | null)[]>([]).current;
  const drifts = useRef<(SVGGElement | null)[]>([]).current, lits = useRef<(SVGPathElement | null)[]>([]).current;
  const dials = useRef<(SVGGElement | null)[]>([]).current;
  const core = useRef<SVGCircleElement>(null), corona = useRef<SVGCircleElement>(null), pingRing = useRef<SVGCircleElement>(null);
  // What's crossing the sky, by when it began (on the drawing's own clock): a quest out to a planet or a report home
  // from it, the ring as one lands, the small ring for a tool call, and the ring the sun sends. None of it is the
  // page's state: it's drawn straight from here, so a burst of tool calls costs the page nothing.
  const sky = useRef({ flights: {} as Record<string, { kind: "out" | "home"; at: number }>, lands: {} as Record<string, number>, blips: {} as Record<string, number>, ping: 0, pinged: 0, dial: [0, 0] }).current;
  const reticle = useRef<SVGPathElement>(null), hoverMark = useRef<SVGPathElement>(null), leader = useRef<SVGPathElement>(null);
  const zoomRead = useRef<HTMLElement>(null), bearing = useRef<HTMLElement>(null);
  const wayEl = useRef<SVGGElement>(null), shipEls = useRef<(SVGGElement | null)[]>([]).current, satEls = useRef<(SVGGElement | null)[]>([]).current;

  // Where the camera is headed, this moment.
  const target = useCallback(() => {
    const { ids, lines } = scene.current;
    const i = v.focus ? ids.indexOf(v.focus) : -1;
    const at: Point = v.focus === LEAD ? { x: 0, y: 0 } : i >= 0 ? placeAt(i, v.seconds) : v.pan;
    // With the panel open the system is looked at from the room that's left: beside it, or above it on a narrow screen.
    const beside = v.focus && !v.bare && v.w >= WIDE, above = v.focus && !v.bare && v.w < WIDE;
    return {
      x: at.x, y: at.y, k: fitZoom(v.w, v.h, lines) * v.zoom, cx: beside ? (v.w - PANEL) / 2 : v.w / 2, cy: above ? 56 + (v.h * 0.5 - 56) / 2 : v.h / 2 - 8,
      yaw: i >= 0 ? (angleAt(i, v.seconds) * Math.PI) / 180 + v.yawRel : v.yawFree, pitch: i >= 0 ? v.pitchRel : v.focus === LEAD ? HD_SUNWARD : v.pitchFree,
    };
  }, [v]);
  // Change what it's headed for without it jumping: it carries on from where it is now.
  const retarget = useCallback((change: () => void) => {
    if (!v.w) return change();
    const was = { ...v.cam, cx: v.centre.x, cy: v.centre.y, yaw: v.yaw, pitch: v.pitch };
    change();
    const at = target();
    v.off = { x: was.x - at.x, y: was.y - at.y, lk: Math.log(was.k / at.k), cx: was.cx - at.cx, cy: was.cy - at.cy, yaw: turnTo(was.yaw, at.yaw), pitch: was.pitch - at.pitch };
  }, [v, target]);

  const draw = useCallback((now: number) => {
    const el = root.current;
    if (!el) return;
    const { ids, lines } = scene.current;
    const moving = motionOK();
    now = Math.max(now, v.last); // (the clock only goes forwards)
    v.began ||= now;
    const dt = Math.min(0.1, (now - (v.last || now)) / 1000);
    v.last = now;
    v.seconds = moving ? (now - v.began) / 1000 : 0;
    v.w = el.clientWidth || window.innerWidth;
    v.h = el.clientHeight || window.innerHeight;

    const hd = hdView.current;
    if (hd && moving && !v.focus && !v.turning) v.yawFree += dt * HD_DRIFT; // over the whole system, the camera drifts round it
    const at = target(), off = v.off, keep = moving ? Math.exp(-dt / EASE_S) : 0, slow = moving ? Math.exp(-dt / (EASE_S * 2.4)) : 0;
    off.x *= keep; off.y *= keep; off.lk *= keep; off.cx *= keep; off.cy *= keep; off.yaw *= slow; off.pitch *= slow;
    v.yaw = at.yaw + off.yaw; v.pitch = at.pitch + off.pitch;
    const cam = v.cam = { x: at.x + off.x, y: at.y + off.y, k: at.k * Math.exp(off.lk) };
    const centre = v.centre = { x: at.cx + off.cx, y: at.cy + off.cy };
    world.current?.setAttribute("transform", `translate(${(centre.x - cam.x * cam.k).toFixed(2)} ${(centre.y - cam.y * cam.k).toFixed(2)}) scale(${cam.k.toFixed(4)})`);
    sheets.forEach((sheet, j) => {
      if (sheet) sheet.style.transform = `translate3d(${wrap(-cam.x * cam.k * STARS[j][1], STARS[j][0]).toFixed(1)}px, ${wrap(-cam.y * cam.k * STARS[j][1], STARS[j][0]).toFixed(1)}px, 0)`;
    });

    // Each planet round to where it is now, its mark turned back by as much (so it stays upright), and its name under it.
    const spots: Spot[] = [{ id: LEAD, ...toScreen(cam, centre, { x: 0, y: 0 }), r: SUN_R * cam.k }];
    const turn = (el: SVGElement | null | undefined, deg: number) => el?.setAttribute("transform", `rotate(${deg.toFixed(3)})`);
    // A ring that grows out of a planet and fades, from when it began; false once it's over.
    const ring = (el: SVGCircleElement | null | undefined, began: number | undefined, grow: number) => {
      const p = began ? (now - began) / RING_MS : 1;
      el?.setAttribute("r", (PLANET_R * (1 + grow * Math.min(1, p))).toFixed(2));
      el?.setAttribute("opacity", p < 1 ? (0.9 * (1 - p)).toFixed(3) : "0");
      return p < 1;
    };
    const hdBodies: HdBody[] = [];
    const rise = moving ? 1 - Math.exp(-dt / 0.45) : 1; // how quickly a planet lights up as its crew member starts work, and dims after
    ids.forEach((id, i) => {
      const a = angleAt(i, v.seconds), p = parts[id], r = orbitOf(i);
      turn(p?.orbit, a);
      turn(p?.upright, -a);
      const quiet = scene.current.quiet.has(id), moons = scene.current.moons.get(id);
      if (scene.current.busy.has(id) && !quiet) turn(p?.busy, (v.seconds * 360) / 7); // the dashed ring turns while they work (and stops when all of it has gone quiet)
      p?.moons.forEach((m, j) => {
        turn(m, MOON[j][1] + (v.seconds * 360) / MOON[j][0]);
        // A quest that's gone quiet: its moon flickers, like a light that's failing.
        m?.setAttribute("opacity", !moons?.[j]?.stalled ? "1" : !moving ? "0.45" : Math.sin(v.seconds * 5.3 + j * 2) > 0.15 ? "0.7" : "0.28");
      });
      // A comet along the line from the sun to the planet (the line turns with the planet, so the flight bends): out, or home.
      const flight = sky.flights[id], since = flight ? now - flight.at : COMET_MS;
      if (flight && since >= COMET_MS) {
        delete sky.flights[id];
        p?.comet?.removeAttribute("data-flying");
        if (flight.kind === "out") sky.lands[id] = now; // it lands: the planet rings
        else sky.ping = now;                           // the report is in: the sun sends a ring out
      }
      const dots = p?.comet?.children;
      if (dots) COMET.forEach(([, behind, bright], k) => {
        const q = flight && since < COMET_MS ? Math.min(1, Math.max(0, (since - behind) / FLIGHT_MS)) : 0;
        const along = flight?.kind === "home" ? 1 - ease(q) : ease(q);
        dots[k].setAttribute("cx", (SUN_R + (r - 11 - SUN_R) * along).toFixed(2));
        dots[k].setAttribute("opacity", q > 0 && q < 1 ? (bright * Math.min(1, q / 0.08, (1 - q) / 0.08)).toFixed(3) : "0");
      });
      const landed = sky.lands[id], blipped = sky.blips[id];
      if (!ring(p?.land, landed, 1.6)) delete sky.lands[id];
      if (!ring(p?.blip, blipped, 0.9)) delete sky.blips[id];
      spots.push({ id, ...toScreen(cam, centre, placeAt(i, v.seconds)), r: PLANET_R * cam.k });
      if (hd) {
        const glow = glows[id] = (glows[id] ?? 0) + ((scene.current.busy.has(id) ? (quiet ? 0.25 : 1) : 0) - (glows[id] ?? 0)) * rise;
        const world = worlds.current.get(id) ?? worldsFor(0, [{ id, color: NO_COLOUR }])[0];
        turned[id] = (turned[id] ?? i * 1.7) + (moving ? dt * world.spin : 0);
        hdBodies.push({
          id, i, angle: a, color: colours.current.get(id) ?? NO_COLOUR, world, turned: turned[id],
          glow, waiting: scene.current.waiting.has(id), focused: v.focus === id,
          blip: sky.blips[id] ? (now - blipped) / RING_MS : -1, land: sky.lands[id] ? (now - landed) / RING_MS : -1,
          quests: scene.current.out.get(id) ?? [], flight: sky.flights[id] ? { kind: flight.kind, since } : null,
          moonSize: moons?.map((m) => m.size) ?? [], grown: scene.current.grown.get(id) ?? undefined, sats: scene.current.sats.get(id) ?? undefined,
        });
      }
    });
    // What's holding at the edge of the system, each a little way along the rim from the last, and riding at anchor.
    const shipIds = scene.current.ships;
    const marks = shipIds.map((sid, j) => {
      const a = (shipAt(j, shipIds.length) * Math.PI) / 180, r = scene.current.reach + SHIP_OUT + (moving ? 1.5 * Math.sin(v.seconds * 0.7 + j * 1.9) : 0);
      return { id: sid, x: r * Math.cos(a), y: r * Math.sin(a), r: 5 };
    });
    if (!hd) {
      for (const m of marks) spots.push({ id: m.id, ...toScreen(cam, centre, m), r: m.r * cam.k });
      // The satellites of the one you're with: one for each thing they carry, going round them (HD has its own, and says where they are).
      const fi = v.focus ? ids.indexOf(v.focus) : -1, n = fi >= 0 ? scene.current.sats.get(ids[fi]) ?? 0 : 0;
      const home = n ? placeAt(fi, v.seconds) : null;
      for (let j = 0; home && j < n; j++) {
        const a = (2 * Math.PI * j) / n + (v.seconds * 2 * Math.PI) / SAT_LAP;
        spots.push({ id: `sat:${j}`, ...toScreen(cam, centre, { x: home.x + SAT_OUT * Math.cos(a), y: home.y + SAT_OUT * Math.sin(a) }), r: 2.5 * cam.k });
      }
    }
    // The sun: its dials turn (faster while the Quartermaster is at work) and it breathes. With nothing running it sends
    // a ring out now and then, as it does on the blank page; a ring lights each line as it passes through it.
    sky.dial[0] += dt * (scene.current.leading ? 40 : 8);
    sky.dial[1] -= dt * (scene.current.leading ? 60 : 12);
    turn(dials[0], sky.dial[0]);
    turn(dials[1], sky.dial[1]);
    const breath = Math.sin((v.seconds * 2 * Math.PI) / 5);
    core.current?.setAttribute("transform", `scale(${(1 + 0.03 * breath).toFixed(4)})`);
    core.current?.setAttribute("opacity", (0.35 + 0.65 * v.sun).toFixed(3)); // (turned down, the disc itself dims too, but never goes out)
    corona.current?.setAttribute("opacity", (((scene.current.leading ? 1 : 0.72) + 0.1 * breath) * v.sun).toFixed(3));
    sky.pinged ||= now - ALONE_MS + 2500; // (the first comes soon after it opens)
    if (sky.ping > sky.pinged) sky.pinged = sky.ping;
    if (moving && !scene.current.running && now - sky.pinged > ALONE_MS) sky.ping = sky.pinged = now;
    const out = sky.ping ? (now - sky.ping) / 1000 : Infinity, going = out < PING_MS / 1000;
    pingRing.current?.setAttribute("r", (SUN_R + (going ? PING_SPEED * out : 0)).toFixed(1));
    pingRing.current?.setAttribute("opacity", going ? (0.7 * (1 - out / (PING_MS / 1000)) ** 1.6).toFixed(3) : "0");
    const litAt = (i: number) => {
      const t = (out - ((i < lines ? orbitOf(i) : orbitOf(lines - 1) + 30) - SUN_R) / PING_SPEED) * 1000; // since the ring reached this line
      return t > 0 && t < LIT_MS ? 0.85 * Math.min(1, t / 110, (LIT_MS - t) / (LIT_MS - 110)) : 0;
    };
    lits.forEach((line, i) => line?.setAttribute("opacity", litAt(i).toFixed(3)));
    drifts.forEach((g, i) => turn(g, (v.seconds * 360) / DRIFT[i % DRIFT.length]));
    // HD: the same moment, drawn in three dimensions; and where everything is on the screen is where that puts it.
    if (hd) {
      const sun = glows[LEAD] = (glows[LEAD] ?? 0) + ((scene.current.leading ? 1 : 0) - (glows[LEAD] ?? 0)) * rise;
      const made = hdFrame({
        seconds: v.seconds, w: v.w, h: v.h, cx: centre.x, cy: centre.y, at: cam, k: cam.k * HD_CLOSER, yaw: v.yaw, pitch: v.pitch,
        lead: LEAD, sun: { glow: sun, waiting: scene.current.waiting.has(LEAD), light: v.sun }, bodies: hdBodies,
        lines: Array.from({ length: lines + 1 }, (_, i) => ({ rot: ((i < ids.length ? hdBodies[i].angle : (v.seconds * 360) / DRIFT[i % DRIFT.length]) * Math.PI) / 180, lit: litAt(i), body: i < ids.length ? i : -1 })),
        ping: { r: going ? SUN_R + PING_SPEED * out : 0, a: going ? (1 - out / (PING_MS / 1000)) ** 1.6 : 0 }, reach: scene.current.reach, flightMs: FLIGHT_MS, marks,
      });
      spots.splice(0, spots.length, ...made.spots);
      hd.resize(v.w, v.h, window.devicePixelRatio || 1);
      hd.draw(made.frame);
    }
    v.spots = spots;
    // What's drawn over the system in the screen's own units, each put where its thing is now (and at its size, for
    // what's drawn round a body): the gauges, the plan's waypoints round the sun, the ships and the satellites.
    const spotOf = new Map(spots.map((s) => [s.id, s]));
    const put = (el: SVGElement | null | undefined, s: Spot | undefined, unit = 0) => {
      if (!el) return;
      if (!s) return el.setAttribute("display", "none");
      el.removeAttribute("display");
      el.setAttribute("transform", `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})${unit ? ` scale(${(s.r / unit).toFixed(4)})` : ""}`);
    };
    put(parts[LEAD]?.gauge, spotOf.get(LEAD), SUN_R);
    put(wayEl.current, spotOf.get(LEAD), SUN_R);
    // (Where the waypoints are goes with the sun's size; how big each is stops at a few pixels, however close you look.)
    const sun = spotOf.get(LEAD);
    if (sun && wayEl.current) wayEl.current.style.setProperty("--way", Math.min(1, (WAY_PX * SUN_R) / (WAY_SIZE * sun.r)).toFixed(4));
    for (const id of ids) put(parts[id]?.gauge, spotOf.get(id), PLANET_R);
    shipEls.forEach((ship, j) => put(ship, spotOf.get(shipIds[j])));
    satEls.forEach((sat, j) => put(sat, spotOf.get(`sat:${j}`)));
    // A planet's name is on its far side from the sun (so it never lies across the sun), and goes round with it: its
    // box is pushed out along the line from the sun by as much as it is deep that way. The sun's own name keeps to the
    // side of it away from the nearest planet, which is the one that would otherwise pass through it.
    const from = (p: Spot, q: Spot): [number, number] => { const d = Math.hypot(p.x - q.x, p.y - q.y) || 1; return [(p.x - q.x) / d, (p.y - q.y) / d]; };
    for (const s of spots) {
      const label = parts[s.id]?.label;
      if (!label) continue;
      const w = label.offsetWidth, h = label.offsetHeight;
      const [ux, uy] = s.id !== LEAD ? from(s, spots[0]) : spots[1] ? from(spots[0], spots[1]) : [0, 1];
      const past = scene.current.ways ? WAY_R + WAY_APART * (scene.current.ways - 1) + WAY_SIZE : SUN_R + 12; // the sun's dials, or the waypoints round it
      const clear = s.id === LEAD ? (s.r * past) / SUN_R + 8 : s.r * (1 + 9 / PLANET_R) + 6; // past those, or the planet's nearest moon
      const out = clear + (Math.abs(ux) * w + Math.abs(uy) * h) / 2;
      label.style.transform = `translate(${(s.x + ux * out - w / 2).toFixed(1)}px, ${(s.y + uy * out - h / 2).toFixed(1)}px)`;
    }

    // The marks round what you're looking at and what the pointer is over, and the line from the first to its panel.
    const frame = (mark: SVGPathElement | null, id: string | null) => {
      const s = id ? spots.find((x) => x.id === id) : undefined;
      if (!mark) return;
      if (!s) return mark.setAttribute("d", "");
      const half = s.r * (s.id === LEAD ? 2 : 2.1) + 10, arm = Math.min(16, half * 0.4), n = (x: number) => x.toFixed(1);
      const [l, r, t, b] = [s.x - half, s.x + half, s.y - half, s.y + half];
      mark.setAttribute("d", `M${n(l)} ${n(t + arm)}V${n(t)}H${n(l + arm)}M${n(r - arm)} ${n(t)}H${n(r)}V${n(t + arm)}M${n(r)} ${n(b - arm)}V${n(b)}H${n(r - arm)}M${n(l + arm)} ${n(b)}H${n(l)}V${n(b - arm)}`);
      return { right: r, y: s.y };
    };
    const framed = frame(reticle.current, v.focus);
    frame(hoverMark.current, v.over && v.over !== v.focus ? v.over : null);
    const edge = v.w - PANEL - 20;
    leader.current?.setAttribute("d", framed && !v.bare && v.w >= WIDE && framed.right + 14 < edge ? `M${(framed.right + 6).toFixed(1)} ${framed.y.toFixed(1)}H${edge}M${(framed.right + 3).toFixed(1)} ${(framed.y - 3).toFixed(1)}h6v6h-6z` : "");

    // From far off there's no room under a planet for what it's doing: just its name (the cells along the bottom still say).
    el.toggleAttribute("data-far", cam.k < FAR);
    const zoom = `×${(v.zoom * Math.exp(off.lk)).toFixed(1)}`;
    if (zoomRead.current && zoomRead.current.textContent !== zoom) zoomRead.current.textContent = zoom;
    const i = v.focus ? ids.indexOf(v.focus) : -1;
    if (bearing.current && i >= 0) {
      const deg = `${String(Math.round(angleAt(i, v.seconds)) % 360).padStart(3, "0")}°`;
      if (bearing.current.textContent !== deg) bearing.current.textContent = deg;
    }
  }, [v, parts, sheets, drifts, lits, dials, sky, glows, target, shipEls, satEls]);

  // Drawn at once whenever the page draws this (so nothing new sits in the corner for a frame), then a frame at a
  // time. Only a frame moves the clock on: drawn in between, it is as it was at the last one.
  useLayoutEffect(() => { draw(v.last || performance.now()); });
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return;
    let next = requestAnimationFrame(function frame(now) { draw(now); next = requestAnimationFrame(frame); });
    return () => cancelAnimationFrame(next);
  }, [draw]);

  // Look at one of them (and stay with it), or back at the whole system.
  const lookAt = useCallback((id: string | null) => {
    retarget(() => {
      if (id && !v.focus) v.zoom = clampZoom(closeZoom(v.w, v.h) / fitZoom(v.w, v.h, scene.current.lines)); // (going from one to the next keeps the zoom you chose)
      if (id && id !== v.focus) { v.yawRel = HD_SIDE; v.pitchRel = HD_NEAR; } // HD: each is first seen from the same side, low down
      if (!id) { v.pan = { x: 0, y: 0 }; v.zoom = 1; }
      v.focus = id;
    });
    setFocus(id);
    setPicked(null);
  }, [v, retarget]);
  const zoomBy = useCallback((times: number) => retarget(() => { v.zoom = clampZoom(v.zoom * times); }), [v, retarget]);
  // Someone you were looking at has left the crew.
  useEffect(() => { if (focus && !bodies.some((b) => b.id === focus)) lookAt(null); }, [focus, bodies, lookAt]);

  // Scroll to zoom: about the pointer while you're free to move, about the planet while you're with one.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.target instanceof Element && ev.target.closest(".orb-panel, .orb-strip, .orb-top, .orb-holding, .orb-reel")) return; // (the panel scrolls)
      ev.preventDefault();
      const zoom = clampZoom(v.zoom * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.012 : ev.deltaMode === 1 ? 0.05 : 0.0016)));
      if (!v.focus && !hdView.current) {
        const box = el.getBoundingClientRect(), at = target();
        const next = zoomAbout(at, { x: at.cx, y: at.cy }, { x: ev.clientX - box.left, y: ev.clientY - box.top }, fitZoom(v.w, v.h, scene.current.lines) * zoom);
        v.pan = withinReach(next, scene.current.reach);
      }
      v.zoom = zoom;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [v, target]);

  // Drag to move (which lets go of whoever you were with); a press that doesn't move is a click on what's under it.
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const where = (ev: ReactPointerEvent): Point => { const box = root.current!.getBoundingClientRect(); return { x: ev.clientX - box.left, y: ev.clientY - box.top }; };
  const onDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return;
    if (ambient) return setAmbient(false); // a press takes the controls back
    press.current = { x: ev.clientX, y: ev.clientY, moved: false };
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  };
  const onMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const p = press.current;
    if (!p) { const id = hit(v.spots, where(ev)); v.over = id; return setOver(id); }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return;
    if (hdView.current) {
      // HD: a drag turns the camera about what it's looking at (and stays with whoever that is).
      p.moved = v.turning = true; p.x = ev.clientX; p.y = ev.clientY;
      const withPlanet = !!v.focus && v.focus !== LEAD;
      if (withPlanet) { v.yawRel -= dx * 0.006; v.pitchRel = Math.min(1.5, Math.max(0.04, v.pitchRel + dy * 0.005)); }
      else { v.yawFree -= dx * 0.006; if (!v.focus) v.pitchFree = Math.min(1.5, Math.max(0.08, v.pitchFree + dy * 0.005)); }
      return;
    }
    if (!p.moved && v.focus) { retarget(() => { v.pan = { x: v.cam.x, y: v.cam.y }; v.focus = null; }); setFocus(null); }
    p.moved = true; p.x = ev.clientX; p.y = ev.clientY;
    v.pan = withinReach({ x: v.pan.x - dx / v.cam.k, y: v.pan.y - dy / v.cam.k }, scene.current.reach);
  };
  const onUp = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const p = press.current;
    press.current = null;
    v.turning = false;
    if (!p || p.moved) return;
    const id = hit(v.spots, where(ev));
    // A ship opens in the list of what's holding; a satellite, in the panel of the one it goes round.
    if (id?.startsWith("ship:")) return setShip((was) => (was === id ? null : id));
    if (id?.startsWith("sat:")) {
      const item = kits.get(v.focus ?? "")?.[Number(id.slice(4))];
      return item && setPicked((was) => (was === item.id ? null : item.id));
    }
    if (id) lookAt(id); else if (v.focus) lookAt(null);
  };

  // Fill the screen (the whole page goes, so what opens over this still can), and give it back on the way out.
  const [full, setFull] = useState(false);
  const canFill = typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => { document.removeEventListener("fullscreenchange", on); if (document.fullscreenElement) void document.exitFullscreen?.(); };
  }, []);

  // How bright the sun is, in either view (remembered): it's turned down from its own panel.
  const [sunLight, setSunLight] = useState(() => { const kept = Number(storeGet(SUN_KEY)); return kept >= SUN_LIGHT[0] && kept <= SUN_LIGHT[1] ? kept : 1; });
  const dimSun = useCallback((to: number) => { storeSet(SUN_KEY, String(to)); setSunLight(to); }, []);
  v.sun = sunLight;
  // HD: on or off (remembered), and whether this browser can draw it at all.
  const [hd, setHd] = useState(() => storeGet(HD_KEY) === "1");
  const [noHd, setNoHd] = useState(false);
  const toggleHd = useCallback(() => setHd((on) => { storeSet(HD_KEY, on ? "0" : "1"); return !on; }), []);
  const points = useMemo(() => Array.from({ length: lines + 1 }, (_, i) => contourPoints(i < lines ? orbitOf(i) : orbitOf(lines - 1) + 30, i)), [lines]);
  useEffect(() => {
    const el = canvas.current;
    if (!hd || !el) return;
    const made = createHd(el);
    if (!made) { setNoHd(true); setHd(false); return; } // (not remembered as off: it may work in another browser)
    hdView.current = made;
    // It opens looking straight down, which is the flat view exactly, and tips over into depth from there.
    v.yaw = Math.PI / 2; v.pitch = Math.PI / 2 - 0.01;
    retarget(() => { v.yawFree = Math.PI / 2; v.pitchFree = HD_OVER; });
    const lost = (ev: Event) => { ev.preventDefault(); setHd(false); };
    el.addEventListener("webglcontextlost", lost);
    return () => { el.removeEventListener("webglcontextlost", lost); hdView.current = null; made.dispose(); };
  }, [hd, v, retarget]);
  useEffect(() => { if (hd) hdView.current?.setLines(points); }, [hd, points]);
  // What the worlds are made up from (0: the camp's own), remembered; Reroll picks another.
  const [seed, setSeed] = useState(() => Number(storeGet(WORLDS_KEY)) || 0);
  const roll = useCallback((to: number) => { storeSet(WORLDS_KEY, String(to)); setSeed(to); }, []);
  // What you've changed about any one world (by crew member), remembered too. A world rolled or changed by itself keeps
  // that through a reroll of the rest, until it's put back.
  const [custom, setCustom] = useState(keptCustom);
  const recustom = useCallback((change: (was: Record<string, Custom>) => Record<string, Custom>) => setCustom((was) => { const now = change(was); storeSet(CUSTOM_KEY, JSON.stringify(now)); return now; }), []);
  const [made, setMade] = useState(() => new Map<string, World>()); // the worlds as they stand, for the maker to show
  // Each one's colour, as the stylesheet has it for their class (read off their name on the page), and their world.
  useLayoutEffect(() => {
    if (!hd) return;
    colours.current = new Map(bodies.flatMap((b) => {
      const el = parts[b.id]?.label, c = el ? rgbOf(getComputedStyle(el).getPropertyValue("--c")) : null;
      return c ? [[b.id, c] as [string, Vec3]] : [];
    }));
    const crewNow = bodies.slice(1).map((b) => ({ id: b.id, color: colours.current.get(b.id) ?? NO_COLOUR }));
    worlds.current = new Map(worldsFor(seed, crewNow).map((w, i) => [crewNow[i].id, customised(w, custom[crewNow[i].id], crewNow[i])]));
    setMade(worlds.current);
  }, [hd, cast, seed, custom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  // Replay: fetch the last day and play it back. (The demo ends: it's the real camp's day.)
  const startReplay = useCallback(async () => {
    setTold("");
    try {
      const reel = reelOf((await api<{ events: CampEvent[] }>("/api/feed/day")).events);
      if (!reel.events.length) return setTold("Nothing has happened in the last day to replay.");
      setDemo(false);
      setReplay({ reel, store: createFeedStore() });
    } catch (e) { setTold(`The replay couldn't be fetched: ${errorText(e)}`); }
  }, []);
  const toggleReplay = () => { if (replay) setReplay(null); else void startReplay(); };
  const toggleDemo = () => { setReplay(null); setTold(""); setDemo((on) => !on); };
  // Ambient: every second, and whenever one of the crew does something, ask who the camera should be on.
  useEffect(() => {
    if (!ambient) return;
    let cut: Cut = { on: v.focus, since: Date.now(), heard: Date.now() };
    const go = (next: Cut) => { if (next.on !== cut.on) lookAt(next.on); cut = next; };
    const stop = feed.onEvent((e) => {
      if (time.quiet) return;
      const lead = e.type === "expedition_start" || e.type === "plan" || e.type === "ask";
      // (A decision doesn't say who's asking: the feed has worked that out by now, from whose quest it is.)
      const name = e.type === "ask" ? feed.getState().asks.find((a) => a.id === e.id)?.who : "who" in e && typeof e.who === "string" ? e.who : undefined;
      const who = (name ? scene.current.names.get(name) : undefined) ?? (lead ? LEAD : undefined);
      if (who) go(direct(cut, Date.now(), { who, urgent: e.type === "ask" }));
    });
    const t = setInterval(() => go(direct(cut, Date.now())), 1000);
    return () => { stop(); clearInterval(t); };
  }, [ambient, feed, lookAt, v, time]);
  // Whoever is waiting on you (first, one you aren't already looking at).
  const asker = asks.length ? scene.current.names.get((asks.find((a) => (scene.current.names.get(a.who) ?? LEAD) !== focus) ?? asks[0]).who) ?? LEAD : null;
  const owns = useCallback((who: string) => (scene.current.names.get(who) ?? LEAD) === focus, [focus]);
  // Something was sent from the panel: a comet leaves for whoever it was sent to (the sun answers with a ring, for its own).
  const sent = useCallback((id: string) => {
    if (!motionOK()) return;
    if (id === LEAD) { sky.ping = v.last; return; }
    sky.flights[id] = { kind: "out", at: v.last };
    parts[id]?.comet?.setAttribute("data-flying", "out");
  }, [sky, v, parts]);

  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // Typing in a box is typing, not a command to the view (Esc steps out of the box).
    if (ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select")) {
      if (ev.key === "Escape") { root.current?.focus({ preventScroll: true }); ev.preventDefault(); ev.stopPropagation(); }
      return;
    }
    if (ev.key === "Escape") { if (ambient) setAmbient(false); else if (focus) lookAt(null); else if (replay) setReplay(null); else onClose(); }
    else if (ev.key === "+" || ev.key === "=") zoomBy(1.4);
    else if (ev.key === "-" || ev.key === "_") zoomBy(1 / 1.4);
    else if (ev.key === "0") lookAt(null);
    else if (/^[1-9]$/.test(ev.key) && bodies[Number(ev.key) - 1]) lookAt(bodies[Number(ev.key) - 1].id);
    else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const at = bodies.findIndex((b) => b.id === focus), step = ev.key === "ArrowRight" ? 1 : -1;
      lookAt(bodies[(at < 0 ? (step > 0 ? 0 : bodies.length - 1) : at + step + bodies.length) % bodies.length].id);
    }
    else if ((ev.key === "f" || ev.key === "F") && canFill) toggleFull();
    else if (ev.key === "d" || ev.key === "D") toggleDemo();
    else if (ev.key === "p" || ev.key === "P") toggleReplay();
    else if (ev.key === "a" || ev.key === "A") setAmbient((on) => !on);
    else if ((ev.key === "h" || ev.key === "H") && !noHd) toggleHd();
    else if ((ev.key === "r" || ev.key === "R") && hd) roll(ev.shiftKey ? 0 : newSeed());
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  // ---------- What crosses the sky ----------
  // A quest sent, a report come home, a tool used, an expedition over: each is noted with the time
  // on the drawing's clock, and drawn from there (in draw, above) for as long as it lasts.
  useEffect(() => {
    if (!motionOK()) return;
    const stop = feed.onEvent((e) => {
      // (A replay's events are all of them the past: what it's catching up on is what it says it is.)
      if (time.quiet || (time.now === null && Date.now() - new Date(e.time).getTime() > FRESH_MS)) return;
      if (e.type === "expedition_end") sky.ping = v.last;
      const who = "who" in e ? scene.current.names.get(e.who) : undefined;
      if (!who || who === LEAD) return;
      if (e.type === "dispatch" || e.type === "return") {
        sky.flights[who] = { kind: e.type === "dispatch" ? "out" : "home", at: v.last };
        parts[who]?.comet?.setAttribute("data-flying", sky.flights[who].kind);
      } else if ((e.type === "tool" || e.type === "file") && !sky.blips[who]) sky.blips[who] = v.last; // (a burst of calls is one ring, not a blur of them)
    });
    // Another feed (the demo starting, or ending): what was crossing the sky belonged to the last one.
    return () => {
      stop();
      sky.flights = {}; sky.lands = {}; sky.blips = {}; sky.ping = 0;
      for (const p of Object.values(parts)) p.comet?.removeAttribute("data-flying");
    };
  }, [feed, sky, v, parts, time]);

  // A line as the sun's ring lights it in passing (each line has the one, lit from draw above).
  const lit = (d: string, i: number) => <path className="orb-lit" d={d} opacity="0" ref={(el) => { lits[i] = el; }} />;

  const sun = statusOf(bodies[0]);
  const waiting = quests.filter((q) => q.waiting).length;
  const looking = bodies.find((b) => b.id === focus);
  const need = live && asker ? asks.length : 0; // decisions that can be answered here, now
  const kit = looking ? kits.get(looking.id) ?? [] : [];
  const sats = looking && looking.id !== LEAD && known ? kit.slice(0, SATS_MAX) : [];
  const dayCost = spend?.today ?? 0;
  const ticks = (every: number, long: number) => { const gap = (2 * Math.PI * (reach + 6)) / (360 / every); return `${long} ${(gap - long).toFixed(3)}`; };

  return (
    <div className={cx("orbit", focus && "looking", hd && "hd", ambient && "ambient", need > 0 && "needs")} ref={root} role="dialog" aria-modal="true" aria-label={`Orbit: the ${w("crew")} at work`} tabIndex={-1} onKeyDown={onKey}>
      {STARS.map((_, j) => <div key={j} className={`orb-stars s${j + 1}`} ref={(el) => { sheets[j] = el; }} aria-hidden="true" />)}
      {hd && <canvas className="orb-hd" ref={canvas} aria-hidden="true" />}
      <svg className={cx("orb-sky", over && "over")} aria-hidden="true" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null; v.turning = false; }} onPointerLeave={() => { v.over = null; setOver(null); }}>
        <g ref={world}>
          {/* The instrument behind it all: bearings every thirty degrees, and a rim with a tick every five. */}
          <path className="orb-grid" d={grid} />
          <circle className="orb-rim" r={reach} />
          <circle className="orb-ticks" r={reach + 6} strokeDasharray={ticks(5, 0.7)} />
          <circle className="orb-ticks long" r={reach + 6} strokeDasharray={ticks(30, 1.4)} />
          {/* The lines nobody is on drift round slowly by themselves. A planet's own line is drawn with it, below. */}
          {contours.map((d, i) => (
            <g key={i} className="orb-drift" ref={(el) => { drifts[i] = planets[i] ? null : el; }}>
              <path className={i < lines ? "orb-ring" : "orb-ring far"} d={d} />
              {lit(d, i)}
            </g>
          )).filter((_, i) => !planets[i])}
          <circle className="orb-ping" ref={pingRing} r={SUN_R} opacity="0" />
          <g className={cx("orb-sun", `st-${sun.status}`)} data-who={LEAD}>
            <radialGradient id="orb-corona"><stop offset="0" className="orb-g0" /><stop offset=".3" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
            <circle className="orb-corona" ref={corona} r={SUN_R * 4.8} fill="url(#orb-corona)" opacity=".72" />
            <g className="orb-sun-dial" ref={(el) => { dials[0] = el; }}><circle r={SUN_R + 9} /></g>
            <g className="orb-sun-dial inner" ref={(el) => { dials[1] = el; }}><circle r={SUN_R + 4.5} /></g>
            <circle className="orb-sun-core" ref={core} r={SUN_R} />
          </g>
          {planets.map((p, i) => {
            const r = orbitOf(i), a = angleAt(i, 0), st = statusOf(p), out = outOf(p), mark = MARKS[p.id];
            return (
              <g key={p.id} className={cx("orb-planet", cClass(p.name), `st-${st.status}`, says.get(p.id)?.quiet && "st-stalled", focus === p.id && "focused")} data-who={p.id}>
                <radialGradient id={`orb-halo-${p.id}`}><stop offset="0" className="orb-g0" /><stop offset=".45" className="orb-g1" /><stop offset="1" className="orb-g2" /></radialGradient>
                {/* The planet and its line turn as one (a frame at a time, from draw above), so it is always on its line and its tail is a stretch of it. */}
                <g ref={(el) => { part(p.id).orbit = el; }} transform={`rotate(${a.toFixed(3)})`}>
                  <path className="orb-ring" d={contours[i]} />
                  {lit(contours[i], i)}
                  <path className="orb-tone" d={contours[i]} />
                  {TAIL.map((k) => { const len = stretch(r, k); return <path key={k} className="orb-tail" d={contours[i]} pathLength={LAP} strokeDasharray={`${len} ${LAP - len}`} strokeDashoffset={len} />; })}
                  <g className="orb-comet" ref={(el) => { part(p.id).comet = el; }}>{COMET.map(([size], k) => <circle key={k} r={size} opacity="0" />)}</g>
                  <g transform={`translate(${r} 0)`}>
                    <g ref={(el) => { part(p.id).upright = el; }} transform={`rotate(${(-a).toFixed(3)})`}>
                      <circle className="orb-halo" r={PLANET_R * 3.6} fill={`url(#orb-halo-${p.id})`} />
                      <circle className="orb-land" ref={(el) => { part(p.id).land = el; }} r={PLANET_R} opacity="0" />
                      <circle className="orb-blip" ref={(el) => { part(p.id).blip = el; }} r={PLANET_R} opacity="0" />
                      <g className="orb-busy" ref={(el) => { part(p.id).busy = el; }}><circle r={PLANET_R + 3.4} /></g>
                      {/* A moon for each quest they have out. It grows the longer its quest has been out, and gains a ring at ten minutes and another at thirty. */}
                      {MOON.map((_, j) => {
                        const q = out[j];
                        if (!q) return null;
                        const moon = moonOf(now - q.started), cx0 = PLANET_R + 7 + j * 4.2;
                        return (
                          <g key={`${q.expId}|${q.id}`} className={cx("orb-moon", q.waiting && "st-waiting", stalled(q, now) && "st-stalled")} ref={(el) => { part(p.id).moons[j] = el; }}>
                            <circle cx={cx0} r={moon.r.toFixed(2)} />
                            {Array.from({ length: moon.rings }, (_, k) => <circle key={k} className="orb-moon-ring" cx={cx0} r={(moon.r + 1.3 + k * 1.1).toFixed(2)} />)}
                          </g>
                        );
                      })}
                      <circle className="orb-disc" r={PLANET_R} />
                      {mark ? <g className="orb-mark" transform="translate(-6 -6) scale(.5)">{mark}</g>
                        : <text className="orb-emoji" y="3.7" textAnchor="middle">{p.emoji ?? p.name.slice(0, 1)}</text>}
                    </g>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {/* The marks and the names sit over the drawing, in the screen's own units, so they stay the same size however close you look. */}
      <svg className="orb-over" aria-hidden="true">
        {/* The plan of each expedition that's running, as waypoints round the sun: one for each step, lit as it's done. */}
        <g className="orb-ways" ref={wayEl}>
          {ways.map((w, k) => w.steps.map((st, j) => { const at = wayAt(j, w.steps.length, k); return <rect key={`${w.expId}|${st.n}`} className={`way-${st.state}`} x={(at.x - WAY_SIZE / 2).toFixed(2)} y={(at.y - WAY_SIZE / 2).toFixed(2)} width={WAY_SIZE} height={WAY_SIZE} />; }))}
        </g>
        {/* Gauges: round the sun, how much of the plan's limit is used; round each planet, its share of what today has cost. */}
        <g className={cx("orb-gauge", limit && limit.used >= NEAR_FULL && "warn")} ref={(el) => { part(LEAD).gauge = el; }}>
          {limit && <><circle className="orb-gauge-track" r={SUN_R + 2.2} /><path d={arc(SUN_R + 2.2, limit.used)} /></>}
        </g>
        {planets.map((p) => { const share = spend ? spendOf(spend, p.name).share : 0; return (
          <g key={p.id} className={cx("orb-gauge", cClass(p.name))} ref={(el) => { part(p.id).gauge = el; }}>
            {share > 0 && <><circle className="orb-gauge-track" r={PLANET_R + 1.7} /><path d={arc(PLANET_R + 1.7, share)} /></>}
          </g>
        ); })}
        {/* What's holding at the edge, and the satellites of the one you're with: each named when it's pointed at or open. */}
        {ships.map((sh, j) => (
          <g key={j} className={cx("orb-ship", `ship-${sh.kind}`, sh.bad && "bad", sh.held && "held", ship === sh.id && "on")} ref={(el) => { shipEls[j] = el; }}>
            <path d={SHIP_SHAPE[sh.kind]} />
            {(ship === sh.id || over === sh.id) && <text x="11" y="4">{short(sh.name, 40)}</text>}
          </g>
        ))}
        {sats.map((k, j) => (
          <g key={j} className={cx("orb-sat", `kit-${k.kind}`, k.state === "error" && "bad", picked === k.id && "on")} ref={(el) => { satEls[j] = el; }}>
            <rect x="-3" y="-3" width="6" height="6" />
            {(picked === k.id || over === `sat:${j}`) && <text x="9" y="4">{short(k.name, 32)}</text>}
          </g>
        ))}
        <path className="orb-leader" ref={leader} />
        <path className="orb-reticle hover" ref={hoverMark} />
        <path className={cx("orb-reticle", looking && cClass(looking.name))} ref={reticle} />
      </svg>
      <div className="orb-labels" aria-hidden="true">
        {bodies.map((b) => {
          const st = statusOf(b);
          return (
            <div key={b.id} className={cx("orb-label", cClass(b.name), `st-${st.status}`, says.get(b.id)?.quiet && "st-stalled", focus === b.id && "focused")} ref={(el) => { part(b.id).label = el; }}>
              <b>{b.name}</b>
              {st.status !== "idle" && <span>{says.get(b.id)?.text}</span>}
            </div>
          );
        })}
      </div>
      <div className="orb-frame" aria-hidden="true"><i /><i /><i /><i /></div>

      <header className="orb-top">
        <div className="orb-title"><h2>Orbit</h2>{demo ? <span className="orb-pretend" role="status">Demo: a pretend {w("camp")}. None of this is really happening.</span>
          : replay ? <span className="orb-pretend" role="status">Replay: the last day, played back. None of this is happening now.</span>
          : told ? <span className="orb-pretend" role="status">{told}</span>
          : <span>The {w("crew")} at work, as it happens</span>}</div>
        <dl className="orb-read">
          <div><dt>{w("Expeditions")}</dt><dd>{running}</dd></div>
          <div><dt>{w("Quests")} out</dt><dd>{quests.length}</dd></div>
          {waiting > 0 && <div className="warn"><dt>Waiting on you</dt><dd>{waiting}</dd></div>}
          {spend && <div><dt>Spent today</dt><dd>{money(dayCost)}</dd></div>}
          <div><dt>Zoom</dt><dd ref={zoomRead}>×1.0</dd></div>
          <div><dt>{replay ? "Then" : "Local"}</dt><dd><Clock clock={clock} /></dd></div>
        </dl>
        {/* A decision is answered here: this takes you to whoever is asking, and their panel has it. */}
        {need > 0 && !ambient && <button type="button" className="orb-alert" title="Go to whoever is asking, and answer it there" onClick={() => lookAt(asker)}>{need === 1 ? "1 decision needs you" : `${need} decisions need you`}</button>}
        {ambient ? (
          <div className="orb-tools" role="group" aria-label="The view">
            <button type="button" className="orb-tool worded" aria-pressed="true" title="Take the controls back (A, or Esc)" onClick={() => setAmbient(false)}>Ambient</button>
            <button type="button" className="orb-tool" aria-label="Leave Orbit" title="Back to the page" onClick={onClose}><Icon name="x" /></button>
          </div>
        ) : (
        <div className="orb-tools" role="group" aria-label="The view">
          <button type="button" className="orb-tool" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button type="button" className="orb-tool" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.4)}>+</button>
          <button type="button" className="orb-tool" aria-label="Show the whole system" title="Show the whole system (0)" onClick={() => lookAt(null)}><Icon name="focus" /></button>
          {canFill && <button type="button" className="orb-tool" aria-pressed={full} aria-label={full ? "Leave full screen" : "Fill the screen"} title={`${full ? "Leave full screen" : "Fill the screen"} (F)`} onClick={toggleFull}>{full ? "⤡" : "⤢"}</button>}
          <button type="button" className="orb-tool worded" aria-pressed={hd} disabled={noHd} onClick={toggleHd}
            title={noHd ? "HD needs WebGL 2, which this browser isn't offering" : hd ? "Back to the flat view (H)" : "HD: the same system in three dimensions, as lit worlds round a sun (H). A proof of concept."}>HD</button>
          {hd && <button type="button" className="orb-tool worded" onClick={(ev) => roll(ev.shiftKey ? 0 : newSeed())}
            title={`Reroll: make up other worlds for the ${w("crew")} (R). Each keeps its ${w("crew")} member's colour, the Artificer keeps a station, and a world you've made your own stays as you made it.${seed ? ` Shift-click (or Shift+R) for the ${w("camp")}'s own.` : ""}`}>Reroll</button>}
          <button type="button" className="orb-tool worded" aria-pressed={demo} title={demo ? `End the demo and show the real ${w("camp")} (D)` : `Play a demo: a pretend ${w("camp")} at work, with nobody really sent anywhere (D)`} onClick={toggleDemo}>Demo</button>
          <button type="button" className="orb-tool worded" aria-pressed={!!replay} title={replay ? `End the replay and show the ${w("camp")} as it is now (P)` : `Replay: watch the last day's ${w("expeditions")} back, in about half a minute (P)`} onClick={toggleReplay}>Replay</button>
          <button type="button" className="orb-tool worded" aria-pressed={false} title="Ambient: hands off. The camera goes to whoever just did something, and tells you quietly when a decision needs you (A)" onClick={() => setAmbient(true)}>Ambient</button>
          <button type="button" className="orb-tool" aria-label="Leave Orbit" title="Back to the page (Esc)" onClick={onClose}><Icon name="x" /></button>
        </div>
        )}
      </header>

      {ships.length > 0 && !ambient && <Holding ships={ships} open={ship} live={live} onOpen={setShip} />}

      {looking && !ambient && (
        <Panel key={looking.id} body={looking} lead={looking.id === LEAD} nth={planets.indexOf(looking)} xp={xpOf(looking)} store={feed} st={statusOf(looking)} bearing={bearing}
          live={live} clock={clock} kit={kit} picked={picked} onPick={setPicked} spend={spend ? spendOf(spend, looking.name) : null} limit={limit} owns={owns} onSent={() => sent(looking.id)}
          make={looking.id === LEAD ? (
            <div className="orb-dimmer"><Slide label="Brightness" value={sunLight} limit={SUN_LIGHT} onChange={dimSun} says={`${Math.round(sunLight * 100)}%`} /></div>
          ) : hd && made.get(looking.id) && (
            <WorldMaker name={looking.name} world={made.get(looking.id)!} changed={!!custom[looking.id]} kit={known ? kit.length : undefined}
              onChange={(c) => recustom((was) => ({ ...was, [looking.id]: { ...was[looking.id], ...c } }))}
              onRoll={() => recustom((was) => ({ ...was, [looking.id]: { roll: newSeed(), ...(was[looking.id]?.kind !== undefined ? { kind: was[looking.id].kind } : {}) } }))} // (it stays the kind of thing you said it was)
              onReset={() => recustom(({ [looking.id]: _gone, ...rest }) => rest)} />
          )}
          onBack={() => lookAt(null)} onOpenAgent={onOpenAgent} onOpenQuest={onOpenQuest} onOpenConversation={onOpenConversation} />
      )}

      {replay && <Timeline reel={replay.reel} store={replay.store} time={time} onLeave={() => setReplay(null)} />}
      {/* Ambient: who the camera is on and what they're doing, and (quietly) that something is waiting on you. */}
      {ambient && (
        <div className="orb-caption">
          <p>{looking ? <><b>{looking.name}</b>{says.get(looking.id)?.text}</> : <><b>The {w("camp")}</b>{running ? `${running} ${running === 1 ? w("expedition") : w("expeditions")} under way, ${quests.length} ${quests.length === 1 ? w("quest") : w("quests")} out` : "At rest"}</>}</p>
          {need > 0 && <button type="button" className="orb-need" onClick={() => { setAmbient(false); lookAt(asker); }}>{need === 1 ? "A decision needs you" : `${need} decisions need you`}</button>}
          <small>Ambient: the camera follows the work. Esc, or a click, takes the controls back.</small>
        </div>
      )}
      {!ambient && <>
      <p className="orb-hint" aria-hidden="true">Scroll to zoom · drag to {hd ? "turn" : "move"} · click a planet to stay with it · Esc to step back</p>
      <nav className="orb-strip" aria-label={`The ${w("crew")}`}>
        {bodies.map((b, n) => {
          const st = statusOf(b), out = outOf(b), say = says.get(b.id), text = say?.text ?? "";
          return (
            <button key={b.id} type="button" className={cx("orb-cell", cClass(b.name), `st-${st.status}`, say?.quiet && "st-stalled", focus === b.id && "on")} aria-pressed={focus === b.id}
              aria-label={`${b.name}: ${text}`} title={`${focus === b.id ? "Back to the whole system" : `Look at ${b.name}`}${n < 9 ? ` (${n + 1})` : ""}`}
              onClick={() => lookAt(focus === b.id ? null : b.id)}>
              <span className="orb-cell-who"><i className="orb-dot" />{b.name}{out.length > 1 && <em>×{out.length}</em>}<kbd>{n < 9 ? n + 1 : ""}</kbd></span>
              <span className="orb-cell-doing">{text}</span>
            </button>
          );
        })}
      </nav>
      </>}
    </div>
  );
}
