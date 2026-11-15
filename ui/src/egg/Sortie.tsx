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
// Arrows fly (eight ways), space fires, X spends a loop, P pauses, Esc lands. Paused, it's all
// still here (the stage, the score, every aircraft where it was) and nothing moves until you resume.

import { useCallback, useEffect, useRef, useState } from "react";
import { storeGet, storeSet } from "../api.ts";
import { cx } from "../format.ts";
import { EggBar, PausedPill, usePause, type GameProps } from "./Bar.tsx";
import { PAINT, PIXEL, SPRITE, UP, scoreText } from "./flight.ts";
import {
  ENEMY, INTRO, LOOP_LASTS, chainTimes, liningUp, loopPose, newGame, step, wingAt,
  type CrateKind, type EnemyKind, type Field, type Game, type Input, type SortieEvent,
} from "./sortie.ts";

const BEST = "camp-sortie-best";
const BAR = 34; // the bar's height (styles.css): the sky stops above it
const FLY: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const FIRE = " ", LOOP = "x", PAUSE = "p";

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
const MONO = "ui-monospace, Menlo, Consolas, monospace";

type Bit = { x: number; y: number; vx: number; vy: number; size: number; color: string; age: number; life: number };
type Popup = { x: number; y: number; text: string; age: number };

// The same "random" numbers every time, so the wisps are where they were.
function seeded(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

export function Sortie({ paused, onPause, onResume, onClose, onMode }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState({ score: 0, stage: 1, lives: 3, loops: 3, guns: 1, wingmen: 0, times: 1 });
  const [best, setBest] = useState(() => Number(storeGet(BEST)) || 0);
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
    const held = new Set<string>();
    let loopKey = false, goKey = false; // pressed since the last frame

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
    game = newGame(field);
    again.current = () => { game = newGame(field); bits = []; popups = []; warned = 0; };

    const mine = (ev: KeyboardEvent) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    const key = (ev: KeyboardEvent) => (ev.key.length === 1 ? ev.key.toLowerCase() : ev.key);
    const ours = (k: string) => k in FLY || k === FIRE || k === LOOP;
    const onDown = (ev: KeyboardEvent) => {
      if (stopped || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = key(ev);
      if (k === "Escape") { mine(ev); close.current(); return; }
      if (k === PAUSE) { mine(ev); pause.current(); return; }
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
        else if (e.type === "extra") popups.push({ x: e.x, y: e.y - 40, text: "EXTRA PLANE", age: -0.9 });
        else if (e.type === "warning") warned = 2.2;
        else if (e.type === "pickup") { popups.push({ x: e.x, y: e.y - 18, text: CRATES[e.what].says, age: -0.5 }); burst(e.x, e.y, 12, ["#ffffff", CRATES[e.what].color], 150); }
      }
    };

    // ---------- Drawing ----------
    const sprite = (g: CanvasRenderingContext2D, rows: string[], paint: Record<string, string>, px: number, flat?: string) => {
      const w = rows[0].length, h = rows.length;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const ch = rows[r][c];
        if (ch === ".") continue;
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
      // An aircraft carrier is down on the water: under everything else, and with no shadow.
      for (const e of game.enemies) {
        if (e.kind !== "carrier" || e.age < 0) continue;
        g.save(); g.translate(Math.round(e.x), Math.round(e.y)); g.rotate(Math.PI); // (bow towards you)
        sprite(g, ART.carrier.rows, ART.carrier.paint, PIXEL, e.hurt > 0 ? "#ffffff" : undefined);
        g.restore();
      }
      for (const e of game.enemies) {
        if (e.age < 0 || e.kind === "carrier") continue;
        const art = ART[e.kind];
        // A dart lining up: a broken line from it to you, flickering, so you know to move.
        if (liningUp(e) && p.alive && Math.floor(clock * 14) % 2 === 0) {
          const far = Math.hypot(p.x - e.x, p.y - e.y), ux = (p.x - e.x) / far, uy = (p.y - e.y) / far;
          g.fillStyle = "#ff4fa0";
          for (let d = 26; d < far - 20; d += 16) g.fillRect(Math.round(e.x + ux * d) - 2, Math.round(e.y + uy * d) - 2, 4, 4);
        }
        flying(g, e.x, e.y, e.heading - UP, art.rows, art.paint, PIXEL, { flat: e.hurt > 0 ? "#ffffff" : undefined, high: e.kind === "heavy" || e.kind === "flagship" ? 0.15 : 0 });
      }

      // Their rounds: fat, orange, ringed in dark. Yours: thin and pale.
      for (const r of game.rounds) {
        const x = Math.round(r.x), y = Math.round(r.y), beat = Math.floor(clock * 10) % 2;
        g.fillStyle = "#3a0c10"; g.fillRect(x - 7, y - 4, 14, 8); g.fillRect(x - 4, y - 7, 8, 14);
        g.fillStyle = "#ffb020"; g.fillRect(x - 5, y - 3, 10, 6); g.fillRect(x - 3, y - 5, 6, 10);
        g.fillStyle = "#ffffff"; g.fillRect(x - 2 - beat, y - 2 - beat, 4 + beat * 2, 4 + beat * 2);
      }
      for (const s of game.shots) {
        g.fillStyle = INK; g.fillRect(Math.round(s.x) - 2.5, Math.round(s.y) - 8, 5, 16);
        g.fillStyle = "#c8f6ff"; g.fillRect(Math.round(s.x) - 1.5, Math.round(s.y) - 7, 3, 14);
      }

      // You, and the wingmen. In a loop the plane tips up, goes over on its back high above its
      // shadow, and comes down level where it started.
      if (p.alive && !(p.safe > 0 && Math.floor(clock * 12) % 2)) {
        const pose = p.loop > 0 ? loopPose(1 - p.loop / LOOP_LASTS) : { ahead: 0, height: 0, pitch: 1 };
        const sy = pose.pitch < 0 ? Math.min(-0.14, pose.pitch) : Math.max(0.14, pose.pitch);
        const o = { sx: 1 - 0.25 * Math.abs(p.lean), sy, grow: 1 + 0.55 * pose.height, high: pose.height };
        game.wingmen.forEach((there, i) => { if (there) { const w = wingAt(game, i); flying(g, w.x, w.y - pose.ahead, 0, SPRITE, PAINT, 2, o); } });
        flying(g, p.x, p.y - pose.ahead, 0, SPRITE, PAINT, PIXEL, o);
      }

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
        label(g, "FLAGSHIP", cx, 38, 11);
      }
      if (warned > 0 && Math.floor(clock * 5) % 2 === 0) label(g, "FLAGSHIP INBOUND", cx, cy, 24, "#ff8a3a");

      // What the game has to say: the stage coming up, how the last one went, or that it's over.
      if (game.phase === "intro" && game.since < INTRO) {
        label(g, `STAGE ${game.stage}`, cx, cy, 34, "#ffd84a");
        label(g, "GET READY", cx, cy + 30, 14);
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
        g.fillStyle = "rgba(8, 14, 30, .78)"; g.fillRect(cx - 190, cy - 62, 380, 150);
        label(g, "GAME OVER", cx, cy - 22, 30, "#ff8a3a");
        label(g, `SCORE  ${scoreText(game.score)}`, cx, cy + 14, 16);
        label(g, `REACHED STAGE ${game.stage}   SHOT DOWN ${game.downed} OF ${game.flew}`, cx, cy + 40, 13);
        if (game.since > 1 && Math.floor(clock * 2.5) % 2 === 0) label(g, "PRESS SPACE TO FLY AGAIN", cx, cy + 70, 13, "#c8f6ff");
      }
      g.restore();
    };

    let frame = 0, last = performance.now(), told = "";
    const tick = (now: number) => {
      const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      const input: Input = { x: 0, y: 0, fire: held.has(FIRE), loop: loopKey, go: goKey };
      for (const k of held) { const d = FLY[k]; if (d) { input.x += d[0]; input.y += d[1]; } }
      loopKey = goKey = false;
      show(step(game, input, dt, field));
      bits = bits.filter((b) => { b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - 2.5 * dt; b.vy *= 1 - 2.5 * dt; return b.age < b.life; });
      popups = popups.filter((t) => { t.age += dt; t.y -= 34 * dt; return t.age < 0.8; });
      if (warned > 0) warned -= dt;
      // A carrier that's half sunk is on fire: smoke off its deck.
      for (const e of game.enemies) if (e.kind === "carrier" && e.hp * 2 <= e.hpMax && Math.random() < dt * 14) {
        bits.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 90, vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 50, size: 5, color: Math.random() < 0.3 ? "#ff8a3a" : "#3a3f4b", age: 0, life: 0.5 + Math.random() * 0.4 });
      }
      if (game.score > top) { top = game.score; storeSet(BEST, String(top)); setBest(top); }
      // The bar's numbers, only when one of them has changed.
      const numbers = { score: game.score, stage: game.stage, lives: game.lives, loops: game.loops, guns: game.guns, wingmen: game.wingmen.filter(Boolean).length, times: chainTimes(game.chain) };
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
        held.clear(); loopKey = goKey = false;
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
        stats={[
          { label: "Score", value: scoreText(shown.score) },
          { label: "Best", value: scoreText(best) },
          { label: "Stage", value: shown.stage },
          { label: "Lives", value: shown.lives, title: "Planes left, counting the one you're flying. One hit costs one, unless you have wingmen: then it costs one of them first." },
          { label: "Loops", value: shown.loops, title: `Loops left this stage (X). A loop takes you over whatever was about to hit you. ${ENEMY.ferry.points} for the yellow ferry, and a crate.` },
          { label: "Guns", value: shown.guns, title: "1: two guns. 2: four. 3: four, firing faster. Shoot down every aircraft of a formation for the crate that improves them; losing a plane takes them back a step." },
        ]}
        status={shown.times > 1 || shown.wingmen ? { text: [shown.times > 1 && `Chain ×${shown.times}`, shown.wingmen && `Wingmen ${shown.wingmen}`].filter(Boolean).join(" · "), loud: shown.times > 1 } : null}
        keys={[["←↑↓→", "fly"], ["Space", "fire"], ["X", "loop"], ["P", "pause"], ["Esc", "land"]]}
        resetTitle="Start the sortie again from stage 1" onReset={reset} onPause={onPause} onClose={onClose} />}
    </div>
  );
}
