// The world maker: in the HD view, the part of a crew member's panel where their world is made
// your own. Roll it again by itself, say which sort of world it is, set how much sea, cloud, ice
// and desert it has, how big it is and how it turns, give it rings, and add or take away moons and
// satellites. Or say it isn't a world at all: anyone's can be a station (built here instead: its
// spokes, rings and wings) or a cluster of asteroids being mined (how many rocks, how far spread,
// how big the main one, how rough). The Artificer has a station to begin with.
//
// It only says what you asked for (onChange, with just what changed): what's kept and how it's
// laid over the seed is worlds.ts (Custom), and Orbit keeps it.

import type { ReactNode } from "react";
import { Slide } from "@outpost/sdk";
import { LIMITS, MINE, RING_USUAL, SORT_NAMES, STATION, WORLD, anotherMoon, middle, type Custom, type World } from "./worlds.ts";

// What it can be, as you'd say it.
const KIND_NAMES: [number, string, string][] = [[WORLD, "Planet", "a world you could live on"], [STATION, "Station", "a station, built to order"], [MINE, "Asteroids", "a cluster of asteroids being mined"]];

type Limit = readonly [number, number];
const clamp = (x: number, [lo, hi]: Limit) => Math.min(hi, Math.max(lo, x));

// A setting you count: fewer, how many, more.
function Count({ label, value, limit, onChange }: { label: string; value: number; limit: Limit; onChange: (v: number) => void }) {
  return (
    <div className="orb-set" role="group" aria-label={label}>
      <span>{label}</span>
      <span className="orb-count">
        <button type="button" className="orb-step-btn" aria-label={`One fewer: ${label.toLowerCase()}`} disabled={value <= limit[0]} onClick={() => onChange(value - 1)}>−</button>
        <b aria-live="polite">{value}</b>
        <button type="button" className="orb-step-btn" aria-label={`One more: ${label.toLowerCase()}`} disabled={value >= limit[1]} onClick={() => onChange(value + 1)}>+</button>
      </span>
    </div>
  );
}
function Switch({ label, on, onChange, children }: { label: string; on: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className="orb-set">
      <span>{label}</span>
      <button type="button" className="orb-step-btn worded" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>{on ? "On" : "Off"}</button>
      {children}
    </div>
  );
}

// name: whose it is. changed: you've changed something about it (so there's something to put back).
// onRoll: roll this one again, by itself. onReset: put it back to what the system's seed makes of it.
// kit: how many satellites it really has (its skills and connectors), when that's known.
export function WorldMaker({ name, world, changed, kit, onChange, onRoll, onReset }: {
  name: string; world: World; changed: boolean; kit?: number; onChange: (c: Custom) => void; onRoll: () => void; onReset: () => void;
}) {
  const station = world.kind === STATION, mine = world.kind === MINE, [a, b, c, d] = world.p;
  const p = (n: number, v: number) => onChange({ p: world.p.map((x, i) => (i === n ? v : x)) as World["p"] });
  return (
    <details className="orb-make">
      <summary>{station ? `Build ${name}'s station` : mine ? `Set up ${name}'s mining cluster` : `Make ${name}'s world`}<small>{station ? "a station" : mine ? "asteroids" : `${world.sort}${changed ? ", made your own" : ""}`}</small></summary>
      <div className="orb-make-acts">
        <button type="button" className="orb-btn" title="Make up another, for this one only. What you've set here is replaced." onClick={onRoll}>Roll this one again</button>
        {changed && <button type="button" className="orb-btn" title="Put it back to what the whole system's roll makes of it" onClick={onReset}>Put it back</button>}
      </div>
      {/* What it is at all. Changing that starts its settings afresh for the new kind (what was set for the old one wouldn't mean anything to it). */}
      <div className="orb-set orb-sorts" role="group" aria-label="What it is">
        {KIND_NAMES.map(([kind, label, says]) => (
          <button key={kind} type="button" className="orb-step-btn worded" aria-pressed={world.kind === kind} title={`Make it ${says}`}
            onClick={() => { if (kind !== world.kind) onChange({ kind, sort: undefined, p: undefined, ring: undefined, moons: undefined }); }}>{label}</button>
        ))}
      </div>
      {mine ? (
        <>
          <Count label="Rocks" value={Math.round(a)} limit={LIMITS.rocks} onChange={(v) => p(0, v)} />
          <Slide label="Spread" value={b} limit={LIMITS.spread} onChange={(v) => p(1, v)} />
          <Slide label="Main rock" value={c} limit={LIMITS.mainRock} onChange={(v) => p(2, v)} />
          <Slide label="Rough" value={d} limit={LIMITS.rough} onChange={(v) => p(3, v)} />
        </>
      ) : station ? (
        <>
          <Count label="Spokes" value={a} limit={LIMITS.spokes} onChange={(v) => p(0, v)} />
          <Switch label="Second ring" on={b > 0.5} onChange={(on) => p(1, on ? 1 : 0)} />
          <Slide label="Ring" value={c} limit={LIMITS.stationRing} onChange={(v) => p(2, v)} />
          <Slide label="Wings" value={d} limit={LIMITS.wings} onChange={(v) => p(3, v)} />
        </>
      ) : (
        <>
          <div className="orb-set orb-sorts" role="group" aria-label="Which sort of world">
            {SORT_NAMES.map((sort) => (
              <button key={sort} type="button" className="orb-step-btn worded" aria-pressed={world.sort === sort} title={`Make it a ${sort} world (its sea, cloud, ice and dryness go to that sort's)`}
                onClick={() => onChange({ sort, p: middle(sort) })}>{sort}</button>
            ))}
          </div>
          <Slide label="Sea" value={a} limit={LIMITS.sea} onChange={(v) => p(0, v)} />
          <Slide label="Cloud" value={b} limit={LIMITS.cloud} flip onChange={(v) => p(1, v)} />
          <Slide label="Ice" value={c} limit={LIMITS.ice} flip onChange={(v) => p(2, v)} />
          <Slide label="Desert" value={d} limit={LIMITS.dry} onChange={(v) => p(3, v)} />
          <Slide label="Size" value={world.size} limit={LIMITS.size} onChange={(size) => onChange({ size })} />
          <Slide label="Air" value={world.air} limit={LIMITS.air} onChange={(air) => onChange({ air })} />
          <Switch label="Rings" on={!!world.ring} onChange={(on) => onChange({ ring: on ? { ...RING_USUAL } : null })} />
          {world.ring && (
            <Slide label="Ring width" value={world.ring.outer - world.ring.inner} limit={LIMITS.ringWide} onChange={(wide) => onChange({ ring: { inner: world.ring!.inner, outer: world.ring!.inner + wide } })} />
          )}
          <Count label="Moons" value={world.moons.length} limit={LIMITS.moons}
            onChange={(n) => onChange({ moons: n < world.moons.length ? world.moons.slice(0, n) : [...world.moons, anotherMoon(world, world.moons.length)] })} />
        </>
      )}
      {/* Its satellites are its skills and connectors when the camp knows them, so there's nothing to choose. */}
      {kit === undefined
        ? <Count label="Satellites" value={world.sats} limit={LIMITS.sats} onChange={(sats) => onChange({ sats })} />
        : <p className="orb-make-told">Satellites: {kit}, one for each skill and connector it has.</p>}
      <Slide label="Tilt" value={world.tilt} limit={LIMITS.tilt} onChange={(tilt) => onChange({ tilt })} />
      <Slide label="Spin" value={world.spin} limit={LIMITS.spin} onChange={(spin) => onChange({ spin })} says={world.spin < 0 ? "backwards" : undefined} />
    </details>
  );
}
