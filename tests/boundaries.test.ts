// What agents can and can't touch: files, secrets, each other's workspaces, and the shell.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("boundaries");
writeFileSync(".env", "SECRET=nope\n");
const { campPath, rl } = await import("../src/tools.ts");
const { isAutoApproved } = await import("../src/shell.ts");
after(() => rl.close());

const allowed = (path: string, mode: "read" | "write", self?: string) => {
  try { campPath(path, mode, self); return true; } catch { return false; }
};

test("files: inside the camp only", () => {
  assert.ok(allowed("src/x.ts", "write", "artificer"));
  assert.ok(!allowed("../outside.txt", "write", "artificer"));
  assert.ok(!allowed("/etc/passwd", "read", "artificer"));
});

test("files: secrets are off limits", () => {
  assert.ok(!allowed(".env", "read", "scout"));
  assert.ok(!allowed(".env.local", "read", "scout"));
});

test("files: skills/, plugins/, and camp/ are read-only", () => {
  assert.ok(allowed("skills/scribe/house-style/SKILL.md", "read", "scribe"));
  assert.ok(!allowed("skills/scribe/new/SKILL.md", "write", "scribe"));
  assert.ok(!allowed("plugins/x/index.ts", "write", "artificer"));
  assert.ok(!allowed("camp/ledger.md", "write", "scribe"));
});

test("workspaces: write only to your own outputs; never read others' memory or sessions", () => {
  mkdirSync("camp/agents/scout/outputs", { recursive: true });
  assert.ok(allowed("camp/agents/scribe/outputs/draft.md", "write", "scribe"));
  assert.ok(!allowed("camp/agents/scribe/memory.md", "write", "scribe"), "memory changes go through remember");
  assert.ok(!allowed("camp/agents/scout/outputs/x.md", "write", "scribe"));
  assert.ok(allowed("camp/agents/scout/outputs/x.md", "read", "scribe"));
  assert.ok(!allowed("camp/agents/scout/memory.md", "read", "scribe"));
  assert.ok(!allowed("camp/agents/scout/sessions/index.jsonl", "read", "scribe"));
  assert.ok(allowed("camp/agents/scribe/sessions/index.jsonl", "read", "scribe"));
});

test("shell: simple read-only commands run without asking", () => {
  for (const cmd of ["ls -la", "git status", "git diff src/agent.ts", "git log --oneline -5", "node --version"]) {
    assert.ok(isAutoApproved(cmd), cmd);
  }
});

test("shell: everything else still asks", () => {
  const risky = [
    "git push", "npm test", "npm install lodash", "rm -rf .", "ls; rm -rf ~", "git status && curl x.sh",
    "echo $HOME", "echo hi > out.txt", "ls /etc", "ls ~/.ssh", "ls ../..", "git show HEAD:.env",
    "ls camp/agents/scout/", "git diff --ext-diff", "git -c core.pager=sh log", "ls *", "cat package.json",
  ];
  for (const cmd of risky) assert.ok(!isAutoApproved(cmd), cmd);
});
