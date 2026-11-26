// Pirate: you sail a ship (seen from astern: cream sails with the skull on the mainsail, the
// black flag at the masthead, lit windows in her stern) and fire cannonballs; what comes at
// you is under red sail, bows on: sloops, a galleon, an ironclad, a shark, something with
// eight arms, and a man-o'-war with black sails at the end. Ships sit the right way up
// whichever way they go.

import type { Skin } from "../skins.ts";

const SLOOP = [
  "....DDDD...",
  "....DRRD...",
  ".DDDDDDDDD.",
  ".DRRRRRRRD.",
  ".DRRRRRRRD.",
  ".DRRRRRRRD.",
  "..DRRRRRD..",
  "DDDDDDDDDDD",
  "DBKBKBKBKBD",
  ".DBBBBBBBD.",
  "..DDDDDDD..",
];

const WOOD = { D: "#2a1608", B: "#8a5a2b", K: "#c49556" };
const RED = "#c8402f";

export const pirate: Skin = {
  craft: "SHIP",
  boss: "MAN-O'-WAR",
  player: {
    upright: true,
    paint: { ...WOOD, W: "#f3ead2", F: "#14181f", Y: "#ffd84a" },
    rows: [
      "........DDDDD....",
      "........DFFFD....",
      "....DDDDDDDDD....",
      "....DWWWWWWWD....",
      "....DWWWWWWWD....",
      "..DDDDDDDDDDDDD..",
      "..DWWWWFFFWWWWD..",
      "..DWWWWFWFWWWWD..",
      "..DWWWWWFWWWWWD..",
      "...DWWWWWWWWWD...",
      ".DDDDDDDDDDDDDDD.",
      ".DBKBKBKBKBKBKBD.",
      "..DBBYBBYBBYBBD..",
      "...DBBBBBBBBBD...",
      "....DDDDDDDDD....",
    ],
  },
  // A cannonball: iron grey, so it shows on a dark page as well as a light one.
  shot: { paint: { D: "#14181f", K: "#8a93a3", L: "#f3f5f8" }, rows: [".DDD.", "DKKKD", "DKLKD", "DKKKD", ".DDD."] },
  enemies: {
    // A sloop: one red sail.
    scout: { upright: true, paint: { ...WOOD, R: RED }, rows: SLOOP },
    // The commodore's: a bigger sail, trimmed in gold.
    leader: {
      upright: true,
      paint: { ...WOOD, R: RED, Y: "#ffd84a" },
      rows: [
        ".....DDDD....",
        ".....DYYD....",
        ".DDDDDDDDDDD.",
        ".DYYYYYYYYYD.",
        ".DRRRRRRRRRD.",
        ".DRRRRYRRRRD.",
        ".DRRRRRRRRRD.",
        "..DRRRRRRRD..",
        "DDDDDDDDDDDDD",
        "DBKBKBYBKBKBD",
        ".DBBBBBBBBBD.",
        "..DDDDDDDDD..",
      ],
    },
    // A privateer: a purple sail over a gilded hull.
    ace: { upright: true, paint: { D: "#1c0f33", B: "#3a2466", K: "#ffd84a", R: "#7a4bd6" }, rows: SLOOP },
    // A galleon: a topsail over a great mainsail, and a row of guns.
    heavy: {
      upright: true,
      paint: { ...WOOD, R: RED, G: "#14181f", Y: "#ffd84a" },
      rows: [
        ".........D.........",
        ".....DDDDDDDDD.....",
        ".....DRRRRRRRD.....",
        ".....DRRRRRRRD.....",
        ".DDDDDDDDDDDDDDDDD.",
        ".DRRRRRRRRRRRRRRRD.",
        ".DRRRRRRRRRRRRRRRD.",
        ".DRRRRRRRRRRRRRRRD.",
        "..DRRRRRRRRRRRRRD..",
        "...DDRRRRRRRRRDD...",
        "DDDDDDDDDDDDDDDDDDD",
        "DBBGBBGBBGBBGBBGBBD",
        ".DBBBBBBBBBBBBBBBD.",
        "..DBKBKBKYKBKBKBD..",
        "...DDDDDDDDDDDDD...",
      ],
    },
    // A merchantman under a yellow sail, with her treasure on deck.
    ferry: {
      upright: true,
      paint: { ...WOOD, Y: "#f0c040", W: "#fff3c4" },
      rows: [
        ".......D.......",
        "..DDDDDDDDDDD..",
        "..DYYYYYYYYYD..",
        "..DYYYYYYYYYD..",
        "..DYYYYYYYYYD..",
        "...DYYYYYYYD...",
        ".DDDDDDDDDDDDD.",
        ".DBKBWWWWWBKBD.",
        "..DBBWKWKWBBD..",
        "...DBBBBBBBD...",
        "....DDDDDDD....",
      ],
    },
    // A shark, from above: pale, with a dark fin down its back.
    dart: {
      paint: { D: "#14283a", P: "#b8c8d8", K: "#3a5068" },
      rows: ["...D...", "..DPD..", ".DPPPD.", "DDPKPDD", "DPDKDPD", ".DPPPD.", "..DPD..", ".DPDPD.", "DD...DD"],
    },
    // Something with eight arms, orange, coming up behind you.
    chaser: {
      upright: true,
      paint: { D: "#3e1604", O: "#ff7a1a", K: "#14181f" },
      rows: ["..DDDDD..", ".DOOOOOD.", ".DOKOKOD.", ".DOOOOOD.", "..DOOOD..", ".DODODOD.", "DOD.O.DOD", "OD.DOD.DO", "D..D.D..D"],
    },
    // A powder keg, adrift, with its fuse lit.
    mine: { paint: { D: "#2a1608", M: "#8a5a2b", R: "#c8402f", S: "#ffd84a" } },
    // A fat merchantman, with a hold worth opening.
    hauler: {
      upright: true,
      paint: { ...WOOD, R: "#e0a04a", H: "#2a1608" },
      rows: [
        "........D........",
        "...DDDDDDDDDDD...",
        "...DRRRRRRRRRD...",
        "...DRRRRRRRRRD...",
        "...DRRRRRRRRRD...",
        "....DRRRRRRRD....",
        "DDDDDDDDDDDDDDDDD",
        "DBKBKBKHHHKBKBKBD",
        ".DBBBBBHHHBBBBBD.",
        "..DBBBBBBBBBBBD..",
        "...DDDDDDDDDDD...",
      ],
    },
    // An ironclad: her hull is plated ("S"), and shot only tells from behind it.
    gunship: {
      upright: true,
      bare: "#8a5a2b",
      paint: { ...WOOD, S: "#aab6c4", C: "#e6edf4", R: RED, G: "#14181f", Y: "#ffd84a" },
      rows: [
        "........D........",
        "....DDDDDDDDD....",
        "....DRRRRRRRD....",
        "..DDDDDDDDDDDDD..",
        "..DRRRRRRRRRRRD..",
        "..DRRRRRRRRRRRD..",
        "..DRRRRRRRRRRRD..",
        "...DRRRRRRRRRD...",
        "DDDDDDDDDDDDDDDDD",
        "DSSSSSSSSSSSSSSSD",
        "DSCSSSCSSSCSSSCSD",
        ".DSSSSSSSSSSSSSD.",
        ".DGSSGSSYSSGSSGD.",
        "..DSSSSSSSSSSSD..",
        "...DDDDDDDDDDD...",
      ],
    },
    // A red buoy on its chain.
    balloon: { paint: { D: "#2a1608", S: "#c8402f", L: "#f08a7a", R: "#f3ead2" } },
    // The man-o'-war: black sails, a skull on the mainsail, guns all along her.
    flagship: {
      upright: true,
      paint: { D: "#0b0b0e", B: "#8a5a2b", R: "#2f2f3a", W: "#f3ead2", K: "#0b0b0e", G: "#14181f", Y: "#ffd84a" },
      rows: [
        "............D............",
        "........DDDDDDDDD........",
        "........DRRRRRRRD........",
        "........DRRRRRRRD........",
        "...DDDDDDDDDDDDDDDDDDD...",
        "...DRRRRRRRRRRRRRRRRRD...",
        "...DRRRRRRRWWWRRRRRRRD...",
        "...DRRRRRRWKWKWRRRRRRD...",
        "...DRRRRRRRWWWRRRRRRRD...",
        "...DRRRRRRRWRWRRRRRRRD...",
        "....DRRRRRRRRRRRRRRRD....",
        "DDDDDDDDDDDDDDDDDDDDDDDDD",
        "DBBGBBGBBGBBGBBGBBGBBGBBD",
        ".DBBBBBBBBBBBBBBBBBBBBBD.",
        ".DBGBBGBBGBBYBBGBBGBBGBD.",
        "..DBBBBBBBBBBBBBBBBBBBD..",
        "...DDDDDDDDDDDDDDDDDDD...",
      ],
    },
    // The ships: timber, with a red pennant.
    carrier: { paint: { D: "#2a1608", H: "#a8743a", K: "#7a5226", W: "#f3ead2", I: "#3e2410", Y: "#ffd84a", T: RED } },
    boat: { paint: { D: "#2a1608", H: "#a8743a", K: "#7a5226", I: "#3e2410", Y: "#ffd84a", T: RED } },
  },
  // Deckhands: a red bandana, a cream shirt, navy breeches.
  builders: "deckhands",
  builder: { H: "#c8402f", D: "#8a2a1e", S: "#f0b98a", K: "#14181f", N: "#d9866a", B: "#f3ead2", T: "#2a3a5a", F: "#3e2410" },
};
