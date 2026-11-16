// Ambient mode's camera (Orbit.tsx), for a second screen nobody is driving: it cuts to whoever
// just did something, stays long enough to read what, and goes back to the whole system when the
// camp is quiet. This is only the deciding; the flying is the view's.

export const DWELL_MS = 6000;  // it stays with one for at least this long before cutting to another
export const QUIET_MS = 20_000; // with nothing from the one it's on for this long, it steps back to the whole system

// on: who it's looking at (nobody: the whole system). since: when it cut there. heard: when they last did anything.
// next: who has done something since, and is waiting for the cut.
export type Cut = { on: string | null; since: number; heard: number; next?: string };
export const NO_CUT: Cut = { on: null, since: 0, heard: 0 };

// did: one of the crew has just done something (urgent: it's a decision for you, which doesn't wait its turn).
// Without it, this is just time passing.
export function direct(cut: Cut, now: number, did?: { who: string; urgent?: boolean }): Cut {
  if (did) {
    if (did.who === cut.on) return { on: cut.on, since: cut.since, heard: now };
    if (did.urgent || !cut.on || now - cut.since >= DWELL_MS) return { on: did.who, since: now, heard: now };
    return { ...cut, next: did.who };
  }
  if (cut.next && now - cut.since >= DWELL_MS) return { on: cut.next, since: now, heard: now };
  if (cut.on && now - cut.heard >= QUIET_MS) return { on: null, since: now, heard: now };
  return cut;
}
