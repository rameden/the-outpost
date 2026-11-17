// What Orbit asks of the camp: the last day's events to play back, what each of the crew has
// cost today, and starting a queued request without waiting. feedSince is checked on its own, and
// the rest against a camp started for real.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { enterSandbox, REPO } from "./helpers/sandbox.ts";

const camp = enterSandbox("orbit-feed");
mkdirSync("camp", { recursive: true });
const { feedSince, FEED_PATH } = await import("../src/feed.ts");

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const line = (o: object) => JSON.stringify(o);
const day = [
  // An expedition that set out two days ago and carried on into today: its tail is left out.
  line({ type: "expedition_start", id: "old", task: "Old", time: ago(49 * HOUR), seq: 1 }),
  line({ type: "tool", tool: "grep", expeditionId: "old", time: ago(23 * HOUR), seq: 2 }),
  // One that began inside the day, whole.
  line({ type: "expedition_start", id: "new", task: "New", time: ago(5 * HOUR), seq: 3 }),
  line({ type: "tool", tool: "read_file", expeditionId: "new", time: ago(4 * HOUR), seq: 4 }),
  "not json at all",
  line({ type: "expedition_end", id: "new", status: "done", text: "ok", expeditionId: "new", time: ago(3 * HOUR), seq: 5 }),
  line({ type: "inbox", time: ago(HOUR), seq: 6 }), // (nothing to do with an expedition)
  line({ type: "tool", tool: "no time", seq: 7 }),  // (no time: can't be placed)
].join("\n") + "\n";

test("feedSince gives the day oldest first, drops lines it can't read, and never starts part-way through an expedition", () => {
  writeFileSync(FEED_PATH, day);
  const got = feedSince(Date.now() - 24 * HOUR);
  assert.deepEqual(got.map((e) => e.seq), [3, 4, 5, 6]);
  assert.equal(feedSince(Date.now() - 2 * HOUR).length, 1, "only what's in the window");
  assert.deepEqual(feedSince(Date.now() - 100 * HOUR).map((e) => e.seq), [1, 2, 3, 4, 5, 6], "a wider window brings the old expedition whole");
});

test("feedSince keeps the newest when there are more than the limit, is empty with nothing in the file, and it reads back through a long file", () => {
  writeFileSync(FEED_PATH, day);
  const events = feedSince(Date.now() - 100 * HOUR, 3);
  assert.deepEqual(events.map((e) => e.seq), [6], "the newest three are 4, 5 and 6, but 4 and 5 belong to an expedition that began before them");
  // More than a read's worth (a megabyte) of recent lines in front of the one it's after.
  const filler = Array.from({ length: 6000 }, (_, i) => line({ type: "inbox", pad: "x".repeat(300), time: ago(HOUR), seq: 100 + i })).join("\n");
  writeFileSync(FEED_PATH, line({ type: "inbox", time: ago(30 * HOUR), seq: 1 }) + "\n" + filler + "\n");
  const got = feedSince(Date.now() - 24 * HOUR, 10_000);
  assert.equal(got.length, 6000);
  assert.equal(got[0].seq, 100);
  assert.equal(got.at(-1)!.seq, 5999 + 100, "oldest first");
  writeFileSync(FEED_PATH, "");
  assert.deepEqual(feedSince(0), []);
});

// ---------- against a camp that's running ----------
const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); }); });
const started: ChildProcess[] = [];
after(() => { for (const c of started) if (c.exitCode === null) c.kill("SIGKILL"); });
async function start() {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "server.ts")], {
    cwd: camp, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CAMP_PORT: String(port), CAMP_RUNTIME: "api", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
  });
  started.push(child);
  let text = "";
  child.stdout!.on("data", (d) => (text += d));
  child.stderr!.on("data", (d) => (text += d));
  const code = await new Promise<string>((ok, no) => {
    const giveUp = setTimeout(() => no(new Error(`the camp didn't start:\n${text}`)), 30_000);
    const look = () => { const m = text.match(/\/#k=([0-9a-f]+)/); if (m) { clearTimeout(giveUp); child.stdout!.off("data", look); ok(m[1]); } };
    child.stdout!.on("data", look);
  });
  const res = await fetch(`http://127.0.0.1:${port}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const { token } = (await res.json()) as { token: string };
  const call = (path: string, body?: object, key: string | null = token) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: body ? "POST" : "GET", headers: { ...(key ? { "x-camp-token": key } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { call, child };
}

const quest = (character: string, time: string, costUsd: number) => line({
  time, kind: "quest", character, task: "t", result: "r", status: "done", model: "claude-sonnet-5-5", turns: 1, seconds: 1,
  usage: { input: 0, output: 0 }, runtime: "claude-code", costUsd,
});

test("the camp serves the last day for the replay, needs the key, and says what each of the crew cost today", async () => {
  writeFileSync(join(camp, FEED_PATH), day);
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const today = noon.getTime() <= Date.now() ? noon.toISOString() : new Date(Date.now() - 1000).toISOString();
  writeFileSync(join(camp, "camp", "quest-log.jsonl"), [
    quest("Scout", today, 0.5), quest("Scout", today, 0.25), quest("Scribe", today, 1),
    quest("Scout", ago(3 * 24 * HOUR), 9), // (not today's)
  ].join("\n") + "\n");
  const c = await start();

  assert.equal((await c.call("/api/feed/day", undefined, null)).status, 401);
  const res = await c.call("/api/feed/day");
  assert.equal(res.status, 200);
  const { events } = (await res.json()) as { events: { seq: number; time: string }[] };
  assert.ok(events.every((e) => Date.parse(e.time) >= Date.now() - 24 * HOUR - 60_000));
  assert.deepEqual(events.map((e) => e.seq).slice(0, 3), [3, 4, 5], "from the start of the first whole expedition");
  assert.ok(!events.some((e) => e.seq === 2), "not the tail of one that began before the day");

  const state = (await (await c.call("/api/state?full=0")).json()) as { spend: { today: number; total: number; byAgent: Record<string, number> } };
  assert.deepEqual(Object.keys(state.spend.byAgent).sort(), ["Scout", "Scribe"]);
  assert.equal(state.spend.byAgent.Scout, 0.75, "today's calls only");
  assert.equal(state.spend.byAgent.Scribe, 1);
  assert.equal(state.spend.today, 1.75);
  assert.equal(state.spend.total, 10.75);
});

test("asking the camp to start a request that isn't waiting says so, and doesn't need more than its id", async () => {
  const c = await start();
  const res = await c.call("/api/queue/release", { id: "nope" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "That one isn't waiting any more." });
  assert.equal((await c.call("/api/queue/release", {})).status, 404);
  assert.equal((await c.call("/api/queue/release", { id: "nope" }, null)).status, 401);
});
