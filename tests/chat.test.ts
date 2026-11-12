// A plain chat: outside any project, a message with no @ goes to a model and nobody else. No
// Quartermaster, no plan, no quests, no crew persona or memory; it can read, and it can't change anything.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, type Reply } from "./helpers/fake-api.ts";

enterSandbox("chat");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url;

const { runChat, runExpedition, CHAT } = await import("../src/quartermaster.ts");
const { threadFor } = await import("../src/threads.ts");
const { writeAbout } = await import("../src/memlog.ts");
const { appendMemory } = await import("../src/memory.ts");
const c = await import("../src/conversations.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });
let asked = 0;
setAsker(async () => { asked++; return "y"; });
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; asked = 0; });
const system = (i = 0) => api.seen[i].body.system.map((x: any) => x.text).join("\n");
const toolNames = (i = 0) => api.seen[i].body.tools.map((t: any) => t.name).sort();

test("it's the model and you: no crew, no plan, no memory of theirs; it can read and nothing else", async () => {
  writeAbout("- Keep answers short.");
  appendMemory("quartermaster", "A Quartermaster-only lesson", "you");
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/policy.md", "Deploy freezes start on the 15th.\n");
  script = (b) => (isFirstTurn(b) ? { tools: [{ name: "read_file", input: { path: "docs/policy.md" } }] } : { text: "Freezes start on the 15th." });
  const r = await runChat("When do deploy freezes start? It's in docs/policy.md", { id: "c1" });
  assert.equal(r.status, "done");
  assert.match(r.text, /15th/);
  assert.equal(r.model, "claude-sonnet-5-5", "the camp's default, when you haven't picked one");
  assert.equal(asked, 0, "no plan to approve, nothing to ask");

  // What the model is told: a plain assistant, the note about you, and none of the crew's world.
  assert.match(system(), /^You are a helpful assistant, talking with the user directly/);
  assert.match(system(), /This is a plain chat: you are not one of the app's agents/);
  assert.match(system(), /start their message with @ to bring in the crew/);
  assert.match(system(), /## About the user[^\n]*\n- Keep answers short\./);
  for (const not of ["Quartermaster-only lesson", "## Your memory", "## Camp wiki", "## Your skills", "You are the Quartermaster", "## Your recent sessions"]) assert.ok(!system().includes(not), `not in the prompt: ${not}`);
  // What it can do: read, search, and look things up. Nothing that writes, runs, dispatches or remembers.
  assert.deepEqual(toolNames(), ["glob", "grep", "list_dir", "read_file", "view_file", "web_fetch", "web_search"]);

  // On the page: a run with nobody from the crew in it, whose words come from "Chat".
  const start = events.find((e) => e.type === "expedition_start");
  assert.deepEqual([start.chat, start.source, start.task], [true, "user", "When do deploy freezes start? It's in docs/policy.md"]);
  assert.ok(events.every((e) => !("who" in e) || e.who === "Chat"));
  assert.equal(events.some((e) => e.type === "dispatch" || e.type === "ask" || e.type === "plan"), false);
  assert.ok(events.some((e) => e.type === "tool" && e.tool === "read_file"));
  // Its record: a conversation in General, with "chat"; no session is kept for a crew member that isn't there.
  assert.deepEqual([threadFor("c1")!.agent, threadFor("c1")!.direct], [CHAT, false]);
  const listed = c.history().conversations.find((x) => x.id === "c1")!;
  assert.deepEqual([listed.agent, listed.direct, listed.project], ["chat", false, "general"]);
  assert.ok(!existsSync("camp/agents/chat"));
});

test("a reply carries the conversation on, on the model you picked; and the Quartermaster is still there when you ask for it", async () => {
  script = () => ({ text: "A rebase replays your commits; a merge joins two histories." });
  await runChat("What's the difference between a rebase and a merge?", { id: "c2", model: "claude-haiku-5-5" });
  assert.equal(api.seen[0].body.model, "claude-haiku-5-5");
  assert.equal(threadFor("c2")!.model, "claude-haiku-5-5");
  api.seen.length = 0;
  script = () => ({ text: "Rebase before you push; merge shared branches." });
  const r = await runChat("When would I use each?", { id: "c3", replyTo: "c2", model: threadFor("c2")!.model });
  assert.equal(r.model, "claude-haiku-5-5");
  assert.match(system(), /## This conversation so far[\s\S]*What's the difference between a rebase and a merge\?[\s\S]*A rebase replays your commits/);
  assert.equal(c.history().conversations.find((x) => x.id === "c2")!.expeditions.length, 2);

  // The crew hasn't gone anywhere: an expedition still plans, asks, and runs as the Quartermaster.
  api.seen.length = 0; events.length = 0;
  script = (b) => (isFirstTurn(b) ? { tools: [{ name: "submit_plan", input: { plan: "1. Answer it myself" } }] } : { text: "Done." });
  await runExpedition("Plan something", { id: "e1", project: "general", links: [] });
  assert.match(system(), /You are the Quartermaster/);
  assert.equal(asked, 1);
  assert.equal(events.find((e) => e.type === "expedition_start").chat, undefined);
});
