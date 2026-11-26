import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";
import type { Merged } from "../src/releases.ts";

enterSandbox("releases");
const { plainNotes, readNotes, releaseNotesDue, releases, sideOf, writeReleaseNotes, EVERY_MS } = await import("../src/releases.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const pr = (number: number, files: string[], lines = 10, merged = `2026-11-2${number % 10}T10:00:00Z`): Merged =>
  ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, merged, author: "me", body: `Does thing ${number}.\n\n🤖 Generated`, files, lines });

test("a pull request is front end when most of its files are under ui/, docs/ or extension/", () => {
  assert.equal(sideOf(["ui/src/App.tsx", "ui/src/styles.css", "src/server.ts"]), "frontend");
  assert.equal(sideOf(["src/server.ts", "tests/a.test.ts", "ui/src/api.ts"]), "backend");
  assert.equal(sideOf(["docs/index.html"]), "frontend");
});

test("without the model, each pull request is one line, big ones first", () => {
  const n = plainNotes([pr(1, ["src/a.ts"], 20), pr(2, ["src/b.ts"], 900), pr(3, ["ui/x.tsx"])]);
  assert.deepEqual(n.backend.map((x) => x.prs[0]), [2, 1]);
  assert.equal(n.backend[0].major, true);
  assert.equal(n.backend[1].detail, "Does thing 1.");
  assert.deepEqual(n.frontend.map((x) => x.prs[0]), [3]);
});

test("the model's notes are checked: unknown numbers dropped, majors first, missed pull requests added", () => {
  const pulls = [pr(1, ["ui/a.tsx"]), pr(2, ["src/b.ts"]), pr(3, ["src/c.ts"])];
  const reply = 'Here: {"frontend":[{"title":"Polish","detail":"d","major":false,"prs":[1]},{"title":"Big page","detail":"d","major":true,"prs":[1,99]}],"backend":[{"title":"Faster","detail":"d","major":false,"prs":[2]}]}';
  const n = readNotes(reply, pulls)!;
  assert.deepEqual(n.frontend.map((x) => x.title), ["Big page", "Polish"]);
  assert.deepEqual(n.frontend[0].prs, [1]);
  assert.deepEqual(n.backend.map((x) => x.prs), [[2], [3]]);
  assert.equal(readNotes("not json", pulls), null);
});

test("a write-up covers what was merged since the last one, and nothing new writes nothing", async () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const lister = async () => ({ repo: "o/r", pulls: [pr(1, ["src/a.ts"], 10, "2026-11-24T00:00:00Z"), pr(2, ["ui/b.tsx"], 10, "2026-11-25T00:00:00Z")] });
  const summarize = async () => '{"frontend":[{"title":"New page","detail":"You can see it.","major":true,"prs":[2]}],"backend":[{"title":"Fix","detail":"x","major":false,"prs":[1]}]}';
  const r = await writeReleaseNotes({ lister, summarize, now });
  assert.equal(r.releases.length, 1);
  assert.equal(r.releases[0].byModel, true);
  assert.equal(r.releases[0].to, "2026-11-25T00:00:00Z");
  assert.equal(r.repo, "o/r");
  assert.equal(releaseNotesDue(releases(), now.getTime() + 1000), false);
  assert.equal(releaseNotesDue(releases(), now.getTime() + EVERY_MS), true);

  // Two days on, the same two (GitHub's search is by date) and nothing newer: no second write-up.
  const later = await writeReleaseNotes({ lister, summarize, now: new Date(now.getTime() + EVERY_MS) });
  assert.equal(later.releases.length, 1);
  assert.equal(later.checked, new Date(now.getTime() + EVERY_MS).toISOString());

  // The model fails: written plainly.
  const more = async () => ({ repo: "o/r", pulls: [pr(3, ["src/c.ts"], 10, "2026-11-27T00:00:00Z")] });
  const plain = await writeReleaseNotes({ lister: more, summarize: async () => { throw new Error("down"); }, now: new Date("2026-11-28T00:00:00Z") });
  assert.equal(plain.releases.length, 2);
  assert.equal(plain.releases[0].byModel, false);
  assert.deepEqual(plain.releases[0].backend.map((x) => x.prs), [[3]]);

  // GitHub can't be read: what's known is kept, with why.
  const failed = await writeReleaseNotes({ lister: async () => { throw new Error("gh: not logged in"); }, now: new Date("2026-12-01T00:00:00Z") });
  assert.equal(failed.releases.length, 2);
  assert.match(failed.error!, /not logged in/);
  assert.equal(failed.checked, plain.checked); // tried again next hour
});
