// Coding tools and attachments.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("tools");
writeFileSync(".env", "SECRET_TOKEN=do-not-leak-123\n");
mkdirSync("src", { recursive: true });
writeFileSync("src/sample.ts", 'export function greet(name: string) {\n  return "hello " + name;\n}\n');
const { editFileFor, grepFor, globFor, listDirFor, globToRegex } = await import("../src/codetools.ts");
const { saveUpload, buildRequest, findFileRefs } = await import("../src/attachments.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const edit = editFileFor("artificer").run!;
const grep = grepFor("artificer").run!;
const glob = globFor("artificer").run!;
const ls = listDirFor("artificer").run!;

test("edit_file: replaces exact text once", async () => {
  assert.match(String(await edit({ path: "src/sample.ts", old_string: '"hello " + name', new_string: "`hi, ${name}`" })), /^Edited/);
  assert.ok(readFileSync("src/sample.ts", "utf8").includes("`hi, ${name}`"));
});

test("edit_file: refuses missing or ambiguous text, and read-only folders", async () => {
  assert.match(String(await edit({ path: "src/sample.ts", old_string: "nope", new_string: "x" })), /wasn't found/);
  assert.match(String(await edit({ path: "src/sample.ts", old_string: "e", new_string: "E" })), /appears \d+ times/);
  await assert.rejects(() => edit({ path: "skills/scribe/house-style/SKILL.md", old_string: "a", new_string: "b" }) as Promise<unknown>, /read-only/);
});

test("grep, glob, list_dir: find things, never .env", async () => {
  assert.match(String(await grep({ pattern: "greet", path: "src" })), /src\/sample\.ts:1:/);
  assert.doesNotMatch(String(await grep({ pattern: "do-not-leak" })), /do-not-leak-123/);
  assert.match(String(await glob({ pattern: "src/**/*.ts" })), /src\/sample\.ts/);
  const tree = String(await ls({ path: "." }));
  assert.ok(!tree.includes(".env") && !tree.includes("node_modules"));
});

test("globToRegex: **, *, and {a,b}", () => {
  assert.ok(globToRegex("src/**/*.ts").test("src/a/b/c.ts"));
  assert.ok(globToRegex("src/**/*.ts").test("src/c.ts"));
  assert.ok(!globToRegex("src/*.ts").test("src/a/c.ts"));
  assert.ok(globToRegex("**/*.{md,txt}").test("docs/x.txt"));
});

test("uploads: kept inside camp/uploads, whatever the name", () => {
  const data = Buffer.from("hi").toString("base64");
  const folder = saveUpload({ name: "a.md", data, relPath: "proj/docs/a.md" });
  assert.match(folder.path, /^camp\/uploads\/[\w-]+\/proj\/docs\/a\.md$/);
  const sneaky = saveUpload({ name: "x", data, relPath: "../../../.env", batch: "../../etc" });
  assert.match(sneaky.path, /^camp\/uploads\/[\w-]+\/env$/);
  assert.ok(existsSync(sneaky.path));
});

test("attachments: images become image blocks; secrets and bad links are dropped", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082", "hex");
  const img = saveUpload({ name: "dot.png", data: png.toString("base64") });
  const { content, attached } = buildRequest("look at these", [
    { kind: "file", name: "dot.png", path: img.path },
    { kind: "file", name: "secrets", path: ".env" },
    { kind: "url", name: "bad", url: "javascript:alert(1)" },
    { kind: "url", name: "ok", url: "https://example.com" },
  ]);
  assert.equal(attached.length, 2);
  assert.ok(Array.isArray(content));
  assert.equal((content as any[]).filter((b) => b.type === "image").length, 1);
  assert.match((content as any[]).at(-1).text, /https:\/\/example\.com/);
});

test("@path references attach project files; @crew names don't", () => {
  const refs = findFileRefs("@scout compare @src/sample.ts with the docs");
  assert.deepEqual(refs.map((r) => r.path), ["src/sample.ts"]);
});
