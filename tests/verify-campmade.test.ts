// Checks in a project the camp started (start_project): with none set, the likely ones found there
// run after a change, but only when each would run without asking under the user's own approval
// choices (the sandbox, god mode with someone here, the allow list), never past a deny or ask rule.
// Otherwise the report says nothing was checked, and how to turn them on.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox, NEEDS_SH } from "./helpers/sandbox.ts";

enterSandbox("verify-campmade");
process.env.OUTPOST_PROJECTS_DIR = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-verify-projects-")));

const { startProject } = await import("../src/newproject.ts");
const { checkChanges, noChecksNote } = await import("../src/verify.ts");
const { withExpedition, withQuest } = await import("../src/context.ts");
const { addLink } = await import("../src/links.ts");
const { setApprovalLevel, setShellLists } = await import("../src/settings.ts");
const { sandboxAvailable } = await import("../src/sandbox.ts");
const { rl, writeFileFor } = await import("../src/tools.ts");
after(() => rl.close());

const { link, path: dir } = await startProject({ name: "gizmo" });
const L = `links/${link.name}`;
// A check that leaves a mark, so a test can tell it really ran.
writeFileSync(join(dir, "Makefile"), "test:\n\ttouch ran.txt\n");
const ran = () => existsSync(join(dir, "ran.txt"));

let n = 0;
const change = (unattended = false) => {
  const q = `q-${++n}`;
  return withExpedition({ id: `exp-${n}`, unattended }, () => withQuest(q, async () => {
    await writeFileFor("artificer").run!({ path: `${L}/src/f${n}.ts`, content: "x\n" });
    return checkChanges(q, { who: "Artificer", emoji: "🔨" });
  }));
};
const FOUND = new RegExp(`^Automatic checks in ${L} \\(none are set up for it: these were found in the project the camp started, and run by it after the changes\\):\\n✓ make test`);

beforeEach(() => {
  rmSync(join(dir, "ran.txt"), { force: true });
  setApprovalLevel("safe");
  setShellLists({ allow: [], deny: [], ask: [] });
});

test("asking for commands (the default): found checks don't run, and the note says how to turn them on", async () => {
  const out = await change();
  assert.equal(ran(), false);
  assert.equal(out.text, noChecksNote(link.name, ["make test"], true));
  assert.match(out.text, /It's a project the camp started, so these also run by themselves with the sandbox on, or once they're on your allow list\./);
  assert.deepEqual(out.unchecked, [{ link: link.name, found: ["make test"], campMade: true }]);
});

test("on the allow list: they run, and the header says where they were found", { skip: NEEDS_SH }, async () => {
  setShellLists({ allow: ["make test"] });
  const out = await change();
  assert.match(out.text, FOUND);
  assert.equal(ran(), true);
  assert.deepEqual(out.unchecked, []);
});

test("god mode with someone here: they run; in a scheduled job, god mode doesn't count", { skip: NEEDS_SH }, async () => {
  setApprovalLevel("god");
  assert.match((await change()).text, FOUND);
  assert.equal(ran(), true);
  rmSync(join(dir, "ran.txt"));
  if (!sandboxAvailable()) { // (with a sandbox, an unattended god mode runs in it, and then they would run there)
    await change(true);
    assert.equal(ran(), false);
  }
});

test("sandbox mode: they run inside the sandbox", { skip: (!sandboxAvailable() && "no sandbox here") || NEEDS_SH }, async () => {
  setApprovalLevel("sandbox");
  assert.match((await change()).text, FOUND);
  assert.equal(ran(), true);
});

test("a deny or ask rule stops them, whatever else allows them", async () => {
  setApprovalLevel("god");
  setShellLists({ deny: ["make*"] });
  assert.match((await change()).text, /^No automatic checks ran/);
  setShellLists({ deny: [], ask: ["make test"], allow: ["make test"] });
  assert.match((await change()).text, /^No automatic checks ran/);
  assert.equal(ran(), false);
});

test("a folder the user linked themselves keeps today's rule: found checks run only with that setting on", async () => {
  const own = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-own-")));
  writeFileSync(join(own, "Makefile"), "test:\n\ttouch ran.txt\n");
  const mine = addLink(own, "write");
  setApprovalLevel("god");
  const q = "q-own";
  const out = await withExpedition({ id: "exp-own" }, () => withQuest(q, async () => {
    await writeFileFor("artificer").run!({ path: `links/${mine.name}/a.ts`, content: "x\n" });
    return checkChanges(q, { who: "Artificer", emoji: "🔨" });
  }));
  assert.equal(out.text, noChecksNote(mine.name, ["make test"]));
  assert.equal(existsSync(join(own, "ran.txt")), false);
});
