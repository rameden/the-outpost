// AI news in the morning brief: off unless you turn it on, links checked and not repeated, the
// day's news kept when the brief is written again, and a failed search noted rather than fatal.
// With a stand-in for the model: no network, no API.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("briefnews");
const N = await import("../src/briefnews.ts");
const B = await import("../src/brief.ts");
const { setDrive, drive } = await import("../src/settings.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const noPulls = async () => ({ fetched: new Date().toISOString(), login: "me", pulls: [] });
const read = (news: (since: string, seen: string[]) => Promise<any[]>) => ({ pulls: noPulls, tickets: async () => null, jobs: () => [], notes: () => [], news });

test("parseNews keeps well-formed items with real links, drops repeats and what's been seen", () => {
  const text = `Here you go:\n[
    {"kind":"feature","title":"Prompt caching for tools","url":"https://example.com/caching","says":"Tool definitions can be cached.","why":"Cuts the crew's cost."},
    {"kind":"bogus","title":"A trend","url":"https://example.com/trend/","says":"x","why":"y"},
    {"title":"No link","url":"javascript:alert(1)"},
    {"title":"Seen","url":"https://example.com/old"},
    {"title":"Repeat","url":"https://example.com/caching#again"}
  ]`;
  const items = N.parseNews(text, ["https://example.com/old/"]);
  assert.deepEqual(items.map((i) => i.title), ["Prompt caching for tools", "A trend"]);
  assert.equal(items[1].kind, "news"); // an unknown kind reads as news
  assert.deepEqual(N.parseNews("no json here"), []);
});

test("the prompt names what's already been reported", () => {
  const p = N.newsPrompt({ since: "2026-11-18T00:00:00Z", seen: ["https://example.com/a"] });
  assert.match(p, /2026-11-18/);
  assert.match(p, /https:\/\/example\.com\/a/);
});

test("the brief has no news unless it's turned on", async () => {
  assert.equal(drive().briefNews, false);
  let asked = 0;
  const b = await B.writeBrief({ now: new Date(2026, 10, 16, 8, 0), read: read(async () => { asked++; return []; }) });
  assert.equal(asked, 0);
  assert.equal(b.news, undefined);
});

test("turned on, the brief lists the news, keeps it for the day, and doesn't repeat links", async () => {
  setDrive({ briefNews: true });
  assert.equal(drive().briefNews, true);
  const item = { kind: "practice", title: "Evals for agents", url: "https://example.com/evals", says: "How to grade runs.", why: "The evals/ runner could use it." };
  let asked = 0, seenLast: string[] = [];
  const news = async (_since: string, seen: string[]) => { asked++; seenLast = seen; return [item]; };
  const b = await B.writeBrief({ now: new Date(2026, 10, 17, 8, 0), read: read(news) });
  assert.deepEqual(b.news, [item]);
  assert.match(B.briefText(b), /AI news for .* \(1\)[\s\S]*\[Evals for agents\]\(https:\/\/example\.com\/evals\)/);

  await B.writeBrief({ now: new Date(2026, 10, 17, 9, 0), read: read(news) }); // the same day: no second search
  assert.equal(asked, 1);

  await B.writeBrief({ now: new Date(2026, 10, 18, 8, 0), read: read(news) }); // the next day: yesterday's links are passed as seen
  assert.equal(asked, 2);
  assert.ok(seenLast.includes("https://example.com/evals"));
});

test("a failed search is a note on the brief, not a failed brief", async () => {
  const b = await B.writeBrief({ now: new Date(2026, 10, 19, 8, 0), read: read(async () => { throw new Error("search is down"); }) });
  assert.equal(b.news, undefined);
  assert.ok(b.notes.some((n) => /AI news couldn't be gathered: search is down/.test(n)));
  setDrive({ briefNews: false });
  assert.equal(drive().briefNews, false);
});
