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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { storeGet, storeSet } from "../api.ts";
import { contour, contourPoints, LAP, MARKS, stretch, TAIL } from "../components/MaeSystem.tsx";
import { Icon } from "../components/bits.tsx";
import { runningCount, statusLine, type CrewStatus, type QuestOut } from "../feed/reducer.ts";
import { createFeedStore, useFeed, type FeedStore } from "../feed/store.ts";
import { cClass, cx, shortModel, took } from "../format.ts";
import { motionOK } from "../motion.tsx";
import type { CampState } from "../types.ts";
import { DEMO_CREW, runDemo } from "./demo.ts";
import { questsOf, runsOf, type Line } from "./doing.ts";
import { hdFrame, type HdBody } from "./hd/frame.ts";
import { rgbOf, turnTo, type Vec3 } from "./hd/math.ts";
import { createHd, type HdRenderer } from "./hd/renderer.ts";
import { WorldMaker } from "./hd/Maker.tsx";
import { customised, newSeed, worldsFor, type Custom, type World } from "./hd/worlds.ts";
import {
  PLANET_R, SUN_R, angleAt, clampZoom, closeZoom, ease, fitZoom, hit, lapOf, linesFor, orbitOf, placeAt, reachOf, toScreen, withinReach, zoomAbout,
  type Camera, type Point, type Spot,
} from "./scene.ts";

const LEAD = "quartermaster";
const IDLE: CrewStatus = { status: "idle", line: "" };
type Body = { id: string; name: string; emoji?: string; role?: string; model?: string; effort?: string };

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
const HD_KEY = "camp-orbit-hd", WORLDS_KEY = "camp-orbit-worlds", CUSTOM_KEY = "camp-orbit-custom";
// What you've changed about each crew member's world, as it's kept in this browser (nothing, if what's kept can't be read).
function keptCustom(): Record<string, Custom> {
  try { const kept = JSON.parse(storeGet(CUSTOM_KEY) ?? "{}"); return kept && typeof kept === "object" && !Array.isArray(kept) ? kept : {}; } catch { return {}; }
}
const HD_OVER = 0.6, HD_NEAR = 0.2, HD_SUNWARD = 0.34, HD_SIDE = 1.62, HD_DRIFT = 0.022, HD_CLOSER = 1.2;
const NO_COLOUR: Vec3 = [0.49, 0.72, 0.77];
const EASE_S = 0.26;           // how quickly the camera settles on what it's looking at
const FAR = 0.7;               // below this many screen pixels to one of the drawing's units, the names lose their second line
const WIDE = 900, PANEL = 380; // from this width the panel sits beside the system, and is this wide
// The stars: three sheets of them, each a tile repeated (the tile's size, and how far the sheet shifts as the camera moves).
const STARS: [number, number][] = [[640, 0.03], [820, 0.065], [1040, 0.11]];
const wrap = (n: number, tile: number) => ((n % tile) + tile) % tile;
const SPOKES = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);

// The time, ticking, for as long as there's something to time.
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
function Clock() {
  const now = useNow(true);
  return <>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</>;
}

// (Its classes, here and for who's working or waiting below, are orb-… and st-…: the page has styles of its own for plain "ask", "tool" and "waiting".)
const TAGS: Record<Line["tag"], string> = { said: "says", tool: "tool", file: "file", ask: "asks", note: "note", you: "you" };
function Log({ lines }: { lines: Line[] }) {
  if (!lines.length) return null;
  return (
    <ol className="orb-log">
      {lines.map((l) => <li key={l.id} className={`orb-l-${l.tag}`}><i>{TAGS[l.tag]}</i><span>{l.text}{l.live && <b className="orb-caret" aria-hidden="true" />}</span></li>)}
    </ol>
  );
}

// What the one you're looking at is doing. bearing: where its planet is round the sun, kept up to date by the drawing.
// make: the HD view's world maker for this one, when HD is on.
function Panel({ body, nth, S, store, st, bearing, make, onBack, onOpenAgent, onOpenQuest, onOpenConversation }: {
  body: Body; nth: number; S: CampState | null; store: FeedStore; st: CrewStatus; bearing: RefObject<HTMLElement | null>; make?: ReactNode;
  onBack: () => void; onOpenAgent?: (id: string) => void; onOpenQuest?: (q: QuestOut) => void; onOpenConversation?: (id: string) => void;
}) {
  const items = useFeed(store, (s) => s.items);
  const open = useFeed(store, (s) => s.open);
  const quests = useFeed(store, (s) => s.quests);
  const out = useMemo(() => questsOf({ items, open, quests }, body.name), [items, open, quests, body.name]);
  const runs = useMemo(() => runsOf({ items, open }, body.name), [items, open, body.name]);
  const lead = body.id === LEAD;
  const now = useNow(out.length + runs.length > 0);
  const xp = S?.xp?.[body.name] ?? 0;
  return (
    <aside className={cx("orb-panel", cClass(body.name), `st-${st.status}`)} aria-label={`What ${body.name} is doing`}>
      <header>
        <span className="orb-p-face" aria-hidden="true">{body.emoji ?? body.name.slice(0, 1)}</span>
        <div><h3>{body.name}</h3>{body.role && <p>{body.role}</p>}</div>
        <button type="button" className="orb-tool" aria-label="Back to the whole system" title="Back to the whole system (Esc)" onClick={onBack}><Icon name="x" /></button>
      </header>
      <dl className="orb-facts">
        <div><dt>Now</dt><dd className="orb-state">{statusLine(st, out)}</dd></div>
        {body.model && <div><dt>Model</dt><dd>{shortModel(body.model)}{body.effort ? ` · ${body.effort}` : ""}</dd></div>}
        <div><dt>Level</dt><dd>{Math.floor(xp / 50) + 1}</dd></div>
        {lead ? <div><dt>Place</dt><dd>The sun</dd></div>
          : <div><dt>Orbit</dt><dd>{nth + 1} out · a lap every {Math.round(lapOf(nth))}s · <span ref={bearing} title="Where it is round the sun, clockwise from due right">000°</span></dd></div>}
      </dl>
      <div className="orb-p-body">
        {make}
        {out.length > 0 && <h4>{out.length === 1 ? "Out on a quest" : `${out.length} quests out`}</h4>}
        {out.map((q) => (
          <article key={`${q.expId}|${q.id}`} className={cx("orb-work-card", q.waiting && "st-waiting")}>
            <div className="orb-w-head">{q.step ? <b className="orb-step" title={`Step ${q.step} of the plan`}>{q.step}</b> : null}<span>{q.brief || "A quest"}</span><time>{took((now - q.started) / 1000)}</time></div>
            <p className="orb-w-doing">{q.waiting ? "Waiting for your OK" : q.line}</p>
            <Log lines={q.log} />
            {onOpenQuest && <button type="button" className="orb-btn" onClick={() => onOpenQuest(q)}>{q.waiting ? "Go to it and answer" : "Go to it in the conversation"}</button>}
          </article>
        ))}
        {runs.length > 0 && <h4>{lead ? (runs.length === 1 ? "An expedition under way" : `${runs.length} expeditions under way`) : "In a conversation with you"}</h4>}
        {runs.map((r) => (
          <article key={r.expId} className="orb-work-card">
            <div className="orb-w-head"><span>{r.task}</span><time>{took((now - r.started) / 1000)}</time></div>
            {r.steps && <p className="orb-w-doing">{r.steps.done} of {r.steps.total} {r.steps.total === 1 ? "step" : "steps"} done{r.steps.out ? ` · ${r.steps.out} out now` : ""}</p>}
            <Log lines={r.log} />
            {onOpenConversation && r.thread && <button type="button" className="orb-btn" onClick={() => onOpenConversation(r.thread!)}>Open the conversation</button>}
          </article>
        ))}
        {!out.length && !runs.length && (
          <p className="orb-quiet">{lead
            ? "No expedition is under way. When you send the Quartermaster on one, its plan and its progress show here as they happen."
            : `At camp, with nothing out. When the Quartermaster sends ${body.name} on a quest, it shows here as it happens.`}</p>
        )}
      </div>
      {onOpenAgent && <footer><button type="button" className="orb-btn" onClick={() => onOpenAgent(body.id)}>Open {body.name}'s page</button></footer>}
    </aside>
  );
}

// onOpenAgent: an agent's page, which opens over this. onOpenQuest / onOpenConversation / onDecision:
// go to where the work is, on the page underneath (whoever shows this closes it as they go).
// demo: open it on the demo.
export function Orbit({ S, store, onClose, onOpenAgent, onOpenQuest, onOpenConversation, onDecision, demo: startInDemo = false }: {
  S: CampState | null; store: FeedStore; onClose: () => void; demo?: boolean;
  onOpenAgent?: (id: string) => void; onOpenQuest?: (q: QuestOut) => void; onOpenConversation?: (id: string) => void; onDecision?: () => void;
}) {
  const [demo, setDemo] = useState(startInDemo);
  // Who's in the sky: the Quartermaster in the middle, then everyone else from the nearest orbit out.
  // The demo is played by your own crew, or by the camp's own five if there's nobody yet to play it.
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
  const feed = pretend ?? store;
  if (demo) onOpenQuest = onOpenConversation = onDecision = onOpenAgent = undefined; // (there's no such work to go to)

  const crew = useFeed(feed, (s) => s.crew);
  const quests = useFeed(feed, (s) => s.quests);
  const asks = useFeed(feed, (s) => s.asks.length);
  const running = useFeed(feed, runningCount);
  const planets = bodies.slice(1);
  const lines = linesFor(planets.length);
  const reach = reachOf(lines);
  const contours = useMemo(() => Array.from({ length: lines + 1 }, (_, i) => contour(i < lines ? orbitOf(i) : orbitOf(lines - 1) + 30, i)), [lines]);
  const grid = useMemo(() => SPOKES.map((a) => `M${((SUN_R + 26) * Math.cos(a)).toFixed(1)} ${((SUN_R + 26) * Math.sin(a)).toFixed(1)}L${(reach * Math.cos(a)).toFixed(1)} ${(reach * Math.sin(a)).toFixed(1)}`).join(""), [reach]);
  // What the drawing needs to know, wherever it's called from.
  const scene = useRef({ ids: [] as string[], names: new Map<string, string>(), lines, reach, running, busy: new Set<string>(), waiting: new Set<string>(), out: new Map<string, boolean[]>(), leading: false });
  scene.current = {
    ids: planets.map((p) => p.id), names: new Map(bodies.map((b) => [b.name, b.id])), lines, reach, running,
    busy: new Set(planets.filter((p) => crew[p.name]?.status === "active").map((p) => p.id)), leading: crew[bodies[0].name]?.status === "active",
    waiting: new Set(bodies.filter((b) => crew[b.name]?.status === "waiting").map((b) => b.id)),            // (HD draws from these two as well)
    out: new Map(planets.map((p) => [p.id, quests.filter((q) => q.who === p.name).map((q) => q.waiting)])),
  };

  // ---------- The camera ----------
  // What it's looking at: one of the crew (it stays with them), or a place you dragged it to. It
  // doesn't jump there: `off` is how far it still is from where it's headed, and that shrinks
  // away a frame at a time, so it arrives exactly, however the planet moves meanwhile.
  const [focus, setFocus] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const v = useRef({
    focus: null as string | null, over: null as string | null, pan: { x: 0, y: 0 }, zoom: 1,
    off: { x: 0, y: 0, lk: Math.log(0.4), cx: 0, cy: 0, yaw: 0, pitch: 0 }, // (it opens from further out, and comes in)
    cam: { x: 0, y: 0, k: 1 } as Camera, centre: { x: 0, y: 0 }, spots: [] as Spot[],
    w: 0, h: 0, began: 0, last: 0, seconds: 0,
    // HD: where the camera stands round what it's looking at. Free of anyone, a yaw of its own (a quarter turn is the flat
    // view's way up) and a height; with a planet, a yaw measured from the line out from the sun, so it goes round with it.
    yawFree: Math.PI / 2, pitchFree: HD_OVER, yawRel: HD_SIDE, pitchRel: HD_NEAR, yaw: Math.PI / 2, pitch: Math.PI / 2, turning: false,
  }).current;
  const canvas = useRef<HTMLCanvasElement>(null);
  const hdView = useRef<HdRenderer | null>(null);
  const colours = useRef(new Map<string, Vec3>()), worlds = useRef(new Map<string, World>()), glows = useRef<Record<string, number>>({}).current;
  const turned = useRef<Record<string, number>>({}).current; // how far each world has turned on its axis (kept, so changing how fast it spins doesn't fling it round)
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<SVGGElement>(null);
  type Part = { orbit?: SVGGElement | null; upright?: SVGGElement | null; label?: HTMLElement | null; busy?: SVGGElement | null; comet?: SVGGElement | null; land?: SVGCircleElement | null; blip?: SVGCircleElement | null; moons: (SVGGElement | null)[] };
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

  // Where the camera is headed, this moment.
  const target = useCallback(() => {
    const { ids, lines } = scene.current;
    const i = v.focus ? ids.indexOf(v.focus) : -1;
    const at: Point = v.focus === LEAD ? { x: 0, y: 0 } : i >= 0 ? placeAt(i, v.seconds) : v.pan;
    // With the panel open the system is looked at from the room that's left: beside it, or above it on a narrow screen.
    const beside = v.focus && v.w >= WIDE, above = v.focus && v.w < WIDE;
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
      if (scene.current.busy.has(id)) turn(p?.busy, (v.seconds * 360) / 7); // the dashed ring turns while they work
      p?.moons.forEach((m, j) => turn(m, MOON[j][1] + (v.seconds * 360) / MOON[j][0]));
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
        const glow = glows[id] = (glows[id] ?? 0) + ((scene.current.busy.has(id) ? 1 : 0) - (glows[id] ?? 0)) * rise;
        const world = worlds.current.get(id) ?? worldsFor(0, [{ id, color: NO_COLOUR }])[0];
        turned[id] = (turned[id] ?? i * 1.7) + (moving ? dt * world.spin : 0);
        hdBodies.push({
          id, i, angle: a, color: colours.current.get(id) ?? NO_COLOUR, world, turned: turned[id],
          glow, waiting: scene.current.waiting.has(id), focused: v.focus === id,
          blip: sky.blips[id] ? (now - blipped) / RING_MS : -1, land: sky.lands[id] ? (now - landed) / RING_MS : -1,
          quests: scene.current.out.get(id) ?? [], flight: sky.flights[id] ? { kind: flight.kind, since } : null,
        });
      }
    });
    // The sun: its dials turn (faster while the Quartermaster is at work) and it breathes. With nothing running it sends
    // a ring out now and then, as it does on the blank page; a ring lights each line as it passes through it.
    sky.dial[0] += dt * (scene.current.leading ? 40 : 8);
    sky.dial[1] -= dt * (scene.current.leading ? 60 : 12);
    turn(dials[0], sky.dial[0]);
    turn(dials[1], sky.dial[1]);
    const breath = Math.sin((v.seconds * 2 * Math.PI) / 5);
    core.current?.setAttribute("transform", `scale(${(1 + 0.03 * breath).toFixed(4)})`);
    corona.current?.setAttribute("opacity", ((scene.current.leading ? 1 : 0.72) + 0.1 * breath).toFixed(3));
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
        lead: LEAD, sun: { glow: sun, waiting: scene.current.waiting.has(LEAD) }, bodies: hdBodies,
        lines: Array.from({ length: lines + 1 }, (_, i) => ({ rot: ((i < ids.length ? hdBodies[i].angle : (v.seconds * 360) / DRIFT[i % DRIFT.length]) * Math.PI) / 180, lit: litAt(i), body: i < ids.length ? i : -1 })),
        ping: { r: going ? SUN_R + PING_SPEED * out : 0, a: going ? (1 - out / (PING_MS / 1000)) ** 1.6 : 0 }, reach: scene.current.reach, flightMs: FLIGHT_MS,
      });
      spots.splice(0, spots.length, ...made.spots);
      hd.resize(v.w, v.h, window.devicePixelRatio || 1);
      hd.draw(made.frame);
    }
    v.spots = spots;
    // A planet's name is on its far side from the sun (so it never lies across the sun), and goes round with it: its
    // box is pushed out along the line from the sun by as much as it is deep that way. The sun's own name keeps to the
    // side of it away from the nearest planet, which is the one that would otherwise pass through it.
    const from = (p: Spot, q: Spot): [number, number] => { const d = Math.hypot(p.x - q.x, p.y - q.y) || 1; return [(p.x - q.x) / d, (p.y - q.y) / d]; };
    for (const s of spots) {
      const label = parts[s.id]?.label;
      if (!label) continue;
      const w = label.offsetWidth, h = label.offsetHeight;
      const [ux, uy] = s.id !== LEAD ? from(s, spots[0]) : spots[1] ? from(spots[0], spots[1]) : [0, 1];
      const clear = s.id === LEAD ? s.r * (1 + 12 / SUN_R) + 8 : s.r * (1 + 9 / PLANET_R) + 6; // past the sun's dials, or the planet's nearest moon
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
    leader.current?.setAttribute("d", framed && v.w >= WIDE && framed.right + 14 < edge ? `M${(framed.right + 6).toFixed(1)} ${framed.y.toFixed(1)}H${edge}M${(framed.right + 3).toFixed(1)} ${(framed.y - 3).toFixed(1)}h6v6h-6z` : "");

    // From far off there's no room under a planet for what it's doing: just its name (the cells along the bottom still say).
    el.toggleAttribute("data-far", cam.k < FAR);
    const zoom = `×${(v.zoom * Math.exp(off.lk)).toFixed(1)}`;
    if (zoomRead.current && zoomRead.current.textContent !== zoom) zoomRead.current.textContent = zoom;
    const i = v.focus ? ids.indexOf(v.focus) : -1;
    if (bearing.current && i >= 0) {
      const deg = `${String(Math.round(angleAt(i, v.seconds)) % 360).padStart(3, "0")}°`;
      if (bearing.current.textContent !== deg) bearing.current.textContent = deg;
    }
  }, [v, parts, sheets, drifts, lits, dials, sky, glows, target]);

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
  }, [v, retarget]);
  const zoomBy = useCallback((times: number) => retarget(() => { v.zoom = clampZoom(v.zoom * times); }), [v, retarget]);
  // Someone you were looking at has left the crew.
  useEffect(() => { if (focus && !bodies.some((b) => b.id === focus)) lookAt(null); }, [focus, bodies, lookAt]);

  // Scroll to zoom: about the pointer while you're free to move, about the planet while you're with one.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.target instanceof Element && ev.target.closest(".orb-panel, .orb-strip, .orb-top")) return; // (the panel scrolls)
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
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "Escape") { if (focus) lookAt(null); else onClose(); }
    else if (ev.key === "+" || ev.key === "=") zoomBy(1.4);
    else if (ev.key === "-" || ev.key === "_") zoomBy(1 / 1.4);
    else if (ev.key === "0") lookAt(null);
    else if (/^[1-9]$/.test(ev.key) && bodies[Number(ev.key) - 1]) lookAt(bodies[Number(ev.key) - 1].id);
    else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const at = bodies.findIndex((b) => b.id === focus), step = ev.key === "ArrowRight" ? 1 : -1;
      lookAt(bodies[(at < 0 ? (step > 0 ? 0 : bodies.length - 1) : at + step + bodies.length) % bodies.length].id);
    }
    else if ((ev.key === "f" || ev.key === "F") && canFill) toggleFull();
    else if (ev.key === "d" || ev.key === "D") setDemo((on) => !on);
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
      if (Date.now() - new Date(e.time).getTime() > FRESH_MS) return;
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
  }, [feed, sky, v, parts]);

  // A line as the sun's ring lights it in passing (each line has the one, lit from draw above).
  const lit = (d: string, i: number) => <path className="orb-lit" d={d} opacity="0" ref={(el) => { lits[i] = el; }} />;

  const statusOf = (b: Body) => crew[b.name] ?? IDLE;
  const outOf = (b: Body) => quests.filter((q) => q.who === b.name);
  const sun = statusOf(bodies[0]);
  const waiting = quests.filter((q) => q.waiting).length;
  const looking = bodies.find((b) => b.id === focus);
  const ticks = (every: number, long: number) => { const gap = (2 * Math.PI * (reach + 6)) / (360 / every); return `${long} ${(gap - long).toFixed(3)}`; };

  return (
    <div className={cx("orbit", focus && "looking", hd && "hd")} ref={root} role="dialog" aria-modal="true" aria-label="Orbit: the crew at work" tabIndex={-1} onKeyDown={onKey}>
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
              <g key={p.id} className={cx("orb-planet", cClass(p.name), `st-${st.status}`, focus === p.id && "focused")} data-who={p.id}>
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
                      {/* A moon for each quest they have out. */}
                      {MOON.map((_, j) => out[j] && (
                        <g key={`${out[j].expId}|${out[j].id}`} className={cx("orb-moon", out[j].waiting && "st-waiting")} ref={(el) => { part(p.id).moons[j] = el; }}><circle cx={PLANET_R + 7 + j * 4.2} r="1.9" /></g>
                      ))}
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
        <path className="orb-leader" ref={leader} />
        <path className="orb-reticle hover" ref={hoverMark} />
        <path className={cx("orb-reticle", looking && cClass(looking.name))} ref={reticle} />
      </svg>
      <div className="orb-labels" aria-hidden="true">
        {bodies.map((b) => {
          const st = statusOf(b);
          return (
            <div key={b.id} className={cx("orb-label", cClass(b.name), `st-${st.status}`, focus === b.id && "focused")} ref={(el) => { part(b.id).label = el; }}>
              <b>{b.name}</b>
              {st.status !== "idle" && <span>{statusLine(st, outOf(b))}</span>}
            </div>
          );
        })}
      </div>
      <div className="orb-frame" aria-hidden="true"><i /><i /><i /><i /></div>

      <header className="orb-top">
        <div className="orb-title"><h2>Orbit</h2>{demo ? <span className="orb-pretend" role="status">Demo: a pretend camp. None of this is really happening.</span> : <span>The crew at work, as it happens</span>}</div>
        <dl className="orb-read">
          <div><dt>Expeditions</dt><dd>{running}</dd></div>
          <div><dt>Quests out</dt><dd>{quests.length}</dd></div>
          {waiting > 0 && <div className="warn"><dt>Waiting on you</dt><dd>{waiting}</dd></div>}
          <div><dt>Zoom</dt><dd ref={zoomRead}>×1.0</dd></div>
          <div><dt>Local</dt><dd><Clock /></dd></div>
        </dl>
        {asks > 0 && onDecision && <button type="button" className="orb-alert" onClick={onDecision}>{asks === 1 ? "1 decision needs you" : `${asks} decisions need you`}</button>}
        <div className="orb-tools" role="group" aria-label="The view">
          <button type="button" className="orb-tool" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button type="button" className="orb-tool" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.4)}>+</button>
          <button type="button" className="orb-tool" aria-label="Show the whole system" title="Show the whole system (0)" onClick={() => lookAt(null)}><Icon name="focus" /></button>
          {canFill && <button type="button" className="orb-tool" aria-pressed={full} aria-label={full ? "Leave full screen" : "Fill the screen"} title={`${full ? "Leave full screen" : "Fill the screen"} (F)`} onClick={toggleFull}>{full ? "⤡" : "⤢"}</button>}
          <button type="button" className="orb-tool worded" aria-pressed={hd} disabled={noHd} onClick={toggleHd}
            title={noHd ? "HD needs WebGL 2, which this browser isn't offering" : hd ? "Back to the flat view (H)" : "HD: the same system in three dimensions, as lit worlds round a sun (H). A proof of concept."}>HD</button>
          {hd && <button type="button" className="orb-tool worded" onClick={(ev) => roll(ev.shiftKey ? 0 : newSeed())}
            title={`Reroll: make up other worlds for the crew (R). Each keeps its crew member's colour, the Artificer keeps a station, and a world you've made your own stays as you made it.${seed ? " Shift-click (or Shift+R) for the camp's own." : ""}`}>Reroll</button>}
          <button type="button" className="orb-tool worded" aria-pressed={demo} title={demo ? "End the demo and show the real camp (D)" : "Play a demo: a pretend camp at work, with nobody really sent anywhere (D)"} onClick={() => setDemo((on) => !on)}>Demo</button>
          <button type="button" className="orb-tool" aria-label="Leave Orbit" title="Back to the page (Esc)" onClick={onClose}><Icon name="x" /></button>
        </div>
      </header>

      {looking && (
        <Panel key={looking.id} body={looking} nth={planets.indexOf(looking)} S={demo ? null : S} store={feed} st={statusOf(looking)} bearing={bearing}
          make={hd && made.get(looking.id) && (
            <WorldMaker name={looking.name} world={made.get(looking.id)!} changed={!!custom[looking.id]}
              onChange={(c) => recustom((was) => ({ ...was, [looking.id]: { ...was[looking.id], ...c } }))}
              onRoll={() => recustom((was) => ({ ...was, [looking.id]: { roll: newSeed() } }))}
              onReset={() => recustom(({ [looking.id]: _gone, ...rest }) => rest)} />
          )}
          onBack={() => lookAt(null)} onOpenAgent={onOpenAgent} onOpenQuest={onOpenQuest} onOpenConversation={onOpenConversation} />
      )}

      <p className="orb-hint" aria-hidden="true">Scroll to zoom · drag to {hd ? "turn" : "move"} · click a planet to stay with it · Esc to step back</p>
      <nav className="orb-strip" aria-label="The crew">
        {bodies.map((b, n) => {
          const st = statusOf(b), out = outOf(b), text = statusLine(st, out);
          return (
            <button key={b.id} type="button" className={cx("orb-cell", cClass(b.name), `st-${st.status}`, focus === b.id && "on")} aria-pressed={focus === b.id}
              aria-label={`${b.name}: ${text}`} title={`${focus === b.id ? "Back to the whole system" : `Look at ${b.name}`}${n < 9 ? ` (${n + 1})` : ""}`}
              onClick={() => lookAt(focus === b.id ? null : b.id)}>
              <span className="orb-cell-who"><i className="orb-dot" />{b.name}{out.length > 1 && <em>×{out.length}</em>}<kbd>{n < 9 ? n + 1 : ""}</kbd></span>
              <span className="orb-cell-doing">{text}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
