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
//
// A theme pack (Settings → General) is a third thing, and the camp keeps it, not the browser,
// because it renames the crew. It shows on the page as data-pack (nothing for the Guild's), which
// recolours the orb, and it may suggest a palette: that one is worn until you choose colours
// yourself, and from then on your choice wins. "camp-pack" is this browser's copy of it ("<pack>
// <its palette>"), kept only so the page (and the tour, and the sign-in page) opens wearing it.
//
// Decorations (seasons.ts) are a fourth, and only for looks: snow, lights, a tint on the orb. Kept
// in this browser as "camp-season": nothing for off, "auto" to follow the calendar, or one by
// name. Whichever is on shows as data-season, on top of any pack and any colours.

import { useSyncExternalStore } from "react";
import { storeGet, storeSet } from "./api.ts";
import { isSeason, seasonFor, type SeasonId } from "./seasons.ts";

export type Mode = "system" | "light" | "dark";
// swatch: the palette's accent on its light side, for the dot beside its name.
export const PALETTES = [
  { id: "camp", name: "Camp", about: "Warm paper and amber. The original." },
  { id: "harbor", name: "Harbor", about: "Cool paper and deep blue." },
  { id: "moss", name: "Moss", about: "Pale lichen and green." },
  { id: "heather", name: "Heather", about: "Soft lilac and plum." },
  { id: "ochre", name: "Ochre", about: "Cream, navy and ochre. The app's own." },
] as const;
export type PaletteId = (typeof PALETTES)[number]["id"];

export const MODE_KEY = "camp-theme";
export const PALETTE_KEY = "camp-palette";
const isMode = (v: unknown): v is "light" | "dark" => v === "light" || v === "dark";
const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

export const PACK_KEY = "camp-pack";
let pack = "";                          // the theme pack on the page ("" for the Guild's)
let suggested: PaletteId | null = null; // the palette it suggests, if it suggests one

export const modeNow = (): Mode => { const v = storeGet(MODE_KEY); return isMode(v) ? v : "system"; };
// Your own choice of colours (kept as "" when it's the camp's own), else the pack's, else the camp's.
export const paletteNow = (): PaletteId => { const v = storeGet(PALETTE_KEY); return isPalette(v) ? v : v === "" ? "camp" : suggested ?? "camp"; };
export const packNow = () => pack || "guild";

// Decorations. What you chose ("" is off), and which one that puts on the page today.
export const SEASON_KEY = "camp-season";
export type SeasonChoice = "" | "auto" | SeasonId;
export const seasonChoice = (): SeasonChoice => { const v = storeGet(SEASON_KEY); return v === "auto" || isSeason(v) ? v : ""; };
export function seasonNow(today = new Date()): SeasonId | null {
  const c = seasonChoice();
  return c === "auto" ? seasonFor(today)?.id ?? null : c || null;
}
const SEASON_CHANGED = "camp:season";
const onSeason = (fn: () => void) => { window.addEventListener(SEASON_CHANGED, fn); return () => window.removeEventListener(SEASON_CHANGED, fn); };
// The decoration on the page, for whatever draws it (App loads components/Decor.tsx only when there is one).
export const useSeason = () => useSyncExternalStore(onSeason, () => (document.documentElement.dataset.season as SeasonId | undefined) ?? null);

// Put a choice on the page. (The camp's own palette is the stylesheet's default: no attribute.)
function show(mode: unknown, palette: unknown) {
  const root = document.documentElement;
  if (pack) root.dataset.pack = pack; else delete root.dataset.pack;
  if (isMode(mode)) root.dataset.theme = mode; else delete root.dataset.theme;
  if (isPalette(palette) && palette !== "camp") root.dataset.palette = palette; else delete root.dataset.palette;
  const season = seasonNow();
  if (season === (root.dataset.season ?? null)) return;
  if (season) root.dataset.season = season; else delete root.dataset.season;
  window.dispatchEvent(new Event(SEASON_CHANGED));
}

export function setMode(mode: Mode) {
  storeSet(MODE_KEY, mode === "system" ? "" : mode);
  show(mode, paletteNow());
}
export function setPalette(palette: PaletteId) {
  storeSet(PALETTE_KEY, palette === "camp" ? "" : palette);
  show(modeNow(), palette);
}
export function setSeason(choice: SeasonChoice) {
  storeSet(SEASON_KEY, choice);
  show(modeNow(), paletteNow());
}
// Wear a theme pack: the camp says which one is on (in its state), and which palette it suggests.
export function wearPack(id: string | undefined, packs: { id: string; palette?: string }[] = []) {
  const p = id && id !== "guild" ? packs.find((x) => x.id === id) : undefined;
  pack = p ? p.id : "";
  suggested = p && isPalette(p.palette) ? p.palette : null;
  const kept = pack ? `${pack} ${suggested ?? ""}`.trim() : "";
  if ((storeGet(PACK_KEY) ?? "") !== kept) storeSet(PACK_KEY, kept);
  show(modeNow(), paletteNow());
}
function packKept() {
  const [id, palette] = (storeGet(PACK_KEY) ?? "").split(" ");
  pack = /^[a-z0-9-]+$/.test(id ?? "") ? id : "";
  suggested = pack && isPalette(palette) ? palette : null;
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
  packKept();
  show(modeNow(), paletteNow());
  window.addEventListener("storage", (ev) => {
    if (ev.key === PACK_KEY) packKept();
    if (ev.key === MODE_KEY || ev.key === PALETTE_KEY || ev.key === PACK_KEY || ev.key === SEASON_KEY) show(modeNow(), paletteNow());
  });
  // "Follow the calendar" is worked out again when the day may have changed: on coming back to
  // the page, and once an hour for a page left open.
  const again = () => { if (seasonChoice() === "auto") show(modeNow(), paletteNow()); };
  window.addEventListener("focus", again);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) again(); });
  setInterval(again, 60 * 60_000);
}
