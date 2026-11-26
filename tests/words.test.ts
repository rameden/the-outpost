// The theme pack's words reach what the crew are told, not only the page: the Quartermaster's
// persona, the tools' descriptions and the standing briefs say "voyage" and "officer" on the
// starship, and exactly what they always said in the Guild.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("words");

const crew = await import("../src/crew.ts");
const { ROSTER } = await import("../src/roster.ts");
const { quartermasterSpec, fixBrief, REVIEW_RULE } = await import("../src/quartermaster.ts");
const { spentOn } = await import("../src/payoff.ts");
const { say, w, a } = await import("../src/words.ts");
const { wrapUpNote, steerNote, rl } = await import("../src/tools.ts");

after(() => { crew.setPack("guild"); rl.close(); });

const tool = (spec: { tools: { def: any }[] }, name: string) => spec.tools.find((t) => t.def.name === name)!.def;
// A pack word left as a {token}: nothing filled it in.
const UNFILLED = /\{(an? )?(crew|quests?|camps?|expeditions?|members?|hq)\}/i;

test("in the Guild, the prompts say what they always said", () => {
  crew.setPack("guild");
  const qm = quartermasterSpec();
  assert.match(qm.persona, /send the right adventurers to carry it out/);
  assert.match(qm.persona, /Break the request into quests\./);
  assert.match(qm.persona, /so a fresh expedition can run/);
  assert.match(tool(qm, "dispatch").description, /^Send an adventurer on a quest and wait for their report\./);
  assert.match(tool(qm, "submit_plan").description, /each quest, who goes/);
  assert.equal(qm.role, "Runs the camp: plans expeditions, briefs the crew, and reports back.");
  assert.match(ROSTER.scout.persona, /\nQuest rules:\n[\s\S]*mid-quest[\s\S]*For a quest, finish with a REPORT/);
  assert.match(ROSTER.scout.persona, /the whole crew would want/);
  assert.match(crew.CREW.wizard.role, /^Takes the hardest quests:/);
  assert.match(ROSTER.wizard.persona, /^Take the hardest quests:/);
  assert.match(say(REVIEW_RULE), /If this expedition changed files[\s\S]*send one fix quest for those/);
  assert.match(fixBrief("✗ npm test"), /^The camp ran the project's own checks/);
  assert.match(wrapUpNote(3)!, /^\[Camp note: you have 3 turns left/);
  for (const text of [qm.persona, qm.role, ROSTER.scout.persona, tool(qm, "dispatch").description, say(REVIEW_RULE), crew.identityBlock("scout")]) assert.doesNotMatch(text, UNFILLED);
});

test("on the starship, they say voyage, mission, ship and officer", () => {
  crew.setPack("starship");
  try {
    assert.equal(w("quest"), "mission");
    assert.equal(a("expedition"), "a voyage");
    const qm = quartermasterSpec();
    assert.match(qm.persona, /voyage/);
    assert.match(qm.persona, /Break the request into missions\./);
    assert.match(qm.persona, /Officers know nothing except what you write/);
    assert.doesNotMatch(qm.persona, /\b(expeditions?|quests?|adventurers?)\b/i);
    assert.doesNotMatch(qm.persona, /\bthe camp\b/);
    assert.equal(qm.role, "Runs the ship: plans voyages, briefs the crew, and reports back.");
    const dispatch = tool(qm, "dispatch");
    assert.match(dispatch.description, /^Send an officer on a mission and wait for their report\./);
    assert.doesNotMatch(dispatch.description.split("\n\nRoster:")[0], /\b(quests?|adventurer)\b/i);
    assert.ok("adventurer" in dispatch.input_schema.properties, "the field keeps its name: only what's said changes");
    assert.match(dispatch.input_schema.properties.step.description, /this mission carries out/);
    assert.match(tool(qm, "submit_plan").description, /each mission, who goes/);
    for (const id of crew.BUILT_IN.filter((x) => x !== "quartermaster")) {
      assert.match(ROSTER[id].persona, /\nMission rules:\n[\s\S]*mid-mission[\s\S]*For a mission, finish with a REPORT/, id);
      assert.doesNotMatch(ROSTER[id].persona, /\bquests?\b/i, id);
      assert.doesNotMatch(ROSTER[id].persona, UNFILLED, id);
    }
    assert.match(say(REVIEW_RULE), /If this voyage changed files[\s\S]*send one fix mission for those/);
    assert.match(wrapUpNote(1)!, /^\[Ship note: this is your last turn/);
    assert.match(steerNote(["hi"]), /addressed to the whole voyage/);
    assert.match(crew.identityBlock("scout"), /## Your crew\n/);
    // Tool descriptions are read as they're sent, so a tool made before the pack changed follows it.
    const scoutWrite = tool(ROSTER.scout, "write_file").description;
    assert.match(scoutWrite, new RegExp(`hand project changes to the ${crew.CREW.artificer.name} or the ${crew.CREW.scribe.name}`));
    assert.doesNotMatch(scoutWrite, /Artificer|Scribe/);
    assert.match(tool(ROSTER.artificer, "write_file").description, /the ship's own code, and the rest of camp\/ are read-only/);
    assert.match(tool(ROSTER.scout, "remember").description, new RegExp(`YOUR memory \\(${crew.CREW.scout.name}\\)[\\s\\S]*the whole crew starts with it`));
    assert.match(tool(ROSTER.scout, "git").description, /the worktree your voyage works in/);
    assert.equal(JSON.parse(JSON.stringify(tool(ROSTER.scout, "git"))).description, tool(ROSTER.scout, "git").description, "it's there when the tool is sent as JSON");
  } finally { crew.setPack("guild"); }
});

test("in the newsroom, the sentences still read", () => {
  crew.setPack("newsroom");
  try {
    const qm = quartermasterSpec();
    assert.equal(qm.role, "Runs the newsroom: plans assignments, briefs the staff, and reports back.");
    assert.match(tool(qm, "dispatch").description, /^Send a staffer on a story and wait/);
    assert.match(qm.persona, /Break the request into stories\./);
    assert.match(ROSTER.scout.persona, /\nStory rules:\n/);
    assert.match(crew.identityBlock("scout"), /## Your staff\n/);
  } finally { crew.setPack("guild"); }
});

test("a fix brief is known for one whatever pack wrote it", () => {
  crew.setPack("guild");
  assert.equal(spentOn(fixBrief("✗ npm test")), "fixup");
  assert.equal(spentOn("@artificer " + fixBrief("✗ npm test")), "fixup");
  crew.setPack("starship");
  try {
    assert.match(fixBrief("✗ npm test"), /^The ship ran the project's own checks/);
    assert.equal(spentOn(fixBrief("✗ npm test")), "fixup");
  } finally { crew.setPack("guild"); }
  assert.equal(spentOn("The tests ran fine, now add a feature"), "work");
});

// Text the camp keeps (a notice in the feed) holds the pack's nouns as {tokens}: the page and the
// terminal fill them with the pack that's on when it's shown, not the one that was on when it was written.
test("a kept notice reads in whichever pack is on when it's shown", async () => {
  const { attachConsole, emit } = await import("../src/events.ts");
  const kept = "The {camp} was restarted while this {quest} was running.";
  crew.setPack("starship");
  try { assert.equal(say(kept), "The ship was restarted while this mission was running."); }
  finally { crew.setPack("guild"); }
  assert.equal(say(kept), "The camp was restarted while this quest was running.");
  // The terminal fills a notice as it prints it.
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => { printed.push(line); };
  try {
    attachConsole(() => ({ lead: "Quartermaster", back: "returns to camp", say }));
    crew.setPack("starship");
    emit({ type: "notice", text: kept, who: "Quartermaster", emoji: "🧭", depth: 0 });
  } finally { console.log = log; crew.setPack("guild"); }
  assert.ok(printed.some((l) => l.trim() === "The ship was restarted while this mission was running."), printed.join("\n"));
});
