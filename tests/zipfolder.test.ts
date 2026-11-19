// A folder sent as a .zip: unpacked into the message's upload folder as if picked with Folder…,
// with nothing in it able to climb out of that folder, and the same limits Folder… has.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";
import { zip } from "./helpers/zip.ts";

enterSandbox("zipfolder");
const { saveZipFolder, MAX_ZIP_FILES } = await import("../src/attachments.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());
const send = (name: string, buf: Buffer, batch?: string) => saveZipFolder({ name, data: buf.toString("base64"), batch });
const fixable = (re: RegExp) => (e: any) => re.test(e.message) && e.fixable === true;

test("a zipped folder comes out as that folder", () => {
  const r = send("site.zip", zip([
    { path: "site/index.html", data: "<h1>hi</h1>", deflate: true },
    { path: "site/css/main.css", data: "body{}" },
    { path: "site/.DS_Store", data: "x" },
    { path: "__MACOSX/site/._index.html", data: "x" },
    { path: "site/node_modules/left-pad/index.js", data: "x" },
    { path: "site/.git/HEAD", data: "x" },
  ]), "2026-11-18-abc123");
  assert.equal(r.name, "site");
  assert.equal(r.path, "camp/uploads/2026-11-18-abc123/site");
  assert.equal(r.count, 2);
  assert.equal(readFileSync(`${r.path}/index.html`, "utf8"), "<h1>hi</h1>");
  assert.equal(readFileSync(`${r.path}/css/main.css`, "utf8"), "body{}");
  assert.deepEqual(readdirSync(r.path).sort(), ["css", "index.html"]);
});

test("loose files in a zip go in a folder named after the zip", () => {
  const r = send("My notes.zip", zip([{ path: "a.md", data: "a" }, { path: "sub/b.md", data: "b" }]));
  assert.equal(r.name, "My notes");
  assert.equal(r.count, 2);
  assert.equal(readFileSync(`${r.path}/sub/b.md`, "utf8"), "b");
});

test("nothing in a zip lands outside its folder", () => {
  const r = send("evil.zip", zip([{ path: "../../escape.txt", data: "x" }, { path: "/etc/passwd", data: "x" }, { path: "ok.txt", data: "x" }]));
  assert.equal(existsSync("camp/escape.txt") || existsSync("escape.txt"), false);
  assert.ok(readdirSync(r.path, { recursive: true }).every((p) => !String(p).includes("..")));
  assert.throws(() => send("link.zip", zip([{ path: "x/out", data: "/etc/passwd", mode: 0o120777 }])), fixable(/is a link/));
});

test("what a zipped folder can't be", () => {
  assert.throws(() => send("x.zip", Buffer.from("just some text, not a zip at all")), fixable(/isn't a \.zip file/));
  assert.throws(() => send("x.zip", zip([{ path: "only/.DS_Store", data: "x" }])), fixable(/no files in it/));
  const many = zip(Array.from({ length: MAX_ZIP_FILES + 1 }, (_, i) => ({ path: `f${i}.txt`, data: "" })));
  assert.throws(() => send("x.zip", many), fixable(new RegExp(`up to ${MAX_ZIP_FILES}`)));
});
