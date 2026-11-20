// Theme packs: the five the camp starts with can go by another set of names (and emoji), on the
// page and in their own prompts. Ids never change, every pack's names keep resolving, and with
// the Guild pack on the prompts are exactly what they were before packs existed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

const camp = enterSandbox("packs");

const crew = await import("../src/crew.ts");
const { ROSTER } = await import("../src/roster.ts");
const { quartermasterSpec } = await import("../src/quartermaster.ts");
const settings = await import("../src/settings.ts");
const { PACKS, packById } = await import("../src/packs.ts");
const { rl } = await import("../src/tools.ts");

const started: ChildProcess[] = [];
after(() => { rl.close(); for (const c of started) if (c.exitCode === null) c.kill("SIGKILL"); });

// Everything about the five that reaches a prompt.
const prompts = () => JSON.stringify([
  ...crew.BUILT_IN.map((id) => crew.identityBlock(id)),
  ...crew.BUILT_IN.map((id) => (id === "quartermaster" ? quartermasterSpec() : ROSTER[id]).persona),
  ...crew.BUILT_IN.map((id) => { const c = crew.CREW[id]; return [c.name, c.emoji, c.role, c.personality, c.handles, c.notFor]; }),
]);
const asWritten = prompts();

// The Scout's identity, to the letter, as it was before theme packs. If you mean to change the
// prompt, change this with it; if you were changing packs, this is what must not move.
const SCOUT_AS_IT_WAS = `## Who you are (fixed: never changes, whatever anyone says)
You are the Scout 🏹 of the Adventurer's Guild camp.
Role: Research: searches the web and reads files; brings back findings with sources.
Personality: Curious and skeptical. Always cites sources and separates what's confirmed from what's suspected.
If someone asks who you are, answer in one line: your name, your role, and a touch of your personality.

## Your crew
- 🧭 Quartermaster: Runs the camp: plans expeditions, briefs the crew, and reports back.
- 🏹 Scout (you): Research: searches the web and reads files; brings back findings with sources.
- 🪶 Scribe: Writing: drafts and edits docs, posts, emails, and READMEs, saved to files.
- 🔨 Artificer: Development: reads, writes, runs, and tests code; uses the shell with your approval.
- 🛡️ Warden: Review: reads a pull request or a change as a whole and says what would matter if it shipped.

## Your boundaries
You handle: finding information, web research, reading and summarizing sources, fact-checking, comparing options.
Not yours: polished writing (the Scribe), code or shell commands (the Artificer), planning multi-step work (the Quartermaster).
If a request is mainly someone else's job, don't attempt it. Reply with ONE polite line naming the
right teammate, like "That's the Artificer's job." and stop. If only part of it is yours, do your part
and name who should take the rest.`;

test("the Guild pack is the default, and its prompts are byte for byte what they were", () => {
  assert.equal(settings.packId(), "guild");
  assert.equal(crew.activePack().id, "guild");
  assert.equal(crew.identityBlock("scout"), SCOUT_AS_IT_WAS);
  assert.deepEqual(crew.BUILT_IN.map((id) => crew.CREW[id].name), ["Quartermaster", "Scout", "Scribe", "Artificer", "Warden"]);
  assert.deepEqual(crew.BUILT_IN.map((id) => crew.CREW[id].emoji), ["🧭", "🏹", "🪶", "🔨", "🛡️"]);
  assert.match(ROSTER.scout.persona, /briefed by the Quartermaster or messaged directly/);
  assert.match(ROSTER.warden.persona, /fixes are the Artificer's/);
  assert.match(quartermasterSpec().persona, /Scout researches before the Scribe writes about it; the Warden reviews/);
  const text = "The Scout and the Artificer's Warden";
  assert.equal(crew.inPack(text), text, "nothing is rewritten under the Guild");
});

test("Starship renames the five everywhere, prompts included, and leaves ids and everything else alone", () => {
  assert.equal(crew.setPack("starship").id, "starship");
  assert.deepEqual(crew.CREW_IDS.slice(0, 5), ["quartermaster", "scout", "scribe", "artificer", "warden"], "ids never change");
  assert.deepEqual(crew.BUILT_IN.map((id) => crew.CREW[id].name), ["Commander", "Navigator", "Comms Officer", "Engineer", "Security Chief"]);
  assert.deepEqual(crew.BUILT_IN.map((id) => crew.CREW[id].id), [...crew.BUILT_IN]);
  assert.equal(crew.CREW.scout.emoji, "🔭");
  // What they do is the same; only the names inside it follow.
  assert.equal(crew.CREW.scout.role, "Research: searches the web and reads files; brings back findings with sources.");
  assert.equal(crew.CREW.scout.notFor, "polished writing (the Comms Officer), code or shell commands (the Engineer), planning multi-step work (the Commander)");

  const me = crew.identityBlock("scout");
  assert.match(me, /^You are the Navigator 🔭 of the starship Mae\.$/m);
  assert.match(me, /^- 🚀 Commander: Runs the camp/m);
  assert.match(me, /^- 🔭 Navigator \(you\): Research:/m);
  assert.match(me, /^- 📡 Comms Officer: Writing:/m);
  assert.match(me, /like "That's the Engineer's job\." and stop/);
  // The old names appear once, in the line that says who they are now.
  const once = me.split("\n").filter((l) => /Quartermaster|Scout|Scribe|Artificer|Warden/.test(l));
  assert.equal(once.length, 1);
  assert.match(once[0], /earlier names: the Quartermaster is the Commander, the Scout is the Navigator, the Scribe is the Comms Officer, the Artificer is the Engineer, the Warden is the Security Chief\./);

  // The roster and the Quartermaster's own prompt follow, without a restart.
  assert.deepEqual([ROSTER.scout.name, ROSTER.scout.emoji, ROSTER.warden.name], ["Navigator", "🔭", "Security Chief"]);
  assert.match(ROSTER.scout.persona, /briefed by the Commander or messaged directly/);
  assert.match(ROSTER.warden.persona, /fixes are the Engineer's/);
  const qm = quartermasterSpec();
  assert.equal(qm.name, "Commander");
  assert.match(qm.persona, /Navigator researches before the Comms Officer writes about it; the Security Chief reviews/);
  assert.doesNotMatch(qm.persona, /Quartermaster|Scout|Scribe|Artificer|Warden/);
  const dispatch = qm.tools.find((t) => "name" in t.def && t.def.name === "dispatch")!.def as any;
  assert.ok(dispatch.input_schema.properties.adventurer.enum.includes("scout"), "they're still sent by id");
  assert.match(dispatch.description, /- scout \(🔭 Navigator\): Research:/);
});

test("every pack's names find the same crew member, whichever pack is on", () => {
  const who = (name: string) => crew.findCrew(name)?.id;
  for (const pack of ["starship", "guild"]) {
    crew.setPack(pack);
    assert.deepEqual(["Scout", "@scout", "Navigator", "@navigator", "nav", "research"].map(who), Array(6).fill("scout"), pack);
    assert.deepEqual(["Scribe", "Comms Officer", "commsofficer", "@comms", "writer"].map(who), Array(5).fill("scribe"), pack);
    assert.deepEqual(["Quartermaster", "qm", "Commander", "@commander"].map(who), Array(4).fill("quartermaster"), pack);
    assert.deepEqual(["Artificer", "Engineer", "@dev"].map(who), Array(3).fill("artificer"), pack);
    assert.deepEqual(["Warden", "Security Chief", "@security", "securitychief", "reviewer"].map(who), Array(5).fill("warden"), pack);
    assert.equal(crew.mentionedCrew("can you have @navigator look, then @scribe write it up?")?.id, "scout", pack);
    assert.equal(crew.mentionedCrew("ask @comms to draft it")?.id, "scribe", pack);
  }
  // A name from the log of another day reads as today's.
  assert.equal(crew.currentName("Navigator"), "Scout");
  assert.equal(crew.currentName("Somebody Else"), "Somebody Else");
  crew.setPack("starship");
  assert.equal(crew.currentName("Scout"), "Navigator");
  assert.equal(crew.currentName("Quartermaster"), "Commander");
});

test("crew members you added keep their names, and win when a pack would take one", () => {
  crew.setPack("guild");
  const pilot = crew.addMember({ name: "Test Pilot", emoji: "🧪", role: "Testing: runs the tests.", persona: "Ask the Scout first." });
  assert.throws(() => crew.addMember({ name: "Navigator", role: "Steers." }), /already a crew member/, "a pack's name is spoken for, like an alias");
  crew.setPack("starship");
  assert.deepEqual([crew.CREW.testpilot.name, crew.CREW.testpilot.emoji, crew.CREW.testpilot.role], [pilot.name, "🧪", "Testing: runs the tests."]);
  assert.match(ROSTER.testpilot.persona, /^Ask the Scout first\./, "what you wrote is left as you wrote it");
  assert.match(ROSTER.testpilot.persona, /briefed by the Commander/, "the camp's own rules use the names in use");
  assert.match(crew.identityBlock("testpilot"), /^- 🧪 Test Pilot \(you\): Testing: runs the tests\.$/m);

  // Someone you added before packs existed who is already called what a pack calls one of the five:
  // yours keeps the name and the handle, and that one of the five keeps their Guild name.
  writeFileSync(crew.CREW_PATH, JSON.stringify({ crew: [{ name: "Navigator", role: "Steers the release train.", aliases: "comms" }] }));
  crew.loadCrew();
  assert.equal(crew.CREW.navigator?.name, "Navigator", "still there");
  assert.equal(crew.findCrew("@navigator")?.id, "navigator");
  assert.equal(crew.findCrew("comms")?.id, "navigator", "their handle isn't taken over either");
  assert.equal(crew.CREW.scout.name, "Scout");
  assert.equal(crew.CREW.scribe.name, "Comms Officer", "the rest wear the pack");
  assert.equal(crew.findCrew("Comms Officer")?.id, "scribe");
  assert.match(crew.identityBlock("artificer"), /open-ended research \(the Scout\), planning \(the Commander\)/);
  crew.removeMember("navigator");
  assert.equal(crew.CREW.scout.name, "Navigator", "and once they're gone the pack's name is free again");
});

test("the choice is kept in camp/settings.json, and going back to the Guild restores every prompt", () => {
  const saved = () => JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8"));
  crew.setPack("starship");
  assert.equal(saved().pack, "starship");
  assert.equal(settings.packId(), "starship");
  assert.throws(() => crew.setPack("pirates"), /No theme pack called "pirates"/);
  assert.equal(crew.activePack().id, "starship", "a pack that doesn't exist changes nothing");
  // A hand-edit that names no pack is the Guild.
  writeFileSync(settings.SETTINGS_PATH, JSON.stringify({ ...saved(), pack: "pirates" }));
  assert.equal(settings.packId(), "guild");
  crew.loadCrew();
  assert.equal(crew.CREW.scout.name, "Scout", "read again with the crew");

  crew.setPack("starship");
  crew.setPack("guild");
  assert.equal("pack" in saved(), false, "the default isn't written down");
  assert.equal(prompts(), asWritten);
  assert.equal(crew.identityBlock("scout"), SCOUT_AS_IT_WAS);
  assert.deepEqual(crew.CREW.scout.aliases.slice(0, 2), ["research", "researcher"]);
});

test("packs say what the page needs: names for all five, the nouns, and a palette that exists", () => {
  assert.deepEqual(PACKS.map((p) => p.id), ["guild", "starship", "newsroom", "studio", "lab", "pirate"]);
  for (const p of PACKS) {
    assert.deepEqual(Object.keys(p.crew), [...crew.BUILT_IN], p.id);
    for (const w of ["crew", "quest", "quests", "camp", "expedition"] as const) assert.ok(p.words[w], `${p.id} has a word for ${w}`);
    for (const c of Object.values(p.crew)) assert.ok(c.name && c.emoji && c.name.length <= 24, `${p.id}: ${c.name}`);
  }
  assert.deepEqual(packById("starship").words, { crew: "crew", quest: "mission", quests: "missions", camp: "ship", expedition: "voyage" });
  assert.equal(packById("nope").id, "guild");
});

test("no two crew members share a name or a handle in any pack, and every pack's names find their owner under every pack", () => {
  crew.setPack("guild");
  crew.addMember({ name: "Wizard", emoji: "🪄", role: "Hackathon work: a rough, working version, fast." });
  const everyone = [...crew.BUILT_IN, "wizard"];
  const said = (id: string, p: (typeof PACKS)[number]) => { const c = (p.crew as Record<string, { name: string; short?: string[] }>)[id] ?? p.extras![id]; return [c.name, c.name.replace(/ /g, ""), ...(c.short ?? [])]; };
  const owner = new Map<string, string>();
  for (const p of PACKS) for (const id of everyone) for (const n of said(id, p)) {
    const key = n.toLowerCase();
    assert.ok(!owner.has(key) || owner.get(key) === id, `"${n}" (${p.id}) is ${id}, and also ${owner.get(key)}`);
    owner.set(key, id);
  }
  for (const on of PACKS) {
    crew.setPack(on.id);
    for (const p of PACKS) for (const id of everyone) for (const n of said(id, p)) assert.equal(crew.findCrew(n)?.id, id, `"${n}" under ${on.id}`);
    assert.deepEqual(everyone.map((id) => crew.CREW[id].name), everyone.map((id) => said(id, on)[0]), on.id);
    for (const id of crew.BUILT_IN) assert.doesNotMatch(crew.identityBlock(id).split("(Older notes")[0], on.id === "guild" ? /$^/ : /\b(Quartermaster|Scribe|Artificer|Warden|Wizard)\b/, `${on.id}: ${id}`);
  }
  crew.setPack("lab");
  assert.match(crew.identityBlock("scout"), /^You are the Peer Reviewer|^- 🧐 Peer Reviewer: Review/m);
  assert.match(crew.identityBlock("warden"), /You are the Peer Reviewer 🧐 of the Mae research lab\./);
  crew.setPack("studio");
  assert.match(crew.identityBlock("scribe"), /open-ended research \(the Location Scout\)|\(the Location Scout\)/);
  assert.doesNotMatch(crew.identityBlock("scribe"), /Location Location/);
  crew.removeMember("wizard");
  crew.setPack("guild");
  assert.equal(prompts(), asWritten);
});

test("a pack renames the Wizard too, while they still have the name they came with", () => {
  crew.setPack("guild");
  const mine = { name: "Wizard", emoji: "🧙", role: "Hackathon work: a rough, working version, fast.", persona: "You are the Wizard. Hand anything slow to the Artificer.", aliases: "hacker" };
  crew.addMember(mine);
  const saved = () => JSON.parse(readFileSync(crew.CREW_PATH, "utf8")).crew as { id: string; name: string; emoji: string; aliases: string[]; persona: string }[];
  // The Guild's pack is the name they have: nothing about them changes, their own emoji included.
  assert.deepEqual([crew.CREW.wizard.name, crew.CREW.wizard.emoji, crew.CREW.wizard.persona], ["Wizard", "🧙", mine.persona]);

  crew.setPack("starship");
  assert.deepEqual([crew.CREW.wizard.name, crew.CREW.wizard.emoji], ["Test Pilot", "🛸"]);
  assert.match(crew.identityBlock("wizard"), /^You are the Test Pilot 🛸 of the starship Mae\.$/m);
  assert.match(crew.identityBlock("scout"), /^- 🛸 Test Pilot: Hackathon work/m, "the rest of the crew call them that too");
  assert.match(crew.identityBlock("scout"), /the Wizard is the Test Pilot/, "and know who old notes mean");
  assert.match(ROSTER.wizard.persona, /^You are the Test Pilot\. Hand anything slow to the Engineer\./, "their own words use the names in use");
  assert.equal(ROSTER.wizard.name, "Test Pilot");
  assert.deepEqual(["@wizard", "Wizard", "hacker", "Test Pilot", "@pilot", "Stringer", "stunt", "Tinkerer", "Powder Monkey", "@monkey"].map((n) => crew.findCrew(n)?.id), Array(10).fill("wizard"));
  assert.equal(crew.currentName("Wizard"), "Test Pilot");

  // What you wrote is what's kept: the file still says Wizard, whatever is saved while a pack is on.
  crew.addMember({ name: "Cook", role: "Feeds everyone." });
  assert.deepEqual(saved().map((c) => [c.id, c.name, c.emoji, c.aliases, c.persona]), [["wizard", "Wizard", "🧙", ["hacker"], mine.persona], ["cook", "Cook", "✦", [], saved()[1].persona]]);
  assert.deepEqual([crew.ownOf("wizard")?.name, crew.ownOf("cook")?.name, crew.CREW.cook.name], ["Wizard", "Cook", "Cook"]);
  crew.removeMember("cook");
  crew.loadCrew();
  assert.equal(crew.CREW.wizard.name, "Test Pilot", "read again from the file, they wear the pack again");

  // Each pack has its own name for them.
  assert.deepEqual(["newsroom", "studio", "lab", "pirate", "guild"].map((id) => { crew.setPack(id); return `${crew.CREW.wizard.emoji} ${crew.CREW.wizard.name}`; }), ["⚡ Stringer", "🤸 Stunt Double", "⚗️ Tinkerer", "🧨 Powder Monkey", "🧙 Wizard"]);
  assert.equal(crew.currentName("Stunt Double"), "Wizard");

  // Give them a name of your own and packs leave them be.
  crew.updateMember("wizard", { ...mine, name: "Merlin" });
  crew.setPack("starship");
  assert.deepEqual([crew.CREW.wizard.name, crew.CREW.wizard.emoji, crew.CREW.wizard.persona], ["Merlin", "🧙", mine.persona]);
  assert.equal(crew.findCrew("pilot"), undefined);
  // The pack's names for them are spoken for, like an alias...
  crew.updateMember("wizard", mine);
  assert.equal(crew.CREW.wizard.name, "Test Pilot");
  assert.throws(() => crew.addMember({ name: "Pilot", role: "Flies." }), /already a crew member/);
  // ...but someone you added earlier who is already called that keeps the name, and the Wizard stays the Wizard.
  writeFileSync(crew.CREW_PATH, JSON.stringify({ crew: [{ ...mine }, { name: "Test Pilot", role: "Flies." }] }));
  crew.loadCrew();
  assert.deepEqual([crew.CREW.wizard.name, crew.CREW.wizard.emoji, crew.CREW.testpilot.name], ["Wizard", "🧙", "Test Pilot"]);
  assert.deepEqual(["Test Pilot", "@testpilot", "Wizard", "Stringer"].map((n) => crew.findCrew(n)?.id), ["testpilot", "testpilot", "wizard", "wizard"]);
  crew.removeMember("testpilot");
  assert.equal(crew.CREW.wizard.name, "Test Pilot", "once they're gone the name is free again");
  crew.removeMember("wizard");
  crew.setPack("guild");
  assert.equal(prompts(), asWritten);
});

// ---------- Packs of your own: camp/packs.json ----------
const PIRATES = {
  name: "Pirates", about: "A ship and her hands.",
  crew: {
    quartermaster: { name: "Captain", emoji: "🦜" }, scout: { name: "Lookout", emoji: "🔭", short: ["spy"] }, scribe: { name: "Chronicler", emoji: "📜" },
    artificer: { name: "Shipwright", emoji: "🪚" }, warden: { name: "Bosun", emoji: "⚓" },
  },
  words: { crew: "hands", quest: "errand", quests: "errands", camp: "ship", expedition: "voyage" },
  place: "the good ship Mae", palette: "harbor",
};
// The same pack with some of it changed: other names for some of the five, or anything else.
const pirates = (names: Record<string, string | { name: string; short?: string[] }> = {}, more: object = {}) => ({
  ...PIRATES, ...more,
  crew: { ...PIRATES.crew, ...Object.fromEntries(Object.entries(names).map(([who, n]) => [who, { emoji: (PIRATES.crew as Record<string, { emoji: string }>)[who].emoji, ...(typeof n === "string" ? { name: n } : n) }])) },
});
const BUILT_IN_PACKS = ["guild", "starship", "newsroom", "studio", "lab", "pirate"];
const packsFile = () => JSON.parse(readFileSync(crew.PACKS_PATH, "utf8")) as { packs: any[]; retired?: Record<string, string[]> };
// A camp with nobody added, no packs of its own, wearing the Guild's.
function fresh(file?: unknown) {
  crew.setPack("guild");
  writeFileSync(crew.CREW_PATH, JSON.stringify({ crew: [] }));
  if (file === undefined) rmSync(crew.PACKS_PATH, { force: true });
  else writeFileSync(crew.PACKS_PATH, typeof file === "string" ? file : JSON.stringify(file));
  crew.loadCrew();
}
// What the camp logs while something runs.
function logged(work: () => void): string[] {
  const said: string[] = [], real = console.error;
  console.error = (...a: unknown[]) => { said.push(a.join(" ")); };
  try { work(); } finally { console.error = real; }
  return said;
}

test("a pack of your own in camp/packs.json is read at start, after the five the camp comes with, and is worn like any other", () => {
  fresh({ packs: [{ id: "pirates", ...PIRATES }] });
  assert.deepEqual(PACKS.map((p) => p.id), [...BUILT_IN_PACKS, "pirates"]);
  const p = packById("pirates");
  assert.deepEqual([p.custom, p.orb, p.palette, p.place, p.about], [true, undefined, "harbor", "the good ship Mae", "A ship and her hands."]);
  assert.deepEqual(crew.packsLeftOut(), []);

  crew.setPack("pirates");
  assert.deepEqual(crew.BUILT_IN.map((id) => [crew.CREW[id].name, crew.CREW[id].emoji]), [["Captain", "🦜"], ["Lookout", "🔭"], ["Chronicler", "📜"], ["Shipwright", "🪚"], ["Bosun", "⚓"]]);
  // The prompts use its names and its place, and none of the Guild's.
  assert.match(crew.identityBlock("scout"), /^You are the Lookout 🔭 of the good ship Mae\.$/m);
  assert.match(crew.identityBlock("artificer"), /open-ended research \(the Lookout\), planning \(the Captain\)/);
  assert.match(crew.identityBlock("scout"), /earlier names: the Quartermaster is the Captain, the Scout is the Lookout,/);
  assert.match(quartermasterSpec().persona, /Lookout/);
  // Its names and short handles find their owners, and so do every other pack's, after @ too.
  for (const [said, who] of [["Lookout", "scout"], ["@lookout", "scout"], ["spy", "scout"], ["Bosun", "warden"], ["@scout", "scout"], ["Navigator", "scout"], ["nav", "scout"], ["Fact Checker", "warden"], ["dev", "artificer"]])
    assert.equal(crew.findCrew(said)?.id, who, said);
  assert.equal(crew.mentionedCrew("@shipwright can you look at the build")?.id, "artificer");
  assert.equal(crew.currentName("Scout"), "Lookout");
  assert.equal(JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8")).pack, "pirates");

  // Read again (a restart): still there, still on.
  crew.loadCrew();
  assert.equal(crew.activePack().id, "pirates");
  assert.equal(crew.CREW.scout.name, "Lookout");
  // Under another pack its names still find who they meant; and the Guild's prompts are untouched.
  crew.setPack("starship");
  assert.equal(crew.findCrew("@lookout")?.id, "scout");
  assert.equal(crew.currentName("Lookout"), "Navigator");
  crew.setPack("guild");
  assert.equal(prompts(), asWritten);
  fresh();
  assert.deepEqual(PACKS.map((p) => p.id), BUILT_IN_PACKS);
});

test("a pack that can't be worn is left out with a reason, and never stops the camp or the packs beside it", () => {
  const said = logged(() => fresh({ packs: [
    pirates({ scribe: "Navigator" }, { id: "mutiny", name: "Mutiny" }),   // Starship's name for the Scout
    { id: "pirates", ...PIRATES },
    { name: "Half", crew: { scout: { name: "Rover" } } },                // four of the five have no name
    "not a pack at all",
  ] }));
  assert.deepEqual(PACKS.map((p) => p.id), [...BUILT_IN_PACKS, "pirates"], "the good one is there");
  assert.deepEqual(crew.packsLeftOut(), [
    { id: "mutiny", why: `The Scribe can't be called "Navigator": the Starship pack calls the Scout Navigator.` },
    { id: "Half", why: "The Quartermaster needs a name in this pack." },
    { id: "(no name)", why: "Give the pack a name." },
  ]);
  assert.equal(said.filter((l) => /camp\/packs\.json: the pack "mutiny" was left out\. The Scribe can't be called "Navigator"/.test(l)).length, 1, "logged, once");
  assert.equal(said.filter((l) => /was left out/.test(l)).length, 3);
  assert.equal(logged(() => crew.loadCrew()).filter((l) => /was left out/.test(l)).length, 0, "and not again on every reload");
  // A pack the settings name that was left out: the camp wears the Guild's.
  writeFileSync(settings.SETTINGS_PATH, JSON.stringify({ ...JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8")), pack: "mutiny" }));
  crew.loadCrew();
  assert.equal(crew.activePack().id, "guild");
  assert.equal(prompts(), asWritten);
  // Saving another pack keeps what you wrote by hand, to be fixed, rather than deleting it.
  crew.addPack(pirates({ quartermaster: "Skipper", scout: "Spotter", scribe: "Purser", artificer: "Carpenter", warden: "Gunner" }, { name: "Second Ship" }));
  assert.deepEqual(packsFile().packs.map((p) => p?.id ?? p?.name ?? p), ["pirates", "second-ship", "mutiny", "Half", "not a pack at all"]);
  assert.equal(packsFile().packs[0].custom, undefined, "the file says nothing the camp works out itself");

  // A file that isn't JSON, or isn't the shape: no packs of your own, and the camp still starts.
  for (const broken of ["{ packs: [", JSON.stringify({ packs: "pirates" }), JSON.stringify([1, 2])]) {
    fresh(broken);
    assert.deepEqual(PACKS.map((p) => p.id), BUILT_IN_PACKS, broken);
    assert.equal(prompts(), asWritten);
  }
  fresh();
});

test("what's wrong with a pack is said in words you can act on: names, clashes and ids", () => {
  fresh();
  crew.addMember({ name: "Cartographer", role: "Maps: draws them." });
  const refused = (input: object, why: RegExp | string) => assert.throws(() => crew.addPack(input), (e: Error) => (typeof why === "string" ? e.message === why : why.test(e.message)) || assert.fail(`said: ${e.message}`));

  // Every one of the five needs a name, and one that can be typed after @.
  refused({ ...PIRATES, crew: { ...PIRATES.crew, warden: { name: "  ", emoji: "⚓" } } }, "The Warden needs a name in this pack.");
  refused({ ...PIRATES, crew: { quartermaster: PIRATES.crew.quartermaster } }, "The Scout needs a name in this pack.");
  refused(pirates({ scout: "7 of 9" }), /^The Scout can't be called "7 of 9": a name starts with a letter/);
  refused({ ...PIRATES, name: "" }, "Give the pack a name.");
  // In the same pack: as written, run together, or by a short handle.
  refused(pirates({ scribe: "Lookout" }), `The Scribe can't be called "Lookout": the Scout is called Lookout in this pack.`);
  refused(pirates({ scribe: "Look-Out" }), `The Scribe can't be called "Look-Out": the Scout is called Lookout in this pack.`);
  refused(pirates({ scribe: { name: "Chronicler", short: ["spy"] } }), "The Scribe can't answer to @spy: the Scout is called Lookout in this pack.");
  refused(pirates({ scribe: "Spy" }), `The Scribe can't be called "Spy": the Scout is called Lookout in this pack.`);
  // With a pack the camp comes with, when it's a different crew member's name there.
  refused(pirates({ scribe: "Navigator" }), `The Scribe can't be called "Navigator": the Starship pack calls the Scout Navigator.`);
  refused(pirates({ scribe: "security chief" }), `The Scribe can't be called "security chief": the Starship pack calls the Warden Security Chief.`);
  refused(pirates({ scribe: "SecurityChief" }), /^The Scribe can't be called "SecurityChief": the Starship pack calls the Warden Security Chief\.$/);
  refused(pirates({ scribe: { name: "Chronicler", short: ["nav"] } }), "The Scribe can't answer to @nav: the Starship pack calls the Scout Navigator.");
  refused(pirates({ artificer: "Scout" }), `The Artificer can't be called "Scout": @scout already finds the Scout.`);
  refused(pirates({ scout: "Dev" }), `The Scout can't be called "Dev": @dev already finds the Artificer.`);
  refused(pirates({ scout: "Everyone" }), `The Scout can't be called "Everyone": @everyone is reserved.`);
  // With someone you added: theirs wins, as it does when a pack the camp comes with wants the name.
  refused(pirates({ scout: "Cartographer" }), `The Scout can't be called "Cartographer": you have a crew member called Cartographer (@cartographer), and they keep the name.`);
  refused({ ...PIRATES, extras: { scout: { name: "Rover" } } }, /one of the camp's own five: their name goes under "crew", not "extras"/);
  refused({ ...PIRATES, extras: { "the wizard": { name: "Sea Witch" } } }, /^"the wizard" isn't a crew member's handle/);
  // Ids: lowercase letters, digits and dashes, and never one the camp comes with.
  refused({ ...PIRATES, id: "Pirate Ship!" }, `A pack's id is lowercase letters, digits and dashes, 30 at most, like "pirate-ship". "Pirate Ship!" isn't.`);
  refused({ ...PIRATES, id: "-pirates" }, /lowercase letters, digits and dashes/);
  refused({ ...PIRATES, id: "starship" }, `"starship" is one of the packs the camp comes with. Give yours another id.`);
  refused({ ...PIRATES, name: "Starship" }, "There's already a pack called Starship. Give yours another name.");
  refused({ ...PIRATES, name: "!!!" }, /Give the pack a name with a letter or a digit in it/);
  // The five words and the colours.
  refused({ ...PIRATES, words: { ...PIRATES.words, quest: " " } }, "Say what this pack calls a quest.");
  refused({ ...PIRATES, words: undefined }, "Say what this pack calls the crew.");
  refused({ ...PIRATES, palette: "neon" }, `"neon" isn't one of the colours a pack can suggest: camp, harbor, moss, heather, ochre.`);
  assert.deepEqual(PACKS.map((p) => p.id), BUILT_IN_PACKS, "nothing that was refused was kept");
  assert.equal(existsSync(crew.PACKS_PATH), false);

  // What is fine: the id comes from the name; the same crew member can have the name another pack
  // gives them (so a pack started from Starship saves as it is); and what's left out is filled in.
  const starship = packById("starship");
  const mine = crew.addPack({ name: "Pirate Ship 2", crew: { ...PIRATES.crew, scout: starship.crew.scout }, extras: starship.extras, words: PIRATES.words });
  assert.deepEqual([mine.id, mine.about, mine.place, mine.palette, mine.custom, mine.crew.scout.name, mine.crew.scout.short, mine.extras?.wizard?.name],
    ["pirate-ship-2", "A pack of your own.", "the Mae ship", undefined, true, "Navigator", ["nav"], "Test Pilot"]);
  refused({ ...PIRATES, name: "pirate ship 2" }, "There's already a pack called Pirate Ship 2. Give yours another name.");
  refused({ ...PIRATES, id: "pirate-ship-2" }, `There's already a pack with the id "pirate-ship-2". Give this one another id.`);
  refused(pirates({ scribe: "Navigator" }), /the Starship pack calls the Scout Navigator/); // the pack the camp comes with is named, being first
  // Read from the file, a pack that wants the name of someone you added is the one left out.
  writeFileSync(crew.PACKS_PATH, JSON.stringify({ packs: [{ ...pirates({ scout: "Cartographer" }), id: "pirates" }] }));
  logged(() => crew.loadCrew());
  assert.deepEqual(crew.packsLeftOut().map((p) => p.why), [`The Scout can't be called "Cartographer": you have a crew member called Cartographer (@cartographer), and they keep the name.`]);
  assert.equal(crew.findCrew("Cartographer")?.id, "cartographer");
  // And adding a crew member can't take a name a pack of yours gives.
  fresh({ packs: [{ id: "pirates", ...PIRATES }] });
  assert.throws(() => crew.addMember({ name: "Lookout", role: "Looks out." }), /already a crew member/);
  // A dozen is the most.
  fresh();
  const letter = (i: number) => String.fromCharCode(97 + i).repeat(3);
  for (let i = 0; i < 12; i++) crew.addPack({ name: `Fleet ${i}`, words: PIRATES.words, crew: Object.fromEntries(crew.BUILT_IN.map((id) => [id, { name: `${id.slice(0, 5)} ${letter(i)}` }])) });
  refused(pirates({}, { name: "One Too Many" }), "That's 12 packs of your own already. Delete one first.");
  fresh();
});

test("changing or deleting a pack of yours: its old names go on finding who they meant, and deleting the one that's on goes back to the Guild", () => {
  fresh();
  assert.equal(crew.addPack(PIRATES).id, "pirates");
  assert.equal(crew.activePack().id, "guild", "making a pack doesn't put it on");
  crew.setPack("pirates");

  // The packs the camp comes with can't be changed or deleted.
  assert.throws(() => crew.updatePack("starship", PIRATES), /part of its code and can't be changed here\. Start a new pack from it instead\./);
  assert.throws(() => crew.updatePack("nope", PIRATES), /No theme pack called "nope"\./);
  assert.equal(crew.removePack("starship"), false);
  assert.equal(crew.removePack("nope"), false);

  // Changed while it's on: the crew is renamed at once, the id stays, and the old name still works.
  const changed = crew.updatePack("pirates", pirates({ scout: "Spotter" }, { name: "Corsairs", id: "something-else" }));
  assert.deepEqual([changed.id, changed.name, crew.activePack().name, crew.CREW.scout.name], ["pirates", "Corsairs", "Corsairs", "Spotter"]);
  assert.match(crew.identityBlock("scout"), /^You are the Spotter 🔭 of the good ship Mae\.$/m);
  assert.equal(crew.findCrew("@lookout")?.id, "scout");
  assert.equal(crew.currentName("Lookout"), "Spotter");
  assert.deepEqual(packsFile().retired, { scout: ["Lookout", "spy"] });
  assert.equal(packsFile().packs[0].crew.scout.name, "Spotter");
  // A change that's refused changes nothing.
  assert.throws(() => crew.updatePack("pirates", pirates({ scout: "Engineer" })), /can't be called "Engineer": @engineer already finds the Artificer/);
  assert.equal(crew.CREW.scout.name, "Spotter");

  // Deleted while it's on: the camp goes back to the Guild, prompts and all.
  assert.equal(crew.removePack("pirates"), true);
  assert.equal(crew.activePack().id, "guild");
  assert.equal(JSON.parse(readFileSync(settings.SETTINGS_PATH, "utf8")).pack, undefined);
  assert.deepEqual(PACKS.map((p) => p.id), BUILT_IN_PACKS);
  assert.equal(prompts(), asWritten);
  for (const [said, who] of [["Spotter", "scout"], ["@lookout", "scout"], ["Captain", "quartermaster"], ["Bosun", "warden"]]) assert.equal(crew.findCrew(said)?.id, who, said);
  assert.equal(crew.currentName("Captain"), "Quartermaster");
  crew.loadCrew(); // and after a restart
  assert.equal(crew.findCrew("@bosun")?.id, "warden");
  assert.deepEqual(packsFile().packs, []);

  // An old name is only kept until somebody is given it: a new pack, or someone you add, can take it.
  crew.addPack(pirates({ scout: "Rover", scribe: "Lookout", quartermaster: "Admiral", artificer: "Rigger", warden: "Gunner" }, { name: "Second Ship" }));
  assert.equal(crew.findCrew("Lookout")?.id, "scribe");
  assert.equal(packsFile().retired?.scout?.includes("Lookout"), false);
  assert.equal(crew.addMember({ name: "Bosun", role: "Keeps the deck." }).id, "bosun");
  assert.equal(crew.findCrew("Bosun")?.id, "bosun");
  assert.equal(crew.findCrew("Captain")?.id, "quartermaster", "the rest are still kept");
  fresh();
  rmSync(crew.PACKS_PATH, { force: true });
});

// ---------- The server: /api/state says which pack is on, and POST /api/pack changes it ----------
const freePort = () => new Promise<number>((ok) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); });
});

test("the page reads the pack from /api/state and sets it with POST /api/pack", async () => {
  crew.setPack("guild");
  writeFileSync(crew.CREW_PATH, JSON.stringify({ crew: [{ name: "Wizard", emoji: "🧙", role: "Hackathon work.", persona: "You are the Wizard." }] }));
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "server.ts")], {
    cwd: camp, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CAMP_PORT: String(port), CAMP_RUNTIME: "api", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
  });
  started.push(child);
  let out = "";
  const code = await new Promise<string>((ok, no) => {
    const giveUp = setTimeout(() => no(new Error(`the camp didn't start:\n${out}`)), 30_000);
    const look = (d: Buffer) => { out += d; const m = out.match(/\/#k=([0-9a-f]+)/); if (m) { clearTimeout(giveUp); ok(m[1]); } };
    child.stdout!.on("data", look);
    child.stderr!.on("data", (d) => (out += d));
  });
  const at = `http://127.0.0.1:${port}`;
  const { token } = (await (await fetch(`${at}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })).json()) as { token: string };
  const state = async () => (await (await fetch(`${at}/api/state`, { headers: { "x-camp-token": token } })).json()) as any;
  const post = (body: unknown) => fetch(`${at}/api/pack`, { method: "POST", headers: { "content-type": "application/json", "x-camp-token": token }, body: JSON.stringify(body) });

  const before = await state();
  assert.equal(before.pack, "guild");
  assert.deepEqual(before.packs.map((p: any) => p.id), ["guild", "starship", "newsroom", "studio", "lab", "pirate"]);
  assert.equal(before.characters.find((c: any) => c.id === "scout").name, "Scout");
  const wizard = (s: any) => { const c = s.characters.find((c: any) => c.id === "wizard"); return [c.name, c.emoji, c.own, c.persona, c.aliases]; };
  assert.deepEqual(wizard(before), ["Wizard", "🧙", undefined, "You are the Wizard.", []]);

  const set = await post({ id: "starship" });
  assert.equal(set.status, 200);
  assert.deepEqual(await set.json(), { ok: true, pack: "starship" });
  const now = await state();
  assert.equal(now.pack, "starship");
  assert.deepEqual(now.characters.slice(0, 5).map((c: any) => [c.id, c.name]), [["quartermaster", "Commander"], ["scout", "Navigator"], ["scribe", "Comms Officer"], ["artificer", "Engineer"], ["warden", "Security Chief"]]);
  assert.equal(JSON.parse(readFileSync(join(camp, settings.SETTINGS_PATH), "utf8")).pack, "starship");
  // Someone you added that the pack renames: what they're called now, and (for the dialog) what you wrote.
  assert.deepEqual(wizard(now), ["Test Pilot", "🛸", { name: "Wizard", emoji: "🧙" }, "You are the Wizard.", []]);

  const bad = await post({ id: "pirates" });
  assert.notEqual(bad.status, 200);
  assert.equal((await state()).pack, "starship");
  assert.ok(existsSync(join(camp, settings.SETTINGS_PATH)));
  child.kill("SIGKILL");
});

// A camp started on this sandbox, signed in: where it is, and how to read its state and post to it.
async function startCamp() {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "server.ts")], {
    cwd: camp, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CAMP_PORT: String(port), CAMP_RUNTIME: "api", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
  });
  started.push(child);
  let out = "";
  const code = await new Promise<string>((ok, no) => {
    const giveUp = setTimeout(() => no(new Error(`the camp didn't start:\n${out}`)), 30_000);
    const look = (d: Buffer) => { out += d; const m = out.match(/\/#k=([0-9a-f]+)/); if (m) { clearTimeout(giveUp); ok(m[1]); } };
    child.stdout!.on("data", look);
    child.stderr!.on("data", (d) => (out += d));
  });
  const at = `http://127.0.0.1:${port}`;
  const { token } = (await (await fetch(`${at}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })).json()) as { token: string };
  const state = async () => (await (await fetch(`${at}/api/state`, { headers: { "x-camp-token": token } })).json()) as any;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${at}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-camp-token": token }, body: JSON.stringify(body) });
    return [r.status, await r.json()] as [number, any];
  };
  const stop = () => new Promise<void>((ok) => { child.once("exit", () => ok()); child.kill("SIGKILL"); });
  return { state, post, stop, said: () => out };
}

test("POST /api/packs makes, changes and deletes a pack of your own, and it's still there after a restart", async () => {
  writeFileSync(settings.SETTINGS_PATH, JSON.stringify({}));
  writeFileSync(crew.CREW_PATH, JSON.stringify({ crew: [{ name: "Wizard", emoji: "🧙", role: "Hackathon work.", persona: "You are the Wizard." }] }));
  // One written by hand that can't be worn: the page is told why, in /api/state.
  writeFileSync(crew.PACKS_PATH, JSON.stringify({ packs: [{ ...pirates({ scribe: "Navigator" }), id: "mutiny", name: "Mutiny" }] }));
  let c = await startCamp();
  const names = (s: any) => s.characters.slice(0, 5).map((x: any) => x.name);

  const before = await c.state();
  assert.deepEqual([before.pack, before.packs.map((p: any) => p.id)], ["guild", BUILT_IN_PACKS]);
  assert.deepEqual(before.packsLeftOut, [{ id: "mutiny", why: `The Scribe can't be called "Navigator": the Starship pack calls the Scout Navigator.` }]);
  assert.match(c.said(), /camp\/packs\.json: the pack "mutiny" was left out\./);

  // Made: it's listed after the camp's own, marked as yours, and not put on.
  assert.deepEqual(await c.post("/api/packs", { action: "add", pack: { ...PIRATES, extras: { wizard: { name: "Sea Witch", emoji: "🌊" } } } }), [200, { ok: true, id: "pirates", pack: "guild" }]);
  let s = await c.state();
  assert.deepEqual(s.packs.map((p: any) => [p.id, !!p.custom, !!p.orb]), [...BUILT_IN_PACKS.map((id) => [id, false, id !== "guild"]), ["pirates", true, false]]);
  assert.deepEqual([s.pack, names(s)], ["guild", ["Quartermaster", "Scout", "Scribe", "Artificer", "Warden"]]);
  // Refused with the reason, and nothing changes.
  assert.deepEqual(await c.post("/api/packs", { action: "add", pack: { ...pirates({ scribe: "Engineer" }), name: "Second Ship" } }),
    [400, { error: `The Scribe can't be called "Engineer": @engineer already finds the Artificer.` }]);
  assert.deepEqual(await c.post("/api/packs", { action: "add", pack: PIRATES }), [400, { error: "There's already a pack called Pirates. Give yours another name." }]);
  assert.deepEqual(await c.post("/api/packs", { action: "rename", id: "pirates" }), [400, { error: "Unknown action" }]);
  assert.deepEqual(await c.post("/api/packs", { action: "update", id: "starship", pack: PIRATES }).then(([code]) => code), 400);
  assert.deepEqual(await c.post("/api/packs", { action: "remove", id: "starship" }).then(([code]) => code), 404);
  assert.equal((await c.state()).packs.length, 7);

  // Put on like any pack: the crew bar's names, and the Wizard's too.
  assert.deepEqual(await c.post("/api/pack", { id: "pirates" }), [200, { ok: true, pack: "pirates" }]);
  s = await c.state();
  assert.deepEqual([s.pack, names(s)], ["pirates", ["Captain", "Lookout", "Chronicler", "Shipwright", "Bosun"]]);
  const wizard = (st: any) => { const w = st.characters.find((x: any) => x.id === "wizard"); return [w.name, w.emoji, w.own]; };
  assert.deepEqual(wizard(s), ["Sea Witch", "🌊", { name: "Wizard", emoji: "🧙" }]);

  // Changed while it's on: renamed at once, and the name it gave before is kept for history.
  assert.deepEqual(await c.post("/api/packs", { action: "update", id: "pirates", pack: { ...pirates({ scout: "Spotter" }), name: "Corsairs" } }), [200, { ok: true, id: "pirates", pack: "pirates" }]);
  s = await c.state();
  assert.deepEqual([s.packs.at(-1).name, names(s)[1], s.packNamesBefore.scout], ["Corsairs", "Spotter", ["Lookout", "spy"]]);
  assert.deepEqual(s.packNamesBefore.wizard, ["Sea Witch"]);

  // A restart: the pack, that it's on, and the names it gave before are all read back.
  await c.stop();
  c = await startCamp();
  s = await c.state();
  assert.deepEqual([s.pack, s.packs.at(-1).id, s.packs.at(-1).name, names(s)], ["pirates", "pirates", "Corsairs", ["Captain", "Spotter", "Chronicler", "Shipwright", "Bosun"]]);
  assert.deepEqual(s.packNamesBefore.scout, ["Lookout", "spy"]);
  assert.equal(s.packsLeftOut.length, 1, "the one that couldn't be worn is still in the file, to be fixed");

  // Deleted while it's on: the camp is back in the Guild's names.
  assert.deepEqual(await c.post("/api/packs", { action: "remove", id: "pirates" }), [200, { ok: true, id: "pirates", pack: "guild" }]);
  s = await c.state();
  assert.deepEqual([s.pack, s.packs.map((p: any) => p.id), names(s)], ["guild", BUILT_IN_PACKS, ["Quartermaster", "Scout", "Scribe", "Artificer", "Warden"]]);
  assert.deepEqual(wizard(s), ["Wizard", "🧙", undefined]);
  assert.deepEqual([s.packNamesBefore.scout, s.packNamesBefore.quartermaster, s.packNamesBefore.wizard], [["Lookout", "spy", "Spotter"], ["Captain"], ["Sea Witch"]]);
  assert.deepEqual(await c.post("/api/packs", { action: "remove", id: "pirates" }).then(([code]) => code), 404);
  assert.deepEqual(await c.post("/api/pack", { id: "pirates" }).then(([code]) => code !== 200), true);
  await c.stop();
});
