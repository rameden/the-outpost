// Crew members you add can match the theme: under a pack they have a name for, they go by it,
// and every name they've had finds them after @.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("crew-themed");
const crew = await import("../src/crew.ts");

const designer = {
  id: "designer", name: "Designer", emoji: "🎨", role: "Art assets for the apps.",
  matchTheme: true, themed: { starship: { name: "Design Officer", emoji: "🌌" }, pirate: { name: "Figurehead Carver", emoji: "" } },
};

test("they go by the active pack's name for them, and their own where they have none", () => {
  crew.setPack("guild");
  crew.addMember(designer);
  assert.deepEqual([crew.CREW.designer.name, crew.CREW.designer.emoji], ["Designer", "🎨"]);
  crew.setPack("starship");
  assert.deepEqual([crew.CREW.designer.name, crew.CREW.designer.emoji], ["Design Officer", "🌌"]);
  crew.setPack("pirate");
  assert.deepEqual([crew.CREW.designer.name, crew.CREW.designer.emoji], ["Figurehead Carver", "🎨"]); // no themed icon: their own
  crew.setPack("guild");
});

test("every name they have, under any pack, finds them", () => {
  crew.setPack("starship");
  for (const n of ["designer", "Designer", "Design Officer", "designofficer", "Figurehead Carver"]) assert.equal(crew.findCrew(n)?.id, "designer", n);
  assert.equal(crew.mentionedCrew("can @designofficer draw a tent?")?.id, "designer");
  crew.setPack("guild");
});

test("turned off, they keep their own name, and the themed names are kept for later", () => {
  crew.setPack("starship");
  const m = crew.updateMember("designer", { ...crew.ownOf("designer"), matchTheme: false });
  assert.equal(crew.CREW.designer.name, "Designer");
  assert.equal(m.themed?.starship.name, "Design Officer");
  crew.setPack("guild");
});

test("a themed name someone else goes by is refused", () => {
  assert.throws(() => crew.addMember({ name: "Painter", role: "Paints.", matchTheme: true, themed: { starship: { name: "Engineer" } } }), /already what the/);
  assert.throws(() => crew.addMember({ name: "Painter", role: "Paints.", themed: { guild: { name: "Design Officer" } } }), /already what the/);
});
