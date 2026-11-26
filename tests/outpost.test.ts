// Outposts (src/outpost.ts, scripts/outpost.ts): each is a folder of its own with a name and a port,
// Mae is this checkout with nothing new in it, and the page wears the outpost's name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanName, outpostSlug, readOutpost, renameOutpost, withOutpost, OUTPOST, OUTPOST_FILE } from "../src/outpost.ts";
import { packById } from "../src/packs.ts";
import { uiPage } from "../src/ui-files.ts";

const at = (outpost?: object | string) => {
  const dir = mkdtempSync(join(tmpdir(), "mae-outpost-"));
  if (outpost !== undefined) {
    mkdirSync(join(dir, "camp"));
    writeFileSync(join(dir, OUTPOST_FILE), typeof outpost === "string" ? outpost : JSON.stringify(outpost));
  }
  return dir;
};

test("a folder with no outpost.json is Mae on 4747, as this checkout always was", () => {
  assert.deepEqual(readOutpost(at()), { name: "Mae", port: 4747 });
  assert.deepEqual(readOutpost(at({ name: "Work", port: 4748 })), { name: "Work", port: 4748 });
});

test("a name or port that doesn't hold up falls back, and a broken file doesn't stop the camp", () => {
  assert.deepEqual(readOutpost(at({ name: "<>", port: 99999 })), { name: "Mae", port: 4747 });
  assert.deepEqual(readOutpost(at({ port: "4800" })), { name: "Mae", port: 4800 });
  const quiet = console.error; console.error = () => {};
  try { assert.deepEqual(readOutpost(at("{ not json")), { name: "Mae", port: 4747 }); } finally { console.error = quiet; }
});

test("names are kept short and plain, and make a folder name", () => {
  assert.equal(cleanName("  Home   lab <script> "), "Home lab script");
  assert.equal(cleanName("A".repeat(40)).length, 24);
  assert.equal(outpostSlug("Home lab"), "home-lab");
  assert.equal(outpostSlug("Café Nord"), "cafe-nord");
  assert.equal(outpostSlug("!!!"), "");
});

test("the page wears the outpost's name, in its title and the meta the page reads before signing in", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "ui", "index.html"), "utf8");
  assert.match(html, /<meta name="outpost" content="Mae">/, "as built, the page is Mae's");
  const work = withOutpost(html, "Work");
  assert.match(work, /<meta name="outpost" content="Work">/);
  assert.match(work, /<title>Outpost Work<\/title>/);
  assert.doesNotMatch(work, /Outpost Mae<\/title>/);
  const dist = mkdtempSync(join(tmpdir(), "mae-ui-"));
  writeFileSync(join(dist, "index.html"), html);
  assert.match(uiPage(dist, "", "Home lab")!, /<title>Outpost Home lab<\/title>/);
  assert.match(uiPage(dist, "")!, /<title>Outpost Mae<\/title>/, "the tests run in this checkout: Mae");
});

test("renaming keeps the new name in outpost.json with the port it had, and the running outpost takes it", () => {
  const mae = at();
  const live = { name: "Mae", port: 4747 };
  renameOutpost("  Home   lab! ", mae, live);
  assert.deepEqual(JSON.parse(readFileSync(join(mae, OUTPOST_FILE), "utf8")), { name: "Home lab", port: 4747 });
  assert.equal(live.name, "Home lab");
  const work = at({ name: "Work", port: 4801, note: "kept" });
  renameOutpost("Office", work, { name: "Work", port: 4801 });
  assert.deepEqual(JSON.parse(readFileSync(join(work, OUTPOST_FILE), "utf8")), { name: "Office", port: 4801, note: "kept" });
  assert.throws(() => renameOutpost("!!!", work, { name: "Office", port: 4801 }), /letter or digit/);
  assert.equal(readOutpost(work).name, "Office");
});

test("the packs' places follow a rename without a restart", () => {
  const was = OUTPOST.name;
  try {
    OUTPOST.name = "Home";
    assert.equal(packById("starship").place, "the starship Home");
    assert.equal(withOutpost('<meta name="outpost" content="Mae"><title>Outpost Mae</title>'), '<meta name="outpost" content="Home"><title>Outpost Home</title>');
    assert.equal(withOutpost('<meta name="outpost" content=""><title>Outpost</title>'), '<meta name="outpost" content="Home"><title>Outpost Home</title>');
  } finally { OUTPOST.name = was; }
});
