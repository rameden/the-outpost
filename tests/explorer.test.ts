// The Files flyout's reading: it lists a linked folder one level at a time, previews files, marks
// what git says changed, follows a worktree of the linked repository, and never leaves the
// folder, opens a secret, or shows git's own data.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("explorer");
const repo = realpathSync(mkdtempSync(join(tmpdir(), "satchel-files-")));
const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "satchel-elsewhere-")));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.email", "test@example.com");
git(repo, "config", "user.name", "Test");
mkdirSync(join(repo, "src", "deep"), { recursive: true });
writeFileSync(join(repo, "src", "app.ts"), "export const a = 1;\n");
writeFileSync(join(repo, "src", "deep", "util.ts"), "export const u = 1;\n");
writeFileSync(join(repo, "README.md"), "# Demo\n");
writeFileSync(join(repo, "b10.txt"), "ten\n");
writeFileSync(join(repo, "b2.txt"), "two\n");
writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
writeFileSync(join(repo, "data.bin"), Buffer.from([1, 0, 2, 0, 3]));
writeFileSync(join(repo, ".gitignore"), ".env\nbig.txt\nout\nback\n");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "first");
writeFileSync(join(repo, ".env"), "TOKEN=hunter2\n");
writeFileSync(join(repo, "big.txt"), "x".repeat(600 * 1024));
writeFileSync(join(elsewhere, "private.txt"), "not yours\n");
symlinkSync(elsewhere, join(repo, "out"));
symlinkSync(join(repo, "src"), join(repo, "back"));

const { addLink } = await import("../src/links.ts");
const { recordTurn } = await import("../src/threads.ts");
const { history } = await import("../src/conversations.ts");
const ex = await import("../src/explorer.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());
const link = addLink(repo, "write");

test("a folder is listed one level at a time: folders first, names in natural order, git's data left out", async () => {
  const root = await ex.explorerRoot(link.name);
  assert.equal(root, repo);
  const top = ex.listFolder(root);
  const names = top.entries.map((e) => e.name);
  assert.deepEqual(names.filter((n) => !n.startsWith(".")), ["back", "src", "b2.txt", "b10.txt", "big.txt", "data.bin", "logo.png", "out", "README.md"]);
  assert.ok(!names.includes(".git"));
  assert.equal(top.entries.find((e) => e.name === "src")?.dir, true);
  assert.equal(top.entries.find((e) => e.name === "b2.txt")?.size, 4);
  assert.deepEqual(ex.listFolder(root, "src").entries.map((e) => [e.name, e.dir]), [["deep", true], ["app.ts", false]]);
  assert.deepEqual(ex.listFolder(root, "back/deep").entries.map((e) => e.name), ["util.ts"], "a symlink that stays inside is followed");
});

test("secrets are listed but not opened, and nothing leads out of the folder", async () => {
  const root = await ex.explorerRoot(link.name);
  const top = ex.listFolder(root).entries;
  assert.equal(top.find((e) => e.name === ".env")?.secret, true);
  assert.throws(() => ex.previewFile(root, ".env"), /secret/);
  const out = top.find((e) => e.name === "out");
  assert.deepEqual([out?.outside, out?.dir], [true, false], "a symlink that leaves is shown, not followed");
  assert.throws(() => ex.listFolder(root, "out"), /outside/);
  assert.throws(() => ex.previewFile(root, "out/private.txt"), /outside/);
  assert.throws(() => ex.listFolder(root, "../"), /leaves/);
  assert.throws(() => ex.previewFile(root, "/etc/hosts"), /leaves/);
  assert.throws(() => ex.listFolder(root, ".git"), /Git's own data/);
  assert.throws(() => ex.previewFile(root, ".git/config"), /Git's own data/);
  await assert.rejects(ex.explorerRoot("nope"), /No linked folder/);
  await assert.rejects(ex.explorerRoot(link.name, elsewhere), /isn't a worktree/);
});

test("a file previews as text, or says what it is when it can't", async () => {
  const root = await ex.explorerRoot(link.name);
  const text = ex.previewFile(root, "src/app.ts");
  assert.deepEqual(text, { path: "src/app.ts", abs: join(repo, "src", "app.ts"), size: 20, text: "export const a = 1;\n" });
  assert.equal((ex.previewFile(root, "logo.png") as any).image, true);
  assert.equal((ex.previewFile(root, "data.bin") as any).binary, true);
  assert.equal((ex.previewFile(root, "big.txt") as any).tooLarge, true);
  assert.equal(ex.imageFile(root, "logo.png").media, "image/png");
  assert.throws(() => ex.imageFile(root, "README.md"), /isn't an image/);
  assert.throws(() => ex.previewFile(root, "src"), /isn't a file/);
});

test("what git reports as changed is marked, from the folder's own top", async () => {
  writeFileSync(join(repo, "src", "app.ts"), "export const a = 2;\n");
  writeFileSync(join(repo, "src", "new file.ts"), "export {};\n");
  mkdirSync(join(repo, "notes"));
  writeFileSync(join(repo, "notes", "todo.md"), "- one\n");
  git(repo, "rm", "-q", "b2.txt");
  assert.deepEqual(await ex.changedFiles(repo), { "b2.txt": "D", "src/app.ts": "M", "src/new file.ts": "U", "notes/": "U" });
  assert.deepEqual(await ex.changedFiles(join(repo, "src")), { "app.ts": "M", "new file.ts": "U" }, "paths start at the folder shown, not the repository");
  assert.deepEqual(await ex.changedFiles(elsewhere), {}, "not a repository: nothing marked");
});

test("a worktree of the linked repository can be browsed in its place", async () => {
  const tree = join(elsewhere, "tree");
  git(repo, "worktree", "add", "-q", "-b", "camp/try", tree);
  writeFileSync(join(tree, "only-here.txt"), "hi\n");
  const root = await ex.explorerRoot(link.name, tree);
  assert.equal(realpathSync(root), realpathSync(tree));
  assert.ok(ex.listFolder(root).entries.some((e) => e.name === "only-here.txt"));
  assert.equal((ex.previewFile(root, "only-here.txt") as any).text, "hi\n");
});

test("a conversation carries the folders attached to it and the worktree it last worked in", () => {
  const turn = (expedition: string, more: object) => recordTurn({ thread: "t1", expedition, agent: "quartermaster", direct: false, task: "Fix it", reply: "Done.", status: "done", ...more });
  turn("t1", { links: [link.name] });
  turn("t2", { workspaces: { [link.name]: { link: link.name, path: "/tmp/wt", branch: "camp/fix-it", created: true } } });
  turn("t3", {});
  const c = history().conversations.find((x) => x.id === "t1")!;
  assert.deepEqual(c.links, [link.name]);
  assert.deepEqual(c.workspaces, { [link.name]: { path: "/tmp/wt", branch: "camp/fix-it", created: true } });
});

test("finding a file by name: the name itself counts most, and secrets never come back", async () => {
  const found = await ex.findFiles(repo, "app");
  assert.equal(found[0], "src/app.ts");
  assert.ok(found.includes("src/new file.ts") === false);
  assert.deepEqual(await ex.findFiles(repo, "util"), ["src/deep/util.ts"]);
  assert.deepEqual(await ex.findFiles(repo, "deep util"), ["src/deep/util.ts"], "every word has to be in the path");
  assert.deepEqual(await ex.findFiles(repo, "env"), [], "a secret is never offered");
  assert.deepEqual(await ex.findFiles(repo, "  "), []);
  assert.ok((await ex.findFiles(repo, "todo")).includes("notes/todo.md"), "files git doesn't know yet are found too");
  assert.deepEqual(await ex.findFiles(elsewhere, "private"), ["private.txt"], "outside a repository the folder is walked");
});

test("one file's changes since the last commit, as a diff", async () => {
  const changed = await ex.fileDiff(repo, "src/app.ts");
  assert.equal(changed.untracked, false);
  assert.match(changed.diff, /^-export const a = 1;$/m);
  assert.match(changed.diff, /^\+export const a = 2;$/m);
  const fresh = await ex.fileDiff(repo, "notes/todo.md");
  assert.deepEqual(fresh, { diff: "@@ -0,0 +1,1 @@\n+- one", untracked: true }, "a file git doesn't know is all additions");
  assert.deepEqual(await ex.fileDiff(repo, "README.md"), { diff: "", untracked: false });
  await assert.rejects(ex.fileDiff(repo, ".env"), /secret/);
  await assert.rejects(ex.fileDiff(repo, "../outside.txt"), /leaves/);
});
