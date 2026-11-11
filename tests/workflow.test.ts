// From a ticket to a merged pull request: a ticket's acceptance criteria, someone stepping
// into a conversation for one turn, a pull request description drafted from the record, the
// watch on open pull requests, writing back to Jira (off unless you turn it on), chained
// requests, and the weekly chronicle. Jira and the GitHub CLI are stand-ins here.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("workflow");

// ---------- A repository to work in, with a remote, and a stand-in for gh ----------
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "satchel-flow-")));
const repo = join(scratch, "web");
mkdirSync(repo);
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(scratch, "init", "-q", "--bare", "remote.git");
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "test@example.com");
git(repo, "config", "user.name", "Test");
writeFileSync(join(repo, "app.txt"), "v1\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "first");
git(repo, "remote", "add", "origin", join(scratch, "remote.git"));

const bin = join(scratch, "bin");
mkdirSync(bin);
const GH_PR = join(scratch, "pr.json"), GH_LOG = join(scratch, "gh.log");
writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "${GH_LOG}"
case "$1 $2" in
  "pr view") if [ -f "${GH_PR}" ]; then cat "${GH_PR}"; else echo "no pull requests found for branch" >&2; exit 1; fi;;
  "pr edit") echo "https://github.com/o/r/pull/7";;
  *) echo "unexpected: $*" >&2; exit 2;;
esac
`);
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const ghCalls = () => (existsSync(GH_LOG) ? readFileSync(GH_LOG, "utf8").trim().split("\n").filter(Boolean) : []);

// ---------- A stand-in for Jira ----------
const TOKEN = "fake-jira-token";
const text = (t: string) => ({ type: "text", text: t });
const para = (t: string) => ({ type: "paragraph", content: [text(t)] });
const ISSUE = {
  id: "1", key: "MP-544",
  fields: {
    summary: "Open button on file citations", status: { name: "To Do", statusCategory: { key: "new" } }, project: { key: "MP" }, issuetype: { name: "Story" },
    labels: [], updated: "2026-11-09T10:00:00.000+0000",
    description: { type: "doc", version: 1, content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Acceptance criteria")] },
      { type: "bulletList", content: [{ type: "listItem", content: [para("An Open button on web reports")] }, { type: "listItem", content: [para("Closing returns to the chat")] }] },
    ] },
    comment: { total: 0, comments: [] },
  },
};
const seen: { method: string; url: string; body: any }[] = [];
let transitions = [{ id: "21", name: "Start progress", to: { name: "In Progress" } }, { id: "31", name: "Send to review", to: { name: "In Review" } }];
const jira = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method!, url: req.url!, body });
    const json = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
    if (req.headers.authorization !== `Basic ${Buffer.from(`me@example.com:${TOKEN}`).toString("base64")}`) return json(401, { errorMessages: [] });
    if (req.url === "/rest/api/3/myself") return json(200, { accountId: "abc", displayName: "Ryley A" });
    if (req.method === "POST" && req.url === "/rest/api/3/issue/MP-544/comment") return json(201, { id: "900" });
    if (req.method === "GET" && req.url === "/rest/api/3/issue/MP-544/transitions") return json(200, { transitions });
    if (req.method === "POST" && req.url === "/rest/api/3/issue/MP-544/transitions") return json(204, undefined);
    if (req.url!.startsWith("/rest/api/3/issue/MP-544")) return json(200, ISSUE);
    if (req.url === "/rest/api/3/search/jql") return json(200, { issues: [] });
    json(404, { errorMessages: ["Issue does not exist."] });
  });
});
await new Promise<void>((ok) => jira.listen(0, "127.0.0.1", ok));
const SITE = `http://127.0.0.1:${(jira.address() as AddressInfo).port}`;
process.env.JIRA_ALLOW_ANY_HOST = "1";

const j = await import("../src/jira.ts");
const { addLink, setLinkVerify } = await import("../src/links.ts");
const repos = await import("../src/repos.ts");
const prs = await import("../src/prs.ts");
const { recordTurn, threadFor, allTurns } = await import("../src/threads.ts");
const conv = await import("../src/conversations.ts");
const { chainReady, chainNote } = await import("../src/chains.ts");
const chron = await import("../src/chronicle.ts");
const settings = await import("../src/settings.ts");
const review = await import("../src/review.ts");
const payoff = await import("../src/payoff.ts");
const { REVIEW_RULE, reviewsHere } = await import("../src/quartermaster.ts");
const { giveFeedback } = await import("../src/feedback.ts");
const { QUEST_LOG_PATH } = await import("../src/questlog.ts");
const { rl } = await import("../src/tools.ts");
after(async () => { rl.close(); await new Promise((ok) => jira.close(ok)); rmSync(scratch, { recursive: true, force: true }); });
beforeEach(() => { seen.length = 0; rmSync(GH_LOG, { force: true }); });

const link = addLink(repo, "write");
setLinkVerify(link.name, ["npm test"]);
const project = conv.addProject({ name: "Web app", links: [link.name] });

test("a ticket's acceptance criteria are picked out of its description, however the heading is written", () => {
  assert.deepEqual(j.extractCriteria("Some context.\n\n## Acceptance criteria\n\n- An Open button\n- Closing returns to the chat\n\n## Notes\n- not this"), ["An Open button", "Closing returns to the chat"]);
  assert.deepEqual(j.extractCriteria("**Acceptance Criteria:**\n1. First\n2) Second\n\nAnd a paragraph."), ["First", "Second"]);
  assert.deepEqual(j.extractCriteria("Acceptance criteria\n[ ] Ticked later\n[x] Already so"), ["Ticked later", "Already so"]);
  assert.deepEqual(j.extractCriteria("Nothing of the kind here.\n- a list that isn't criteria"), []);
});

test("a ticket in full carries its criteria", async () => {
  await j.connectJira({ siteUrl: SITE, email: "me@example.com", apiToken: TOKEN });
  const t = await j.ticketDetail("MP-544");
  assert.deepEqual(t.criteria, ["An Open button on web reports", "Closing returns to the chat"]);
});

// ---------- A conversation that works on the ticket, in its own worktree ----------
let ws: Awaited<ReturnType<typeof repos.prepareWorkspaces>>;
test("starting from a ticket: the worktree's branch is the name you gave it, and the conversation is tied to the ticket", async () => {
  ws = await repos.prepareWorkspaces({ [link.name]: { mode: "new", branch: "MP-544-open-button" } }, "Work on MP-544", "aaaa1111");
  const w = ws[link.name];
  assert.equal(w.branch, "MP-544-open-button");
  assert.equal(git(w.path, "rev-parse", "--abbrev-ref", "HEAD"), "MP-544-open-button");
  recordTurn({ thread: "run1", expedition: "run1", agent: "quartermaster", direct: false, task: "Work on MP-544: Open button on file citations", reply: "", status: "running", workspaces: ws, jira: "MP-544" });
  writeFileSync(join(w.path, "app.txt"), "v1\nopen button\n");
  writeFileSync(join(w.path, "open.ts"), "export const open = () => true;\n");
  await repos.commitWorkspace(w, "Add the Open button");
  recordTurn({ thread: "run1", expedition: "run1", agent: "quartermaster", direct: false, task: "Work on MP-544: Open button on file citations", status: "done", workspaces: ws, jira: "MP-544",
    reply: `Added the Open button and wired it to the viewer.\n\nAutomatic checks in links/${link.name} (run by the camp after the changes):\n✓ npm test` });
  conv.fileConversation("run1", project.id);
  const c = conv.history().conversations.find((x) => x.id === "run1")!;
  assert.equal(c.jira, "MP-544");
  assert.equal(threadFor("run1")!.jira, "MP-544");
  // A branch by that name already there: the next one gets a number rather than failing.
  const again = await repos.prepareWorkspaces({ [link.name]: { mode: "new", branch: "MP-544-open-button" } }, "x", "bbbb2222");
  assert.equal(again[link.name].branch, "MP-544-open-button-2");
  await repos.removeWorkspace(again[link.name]);
});

test("someone stepping in for a turn reads the conversation as another's work, and doesn't take it over", () => {
  recordTurn({ thread: "run1", expedition: "run2", agent: "scout", direct: true, aside: true, task: "Give me a second opinion on the last answer above.", status: "done", workspaces: ws,
    reply: "The button works, but closing doesn't return to the chat." });
  const c = conv.history().conversations.find((x) => x.id === "run1")!;
  assert.equal(c.agent, "quartermaster", "the conversation is still with the Quartermaster");
  assert.equal(c.direct, false);
  assert.deepEqual(c.expeditions, ["run1", "run2"]);
  // The Quartermaster, replying after it, is told who said what.
  const mine = threadFor("run2")!;
  assert.equal(mine.agent, "quartermaster");
  assert.equal(mine.direct, false);
  assert.match(mine.history, /The user asked @scout to step in:/);
  assert.match(mine.history, /@scout answered \(done\):\nThe button works, but closing/);
  assert.match(mine.history, /You answered \(done\):\nAdded the Open button/);
  assert.equal(mine.workspaces?.[link.name].path, ws[link.name].path, "and carries on in the same worktree");
  // The Scout, stepping in, is told none of it is its own.
  const theirs = threadFor("run1", () => false, "scout")!;
  assert.match(theirs.history, /^## The conversation you're stepping into/);
  assert.match(theirs.history, /@quartermaster answered \(done\):\nAdded the Open button/);
  assert.doesNotMatch(theirs.history, /You answered \(done\):\nAdded the Open button/);
  assert.match(theirs.history, /You answered \(done\):\nThe button works/, "what it said itself, last time it stepped in, is its own");
});

// ---------- Pull requests ----------
test("a pull request's description is drafted from the record: the ticket, its criteria, what changed, the checks, the report", async () => {
  const w = ws[link.name];
  assert.deepEqual(prs.checksIn(`x\n\nAutomatic checks in links/${link.name} (run by the camp after the changes):\n✓ npm test\n✗ npm run lint\nExit code 1\n\nlater`, link.name), ["✓ npm test", "✗ npm run lint"]);
  const d = await prs.draftPullRequest(w, { expedition: "run1" });
  assert.equal(d.title, "MP-544: Open button on file citations");
  assert.equal(d.branch, "MP-544-open-button");
  assert.equal(d.existing, null);
  assert.match(d.body, new RegExp(`## Summary\\nWork for \\[MP-544\\]\\(${SITE}/browse/MP-544\\): Open button on file citations`));
  assert.match(d.body, /## Changes\n2 files changed, \+2 −0\.\n\n- `app\.txt` \(\+1 −0\)\n- `open\.ts` \(\+1 −0\)/);
  assert.match(d.body, /## Acceptance criteria\n- \[ \] An Open button on web reports\n- \[ \] Closing returns to the chat/);
  assert.match(d.body, /## Checks\n- Passed: `npm test`/);
  assert.match(d.body, /## Notes from the run\nAdded the Open button and wired it to the viewer\./);
  assert.doesNotMatch(d.body, /Automatic checks in links/, "the checks are their own section, not repeated in the notes");
  assert.doesNotMatch(d.body, /closing doesn't return/, "a second opinion isn't the run's report");
  assert.equal(prs.ticketOf(w), "MP-544");

  // The branch has a pull request already: the draft says so, and updating edits that one.
  writeFileSync(GH_PR, JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7", state: "OPEN" }));
  assert.deepEqual((await prs.draftPullRequest(w, { expedition: "run1" })).existing, { number: 7, url: "https://github.com/o/r/pull/7" });
  assert.equal(await prs.updatePullRequest(w, "A title", "A body"), "https://github.com/o/r/pull/7");
  assert.ok(ghCalls().includes("pr edit --title A title --body A body"));
  await assert.rejects(prs.draftPullRequest({ link: link.name, path: "/etc" }), /isn't a worktree/);
});

test("the watch keeps where each recent worktree's pull request stands, and says when there's something new", async () => {
  const w = ws[link.name];
  // A branch that was never pushed can't have a pull request: GitHub isn't asked.
  assert.deepEqual(await prs.checkPullRequests(), []);
  assert.deepEqual(ghCalls(), []);
  git(w.path, "push", "-q", "-u", "origin", "MP-544-open-button");
  writeFileSync(GH_PR, JSON.stringify({
    number: 7, url: "https://github.com/o/r/pull/7", title: "MP-544: Open button", state: "OPEN", headRefName: "MP-544-open-button", mergeable: "MERGEABLE", reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: [{ name: "test", conclusion: "FAILURE" }, { name: "lint", conclusion: "SUCCESS" }, { name: "deploy", status: "IN_PROGRESS" }],
    comments: [{ body: "Please also handle the keyboard." }, { body: "  " }], reviews: [{ state: "CHANGES_REQUESTED", body: "" }, { state: "COMMENTED", body: "" }],
  }));
  let [p] = await prs.checkPullRequests();
  assert.ok(p.firstSeen && Date.now() - new Date(p.firstSeen).getTime() < 60_000, "when the camp first saw it");
  const first = p.firstSeen;
  assert.deepEqual({ ...p, checked: "", firstSeen: "" }, { conversation: "run1", link: link.name, path: w.path, branch: "MP-544-open-button", number: 7, url: "https://github.com/o/r/pull/7", title: "MP-544: Open button",
    state: "OPEN", failing: 1, pending: 1, comments: 2, review: "changes", conflicts: false, checked: "", firstSeen: "" });
  assert.equal(prs.needsYou(p), true);
  // You've brought the feedback in: it's quiet until there's more.
  assert.equal(prs.markSeen(w.path), true);
  [p] = prs.prStates();
  assert.equal(prs.needsYou(p), false);
  const pr = JSON.parse(readFileSync(GH_PR, "utf8"));
  writeFileSync(GH_PR, JSON.stringify({ ...pr, comments: [...pr.comments, { body: "One more thing." }] }));
  [p] = await prs.checkPullRequests();
  assert.equal(p.comments, 3);
  assert.equal(prs.needsYou(p), true);
  assert.equal(p.firstSeen, first, "first seen stays when it was first seen");
  // A conflict with the base always needs you.
  writeFileSync(GH_PR, JSON.stringify({ ...pr, mergeable: "CONFLICTING", statusCheckRollup: [], comments: [], reviews: [], reviewDecision: "" }));
  [p] = await prs.checkPullRequests();
  assert.equal(p.conflicts, true);
  assert.equal(prs.needsYou(p), true);
  // Merged: kept as it ended, and not asked about again.
  writeFileSync(GH_PR, JSON.stringify({ ...pr, state: "MERGED", statusCheckRollup: [], comments: [], reviews: [] }));
  [p] = await prs.checkPullRequests();
  assert.equal(p.state, "MERGED");
  assert.equal(prs.needsYou(p), false);
  rmSync(GH_LOG, { force: true });
  await prs.checkPullRequests();
  assert.deepEqual(ghCalls(), [], "a merged pull request isn't looked at again");
  assert.equal(prs.markSeen("/nowhere"), false);
  assert.equal(settings.prWatchOn(), true);
  settings.setPrWatch(false);
  assert.equal(settings.prWatchOn(), false);
  settings.setPrWatch(true);
});

test("new commits on a branch that has a pull request can be pushed to it; a branch never pushed has nowhere to go yet", async () => {
  const w = ws[link.name];
  assert.equal((await repos.workspaceStatus(w)).ahead, 0, "everything it has is on its upstream");
  writeFileSync(join(w.path, "open.ts"), "export const open = () => true;\n// keyboard support\n");
  await repos.commitWorkspace(w, "Handle the keyboard");
  const st = await repos.workspaceStatus(w);
  assert.deepEqual([st.changed, st.commits, st.ahead], [0, 2, 1]);
  assert.match(await repos.pushWorkspace(w), /^[0-9a-f]{7,} to origin\/MP-544-open-button$/);
  assert.equal((await repos.workspaceStatus(w)).ahead, 0);
  assert.equal(git(join(scratch, "remote.git"), "log", "-1", "--format=%s", "MP-544-open-button"), "Handle the keyboard");
  const fresh = await repos.prepareWorkspaces({ [link.name]: { mode: "new", branch: "never-pushed" } }, "x", "cccc3333");
  assert.equal((await repos.workspaceStatus(fresh[link.name])).ahead, 0);
  await assert.rejects(repos.pushWorkspace(fresh[link.name]), /hasn't been pushed before\. Open its pull request first/);
  await repos.removeWorkspace(fresh[link.name]);
  await assert.rejects(repos.pushWorkspace({ link: link.name, path: "/etc" }), /isn't a worktree/);
});

test("a conversation is named by how its first request opens, not by the whole of a long brief", () => {
  assert.equal(conv.titleOf("Work on MP-544: Open button on file citations\n\nThe ticket is attached: read it first.\n\nAcceptance criteria:\n- [ ] One"), "Work on MP-544: Open button on file citations");
  assert.equal(conv.titleOf("@scout  What's new\nin memory research?"), "What's new");
  assert.equal(conv.titleOf("\n\n  \nSecond line is the first with words"), "Second line is the first with words");
  assert.equal(conv.titleOf(""), "Untitled");
  assert.equal(conv.titleOf("x".repeat(100)).length, 64);
});

// ---------- Writing back to Jira ----------
test("nothing is written to Jira unless you turn it on; then it comments, and moves the ticket if you named a status", async () => {
  assert.deepEqual(j.writeBackSettings(), { on: false, startStatus: "", prStatus: "" });
  assert.equal(await j.writeBack("start", "MP-544", { branch: "MP-544-open-button" }), null);
  assert.equal(await j.writeBack("pr", "MP-544", { url: "https://github.com/o/r/pull/7" }), null);
  assert.equal(seen.length, 0, "off: Jira isn't called at all");

  j.saveWriteBack({ on: true });
  assert.equal(await j.writeBack("start", "MP-544", { branch: "MP-544-open-button" }), "Commented on MP-544.");
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["POST /rest/api/3/issue/MP-544/comment"]);
  assert.deepEqual(seen[0].body, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Work started in Satchel on branch MP-544-open-button." }] }] } });
  assert.equal(await j.writeBack("start", undefined), null, "no ticket: nothing to write");
  assert.equal(await j.writeBack("start", "not a key"), null);

  seen.length = 0;
  assert.deepEqual(j.saveWriteBack({ on: true, startStatus: " in progress ", prStatus: "In Review" }), { on: true, startStatus: "in progress", prStatus: "In Review" });
  assert.equal(await j.writeBack("pr", "MP-544", { url: "https://github.com/o/r/pull/7" }), "Commented on MP-544 and moved it to In Review.");
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["POST /rest/api/3/issue/MP-544/comment", "GET /rest/api/3/issue/MP-544/transitions", "POST /rest/api/3/issue/MP-544/transitions"]);
  assert.deepEqual(seen[0].body.body.content[0].content, [{ type: "text", text: "Pull request opened: " }, { type: "text", text: "https://github.com/o/r/pull/7", marks: [{ type: "link", attrs: { href: "https://github.com/o/r/pull/7" } }] }]);
  assert.deepEqual(seen[2].body, { transition: { id: "31" } });
  assert.equal(await j.writeBack("start", "MP-544"), "Commented on MP-544 and moved it to In Progress.", "a status is matched whatever its case");
  // The workflow has no step to that status from here: the ticket is left where it is, and you're told.
  transitions = [];
  assert.match((await j.writeBack("pr", "MP-544", { url: "https://github.com/o/r/pull/7" }))!, /Commented on MP-544 and couldn't move it to "In Review"/);
  // A ticket that can't be written to doesn't throw: the line says what went wrong.
  assert.match((await j.writeBack("start", "MP-999"))!, /write-back for MP-999 didn't go through: Jira couldn't find that/);
  // The crew's own Jira tool still can't write.
  assert.deepEqual((j.jiraTool().def as any).input_schema.properties.action.enum, ["get", "search"]);
  j.saveWriteBack({ on: false });
  assert.deepEqual(j.writeBackSettings(), { on: false, startStatus: "", prStatus: "" });
});

// ---------- Chains ----------
test("a chained request waits for the work before it, starts when that finished cleanly, and is held when it didn't", () => {
  const flying = new Set(["a"]);
  const inFlight = (id: string) => flying.has(id);
  const ended: Record<string, string> = {};
  const endedAs = (id: string) => ended[id];
  assert.equal(chainReady({}, inFlight, endedAs), true, "nothing to wait for");
  const w: { after?: string; held?: string } = { after: "a" };
  assert.equal(chainReady(w, inFlight, endedAs), false, "still running");
  flying.delete("a"); ended.a = "done";
  assert.equal(chainReady(w, inFlight, endedAs), true);
  const h: { after?: string; held?: string } = { after: "b" };
  ended.b = "stopped";
  assert.equal(chainReady(h, inFlight, endedAs), false);
  assert.equal(h.held, "stopped", "it says how the work before it ended");
  ended.b = "done";
  assert.equal(chainReady(h, inFlight, endedAs), false, "once held, it stays held until you release it");
  delete h.held; delete h.after; // "Start it anyway"
  assert.equal(chainReady(h, inFlight, endedAs), true);
  assert.equal(chainReady({ after: "a job with no record" }, inFlight, endedAs), true);
  // Read from the record when nobody says otherwise.
  assert.equal(chainReady({ after: "run1" }, () => false), true);

  const before = allTurns().find((t) => t.expedition === "run1")!;
  const note = chainNote(before, false)!;
  assert.match(note, /^## What came before/);
  assert.match(note, /Work on MP-544: Open button on file citations/);
  assert.match(note, /It ended \(done\) with this answer from the Quartermaster|answer from Quartermaster/);
  assert.match(note, /Added the Open button/);
  assert.equal(chainNote(before, true), undefined, "in the same conversation, the conversation already says it");
  assert.equal(chainNote(undefined, false), undefined);
});

// ---------- The chronicle ----------
test("the week's record is gathered from the camp's own files, and the Scribe is asked to write from that alone", () => {
  assert.equal(chron.weekOf(new Date(2026, 10, 10)), "2026-11-09", "a Tuesday belongs to its Monday");
  assert.equal(chron.weekOf(new Date(2026, 10, 15, 23, 59)), "2026-11-09", "so does the Sunday");
  assert.equal(chron.weekOf(new Date(2026, 10, 16)), "2026-11-16");
  assert.equal(chron.weekLabel("2026-11-09"), "Nov 9 to Nov 15, 2026");
  const p = conv.getProject(project.id)!;
  const { week, conversations, facts } = chron.weekFacts(p);
  assert.equal(week, chron.weekOf());
  assert.equal(conversations, 1);
  assert.match(facts, /^Project: Web app\nWeek: /);
  assert.match(facts, /1\. ".+" — with the Quartermaster; 1 run this week; the last one ended: done; ticket MP-544; branch MP-544-open-button in links\/web; pull request #7 \(merged\)/);
  assert.match(facts, /Asked: Work on MP-544: Open button on file citations/);
  assert.match(facts, /Reported: Added the Open button and wired it to the viewer\./);
  assert.match(facts, /Looked over by: Scout/);
  assert.doesNotMatch(facts, /second opinion/, "what someone stepping in was asked is the page's standing brief, not the week's work");
  assert.equal(chron.weekFacts(p, "2020-01-06").conversations, 0, "a week with nothing in it has nothing to write up");
  assert.throws(() => chron.weekFacts(p, "last week"), /named by its Monday/);
  const other = conv.addProject({ name: "Docs" });
  assert.equal(chron.weekFacts(conv.getProject(other.id)!).conversations, 0, "another project's week is its own");

  const ask = chron.chronicleRequest(p, week, facts);
  // The conversation in which a chronicle was written isn't part of the next one's record.
  recordTurn({ thread: "chron1", expedition: "chron1", agent: "scribe", direct: true, task: ask, reply: "The week was about the Open button.", status: "done" });
  conv.fileConversation("chron1", project.id);
  assert.equal(chron.weekFacts(p).conversations, 1);
  assert.match(ask, /Use only the record below/);
  assert.match(ask, /don't open files, search, or use any tool/);
  assert.match(ask, /End with "## In plain terms"/);
  assert.ok(ask.endsWith(facts));
});

test("a chronicle is kept per week, the newest first, and its plain bullets can be lifted out", () => {
  const written = "The week was about the Open button.\n\n## What got done\n- MP-544 shipped.\n\n## In plain terms\n- The Open button now works.\n- One review comment is still open.\n";
  chron.saveChronicle(project.id, "2026-11-02", "An earlier week.\n\n## In plain terms\n- Nothing shipped.");
  chron.saveChronicle(project.id, "2026-11-09", written);
  const all = chron.chronicles(project.id);
  assert.deepEqual(all.map((c) => c.week), ["2026-11-09", "2026-11-02"]);
  assert.equal(all[0].text, written.trim());
  assert.equal(all[0].label, "Nov 9 to Nov 15, 2026");
  assert.equal(chron.plainTerms(written), "- The Open button now works.\n- One review comment is still open.");
  assert.equal(chron.plainTerms("No such section."), "");
  assert.throws(() => chron.saveChronicle("../x", "2026-11-09", "x"), /No such project or week/);
  assert.throws(() => chron.saveChronicle(project.id, "../../x", "x"), /No such project or week/);
  const page = chron.chroniclePage(project.id)!;
  assert.equal(page.weeks.length, 2);
  assert.deepEqual(page.open.map((o) => o.week), [chron.weekOf(), chron.weekOf(new Date(Date.now() - 7 * 86_400_000))]);
  assert.equal(page.open[0].conversations, 1);
  assert.equal(chron.chroniclePage("nope"), null);
});

// ---------- One form of review, and whether it's paying off ----------
test("a review ends in findings the page can show, whether you asked for it or the Quartermaster did", () => {
  const example = (text: string) => JSON.parse(text.match(/```findings\n([\s\S]*?)\n```/)![1]);
  assert.deepEqual(example(review.FINDINGS_FORMAT), [{ severity: "blocker", file: "src/app.ts", line: 42, title: "One line saying what's wrong", detail: "Why, and what to do instead" }]);
  assert.ok(review.ASIDE_BRIEFS.review.includes(review.FINDINGS_FORMAT));
  assert.ok(review.ASIDE_BRIEFS.review.includes(review.REVIEW_SCOPE));
  assert.doesNotMatch(review.ASIDE_BRIEFS.opinion, /findings/);
  for (const b of Object.values(review.ASIDE_BRIEFS)) assert.match(b, /Don't change any files\./);
  assert.equal(review.isAsideBrief("review"), true);
  assert.equal(review.isAsideBrief("anything else"), false);
  // The Quartermaster's own review asks for the same thing, in the same words, and passes on what's left unfixed.
  assert.ok(REVIEW_RULE.includes(`> ${review.REVIEW_SCOPE}`));
  assert.ok(REVIEW_RULE.includes('```findings'));
  assert.match(REVIEW_RULE, /end your summary with those in the same ```findings block/);
  assert.match(REVIEW_RULE, /Don't review a second time/);
});

test("a project can have its changes reviewed, or not, whatever the camp's setting", () => {
  const always = conv.addProject({ name: "Careful", settings: { review: "on" } });
  const never = conv.addProject({ name: "Quick", settings: { review: "off" } });
  assert.equal(conv.getProject(always.id)!.settings!.review, "on");
  assert.equal(conv.addProject({ name: "Odd", settings: { review: "sometimes" } }).settings, undefined);
  settings.setReviewChanges(false);
  assert.deepEqual([reviewsHere(always.id), reviewsHere(never.id), reviewsHere(project.id), reviewsHere(undefined)], [true, false, false, false]);
  settings.setReviewChanges(true);
  assert.deepEqual([reviewsHere(always.id), reviewsHere(never.id), reviewsHere(project.id), reviewsHere(undefined)], [true, false, true, true]);
  settings.setReviewChanges(false);
});

test("is it paying off: what the checking found and used, counted from the record", () => {
  assert.equal(payoff.spentOn(`@scout ${review.ASIDE_BRIEFS.review}`), "review");
  assert.equal(payoff.spentOn(review.ASIDE_BRIEFS.opinion), "opinion");
  assert.equal(payoff.spentOn("The camp ran the project's own checks after your changes, and at least one failed."), "fixup");
  assert.equal(payoff.spentOn("Address the feedback on pull request #7 (https://x)."), "feedback");
  assert.equal(payoff.spentOn("Write the chronicle for the project \"Web app\" for the week of…"), "chronicle");
  assert.equal(payoff.spentOn("Work on MP-544: Open button"), "work");
  const block = (list: object[]) => "I read the diff.\n\n```findings\n" + JSON.stringify(list) + "\n```";
  assert.deepEqual(payoff.findingsIn(block([{ severity: "blocker", title: "a" }, { severity: "nit", title: "b" }, { title: "" }])), { n: 2, blockers: 1 });
  assert.deepEqual(payoff.findingsIn(block([])), { n: 0, blockers: 0 });
  assert.deepEqual(payoff.findingsIn("No block here."), { n: 0, blockers: 0 });
  assert.deepEqual(payoff.findingsIn("```findings\nnot json\n```"), { n: 0, blockers: 0 });

  // Two reviews in the conversation: one found things and they were sent back; one found nothing.
  const turn = (expedition: string, task: string, reply: string, more: object = {}) =>
    recordTurn({ thread: "run1", expedition, agent: "scout", direct: true, task, reply, status: "done", workspaces: ws, ...more });
  turn("rev1", review.ASIDE_BRIEFS.review, block([{ severity: "blocker", title: "Closing doesn't return" }, { severity: "should", title: "No test" }]), { aside: true });
  turn("fix1", "Fix these review findings. Where you think one is wrong, say why instead of changing the code.", "Fixed both.", { agent: "quartermaster", direct: false });
  turn("rev2", review.ASIDE_BRIEFS.review, block([]), { aside: true });
  turn("fb1", "Address the feedback on pull request #7 (https://github.com/o/r/pull/7).", "Handled the keyboard.", { agent: "quartermaster", direct: false });
  giveFeedback("fix1", { rating: "up" });
  const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  const logged = (task: string, costUsd: number, more: object = {}) => JSON.stringify({ time: new Date().toISOString(), kind: "quest", character: "Scout", project: project.id, task, result: "", status: "done", model: "m", turns: 1, seconds: 1, usage, costUsd, ...more }) + "\n";
  writeFileSync(QUEST_LOG_PATH, logged("Work on MP-544: Open button", 6) + logged(review.ASIDE_BRIEFS.review.slice(0, 200), 1) + logged(review.ASIDE_BRIEFS.review.slice(0, 200), 1)
    + logged(review.ASIDE_BRIEFS.opinion.slice(0, 200), 0.5) + logged("The camp ran the project's own checks after your changes, and at least one failed.", 1.5)
    + logged("Work in another project", 50, { project: "elsewhere" }) + logged("Long ago", 99, { time: "2020-01-01T00:00:00.000Z" }));

  const p = payoff.projectPayoff(project.id)!;
  assert.equal(p.days, 30);
  assert.equal(p.conversations, 2, "the ticket's conversation, and the one the chronicle was written in");
  assert.deepEqual(p.reviews, { asked: 2, findings: 2, blockers: 1, sentBack: 1, clean: 1 });
  assert.equal(p.opinions, 1, "the second opinion from earlier in the conversation");
  assert.equal(p.fixups, 1);
  assert.deepEqual(p.usage.work, { runs: 1, cost: 6 });
  assert.deepEqual(p.usage.review, { runs: 2, cost: 2 });
  assert.deepEqual(p.usage.opinion, { runs: 1, cost: 0.5 });
  assert.deepEqual(p.usage.fixup, { runs: 1, cost: 1.5 });
  assert.equal(p.total, 10);
  assert.equal(p.checkingShare, 40, "reviews, second opinions and fix-ups, as a share of everything");
  assert.deepEqual({ ...p.prs, medianHoursToPr: null }, { seen: 1, merged: 1, open: 0, feedbackRounds: 1, medianHoursToPr: null });
  assert.ok(p.prs.medianHoursToPr !== null && p.prs.medianHoursToPr >= 0 && p.prs.medianHoursToPr < 1);
  assert.deepEqual(p.ratings, { up: 1, down: 0 });
  assert.equal(payoff.projectPayoff("nope"), null);
  assert.deepEqual(payoff.projectPayoff(conv.addProject({ name: "Empty" }).id)!.reviews, { asked: 0, findings: 0, blockers: 0, sentBack: 0, clean: 0 });
});
