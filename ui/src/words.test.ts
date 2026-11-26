// The theme pack's nouns: the Guild's until the camp says otherwise, with capitals and plurals.
import { afterEach, expect, test } from "vitest";
import { PACKS } from "../../src/packs.ts";
import { a, atCamp, cap, fillWords, many, setWords, w } from "./words.ts";

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
  expect([a("expedition"), a("Quest"), cap("ship")]).toEqual(["a voyage", "A mission", "Ship"]);
});

test("Newsroom, Studio, Lab and Pirate have their own words, with plurals that read right", () => {
  setWords("newsroom", PACKS);
  expect([w("crew"), w("quests"), w("Camp"), w("expeditions"), a("expedition"), a("quest")]).toEqual(["staff", "stories", "Newsroom", "assignments", "an assignment", "a story"]);
  setWords("studio", PACKS);
  expect([w("crew"), w("quests"), w("camps"), w("Expeditions"), a("expedition")]).toEqual(["crew", "scenes", "studios", "Shoots", "a shoot"]);
  setWords("lab", PACKS);
  expect([w("crew"), w("Quests"), w("camps"), w("expeditions"), a("expedition"), a("quest")]).toEqual(["team", "Experiments", "labs", "studies", "a study", "an experiment"]);
  setWords("pirate", PACKS);
  expect([w("crew"), w("Quests"), w("camps"), w("expeditions"), a("expedition"), a("quest")]).toEqual(["crew", "Raids", "ships", "voyages", "a voyage", "a raid"]);
});

test("a pack of your own has its words too, and the page makes the plurals it needs from them", () => {
  const mine = [...PACKS, { id: "pirates", words: { crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "voyage" } },
    { id: "kitchen", words: { crew: "brigade", quest: "dish", quests: "dishes", camp: "galley", expedition: "service" } },
    { id: "library", words: { crew: "staff", quest: "enquiry", quests: "enquiries", camp: "library", expedition: "search" } }];
  setWords("pirates", mine);
  expect([w("crew"), w("Quest"), w("quests"), w("camps"), w("Expeditions"), a("quest"), a("expedition")]).toEqual(["hands", "Errand", "errands", "ships", "Voyages", "an errand", "a voyage"]);
  setWords("kitchen", mine);
  expect([w("Crew"), w("quests"), w("camps"), w("expeditions")]).toEqual(["Brigade", "dishes", "galleys", "services"]);
  setWords("library", mine);
  expect([w("camps"), w("expeditions"), a("quest")]).toEqual(["libraries", "searches", "an enquiry"]);
  // What the dialog offers for "quests" until you type your own.
  expect(["errand", "dish", "enquiry", "story", "fix", "pass", "day"].map(many)).toEqual(["errands", "dishes", "enquiries", "stories", "fixes", "passes", "days"]);
});

test("the pack's phrases: the Guild's are the originals, a pack's own replace them, and a pack from an older camp makes them from its own words, as the camp does", () => {
  expect([w("member"), w("members"), w("log"), w("ready"), w("close"), w("closing"), w("back"), w("depart"), w("hq")])
    .toEqual(["adventurer", "adventurers", "quest log", "The camp is set", "break camp", "Breaking camp", "returns to camp", "sets out", "mission control"]);
  expect([w("Member"), w("Log"), w("HQ" as never)].slice(0, 2)).toEqual(["Adventurer", "Quest log"]);
  setWords("starship", PACKS);
  expect([w("member"), w("members"), w("log"), w("close"), w("depart"), w("hq"), a("member")]).toEqual(["officer", "officers", "ship's log", "power down", "launches", "the bridge", "an officer"]);
  setWords("older", [{ id: "older", words: { crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "voyage" } }]);
  expect([w("crew"), w("member"), w("back"), w("closing"), w("hq")]).toEqual(["hands", "hands member", "returns to the ship", "Closing the ship", "mission control"]);
});

test("an idle crew member is at the pack's place: \"At camp\" for the Guild, with an article for the rest", () => {
  setWords("guild", PACKS);
  expect(atCamp()).toBe("At camp");
  setWords("starship", PACKS);
  expect(atCamp()).toBe("At the ship");
  setWords("newsroom", PACKS);
  expect(atCamp()).toBe("At the newsroom");
});

test("fillWords fills the pack's {tokens}, with articles and capitals, and leaves other braces alone", () => {
  setWords("starship", PACKS);
  expect(fillWords("{A quest} for the {crew}: {Quests} left the {camp}, {an expedition} ended.")).toBe("A mission for the crew: Missions left the ship, a voyage ended.");
  expect(fillWords("{ \"json\": 1 } and {nonesuch} stay")).toBe("{ \"json\": 1 } and {nonesuch} stay");
  setWords("guild", PACKS);
  expect(fillWords("{An expedition} from the {camp}")).toBe("An expedition from the camp");
});
