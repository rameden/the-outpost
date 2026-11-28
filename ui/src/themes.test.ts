// Light or dark, and which colours: two choices, kept in this browser and shared with the tour.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MODE_KEY, PACK_KEY, PALETTE_KEY, PALETTES, SEASON_KEY, modeNow, packNow, paletteNow, seasonChoice, seasonNow, setMode, setPalette, setSeason, startThemes, toggleMode, choosePack, wearPack } from "./themes.ts";

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

test("choosing a pack yourself puts its colours on over the ones you chose, and colours chosen after it hold", () => {
  setPalette("moss");
  choosePack("starship", PACKS);
  expect([root.dataset.pack, root.dataset.palette, paletteNow()]).toEqual(["starship", "harbor", "harbor"]);
  expect(localStorage.getItem(PALETTE_KEY)).toBeNull();
  // The camp's own colours, chosen on purpose, give way too.
  setPalette("camp");
  choosePack("starship", PACKS);
  expect(root.dataset.palette).toBe("harbor");
  // Colours chosen after the pack stay, and the camp saying the pack again (a refresh) leaves them.
  setPalette("heather");
  wearPack("starship", PACKS);
  expect([root.dataset.pack, root.dataset.palette]).toEqual(["starship", "heather"]);
  // A pack with no colours of its own gives back the camp's.
  choosePack("guild", PACKS);
  expect([root.dataset.pack, root.dataset.palette, paletteNow()]).toEqual([undefined, undefined, "camp"]);
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

// Decorations: a fourth choice, only for looks, kept in this browser.
afterEach(() => vi.useRealTimers());
const today = (year: number, month: number, day: number) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(year, month - 1, day, 9)); };

test("decorations are off until you turn one on: nothing is kept and nothing is set", () => {
  today(2026, 12, 25); // even on a day one is in season
  startThemes();
  expect([seasonChoice(), seasonNow(), root.dataset.season, localStorage.getItem(SEASON_KEY)]).toEqual(["", null, undefined, null]);
});

test("a decoration shows on the page as data-season, whatever the date, and Off takes it away", () => {
  today(2026, 7, 1);
  setSeason("halloween");
  expect([root.dataset.season, seasonChoice(), seasonNow(), localStorage.getItem(SEASON_KEY)]).toEqual(["halloween", "halloween", "halloween", "halloween"]);
  // It sits on top of the rest: the mode, the colours and the pack stay as they are.
  setMode("dark"); setPalette("moss"); wearPack("starship", PACKS);
  expect([root.dataset.theme, root.dataset.palette, root.dataset.pack, root.dataset.season]).toEqual(["dark", "moss", "starship", "halloween"]);
  setSeason("winter");
  expect(root.dataset.season).toBe("winter");
  setSeason("");
  expect([root.dataset.season, seasonNow(), localStorage.getItem(SEASON_KEY)]).toEqual([undefined, null, ""]);
  expect([root.dataset.theme, root.dataset.palette, root.dataset.pack]).toEqual(["dark", "moss", "starship"]);
});

test("\"Follow the calendar\" wears whatever is in season today, and nothing the rest of the year", () => {
  today(2026, 12, 10);
  setSeason("auto");
  expect([seasonChoice(), seasonNow(), root.dataset.season]).toEqual(["auto", "winter", "winter"]);
  expect(seasonNow(new Date(2026, 9, 30))).toBe("halloween");
  expect(seasonNow(new Date(2026, 11, 31))).toBe("newyear");
  expect(seasonNow(new Date(2026, 5, 1))).toBeNull();
});

test("following the calendar, the page changes with the date when you come back to it", () => {
  today(2026, 12, 30);
  localStorage.setItem(SEASON_KEY, "auto");
  startThemes();
  expect(root.dataset.season).toBe("winter");
  const heard = vi.fn();
  window.addEventListener("camp:season", heard);
  today(2026, 12, 31);
  window.dispatchEvent(new Event("focus"));
  expect(root.dataset.season).toBe("newyear");
  today(2027, 1, 7);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(root.dataset.season).toBeUndefined();
  expect(heard).toHaveBeenCalledTimes(2); // whatever draws it is told, once per change
  window.removeEventListener("camp:season", heard);
  // A decoration chosen by name doesn't follow the date.
  setSeason("winter");
  window.dispatchEvent(new Event("focus"));
  expect(root.dataset.season).toBe("winter");
});

test("a decoration chosen in another tab shows here, and a value nobody knows is off", () => {
  startThemes();
  localStorage.setItem(SEASON_KEY, "halloween");
  window.dispatchEvent(new StorageEvent("storage", { key: SEASON_KEY, newValue: "halloween" }));
  expect(root.dataset.season).toBe("halloween");
  localStorage.setItem(SEASON_KEY, "easter");
  window.dispatchEvent(new StorageEvent("storage", { key: SEASON_KEY, newValue: "easter" }));
  expect([root.dataset.season, seasonChoice()]).toEqual([undefined, ""]);
});
