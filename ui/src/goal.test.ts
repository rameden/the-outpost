// What the message box takes for itself: a goal for the conversation, and pausing everything.
import { expect, test } from "vitest";
import { goalStanding, ownLine, parseTyped, type Goal } from "./goal.ts";

test("/goal sets a goal, with a number in front for the most rounds", () => {
  expect(parseTyped("/goal ship the importer")).toEqual({ do: "goal", goal: "ship the importer" });
  expect(parseTyped("  /goal 5 ship the importer  ")).toEqual({ do: "goal", goal: "ship the importer", maxRounds: 5 });
  expect(parseTyped("/goal 3 tests\npass on main")).toEqual({ do: "goal", goal: "tests\npass on main", maxRounds: 3 });
  expect(parseTyped("/goal 2024 numbers are in the report")).toEqual({ do: "goal", goal: "numbers are in the report", maxRounds: 2024 }); // the server caps it
  expect(parseTyped("/goal 5")).toEqual({ do: "goal", goal: "5" });
});

test("/goal alone shows it; clear and resume do what they say", () => {
  expect(parseTyped("/goal")).toEqual({ do: "goal-show" });
  expect(parseTyped("/goal status")).toEqual({ do: "goal-show" });
  for (const word of ["clear", "stop", "off", "none", "CLEAR"]) expect(parseTyped(`/goal ${word}`)).toEqual({ do: "goal-clear" });
  expect(parseTyped("/goal resume")).toEqual({ do: "goal-resume" });
  expect(parseTyped("/goal resume 8")).toEqual({ do: "goal-resume", maxRounds: 8 });
  expect(parseTyped("/goal stop the flaky test for good")).toEqual({ do: "goal", goal: "stop the flaky test for good" });
});

test("/pause takes a reason; /resume takes nothing", () => {
  expect(parseTyped("/pause")).toEqual({ do: "pause" });
  expect(parseTyped("/pause deploying tonight")).toEqual({ do: "pause", reason: "deploying tonight" });
  expect(parseTyped("/resume")).toEqual({ do: "resume" });
  expect(parseTyped("/resume the import where it stopped")).toBeNull(); // that's a message for the crew
});

test("anything else is not for the message box to act on", () => {
  for (const text of ["", "goal: ship it", "/goals", "/paused", "please /pause", "/plan", "/goalposts moved"]) expect(parseTyped(text)).toBeNull();
});

test("where a goal stands, in a few words", () => {
  const goal = (over: Partial<Goal> = {}): Goal => ({ thread: "c1", goal: "g", status: "active", rounds: 0, maxRounds: 10, set: "2026-11-01T00:00:00.000Z", ...over }) as Goal;
  expect(goalStanding(goal())).toBe("Working · up to 10 more rounds");
  expect(goalStanding(goal({ maxRounds: 1 }))).toBe("Working · up to 1 more round");
  expect(goalStanding(goal({ rounds: 3 }))).toBe("Round 3 of 10");
  expect(goalStanding(goal({ rounds: 3 }), true)).toBe("Held while paused · round 3 of 10");
  expect(goalStanding(goal({ rounds: 2, owed: "run-1" }))).toBe("Held while paused · round 2 of 10");
  expect(goalStanding(goal({ status: "done", rounds: 4 }))).toBe("Reached");
  expect(goalStanding(goal({ status: "blocked" }))).toBe("Needs you");
  expect(goalStanding(goal({ status: "stopped" }), true)).toBe("Stopped"); // over is over, paused or not
});

test("a line that starts with /goal, /pause or /resume is the message box's own, never a page command", () => {
  for (const line of ["/goal", "/goal ship it", " /pause", "/pause lunch", "/resume", "/resume the import"]) expect(ownLine(line)).toBe(true);
  for (const line of ["/goals", "/paused", "/resumed", "/new", "goal", "see /goal"]) expect(ownLine(line)).toBe(false);
});
