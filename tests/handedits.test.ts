// Hand edits: what you changed in a worktree after the crew's run ended goes into the pull
// request's description, and the run's notes are brought up to date with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("handedits");
const repo = join(realpathSync.native(mkdtempSync(join(tmpdir(), "mae-hand-"))), "web");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
mkdirSync(repo, { recursive: true });
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "app.ts"), "export const a = 1;\n");
writeFileSync(join(repo, ".npmrc"), "registry=https://example.com\n");
git("add", "-A");
git("commit", "-q", "-m", "start");
const base = git("rev-parse", "HEAD");

const { addLink } = await import("../src/links.ts");
const { withExpedition } = await import("../src/context.ts");
const { snapshotBeforeShell, sealSnapshots, leftAt } = await import("../src/checkpoints.ts");
const { recordTurn } = await import("../src/threads.ts");
const { handEdits, notesAfterEdits } = await import("../src/handedits.ts");
const prs = await import("../src/pulls.ts");
const { rl } = await import("../src/tools.ts");
rl.close();

const link = addLink(repo, "write");
const w = { link: link.name, path: repo };
const turn = (expedition: string, reply: string) => recordTurn({ thread: "he-1", expedition, agent: "artificer", direct: true, task: "Add b", reply, status: "done", workspaces: { [link.name]: { link: link.name, path: repo, branch: "main", base, created: false } as any } });
// A run that ran a command in the repository: its working tree is recorded before, and as it's left.
const run = (id: string, work: () => void) => withExpedition({ id }, async () => { await snapshotBeforeShell(repo, () => `links/${link.name}`); work(); await sealSnapshots(id); });

test("nothing is claimed while the branch is as the crew left it", async () => {
  await run("he-1", () => writeFileSync(join(repo, "b.ts"), "export const b = 2;\n"));
  turn("he-1", "Added b.ts, exporting b.");
  git("add", "-A");
  git("commit", "-q", "-m", "Add b");
  assert.ok(leftAt("he-1", repo));
  assert.deepEqual((await handEdits(repo, link.name, ["he-1"])).files, [], "committing the crew's own work isn't a hand edit");
  const d = await prs.draftPullRequest(w, { expedition: "he-1", ask: async () => { throw new Error("not asked"); } });
  assert.equal(d.handEdits, undefined);
  assert.match(d.body, /## Notes from the run\nAdded b\.ts, exporting b\./);
  assert.doesNotMatch(d.body, /Changed by hand/);
});

test("what you changed after the run is listed, and the notes are rewritten to match", async () => {
  writeFileSync(join(repo, "b.ts"), "export const b = 3;\n");
  writeFileSync(join(repo, "c.ts"), "export const c = 4;\n");
  rmSync(join(repo, "app.ts"));
  git("add", "-A");
  git("commit", "-q", "-m", "By hand");
  const edits = await handEdits(repo, link.name, ["he-1"]);
  assert.deepEqual(edits.files, [{ path: "app.ts", change: "deleted" }, { path: "b.ts", change: "modified" }, { path: "c.ts", change: "created" }], "a secret file the record leaves out isn't counted");
  const asked: string[] = [];
  const d = await prs.draftPullRequest(w, { expedition: "he-1", ask: async (_system, prompt) => { asked.push(prompt); return "Added b.ts, exporting b (now 3).\n\nHand edits after the run: b changed to 3, c.ts added, app.ts removed."; } });
  assert.deepEqual(d.handEdits, { files: 3, rewritten: true });
  assert.match(d.body, /## Changed by hand after the run\n- `app\.ts` \(deleted\)\n- `b\.ts` \(modified\)\n- `c\.ts` \(created\)/);
  assert.match(d.body, /## Notes from the run\nAdded b\.ts, exporting b \(now 3\)\.\n\nHand edits after the run: b changed to 3/);
  assert.match(asked[0], /<notes>\nAdded b\.ts, exporting b\.\n<\/notes>/);
  assert.match(asked[0], /-export const b = 2;\n\+export const b = 3;/, "the model is given what changed since the run, not the whole branch");
});

test("if the notes can't be rewritten they're kept, and marked as older than the edits", async () => {
  const d = await prs.draftPullRequest(w, { expedition: "he-1", ask: async () => { throw new Error("no model"); } });
  assert.deepEqual(d.handEdits, { files: 3, rewritten: false });
  assert.match(d.body, /Added b\.ts, exporting b\.\n\n\(Written when the run ended, before the hand edits listed above\.\)/);
  const long = await notesAfterEdits(repo, "Short.", await handEdits(repo, link.name, ["he-1"]), { ask: async () => "x".repeat(5000) });
  assert.equal(long.rewritten, false, "an answer far longer than the notes isn't a rewrite of them");
});

test("what a later run changed with its file tools is the crew's, not yours", async () => {
  const { writeFileFor } = await import("../src/tools.ts");
  await withExpedition({ id: "he-2" }, () => writeFileFor("artificer").run!({ path: `links/${link.name}/d.ts`, content: "export const d = 5;\n" }) as Promise<unknown>);
  turn("he-2", "Added d.ts.");
  git("add", "-A");
  git("commit", "-q", "-m", "Add d");
  assert.deepEqual((await handEdits(repo, link.name, ["he-1", "he-2"])).files.map((f) => f.path), ["app.ts", "b.ts", "c.ts"]);
  assert.deepEqual(await handEdits(repo, link.name, []), { files: [], since: null }, "no record of how a run left things: nothing is claimed");
});
