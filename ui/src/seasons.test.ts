// Decorations' calendar: which one is in season on a date.
import { expect, test } from "vitest";
import { SEASONS, isSeason, seasonById, seasonFor } from "./seasons.ts";

const on = (month: number, day: number, year = 2026) => seasonFor(new Date(year, month - 1, day, 12))?.id ?? null;

test("each decoration is in season from its first day to its last, and not the day before or after", () => {
  expect([on(10, 23), on(10, 24), on(10, 28), on(10, 31), on(11, 1)]).toEqual([null, "halloween", "halloween", "halloween", null]);
  expect([on(11, 30), on(12, 1), on(12, 25), on(12, 30)]).toEqual([null, "winter", "winter", "winter"]);
  expect([on(1, 2), on(1, 6), on(1, 7)]).toEqual(["winter", "winter", null]);
  // The rest of the year there's none.
  expect([on(2, 14), on(2, 29, 2028), on(7, 4), on(11, 19)]).toEqual([null, null, null, null]);
});

test("a window that crosses the year end holds on both sides of it, at any hour", () => {
  expect(seasonFor(new Date(2026, 11, 30, 23, 59, 59))?.id).toBe("winter");
  expect(seasonFor(new Date(2027, 0, 2, 0, 0, 0))?.id).toBe("winter");
  expect(seasonFor(new Date(2027, 0, 6, 23, 59, 59))?.id).toBe("winter");
  expect(seasonFor(new Date(2027, 0, 7, 0, 0, 0))).toBeNull();
  // A leap year moves nothing.
  expect([on(12, 31, 2028), on(1, 6, 2028), on(3, 1, 2028)]).toEqual(["newyear", "winter", null]);
});

test("where two windows overlap the shorter one wins: New Year's two days, inside Winter", () => {
  expect([on(12, 30), on(12, 31), on(1, 1), on(1, 2)]).toEqual(["winter", "newyear", "newyear", "winter"]);
});

test("the three are Winter, Halloween and New Year: named, described, with lights and something falling", () => {
  expect(SEASONS.map((s) => [s.id, s.effect, s.lights])).toEqual([["winter", "snow", true], ["halloween", "bats", true], ["newyear", "confetti", true]]);
  for (const s of SEASONS) {
    expect(s.name.length > 0 && s.about.length > 0).toBe(true);
    expect(`${s.from} ${s.to}`).toMatch(/^\d\d-\d\d \d\d-\d\d$/);
  }
  expect([isSeason("winter"), isSeason("auto"), isSeason(""), seasonById("halloween")?.name, seasonById("spring")]).toEqual([true, false, false, "Halloween", null]);
});
