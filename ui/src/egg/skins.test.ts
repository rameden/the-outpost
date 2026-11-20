import { expect, test } from "vitest";
import { PACKS } from "../../../src/packs.ts";
import { GREMLIN_PAINT } from "./gremlins.ts";
import { SKINS, bareOf, quiet, skinFor, type Art, type Paint } from "./skins.ts";

const KINDS = ["scout", "leader", "ace", "heavy", "ferry", "dart", "chaser", "mine", "hauler", "gunship", "balloon", "flagship", "carrier", "boat"];
// The letters the game's own picture of each of these uses: a skin that only repaints one has to paint them all.
const REPAINTED: Record<string, string> = { mine: "DMRS", balloon: "DSLR", carrier: "DHKWIYT", boat: "DHKIYT" };

// A picture that can be drawn: every row as wide as the first, and a colour for every letter in it.
function drawable(what: string, { rows, paint }: Art) {
  expect(rows.length, what).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.length, `${what}: "${row}"`).toBe(rows[0].length);
    for (const ch of row) if (ch !== ".") expect(paint[ch], `${what}: "${ch}" in "${row}"`).toMatch(/^#[0-9a-f]{6}$/);
  }
}

test("every pack the camp comes with, but Guild, has a look for the game; Guild and packs of your own keep the plane", () => {
  expect(Object.keys(SKINS).sort()).toEqual(PACKS.map((p) => p.id).filter((id) => id !== "guild").sort());
  for (const id of Object.keys(SKINS)) expect(skinFor(id)).toBe(SKINS[id]);
  expect(["guild", "pirates", "", "constructor", "toString"].map(skinFor)).toEqual(Array(5).fill(null));
});

test("every picture in every skin can be drawn, and nothing in the game is left without one", () => {
  for (const [id, skin] of Object.entries(SKINS)) {
    expect(skin.craft, id).toMatch(/^[A-Z]+$/);
    expect(skin.boss, id).toMatch(/^[A-Z' -]+$/);
    drawable(`${id} player`, skin.player);
    drawable(`${id} shot`, skin.shot);
    if (skin.player.flicker) expect(skin.player.rows.join(""), `${id}: its flicker`).toContain(skin.player.flicker);
    expect(Object.keys(skin.enemies).sort(), id).toEqual([...KINDS].sort());
    for (const [kind, look] of Object.entries(skin.enemies)) {
      if (look.rows) drawable(`${id} ${kind}`, { rows: look.rows, paint: look.paint });
      else for (const ch of REPAINTED[kind] ?? "?") expect(look.paint[ch], `${id} ${kind}: "${ch}"`).toMatch(/^#[0-9a-f]{6}$/);
    }
    // A gunship's shield is the letter S, so there's something to show when it's turned away.
    expect(skin.enemies.gunship.rows?.join(""), `${id} gunship`).toContain("S");
    // The ships are only ever repainted: they're on the water, drawn the game's own way.
    expect([skin.enemies.carrier.rows, skin.enemies.boat.rows], id).toEqual([undefined, undefined]);
    expect(Object.keys(skin.builder).sort(), `${id} builders`).toEqual(Object.keys(GREMLIN_PAINT).sort());
  }
});

test("a gunship with its shield turned away, and a flame that's out, are the same paint with one letter changed", () => {
  const paint: Paint = { D: "#000000", S: "#ffffff", f: "#ff0000" };
  expect(bareOf(paint, "#123456")).toEqual({ D: "#000000", S: "#123456", f: "#ff0000" });
  expect(bareOf(paint, "#123456")).toBe(bareOf(paint)); // made once, then kept
  expect(quiet(paint, "f")).toEqual({ D: "#000000", S: "#ffffff" });
  expect(quiet(paint, "f")).toBe(quiet(paint, "f"));
  expect(paint).toEqual({ D: "#000000", S: "#ffffff", f: "#ff0000" });
});
