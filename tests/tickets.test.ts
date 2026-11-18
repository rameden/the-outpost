// Mae tickets: kept in camp/tickets.json under keys that are never reused, moved along only forward by the camp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("tickets");
const { loadTickets, createTicket, createTickets, updateTicket, removeTicket, advanceTicket, getTicket, parseDrafts, draftTickets, maeTicketMarkdown, ticketsTool, TICKETS_PATH } = await import("../src/tickets.ts");
const { campPath, rl } = await import("../src/tools.ts");
const { journals } = await import("../src/oplog.ts");
rl.close();

test("a ticket gets the next key, its fields tidied, and starts To do", () => {
  const t = createTicket({ title: "  # Add   a dark mode ", criteria: "- [ ] It follows the system\n\n2. It can be forced on", labels: "UI, Look and feel,ui", priority: "high", project: "app" });
  assert.equal(t.key, "MAE-1");
  assert.equal(t.title, "Add a dark mode");
  assert.deepEqual(t.criteria, ["It follows the system", "It can be forced on"]);
  assert.deepEqual(t.labels, ["ui", "look-and-feel"]);
  assert.equal(t.status, "todo");
  assert.equal(t.priority, "high");
  assert.equal(t.project, "app");
  assert.equal(createTicket({ title: "Second", project: "general" }).project, undefined, "General is no project");
  assert.deepEqual(loadTickets().map((x) => x.key), ["MAE-2", "MAE-1"]);
});

test("what isn't a ticket is refused, and says why", () => {
  const refused = (input: object, why: RegExp) => assert.throws(() => createTicket(input), (e: any) => e.fixable === true && why.test(e.message));
  refused({ title: "   " }, /title/);
  refused({ title: "x", status: "blocked" }, /status/);
  refused({ title: "x", priority: "urgent" }, /priority/);
});

test("a batch is filed together, in order, and a deleted key is never handed out again", () => {
  const made = createTickets([{ title: "One" }, { title: "Two" }], );
  assert.deepEqual(made.map((t) => t.key), ["MAE-3", "MAE-4"]);
  assert.ok(removeTicket("MAE-4"));
  assert.equal(createTicket({ title: "Three" }).key, "MAE-5");
  // Even if the file is edited by hand and its counter lost.
  const kept = JSON.parse(readFileSync(TICKETS_PATH, "utf8"));
  writeFileSync(TICKETS_PATH, JSON.stringify({ tickets: kept.tickets }));
  assert.equal(createTicket({ title: "Four" }).key, "MAE-6");
});

test("moving a ticket keeps when it started and finished; the camp only moves it forward", () => {
  const t = createTicket({ title: "Move me" });
  assert.equal(advanceTicket(t.key, "doing")?.status, "doing");
  const started = getTicket(t.key)!.started;
  assert.ok(started);
  assert.equal(advanceTicket(t.key, "doing"), null, "already there");
  const done = advanceTicket(t.key, "done")!;
  assert.ok(done.done);
  assert.equal(done.started, started);
  const reopened = updateTicket(t.key, { status: "todo" })!;
  assert.equal(reopened.done, undefined);
  assert.equal(updateTicket(t.key, { title: "Renamed" })!.criteria.length, 0, "what's left out stays as it was");
  assert.equal(advanceTicket(undefined, "done"), null);
  assert.equal(advanceTicket("MAE-999", "done"), null);
});

test("the crew's file tools can't open the tickets file", () => {
  assert.throws(() => campPath("camp/tickets.json", "read"));
});

test("drafts are read out of the model's answer, and nothing that isn't one", async () => {
  const raw = 'Sure!\n```json\n[{"title":"Split the parser","criteria":["a","b"],"description":"Why."},{"title":"split the parser"},{"nope":1},{"title":"Add tests"}]\n```';
  assert.deepEqual(parseDrafts(raw).map((d) => d.title), ["Split the parser", "Add tests"]);
  assert.deepEqual(parseDrafts("no list here"), []);
  const asked: string[] = [];
  const drafts = await draftTickets("1. Do this\n2. Then that", { kind: "plan", projectName: "App", ask: async (_s, p) => { asked.push(p); return '[{"title":"Do this","criteria":["done"]}]'; } });
  assert.equal(drafts[0].title, "Do this");
  assert.match(asked[0], /<plan>[\s\S]*Do this[\s\S]*<\/plan>/);
  assert.match(asked[0], /project "App"/);
  await assert.rejects(draftTickets("text", { kind: "note", ask: async () => "nothing" }), /didn't answer/);
  await assert.rejects(draftTickets("  ", { kind: "note", ask: async () => "[]" }), (e: any) => e.fixable === true);
});

test("a note written up as one ticket comes back as one, with a priority and labels it may suggest", async () => {
  const asked: string[] = [];
  const answer = '[{"title":"Dark mode","criteria":["Follows the system"],"description":"Why.","priority":"HIGH","labels":["UI Theme","ui theme","x"]},{"title":"Another"}]';
  const [d, ...rest] = await draftTickets("Dark mode, soon", { kind: "note", title: "Dark mode", one: true, ask: async (_s, p) => { asked.push(p); return answer; } });
  assert.equal(rest.length, 0);
  assert.deepEqual(d, { title: "Dark mode", criteria: ["Follows the system"], description: "Why.", priority: "high", labels: ["ui-theme", "x"] });
  assert.match(asked[0], /as one ticket/);
  // A priority that isn't one is left out, not guessed at.
  assert.equal(parseDrafts('[{"title":"T","priority":"urgent"}]')[0].priority, undefined);
});

test("the tickets tool lists, reads, files and moves them; filing is journaled, reading isn't", async () => {
  const tool = ticketsTool({ project: () => "app", conversation: () => ({ id: "conv1", title: "Planning" }) });
  const filed = String(await tool.run!({ action: "create", tickets: [{ title: "From a plan", criteria: ["works"] }] }));
  const key = /MAE-\d+/.exec(filed)![0];
  const t = getTicket(key)!;
  assert.equal(t.project, "app");
  assert.deepEqual(t.from, { kind: "conversation", id: "conv1", title: "Planning" });
  assert.match(String(await tool.run!({ action: "get", key: key.toLowerCase() })), /From a plan[\s\S]*- \[ \] works/);
  assert.match(String(await tool.run!({ action: "update", key, status: "doing" })), /In progress/);
  assert.match(String(await tool.run!({ action: "list", status: "doing" })), new RegExp(key));
  assert.match(String(await tool.run!({ action: "update", key, status: "nope" })), /status/);
  assert.ok(journals("tickets", { action: "create" }) && journals("tickets", { action: "update" }));
  assert.ok(!journals("tickets", { action: "list" }) && !journals("tickets", { action: "get" }));
});

test("a ticket as Markdown has its key, facts and criteria", () => {
  const md = maeTicketMarkdown(createTicket({ title: "Doc", criteria: ["one"], description: "## Summary\nHi", labels: "x" }), "App");
  assert.match(md, /^# MAE-\d+: Doc\n\nStatus: To do · Project: App · Labels: x\n\n## Acceptance criteria\n- \[ \] one\n\n## Summary\nHi\n$/);
});
