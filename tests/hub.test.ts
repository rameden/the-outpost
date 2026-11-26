// The star chart (src/hub.ts, scripts/launch.ts): what it says about an outpost, who it answers,
// and how it reads an outpost's sign-in link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chartAddress, hubHostOk, hubPage, outpostFacts, signInLinkIn } from "../src/hub.ts";
import { startHub } from "../scripts/launch.ts";

test("the chart answers only to its own address on this machine", () => {
  assert.equal(hubHostOk("127.0.0.1:4700", 4700), true);
  assert.equal(hubHostOk("localhost:4700", 4700), true);
  assert.equal(hubHostOk("127.0.0.1:4747", 4700), false);
  assert.equal(hubHostOk("evil.example:4700", 4700), false);
  assert.equal(hubHostOk(undefined, 4700), false);
});

test("an outpost takes the chart's address only in the chart's own shape", () => {
  assert.equal(chartAddress("http://127.0.0.1:4700/"), "http://127.0.0.1:4700/");
  assert.equal(chartAddress("http://evil.example:4700/"), null);
  assert.equal(chartAddress("http://127.0.0.1:4700/#k=1"), null);
  assert.equal(chartAddress("javascript:alert(1)"), null);
  assert.equal(chartAddress("http://127.0.0.1:80/"), null);
  assert.equal(chartAddress(undefined), null);
});

test("an outpost's sign-in link is read out of the line it prints", () => {
  assert.equal(signInLinkIn("🏕️  Outpost Work is up: http://127.0.0.1:4748/#k=0123abcd"), "http://127.0.0.1:4748/#k=0123abcd");
  assert.equal(signInLinkIn("   Sign in with: http://127.0.0.1:5174/#k=ff00"), "http://127.0.0.1:5174/#k=ff00");
  assert.equal(signInLinkIn("   From another machine: http://mac.local:4748/#k=ff00"), null);
  assert.equal(signInLinkIn("scheduler: 3 jobs"), null);
});

test("the chart tells counts and dates about an outpost, and nothing for a new one", () => {
  const dir = mkdtempSync(join(tmpdir(), "mae-hub-"));
  assert.deepEqual(outpostFacts(dir), { crew: null, lastActive: null, since: null });
  mkdirSync(join(dir, "camp"));
  assert.equal(outpostFacts(dir).crew, 6, "the six built in, before anyone is added");
  writeFileSync(join(dir, "camp", "outpost.json"), JSON.stringify({ name: "Work", port: 4748 }));
  writeFileSync(join(dir, "camp", "crew.json"), JSON.stringify({ crew: [{ id: "a" }, { id: "b" }, { id: "wizard" }] }));
  writeFileSync(join(dir, "camp", "feed.jsonl"), "{}\n");
  const facts = outpostFacts(dir);
  assert.equal(facts.crew, 8, "six built in plus two added (a built-in's handle counts once)");
  assert.ok(facts.lastActive && Date.now() - facts.lastActive < 60_000);
  assert.ok(facts.since);
  writeFileSync(join(dir, "camp", "crew.json"), "{ not json");
  assert.equal(outpostFacts(dir).crew, null);
});

test("the page carries this launch's token, and is null before a build", () => {
  const dist = mkdtempSync(join(tmpdir(), "mae-hub-dist-"));
  assert.equal(hubPage(dist, "abc"), null);
  writeFileSync(join(dist, "hub.html"), '<meta name="hub-token" content="__HUB_TOKEN__">');
  assert.equal(hubPage(dist, "abc"), '<meta name="hub-token" content="abc">');
});

test("the chart's server turns away other hosts and requests without its token", async () => {
  const port = 47000 + Math.floor(Math.random() * 900);
  const hub = startHub({ port, log: () => {} });
  const url = await hub.listen();
  try {
    assert.equal((await fetch(`${url}api/outposts`)).status, 401);
    assert.equal((await fetch(`${url}api/launch`, { method: "POST", body: "{}" })).status, 401);
    const list = await fetch(`${url}api/outposts`, { headers: { "x-hub-token": hub.token } });
    assert.equal(list.status, 200);
    const { outposts } = await list.json() as { outposts: { id: string; here: boolean }[] };
    assert.equal(outposts[0].id, "_here");
    assert.equal(outposts[0].here, true);
    const gone = await fetch(`${url}api/launch`, { method: "POST", headers: { "x-hub-token": hub.token, "content-type": "application/json" }, body: JSON.stringify({ id: "no-such-outpost" }) });
    assert.equal(gone.status, 404);
    assert.equal((await fetch(`http://localhost:${port + 1}/`).catch(() => ({ status: 0 }))).status, 0);
  } finally { await hub.close(); }
});
