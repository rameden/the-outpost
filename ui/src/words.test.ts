// The theme pack's nouns: the Guild's until the camp says otherwise, with capitals and plurals.
import { afterEach, expect, test } from "vitest";
import { PACKS } from "../../src/packs.ts";
import { a, cap, setWords, w } from "./words.ts";

afterEach(() => setWords(undefined));

test("the Guild's words are the default, and what an unknown pack falls back to", () => {
  expect([w("crew"), w("quest"), w("quests"), w("camp"), w("expedition"), w("expeditions")]).toEqual(["crew", "quest", "quests", "camp", "expedition", "expeditions"]);
  setWords("nonesuch", PACKS);
  expect(w("Quests")).toBe("Quests");
  setWords("guild", PACKS);
  expect([w("Camp"), a("expedition"), a("quest")]).toEqual(["Camp", "an expedition", "a quest"]);
});

test("Starship's words, in each form", () => {
  setWords("starship", PACKS);
  expect([w("crew"), w("quest"), w("quests"), w("camp"), w("expedition"), w("expeditions"), w("camps")]).toEqual(["crew", "mission", "missions", "ship", "voyage", "voyages", "ships"]);
  expect([w("Crew"), w("Quest"), w("Quests"), w("Camp"), w("Expedition"), w("Expeditions")]).toEqual(["Crew", "Mission", "Missions", "Ship", "Voyage", "Voyages"]);
  expect([a("expedition"), a("Quest"), cap("ship")]).toEqual(["a voyage", "a Mission", "Ship"]);
});
