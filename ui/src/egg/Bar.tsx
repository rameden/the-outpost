// Barnstorm's bar: one slim strip along the bottom of the window with everything that isn't the
// game itself. Which game you're playing (and a switch to the other), the numbers, what's
// going on right now, the keys, and Reset and Land. Both games draw the same bar, with their
// own numbers and keys in it.
//
// It's the only part of the overlay that takes the mouse: the sky above the page lets every
// click through (styles.css).
//
// Paused, the bar goes too (the page is yours again, all of it), and a small pill in the
// corner is all that's left: what was paused, and the way back into it.

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../format.ts";

// wreck: fly over the page and shoot it to bits (Barnstorm.tsx). sortie: a top-down shooter over
// the same page, against waves of enemy aircraft (Sortie.tsx).
export type Mode = "wreck" | "sortie";
export const MODES: { id: Mode; name: string; says: string }[] = [
  { id: "wreck", name: "Wreck", says: "Fly over the page and shoot it to bits, while the builders put it back" },
  { id: "sortie", name: "Sortie", says: "A top-down shooter: waves of enemy aircraft, three lives, and a loop to get you out of trouble" },
];

// What either game is handed: whether it's paused, and how to ask to be paused, resumed,
// landed, or swapped for the other game.
export type GameProps = { paused: boolean; onPause: () => void; onResume: () => void; onClose: () => void; onMode: (m: Mode) => void };

// How a game is made pausable: its own loop fills in the two things to do (stop where it is;
// carry on), and they're called whenever `paused` changes.
export function usePause(paused: boolean) {
  const ctl = useRef({ pause() {}, resume() {} });
  useEffect(() => { if (paused) ctl.current.pause(); else ctl.current.resume(); }, [paused]);
  return ctl;
}

export type Stat = { label: string; value: ReactNode; title?: string };
export type KeyHint = [keys: string, does: string];

export function EggBar({ mode, onMode, controls, stats, status, keys, resetTitle, onReset, onPause, onClose }: {
  mode: Mode; onMode: (m: Mode) => void;
  controls?: ReactNode; // the game's own settings, after the game switcher (the Sortie's level)
  stats: Stat[];
  status?: { text: string; loud?: boolean } | null; // what's going on right now (a power-up running, the page flattened)
  keys: KeyHint[];
  resetTitle: string; onReset: () => void; onPause: () => void; onClose: () => void;
}) {
  return (
    <section className="barnstorm-bar" aria-label="Barnstorm">
      <h2>Barnstorm</h2>
      <div className="barnstorm-modes" role="group" aria-label="Which game">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={cx(mode === m.id && "on")} aria-pressed={mode === m.id} title={m.says} onClick={() => onMode(m.id)}>{m.name}</button>
        ))}
      </div>
      {controls}
      <dl>
        {stats.map((s) => <div key={s.label} title={s.title}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
      </dl>
      {status && <p className={cx("barnstorm-status", status.loud && "loud")} role="status">{status.text}</p>}
      <p className="barnstorm-keys">{keys.map(([k, does]) => <span key={k}><kbd>{k}</kbd> {does}</span>)}</p>
      <div className="barnstorm-actions">
        <button type="button" title="Stop here and give the page back, to carry on later from where you were (P)" onClick={onPause}>Pause</button>
        <button type="button" title={resetTitle} onClick={onReset}>Reset</button>
        <button type="button" title="Stop, and put the page back as it was (Esc)" onClick={onClose}>Land</button>
      </div>
    </section>
  );
}

// What's left while the game is paused: a pill in the corner, out of the way of the page.
// says: where the game had got to ("Stage 2 · 012340").
export function PausedPill({ says, onResume, onClose }: { says: string; onResume: () => void; onClose: () => void }) {
  return (
    <section className="barnstorm-paused" aria-label="Barnstorm, paused">
      <h2>Barnstorm</h2>
      <p role="status">Paused · {says}</p>
      <div className="barnstorm-actions">
        <button type="button" title="Carry on from where you were" onClick={onResume}>Resume</button>
        <button type="button" title="Stop for good, and forget this game" onClick={onClose}>Land</button>
      </div>
    </section>
  );
}
