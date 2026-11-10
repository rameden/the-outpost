// History: conversations are read from the camp's own record of runs, filed under projects you
// can add, rename, and delete; and a conversation can be read back as feed events, even after the
// feed itself has forgotten it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("conversations");
const repo = realpathSync(mkdtempSync(join(tmpdir(), "guild-camp-proj-")));
mkdirSync(join(repo, "src"));

const { recordTurn, threadFor } = await import("../src/threads.ts");
const { saveToFeed } = await import("../src/feed.ts");
const { addLink } = await import("../src/links.ts");
const c = await import("../src/conversations.ts");
const { projectBlock } = await import("../src/projects.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const turn = (thread: string, expedition: string, task: string, reply: string, status = "done", more: object = {}) =>
  recordTurn({ thread, expedition, agent: "quartermaster", direct: false, task, reply, status, ...more });
const linkName = addLink(repo, "read").name;

test("conversations come from the record of runs, newest first, titled by their first request", () => {
  turn("a", "a", "Rebuild the mission control page in React, keeping every feature it has today and adding tests", "", "running");
  turn("a", "a", "Rebuild the mission control page in React, keeping every feature it has today and adding tests", "Rebuilt.");
  turn("b", "b", "What's new this month?", "Three things.", "done", { agent: "scout", direct: true });
  turn("a", "a2", "Now add a dark theme", "", "running");
  const h = c.history();
  assert.deepEqual(h.conversations.map((x) => x.id), ["a", "b"], "the one with the newest run first");
  const a = h.conversations[0];
  assert.equal(a.title, "Rebuild the mission control page in React, keeping every featur…");
  assert.deepEqual(a.expeditions, ["a", "a2"]);
  assert.equal(a.status, "running");
  assert.equal(a.project, "general");
  assert.deepEqual([h.conversations[1].agent, h.conversations[1].direct], ["scout", true]);
});

test("projects: General, one per linked folder, and your own; filing, moving, renaming, removing", () => {
  let h = c.history();
  assert.deepEqual(h.projects.map((p) => [p.name, p.links]), [["General", undefined], [linkName, [linkName]]]);
  const linked = h.projects[1];
  const mine = c.addProject("  Mae  ");
  assert.equal(mine.name, "Mae");

  c.fileConversation("b", mine.id); // a new conversation started inside a project
  c.fileConversation("b", linked.id); // already filed: a later send doesn't move it
  assert.ok(c.moveConversation("a", linked.id));
  assert.ok(!c.moveConversation("a", "no-such-project"));
  c.renameConversation("a", "React rebuild");
  h = c.history();
  assert.deepEqual(h.conversations.map((x) => [x.title, x.project]), [["React rebuild", linked.id], ["What's new this month?", mine.id]]);

  // What you write about a project reaches the crew, along with its folders.
  assert.match(projectBlock("scout", linked.id), new RegExp(`project "${linkName}"[\\s\\S]*links/${linkName}/ \\(read-only\\)`));
  assert.match(projectBlock("scout", mine.id), /^## Project: Mae\nThe user filed this conversation under their project "Mae"\./);
  assert.equal(projectBlock("scout", "general"), "");
  assert.equal(projectBlock("scout", undefined), "", "no project, nothing added");
  assert.ok(c.updateProject(mine.id, { description: "  My home assistant.\nNever restart the hub without asking.  ", links: [linkName, "not-a-link", linkName] }));
  assert.deepEqual(c.getProject(mine.id)!.links, [linkName], "only folders that are really linked, each once");
  const note = projectBlock("scout", mine.id);
  assert.match(note, new RegExp(`links/${linkName}/ \\(read-only\\)`));
  assert.match(note, /### What the user wrote about this project[^\n]*\nMy home assistant\.\nNever restart the hub without asking\./);
  assert.ok(c.updateProject(mine.id, { links: [] }), "the folders can be taken off again");
  assert.doesNotMatch(projectBlock("scout", mine.id), /links\//);
  assert.ok(c.updateProject("general", { description: "Odds and ends.", links: [linkName] }));
  assert.match(projectBlock("scout", "general"), /isn't filed under a particular project[\s\S]*Odds and ends\./);
  assert.equal(c.history().projects[0].links, undefined, "General has no folders of its own");
  c.updateProject("general", { description: "" });

  assert.ok(c.renameProject(mine.id, "Mae (home)"));
  assert.ok(!c.removeProject("general"), "General can't be deleted");
  assert.ok(c.removeProject(linked.id));
  h = c.history();
  assert.deepEqual(h.projects.map((p) => p.name), ["General", "Mae (home)"], "a deleted link project doesn't come back");
  assert.equal(h.conversations.find((x) => x.id === "a")!.project, "general", "its conversations go back to General");

  c.removeConversation("b");
  assert.deepEqual(c.history().conversations.map((x) => x.id), ["a"]);
  assert.ok(threadFor("b"), "removing only hides it: the record is still there");
});

test("a project made with a folder doesn't get a second, automatic project for that folder", () => {
  const other = realpathSync(mkdtempSync(join(tmpdir(), "guild-camp-proj2-")));
  const name = addLink(other, "write").name; // what the dialog's "Link another folder…" does first
  const p = c.addProject({ name: "Garden sensors", description: "ESP32 boards.", links: [name] });
  assert.deepEqual([p.name, p.links, p.description], ["Garden sensors", [name], "ESP32 boards."]);
  assert.equal(c.history().projects.filter((x) => x.links?.includes(name)).length, 1);
  assert.equal(c.addProject({ link: "not-a-link" }).links, undefined, "only folders that are really linked");
  assert.deepEqual(c.addProject({ name: "Older form", link: name }).links, [name], "one folder by name still works");
});

test("a conversation reads back as feed events; a run the feed has forgotten is rebuilt from its record", () => {
  const ev = (seq: number, id: string, body: object) => saveToFeed({ time: new Date().toISOString(), seq, expeditionId: id, ...body } as any);
  turn("a", "a2", "Now add a dark theme", "Added it.");
  ev(1, "a2", { type: "expedition_start", id: "a2", task: "Now add a dark theme", source: "user", thread: "a", replyTo: "a" });
  ev(2, "a2", { type: "tool", who: "Quartermaster", emoji: "🧭", depth: 0, tool: "read_file", input: "{}" });
  ev(3, "other", { type: "expedition_start", id: "other", task: "Someone else's", source: "user", thread: "other" });
  ev(4, "a2", { type: "expedition_end", id: "a2", status: "done", text: "Added it." });
  const events = c.conversationEvents("a");
  assert.deepEqual(events.map((e) => `${e.expeditionId}:${e.type}`), [
    "a:expedition_start", "a:text", "a:expedition_end",   // not in the feed: from the record
    "a2:expedition_start", "a2:tool", "a2:expedition_end", // as the feed recorded it
  ]);
  assert.equal((events[1] as any).text, "Rebuilt.");
  assert.equal((events[0] as any).thread, "a");
  assert.deepEqual(c.conversationEvents("nope"), []);
});

test("a reply to a run that is still going says so, instead of calling it cut off", () => {
  turn("live", "live", "Long job", "", "running");
  assert.match(threadFor("live", () => true)!.history, /still going, in parallel with this one/);
  assert.match(threadFor("live")!.history, /cut off before it finished/);
});
