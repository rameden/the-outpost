// A linked repository's own guidance: its top guide in full, its folder guides and skills by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { enterSandbox, NEEDS_POSIX } from "./helpers/sandbox.ts";

enterSandbox("guidance");
const { classify, frontMatter, repoGuidance, guidanceBlock, forgetGuidance } = await import("../src/guidance.ts");
const { addLink, projectInstructions } = await import("../src/links.ts");
const { rl } = await import("../src/tools.ts");
rl.close();

const repo = join(realpathSync.native(mkdtempSync(join(tmpdir(), "mae-guided-"))), "web");
const put = (path: string, text: string) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); };
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });

put("AGENTS.md", "Use tabs, never spaces.\n");
put(".github/copilot-instructions.md", "Prefer named exports.\n");
put("packages/api/AGENTS.md", "API RULES: every route has a schema.\n");
put("packages/api/CLAUDE.md", "@AGENTS.md\n");
put("packages/ui/CLAUDE.md", "UI RULES\n");
put(".claude/skills/release/SKILL.md", "---\nname: release\ndescription: >\n  Use when cutting a release:\n  tag, changelog, publish.\n---\n\n# Release\nSECRET STEPS\n");
put(".claude/skills/release/AGENTS.md", "belongs to the skill\n");
put("packages/api/.agents/skills/migrations/SKILL.md", "---\ndescription: \"Writing a database migration\"\n---\n");
put("node_modules/dep/AGENTS.md", "not ours\n");
put(".gitignore", "node_modules\nbuild\n");
put("build/AGENTS.md", "generated\n");
mkdirSync(repo, { recursive: true });
git("init", "-q");
git("add", "-A");
git("commit", "-q", "-m", "start");
put("packages/new/AGENTS.md", "not committed yet, still counts\n");

test("the files git lists are sorted into folder guides and skills", () => {
  const found = classify(["AGENTS.md", "CLAUDE.md", "./packages/api/AGENTS.md", "packages/api/CLAUDE.md", "packages/ui/CLAUDE.md",
    ".claude/skills/release/SKILL.md", ".claude/skills/release/AGENTS.md", "packages/api/.github/skills/x/SKILL.md", "docs/SKILL.md", "node_modules/a/AGENTS.md"]);
  assert.deepEqual(found.guides, [{ path: "packages/api/AGENTS.md", folder: "packages/api" }, { path: "packages/ui/CLAUDE.md", folder: "packages/ui" }]);
  assert.deepEqual(found.skills, [{ path: ".claude/skills/release/SKILL.md", dir: "release" }, { path: "packages/api/.github/skills/x/SKILL.md", dir: "x", folder: "packages/api" }]);
});

test("a skill's name and description are read from its front matter", () => {
  assert.deepEqual(frontMatter("---\nname: a-b\ndescription: 'Does it'\n---\nbody"), { name: "a-b", description: "Does it" });
  assert.deepEqual(frontMatter("---\ndescription: |\n  one\n  two\nname: x\n---"), { description: "one two", name: "x" });
  assert.deepEqual(frontMatter("# No front matter"), {});
});

test("a repository's folder guides and skills are found, without what git ignores", () => {
  const g = repoGuidance(repo);
  assert.deepEqual(g.guides.map((x) => x.path), ["packages/api/AGENTS.md", "packages/new/AGENTS.md", "packages/ui/CLAUDE.md"]);
  assert.deepEqual(g.skills, [
    { name: "release", description: "Use when cutting a release: tag, changelog, publish.", path: ".claude/skills/release/SKILL.md" },
    { name: "migrations", description: "Writing a database migration", path: "packages/api/.agents/skills/migrations/SKILL.md", folder: "packages/api" },
  ]);
  assert.deepEqual(repoGuidance(tmpdir()).guides, [], "a folder that isn't a repository lists nothing");
});

test("the crew is given the top guides whole, and the rest by name", () => {
  addLink(repo, "write");
  forgetGuidance();
  const text = projectInstructions();
  assert.match(text, /### links\/web\/AGENTS\.md\nUse tabs, never spaces/);
  assert.match(text, /### links\/web\/\.github\/copilot-instructions\.md\nPrefer named exports/);
  assert.match(text, /- links\/web\/packages\/api\/AGENTS\.md \(for links\/web\/packages\/api\/\)/);
  assert.match(text, /- \*\*release\*\*: Use when cutting a release: tag, changelog, publish\. → links\/web\/\.claude\/skills\/release\/SKILL\.md/);
  assert.match(text, /- \*\*migrations\*\* \(for links\/web\/packages\/api\/\): Writing a database migration/);
  assert.doesNotMatch(text, /API RULES|UI RULES|SECRET STEPS|not ours|generated/, "only the top guides are loaded: the others are read when they apply");
  assert.match(text, /still goes through the camp's approvals/);
});

test("a skill file that's a symlink out of the repository isn't read", { skip: NEEDS_POSIX }, () => {
  const elsewhere = join(dirname(repo), "outside.md");
  writeFileSync(elsewhere, "---\nname: stolen\ndescription: FROM OUTSIDE\n---\n");
  mkdirSync(join(repo, ".claude/skills/linked"), { recursive: true });
  symlinkSync(elsewhere, join(repo, ".claude/skills/linked/SKILL.md"));
  forgetGuidance();
  const linked = repoGuidance(repo).skills.find((s) => s.path.includes("linked"));
  assert.deepEqual(linked, { name: "linked", description: "", path: ".claude/skills/linked/SKILL.md" });
  assert.equal(guidanceBlock("links/web/", { guides: [], skills: [], more: { guides: 0, skills: 0 } }), "");
});
