// The Barnstorm extension's build: the game's styles lifted out of the plugin's stylesheet, and its icons.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import { gameStyles, icon, zip } from "../scripts/extension-build.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the game's styles come out of the plugin's stylesheet in two parts: the page's, and the game's own", () => {
  const { page, overlay } = gameStyles(readFileSync(join(REPO, "plugins/barnstorm/src/barnstorm.css"), "utf8"));
  // For the page: what hides a part that's been shot, each side of a border, and a word.
  assert.match(page, /^\[data-barnstormed\] \{ visibility: hidden !important; \}$/m);
  for (const side of ["top", "right", "bottom", "left"]) assert.ok(page.includes(`[data-barnstorm-edge~="${side}"]`), side);
  assert.ok(page.includes("::highlight(barnstorm)"));
  assert.ok(!page.includes(".barnstorm-bar"), "nothing of the bar's goes in the page");
  // For the game: the bar and the paused pill, and none of the page's or of Mae's top bar.
  assert.ok(overlay.includes(".barnstorm-bar {") && overlay.includes(".barnstorm-paused {") && overlay.includes(".barnstorm.paused .barnstorm-sky"));
  assert.ok(!overlay.includes("[data-barnstorm") && !overlay.includes("::highlight") && !overlay.includes(".icon-btn"));
});

test("a stylesheet that's been rearranged stops the build, and doesn't make a broken extension", () => {
  assert.throws(() => gameStyles("body { margin: 0; }"), /Couldn't find the game's styles/);
  const mark = "/* ---------- Barnstorm, the plugin (plugins/barnstorm): the plane over the page ---------- */";
  assert.throws(() => gameStyles(`${mark}\n[data-barnstormed] { visibility: hidden !important; }\n.barnstorm-bar { }\n.barnstorm-paused { }`), /Expected 6 rules for the page/);
});

test("the icons are the plane, as real PNGs of the sizes the manifest names", () => {
  const manifest = JSON.parse(readFileSync(join(REPO, "extension/manifest.json"), "utf8")) as { icons: Record<string, string>; permissions: string[]; manifest_version: number };
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]); // nothing until you click, and no page but that one
  for (const [size, file] of Object.entries(manifest.icons)) {
    assert.equal(file, `icon-${size}.png`);
    const png = icon(Number(size));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), Number(size)); // width
    assert.equal(png.readUInt32BE(20), Number(size)); // height
    // Its pixels unpack to rows of the right length, and it isn't one flat colour: there's a plane on it.
    const at = png.indexOf("IDAT"), length = png.readUInt32BE(at - 4);
    const raw = inflateSync(png.subarray(at + 4, at + 4 + length));
    assert.equal(raw.length, Number(size) * (Number(size) * 4 + 1));
    const colours = new Set<string>();
    for (let i = 1; i < raw.length; i += 4) if ((i - 1) % (Number(size) * 4 + 1) < Number(size) * 4) colours.add(raw.subarray(i, i + 3).toString("hex"));
    assert.ok(colours.size >= 4, `${size}px: ${colours.size} colours`);
  }
});

test("the zip to hand to someone unpacks to exactly what went in, every file in one folder", () => {
  const files = [
    { name: "barnstorm/HOW-TO-INSTALL.txt", data: Buffer.from("Keep this folder somewhere it can stay.\n".repeat(40)) },
    { name: "barnstorm/content.js", data: Buffer.from(Array.from({ length: 5000 }, (_, i) => `var a${i}=${i * 7};`).join("")) },
    { name: "barnstorm/icon-16.png", data: icon(16) },
    { name: "barnstorm/empty.txt", data: new Uint8Array() },
  ];
  const packed = zip(files, new Date(2026, 10, 14, 10, 30, 8));
  assert.ok(packed.length < files.reduce((n, f) => n + f.data.length, 0), "it's smaller than what went in");
  // Read it back the way an unzipper does: the last lines say where the list is, the list says where each file is.
  const end = packed.length - 22;
  assert.deepEqual([...packed.subarray(end, end + 4)], [0x50, 0x4b, 5, 6]);
  assert.equal(packed.readUInt16LE(end + 10), files.length);
  let at = packed.readUInt32LE(end + 16);
  assert.equal(at + packed.readUInt32LE(end + 12), end, "the list runs right up to the end");
  for (const f of files) {
    assert.deepEqual([...packed.subarray(at, at + 4)], [0x50, 0x4b, 1, 2]);
    const method = packed.readUInt16LE(at + 10), size = packed.readUInt32LE(at + 20), full = packed.readUInt32LE(at + 24), nameLength = packed.readUInt16LE(at + 28), starts = packed.readUInt32LE(at + 42);
    assert.equal(packed.subarray(at + 46, at + 46 + nameLength).toString("utf8"), f.name);
    assert.equal(packed.readUInt16LE(at + 14) >> 9, 2026 - 1980); // dated
    assert.deepEqual([method, full], [8, f.data.length]);
    // Its own header says the same, and its bytes come back out as they went in.
    assert.deepEqual([...packed.subarray(starts, starts + 4)], [0x50, 0x4b, 3, 4]);
    assert.equal(packed.subarray(starts + 30, starts + 30 + nameLength).toString("utf8"), f.name);
    const body = packed.subarray(starts + 30 + nameLength, starts + 30 + nameLength + size);
    assert.ok(Buffer.from(f.data).equals(inflateRawSync(body)), f.name);
    assert.equal(packed.readUInt32LE(at + 16), packed.readUInt32LE(starts + 14)); // the same checksum in both places
    at += 46 + nameLength;
  }
  assert.equal(at, end);
});

test("what goes to a friend says how to install it, and the manifest would pass the store's limits", () => {
  const how = readFileSync(join(REPO, "extension/HOW-TO-INSTALL.txt"), "utf8");
  for (const step of ["chrome://extensions", "Developer mode", "Load unpacked", "Alt+Shift+B", "REMOVE IT"]) assert.ok(how.includes(step), step);
  assert.ok(how.split("\n").every((line) => line.length <= 78), "plain text that fits any window");
  const manifest = JSON.parse(readFileSync(join(REPO, "extension/manifest.json"), "utf8")) as { name: string; description: string; version: string };
  assert.ok(manifest.description.length <= 132, `the description is ${manifest.description.length} characters (the limit is 132)`);
  assert.ok(manifest.name.length <= 45);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});
