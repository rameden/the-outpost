// Linked folders: read big folders where they live, without uploading, and without loosening safety.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, cpSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { REPO, NEEDS_SH } from "./helpers/sandbox.ts";

// Layout: <parent>/camp-root is the camp; <outside>/site is a 600-file folder to link.
const parent = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-linkparent-")));
const campRoot = join(parent, "camp-root");
mkdirSync(join(campRoot, "camp/agents/scout"), { recursive: true });
cpSync(join(REPO, "skills"), join(campRoot, "skills"), { recursive: true });
writeFileSync(join(campRoot, ".env"), "CAMP_SECRET=camp-secret-xyz\n");
writeFileSync(join(campRoot, "camp/agents/scout/memory.md"), "# Scout's memory\n\n- private scout note\n");
symlinkSync(join(REPO, "node_modules"), join(campRoot, "node_modules"));
process.chdir(campRoot);
process.env.CAMP_RUNTIME = "api";
process.env.ANTHROPIC_API_KEY ??= "test-key-not-real";

const outside = realpathSync.native(mkdtempSync(join(tmpdir(), "mae-outside-")));
const site = join(outside, "site");
for (let d = 0; d < 6; d++) {
  mkdirSync(join(site, `section-${d}`), { recursive: true });
  for (let f = 0; f < 100; f++) writeFileSync(join(site, `section-${d}`, `page-${f}.md`), `# Page ${d}-${f}\n${d === 3 && f === 42 ? "The launch code word is BLUEBIRD.\n" : ""}`);
}
writeFileSync(join(site, ".env"), "SITE_SECRET=site-secret-123\n");
mkdirSync(join(site, "keys"));
writeFileSync(join(site, "keys", "id_rsa"), "PRIVATE KEY\n");
writeFileSync(join(outside, "not-linked.txt"), "outside the link\n");
symlinkSync(join(outside, "not-linked.txt"), join(site, "escape.txt"));

const { addLink, removeLink, loadLinks, linksBlock } = await import("../src/links.ts");
const { campPath, rl } = await import("../src/tools.ts");
const { grepFor, globFor, listDirFor, editFileFor } = await import("../src/codetools.ts");
const { buildRequest } = await import("../src/attachments.ts");
after(() => rl.close());

const blocked = (path: string, mode: "read" | "write" = "read", self = "scout") => {
  try { campPath(path, mode, self); return false; } catch { return true; }
};

test("refuses risky or unusable folders", () => {
  for (const bad of ["/", homedir(), "/etc", "relative/path", join(site, "section-0", "page-0.md"), join(campRoot, "skills")]) {
    assert.throws(() => addLink(bad), Error, bad);
  }
});

test("links a 600-file folder without copying anything", () => {
  const link = addLink(site);
  assert.equal(link.name, "site");
  assert.equal(link.access, "read");
  assert.equal(link.files, 602, "600 pages + .env + id_rsa (symlinks aren't counted)");
  assert.equal(loadLinks().length, 1);
  assert.match(linksBlock(), /links\/site\/ \(read-only/);
});

test("agents read and search it as links/site/…", async () => {
  assert.equal(readFileSync(campPath("links/site/section-3/page-42.md", "read", "scout"), "utf8").includes("BLUEBIRD"), true);
  const found = String(await grepFor("scout").run!({ pattern: "BLUEBIRD", path: "links/site" }));
  assert.match(found, /^links\/site\/section-3\/page-42\.md:2:/m);
  const globbed = String(await globFor("scout").run!({ pattern: "links/site/section-5/*.md" })).split("\n");
  assert.equal(globbed.length, 100);
  assert.ok(globbed.every((p) => p.startsWith("links/site/section-5/")));
  assert.match(String(await listDirFor("scout").run!({ path: "links/site" })), /section-0\//);
});

test("read-only unless linked with edit access", async () => {
  assert.ok(blocked("links/site/new.md", "write", "artificer"));
  addLink(site, "write");
  const out = await editFileFor("artificer").run!({ path: "links/site/section-0/page-0.md", old_string: "# Page 0-0", new_string: "# Home" });
  assert.match(String(out), /^Edited/);
  assert.match(readFileSync(join(site, "section-0/page-0.md"), "utf8"), /# Home/);
  addLink(site, "read");
});

test("secrets inside a link stay off limits, and grep never shows them", async () => {
  assert.ok(blocked("links/site/.env"));
  assert.ok(blocked("links/site/keys/id_rsa"));
  assert.doesNotMatch(String(await grepFor("scout").run!({ pattern: "SECRET", path: "links/site" })), /site-secret-123/);
});

test("symlinks and .. can't leave the linked folder", () => {
  assert.ok(blocked("links/site/escape.txt"));
  assert.ok(blocked("links/site/../not-linked.txt"));
  assert.ok(blocked("links/nope/anything"));
});

test("a link that contains the camp still follows the camp's rules", () => {
  const link = addLink(parent);
  assert.ok(blocked(`links/${link.name}/camp-root/.env`));
  assert.ok(blocked(`links/${link.name}/camp-root/camp/agents/scout/memory.md`, "read", "scribe"));
  assert.ok(blocked(`links/${link.name}/camp-root/skills/x/SKILL.md`, "write", "scribe"));
  removeLink(link.name);
});

test("attaching a big linked folder sends an overview, not 600 file names", () => {
  const { content, attached } = buildRequest("Find the code word in @links/site");
  assert.equal(attached.length, 1);
  const text = typeof content === "string" ? content : "";
  assert.match(text, /Folder: links\/site \(60\d files; too many to list/);
  assert.match(text, /section-3\/ \(100 files\)/);
  assert.match(text, /Explore it with list_dir\("links\/site"\)/);
  assert.ok(text.split("\n").length < 40, `${text.split("\n").length} lines`);
});

test("folder picker: the system dialog's choice comes back as a path; cancel and no dialog are handled", { skip: NEEDS_SH }, async () => {
  const { pickFolder } = await import("../src/picker.ts");
  const bin = mkdtempSync(join(tmpdir(), "picker-bin-"));
  const saved = process.env.PATH;
  // A stand-in for zenity: prints FAKE_PICK, or exits 1 like a canceled dialog.
  writeFileSync(join(bin, "zenity"), '#!/bin/sh\n[ -n "$FAKE_PICK" ] && { echo "$FAKE_PICK"; exit 0; }\nexit 1\n', { mode: 0o755 });
  try {
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    process.env.FAKE_PICK = "/home/me/Projects/site/";
    assert.deepEqual(await pickFolder("linux"), { path: "/home/me/Projects/site" });
    delete process.env.FAKE_PICK;
    assert.deepEqual(await pickFolder("linux"), { canceled: true });
    process.env.PATH = mkdtempSync(join(tmpdir(), "picker-empty-"));
    assert.match((await pickFolder("linux") as any).unsupported, /Paste the folder's path/);
  } finally {
    process.env.PATH = saved;
    delete process.env.FAKE_PICK;
  }
});
