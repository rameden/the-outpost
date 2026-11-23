// What a decoration draws (seasons.ts has the list; themes.ts says which is on): something falling
// across the window, and a string of lights under the top bar. Only for looks: it takes no clicks,
// screen readers skip it, and it's loaded only while a decoration is on (see App.tsx).
//
// The falling is one canvas over the whole window, drawn in flat shapes: circles for snow, a
// handful of bat silhouettes, rectangles of confetti when an expedition finishes. It runs at about
// thirty frames a second, stops while the tab is hidden, and never starts for anyone who has asked
// their system for less motion. The lights are a plain SVG strip hung from the top bar's bottom
// edge; their slow twinkle is CSS ("Decorations" in styles.css), and stands down the same way.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RUN_DONE } from "../bus.ts";
import { motionOK } from "../motion.tsx";
import { seasonById, type Effect } from "../seasons.ts";

export const MAX_PARTICLES = 60;
const FRAME_MS = 1000 / 30;
const REDUCE = "(prefers-reduced-motion: reduce)";
const ROLES = ["quartermaster", "scout", "scribe", "artificer", "warden", "wizard"] as const;

function useLessMotion(): boolean {
  // (Where the page can't tell, it counts as less motion, as everywhere else: see motion.tsx.)
  const [less, setLess] = useState(() => !motionOK());
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia(REDUCE);
    const on = () => setLess(!motionOK());
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return less;
}

export function Decor({ season }: { season: string | null }) {
  const s = seasonById(season);
  const less = useLessMotion();
  if (!s) return null;
  return (
    <>
      {s.effect && !less && <Fall effect={s.effect} />}
      {s.lights && <Lights />}
    </>
  );
}

// ---------- The lights ----------

const GAP = 34; // px from one bulb to the next

// A straight wire along the top bar's bottom edge, with small flat bulbs in the crew's six
// colours. It hangs from the bar (absolutely placed, so the bar keeps its height and nothing
// moves), and is clipped to the bar's width.
function Lights() {
  const [bar, setBar] = useState<Element | null>(null);
  useEffect(() => { setBar(document.querySelector("header.top")); }, []);
  if (!bar) return null;
  // Enough bulbs for the widest this window can get on this screen.
  const wide = Math.max(typeof screen === "undefined" ? 0 : screen.width, window.innerWidth, 1024);
  const n = Math.ceil(wide / GAP) + 1;
  return createPortal(
    <div className="decor-lights" aria-hidden="true">
      <svg width={n * GAP} height="12" viewBox={`0 0 ${n * GAP} 12`} focusable="false">
        <line className="decor-wire" x1="0" y1="0.5" x2={n * GAP} y2="0.5" />
        {Array.from({ length: n }, (_, i) => {
          const x = i * GAP + GAP / 2;
          return (
            <g key={i} className={`decor-bulb b${i % ROLES.length}`}>
              <rect className="decor-cap" x={x - 1.5} y="1" width="3" height="2.5" />
              <ellipse cx={x} cy="7.2" rx="2.8" ry="3.8" />
            </g>
          );
        })}
      </svg>
    </div>,
    bar,
  );
}

// ---------- The falling ----------

function Fall({ effect }: { effect: Effect }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? startFall(ref.current, effect) : undefined), [effect]);
  return <canvas ref={ref} className="decor-fall" data-effect={effect} aria-hidden="true" />;
}

interface Bit {
  x: number; y: number; vx: number; vy: number;
  size: number;   // snow: radius; bat: half its wingspan; confetti: its long side
  phase: number;  // where it is in its sway, flap or tumble
  speed: number;  // how fast that phase turns
  alpha: number;
  colour: number; // confetti: which of the crew's colours
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Half a bat, as points from its nose round to its tail (it's mirrored for the other wing).
// x is in half-wingspans, y in the same unit; the wing's lower edge is three flat scallops.
const BAT: [number, number][] = [[0, -0.24], [0.1, -0.48], [0.18, -0.24], [0.42, -0.32], [1, -0.42], [0.86, -0.02], [0.68, -0.14], [0.52, 0.14], [0.34, -0.04], [0.16, 0.26], [0, 0.4]];

// Draw on a canvas until the returned function is called. Exported for the tests.
export function startFall(canvas: HTMLCanvasElement, effect: Effect): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let w = 0, h = 0;
  let bits: Bit[] = [];
  let ink = "#888";
  let inks: string[] = [];
  let frame = 0, last = 0, stopped = false;

  // The colours come from the stylesheet, so they follow light and dark, the palette and the pack:
  // the canvas's own `color` for snow and bats, the crew's six for confetti.
  const readColours = () => {
    ink = getComputedStyle(canvas).color || ink;
    const probe = document.createElement("i");
    probe.style.display = "none";
    canvas.after(probe);
    inks = ROLES.map((r) => { probe.style.color = `var(--c-${r})`; return getComputedStyle(probe).color || ink; });
    probe.remove();
  };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const flake = (anywhere: boolean): Bit => ({ x: rand(0, w), y: anywhere ? rand(0, h) : -6, vx: rand(8, 22), vy: rand(14, 42), size: rand(1.2, 3.2), phase: rand(0, 6.28), speed: rand(0.4, 1.1), alpha: rand(0.55, 0.95), colour: 0 });
  const bat = (anywhere: boolean): Bit => {
    const right = Math.random() < 0.5;
    const size = rand(9, 16);
    return { x: anywhere ? rand(0, w) : right ? -size : w + size, y: rand(h * 0.08, h * 0.6), vx: (right ? 1 : -1) * rand(26, 58), vy: rand(6, 14), size, phase: rand(0, 6.28), speed: rand(5, 8), alpha: rand(0.4, 0.65), colour: 0 };
  };
  const fill = () => {
    if (effect === "snow") bits = Array.from({ length: Math.min(MAX_PARTICLES, Math.max(12, Math.round(w / 26))) }, () => flake(true));
    else if (effect === "bats") bits = Array.from({ length: Math.min(8, Math.max(3, Math.round(w / 280))) }, () => bat(true));
  };
  // Confetti: one burst from along the top, which falls away and is gone.
  const burst = () => {
    if (stopped) return;
    bits = Array.from({ length: MAX_PARTICLES }, (_, i) => ({ x: rand(0, w), y: rand(-h * 0.25, -8), vx: rand(-40, 40), vy: rand(90, 220), size: rand(6, 11), phase: rand(0, 6.28), speed: rand(2, 6), alpha: 0.9, colour: i % ROLES.length }));
    run();
  };

  const step = (dt: number) => {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.phase += b.speed * dt;
      if (effect === "snow") {
        b.x += Math.sin(b.phase) * b.vx * dt; b.y += b.vy * dt;
        if (b.y > h + 6) bits[i] = flake(false);
      } else if (effect === "bats") {
        b.x += b.vx * dt; b.y += Math.sin(b.phase * 0.25) * b.vy * dt;
        if (b.x < -b.size * 2 || b.x > w + b.size * 2) bits[i] = bat(false);
      } else {
        b.vy += 160 * dt; b.x += (b.vx + Math.sin(b.phase) * 30) * dt; b.y += b.vy * dt;
        if (b.y > h + 12) bits.splice(i, 1);
      }
    }
  };
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      ctx.globalAlpha = b.alpha;
      if (effect === "snow") {
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
      } else if (effect === "bats") {
        const flap = 0.72 + 0.28 * Math.sin(b.phase); // the wings draw in and out
        ctx.fillStyle = ink;
        ctx.beginPath();
        BAT.forEach(([x, y], i) => (i ? ctx.lineTo(b.x + x * b.size * flap, b.y + y * b.size) : ctx.moveTo(b.x + x * b.size * flap, b.y + y * b.size)));
        for (let i = BAT.length - 2; i > 0; i--) ctx.lineTo(b.x - BAT[i][0] * b.size * flap, b.y + BAT[i][1] * b.size);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = inks[b.colour] ?? ink;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.phase);
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  };

  const tick = (now: number) => {
    frame = 0;
    if (stopped || document.hidden) return;
    if (now - last >= FRAME_MS - 1) { // about thirty a second, whatever the screen refreshes at
      step(Math.min((now - last) / 1000, 0.1));
      last = now;
      draw();
    }
    if (bits.length) frame = requestAnimationFrame(tick); // confetti that has all fallen: nothing left to run
  };
  function run() {
    if (frame || stopped || document.hidden || !bits.length) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
  const pause = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
  const onVisible = () => (document.hidden ? pause() : run());
  const onResize = () => { resize(); if (effect !== "confetti") fill(); draw(); };

  resize(); readColours(); fill(); run();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisible);
  if (effect === "confetti") window.addEventListener(RUN_DONE, burst);
  // Light or dark, the palette or the pack changed: take the colours again.
  const watch = typeof MutationObserver === "function" ? new MutationObserver(readColours) : null;
  watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "data-pack", "data-season"] });
  const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  scheme?.addEventListener?.("change", readColours);

  return () => {
    stopped = true;
    pause();
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener(RUN_DONE, burst);
    watch?.disconnect();
    scheme?.removeEventListener?.("change", readColours);
  };
}
