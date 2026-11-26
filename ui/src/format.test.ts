// A crew member's colour and who they are go by id, whatever a theme pack calls them now or
// called them when a line of history was written.
import { beforeEach, expect, test } from "vitest";
import { PACKS } from "../../src/packs.ts";
import { calledEver, cClass, crewId, handlesNow, isLead, leadName, nameNow, namesNow, setCrewColors, shown } from "./format.ts";
import { setWords } from "./words.ts";

const crewOf = (pack: string) => {
  const p = PACKS.find((x) => x.id === pack)!;
  return Object.entries(p.crew).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji, role: "" }));
};
beforeEach(() => setCrewColors([]));

test("before the page knows its crew, the Guild's names and the ids still find their colours", () => {
  expect(cClass("Scout")).toBe("c-scout");
  expect(cClass("quartermaster")).toBe("c-quartermaster");
  expect(cClass("Navigator")).toBe("");
  expect(cClass(undefined)).toBe("");
  expect(leadName()).toBe("Quartermaster");
});

test("under Starship, the new names and the old ones both give the member's own colour", () => {
  setCrewColors(crewOf("starship"), PACKS);
  expect(["Commander", "Navigator", "Comms Officer", "Engineer", "Security Chief"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden"]);
  // History written under the Guild pack keeps its colours.
  expect(["Quartermaster", "Scout", "Scribe", "Artificer", "Warden"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden"]);
  expect([crewId("comms"), crewId("Comms Officer"), crewId("scribe"), crewId("Nobody")]).toEqual(["scribe", "scribe", "scribe", undefined]);
  expect([isLead("Commander"), isLead("Quartermaster"), isLead("Navigator")]).toEqual([true, true, false]);
  expect([leadName(), nameNow("Scout"), nameNow("Navigator"), nameNow("Somebody")]).toEqual(["Commander", "Navigator", "Navigator", "Somebody"]);
  expect(calledEver("scout")).toEqual(["Scout", "Navigator", "Reporter", "Location Scout", "Field Researcher", "Spyglass"]);
});

test("back under Guild, a name from the Starship pack still finds its colour", () => {
  setCrewColors(crewOf("guild"), PACKS);
  expect([cClass("Engineer"), cClass("Artificer"), nameNow("Engineer")]).toEqual(["c-artificer", "c-artificer", "Artificer"]);
});

test("someone you added keeps their own name and colour, even when a pack uses the name", () => {
  setCrewColors([...crewOf("guild"), { id: "nav", name: "Navigator", emoji: "🧿", role: "", custom: true, color: "teal" },
    { id: "mage", name: "Wizard", emoji: "🪄", role: "", custom: true, color: "gold" }], PACKS);
  expect(cClass("Navigator")).toBe("c-x-teal");
  expect(crewId("Navigator")).toBeUndefined();
  expect(calledEver("scout")).toEqual(["Scout", "Reporter", "Location Scout", "Field Researcher", "Spyglass"]);
  // "Wizard" is what the Guild called the Test Pilot once; someone you added with that name is not them.
  expect([cClass("Wizard"), crewId("Wizard"), nameNow("Wizard")]).toEqual(["c-x-gold", undefined, "Wizard"]);
  expect(cClass("Scout")).toBe("c-scout");
});

test("the Test Pilot is the sixth of the camp's own: every name any pack has given them, old ones too, finds their colour and who they are now", () => {
  const all = ["wizard", "Wizard", "Test Pilot", "pilot", "Stringer", "Stunt Double", "stunt", "Tinkerer", "Powder Monkey", "monkey"];
  setCrewColors(crewOf("starship"), PACKS);
  expect(all.map(cClass)).toEqual(Array(all.length).fill("c-wizard"));
  expect(all.map((n) => crewId(n))).toEqual(Array(all.length).fill("wizard"));
  expect(["Wizard", "Tinkerer", "Test Pilot"].map(nameNow)).toEqual(Array(3).fill("Test Pilot"));
  expect(calledEver("wizard")).toEqual(["Test Pilot", "Wizard", "Stringer", "Stunt Double", "Tinkerer", "Powder Monkey"]);
  // Under Newsroom, the old "Wizard" and the Guild's "Test Pilot" are the Stringer.
  setCrewColors(crewOf("newsroom"), PACKS);
  expect([nameNow("Test Pilot"), nameNow("Wizard"), cClass("Stringer"), isLead("Stringer")]).toEqual(["Stringer", "Stringer", "c-wizard", false]);
  // Before the page knows its crew, the Guild's name for them still finds the colour.
  setCrewColors([]);
  expect([cClass("wizard"), calledEver("wizard")]).toEqual(["c-wizard", ["Test Pilot"]]);
});

// A pack of your own (camp/packs.json) comes to the page in the same list as the camp's own, and
// the names it gave before it was changed or deleted come beside it.
const PIRATES = {
  id: "pirates", name: "Pirates", custom: true,
  crew: { quartermaster: { name: "Captain", emoji: "🦜" }, scout: { name: "Lookout", emoji: "🔭", short: ["spy"] }, scribe: { name: "Chronicler", emoji: "📜" }, artificer: { name: "Shipwright", emoji: "🪚" }, warden: { name: "Bosun", emoji: "⚓" }, wizard: { name: "Sea Witch", emoji: "🌊" } },
};

test("a pack of your own gives its names the crew's colours, whichever pack is on", () => {
  const withMine = [...PACKS, PIRATES];
  setCrewColors(Object.entries(PIRATES.crew).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji, role: "" })), withMine);
  expect(["Captain", "Lookout", "Chronicler", "Shipwright", "Bosun", "spy", "Scout", "Navigator"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden", "c-scout", "c-scout", "c-scout"]);
  expect([leadName(), isLead("Captain"), nameNow("Navigator"), nameNow("Scout")]).toEqual(["Captain", true, "Lookout", "Lookout"]);
  // Back under the Guild, history written as the Lookout is still the Scout's.
  setCrewColors(crewOf("guild"), withMine);
  expect([cClass("Lookout"), nameNow("Lookout"), crewId("Bosun")]).toEqual(["c-scout", "Scout", "warden"]);
  expect(calledEver("scout")).toContain("Lookout");
  // The Test Pilot's name in it, too.
  expect([cClass("Sea Witch"), nameNow("Sea Witch"), crewId("Sea Witch")]).toEqual(["c-wizard", "Test Pilot", "wizard"]);
});

test("names a pack of yours gave before it was changed or deleted keep their colour in history", () => {
  const before = { scout: ["Lookout", "spy"], quartermaster: ["Captain"], wizard: ["Sea Witch"], gone: ["Cabin Boy"], scribe: ["Navigator", "Wizard"] };
  setCrewColors(crewOf("guild"), PACKS, before);
  expect(["Lookout", "Captain", "Sea Witch"].map(cClass)).toEqual(["c-scout", "c-quartermaster", "c-wizard"]);
  expect(["Lookout", "Captain", "Sea Witch"].map(nameNow)).toEqual(["Scout", "Quartermaster", "Test Pilot"]);
  expect(calledEver("scout")).toContain("Lookout");
  expect(calledEver("wizard")).toContain("Sea Witch");
  // Someone who isn't in the camp any more has no colour to give; and an old name never takes one
  // that somebody has now (a pack's, or someone you added).
  expect(cClass("Cabin Boy")).toBe("");
  expect([crewId("Navigator"), cClass("Wizard"), nameNow("Wizard")]).toEqual(["scout", "c-wizard", "Test Pilot"]);
  // Without them (an older camp), nothing changes.
  setCrewColors(crewOf("guild"), PACKS);
  expect(cClass("Lookout")).toBe("");
});

// Text the camp kept is shown in the pack that's on now, whichever pack was on when it was written.
test("a line written on the starship reads in the Guild's words after a switch, and back again", () => {
  setCrewColors(crewOf("guild"), PACKS);
  setWords("guild", PACKS);
  try {
    expect(namesNow("❓ The Commander asks: which branch?")).toBe("❓ The Quartermaster asks: which branch?");
    expect(namesNow("The Comms Officer and the Navigator are done")).toBe("The Scribe and the Scout are done");
    expect(shown("The {camp} was restarted while the {quest} was running.")).toBe("The camp was restarted while the quest was running.");
    // Someone's own words, in quotes, stay as they were written.
    expect(namesNow('a job called "Commander report" ran')).toBe('a job called "Commander report" ran');
    expect(handlesNow("@navigator look at the logs, (@pilot too) but not me@navigator")).toBe("@scout look at the logs, (@testpilot too) but not me@navigator");
    setCrewColors(crewOf("starship"), PACKS);
    setWords("starship", PACKS);
    expect(shown("❓ The Quartermaster asks: start {a quest}?")).toBe("❓ The Commander asks: start a mission?");
    expect(shown("The {camp} was restarted.")).toBe("The ship was restarted.");
    expect(handlesNow("@scout and @artificer")).toBe("@navigator and @engineer");
    expect(handlesNow("@nobody stays")).toBe("@nobody stays");
  } finally { setWords(undefined); }
});

test("someone you added keeps their name, even one a pack gives one of the six", () => {
  setCrewColors([...crewOf("guild"), { id: "nav", name: "Navigator", emoji: "🧿", role: "", custom: true, color: "teal" }], PACKS);
  expect(namesNow("The Navigator and the Commander")).toBe("The Navigator and the Quartermaster");
});
