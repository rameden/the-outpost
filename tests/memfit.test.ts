// Which memory lines reach a prompt once a memory has outgrown its room: the pinned ones, the
// newest, and older ones that bear on the request. And keeping a memory from contradicting
// itself: a corrected line replaces the one it corrects.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";
import { startFakeApi, systemText, type Reply } from "./helpers/fake-api.ts";

enterSandbox("memfit");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

const { fitMemory, parseEntry, withPin, stem, wordsOf, alike, PIN } = await import("../src/memfit.ts");
const { rememberTool, fullMemory, readMemory, writeMemory, MEMORY_MAX_CHARS } = await import("../src/memory.ts");
const k = await import("../src/keeping.ts");
const { scoreText, searchTerms } = await import("../src/recall.ts");
const { runDirect } = await import("../src/quartermaster.ts");
const c = await import("../src/conversations.ts");
const { addProjectNote, projectBlock } = await import("../src/projects.ts");
const { withExpedition } = await import("../src/context.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });
beforeEach(() => { api.seen.length = 0; script = () => ({ text: "ok" }); });

const remember = (id: string, input: object) => rememberTool(id).run!(input).then(String);
// Sixty lines of filler about nothing in particular (so the memory is well past what a prompt loads).
const filler = (n: number, day = "2026-03-01") => Array.from({ length: n }, (_, i) => `- ${day} Lesson number ${i + 1} about formatting tables and headings ${"x".repeat(60)}`);
const HERON = "- 2026-01-05 The staging server is called heron-7; deploys to it go through `make ship-heron`.";

test("a memory that fits is loaded whole, exactly as written", () => {
  const text = "## Style\n- 2026-01-02 Use British spelling\n\nA loose line.\n- No date on this one";
  const fit = fitMemory(text, 5000, "anything at all");
  assert.equal(fit.text, text);
  assert.equal(fit.whole, true);
  assert.equal(fit.left, 0);
});

test("past its room: the newest lines, and an old one when the request is about it", () => {
  const text = [HERON, ...filler(70)].join("\n");
  assert.ok(text.length > 5000);
  const plain = fitMemory(text, 5000);
  assert.ok(!plain.text.includes("heron-7"), "with nothing to go on, the oldest line is the one left out");
  assert.ok(plain.text.includes("Lesson number 70 "), "and the newest is in");
  assert.ok(plain.text.length <= 5000);
  assert.match(plain.text, /^\(\d+ of 71 lines are shown: the pinned ones, the newest, and older ones that bear on this request\. recall finds the other \d+\.\)\n/);

  const asked = fitMemory(text, 5000, "How do I deploy to our staging server?");
  assert.ok(asked.text.includes("make ship-heron"), "the old line that answers the request is loaded");
  assert.ok(asked.text.includes("Lesson number 70 "), "the newest still are");
  assert.ok(asked.text.length <= 5000);
  assert.ok(asked.text.indexOf("heron-7") < asked.text.indexOf("Lesson number 70 "), "lines keep the order they have in the file");
  assert.equal(asked.always.has(0), false, "it's there for this request, not for every one");
  // A request that shares only everyday words with it doesn't pull it in.
  assert.ok(!fitMemory(text, 5000, "Please make the tables look better and use fewer headings").text.includes("heron-7"));
  // Words are matched by their roots, and a path by its parts.
  assert.ok(fitMemory(text, 5000, "we are deploying again: which server was staging?").text.includes("heron-7"));
});

test("a pinned line is always loaded, but pins can't take the whole room", () => {
  const rule = `- 2026-01-02 ${PIN} Never push to main: open a pull request.`;
  const text = [rule, ...filler(70)].join("\n");
  const fit = fitMemory(text, 5000, "tidy the changelog");
  assert.ok(fit.text.includes("Never push to main"));
  assert.equal(fit.always.has(0), true);
  // Pin everything and the newest still get their share.
  const all = filler(70).map((l) => withPin(l, true));
  const crowded = fitMemory([...all, "- 2026-04-01 The newest line of all"].join("\n"), 5000);
  assert.ok(crowded.text.includes("The newest line of all"));
  assert.equal(crowded.always.has(70), true, "the newest line keeps its place whatever is pinned");
  assert.ok(crowded.left > 0 && crowded.text.length <= 5000, "pins past their share compete for room like any other line");
});

test("a heading comes along with the lines kept from under it, and only then", () => {
  const text = ["## Deploys", HERON, "## Writing", ...filler(70)].join("\n");
  const asked = fitMemory(text, 5000, "deploy to staging");
  assert.match(asked.text, /## Deploys\n- 2026-01-05 The staging server/);
  assert.ok(!fitMemory(text, 5000, "").text.includes("## Deploys"));
});

// A crew member's brief from the Quartermaster runs to hundreds of words, and shares a few with
// every line of a working memory. Being loaded "because it bears on this request" has to mean more
// than that.
const NOTES = [
  "- 2026-02-01 In the billing repo the shell can't see the links folder: use the real path when you run a command there.",
  "- 2026-02-02 Jest path patterns are regexes: escape the brackets in a folder name or the test run matches no file.",
  "- 2026-02-03 The bash tool may run bash rather than zsh: check which shell you're in before you use an array.",
  "- 2026-02-04 Before trusting a lint run that reports nothing, check the formatter really ran on the changed file.",
  "- 2026-02-05 Signed commits work from the bash tool when the agent socket is exported: check the signature after you commit on a branch.",
  "- 2026-02-06 After a pull in a pnpm repo, check whether the lockfile changed and install before you run a test.",
  "- 2026-02-07 Never replace a generic line pattern across a repo with sed: check each file it would change first.",
  "- 2026-02-08 The outputs folder is read-only: write a deliverable file to your own folder and report the path.",
  "- 2026-02-09 When you add a block to a big script, check each new name against the ones already in the file, then run it, then check the page it runs on, the path it's loaded from, the branch it ships on and the test that covers it, and report every change you made to the repo so the next run of the tool starts from a file that is known to work.",
  "- 2026-02-10 Browser checks: launch Chromium headless through playwright, and take a screenshot at the phone viewport as well as the desktop one.",
  "- 2026-02-11 To measure overflow in the browser, compare scrollWidth with clientWidth on the header at each viewport.",
  "- 2026-02-12 Starting a second view transition in Chromium before the first one's callback has run skips the animation.",
];
const BRIEF =
  "GOAL: verify, in a real browser, the new toggle on the static site. Open the page in Chromium headless through playwright at the desktop viewport " +
  "and at the phone viewport, and take a screenshot of each. Check that the header does not overflow at either viewport (measure it: don't judge by eye), " +
  "that the toggle keeps its state after a reload, and that the view transition plays when it's switched. Then run the test file for the toggle and check it passes. " +
  "CONTEXT: the repo is on the branch for this change; don't commit, and don't change a file outside the site's folder. The shell you run in is the bash tool. " +
  "If a check fails, report the path of the file and the line, and what you'd change. If playwright isn't installed in the repo, install it and say so. " +
  "DONE WHEN: both screenshots are saved to your own folder, the overflow measurement at each viewport is in your report, and the test run is green. " +
  "REPORT: what you ran, what you saw in the browser at each viewport, the path of each screenshot, and anything in the page that looked wrong.";

test("a long brief: only the lines that stand out from the rest bear on it, and a long line gains nothing by its length", () => {
  const text = NOTES.join("\n");
  const everyLine = NOTES.every((n) => [...wordsOf(n)].filter((w) => wordsOf(BRIEF).has(w)).length >= 2);
  assert.ok(everyLine, "the brief shares words with every line (or this test isn't testing anything)");
  const fit = fitMemory(text, Infinity, BRIEF);
  const browser = [9, 10]; // playwright and the viewports, measuring overflow
  for (const i of browser) assert.ok(fit.relevant.has(i), `the line about the browser is one that bears on it: ${NOTES[i].slice(13, 60)}`);
  assert.ok(fit.relevant.size <= NOTES.length / 2, `no more than half the lines bear on any one request (${fit.relevant.size} of ${NOTES.length} did)`);
  assert.ok(!fit.relevant.has(1) && !fit.relevant.has(6), "a line that shares only the brief's everyday words doesn't");
  // The long line shares more words with the brief than any other but one, and all of them are everyday ones.
  const shared = (n: string) => [...wordsOf(n)].filter((w) => wordsOf(BRIEF).has(w)).length;
  assert.ok(shared(NOTES[8]) > shared(NOTES[10]));
  assert.ok(!fit.relevant.has(8), "its length doesn't make it one that bears on the brief");

  // With room for about half of it, the old lines that are loaded are the ones about the browser:
  // put them first (the oldest), so they're only there if the brief earned them their place.
  const turned = [...browser.map((i) => NOTES[i]), ...NOTES.filter((_, i) => !browser.includes(i))].join("\n");
  const tight = fitMemory(turned, Math.round(turned.length * 0.6), BRIEF);
  assert.equal(tight.whole, false);
  for (const i of [0, 1]) assert.ok(tight.shown.has(i) && !tight.always.has(i), "loaded, and for this brief");

  // A short request is judged as it always was: one telling word is enough, and nothing else is pulled in.
  const short = fitMemory(text, Infinity, "why did the lint run report nothing?");
  assert.deepEqual([...short.relevant.keys()], [3]);
});

test("taking a line apart, pinning it, and matching words by their roots", () => {
  assert.deepEqual(parseEntry(`- 2026-01-02 ${PIN} Keep it short`), { date: "2026-01-02", pinned: true, text: "Keep it short" });
  assert.deepEqual(parseEntry("- No date"), { pinned: false, text: "No date" });
  assert.equal(parseEntry("## A heading"), null);
  assert.equal(withPin("- 2026-01-02 Keep it short", true), `- 2026-01-02 ${PIN} Keep it short`);
  assert.equal(withPin(`- 2026-01-02 ${PIN} Keep it short`, false), "- 2026-01-02 Keep it short");
  assert.equal(withPin("## A heading", true), "## A heading");
  for (const [a, b] of [["deploys", "deploy"], ["deployed", "deploying"], ["tests", "testing"], ["running", "run"], ["configured", "configure"], ["branches", "branch"], ["releases", "releasing"], ["processes", "processed"], ["entries", "entry"]]) {
    assert.equal(stem(a), stem(b), `${a} and ${b}`);
  }
  assert.notEqual(stem("test"), stem("text"));
  assert.ok(wordsOf("Edit src/agent.ts on 2026-01-02").has("agent") && wordsOf("Edit src/agent.ts").has("src/agent.ts"));
  assert.ok(!wordsOf("on 2026-01-02 the user").size, "dates and everyday words aren't subjects");
  assert.ok(alike("Reports go to the #eng channel on Fridays", "Send reports to the #eng-updates channel, not #eng") >= 0.5);
  assert.equal(alike("Use British spelling", "The staging server is heron-7"), 0);
  // recall finds a word by its root too.
  assert.ok(scoreText("We deployed it on Friday", searchTerms("deploys")) > 0);
  assert.equal(scoreText("We shipped it on Friday", searchTerms("deploys")), 0);
});

test("the prompt of a run carries the old line its request is about", async () => {
  writeMemory("scout", [HERON.replace(/^- /, "- "), ...filler(70)].join("\n"));
  assert.ok(fullMemory("scout").length > MEMORY_MAX_CHARS);
  assert.ok(!readMemory("scout").includes("heron-7"));
  await runDirect("scout", "What's the command to deploy to staging?");
  assert.match(systemText(api.seen.at(-1)!.body), /## Your memory[\s\S]*make ship-heron[\s\S]*## Your recent sessions/);
  assert.ok(!api.seen.at(-1)!.body.system[0].text.includes("heron-7"), "memory stays in the part of the prompt that moves, not the cached part");
  await runDirect("scout", "Summarise this week's reading.");
  assert.ok(!systemText(api.seen.at(-1)!.body).split("## Your recent sessions")[0].includes("make ship-heron"), "and a run about something else doesn't");
});

test("a project's notes are chosen the same way", async () => {
  const p = c.addProject({ name: "Web app" });
  addProjectNote(p.id, "The payments service needs VPN access; ask Dana for a seat.");
  for (let i = 0; i < 80; i++) addProjectNote(p.id, `Layout note ${i + 1}: components live under src/ui ${"y".repeat(50)}`);
  await withExpedition({ id: "r1", project: p.id, scope: [] }, async () => {
    assert.ok(!projectBlock("scout").includes("ask Dana"));
    assert.ok(projectBlock("scout", undefined, "Why can't I reach the payments service?").includes("ask Dana for a seat"));
  });
});

test("remember: a corrected line replaces the old one, a repeat adds nothing, and similar lines are pointed out", async () => {
  writeMemory("scribe", "");
  assert.equal(await remember("scribe", { entry: "Weekly reports go to the #eng channel" }), "Remembered.");
  assert.match(await remember("scribe", { entry: "Weekly reports go to the #eng channel" }), /already in your memory, word for word: nothing was added/);
  assert.equal(fullMemory("scribe").split("\n").filter(Boolean).length, 1);

  // A new line on the same subject: saved, and the agent is shown what it may be contradicting.
  const said = await remember("scribe", { entry: "Weekly reports now go to the #eng-updates channel instead" });
  assert.match(said, /^Remembered\. Already in your memory on what looks like the same subject:\n- Weekly reports go to the #eng channel\nIf the new line corrects one of these, call remember again with the same entry and replaces/);
  // It does as it's told: the old line goes, and the new one isn't added twice.
  assert.match(await remember("scribe", { entry: "Weekly reports now go to the #eng-updates channel instead", replaces: "Weekly reports go to the #eng channel" }), /The old line is gone; the new one was already in your memory/);
  assert.deepEqual(fullMemory("scribe").split("\n").filter(Boolean).map((l) => parseEntry(l)!.text), ["Weekly reports now go to the #eng-updates channel instead"]);

  // Replacing in one go, and a line to replace that isn't there.
  assert.equal(await remember("scribe", { entry: "Reports go out on Thursdays", replaces: "- 2026-01-01 weekly reports now go to the #eng-updates channel instead" }), "Remembered, in place of the old line.");
  assert.match(await remember("scribe", { entry: "Charts use the brand palette", replaces: "Something that was never there" }), /^Remembered\. \(The line to replace wasn't found/);
  assert.deepEqual(fullMemory("scribe").split("\n").filter(Boolean).map((l) => parseEntry(l)!.text), ["Reports go out on Thursdays", "Charts use the brand palette"]);
  assert.equal(await remember("scribe", { entry: "   " }), "Nothing to remember.");
});

test("pinning: from remember, from the Memory page, carried over a correction, and never handed out by a tidy", async () => {
  writeMemory("warden", "");
  await remember("warden", { entry: "Never approve a pull request yourself", pin: true });
  await remember("warden", { entry: "The api repo's tests need Docker running" });
  assert.match(fullMemory("warden"), new RegExp(`^- \\d{4}-\\d{2}-\\d{2} ${PIN} Never approve a pull request yourself\\n- \\d{4}-\\d{2}-\\d{2} The api repo's tests need Docker running$`));
  let m = k.describe("agent:warden");
  assert.deepEqual(m.lines.map((l) => [l.text, !!l.pinned]), [["Never approve a pull request yourself", true], ["The api repo's tests need Docker running", false]]);

  // You pin and unpin a line from the page; the line is found by its words, pinned or not.
  assert.equal(k.pinLine("agent:warden", "The api repo's tests need Docker running", true), true);
  assert.equal(k.pinLine("agent:warden", "Never approve a pull request yourself", false), true);
  assert.equal(k.pinLine("agent:warden", "No such line", true), false);
  assert.throws(() => k.pinLine("about", "anything", true), /nothing to pin/);
  m = k.describe("agent:warden");
  assert.deepEqual(m.lines.map((l) => !!l.pinned), [false, true]);
  assert.equal(k.forgetLine("agent:warden", "The api repo's tests need Docker running"), true, "a pinned line is forgotten by its words like any other");

  // A correction to a pinned rule is still a rule.
  await remember("warden", { entry: "Reviews go to the author first", pin: true });
  await remember("warden", { entry: "Reviews go to the author first, then the channel", replaces: "Reviews go to the author first" });
  assert.match(fullMemory("warden"), new RegExp(`${PIN} Reviews go to the author first, then the channel`));

  // Once a memory is long, what's marked "loaded" is what loads whatever the request: pins and the newest.
  writeMemory("warden", [`- 2026-01-02 ${PIN} Never approve a pull request yourself`, HERON, ...filler(70)].join("\n"));
  m = k.describe("agent:warden");
  assert.equal(m.lines[0].loaded, true, "pinned, however old");
  assert.equal(m.lines[1].loaded, false, "old and unpinned: only when a request is about it");
  assert.equal(m.lines.at(-1)!.loaded, true);
  assert.equal(m.unloaded, m.lines.filter((l) => !l.loaded).length);

  // A tidy keeps your pins and can't add its own.
  const before = `- 2026-01-02 ${PIN} Never approve a pull request yourself\n- 2026-01-03 Never approve PRs yourself\n- 2026-01-04 Use British spelling\n- 2026-01-05 Use British spelling in docs`;
  const after = k.cleanTidy(before, `- 2026-01-03 ${PIN} Never approve a pull request yourself\n- 2026-01-05 ${PIN} Use British spelling in docs`);
  assert.equal(after, `- 2026-01-03 ${PIN} Never approve a pull request yourself\n- 2026-01-05 Use British spelling in docs`);
});
