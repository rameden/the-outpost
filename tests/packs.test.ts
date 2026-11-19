// Theme packs: the five the camp starts with can go by another set of names (and emoji), on the
// page and in their own prompts. Ids never change, every pack's names keep resolving, and with
// the Guild pack on the prompts are exactly what they were before packs existed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  assert.deepEqual(PACKS.map((p) => p.id), ["guild", "starship", "newsroom", "studio", "lab"]);
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
  assert.deepEqual(["@wizard", "Wizard", "hacker", "Test Pilot", "@pilot", "Stringer", "stunt", "Tinkerer"].map((n) => crew.findCrew(n)?.id), Array(8).fill("wizard"));
  assert.equal(crew.currentName("Wizard"), "Test Pilot");

  // What you wrote is what's kept: the file still says Wizard, whatever is saved while a pack is on.
  crew.addMember({ name: "Cook", role: "Feeds everyone." });
  assert.deepEqual(saved().map((c) => [c.id, c.name, c.emoji, c.aliases, c.persona]), [["wizard", "Wizard", "🧙", ["hacker"], mine.persona], ["cook", "Cook", "✦", [], saved()[1].persona]]);
  assert.deepEqual([crew.ownOf("wizard")?.name, crew.ownOf("cook")?.name, crew.CREW.cook.name], ["Wizard", "Cook", "Cook"]);
  crew.removeMember("cook");
  crew.loadCrew();
  assert.equal(crew.CREW.wizard.name, "Test Pilot", "read again from the file, they wear the pack again");

  // Each pack has its own name for them.
  assert.deepEqual(["newsroom", "studio", "lab", "guild"].map((id) => { crew.setPack(id); return `${crew.CREW.wizard.emoji} ${crew.CREW.wizard.name}`; }), ["⚡ Stringer", "🤸 Stunt Double", "⚗️ Tinkerer", "🧙 Wizard"]);
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
  assert.deepEqual(before.packs.map((p: any) => p.id), ["guild", "starship", "newsroom", "studio", "lab"]);
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
