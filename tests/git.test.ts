// Read-only git for the whole crew: seeing what a change added, in a linked repository, without
// ever reaching secrets, running programs, or changing the repository. And file tools can't
// write git's own data (config, hooks), even in a folder linked with edit access.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("git");

// A small repository to link, with secrets committed by mistake (it happens).
const repo = join(realpathSync.native(mkdtempSync(join(tmpdir(), "mae-gitrepo-"))), "site");
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(join(repo, "keys"));
const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
git("init", "-q", "-b", "main");
writeFileSync(join(repo, "src/canvas.tsx"), "export function Canvas() {}\n");
writeFileSync(join(repo, ".env"), "API_TOKEN=committed-secret-123\n");
writeFileSync(join(repo, "keys/id_rsa"), "PRIVATE KEY 456\n");
git("add", "-A"); git("commit", "-qm", "Initial");
// The "Close change": a new onCloseCanvas, plus the secrets changing alongside it.
writeFileSync(join(repo, "src/canvas.tsx"), "export function Canvas() {}\nexport const onCloseCanvas = () => {};\n");
writeFileSync(join(repo, ".env"), "API_TOKEN=rotated-secret-789\n");
writeFileSync(join(repo, "keys/id_rsa"), "PRIVATE KEY 999\n");
git("add", "-A"); git("commit", "-qm", "Close the canvas");
writeFileSync(join(repo, "src/canvas.tsx"), readFileSync(join(repo, "src/canvas.tsx"), "utf8") + "// uncommitted note\n");
writeFileSync(join(repo, ".env.local"), "LOCAL=untracked-secret\n");

const { addLink } = await import("../src/links.ts");
const { gitFor } = await import("../src/git.ts");
const { ROSTER } = await import("../src/roster.ts");
const { quartermasterSpec } = await import("../src/quartermaster.ts");
const { campPath, rl } = await import("../src/tools.ts");
after(() => rl.close());
addLink(repo, "write");

const scribeGit = gitFor("scribe");
const run = async (input: object) => String(await scribeGit.run!(input));
const SECRETS = /committed-secret|rotated-secret|untracked-secret|PRIVATE KEY|\.env|id_rsa/;

test("everyone can read git history: the Scribe, the Scout, the Quartermaster", () => {
  const hasGit = (tools: { def: object }[]) => tools.some((t) => "name" in t.def && t.def.name === "git");
  for (const id of ["scout", "scribe", "artificer"]) assert.ok(hasGit(ROSTER[id].tools), `${id} has git`);
  assert.ok(hasGit(quartermasterSpec().tools), "the Quartermaster has git");
});

test("the Scribe can see what a change added, in a linked repository", async () => {
  const shown = await run({ subcommand: "show", args: ["HEAD"], in: "links/site" });
  assert.match(shown, /Close the canvas/);
  assert.match(shown, /^\+export const onCloseCanvas/m, "the new line shows as added");
  assert.match(await run({ subcommand: "log", args: ["--oneline"], in: "links/site" }), /Close the canvas[\s\S]*Initial/);
  assert.match(await run({ subcommand: "diff", in: "links/site" }), /\+\/\/ uncommitted note/);
  assert.match(await run({ subcommand: "blame", args: ["src/canvas.tsx"], in: "links/site" }), /onCloseCanvas/);
  assert.match(await run({ subcommand: "show", args: ["HEAD~1:src/canvas.tsx"], in: "links/site" }), /^export function Canvas\(\) \{\}\s*$/, "the file as it was before");
});

test("secrets stay out of every result, even ones committed by mistake", async () => {
  for (const input of [
    { subcommand: "show", args: ["HEAD"] },
    { subcommand: "show", args: ["--stat", "HEAD"] },
    { subcommand: "log", args: ["-p"] },
    { subcommand: "diff", args: ["HEAD~1"] },
    { subcommand: "status", args: ["--short", "--untracked-files=all"] },
  ]) {
    const out = await run({ ...input, in: "links/site" });
    assert.doesNotMatch(out, SECRETS, `${input.subcommand} ${input.args.join(" ")} leaked: ${out.slice(0, 300)}`);
  }
  for (const args of [["HEAD:.env"], ["HEAD~1:keys/id_rsa"], ["HEAD:KEYS/ID_RSA"]]) {
    assert.match(await run({ subcommand: "show", args, in: "links/site" }), /off limits/);
  }
  assert.match(await run({ subcommand: "blame", args: [".env"], in: "links/site" }), /off limits/);
});

test("nothing that changes the repository, runs a program, or reads outside it", async () => {
  for (const sub of ["push", "commit", "checkout", "config", "reset"]) {
    assert.match(await run({ subcommand: sub, in: "links/site" }), /Only status, diff, log, show, blame/);
  }
  const refused: string[][] = [
    ["--no-index", "/etc/hosts", "src/canvas.tsx"], ["--ext-diff"], ["--textconv"], ["--output=/tmp/x"],
    ["-O/etc/hosts"], ["--format=%G?"], ["--", "../outside"], ["/etc/hosts"], ["~/notes"],
  ];
  for (const args of refused) assert.doesNotMatch(await run({ subcommand: "diff", args, in: "links/site" }), /^diff --git/m, `diff ${args.join(" ")}`);
  assert.match(await run({ subcommand: "blame", args: ["--contents", "/etc/hosts", "src/canvas.tsx"], in: "links/site" }), /isn't available/);
  await assert.rejects(() => run({ subcommand: "log", args: [], in: "/etc" }), /outside the camp/); // the agent sees this error
  const before = git("rev-parse", "HEAD") + git("status", "--porcelain");
  await run({ subcommand: "status", in: "links/site" });
  assert.equal(git("rev-parse", "HEAD") + git("status", "--porcelain"), before, "reading changed nothing");
});

test("file tools never write git's own data, even in a folder linked with edit access", () => {
  const blocked = (path: string) => { try { campPath(path, "write", "artificer"); return false; } catch { return true; } };
  assert.ok(!blocked("links/site/src/new.ts"), "ordinary project files are still editable");
  for (const path of ["links/site/.git/config", "links/site/.git/hooks/pre-commit", "links/site/vendor/lib/.git/config", "sub/.git/hooks/post-checkout", ".git/config"]) {
    assert.ok(blocked(path), `${path} is blocked`);
  }
  assert.ok(!blocked("links/site/.gitignore") && !blocked("links/site/.github/workflows/ci.yml"), "files that only start with .git are fine");
});
