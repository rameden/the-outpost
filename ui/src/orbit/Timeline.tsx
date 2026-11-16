// The replay's timeline (Orbit.tsx): the last day's events (replay.ts lays them along a line),
// played into a feed of their own so the sky shows them happening again, at a speed that gets
// through the whole day in half a minute. You can pause it, drag along it, or change its speed.
//
// It keeps the replay's clock as well: `time.now` is the moment being shown, which is what the
// view times everything by while this is up, and `time.quiet` is set while it catches up after a
// jump, so a thousand events applied at once don't send a thousand comets.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedStore } from "../feed/store.ts";
import { countAt, paceOf, realAt, type Reel } from "./replay.ts";

export type Time = { now: number | null; quiet: boolean };

const TICK_MS = 50, SPEEDS = [0.5, 1, 2, 4], MARKS = 80;
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function Timeline({ reel, store, time, onLeave }: { reel: Reel; store: FeedStore; time: Time; onLeave: () => void }) {
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const at = useRef({ pos: 0, applied: 0, playing: true, speed: 1 }).current;

  // Show the line as it stood at a point on it. Going back means starting the feed over and playing up to there.
  const seek = useCallback((to: number, jump: boolean) => {
    to = Math.min(reel.span, Math.max(0, to));
    const n = countAt(reel, to);
    if (n < at.applied) { store.reset(); at.applied = 0; jump = true; }
    time.now = realAt(reel, to);
    time.quiet = jump;
    for (let i = at.applied; i < n; i++) store.apply(reel.events[i]);
    time.quiet = false;
    at.applied = n;
    at.pos = to;
    setPos(to);
  }, [reel, store, time, at]);

  useEffect(() => {
    seek(0, true);
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now(), dt = now - last;
      last = now;
      if (!at.playing) return;
      seek(at.pos + dt * paceOf(reel, at.speed), false);
      if (at.pos >= reel.span) { at.playing = false; setPlaying(false); }
    }, TICK_MS);
    return () => { clearInterval(t); time.now = null; time.quiet = false; };
  }, [reel, seek, time, at]);

  const play = (on: boolean) => {
    if (on && at.pos >= reel.span) seek(0, true); // (played out: from the top)
    at.playing = on;
    setPlaying(on);
  };
  const shown = hhmm(realAt(reel, pos));
  const marks = reel.marks.length > MARKS ? reel.marks.filter((m) => m.kind === "start").slice(-MARKS) : reel.marks;
  return (
    <section className="orb-reel" aria-label="Replay of the last day">
      <button type="button" className="orb-tool" aria-label={playing ? "Pause the replay" : "Play the replay"} title={playing ? "Pause" : "Play"} onClick={() => play(!playing)}>{playing ? "❚❚" : "▶"}</button>
      <div className="orb-reel-line">
        <input type="range" min={0} max={reel.span} step={100} value={pos} aria-label="Where in the day" aria-valuetext={shown}
          onChange={(ev) => seek(Number(ev.target.value), true)} />
        <div className="orb-reel-marks" aria-hidden="true">
          {marks.map((m, i) => <i key={i} className={m.kind} title={m.label} style={{ left: `${((m.at / reel.span) * 100).toFixed(2)}%` }} />)}
        </div>
      </div>
      <time>{shown}</time>
      <div className="orb-reel-speed" role="group" aria-label="How fast it plays">
        {SPEEDS.map((x) => (
          <button key={x} type="button" className="orb-tool worded" aria-pressed={speed === x} onClick={() => { at.speed = x; setSpeed(x); }}>{x === 0.5 ? "½×" : `${x}×`}</button>
        ))}
      </div>
      <button type="button" className="orb-btn" onClick={onLeave}>Back to now</button>
    </section>
  );
}
