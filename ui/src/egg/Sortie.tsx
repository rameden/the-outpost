// The Sortie, on screen: Barnstorm's other game (its rules are sortie.ts). It's flown over the
// page itself, as wrecking it is: the whole window above the bar is the sky, with the page
// showing through as the ground below. Your plane is at the bottom with its nose up, and
// formations of enemy aircraft come through along their paths. Thin wisps drift down the
// window, which is all that says you're flying forward.
//
// With a page behind it, everything has to be told apart at a glance: every aircraft and
// round has a dark outline and a shadow; your plane is pale and theirs are red (the ferry,
// which is worth shooting for its crate, is yellow); your rounds are thin and pale blue, and
// theirs are fat orange balls with a dark ring.
//
// The rest of the sky: clouds are big, pale and blocky, and drawn over the aircraft (in one,
// you're see-through too: hidden); flak is a ring on the air where you were, closing as its fuse
// burns; a balloon is silver, with its cable hanging under it; missiles are small, white and
// trailing smoke. A chaser's warning is an orange arrow flashing at the bottom edge. At night
// everything's dimmed but the rounds (yours, theirs, the missiles and the flak), which glow.
//
// Arrows fly (eight ways), space fires, X spends a loop, P pauses, Esc lands. After a stage, 1 to 3
// (or ← → and space) picks an upgrade. D, at the start or once it's over, flies today's daily run
// (and D again goes back to a random one). Easy, Normal and Hard are buttons in the bar: a new
// level starts at once if nothing's happened yet, or else from the next run. Paused, it's all still here (the stage, the score,
// every aircraft where it was) and nothing moves until you resume.

import { useCallback, useEffect, useRef, useState } from "react";
import { storeGet, storeSet } from "../api.ts";
import { cx } from "../format.ts";
import { EggBar, PausedPill, usePause, type GameProps } from "./Bar.tsx";
import { PAINT, PIXEL, SPRITE, UP, scoreText } from "./flight.ts";
import { bareOf, quiet, skinFor } from "./skins.ts";
import { packNow } from "../themes.ts";
import {
  CABLE, CHASE_WARN, ENEMY, FLAK_FUSE, FLAK_RADIUS, INTRO, LEVELS, LEVEL_ORDER, LOOP_LASTS, PERKS, SHIPS, TWISTS,
  chainTimes, dailySeed, liningUp, loopPose, newGame, shielded, step, wingAt,
  type CrateKind, type EnemyKind, type Field, type Game, type Input, type Level, type SortieEvent,
} from "./sortie.ts";

const BEST = "camp-sortie-best";
const LEVEL = "camp-sortie-level"; // the level last chosen
const dailyBest = (day: number, level: Level) => `camp-sortie-daily-${day}-${level}`; // (a best for each day's run, at each level)
const storedLevel = (): Level => { const it = storeGet(LEVEL); return it === "easy" || it === "hard" ? it : "normal"; };
const BAR = 34; // the bar's height (styles.css): the sky stops above it
const FLY: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const FIRE = " ", LOOP = "x", PAUSE = "p", DAILY = "d", PICKS = ["1", "2", "3"];

// The aircraft carrier, bow up: a long grey hull coming to a point, a flight deck with a broken
// white line down it, an island to one side, a red gun at each end and a red band across the
// deck fore and aft (so it reads as theirs, grey as it is). Built row by row, not typed out.
function carrierRows(): string[] {
  const WIDE = 17, LONG = 41, mid = 8;
  return Array.from({ length: LONG }, (_, r) => {
    const half = r < 6 ? r + 1 : r > LONG - 3 ? 7 - (r - (LONG - 3)) : 7; // the bow's point, and the stern's corners
    return Array.from({ length: WIDE }, (_, c) => {
      const d = Math.abs(c - mid);
      if (d > half) return ".";
      if (d === half || r === 0 || r === LONG - 1) return "D";
      if (r < 6) return "H"; // the bow's plating
      if (r === 7 || r === LONG - 4) return "T"; // the red bands
      if (c >= 4 && c <= 6 && r >= 9 && r <= 11) return "T"; // the bow gun
      if (c >= 10 && c <= 12 && r >= 30 && r <= 32) return "T"; // the stern gun
      if (c >= 12 && c <= 14 && r >= 16 && r <= 23) return c === 13 && r === 18 ? "Y" : "I"; // the island, with a light on it
      if (c === mid && r % 4 < 2 && r > 12) return "W"; // the line down the deck
      return "K";
    }).join("");
  });
}

// The missile boat, bow up: a narrow grey hull, a bridge amidships and two red launch tubes
// behind it (where the missiles come from), with a red band across the bow.
function boatRows(): string[] {
  const WIDE = 9, LONG = 21, mid = 4;
  return Array.from({ length: LONG }, (_, r) => {
    const half = r < 4 ? r : r > LONG - 2 ? 3 : 4;
    return Array.from({ length: WIDE }, (_, c) => {
      const d = Math.abs(c - mid);
      if (d > half) return ".";
      if (d === half || r === 0 || r === LONG - 1) return "D";
      if (r === 5) return "T"; // the red band
      if (r >= 8 && r <= 10 && d <= 1) return r === 8 && c === mid ? "Y" : "I"; // the bridge, with a light on it
      if (r >= 13 && r <= 16 && d === 2) return "T"; // the launch tubes
      return r < 4 ? "H" : "K";
    }).join("");
  });
}

// ---------- The aircraft, a pixel at a time (nose up) ----------
const ART: Record<EnemyKind, { rows: string[]; paint: Record<string, string> }> = {
  scout: {
    paint: { D: "#4a0f12", R: "#e2463c", C: "#ffe2b0", W: "#ff9a86" },
    rows: [
      ".....D.....",
      "....DRD....",
      "....DCD....",
      ".DDDDRDDDD.",
      "DRRRRRRRRRD",
      "DWRRRRRRRWD",
      ".DDDDRDDDD.",
      "....DRD....",
      "...DDRDD...",
      "...DRRRD...",
      "...DDDDD...",
    ],
  },
  heavy: {
    paint: { D: "#35090d", R: "#b8322c", C: "#ffe2b0", W: "#e2463c", Y: "#ffd84a" },
    rows: [
      ".........D.........",
      "........DRD........",
      "........DCD........",
      "...D....DRD....D...",
      "..DYD...DRD...DYD..",
      ".DDRDDDDDRDDDDDRDD.",
      "DRRRRRRRRRRRRRRRRRD",
      "DRWRRRRRRRRRRRRRWRD",
      ".DDDDDDRRRRRDDDDDD.",
      ".......DRRRD.......",
      ".......DRRRD.......",
      "........DRD........",
      "......DDDRDDD......",
      ".....DRRRRRRRD.....",
      "......DDDDDDD......",
    ],
  },
  ferry: {
    paint: { D: "#5a3d08", Y: "#f0c040", C: "#fff3c4", W: "#fff3c4" },
    rows: [
      ".......D.......",
      "......DYD......",
      "......DCD......",
      "..DDDDDYDDDDD..",
      ".DYYYYYYYYYYYD.",
      "DYYWYYYYYYYWYYD",
      ".DDDDDDYDDDDDD.",
      "......DYD......",
      "......DYD......",
      ".....DDYDD.....",
      ".....DDDDD.....",
    ],
  },
  // Small, pink and pointed: it's coming straight at you.
  dart: {
    paint: { D: "#4a0a2c", P: "#ff4fa0", C: "#ffe2f0" },
    rows: [
      "...D...",
      "..DPD..",
      "..DCD..",
      ".DDPDD.",
      "DPPPPPD",
      ".DDPDD.",
      "..DPD..",
      ".DDPDD.",
      ".D...D.",
    ],
  },
  // A scout in an ace's colours: purple, with gold on it.
  ace: {
    paint: { D: "#1c0f33", R: "#7a4bd6", C: "#ffd84a", W: "#ffd84a" },
    rows: [
      ".....D.....",
      "....DRD....",
      "....DCD....",
      ".DDDDRDDDD.",
      "DWRRRRRRRWD",
      "DWRRRWRRRWD",
      ".DDDDRDDDD.",
      "....DRD....",
      "...DDWDD...",
      "...DRRRD...",
      "...DDDDD...",
    ],
  },
  // Round, dark and spiked, with something red in the middle of it.
  mine: {
    paint: { D: "#1a1a22", M: "#555a68", R: "#ff5a3c", S: "#ff5a3c" },
    rows: [
      "....S....",
      "..DDDDD..",
      ".DMMMMMD.",
      "SDMMRMMDS",
      ".DMRRRMD.",
      "SDMMRMMDS",
      ".DMMMMMD.",
      "..DDDDD..",
      "....S....",
    ],
  },
  // Wide and burnt orange, with a hatch for what it's carrying.
  hauler: {
    paint: { D: "#3a1c08", R: "#c8641e", C: "#ffe2b0", Y: "#ffd84a", H: "#3a1c08" },
    rows: [
      "........D........",
      ".......DRD.......",
      ".......DCD.......",
      "..DDDDDDRDDDDDD..",
      ".DRRRRRRRRRRRRRD.",
      "DRRYRRRRRRRRRYRRD",
      "DRRRRRRHHHRRRRRRD",
      ".DDDDDDRRRDDDDDD.",
      ".......DRD.......",
      "......DDRDD......",
      "......DDDDD......",
    ],
  },
  carrier: { paint: { D: "#161c26", H: "#8a93a3", K: "#5d6675", W: "#e8edf2", I: "#2a323e", Y: "#ffd84a", T: "#e2463c" }, rows: carrierRows() },
  boat: { paint: { D: "#161c26", H: "#8a93a3", K: "#5d6675", I: "#2a323e", Y: "#ffd84a", T: "#e2463c" }, rows: boatRows() },
  // A scout with a gold band and gold tips, a size up: shoot it first and the rest panic.
  leader: {
    paint: { D: "#4a0f12", R: "#e2463c", C: "#ffe2b0", Y: "#ffd84a" },
    rows: [
      "......D......",
      ".....DRD.....",
      ".....DCD.....",
      "..DDDDYDDDD..",
      ".DRRRRYRRRRD.",
      "DYRRRRYRRRRYD",
      "DYYYYYYYYYYYD",
      ".DDDDDRDDDDD.",
      ".....DRD.....",
      "....DDYDD....",
      "....DRRRD....",
      "....DDDDD....",
    ],
  },
  // Small, orange and swept back, nose up: it comes from behind you.
  chaser: {
    paint: { D: "#3e1604", O: "#ff7a1a", C: "#ffe9c8", W: "#ffd84a" },
    rows: [
      "....D....",
      "...DOD...",
      "...DCD...",
      "..DOOOD..",
      ".DOOOOOD.",
      "DOOWOWOOD",
      "DOD.O.DOD",
      "D..DOD..D",
      "...DDD...",
    ],
  },
  // Broad, dark steel and red, with a band of armour across its nose ("S": bright while it's covered).
  gunship: {
    paint: { D: "#1b1013", R: "#8c2a2a", K: "#4d4650", C: "#ffe2b0", S: "#c9d3e0", Y: "#ffd84a" },
    rows: [
      "......DDDDD......",
      ".....DSSSSSD.....",
      "....DSSSCSSSD....",
      "....DDDRRRDDD....",
      "..D...DRRRD...D..",
      ".DYD..DRRRD..DYD.",
      "DDKDDDDRRRDDDDKDD",
      "DKKKKKKKRKKKKKKKD",
      "DRRRRRRRRRRRRRRRD",
      "DKKKKKKKRKKKKKKKD",
      ".DDDDDDRRRDDDDDD.",
      ".......DRD.......",
      "......DDRDD......",
      ".....DRRRRRD.....",
      "......DDDDD......",
    ],
  },
  // Silver and round, with a red band: it's moored to the ground (drawn as it flies, not turned).
  balloon: {
    paint: { D: "#1e232c", S: "#c3cad4", L: "#eef2f6", R: "#e2463c" },
    rows: [
      ".....DDDDD.....",
      "...DDSSSSSDD...",
      "..DSLLSSSSSSD..",
      ".DSLLSSSSSSSSD.",
      ".DSLSSSSSSSSSD.",
      "DRRRRRRRRRRRRRD",
      "DSSSSSSSSSSSSSD",
      "DSSSSSSSSSSSSSD",
      ".DSSSSSSSSSSSD.",
      ".DSSSSSSSSSSSD.",
      "..DSSSSSSSSSD..",
      "...DDSSSSSDD...",
      ".....DDSDD.....",
      ".......D.......",
    ],
  },
  // The biggest thing in the sky: four engines and a lot of dark red.
  flagship: {
    paint: { D: "#2a070b", R: "#9c2a26", C: "#ffe2b0", W: "#e2463c", Y: "#ffd84a" },
    rows: [
      "............D............",
      "...........DRD...........",
      "...........DCD...........",
      "....D......DRD......D....",
      "...DYD.....DRD.....DYD...",
      "...DRD..D..DRD..D..DRD...",
      "..DDRDDDYDDDRDDDYDDDRDD..",
      ".DRRRRRRRRRRRRRRRRRRRRRD.",
      "DRRWRRRRRRRRCRRRRRRRRWRRD",
      "DRRRRRRRRRRRRRRRRRRRRRRRD",
      ".DDDDDDDDRRRRRRRDDDDDDDD.",
      ".........DRRRRRD.........",
      "..........DRRRD..........",
      "..........DRRRD..........",
      "........DDDRRRDDD........",
      ".......DRRRRRRRRRD.......",
      "........DDDDDDDDD........",
    ],
  },
};
const CRATES: Record<CrateKind, { color: string; glyph: string[]; says: string }> = {
  wingmen: { color: "#2f9c95", glyph: ["X...X", "X...X", "X.X.X", "XX.XX", "X...X"], says: "WINGMEN!" },
  loop: { color: "#7a4bd6", glyph: [".XXX.", "X...X", "X...X", "X...X", ".XXX."], says: "+1 LOOP" },
  gun: { color: "#d8402f", glyph: ["..X..", ".XXX.", "X.X.X", "..X..", "..X.."], says: "GUNS UP!" },
  medal: { color: "#c9971a", glyph: ["..X..", "XXXXX", ".XXX.", ".X.X.", "X...X"], says: "MEDAL +1000" },
};
const INK = "#0b1730";
// A missile, nose up: white, with red bands and fins.
const MISSILE = { rows: [".D.", "DWD", "DWD", "DRD", "DWD", "DRD", "DWD", "D.D"], paint: { D: INK, W: "#f3f5f8", R: "#e2463c" } };
const BARE = { ...ART.gunship.paint, S: "#5d6675" }; // a gunship with its armour turned away from you
// A chaser's warning: an orange arrow, pointing up the column it's coming.
const ARROW = { rows: ["...D...", "..DOD..", ".DOOOD.", "DOOOOOD", "DDDODDD", "..DOD..", "..DDD.."], paint: { D: INK, O: "#ff7a1a" } };
const NIGHT = "rgba(3, 6, 18, .58)";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

type Bit = { x: number; y: number; vx: number; vy: number; size: number; color: string; age: number; life: number };
type Popup = { x: number; y: number; text: string; age: number };

// The same "random" numbers every time, so the wisps are where they were.
function seeded(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// Words broken into lines of at most `most` characters, for the upgrade cards.
function wrap(text: string, most: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + word.length <= most) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function Sortie({ paused, onPause, onResume, onClose, onMode }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState({ score: 0, stage: 1, lives: 3, loops: 3, guns: 1, wingmen: 0, times: 1, daily: false, twist: "", perks: "", level: storedLevel() });
  const [level, setLevel] = useState<Level>(storedLevel); // the level chosen (which the run under way may not be at yet)
  const wanted = useRef(level);
  const chose = useRef<() => void>(() => {});
  const choose = (it: Level) => { wanted.current = it; storeSet(LEVEL, it); setLevel(it); chose.current(); };
  const [best, setBest] = useState(() => Number(storeGet(BEST)) || 0);
  const [todays, setTodays] = useState(0); // the best on today's daily run
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
    let stopped = false; // paused: nothing moves, and the keys are the page's
    let sky = { width: innerWidth, height: innerHeight };
    let field: Field = { width: 0, height: 0 };
    let game: Game;
    let bits: Bit[] = [], popups: Popup[] = [];
    let top = Number(storeGet(BEST)) || 0, clock = 0;
    let warned = 0; // seconds left of "flagship inbound"
    let todayTop = 0; // the best on the daily run being flown (0 when it isn't one)
    let choice = 0; // the upgrade highlighted, while there's one to pick
    const held = new Set<string>();
    let loopKey = false, goKey = false, pickKey = 0, dailyKey = false; // pressed since the last frame

    (document.activeElement as HTMLElement | null)?.blur?.();

    const size = () => {
      sky = { width: innerWidth, height: innerHeight };
      field = { width: sky.width, height: Math.max(200, sky.height - BAR) };
      const dpr = devicePixelRatio || 1;
      cv.width = Math.round(sky.width * dpr);
      cv.height = Math.round(sky.height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    // A game from the top, at the level chosen: a random run, or today's (which is the same sky for everyone today).
    const fly = (daily: boolean, run?: number) => {
      const level = wanted.current;
      game = daily ? newGame(field, run ?? dailySeed(new Date()), true, level) : newGame(field, undefined, false, level);
      todayTop = daily ? Number(storeGet(dailyBest(game.run, level))) || 0 : 0;
      setTodays(todayTop);
      bits = []; popups = []; warned = 0; choice = 0;
    };
    fly(false);
    again.current = () => fly(game.daily, game.run);
    // D switches runs, and a new level starts at once, only before anything's happened, or once
    // it's all over. (Otherwise the level waits for the next run.)
    const canSwitch = () => game.phase === "over" ? game.since > 1 : game.stage === 1 && game.score === 0 && game.phase !== "pick";
    chose.current = () => { if (canSwitch() || game.phase === "over") fly(game.daily, game.daily ? game.run : undefined); };

    const mine = (ev: KeyboardEvent) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    const key = (ev: KeyboardEvent) => (ev.key.length === 1 ? ev.key.toLowerCase() : ev.key);
    const ours = (k: string) => k in FLY || k === FIRE || k === LOOP;
    const onDown = (ev: KeyboardEvent) => {
      if (stopped || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = key(ev);
      if (k === "Escape") { mine(ev); close.current(); return; }
      if (k === PAUSE) { mine(ev); pause.current(); return; }
      if (k === DAILY && canSwitch()) { mine(ev); if (!ev.repeat) dailyKey = true; return; }
      if (game.phase === "pick") {
        const n = PICKS.indexOf(k);
        if (n >= 0 && n < game.offer.length) { mine(ev); if (!ev.repeat) pickKey = n + 1; return; }
        if (k === "Enter") { mine(ev); if (!ev.repeat) pickKey = choice + 1; return; }
        if (k === "ArrowLeft" || k === "ArrowRight") { if (!ev.repeat) choice = (choice + (k === "ArrowLeft" ? -1 : 1) + game.offer.length) % game.offer.length; }
      }
      if (!ours(k)) return;
      mine(ev);
      if (!ev.repeat) { if (k === LOOP) loopKey = true; if (k === FIRE) goKey = true; }
      held.add(k);
    };
    const onUp = (ev: KeyboardEvent) => { const k = key(ev); if (!stopped && ours(k)) { mine(ev); held.delete(k); } };
    const letGo = () => held.clear();
    addEventListener("keydown", onDown, true);
    addEventListener("keyup", onUp, true);
    addEventListener("blur", letGo);
    addEventListener("resize", size);

    // ---------- What the game says happened, made visible ----------
    const burst = (x: number, y: number, n: number, colors: string[], fast = 260) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * fast;
        bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: Math.random() < 0.5 ? 3 : 5, color: colors[i % colors.length], age: 0, life: 0.3 + Math.random() * 0.45 });
      }
    };
    const show = (events: SortieEvent[]) => {
      for (const e of events) {
        if (e.type === "boom") burst(e.x, e.y, e.big ? 34 : 16, ["#ffd84a", "#ff8a3a", "#ffffff", "#8a2018"]);
        else if (e.type === "spark") burst(e.x, e.y, 4, ["#ffffff", "#ffd84a"], 120);
        else if (e.type === "lost") burst(e.x, e.y, 44, ["#ffffff", PAINT.G, "#ff8a3a", "#ffd84a"], 340);
        else if (e.type === "points") popups.push({ x: e.x, y: e.y - 14, text: e.times > 1 ? `+${e.n} ×${e.times}` : `+${e.n}`, age: 0 });
        else if (e.type === "flight") popups.push({ x: e.x, y: e.y - 34, text: `FLIGHT DOWN +${e.n}`, age: -0.6 });
        else if (e.type === "extra") popups.push({ x: e.x, y: e.y - 40, text: `EXTRA ${skinFor(packNow())?.craft ?? "PLANE"}`, age: -0.9 });
        else if (e.type === "warning") warned = 2.2;
        else if (e.type === "pickup") { popups.push({ x: e.x, y: e.y - 18, text: CRATES[e.what].says, age: -0.5 }); burst(e.x, e.y, 12, ["#ffffff", CRATES[e.what].color], 150); }
        else if (e.type === "block") burst(e.x, e.y, 3, ["#c9d3e0", "#8a93a3"], 90);
        else if (e.type === "plate") { popups.push({ x: e.x, y: e.y - 24, text: "ARMOUR PLATE GONE", age: -0.6 }); burst(e.x, e.y, 18, ["#c9d3e0", "#8a93a3", "#ffffff"], 200); }
        else if (e.type === "flak") burst(e.x, e.y, 26, ["#3a3f4b", "#5d6675", "#ff8a3a", "#ffd84a"], 220);
        else if (e.type === "dodge") popups.push({ x: e.x, y: e.y - 30, text: `DODGED +${e.n}`, age: -0.6 });
      }
    };

    // ---------- Drawing ----------
    const sprite = (g: CanvasRenderingContext2D, rows: string[], paint: Record<string, string>, px: number, flat?: string) => {
      const w = rows[0].length, h = rows.length;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = rows[r][c];
        if (ch === "." || !paint[ch]) continue; // (a letter with no paint isn't drawn: a flame, flickering)
        g.fillStyle = flat ?? paint[ch];
        g.fillRect((c - w / 2) * px, (r - h / 2) * px, px, px);
      }
    };
    // Something in the air, and its shadow on the page: the further apart, the higher it is.
    const flying = (g: CanvasRenderingContext2D, x: number, y: number, turn: number, rows: string[], paint: Record<string, string>, px: number, o: { sx?: number; sy?: number; grow?: number; high?: number; flat?: string } = {}) => {
      const notch = Math.PI / 16, angle = Math.round(turn / notch) * notch; // turned in steps, so its pixels stay pixels
      const high = o.high ?? 0, grow = o.grow ?? 1;
      g.save(); g.translate(x + 8 + high * 30, y + 11 + high * 40); g.rotate(angle); g.scale((o.sx ?? 1) * 0.9, Math.abs(o.sy ?? 1) * 0.9); sprite(g, rows, paint, px, "rgba(4, 10, 24, .35)"); g.restore();
      g.save(); g.translate(x, y); g.rotate(angle); g.scale((o.sx ?? 1) * grow, (o.sy ?? 1) * grow); sprite(g, rows, paint, px, o.flat); g.restore();
    };
    // A cloud, in 8px blocks: a flattened body with three lumps on top, white with grey along its
    // underside, and its shadow (the same shape, flat). Painted once for each size, then reused.
    const puffs = new Map<number, HTMLCanvasElement & { shadow: HTMLCanvasElement }>();
    const puff = (w: number, h: number) => {
      const key = Math.round(w);
      if (puffs.has(key)) return puffs.get(key)!;
      const CELL = 8, rx = w / 2, ry = h / 2;
      const blob = (x: number, y: number, cx: number, cy: number, a: number, b: number) => ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 <= 1;
      const inside = (x: number, y: number) => blob(x, y, 0, ry * 0.2, rx, ry * 0.8)
        || blob(x, y, -rx * 0.4, -ry * 0.25, rx * 0.4, ry * 0.6) || blob(x, y, rx * 0.15, -ry * 0.45, rx * 0.42, ry * 0.55) || blob(x, y, rx * 0.55, -ry * 0.05, rx * 0.32, ry * 0.5);
      const make = () => Object.assign(document.createElement("canvas"), { width: Math.ceil(w) + CELL, height: Math.ceil(h) + CELL });
      const art = make(), shadow = make();
      const a = art.getContext?.("2d"), s = shadow.getContext?.("2d");
      if (!a || !s) return null;
      for (let y = -ry; y <= ry; y += CELL) for (let x = -rx; x <= rx; x += CELL) {
        if (!inside(x, y)) continue;
        const at = [Math.round(x + rx), Math.round(y + ry)] as const;
        a.fillStyle = inside(x, y + CELL) ? "#f6f8fc" : "#c7cfdb"; a.fillRect(at[0], at[1], CELL, CELL);
        s.fillStyle = "#04081a"; s.fillRect(at[0], at[1], CELL, CELL);
      }
      if (puffs.size > 40) puffs.clear();
      const made = Object.assign(art, { shadow });
      puffs.set(key, made);
      return made;
    };
    const air = seeded(7), wisps = Array.from({ length: 46 }, () => ({ x: air(), y: air(), long: 10 + Math.floor(air() * 4) * 6, fast: 1 + air() * 0.8 }));
    const label = (g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, fill = "#ffffff") => {
      g.font = `bold ${px}px ${MONO}`;
      g.textAlign = "center";
      g.lineJoin = "round";
      g.lineWidth = Math.max(3, px / 5); g.strokeStyle = INK; g.strokeText(text, x, y);
      g.fillStyle = fill; g.fillText(text, x, y);
    };

    const draw = (g: CanvasRenderingContext2D) => {
      g.clearRect(0, 0, sky.width, sky.height);
      const skin = skinFor(packNow()); // the theme pack's look for all of it, if it has one (looked up every frame: change the pack and the game changes under you)
      g.imageSmoothingEnabled = false;
      g.save();
      g.beginPath(); g.rect(0, 0, field.width, field.height); g.clip(); // (the bar is below)

      // The air going by: a few thin wisps drifting down, faint enough that the page is still the ground.
      g.fillStyle = "rgba(128, 134, 148, .22)";
      for (const w of wisps) g.fillRect(Math.round(w.x * field.width), Math.round(((w.y * (field.height + 60) + game.scroll * w.fast * 3) % (field.height + 60)) - 40), 2, w.long);

      for (const c of game.crates) {
        const half = 13;
        g.save(); g.translate(Math.round(c.x), Math.round(c.y + Math.sin(c.age * 5) * 2));
        g.fillStyle = "rgba(4, 10, 24, .35)"; g.fillRect(-half + 5, -half + 7, half * 2, half * 2);
        g.fillStyle = INK; g.fillRect(-half, -half, half * 2, half * 2);
        g.fillStyle = "#f3f5f8"; g.fillRect(-half + 3, -half + 3, half * 2 - 6, half * 2 - 6);
        g.fillStyle = CRATES[c.what].color; g.fillRect(-half + 5, -half + 5, half * 2 - 10, half * 2 - 10);
        sprite(g, CRATES[c.what].glyph, { X: "#ffffff" }, 3);
        g.restore();
      }

      const p = game.player;
      // The ships (a carrier, a missile boat) are down on the water: under everything else, and with no shadow.
      for (const e of game.enemies) {
        if (!SHIPS.has(e.kind) || e.age < 0) continue;
        g.save(); g.translate(Math.round(e.x), Math.round(e.y)); g.rotate(Math.PI); // (bow towards you)
        sprite(g, ART[e.kind].rows, skin?.enemies[e.kind].paint ?? ART[e.kind].paint, PIXEL, e.hurt > 0 ? "#ffffff" : undefined);
        g.restore();
      }
      for (const e of game.enemies) {
        if (e.age < 0 || SHIPS.has(e.kind)) continue;
        // What it looks like: the theme pack's version of it, if the pack has one.
        const look = skin?.enemies[e.kind];
        const art = { rows: look?.rows ?? ART[e.kind].rows, paint: look?.paint ?? ART[e.kind].paint };
        // A chaser waiting under the bottom of the screen: an arrow there, flashing, under the column it's coming up.
        if (e.kind === "chaser" && e.age < CHASE_WARN) {
          if (Math.floor(clock * 8) % 2 === 0) { g.save(); g.translate(Math.round(e.x), field.height - 20); sprite(g, ARROW.rows, ARROW.paint, PIXEL); g.restore(); }
          continue;
        }
        // A balloon's cable, straight down from it to the ground (until it's been cut).
        if (e.kind === "balloon" && !e.fired) {
          const x = Math.round(e.x), top = Math.round(e.y + ENEMY.balloon.size);
          g.fillStyle = "rgba(4, 10, 24, .3)"; g.fillRect(x + 14, top + 18, 2, CABLE); // (its shadow)
          g.fillStyle = INK; g.fillRect(x - 1, top, 3, CABLE);
          g.fillStyle = "#c3cad4"; g.fillRect(x, top, 1, CABLE);
        }
        if (e.kind === "balloon") { flying(g, e.x, e.y, 0, art.rows, art.paint, PIXEL, { high: 0.3 }); continue; }
        const paint = e.kind === "gunship" && !shielded(e) ? (look ? bareOf(look.paint, look.bare) : BARE) : art.paint;
        // A dart lining up: a broken line from it to you, flickering, so you know to move.
        if (liningUp(e) && p.alive && Math.floor(clock * 14) % 2 === 0) {
          const far = Math.hypot(p.x - e.x, p.y - e.y), ux = (p.x - e.x) / far, uy = (p.y - e.y) / far;
          g.fillStyle = "#ff4fa0";
          for (let d = 26; d < far - 20; d += 16) g.fillRect(Math.round(e.x + ux * d) - 2, Math.round(e.y + uy * d) - 2, 4, 4);
        }
        const high = e.kind === "heavy" || e.kind === "flagship" || e.kind === "gunship" ? 0.15 : 0;
        flying(g, e.x, e.y, look?.upright ? 0 : e.heading - UP, art.rows, paint, PIXEL, { flat: e.hurt > 0 ? "#ffffff" : undefined, high }); // (a person stays the right way up)
      }

      // The clouds, over the aircraft (they're high), their shadows faint on the page below.
      for (const c of game.clouds) {
        const art = puff(c.w, c.h);
        if (!art) continue;
        const x = Math.round(c.x - art.width / 2), y = Math.round(c.y - art.height / 2);
        g.globalAlpha = 0.12; g.drawImage(art.shadow, x + 30, y + 42);
        g.globalAlpha = 0.88; g.drawImage(art, x, y);
        g.globalAlpha = 1;
      }
      // Night: all of that dimmed. What's drawn from here on glows through it.
      if (game.twist === "night") { g.fillStyle = NIGHT; g.fillRect(0, 0, field.width, field.height); }

      // Flak: a ring on the air where you were, a smaller one closing on it as the fuse burns,
      // flashing faster at the end. Be out of it (or looping through it) when they meet.
      for (const f of game.flak) {
        if (f.wait > 0) continue;
        const left = Math.max(0, f.fuse / FLAK_FUSE), x = Math.round(f.x), y = Math.round(f.y);
        if (Math.floor(clock * (left < 0.35 ? 18 : 7)) % 2) continue;
        const ring = (r: number, width: number, color: string) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.lineWidth = width; g.strokeStyle = color; g.stroke(); };
        ring(FLAK_RADIUS, 5, INK); ring(FLAK_RADIUS, 2, "#ff8a3a");
        ring(Math.max(3, FLAK_RADIUS * left), 4, INK); ring(Math.max(3, FLAK_RADIUS * left), 2, "#ffd84a");
        g.fillStyle = "#ff8a3a"; g.fillRect(x - 6, y - 1, 12, 3); g.fillRect(x - 1, y - 6, 3, 12);
      }

      // Their rounds: fat, orange, ringed in dark. Yours: thin and pale. Missiles: small and white.
      for (const r of game.rounds) {
        const x = Math.round(r.x), y = Math.round(r.y), beat = Math.floor(clock * 10) % 2;
        g.fillStyle = "#3a0c10"; g.fillRect(x - 7, y - 4, 14, 8); g.fillRect(x - 4, y - 7, 8, 14);
        g.fillStyle = "#ffb020"; g.fillRect(x - 5, y - 3, 10, 6); g.fillRect(x - 3, y - 5, 6, 10);
        g.fillStyle = "#ffffff"; g.fillRect(x - 2 - beat, y - 2 - beat, 4 + beat * 2, 4 + beat * 2);
      }
      for (const m of game.missiles) if (!m.gone) flying(g, m.x, m.y, m.heading - UP, MISSILE.rows, MISSILE.paint, 2);
      for (const s of game.shots) {
        if (skin) {
          // The pack's own shot (a bolt, a rolled paper, a star), some of them turning over as they go.
          const turns = skin.shot.spin ? (Math.floor(clock * 14 + s.x / 9) % 4) * (Math.PI / 2) : 0;
          g.save(); g.translate(Math.round(s.x), Math.round(s.y)); g.rotate(turns); sprite(g, skin.shot.rows, skin.shot.paint, 2); g.restore();
          continue;
        }
        g.fillStyle = INK; g.fillRect(Math.round(s.x) - 2.5, Math.round(s.y) - 8, 5, 16);
        g.fillStyle = "#c8f6ff"; g.fillRect(Math.round(s.x) - 1.5, Math.round(s.y) - 7, 3, 14);
      }

      // You, and the wingmen. In a loop the plane tips up, goes over on its back high above its
      // shadow, and comes down level where it started.
      // (In a cloud you're see-through: they can't see you, and nor, quite, can you.)
      if (game.hidden) g.globalAlpha = 0.45;
      if (p.alive && !(p.safe > 0 && Math.floor(clock * 12) % 2)) {
        const pose = p.loop > 0 ? loopPose(1 - p.loop / LOOP_LASTS) : { ahead: 0, height: 0, pitch: 1 };
        const sy = pose.pitch < 0 ? Math.min(-0.14, pose.pitch) : Math.max(0.14, pose.pitch);
        const o = { sx: 1 - 0.25 * Math.abs(p.lean), sy, grow: 1 + 0.55 * pose.height, high: pose.height };
        // (The pack's craft, if it has one, its flame flickering.)
        const me = skin?.player, rows = me?.rows ?? SPRITE;
        const paint = !me ? PAINT : me.flicker && Math.floor(clock * 24) % 2 === 0 ? quiet(me.paint, me.flicker) : me.paint;
        game.wingmen.forEach((there, i) => { if (there) { const w = wingAt(game, i); flying(g, w.x, w.y - pose.ahead, 0, rows, paint, 2, o); } });
        flying(g, p.x, p.y - pose.ahead, 0, rows, paint, PIXEL, o);
      }
      g.globalAlpha = 1;

      for (const b of bits) {
        g.globalAlpha = b.age / b.life < 0.5 ? 1 : b.age / b.life < 0.8 ? 0.6 : 0.3;
        g.fillStyle = b.color;
        g.fillRect(Math.round(b.x), Math.round(b.y), b.size, b.size);
      }
      g.globalAlpha = 1;
      for (const t of popups) {
        if (t.age < 0 && Math.floor(t.age * 12) % 2) continue;
        g.globalAlpha = t.age < 0.5 ? 1 : 0.5;
        label(g, t.text, t.x, t.y, 12, "#ffd84a");
      }
      g.globalAlpha = 1;

      // The flagship: how much of it is left, along the top; and a warning that it's on its way.
      const cx = field.width / 2, cy = field.height * 0.4;
      const boss = game.enemies.find((e) => e.kind === "flagship");
      if (boss && boss.age >= 0) {
        const wide = Math.min(320, field.width - 40), x = Math.round(cx - wide / 2), left = Math.max(0, boss.hp / boss.hpMax);
        g.fillStyle = INK; g.fillRect(x - 3, 9, wide + 6, 14);
        g.fillStyle = "#3a0c10"; g.fillRect(x, 12, wide, 8);
        g.fillStyle = left <= 0.5 ? "#ff8a3a" : "#e2463c"; g.fillRect(x, 12, Math.round(wide * left), 8);
        label(g, skin?.boss ?? "FLAGSHIP", cx, 38, 11);
      }
      if (warned > 0 && Math.floor(clock * 5) % 2 === 0) label(g, `${skin?.boss ?? "FLAGSHIP"} INBOUND`, cx, cy, 24, "#ff8a3a");

      // What the game has to say: the stage coming up, how the last one went, or that it's over.
      const switchHint = game.daily ? "D: BACK TO A RANDOM RUN" : "D: TODAY'S DAILY RUN";
      if (game.phase === "intro" && game.since < INTRO) {
        if (game.daily) label(g, `DAILY RUN · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase()}`, cx, cy - 40, 13, "#c8f6ff");
        label(g, `STAGE ${game.stage}`, cx, cy, 34, "#ffd84a");
        const twist = TWISTS[game.twist];
        if (twist.name) { label(g, twist.name.toUpperCase(), cx, cy + 32, 18, "#ff8a3a"); label(g, twist.says, cx, cy + 54, 12); }
        else label(g, "GET READY", cx, cy + 30, 14);
        if (canSwitch()) label(g, `${LEVELS[game.level].name.toUpperCase()} · ${switchHint}`, cx, cy + (twist.name ? 80 : 56), 11, "#b8c0cc");
      } else if (game.phase === "pick") {
        // Three upgrades, side by side, numbered: the highlighted one has a solid border.
        label(g, "PICK AN UPGRADE", cx, cy - 78, 22, "#ffd84a");
        const n = game.offer.length, gap = 12, wide = Math.min(176, (field.width - 32 - gap * (n - 1)) / n), tall = 128;
        const left = cx - (wide * n + gap * (n - 1)) / 2, top = cy - 56;
        game.offer.forEach((perk, i) => {
          const x = Math.round(left + i * (wide + gap)), on = i === choice;
          g.fillStyle = on ? "#ffd84a" : "#3a4660"; g.fillRect(x - 2, top - 2, Math.round(wide) + 4, tall + 4);
          g.fillStyle = "rgba(8, 14, 30, .92)"; g.fillRect(x, top, Math.round(wide), tall);
          const mid = x + wide / 2;
          label(g, String(i + 1), mid, top + 22, 16, on ? "#ffd84a" : "#b8c0cc");
          wrap(PERKS[perk].name.toUpperCase(), Math.floor(wide / 8.5)).forEach((line, j) => label(g, line, mid, top + 46 + j * 16, 13, on ? "#ffffff" : "#d6dbe3"));
          wrap(PERKS[perk].says, Math.floor(wide / 7)).forEach((line, j) => label(g, line, mid, top + 84 + j * 14, 11, "#b8c0cc"));
        });
        if (game.since > 0.3) label(g, "1–3, OR ← → AND SPACE", cx, top + tall + 26, 12, "#c8f6ff");
      } else if (game.phase === "tally" && game.tally) {
        const t = game.tally;
        g.fillStyle = "rgba(8, 14, 30, .78)"; g.fillRect(cx - 190, cy - 62, 380, 204);
        g.fillStyle = INK; g.fillRect(cx - 190, cy - 62, 380, 3); g.fillRect(cx - 190, cy + 139, 380, 3);
        label(g, `STAGE ${game.stage} COMPLETE`, cx, cy - 26, 22, "#ffd84a");
        label(g, `SCORE  ${scoreText(game.score)}`, cx, cy + 8, 16);
        label(g, `SHOT DOWN  ${t.downed} OF ${t.flew}   ${t.percent}%`, cx, cy + 36, 16);
        label(g, t.clean ? "NO PLANES LOST" : "PLANES LOST", cx, cy + 64, 14, t.clean ? "#9be28a" : "#b8c0cc");
        label(g, `BONUS  +${t.bonus}`, cx, cy + 92, 16);
        if (game.since > 1 && Math.floor(clock * 2.5) % 2 === 0) label(g, "PRESS SPACE", cx, cy + 124, 13, "#c8f6ff");
      } else if (game.phase === "over") {
        g.fillStyle = "rgba(8, 14, 30, .78)"; g.fillRect(cx - 190, cy - 62, 380, game.daily ? 196 : 176);
        label(g, game.daily ? "DAILY RUN OVER" : "GAME OVER", cx, cy - 22, game.daily ? 24 : 30, "#ff8a3a");
        label(g, `SCORE  ${scoreText(game.score)}`, cx, cy + 14, 16);
        label(g, `REACHED STAGE ${game.stage}   SHOT DOWN ${game.downed} OF ${game.flew}`, cx, cy + 40, 13);
        if (game.daily) label(g, `TODAY'S BEST  ${scoreText(todayTop)}`, cx, cy + 64, 13, "#ffd84a");
        const below = cy + (game.daily ? 92 : 70);
        if (game.since > 1 && Math.floor(clock * 2.5) % 2 === 0) label(g, game.daily ? "PRESS SPACE TO FLY IT AGAIN" : "PRESS SPACE TO FLY AGAIN", cx, below, 13, "#c8f6ff");
        if (game.since > 1) label(g, switchHint, cx, below + 24, 11, "#b8c0cc");
      }
      g.restore();
    };

    let frame = 0, last = performance.now(), told = "";
    const tick = (now: number) => {
      const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      if (dailyKey && canSwitch()) fly(!game.daily);
      // Picking: a number, Enter, or space on the highlighted one.
      const picking = game.phase === "pick";
      const pick = picking ? pickKey || (goKey ? choice + 1 : 0) : 0;
      const input: Input = { x: 0, y: 0, fire: held.has(FIRE) && !picking, loop: loopKey, go: goKey && !picking, ...(pick ? { pick } : {}) };
      for (const k of held) { const d = FLY[k]; if (d) { input.x += d[0]; input.y += d[1]; } }
      loopKey = goKey = dailyKey = false; pickKey = 0;
      show(step(game, input, dt, field));
      if (game.phase !== "pick") choice = 0;
      bits = bits.filter((b) => { b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - 2.5 * dt; b.vy *= 1 - 2.5 * dt; return b.age < b.life; });
      popups = popups.filter((t) => { t.age += dt; t.y -= 34 * dt; return t.age < 0.8; });
      if (warned > 0) warned -= dt;
      // A ship that's half sunk is on fire: smoke off its deck.
      for (const e of game.enemies) if (SHIPS.has(e.kind) && e.hp * 2 <= e.hpMax && Math.random() < dt * 14) {
        const long = e.kind === "carrier" ? 90 : 44;
        bits.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * long, vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 50, size: 5, color: Math.random() < 0.3 ? "#ff8a3a" : "#3a3f4b", age: 0, life: 0.5 + Math.random() * 0.4 });
      }
      // A missile leaves a trail of smoke behind it.
      for (const m of game.missiles) if (!m.gone && Math.random() < dt * 40) {
        bits.push({ x: m.x - Math.cos(m.heading) * 8, y: m.y - Math.sin(m.heading) * 8, vx: 0, vy: 0, size: 3, color: Math.random() < 0.25 ? "#ffd84a" : "#c7cfdb", age: 0, life: 0.45 });
      }
      if (game.score > top) { top = game.score; storeSet(BEST, String(top)); setBest(top); }
      if (game.daily && game.score > todayTop) { todayTop = game.score; storeSet(dailyBest(game.run, game.level), String(todayTop)); setTodays(todayTop); }
      // The bar's numbers, only when one of them has changed.
      const numbers = {
        score: game.score, stage: game.stage, lives: game.lives, loops: game.loops, guns: game.guns, wingmen: game.wingmen.filter(Boolean).length, times: chainTimes(game.chain),
        daily: game.daily, twist: TWISTS[game.twist].name, perks: game.perks.map((it) => PERKS[it].name).join(", "), level: game.level,
      };
      const now2 = JSON.stringify(numbers);
      if (now2 !== told) { told = now2; setShown(numbers); }
      if (ctx) draw(ctx);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Pausing stops the clock, lets go of the keys and clears the sky; resuming carries on from the same moment.
    ctl.current = {
      pause() {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        held.clear(); loopKey = goKey = dailyKey = false; pickKey = 0;
        ctx?.clearRect(0, 0, sky.width, sky.height);
      },
      resume() {
        if (!stopped) return;
        stopped = false;
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
    };
  }, []);

  return (
    <div className={cx("barnstorm sortie", paused && "paused")}>
      <canvas className="barnstorm-sky" ref={canvas} aria-hidden="true" />
      {paused ? <PausedPill says={`Sortie · stage ${shown.stage} · ${scoreText(shown.score)}`} onResume={onResume} onClose={onClose} /> : <EggBar mode="sortie" onMode={onMode}
        controls={
          <div className="barnstorm-modes" role="group" aria-label="How hard">
            {LEVEL_ORDER.map((it) => (
              <button key={it} type="button" className={cx(level === it && "on")} aria-pressed={level === it} title={LEVELS[it].says}
                onClick={(ev) => { choose(it); ev.currentTarget.blur(); }}>{LEVELS[it].name}</button>
            ))}
          </div>
        }
        stats={[
          { label: "Score", value: scoreText(shown.score) },
          shown.daily
            ? { label: "Today", value: scoreText(todays), title: "Your best on today's daily run: the same sky for everyone, all day." }
            : { label: "Best", value: scoreText(best) },
          { label: "Stage", value: shown.stage },
          { label: "Lives", value: shown.lives, title: "Planes left, counting the one you're flying. One hit costs one, unless you have wingmen: then it costs one of them first." },
          { label: "Loops", value: shown.loops, title: `Loops left this stage (X). A loop takes you over whatever was about to hit you. ${ENEMY.ferry.points} for the yellow ferry, and a crate.` },
          { label: "Guns", value: shown.guns, title: "1: two guns. 2: four. 3: four, firing faster. Shoot down every aircraft of a formation for the crate that improves them; losing a plane takes them back a step." },
        ]}
        status={(() => {
          const said = [level !== shown.level && `${LEVELS[level].name} from the next run`, shown.daily && "Daily run", shown.twist, shown.times > 1 && `Chain ×${shown.times}`, shown.wingmen && `Wingmen ${shown.wingmen}`].filter(Boolean);
          return said.length ? { text: said.join(" · "), loud: shown.times > 1 } : null;
        })()}
        keys={[["←↑↓→", "fly"], ["Space", "fire"], ["X", "loop"], ["D", "daily run"], ["P", "pause"], ["Esc", "land"]]}
        resetTitle="Start the sortie again from stage 1" onReset={reset} onPause={onPause} onClose={onClose} />}
    </div>
  );
}
