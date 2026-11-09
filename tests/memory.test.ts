// Identity, per-agent memory and sessions, the wiki, skills, settings, schedules, and costs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("memory");
writeFileSync("camp/ledger.md", "- 2026-11-09 An old ledger lesson.\n");
const { identityBlock, findCrew } = await import("../src/crew.ts");
const { rememberTool, readMemory, recordSession, recentSessions, continuityBlock } = await import("../src/memory.ts");
const { wikiWrite, wikiIndex } = await import("../src/wiki.ts");
const { proposeSkill, pendingSkills, approveSkill, rejectSkill, skillCatalog } = await import("../src/forge.ts");
const { setAgentSettings, agentSettings, setBudgetUsd, budgetUsd } = await import("../src/settings.ts");
const { resolveModel } = await import("../src/agent.ts");
const { parseSchedule, isDue } = await import("../src/jobs.ts");
const { costOf } = await import("../src/costs.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

test("identity: fixed, with the whole crew and clear boundaries", () => {
  const block = identityBlock("scribe");
  assert.match(block, /You are the Scribe/);
  assert.match(block, /Scribe \(you\)/);
  for (const name of ["Quartermaster", "Scout", "Artificer"]) assert.match(block, new RegExp(name));
  assert.match(block, /ONE polite line naming the\s+right teammate/);
});

test("aliases find the right crew member", () => {
  assert.equal(findCrew("writer")?.id, "scribe");
  assert.equal(findCrew("dev")?.id, "artificer");
  assert.equal(findCrew("@Scout")?.id, "scout");
  assert.equal(findCrew("bard"), undefined);
});

test("memory: each agent's own; the old ledger becomes the Quartermaster's", async () => {
  assert.match(readMemory("quartermaster"), /old ledger lesson/);
  assert.ok(existsSync("camp/ledger.md.migrated"));
  await rememberTool("scribe").run!({ entry: "User likes a TL;DR first." });
  assert.match(readMemory("scribe"), /TL;DR/);
  assert.doesNotMatch(readMemory("scout"), /TL;DR/);
});

test("sessions: recorded per agent and carried into the next prompt", () => {
  recordSession("scout", { source: "direct", task: "Find the release date", result: "It's March 3.", status: "done", messages: [] });
  assert.equal(recentSessions("scout").length, 1);
  assert.equal(recentSessions("scribe").length, 0);
  const block = continuityBlock("scout");
  assert.match(block, /Find the release date/);
  assert.match(block, /March 3/);
});

test("wiki: notes need sources; only facts-writers can write facts", async () => {
  assert.match(String(await wikiWrite(["notes"]).run!({ section: "facts", page: "x", summary: "s", content: "c" })), /can't write/);
  assert.match(String(await wikiWrite(["notes"]).run!({ section: "notes", page: "x", summary: "s", content: "c" })), /need sources/);
  await wikiWrite(["notes"]).run!({ section: "notes", page: "harness-memory", summary: "How harnesses remember", content: "Files and DBs.", sources: ["https://example.com"] });
  assert.match(wikiIndex(), /harness-memory\.md: How harnesses remember/);
});

test("skills: proposals wait for approval", async () => {
  await proposeSkill.run!({ owner: "scout", name: "narrow-searches", description: "When research is broad.", instructions: "Split it.", reason: "Budget ran out." });
  await proposeSkill.run!({ owner: "scribe", name: "bad-idea", description: "No.", instructions: "No.", reason: "Test." });
  assert.equal(pendingSkills().length, 2);
  assert.doesNotMatch(skillCatalog(), /narrow-searches/);
  assert.ok(approveSkill("scout", "narrow-searches"));
  assert.ok(rejectSkill("scribe", "bad-idea"));
  assert.match(skillCatalog(), /scout\/narrow-searches/);
  assert.doesNotMatch(readFileSync("skills/scout/narrow-searches/SKILL.md", "utf8"), /reason:/);
});

test("settings: per-agent model and effort override the defaults; budget saves", () => {
  assert.equal(resolveModel({ id: "scout", effort: "medium" }).model, "claude-sonnet-5-5");
  setAgentSettings("scout", { model: "claude-haiku-5-5", effort: "low" });
  assert.deepEqual(resolveModel({ id: "scout", effort: "medium" }), { model: "claude-haiku-5-5", effort: "low" });
  setAgentSettings("scout", { model: null, effort: null });
  assert.deepEqual(agentSettings("scout"), {});
  setBudgetUsd(2.5);
  assert.equal(budgetUsd(), 2.5);
  setBudgetUsd(null);
  assert.equal(budgetUsd(), undefined);
});

test("schedules: parsing and when jobs are due", () => {
  assert.deepEqual(parseSchedule("every 30m"), { kind: "every", ms: 1_800_000 });
  assert.equal(parseSchedule("every 1m"), null, "nothing more often than 5 minutes");
  assert.equal(parseSchedule("daily 25:00"), null);
  const job = (schedule: string, created: string, lastRun?: string) => ({
    name: "t", schedule, task: "x", enabled: true, created: new Date(created).toISOString(), ...(lastRun ? { lastRun: new Date(lastRun).toISOString() } : {}),
  });
  assert.equal(isDue(job("daily 08:00", "2026-11-09T09:00"), new Date("2026-11-09T12:00")), false, "a new job waits for its first slot");
  assert.equal(isDue(job("daily 08:00", "2026-11-09T09:00"), new Date("2026-11-10T08:00")), true);
  assert.equal(isDue(job("weekdays 08:00", "2026-11-01T00:00", "2026-11-13T08:00"), new Date("2026-11-14T09:00")), false, "Saturday");
  assert.equal(isDue(job("weekdays 08:00", "2026-11-01T00:00", "2026-11-13T08:00"), new Date("2026-11-16T08:01")), true, "Monday");
});

test("costs: from token usage and model prices", () => {
  const u = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 };
  assert.equal(costOf("claude-sonnet-5-5", u), 2 + 1);
  assert.equal(costOf("claude-opus-5-5", u), 4 + 2);
  assert.equal(costOf("claude-haiku-4-5-20251001", u), 1 + 0.5, "dated ids use their family's price");
  assert.equal(costOf("claude-unknown-9", u), 0);
});
