// What Barnstorm looks like under each theme pack (src/packs.ts). The game is the same game
// whichever pack the camp is wearing: the same arithmetic, the same sizes, the same keys. A skin
// only changes the pictures: what you fly, what you fire, what comes at you in the Sortie, and
// who mends the page in the Wreck. The Guild (and a pack of your own) has no skin: that's the
// plane, as drawn in flight.ts, gremlins.ts and Sortie.tsx.
//
// Every picture is rows of letters, each letter a colour in its paint and a dot nothing, like
// the rest of the game's. Something that flies is drawn nose up and turned to its heading,
// unless it's `upright` (a person, say, who'd look silly upside down): that's drawn as it is.

import type { EnemyKind } from "./sortie.ts";
import { lab } from "./skins/lab.ts";
import { newsroom } from "./skins/newsroom.ts";
import { pirate } from "./skins/pirate.ts";
import { starship } from "./skins/starship.ts";
import { studio } from "./skins/studio.ts";

export type Paint = Record<string, string>;
export type Art = { rows: string[]; paint: Paint };
// One of the Sortie's enemies. No rows: the plane game's own shape, in this paint (the ships,
// which are built row by row, and anything else whose shape already suits). `bare` is what its
// armour ("S") goes when it's turned away from you (the gunship).
export type EnemyArt = { rows?: string[]; paint: Paint; upright?: boolean; bare?: string };

export type Skin = {
  craft: string; // what you fly, in a word, for "EXTRA …"
  boss: string; // what the flagship is, for "… INBOUND"
  player: Art & { flicker?: string; upright?: boolean }; // (flicker: a letter that comes and goes: an engine's flame)
  shot: Art & { spin?: boolean }; // what you fire (spin: it tumbles as it goes)
  enemies: Record<EnemyKind, EnemyArt>;
  builder: Paint; // the Wreck's builders, in other clothes (the letters of GREMLIN_PAINT)
};

export const SKINS: Record<string, Skin> = { starship, newsroom, studio, lab, pirate };

// The skin a pack wears, or nothing for the plane.
export const skinFor = (pack: string): Skin | null => (Object.hasOwn(SKINS, pack) ? SKINS[pack] : null);

// A gunship's paint with its armour turned away. (Made once for each paint, not every frame.)
const bared = new WeakMap<Paint, Paint>();
// A paint with one letter left out of it (so that letter isn't drawn): the half of a flicker
// when the flame's out.
const quieted = new WeakMap<Paint, Paint>();
export function quiet(paint: Paint, letter: string): Paint {
  let it = quieted.get(paint);
  if (!it) { it = { ...paint }; delete it[letter]; quieted.set(paint, it); }
  return it;
}

export function bareOf(paint: Paint, bare = "#5d6675"): Paint {
  let it = bared.get(paint);
  if (!it) bared.set(paint, it = { ...paint, S: bare });
  return it;
}
