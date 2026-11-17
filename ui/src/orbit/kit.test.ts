// What each of the crew carries, and how far along they are.
import { expect, test } from "vitest";
import { grownOf, kitOf, levelOf, questsDone } from "./kit.ts";

const S = {
  installedSkills: [
    { owner: "shared", name: "camp-rules", description: "Be kind" },
    { owner: "scout", name: "read-logs", description: "" },
    { owner: "scribe", name: "style", description: "Short" },
    { owner: "scout", name: "grep-well", description: "Find" },
  ],
  connectors: [
    { name: "github", description: "PRs", agents: ["scout", "artificer"], state: "connected", tools: [{ name: "list" }, { name: "open" }], allowWrite: true },
    { name: "wiki", description: "", agents: ["scribe"], state: "error", error: "token", tools: [] },
    { name: "ci", description: "Checks", agents: ["scout"], state: "idle", error: "no", tools: [] },
  ],
} as never;

test("their own skills come first, then their connectors, then the camp's shared skills", () => {
  const kit = kitOf(S, "scout");
  expect(kit.map((k) => k.id)).toEqual(["skill:scout/read-logs", "skill:scout/grep-well", "connector:github", "connector:ci", "skill:shared/camp-rules"]);
  expect(kit[0]).toMatchObject({ kind: "skill", name: "read-logs", about: "A skill" }); // no description: a plain word
  expect(kit.at(-1)).toMatchObject({ shared: true, about: "Be kind" });
  expect(kit[0].shared).toBeUndefined();
});

test("a connector says how it stands and what it offers, and only those that include them are listed", () => {
  const [, , gh, ci] = kitOf(S, "scout");
  expect(gh).toMatchObject({ kind: "connector", state: "connected", tools: ["list", "open"], write: true });
  expect(gh.error).toBeUndefined();
  expect(ci).toMatchObject({ state: "idle", error: "no" });
  expect(ci.write).toBeUndefined();
  expect(kitOf(S, "scribe").map((k) => k.name)).toEqual(["style", "wiki", "camp-rules"]);
  expect(kitOf(S, "warden").map((k) => k.name)).toEqual(["camp-rules"]);
});

test("a camp that reports neither carries nothing", () => {
  expect(kitOf(null, "scout")).toEqual([]);
  expect(kitOf({}, "scout")).toEqual([]);
});

test("a level for every fifty experience, a quest is worth ten, and a world settles over nine levels", () => {
  expect([0, 49, 50, 120, -5].map(levelOf)).toEqual([1, 1, 2, 3, 1]);
  expect([0, 9, 10, 95, -5].map(questsDone)).toEqual([0, 0, 1, 9, 0]);
  expect(grownOf(0)).toBe(0);
  expect(grownOf(200)).toBe(0.5);
  expect(grownOf(400)).toBe(1);
  expect(grownOf(5000)).toBe(1);
});
