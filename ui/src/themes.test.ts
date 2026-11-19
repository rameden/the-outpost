// Light or dark, and which colours: two choices, kept in this browser and shared with the tour.
import { beforeEach, expect, test } from "vitest";
import { MODE_KEY, PACK_KEY, PALETTE_KEY, PALETTES, modeNow, packNow, paletteNow, setMode, setPalette, startThemes, toggleMode, wearPack } from "./themes.ts";

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); wearPack(undefined); localStorage.clear(); delete root.dataset.theme; delete root.dataset.palette; });

test("a palette and a mode are separate: changing one leaves the other", () => {
  expect([modeNow(), paletteNow()]).toEqual(["system", "camp"]);
  setPalette("harbor");
  expect(root.dataset.palette).toBe("harbor");
  expect(root.dataset.theme).toBeUndefined(); // still matching the system
  setMode("dark");
  expect([root.dataset.theme, root.dataset.palette]).toEqual(["dark", "harbor"]);
  toggleMode(); // the header's switch: light and dark only
  expect([root.dataset.theme, root.dataset.palette]).toEqual(["light", "harbor"]);
  expect([localStorage.getItem(MODE_KEY), localStorage.getItem(PALETTE_KEY)]).toEqual(["light", "harbor"]);
});

test("the camp's own colours and \"match system\" are the defaults: nothing is kept and nothing is set", () => {
  setPalette("moss"); setMode("dark");
  setPalette("camp"); setMode("system");
  expect([root.dataset.theme, root.dataset.palette]).toEqual([undefined, undefined]);
  expect([localStorage.getItem(MODE_KEY), localStorage.getItem(PALETTE_KEY)]).toEqual(["", ""]);
});

test("as the page opens it wears what was chosen last time, and follows a change made in another tab", () => {
  localStorage.setItem(MODE_KEY, "dark"); localStorage.setItem(PALETTE_KEY, "heather");
  startThemes();
  expect([root.dataset.theme, root.dataset.palette]).toEqual(["dark", "heather"]);
  // The tour (or Settings in another window) changes it: this page follows.
  localStorage.setItem(PALETTE_KEY, "harbor"); localStorage.setItem(MODE_KEY, "");
  window.dispatchEvent(new StorageEvent("storage", { key: PALETTE_KEY, newValue: "harbor" }));
  expect([root.dataset.theme, root.dataset.palette]).toEqual([undefined, "harbor"]);
  // A value this page doesn't know (an older tab, a typo) is the camp's own.
  localStorage.setItem(PALETTE_KEY, "neon"); localStorage.setItem(MODE_KEY, "sepia");
  window.dispatchEvent(new StorageEvent("storage", { key: MODE_KEY, newValue: "sepia" }));
  expect([root.dataset.theme, root.dataset.palette, modeNow(), paletteNow()]).toEqual([undefined, undefined, "system", "camp"]);
});

test("every palette is named and described, and the first is the camp's own", () => {
  expect(PALETTES.map((p) => p.id)).toEqual(["camp", "harbor", "moss", "heather", "ochre"]);
  for (const p of PALETTES) expect(p.name.length > 0 && p.about.length > 0).toBe(true);
});

const PACKS = [{ id: "guild" }, { id: "starship", palette: "harbor" }];

test("a theme pack shows on the page and suggests colours, until you choose your own", () => {
  wearPack("starship", PACKS);
  expect([root.dataset.pack, root.dataset.palette, packNow(), paletteNow()]).toEqual(["starship", "harbor", "starship", "harbor"]);
  expect(localStorage.getItem(PALETTE_KEY)).toBeNull(); // a suggestion isn't a choice
  setPalette("moss");
  expect([root.dataset.pack, root.dataset.palette]).toEqual(["starship", "moss"]);
  // The camp's own colours, chosen on purpose, win too.
  setPalette("camp");
  expect([root.dataset.pack, root.dataset.palette, paletteNow()]).toEqual(["starship", undefined, "camp"]);
  // Back to the Guild: no attribute, and the colours you chose stay.
  setPalette("heather");
  wearPack("guild", PACKS);
  expect([root.dataset.pack, root.dataset.palette, packNow()]).toEqual([undefined, "heather", "guild"]);
});

test("with no colours chosen, leaving a pack gives back the camp's own", () => {
  wearPack("starship", PACKS);
  wearPack("guild", PACKS);
  expect([root.dataset.pack, root.dataset.palette, paletteNow(), localStorage.getItem(PACK_KEY)]).toEqual([undefined, undefined, "camp", ""]);
});

test("the page opens wearing the pack it wore last time, before the camp has said anything", () => {
  wearPack("starship", PACKS);
  expect(localStorage.getItem(PACK_KEY)).toBe("starship harbor");
  delete root.dataset.pack; delete root.dataset.palette;
  startThemes();
  expect([root.dataset.pack, root.dataset.palette]).toEqual(["starship", "harbor"]);
  // A pack nobody knows is no pack.
  wearPack("nonesuch", PACKS);
  expect(root.dataset.pack).toBeUndefined();
});
