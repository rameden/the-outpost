// The plan → dispatch → check loop, held to in code rather than by what a prompt asks for:
// a step marked "(after …)" doesn't start before those steps are back, two quests that change
// files in the same folder take turns, a change is reviewed before the summary goes out when
// review is on, and a folder with no checks says so. Against a fake API, in a real linked folder.
// (Ordered by what happens, never by the clock: nothing here waits a number of milliseconds.)
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox, NEEDS_SH } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, whoAsks, type Reply } from "./helpers/fake-api.ts";

enterSandbox("coreloop");
let script: (body: any) => Reply | Promise<Reply> = () => ({ text: "ok" });
const api = await startFakeApi((body) => script(body));
process.env.ANTHROPIC_BASE_URL = api.url; // must be set before src/agent.ts loads

// A repository to work in, linked with edit access. No worktree: every quest works in the folder itself.
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-loop-")));
const repo = join(scratch, "web");
mkdirSync(repo);
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
writeFileSync(join(repo, "app.txt"), "v1\n");
git("add", "-A");
git("commit", "-qm", "first");

const { runExpedition, runDirect, waitsOn, campReviewBrief } = await import("../src/quartermaster.ts");
const { lockFolders, canChangeFolders, foldersToLock, folderLocksForTests } = await import("../src/folderlock.ts");
const { likelyChecks, checkChanges, noChecksNote } = await import("../src/verify.ts");
const { withExpedition, withQuest } = await import("../src/context.ts");
const { addLink, setLinkVerify } = await import("../src/links.ts");
const { setRunFoundChecks, runFoundChecksOn } = await import("../src/settings.ts");
const { setAsker } = await import("../src/ask.ts");
const { onEvent } = await import("../src/events.ts");
const { ROSTER } = await import("../src/roster.ts");
const { rl, writeFileFor } = await import("../src/tools.ts");
after(async () => { rl.close(); await api.close(); });

const link = addLink(repo, "write");
const L = `links/${link.name}`;

setAsker(async () => ""); // every plan is approved as it stands
const events: any[] = [];
onEvent((e) => events.push(e));
beforeEach(() => { events.length = 0; api.seen.length = 0; });

const firstAsk = (b: any): string => { const c = b.messages[0].content; return typeof c === "string" ? c : c.map((x: any) => x.text ?? "").join("\n"); };
const went = (who: string) => api.seen.filter((s) => s.who === who && isFirstTurn(s.body)).length;
const at = (find: (e: any) => boolean) => events.findIndex(find);
const noticed = (re: RegExp) => events.some((e) => e.type === "notice" && re.test(e.text));
// A crew member's turn that writes one file, then reports.
const writes = (b: any, path: string, content: string, report: string): Reply =>
  isFirstTurn(b) ? { tools: [{ name: "write_file", input: { path, content } }] } : { text: report };

// ---------- 1. Plan steps wait for the steps they come after ----------

test("a step marked (after …) isn't sent until those steps are back: the dispatch is refused, naming what it waits on", async () => {
  const refusals: string[] = [];
  let turn = 0;
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout") return { text: "Scout: found it." };
    if (who === "Scribe") return { text: "Scribe: written up." };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. (after 1) Scribe writes it up" } }] };
    if (/Not sent: step/.test(res)) refusals.push(res);
    turn++;
    // Sent before step 1 at all, then in the same turn as step 1, then once step 1 is back.
    if (turn === 1) return { tools: [{ name: "dispatch", input: { adventurer: "scribe", brief: "write", step: 2 } }] };
    if (turn === 2) return { tools: [
      { name: "dispatch", input: { adventurer: "scout", brief: "look", step: 1 } },
      { name: "dispatch", input: { adventurer: "scribe", brief: "write", step: 2 } },
    ] };
    if (turn === 3) return { tools: [{ name: "dispatch", input: { adventurer: "scribe", brief: "write, with what the Scout found", step: 2 } }] };
    return { text: "Done." };
  };
  const r = await runExpedition("Look it up and write it up");
  assert.equal(r.status, "done");
  assert.equal(refusals.length, 2, "refused twice: once alone, once beside step 1");
  assert.match(refusals[0], /Not sent: step 2 of the plan starts after step 1 \(not sent yet\), and that hasn't finished\./);
  assert.match(refusals[0], /then dispatch step 2 again/);
  assert.match(refusals[1], /Not sent: step 2 of the plan starts after step 1 \(still out\)/);
  assert.match(refusals[1], /Scout's report:\nScout: found it\./, "step 1 went out in that same turn");
  assert.equal(went("Scout"), 1);
  assert.equal(went("Scribe"), 1, "the Scribe set out once, after the Scout was back");
  assert.deepEqual(events.filter((e) => e.type === "dispatch").map((e) => [e.who, e.step]), [["Scout", 1], ["Scribe", 2]]);
  assert.ok(at((e) => e.type === "return" && e.who === "Scout") < at((e) => e.type === "dispatch" && e.who === "Scribe"), "the Scout was back before the Scribe set out");
  assert.ok(noticed(/Step 2 isn't sent yet: it starts after step 1/), "the user is shown why nothing went");
  const approval = api.seen.map((s) => lastToolResults(s.body)).find((t) => /approved the plan/.test(t)) ?? "";
  assert.match(approval, /A step marked \(after …\) is held until those steps' reports are back/, "the Quartermaster is told the rule with the approval");
});

test("only steps of the plan are held: a dispatch with no step number goes, and a plan with no markers holds nothing", async () => {
  let turn = 0;
  script = (b) => {
    const who = whoAsks(b);
    if (who === "Scout" || who === "Scribe") return { text: `${who} back.` };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. (after 1) Scribe writes it up" } }] };
    if (++turn === 1) return { tools: [{ name: "dispatch", input: { adventurer: "scribe", brief: "a side errand" } }] };
    return { text: "Done." };
  };
  assert.equal((await runExpedition("An errand outside the plan")).status, "done");
  assert.equal(went("Scribe"), 1, "no step number: nothing to wait for");

  turn = 0;
  api.seen.length = 0;
  script = (b) => {
    const who = whoAsks(b);
    if (who === "Scout" || who === "Scribe") return { text: `${who} back.` };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. Scribe writes it up" } }] };
    if (++turn === 1) return { tools: [{ name: "dispatch", input: { adventurer: "scribe", brief: "write", step: 2 } }] };
    return { text: "Done." };
  };
  assert.equal((await runExpedition("Out of order, and allowed to be")).status, "done");
  assert.equal(went("Scribe"), 1, "step 2 has no (after …): it can go first");
});

test("a revised plan keeps what was finished: an unchanged step stays done, a reworded one has to run again", async () => {
  const refusals: string[] = [];
  let turn = 0;
  script = (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scout" || who === "Scribe" || who === "Warden") return { text: `${who} back.` };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. (after 1) Scribe writes it up" } }] };
    if (/Not sent: step/.test(res)) refusals.push(res);
    turn++;
    if (turn === 1) return { tools: [{ name: "dispatch", input: { adventurer: "scout", brief: "look", step: 1 } }] };
    // Step 1 as it was, a new step 3 after it: step 1 is still done.
    if (turn === 2) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks it up\n2. (after 1) Scribe writes it up\n3. (after 1) Warden reads it" } }] };
    if (turn === 3) return { tools: [{ name: "dispatch", input: { adventurer: "warden", brief: "read", step: 3 } }] };
    // Step 1 is now different work: what was done under the old words doesn't count for it.
    if (turn === 4) return { tools: [{ name: "submit_plan", input: { plan: "1. Scout looks up something else\n2. (after 1) Scribe writes it up" } }] };
    if (turn === 5) return { tools: [{ name: "dispatch", input: { adventurer: "scribe", brief: "write", step: 2 } }] };
    return { text: "Done." };
  };
  assert.equal((await runExpedition("Plan, then change the plan")).status, "done");
  assert.equal(went("Warden"), 1, "step 3 went: step 1 was already done under the plan before");
  assert.equal(went("Scribe"), 0);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /step 2 of the plan starts after step 1 \(not sent yet\)/);
});

test("what a step waits on: steps still out, not sent, or back without finishing", () => {
  const steps = [{ n: 1, text: "a" }, { n: 2, text: "b" }, { n: 3, text: "c", after: [1, 2] }, { n: 4, text: "d", after: [3] }];
  const board = { steps, out: new Map<number, number>(), done: new Set<number>(), ended: new Map<number, string>() };
  assert.deepEqual(waitsOn(board, 1), [], "no marker, nothing to wait for");
  assert.deepEqual(waitsOn(board, 3).map((h) => `${h.n}: ${h.state}`), ["1: not sent yet", "2: not sent yet"]);
  board.out.set(1, 1);
  board.done.add(2);
  assert.deepEqual(waitsOn(board, 3).map((h) => `${h.n}: ${h.state}`), ["1: still out"]);
  board.out.set(1, 0);
  board.ended.set(1, "out of turns");
  assert.match(waitsOn(board, 3)[0].state, /came back without finishing: out of turns/);
  board.done.add(1);
  board.out.set(1, 1); // sent again while done: its newest report isn't back
  assert.deepEqual(waitsOn(board, 3).map((h) => h.state), ["still out"]);
  board.out.set(1, 0);
  assert.deepEqual(waitsOn(board, 3), []);
  assert.deepEqual(waitsOn(board, 4).map((h) => `${h.n}: ${h.state}`), ["3: not sent yet"], "step 3 is free to go now, and step 4 waits for it in turn");
  assert.deepEqual(waitsOn(undefined, 3), [], "no plan stands: nothing is held");
});

// ---------- 2. One writer at a time in a linked folder ----------

// Holds the first writer's first reply until it is known which way the two ran: the other
// writer's request arrives while the first is still out (side by side in the folder), or the
// camp says the other is waiting for the folder (taking turns). One or the other always happens.
function watchTwoWriters() {
  const out = new Set<string>();
  let overlapped = false;
  let letGo!: () => void;
  const settled = new Promise<void>((ok) => (letGo = ok));
  const giveUp = setTimeout(letGo, 15_000); // never reached unless neither happened; then the asserts say so
  const off = onEvent((e: any) => { if (e.type === "notice" && /is waiting for .* to finish in links\//.test(e.text)) letGo(); });
  return {
    asked: async (name: string) => {
      out.add(name);
      if (out.size === 2) { overlapped = true; letGo(); }
      await settled;
    },
    back: (name: string) => out.delete(name),
    done: () => { clearTimeout(giveUp); letGo(); if (typeof off === "function") off(); },
    overlapped: () => overlapped,
  };
}

test("two quests that change files in the same linked folder take turns; neither starts while the other is in it", async () => {
  const watch = watchTwoWriters();
  script = async (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Scribe" || who === "Artificer") {
      if (isFirstTurn(b)) { await watch.asked(who); return { tools: [{ name: "write_file", input: { path: `${L}/${who}.txt`, content: `${who} was here\n` } }] }; }
      watch.back(who);
      return { text: `${who} wrote its file.` };
    }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "scribe", brief: "write your file" } },
      { name: "dispatch", input: { adventurer: "artificer", brief: "write your file" } },
    ] };
    return { text: "Both back." };
  };
  const r = await runExpedition("Two changes in one folder").finally(watch.done);
  assert.equal(r.status, "done");
  assert.ok(!watch.overlapped(), "both quests were working in the folder at the same time");
  const order = events.filter((e) => e.type === "dispatch" || e.type === "return").map((e) => `${e.type} ${e.who}`);
  assert.deepEqual(order, ["dispatch Scribe", "return Scribe", "dispatch Artificer", "return Artificer"], "the second set out when the first was back");
  assert.ok(noticed(new RegExp(`Artificer's \\{quest\\} is waiting for Scribe's to finish in ${L}`)), "the user is told what it's waiting for");
  assert.equal(readFileSync(join(repo, "Scribe.txt"), "utf8"), "Scribe was here\n");
  assert.equal(readFileSync(join(repo, "Artificer.txt"), "utf8"), "Artificer was here\n");
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 }, "the folder is free again");
});

// Side by side, proven by order as in agent.test.ts: each reply is held until both have asked.
function holdUntilBothAsk(giveUpMs = 10_000) {
  const out = new Set<string>();
  let together = false;
  let letGo!: () => void;
  const held = new Promise<void>((ok) => (letGo = ok));
  const giveUp = setTimeout(letGo, giveUpMs);
  return {
    asked: async (name: string) => { out.add(name); if (out.size === 2) { together = true; letGo(); } await held; out.delete(name); },
    done: () => { clearTimeout(giveUp); letGo(); },
    together: () => together,
  };
}

test("quests that only read stay side by side with one that writes", async () => {
  const hold = holdUntilBothAsk();
  script = async (b) => {
    const who = whoAsks(b), res = lastToolResults(b);
    if (who === "Artificer" || who === "Warden") { await hold.asked(who); return { text: `${who} back.` }; }
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "both at once" } }] };
    if (res.includes("approved the plan")) return { tools: [
      { name: "dispatch", input: { adventurer: "artificer", brief: "build" } },
      { name: "dispatch", input: { adventurer: "warden", brief: "read" } },
    ] };
    return { text: "Both back." };
  };
  const r = await runExpedition("Build and read").finally(hold.done);
  assert.equal(r.status, "done");
  assert.ok(hold.together(), "the Warden waited for the Artificer, though it changes nothing");
  assert.ok(!noticed(/is waiting for .* to finish in links\//));
});

test("who takes a folder: those who can change files in it, and only for folders linked with edit access", async () => {
  assert.deepEqual(
    Object.fromEntries(["scout", "scribe", "artificer", "warden", "wizard"].map((id) => [id, canChangeFolders(ROSTER[id])])),
    { scout: false, scribe: true, artificer: true, warden: false, wizard: true },
    "the Scout's write_file is kept to its own outputs; the Warden has nothing that writes");
  const seen = await withExpedition({ id: "exp-folders" }, async () => ({ writer: foldersToLock(ROSTER.artificer), reader: foldersToLock(ROSTER.warden) }));
  assert.deepEqual(seen.writer, [{ name: link.name, root: repo }]);
  assert.deepEqual(seen.reader, []);
});

test("the folder lock: first come first served, all folders taken at once, and Stop ends the wait", async () => {
  const order: string[] = [];
  const a = await lockFolders(["/x"], "A");
  assert.ok(a);
  const b = lockFolders(["/x", "/y"], "B", undefined, (holder, folder) => order.push(`B waits for ${holder} in ${folder}`)).then((free) => { order.push("B in"); return free; });
  const c = lockFolders(["/x"], "C", undefined, (holder) => order.push(`C waits for ${holder}`)).then((free) => { order.push("C in"); return free; });
  // B is waiting for /x and holds nothing meanwhile: /y is still free for someone else.
  const d = await lockFolders(["/y"], "D");
  assert.ok(d, "a quest waiting for one folder doesn't sit on another");
  d();
  assert.equal(folderLocksForTests.now().waiting, 2);
  a();
  a(); // freeing twice frees once
  const freeB = await b;
  assert.deepEqual(order, ["B waits for A in /x", "C waits for A", "B in"], "B came first, so B goes first");
  assert.deepEqual(folderLocksForTests.now().held, { "/x": "B", "/y": "B" });
  freeB!();
  (await c)!();
  assert.equal(order.at(-1), "C in");

  const stop = new AbortController();
  const held = await lockFolders(["/z"], "A");
  const waiting = lockFolders(["/z"], "B", stop.signal);
  stop.abort();
  assert.equal(await waiting, null, "stopped while waiting: it never takes the folder");
  assert.deepEqual(folderLocksForTests.now(), { held: { "/z": "A" }, waiting: 0 });
  held!();
  assert.equal(await lockFolders(["/z"], "B", stop.signal), null, "already stopped: it doesn't take a free folder either");
  assert.ok(await lockFolders([], "nobody"), "nothing to take: straight through");
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
});

test("talking to a crew member directly waits for the folder too, and is told why", async () => {
  const taken = await lockFolders([repo], "Scribe"); // someone else's quest is in the folder
  let asked!: () => void;
  const artificerAsked = new Promise<void>((ok) => (asked = ok));
  script = (b) => { if (whoAsks(b) === "Artificer") asked(); return { text: "Artificer back." }; };
  const waitingNotice = new Promise<void>((ok) => onEvent((e: any) => { if (e.type === "notice" && /Waiting for Scribe's quest to finish in links\//.test(e.text)) ok(); }));
  const run = runDirect("artificer", "Change something");
  await waitingNotice;
  assert.equal(went("Artificer"), 0, "nothing was asked of the model while the folder was taken");
  taken!();
  await artificerAsked;
  assert.equal((await run)?.status, "done");
  assert.deepEqual(folderLocksForTests.now(), { held: {}, waiting: 0 });
});

// ---------- 3. Review and checks that don't depend on what the prompt asks for ----------

const FINDINGS = "```findings\n[]\n```";
// A Quartermaster that has the Artificer change one file and then reports, with or without a review of its own.
function changeThenReport(file: string, opts: { ownReview?: boolean; warden?: (b: any) => Reply } = {}) {
  let turn = 0;
  return (b: any): Reply => {
    const who = whoAsks(b);
    if (who === "Artificer") return writes(b, `${L}/${file}`, `export const at = ${Date.now()};\n`, "Artificer: changed it.");
    if (who === "Warden") return opts.warden?.(b) ?? { text: `Warden: read it, nothing wrong.\n${FINDINGS}` };
    if (isFirstTurn(b)) return { tools: [{ name: "submit_plan", input: { plan: "1. Artificer makes the change" } }] };
    turn++;
    if (turn === 1) return { tools: [{ name: "dispatch", input: { adventurer: "artificer", brief: "make the change" } }] };
    if (turn === 2 && opts.ownReview) return { tools: [{ name: "dispatch", input: { adventurer: "warden", brief: "review the change" } }] };
    return { text: "Done: the change is made." };
  };
}

test("review on: a change nobody reviewed is reviewed before the summary goes out, whatever the Quartermaster did", async () => {
  script = changeThenReport("feature.ts");
  const r = await runExpedition("Add the feature\nand keep it small", { review: true });
  assert.equal(r.status, "done");
  assert.equal(went("Warden"), 1, "the camp sent the Warden itself");
  const brief = firstAsk(api.seen.find((s) => s.who === "Warden")!.body);
  assert.match(brief, /What the user asked for:\n> Add the feature\n> and keep it small/);
  assert.match(brief, new RegExp(`Files changed:\\n- ${L}/feature\\.ts \\(created\\)`));
  assert.match(brief, /```findings/, "the brief asks for findings in the usual form");
  assert.match(r.text, /^Done: the change is made\.\n\n## Review\n/);
  assert.match(r.text, /Warden: read it, nothing wrong\./);
  assert.ok(noticed(/Review is on and this change hasn't been reviewed: sending Warden/));
  const end = events.find((e) => e.type === "expedition_end");
  assert.match(end.text, /## Review/, "the record of the run carries the review");
  assert.ok(at((e) => e.type === "return" && e.who === "Warden") < at((e) => e.type === "expedition_end"), "the review was back before the run ended");
  assert.ok(events.some((e) => e.type === "text" && e.depth === 0 && /^## Review/.test(e.text)), "and it is shown under the summary as it arrives");
});

test("review on: no second review when the Quartermaster had the change reviewed", async () => {
  script = changeThenReport("reviewed.ts", { ownReview: true });
  const r = await runExpedition("Add it and review it", { review: true });
  assert.equal(went("Warden"), 1);
  assert.doesNotMatch(r.text, /## Review/);
});

test("nobody is sent to review when review is off, the change is only docs, or nothing changed", async () => {
  script = changeThenReport("unreviewed.ts");
  let r = await runExpedition("Review is off here", { review: false });
  assert.doesNotMatch(r.text, /## Review/);

  script = changeThenReport("NOTES.md");
  r = await runExpedition("Only notes", { review: true });
  assert.doesNotMatch(r.text, /## Review/);

  script = () => ({ text: "Nothing to change." });
  r = await runExpedition("A question", { review: true });
  assert.equal(r.text, "Nothing to change.");
  assert.equal(went("Warden"), 0);
});

test("review on: a review that doesn't finish is said plainly, not passed off as a review", async () => {
  script = changeThenReport("refused.ts", { warden: () => ({ text: "", stop: "refusal" }) });
  const r = await runExpedition("Add it", { review: true });
  assert.equal(r.status, "done");
  assert.match(r.text, /## Review\nReview is on, so the camp sent Warden to review this change before the summary went out, but the review didn't finish \(refused\)\. The change has not been reviewed\./);
});

test("the review brief is written by the camp: the ask, the files, and a long list cut short", () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ path: `${L}/f${i}.ts`, change: "modified" }));
  const brief = campReviewBrief("", many);
  assert.match(brief, /> \(not given\)/);
  assert.match(brief, /- links\/web\/f59\.ts \(modified\)\n- … and 10 more/);
  assert.doesNotMatch(brief, /f60\.ts/);
  assert.match(brief, /Don't change any files\./);
});

test("likely checks are found from what the folder holds, in fixed forms only", () => {
  const dir = (files: Record<string, string>) => {
    const d = mkdtempSync(join(scratch, "found-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    return d;
  };
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
  assert.deepEqual(likelyChecks(dir({ "package.json": pkg({ test: "node --test", typecheck: "tsc --noEmit", lint: "eslint .", build: "vite build", deploy: "rm -rf /" }) })),
    ["npm run typecheck", "npm run lint", "npm test"], "only typecheck, lint and test, by name: never what a script says");
  assert.deepEqual(likelyChecks(dir({ "package.json": pkg({ test: 'echo "Error: no test specified" && exit 1', lint: "eslint ." }), "pnpm-lock.yaml": "" })), ["pnpm run lint"], "the test script npm init leaves isn't one");
  assert.deepEqual(likelyChecks(dir({ "package.json": pkg({ test: "vitest" }), "yarn.lock": "" })), ["yarn run test"]);
  assert.deepEqual(likelyChecks(dir({ Makefile: "build:\n\tcc main.c\ntest: build\n\t./a.out\ncheck := not a target\nlint :\n\ttrue\n" })), ["make lint", "make test"]);
  assert.deepEqual(likelyChecks(dir({ "Cargo.toml": "[package]\n" })), ["cargo check", "cargo test"]);
  assert.deepEqual(likelyChecks(dir({ "go.mod": "module x\n" })), ["go vet ./...", "go test ./..."]);
  assert.deepEqual(likelyChecks(dir({ "package.json": "{ not json", "README.md": "hi" })), []);
  assert.equal(likelyChecks(dir({ "package.json": pkg({ test: "t", typecheck: "t", lint: "t" }), Makefile: "check:\nlint:\ntest:\n", "Cargo.toml": "", "go.mod": "" })).length, 6, "never a long list");
});

test("a folder with no checks says so: nothing ran, here is what could, and nobody is sent back for it", async () => {
  const run = (expedition: string, quest: string, path: string) => withExpedition({ id: expedition }, () => withQuest(quest, async () => {
    await writeFileFor("artificer").run!({ path, content: "x\n" });
    return checkChanges(quest, { who: "Artificer", emoji: "🔨" });
  }));
  let out = await run("exp-none", "q-none", `${L}/src/a.ts`);
  assert.equal(out.text, `No automatic checks ran in ${L}: none are set up for that folder. The camp found none there it could suggest.`);
  assert.deepEqual(out.unchecked, [{ link: link.name, found: [] }]);

  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('ran.txt','yes')\"", lint: "node -e \"process.exit(3)\"" } }));
  out = await run("exp-found", "q-found", `${L}/src/b.ts`);
  assert.equal(out.text, noChecksNote(link.name, ["npm run lint", "npm test"]));
  assert.match(out.text, /Likely ones found there: `npm run lint`, `npm test`\. Added as the folder's checks/);
  assert.doesNotMatch(out.text, /^✗ /m, "nothing failed: the fix loop has nothing to act on");
  assert.deepEqual(out.unchecked, [{ link: link.name, found: ["npm run lint", "npm test"] }]);
  assert.throws(() => readFileSync(join(repo, "ran.txt")), "found commands are not run unless that is turned on");

  out = await run("exp-docs", "q-docs", `${L}/docs/guide.md`);
  assert.deepEqual(out, { text: "", unchecked: [] }, "a docs-only change isn't flagged");

  setLinkVerify(link.name, ["test -f package.json"]);
  out = await run("exp-set", "q-set", `${L}/src/c.ts`);
  assert.match(out.text, new RegExp(`^Automatic checks in ${L} \\(run by the camp after the changes\\):\\n✓ test -f package\\.json`));
  assert.deepEqual(out.unchecked, [], "your own checks ran: nothing to flag");
  setLinkVerify(link.name, []);
});

test("found checks run only when that is turned on, and then say where they came from", { skip: NEEDS_SH }, async () => {
  assert.equal(runFoundChecksOn(), false, "off unless you turn it on");
  setRunFoundChecks(true);
  try {
    const out = await withExpedition({ id: "exp-auto" }, () => withQuest("q-auto", async () => {
      await writeFileFor("artificer").run!({ path: `${L}/src/d.ts`, content: "x\n" });
      return checkChanges("q-auto", { who: "Artificer", emoji: "🔨" });
    }));
    assert.match(out.text, new RegExp(`^Automatic checks in ${L} \\(none are set up for it: these were found there and run by the camp after the changes\\):`));
    assert.match(out.text, /✗ npm run lint\n/);
    assert.match(out.text, /✓ npm test/);
    assert.equal(readFileSync(join(repo, "ran.txt"), "utf8"), "yes");
    assert.deepEqual(out.unchecked, []);
  } finally {
    setRunFoundChecks(false);
  }
  assert.equal(runFoundChecksOn(), false);
});

test("the summary says which folders nothing checked, without the Quartermaster having to pass it on", async () => {
  script = changeThenReport("unchecked.ts");
  const r = await runExpedition("Change it", { review: false });
  assert.equal(r.status, "done");
  assert.match(r.text, new RegExp(`^Done: the change is made\\.\\n\\nNo automatic checks ran in ${L}: none are set up for that folder\\. Likely ones found there: \`npm run lint\`, \`npm test\`\\.`));
  const report = api.seen.map((s) => lastToolResults(s.body)).find((t) => /Artificer's report:/.test(t)) ?? "";
  assert.match(report, /Artificer: changed it\.\n\nNo automatic checks ran in/, "the Quartermaster sees it with the report too");
  assert.equal(went("Artificer"), 1, "it isn't a failure: nobody is sent back");
});
