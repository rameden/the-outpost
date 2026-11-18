// Ambient mode's camera: who it looks at, and when it cuts.
import { expect, test } from "vitest";
import { DWELL_MS, NO_CUT, QUIET_MS, direct, type Cut } from "./ambient.ts";

test("with nothing in view, whoever does something first is looked at", () => {
  expect(direct(NO_CUT, 1000, { who: "Scout" })).toEqual({ on: "Scout", since: 1000, heard: 1000 });
});

test("more from the one in view only keeps it there", () => {
  const cut: Cut = { on: "Scout", since: 1000, heard: 1000 };
  expect(direct(cut, 2000, { who: "Scout" })).toEqual({ on: "Scout", since: 1000, heard: 2000 });
});

test("another waits its turn until the dwell is up, then it's cut to", () => {
  const cut: Cut = { on: "Scout", since: 0, heard: 1000 };
  const wait = direct(cut, 2000, { who: "Scribe" });
  expect(wait).toEqual({ on: "Scout", since: 0, heard: 1000, next: "Scribe" });
  expect(direct(wait, 2000 + 100, undefined)).toBe(wait); // time passing, not yet
  expect(direct(wait, DWELL_MS, undefined)).toEqual({ on: "Scribe", since: DWELL_MS, heard: DWELL_MS });
  // Or the next thing they do, once it's been long enough.
  expect(direct(cut, DWELL_MS, { who: "Scribe" })).toEqual({ on: "Scribe", since: DWELL_MS, heard: DWELL_MS });
});

test("a decision for you doesn't wait its turn", () => {
  const cut: Cut = { on: "Scout", since: 1000, heard: 1000 };
  expect(direct(cut, 1500, { who: "Warden", urgent: true })).toEqual({ on: "Warden", since: 1500, heard: 1500 });
});

test("the latest one waiting is the one cut to", () => {
  let cut: Cut = { on: "Scout", since: 0, heard: 0 };
  cut = direct(cut, 100, { who: "Scribe" });
  cut = direct(cut, 200, { who: "Wizard" });
  expect(direct(cut, DWELL_MS, undefined).on).toBe("Wizard");
});

test("after twenty quiet seconds it steps back to the whole system, and stays there", () => {
  const cut: Cut = { on: "Scout", since: 0, heard: 5000 };
  expect(direct(cut, 5000 + QUIET_MS - 1, undefined)).toBe(cut);
  const out = direct(cut, 5000 + QUIET_MS, undefined);
  expect(out).toEqual({ on: null, since: 5000 + QUIET_MS, heard: 5000 + QUIET_MS });
  expect(direct(out, 5000 + 3 * QUIET_MS, undefined)).toBe(out);
});
