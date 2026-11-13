// Light or dark, and which colours: two choices, kept in this browser and shared with the tour.
import { beforeEach, expect, test } from "vitest";
import { MODE_KEY, PALETTE_KEY, PALETTES, modeNow, paletteNow, setMode, setPalette, startThemes, toggleMode } from "./themes.ts";

const root = document.documentElement;
beforeEach(() => { localStorage.clear(); delete root.dataset.theme; delete root.dataset.palette; });

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
