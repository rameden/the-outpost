// Search that stays complete on big projects: glob and grep on ripgrep and on the built-in
// fallback give the same answers, respect a project's .gitignore, keep the camp's boundaries,
// and say so when there's more. Plus outline: a file's shape without reading it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("search");
mkdirSync("camp/wiki/notes", { recursive: true });
mkdirSync("camp/agents/scout/sessions", { recursive: true });
writeFileSync("camp/wiki/notes/tents.md", "# Tents\nNEEDLE in the wiki\n");
writeFileSync("camp/agents/scout/memory.md", "NEEDLE in a private memory\n");
writeFileSync(".env", "NEEDLE=secret\n");
writeFileSync(".gitignore", "camp/*\n"); // the camp's own state is ignored by git, but must stay searchable

// A project with more files than the old search could see, build output git ignores, and a secret.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "guild-camp-big-")));
for (let d = 0; d < 30; d++) {
  mkdirSync(join(repo, "src", `mod${d}`), { recursive: true });
  for (let f = 0; f < 10; f++) writeFileSync(join(repo, "src", `mod${d}`, `file${f}.ts`), `export const id = "${d}-${f}";\n${d === 7 && f === 3 ? "function useNEEDLE() {}\n// after\n" : ""}`);
}
mkdirSync(join(repo, "dist"));
writeFileSync(join(repo, "dist", "bundle.js"), "NEEDLE in build output\n");
writeFileSync(join(repo, ".gitignore"), "dist/\n");
writeFileSync(join(repo, ".env.local"), "NEEDLE=secret\n");
execFileSync("git", ["init", "-q"], { cwd: repo });

const { globFor, grepFor, outlineFor, outlineOf } = await import("../src/codetools.ts");
const { useRipgrepForTests, searchEngine } = await import("../src/search.ts");
const { addLink } = await import("../src/links.ts");
const { rl } = await import("../src/tools.ts");
after(() => { useRipgrepForTests(true); rl.close(); });
const L = `links/${addLink(repo, "read").name}`;
const glob = (pattern: string) => globFor("artificer").run!({ pattern }).then(String);
const grep = (args: object) => grepFor("artificer").run!(args).then(String);

useRipgrepForTests(true);
const engines = searchEngine() === "ripgrep" ? [true, false] : [false];

for (const withRg of engines) {
  const name = withRg ? "ripgrep" : "built-in";

  test(`${name}: glob sees every file, says when there are more, and skips what git ignores`, async () => {
    useRipgrepForTests(withRg);
    const all = await glob(`${L}/**/*.ts`);
    assert.equal(all.split("\n").filter((l) => l.startsWith(L)).length, 200);
    assert.match(all, /…\(100 more match; narrow the pattern\)$/);
    assert.equal((await glob(`${L}/src/mod7/*.ts`)).split("\n").length, 10);
    assert.match(await glob(`${L}/**/*.js`), /No files match/, "dist/ is ignored by the project");
    assert.match(await glob(`${L}/**/.env*`), /No files match/);
    assert.match(await glob("camp/wiki/**/*.md"), /camp\/wiki\/notes\/tents\.md/);
  });

  test(`${name}: grep finds it, in the project and in the camp, never in secrets or private memory`, async () => {
    useRipgrepForTests(withRg);
    assert.equal(await grep({ pattern: "NEEDLE", path: L }), `${L}/src/mod7/file3.ts:2: function useNEEDLE() {}`);
    const camp = await grep({ pattern: "NEEDLE" });
    assert.match(camp, /camp\/wiki\/notes\/tents\.md:2: NEEDLE in the wiki/, "camp/ is searched even though git ignores it");
    assert.doesNotMatch(camp, /\.env|memory\.md/);
    assert.equal(await grep({ pattern: "NEEDLE", path: "camp/wiki/notes/tents.md" }), "camp/wiki/notes/tents.md:2: NEEDLE in the wiki", "a single file");
    assert.match(await grep({ pattern: "needle", path: L, ignore_case: true }), /file3\.ts:2/);
    assert.match(await grep({ pattern: "nothing-like-this", path: L }), /^No matches/);
  });

  test(`${name}: grep narrows by glob, lists files, shows context, and stops at 200`, async () => {
    useRipgrepForTests(withRg);
    assert.match(await grep({ pattern: "export const", path: L, glob: "src/mod7/*.ts" }), new RegExp(`^${L}/src/mod7/file\\d\\.ts:1:`));
    assert.match(await grep({ pattern: "export const", path: L, glob: "*.md" }), /^No matches/);
    const files = (await grep({ pattern: 'id = "7-', path: L, files_only: true })).split("\n");
    assert.equal(files.length, 10);
    assert.ok(files.every((f) => f.startsWith(`${L}/src/mod7/`)));
    assert.equal(await grep({ pattern: "useNEEDLE", path: L, context: 1 }),
      `${L}/src/mod7/file3.ts-1- export const id = "7-3";\n${L}/src/mod7/file3.ts:2: function useNEEDLE() {}\n${L}/src/mod7/file3.ts-3- // after`);
    const many = await grep({ pattern: "export const", path: L });
    assert.equal(many.split("\n").length, 201);
    assert.match(many, /stopped at 200 matches/);
  });

  test(`${name}: a pattern only JavaScript's regex syntax takes still works, and a broken one says so`, async () => {
    useRipgrepForTests(withRg);
    assert.match(await grep({ pattern: "(?<=use)NEEDLE", path: L }), /file3\.ts:2/);
    assert.match(await grep({ pattern: "(unclosed", path: L }), /^Bad regular expression/);
  });
}

test("outline: a file's declarations with line numbers, without reading it all", async () => {
  const source = [
    'import React from "react";',
    "",
    "export const LIMIT = 5;",
    "type Props = { name: string };",
    "export function Greeting({ name }: Props) {",
    "  const shout = (s: string) => s.toUpperCase();",
    "  if (name) {",
    "    return <b>{shout(name)}</b>;",
    "  }",
    "  useEffect(() => {",
    "  }, []);",
    "}",
    "export class Store {",
    "  private items: string[] = [];",
    "  async load(id: string): Promise<void> {",
    "    for (const x of this.items) {",
    "    }",
    "  }",
    "}",
    'describe("Greeting", () => {',
    '  it("renders the name", () => {',
    "  });",
    "});",
    "export default Greeting;",
  ].join("\n");
  const out = outlineOf("src/greeting.tsx", source);
  assert.equal(out, [
    "src/greeting.tsx (24 lines)",
    "    3  export const LIMIT = 5;",
    "    4  type Props = { name: string };",
    "    5  export function Greeting({ name }: Props)",
    "    6    const shout = (s: string) => s.toUpperCase();",
    "   13  export class Store",
    "   15    async load(id: string): Promise<void>",
    '   20  describe("Greeting", () =>',
    '   21    it("renders the name", () =>',
    "   24  export default Greeting;",
  ].join("\n"));
  assert.match(outlineOf("notes.md", "# Title\n```\n# not a heading\n```\n## Part two\n"), /1  # Title\n\s+5  ## Part two$/);
  assert.match(outlineOf("x.py", "class A:\n    def run(self):\n        pass\n"), /1  class A:\n\s+2\s+def run\(self\):/);
  assert.match(outlineOf("data.bin", "x"), /no outline for this kind of file/);
  assert.match(String(await outlineFor("artificer").run!({ path: `${L}/src/mod7/file3.ts` })), new RegExp(`^${L}/src/mod7/file3\\.ts \\(4 lines\\)\\n\\s+1  export const id = "7-3";\\n\\s+2  function useNEEDLE\\(\\)`));
  await assert.rejects(() => outlineFor("artificer").run!({ path: ".env" }) as Promise<unknown>, /off limits/);
});
