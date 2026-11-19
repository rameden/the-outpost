// A crew member's colour and who they are go by id, whatever a theme pack calls them now or
// called them when a line of history was written.
import { beforeEach, expect, test } from "vitest";
import { PACKS } from "../../src/packs.ts";
import { calledEver, cClass, crewId, isLead, leadName, nameNow, setCrewColors } from "./format.ts";

const five = (pack: string) => {
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
  setCrewColors(five("starship"), PACKS);
  expect(["Commander", "Navigator", "Comms Officer", "Engineer", "Security Chief"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden"]);
  // History written under the Guild pack keeps its colours.
  expect(["Quartermaster", "Scout", "Scribe", "Artificer", "Warden"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden"]);
  expect([crewId("comms"), crewId("Comms Officer"), crewId("scribe"), crewId("Nobody")]).toEqual(["scribe", "scribe", "scribe", undefined]);
  expect([isLead("Commander"), isLead("Quartermaster"), isLead("Navigator")]).toEqual([true, true, false]);
  expect([leadName(), nameNow("Scout"), nameNow("Navigator"), nameNow("Somebody")]).toEqual(["Commander", "Navigator", "Navigator", "Somebody"]);
  expect(calledEver("scout")).toEqual(["Scout", "Navigator", "Reporter", "Location Scout", "Field Researcher"]);
});

test("back under Guild, a name from the Starship pack still finds its colour", () => {
  setCrewColors(five("guild"), PACKS);
  expect([cClass("Engineer"), cClass("Artificer"), nameNow("Engineer")]).toEqual(["c-artificer", "c-artificer", "Artificer"]);
});

test("someone you added keeps their own name and colour, even when a pack uses the name", () => {
  setCrewColors([...five("guild"), { id: "nav", name: "Navigator", emoji: "🧿", role: "", custom: true, color: "teal" },
    { id: "wizard", name: "Wizard", emoji: "🪄", role: "", custom: true, color: null }], PACKS);
  expect(cClass("Navigator")).toBe("c-x-teal");
  expect(crewId("Navigator")).toBeUndefined();
  expect(calledEver("scout")).toEqual(["Scout", "Reporter", "Location Scout", "Field Researcher"]);
  expect(cClass("Wizard")).toBe("");
  expect(cClass("Scout")).toBe("c-scout");
});

test("the Wizard's names from every pack find their colour and who they are now, while they're still the Wizard", () => {
  const wizard = { id: "wizard", name: "Test Pilot", emoji: "🛸", role: "", custom: true, color: "violet", own: { name: "Wizard", emoji: "🪄" } };
  setCrewColors([...five("starship"), wizard], PACKS);
  expect(["Wizard", "Test Pilot", "Stringer", "Stunt Double", "Tinkerer"].map(cClass)).toEqual(Array(5).fill("c-x-violet"));
  expect(["Wizard", "Tinkerer", "Test Pilot"].map(nameNow)).toEqual(Array(3).fill("Test Pilot"));
  expect(calledEver("wizard")).toEqual(["Wizard", "Test Pilot", "Stringer", "Stunt Double", "Tinkerer"]);
  expect(crewId("Test Pilot")).toBeUndefined();      // not one of the five
  // Under Guild they're the Wizard, and an old "Test Pilot" still means them.
  setCrewColors([...five("guild"), { ...wizard, name: "Wizard", emoji: "🪄", own: undefined }], PACKS);
  expect([nameNow("Test Pilot"), cClass("Stringer")]).toEqual(["Wizard", "c-x-violet"]);
  // Called something of your own, the packs' names aren't theirs.
  setCrewColors([...five("starship"), { ...wizard, name: "Merlin", own: undefined }], PACKS);
  expect([cClass("Merlin"), cClass("Test Pilot"), nameNow("Wizard"), calledEver("wizard")]).toEqual(["c-x-violet", "", "Wizard", []]);
  // And a name someone else you added already has stays theirs.
  setCrewColors([...five("newsroom"), { ...wizard, name: "Stringer", emoji: "⚡" }, { id: "pilot", name: "Test Pilot", emoji: "✈️", role: "", custom: true, color: "gold" }], PACKS);
  expect([cClass("Test Pilot"), nameNow("Test Pilot"), nameNow("Wizard")]).toEqual(["c-x-gold", "Test Pilot", "Stringer"]);
});

// A pack of your own (camp/packs.json) comes to the page in the same list as the camp's five, and
// the names it gave before it was changed or deleted come beside it.
const PIRATES = {
  id: "pirates", name: "Pirates", custom: true,
  crew: { quartermaster: { name: "Captain", emoji: "🦜" }, scout: { name: "Lookout", emoji: "🔭", short: ["spy"] }, scribe: { name: "Chronicler", emoji: "📜" }, artificer: { name: "Shipwright", emoji: "🪚" }, warden: { name: "Bosun", emoji: "⚓" } },
  extras: { wizard: { name: "Sea Witch", emoji: "🌊" } },
};

test("a pack of your own gives its names the crew's colours, whichever pack is on", () => {
  const withMine = [...PACKS, PIRATES];
  setCrewColors(Object.entries(PIRATES.crew).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji, role: "" })), withMine);
  expect(["Captain", "Lookout", "Chronicler", "Shipwright", "Bosun", "spy", "Scout", "Navigator"].map(cClass))
    .toEqual(["c-quartermaster", "c-scout", "c-scribe", "c-artificer", "c-warden", "c-scout", "c-scout", "c-scout"]);
  expect([leadName(), isLead("Captain"), nameNow("Navigator"), nameNow("Scout")]).toEqual(["Captain", true, "Lookout", "Lookout"]);
  // Back under the Guild, history written as the Lookout is still the Scout's.
  setCrewColors(five("guild"), withMine);
  expect([cClass("Lookout"), nameNow("Lookout"), crewId("Bosun")]).toEqual(["c-scout", "Scout", "warden"]);
  expect(calledEver("scout")).toContain("Lookout");
  // The Wizard's name in it, too.
  setCrewColors([...five("guild"), { id: "wizard", name: "Wizard", emoji: "🪄", role: "", custom: true, color: "violet" }], withMine);
  expect([cClass("Sea Witch"), nameNow("Sea Witch")]).toEqual(["c-x-violet", "Wizard"]);
});

test("names a pack of yours gave before it was changed or deleted keep their colour in history", () => {
  const wizard = { id: "wizard", name: "Wizard", emoji: "🪄", role: "", custom: true, color: "violet" };
  const before = { scout: ["Lookout", "spy"], quartermaster: ["Captain"], wizard: ["Sea Witch"], gone: ["Cabin Boy"], scribe: ["Navigator", "Wizard"] };
  setCrewColors([...five("guild"), wizard], PACKS, before);
  expect(["Lookout", "Captain", "Sea Witch"].map(cClass)).toEqual(["c-scout", "c-quartermaster", "c-x-violet"]);
  expect(["Lookout", "Captain", "Sea Witch"].map(nameNow)).toEqual(["Scout", "Quartermaster", "Wizard"]);
  expect(calledEver("scout")).toContain("Lookout");
  expect(calledEver("wizard")).toContain("Sea Witch");
  // Someone who isn't in the camp any more has no colour to give; and an old name never takes one
  // that somebody has now (a pack's, or someone you added).
  expect(cClass("Cabin Boy")).toBe("");
  expect([crewId("Navigator"), cClass("Wizard"), nameNow("Wizard")]).toEqual(["scout", "c-x-violet", "Wizard"]);
  // Without them (an older camp), nothing changes.
  setCrewColors(five("guild"), PACKS);
  expect(cClass("Lookout")).toBe("");
});
