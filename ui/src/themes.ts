// How the page looks: light or dark (or whichever the system is on), and a set of colours.
//
// They're two separate choices. "camp-theme" is light, dark, or nothing for "match the system";
// "camp-palette" is which colours: the camp's own warm ones (nothing kept), or one of the others.
// Every palette has a light and a dark side, so switching light and dark never changes palette,
// and matching the system works for all of them. On the page they are two attributes on <html>
// (data-theme, data-palette) that the stylesheet keys on.
//
// Both are kept in this browser, and the tour (docs/index.html, served at /splash) reads the same
// two keys, so it always looks like the page you came from. A change made in another tab (the
// tour's own switches, or Settings in another window) shows here at once.

import { storeGet, storeSet } from "./api.ts";

export type Mode = "system" | "light" | "dark";
// swatch: the palette's accent on its light side, for the dot beside its name.
export const PALETTES = [
  { id: "camp", name: "Camp", about: "Warm paper and amber. The original." },
  { id: "harbor", name: "Harbor", about: "Cool paper and deep blue." },
  { id: "moss", name: "Moss", about: "Pale lichen and green." },
  { id: "heather", name: "Heather", about: "Soft lilac and plum." },
] as const;
export type PaletteId = (typeof PALETTES)[number]["id"];

export const MODE_KEY = "camp-theme";
export const PALETTE_KEY = "camp-palette";
const isMode = (v: unknown): v is "light" | "dark" => v === "light" || v === "dark";
const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

export const modeNow = (): Mode => { const v = storeGet(MODE_KEY); return isMode(v) ? v : "system"; };
export const paletteNow = (): PaletteId => { const v = storeGet(PALETTE_KEY); return isPalette(v) ? v : "camp"; };

// Put a choice on the page. (The camp's own palette is the stylesheet's default: no attribute.)
function show(mode: unknown, palette: unknown) {
  const root = document.documentElement;
  if (isMode(mode)) root.dataset.theme = mode; else delete root.dataset.theme;
  if (isPalette(palette) && palette !== "camp") root.dataset.palette = palette; else delete root.dataset.palette;
}

export function setMode(mode: Mode) {
  storeSet(MODE_KEY, mode === "system" ? "" : mode);
  show(mode, paletteNow());
}
export function setPalette(palette: PaletteId) {
  storeSet(PALETTE_KEY, palette === "camp" ? "" : palette);
  show(modeNow(), palette);
}
// The header's switch: to the other of light and dark, whatever the system is on. The palette stays.
export function toggleMode() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  setMode(dark ? "light" : "dark");
}

// As the page opens: what was chosen last time, before anything is drawn. And from then on,
// whatever another tab changes.
export function startThemes() {
  show(modeNow(), paletteNow());
  window.addEventListener("storage", (ev) => { if (ev.key === MODE_KEY || ev.key === PALETTE_KEY) show(modeNow(), paletteNow()); });
}
