// The log of recall searches (recallqueries.ts): every search is written down with what it found,
// and read back as how often recall finds nothing and how often an agent has to search again.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("recallqueries");
const { recordSession } = await import("../src/memory.ts");
const { recallTool } = await import("../src/recall.ts");
const { withExpedition } = await import("../src/context.ts");
const q = await import("../src/recallqueries.ts");
type RecallQuery = import("../src/recallqueries.ts").RecallQuery;
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const recall = (id: string, input: object) => recallTool(id).run!(input).then(String);

test("each recall search is written down: who, which run, what was asked, what came back", async () => {
  recordSession("artificer", { source: "brief", task: "Fix the flaky nav test", result: "It raced the router; now awaited.", status: "done", messages: [] });
  await withExpedition({ id: "run-a", project: "general", scope: [] }, async () => {
    await recall("artificer", { query: "flaky nav" });
    await recall("artificer", { query: "zebra crossing", where: "wiki" });
    await recall("artificer", { query: "a of" });
  });
  const log = q.readQueries();
  assert.equal(log.length, 3);
  assert.deepEqual(log.map((e) => [e.agent, e.run, e.query, e.where, e.found]), [
    ["artificer", "run-a", "flaky nav", "all", 1],
    ["artificer", "run-a", "zebra crossing", "wiki", 0],
    ["artificer", "run-a", "a of", "all", 0],
  ]);
  assert.deepEqual(log[0].terms, ["flaky", "nav"]);
  assert.equal(log[0].mode, "words");
  assert.equal(log[0].shown[0].from, "one of your sessions");
  assert.match(log[0].shown[0].when ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(log[2].terms, []);
});

test("the summary counts empty searches and searches made again straight after, and shows the chains", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 9, min)).toISOString();
  const e = (agent: string, run: string | undefined, min: number, query: string, found: number): RecallQuery =>
    ({ time: at(min), agent, ...(run ? { run } : {}), project: "general", query, where: "all", terms: [], mode: "words", found, shown: [] });
  const s = q.summarizeQueries([
    e("scout", "r1", 0, "login broke", 0),
    e("scout", "r1", 1, "auth token", 2),       // searched again after nothing
    e("scout", "r1", 2, "auth token expiry", 1), // and again after something
    e("scout", "r1", 30, "deploy", 3),           // too long after: a new search, not a retry
    e("scribe", "r1", 1, "release notes", 4),    // another agent in the same run: not scout's retry
    e("warden", undefined, 0, "lint", 0),        // no run: never counted as again
    e("warden", undefined, 1, "lint rules", 1),
  ]);
  assert.equal(s.searches, 7);
  assert.equal(s.empty, 2);
  assert.equal(s.again, 2);
  assert.equal(s.againAfterEmpty, 1);
  assert.equal(s.againAfterFound, 1);
  assert.deepEqual(s.byAgent.scout, { searches: 4, empty: 1, again: 2 });
  assert.deepEqual(s.chains, [{ agent: "scout", run: "r1", queries: [{ query: "login broke", found: 0 }, { query: "auth token", found: 2 }, { query: "auth token expiry", found: 1 }] }]);
  const text = q.formatSummary(s);
  assert.match(text, /^7 recall searches\.\nFound nothing: 2 \(29%\)\./);
  assert.match(text, /"login broke" \(0\) → "auth token" \(2\) → "auth token expiry" \(1\)/);
  assert.equal(q.formatSummary(q.summarizeQueries([])), "No recall searches on record yet.");
});

test("the log keeps its newest entries, skips torn lines, and never throws", () => {
  const one = (i: number) => JSON.stringify({ time: new Date(i).toISOString(), agent: "scout", project: "general", query: `q${i}`, where: "all", terms: [], mode: "words", found: 0, shown: [] });
  writeFileSync(q.QUERY_LOG, Array.from({ length: q.QUERIES_MAX + 500 }, (_, i) => one(i)).join("\n") + "\n{torn\n");
  q.resetQueryCount();
  q.logQuery({ agent: "scout", project: "general", query: "x".repeat(1000), where: "all", terms: [], mode: "words", found: 0, shown: [] });
  const log = q.readQueries();
  assert.equal(log.length, q.QUERIES_MAX);
  assert.equal(log.at(-1)!.query.length, 300);
  assert.equal(log[0].query, `q501`);
});
