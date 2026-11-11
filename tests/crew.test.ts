// Crew members you add: they join the roster with the abilities you gave them, the
// Quartermaster can send them, you can message them directly, and they persist in camp/crew.json.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi } from "./helpers/fake-api.ts";

enterSandbox("crew");
let script: (body: any) => any = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url;
process.env.CAMP_APPROVE_PLANS = "0";

const crew = await import("../src/crew.ts");
const { ROSTER } = await import("../src/roster.ts");
const { runDirect, runExpedition, quartermasterSpec } = await import("../src/quartermaster.ts");
const { readMemory } = await import("../src/memory.ts");
const { proposeSkill } = await import("../src/forge.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

const toolNames = (id: string) => ROSTER[id].tools.map((t) => ("name" in t.def ? t.def.name : "")).sort();

test("a new crew member joins the crew and the roster, with the abilities you ticked", () => {
  const m = crew.addMember({
    name: "  Test Pilot ", emoji: "🧪", role: "Testing: writes and runs tests, and reports what fails and why.",
    persona: "Reproduce first. Never say a test passed without running it.", abilities: { write: "project", shell: true, bogus: true }, color: "rose", aliases: "qa, tester",
  });
  assert.deepEqual([m.id, m.name, m.color, m.custom], ["testpilot", "Test Pilot", "rose", true]);
  assert.deepEqual(m.abilities, { write: "project", shell: true });
  assert.deepEqual(crew.CREW_IDS, ["quartermaster", "scout", "scribe", "artificer", "testpilot"]);
  assert.equal(crew.findCrew("@testpilot")?.id, "testpilot");
  assert.equal(crew.findCrew("QA")?.id, "testpilot", "aliases work");
  assert.deepEqual(toolNames("testpilot"), ["bash", "edit_file", "git", "glob", "grep", "jira", "list_dir", "outline", "read_file", "remember", "view_file", "write_file"]);
  assert.match(ROSTER.testpilot.persona, /Reproduce first[\s\S]*Quest rules:/);
  assert.deepEqual(ROSTER.testpilot.skillDirs, ["skills/shared", "skills/testpilot"]);
  // The rest of the camp knows about them straight away.
  assert.match(crew.identityBlock("scout"), /- 🧪 Test Pilot: Testing: writes and runs tests/);
  const dispatch = quartermasterSpec().tools.find((t) => "name" in t.def && t.def.name === "dispatch")!.def as any;
  assert.ok(dispatch.input_schema.properties.adventurer.enum.includes("testpilot"));
  assert.match(dispatch.description, /- testpilot \(🧪 Test Pilot\): Testing:/);
  assert.ok((proposeSkill.def as any).input_schema.properties.owner.enum.includes("testpilot"), "skills can be proposed for them");
  assert.deepEqual(JSON.parse(readFileSync(crew.CREW_PATH, "utf8")).crew.map((c: any) => c.id), ["testpilot"]);
});

test("abilities decide the kit: a reader with the web keeps to its own outputs folder", () => {
  crew.addMember({ name: "Librarian", role: "Finds and summarizes documents.", abilities: { web: true, write: "outputs", wiki: true } });
  assert.deepEqual(toolNames("librarian"), ["git", "glob", "grep", "jira", "list_dir", "outline", "read_file", "remember", "view_file", "web_fetch", "web_search", "wiki_write", "write_file"]);
  assert.match((ROSTER.librarian.tools.find((t) => "name" in t.def && t.def.name === "write_file")!.def as any).description, /You can't write anywhere else/);
  crew.addMember({ name: "Reader", role: "Reads things." });
  assert.deepEqual(toolNames("reader"), ["git", "glob", "grep", "jira", "list_dir", "outline", "read_file", "remember", "view_file"], "no abilities: read, search (git history and Jira tickets too), remember");
});

test("you can message them directly and the Quartermaster can send them", async () => {
  const seen: any[] = [];
  script = (b) => {
    seen.push(b);
    if (b.system[0].text.includes("You are the Test Pilot")) return { text: "REPORT: 3 tests, all pass." };
    const sent = JSON.stringify(b.messages).includes("Test Pilot's report");
    return sent ? { text: "The Test Pilot says all three pass." } : { tools: [{ name: "dispatch", input: { adventurer: "testpilot", brief: "Run the tests in src/." } }] };
  };
  const direct = await runDirect("testpilot", "Do the tests pass?");
  assert.equal(direct?.text, "REPORT: 3 tests, all pass.");
  assert.match(seen[0].system[0].text, /You are the Test Pilot 🧪[\s\S]*Role: Testing: writes and runs tests/);
  assert.match(seen[0].system[0].text, /Reproduce first\. Never say a test passed without running it\./);
  assert.ok(existsSync("camp/agents/testpilot/memory.md"), "they get their own workspace");
  assert.equal(readMemory("testpilot"), "(empty)");
  const r = await runExpedition("Check the tests");
  assert.equal(r.text, "The Test Pilot says all three pass.");
});

test("names and handles can't collide, and the original four can't be changed or removed", () => {
  assert.throws(() => crew.addMember({ name: "Scout", role: "x" }), /already a crew member/);
  assert.throws(() => crew.addMember({ name: "Research", role: "x" }), /already a crew member/, "an existing alias");
  assert.throws(() => crew.addMember({ name: "Other", id: "testpilot", role: "x" }), /already a crew member/);
  assert.throws(() => crew.addMember({ name: "X", role: "x" }), /2 to 20 letters/);
  assert.throws(() => crew.addMember({ name: "Nameless" }), /what they're for/);
  assert.throws(() => crew.addMember({ name: "Links", role: "x" }), /reserved/);
  assert.throws(() => crew.updateMember("scout", { name: "Sneak", role: "x" }), /can't be changed here/);
  assert.ok(!crew.removeMember("artificer"));
  assert.equal(crew.CREW.scout.name, "Scout");
});

test("changing, removing, and reloading", () => {
  const m = crew.updateMember("testpilot", { name: "Test Pilot", emoji: "🛩️", role: "Testing, now with flight checks.", abilities: { write: "outputs" }, id: "ignored" });
  assert.deepEqual([m.id, m.emoji, m.role], ["testpilot", "🛩️", "Testing, now with flight checks."]);
  assert.ok(!toolNames("testpilot").includes("bash"), "the kit follows the new abilities");
  assert.ok(crew.removeMember("reader"));
  assert.equal(ROSTER.reader, undefined);
  assert.equal(crew.findCrew("reader"), undefined);
  // Another process (the terminal camp, the watcher) reads the same file.
  crew.loadCrew();
  assert.deepEqual(crew.CREW_IDS, ["quartermaster", "scout", "scribe", "artificer", "testpilot", "librarian"]);
  assert.equal(ROSTER.testpilot.role, "Testing, now with flight checks.");
});
