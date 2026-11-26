// Build Barnstorm, the browser extension: extension/ + the game in plugins/barnstorm → extension/dist,
// which is the folder Chrome loads ("Load unpacked", on chrome://extensions with Developer mode on).
//   npm run extension:build    build it
//   npm run extension:pack     build it, and zip it up to hand to someone (extension/barnstorm-<version>.zip)
//
// The extension isn't a copy of the game: it's built from the same files Mae's page is, so a
// change to the game is a change to both. What this puts in extension/dist:
//   content.js     the game and React, as one script the extension runs in the page
//   page.css       the three kinds of rule that hide a shot piece of the page, for the page itself
//   background.js  what the extension's button does
//   manifest.json  and its icons, drawn here from the plane's own pixels
// The game's styles aren't copied either: they're lifted out of Mae's stylesheet as it's built.
//
// The zip is that folder and a page of instructions (extension/HOW-TO-INSTALL.txt), in one
// folder called "barnstorm": whoever gets it unzips it, and that folder is what they load.
// They need nothing else: not this repository, and nothing installed but the browser.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, deflateSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { PAINT, SPRITE } from "../plugins/barnstorm/src/flight.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension"), OUT = join(EXT, "dist");

// ---------- The game's styles, out of the plugin's stylesheet ----------
// Everything from the game's heading to the end of the file is the game's. Of that, the rules on
// the page's own elements (what's been shot) are for the page; the rest is the bar and the pill,
// and goes inside the extension's shadow root after its own few (tokens.css). One rule is for
// Mae's top bar, and is left out.
const MARK = "/* ---------- Barnstorm, the plugin (plugins/barnstorm): the plane over the page ---------- */";
export function gameStyles(sheet: string): { page: string; overlay: string } {
  const at = sheet.indexOf(MARK);
  if (at < 0) throw new Error(`Couldn't find the game's styles in plugins/barnstorm/src/barnstorm.css (looked for "${MARK}").`);
  const lines = sheet.slice(at + MARK.length).split("\n");
  const forPage = (l: string) => l.startsWith("[data-barnstorm") || l.startsWith("::highlight(barnstorm)");
  const page = lines.filter(forPage), overlay = lines.filter((l) => !forPage(l) && !l.startsWith(".icon-btn"));
  // If the stylesheet has been rearranged so these no longer hold, say so here and not in a broken extension.
  if (page.length !== 6) throw new Error(`Expected 6 rules for the page (hidden parts, four edges, hidden words) and found ${page.length}.`);
  if (!overlay.some((l) => l.startsWith(".barnstorm-bar ")) || !overlay.some((l) => l.startsWith(".barnstorm-paused "))) throw new Error("The bar's or the paused pill's styles are missing.");
  return { page: page.join("\n") + "\n", overlay: overlay.join("\n") };
}

// ---------- The icons: the plane, on a square ----------
// A PNG is a few length-tagged chunks, each with a checksum: the header, the pixels (deflated,
// each row led by a zero), and an end.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
  return out;
}
export function icon(size: number): Buffer {
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const ground = hex("#f3ede0"); // (pale, so the plane's dark outline shows)
  const wide = SPRITE[0].length, tall = SPRITE.length;
  const scale = (size * 0.86) / wide, left = (size - wide * scale) / 2, top = (size - tall * scale) / 2;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = Math.floor((x + 0.5 - left) / scale), r = Math.floor((y + 0.5 - top) / scale);
    const ch = SPRITE[r]?.[c];
    const [red, green, blue] = ch && ch !== "." ? hex(PAINT[ch]) : ground;
    raw.set([red, green, blue, 255], y * (size * 4 + 1) + 1 + x * 4);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

// ---------- The zip ----------
// A zip is each file (a short header, then its bytes, deflated), then a list of them all with
// where each one starts, then a few lines saying where the list is. Written here, with what
// Node already has, so that packing it is the same on every machine.
export function zip(files: { name: string; data: Uint8Array }[], when = new Date()): Buffer {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts: Buffer[] = [], list: Buffer[] = [];
  let at = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), packed = deflateRawSync(f.data, { level: 9 });
    // What's the same in a file's own header and in its line of the list: made for 2.0, names in UTF-8, deflated, when, checksum, sizes.
    const about = Buffer.alloc(26);
    about.writeUInt16LE(20, 0); about.writeUInt16LE(0x0800, 2); about.writeUInt16LE(8, 4);
    about.writeUInt16LE(time, 6); about.writeUInt16LE(date, 8);
    about.writeUInt32LE(crc(f.data), 10); about.writeUInt32LE(packed.length, 14); about.writeUInt32LE(f.data.length, 18);
    about.writeUInt16LE(name.length, 22); about.writeUInt16LE(0, 24);
    const head = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), about, name]);
    // Its line of the list: made by 2.0, the same again, then no comment, disk 0, a plain file, and where it starts.
    const where = Buffer.alloc(14);
    where.writeUInt32LE(at, 10);
    list.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2, 20, 0]), about, where, name]));
    parts.push(head, packed);
    at += head.length + packed.length;
  }
  const listed = Buffer.concat(list), end = Buffer.alloc(22);
  end.set([0x50, 0x4b, 5, 6], 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(listed.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, listed, end]);
}

// ---------- The build ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log("🔨 Building the Barnstorm extension (extension/ → extension/dist)…");
  const styles = gameStyles(readFileSync(join(ROOT, "plugins", "barnstorm", "src", "barnstorm.css"), "utf8"));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  await build({
    configFile: false,
    root: EXT,
    logLevel: "warn",
    plugins: [react()],
    // The game's ties to Mae go through @outpost/sdk; here that's extension/src/sdk.ts, which keeps
    // its best scores in the extension's storage. (Anything else that reaches for the page's api.ts gets the same.)
    resolve: { alias: [{ find: "@outpost/sdk", replacement: join(EXT, "src", "sdk.ts") }, { find: "../api.ts", replacement: join(EXT, "src", "store.ts") }] },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      OVERLAY_CSS: JSON.stringify(readFileSync(join(EXT, "src", "tokens.css"), "utf8") + styles.overlay),
    },
    build: {
      outDir: OUT,
      emptyOutDir: false,
      // One plain script with everything in it: the extension runs it in the page as it is.
      lib: { entry: join(EXT, "src", "content.tsx"), formats: ["iife"], name: "BarnstormExtension", fileName: () => "content.js" },
      minify: true,
    },
  });

  writeFileSync(join(OUT, "page.css"), `/* How a piece of the page that's been shot is hidden (from plugins/barnstorm/src/barnstorm.css). */\n${styles.page}`);
  copyFileSync(join(EXT, "src", "background.js"), join(OUT, "background.js"));
  copyFileSync(join(EXT, "manifest.json"), join(OUT, "manifest.json"));
  for (const size of [16, 32, 48, 128]) writeFileSync(join(OUT, `icon-${size}.png`), icon(size));
  console.log("   Done. In Chrome: chrome://extensions → Developer mode → Load unpacked → extension/dist");

  // To hand to someone: the built folder and how to install it, zipped as one folder.
  if (process.argv.includes("--zip")) {
    const { version } = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")) as { version: string };
    const out = join(EXT, `barnstorm-${version}.zip`);
    const files = [
      { name: "barnstorm/HOW-TO-INSTALL.txt", data: readFileSync(join(EXT, "HOW-TO-INSTALL.txt")) },
      ...readdirSync(OUT).sort().map((name) => ({ name: `barnstorm/${name}`, data: readFileSync(join(OUT, name)) })),
    ];
    writeFileSync(out, zip(files));
    console.log(`📦 Packed: extension/barnstorm-${version}.zip (${files.length} files). Send that; the instructions are inside it.`);
  }
}
