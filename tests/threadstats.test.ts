// A conversation's Status tab: its runs' figures, matched up from the quest log and its turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { contextOf, setupOf, threadStats } from "../src/threadstats.ts";

enterSandbox("threadstats");

test("the context splits into what the run was asked, said, called and got back", () => {
  const c = contextOf([
    { role: "user", content: "x".repeat(400) },
    { role: "assistant", content: [{ type: "text", text: "y".repeat(40) }, { type: "tool_use", id: "t1", name: "mcp__camp__read_file", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "z".repeat(800) }] },
    { role: "user", content: "w".repeat(40) },
  ]);
  const by = Object.fromEntries(c.parts.map((p) => [p.key, p.tokens]));
  assert.equal(by.request, 100);
  assert.equal(by.you, 10);
  assert.ok(by.results >= 200);
  assert.deepEqual(c.heaviest.map((h) => h.name), ["read_file"]);
  assert.equal(setupOf(10_000, 4_000), 8_000);
  assert.equal(setupOf(1_000, 4_000), 0);
});

test("a run's lead line, tagged or from before tags, and its quests add up", () => {
  mkdirSync("camp/agents/quartermaster/sessions", { recursive: true });
  writeFileSync("camp/agents/quartermaster/sessions/s.json", JSON.stringify({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use", id: "a", name: "grep", input: {} }] }] }));
  const u = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
  const turns = [
    { thread: "T", expedition: "T", agent: "quartermaster", direct: false, time: "2026-01-01T10:00:00.000Z", task: "old one", reply: "", status: "done" },
    { thread: "T", expedition: "R2", agent: "quartermaster", direct: false, time: "2026-01-01T11:00:00.000Z", task: "new one", reply: "", status: "done" },
  ];
  const log = [
    { time: "2026-01-01T10:00:00.100Z", kind: "expedition", character: "Quartermaster", task: "old one", result: "", status: "done", model: "claude-sonnet-5-5", turns: 1, seconds: 5, usage: u },
    { time: "2026-01-01T11:00:00.000Z", kind: "quest", character: "Scout", expedition: "R2", task: "look", result: "", status: "done", model: "claude-haiku-5-5", turns: 2, seconds: 7, usage: u },
    { time: "2026-01-01T11:00:00.000Z", kind: "expedition", character: "Quartermaster", expedition: "R2", task: "new one", result: "", status: "done", model: "claude-sonnet-5-5", turns: 2, seconds: 9, usage: u, session: "camp/agents/quartermaster/sessions/s.json" },
    { time: "2026-01-01T11:00:00.000Z", kind: "expedition", character: "Quartermaster", expedition: "ELSE", task: "new one", result: "", status: "done", model: "claude-sonnet-5-5", turns: 2, seconds: 9, usage: u },
  ];
  writeFileSync("camp/threads.jsonl", turns.map((t) => JSON.stringify(t)).join("\n") + "\n");
  writeFileSync("camp/quest-log.jsonl", log.map((q) => JSON.stringify(q)).join("\n") + "\n");
  const s = threadStats("T");
  assert.equal(s.total.runs, 2);
  assert.equal(s.total.quests, 1);
  assert.equal(s.total.turns, 5);
  assert.equal(s.total.seconds, 14);
  assert.equal(s.total.usage.input, 300);
  assert.equal(s.crew.length, 2);
  assert.deepEqual(s.tools, [{ name: "grep", calls: 1 }]);
  assert.equal(s.context?.run, "R2");
});
