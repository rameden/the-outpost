// Studio: you're the star (gold hair, dark glasses, a red gown and a sparkle about you) and
// what you throw is stars; what comes at you is everyone else on the lot: a paparazzo, a
// camera on legs, the boom operator under a fuzzy mic, a shady dealer who hangs about by the
// trailers, and the Director at the end. People stand the right way up whichever way they go.

import type { Skin } from "../skins.ts";
import { DRONE, TRUCK } from "./shapes.ts";

export const studio: Skin = {
  craft: "TAKE",
  boss: "THE DIRECTOR",
  player: {
    upright: true,
    flicker: "f",
    paint: { D: "#2a1020", Y: "#f6cf4a", S: "#f0b98a", K: "#14181f", R: "#d8203a", W: "#fff6f0", f: "#ffe680" },
    rows: [
      "f.....DDDDD.....f",
      ".....DYYYYYD.....",
      "....DYYYYYYYD....",
      "....DYSSSSSYD....",
      "....DYKKSKKYD....",
      ".f..DYSSRSSYD..f.",
      ".....DDSSSDD.....",
      ".DD.DWWWWWWWD.DD.",
      "DSSDDRRRRRRRDDSSD",
      ".DDSSRRRRRRRSSDD.",
      "....DRRRWRRRD....",
      "....DRRRRRRRD....",
      "...DRRRRRRRRRD...",
      "..DRRRRRRRRRRRD..",
      "..DDDDDDDDDDDDD..",
    ],
  },
  // A gold star, turning over as it goes.
  shot: {
    spin: true,
    paint: { D: "#5a3d08", Y: "#ffd84a" },
    rows: ["....D....", "...DYD...", "DDDDYDDDD", "DYYYYYYYD", ".DYYYYYD.", "..DYYYD..", ".DYYDYYD.", ".DYD.DYD.", ".DD...DD."],
  },
  enemies: {
    // A paparazzo: all you see of the face is a camera, and its flash.
    scout: {
      upright: true,
      paint: { D: "#16181f", K: "#2a2a30", S: "#f0b98a", C: "#9fe0ff", Y: "#fff3a0", G: "#8a93a3", B: "#3b4a6b" },
      rows: [
        "...DDDDD...",
        "..DKKKKKD..",
        "..DSSSSSD..",
        ".DDKKCKKYD.",
        ".DSDKKKDSD.",
        "..DDDDDDD..",
        ".DGGGGGGGD.",
        ".DGGGGGGGD.",
        "..DGGDGGD..",
        "..DBBDBBD..",
        "..DDD.DDD..",
      ],
    },
    // The assistant director, with a gold megaphone.
    leader: {
      upright: true,
      paint: { D: "#16181f", K: "#2a2a30", S: "#f0b98a", G: "#2f6f5a", B: "#3b4a6b", Y: "#ffd84a" },
      rows: [
        "....DDDDD....",
        "...DKKKKKD...",
        "...DSSSSSD...",
        "...DSKSKSD.DD",
        "...DSSSSDDYYD",
        "....DDDDYYYYD",
        "..DDGGGDDYYYD",
        ".DGGGGGGGDDDD",
        ".DGGGGGGGD...",
        "..DGGDGGD....",
        "..DBBDBBD....",
        "..DDD.DDD....",
      ],
    },
    // The shady dealer: a wide hat, dark glasses, a purple coat and a gold chain.
    ace: {
      upright: true,
      paint: { D: "#1c0f33", P: "#7a4bd6", S: "#f0b98a", K: "#14181f", Y: "#ffd84a" },
      rows: [
        "...DDDDD...",
        "..DPPPPPD..",
        "DDDDDDDDDDD",
        "..DSSSSSD..",
        "..DKKSKKD..",
        "..DDSSSDD..",
        ".DPPDYDPPD.",
        "DPPPPYPPPPD",
        "DPDPPPPPDPD",
        ".DDPPDPPDD.",
        "...DD.DD...",
      ],
    },
    // The camera man, or what you see of him: two reels, a great lens, a hand at each side
    // and his legs underneath.
    heavy: {
      upright: true,
      paint: { D: "#16181f", K: "#2a2a30", W: "#b9c0cc", G: "#5d6675", C: "#4fb3e8", L: "#eaf8ff", S: "#f0b98a", R: "#e2463c", B: "#3b4a6b" },
      rows: [
        "....DDDD...DDDD....",
        "...DKKKKD.DKKKKD...",
        "...DKWWKD.DKWWKD...",
        "...DKKKKD.DKKKKD...",
        "....DDDDDDDDDDD....",
        "...DGGGGGGGGGGRD...",
        "..DDGGGDDDDDGGGDD..",
        ".DSDGGDCCCCCDGGDSD.",
        ".DSDGGDCCLCCDGGDSD.",
        ".DDDGGDCCCCCDGGDDD.",
        "...DGGGDDDDDGGGD...",
        "...DDDDDDDDDDDDD...",
        "....DBBD.K.DBBD....",
        "....DBBD.K.DBBD....",
        "...DDDDD.D.DDDDD...",
      ],
    },
    // A runner in a yellow vest, with a box of something for you.
    ferry: {
      upright: true,
      paint: { D: "#5a3d08", K: "#3a2a1a", S: "#f0b98a", Y: "#f0c040", W: "#d9b382", B: "#3b4a6b" },
      rows: [
        ".....DDDDD.....",
        "....DKKKKKD....",
        "....DSSSSSD....",
        "....DSKSKSD....",
        ".....DDDDD.....",
        "..DDDYYYYYDDD..",
        ".DSDWWWWWWWDSD.",
        ".DDDWKKKKKWDDD.",
        "...DWWWWWWWD...",
        "....DBBDBBD....",
        "....DDD.DDD....",
      ],
    },
    // A fan who's got past the gate: pink hair, arms out, an autograph book.
    dart: {
      upright: true,
      paint: { D: "#4a0a2c", P: "#ff4fa0", S: "#f0b98a", K: "#14181f", C: "#ffffff" },
      rows: ["..DDD..", ".DPPPD.", ".DSSSD.", ".DKSKD.", "DDDDDDD", "DSPPPSD", "DDPCPDD", ".DPDPD.", ".DD.DD."],
    },
    // A camera drone, orange, after the shot from behind.
    chaser: { paint: { D: "#3e1604", O: "#ff7a1a", C: "#9fe0ff" }, rows: DRONE },
    // A studio lamp, left on and very hot.
    mine: { paint: { D: "#16181f", M: "#3a3f4b", R: "#fff3a0", S: "#ffd84a" } },
    // The grip truck.
    hauler: { paint: { D: "#16181f", R: "#4a5568", C: "#bfe6ff", W: "#f3f0e6", K: "#8a8474", H: "#16181f" }, rows: TRUCK },
    // The boom operator: a fuzzy mic held high ("S": it only covers him from the front).
    gunship: {
      upright: true,
      bare: "#5d6675",
      paint: { D: "#16181f", S: "#c9b594", K: "#2a2a30", H: "#3a3f4b", F: "#f0b98a", R: "#8c2a3a", B: "#3b4a6b" },
      rows: [
        ".....DDDDDDD.....",
        "....DSSSSSSSD....",
        "....DSSSSSSSD....",
        ".....DDDKDDD.....",
        "........K........",
        ".DD...DDKDD...DD.",
        "DFFD.DHHKHHD.DFFD",
        "DFFD.DFFFFFD.DFFD",
        ".DRD.DFKFKFD.DRD.",
        ".DRDDDDFFFDDDDRD.",
        ".DRRRRRRRRRRRRRD.",
        "..DDDRRRRRRRDDD..",
        "....DRRRRRRRD....",
        "....DBBBDBBBD....",
        "....DDDD.DDDD....",
      ],
    },
    // A lighting balloon, glowing over the set.
    balloon: { paint: { D: "#3a3320", S: "#fff6d0", L: "#ffffff", R: "#ffd84a" } },
    // The Director: a beret, dark glasses, a megaphone, the script, and the chair.
    flagship: {
      upright: true,
      paint: { D: "#16181f", K: "#2a2a30", S: "#f0b98a", R: "#8c2a3a", Y: "#ffd84a", W: "#f3f0e6", C: "#2f7f6a" },
      rows: [
        "........DDDDDDDDD........",
        ".......DKKKKKKKKKD.......",
        "......DDKKKKKKKKKDD......",
        ".......DSSSSSSSSSD.......",
        ".......DSKKSSSKKSD....DD.",
        ".......DSSSSSSSSSD..DDYD.",
        "........DSSRRRSSD.DDYYYD.",
        ".........DDDDDDDDDYYYYYD.",
        "....DDDDDRRRRRRRDDDDYYYD.",
        "...DWWWDRRRRRRRRRRSD.DYD.",
        "...DWKWDRRRRRRRRRDDD..DD.",
        "...DWWWDRRRRRRRRRD.......",
        "..DDDDDDDDDDDDDDDDDDD....",
        "..DCCCCCCCCCCCCCCCCCD....",
        "..DDDKDDDDDDDDDDDKDDD....",
        ".....DKD.......DKD.......",
        "....DKD.........DKD......",
      ],
    },
    // The ships: set pieces, painted violet for the night shoot.
    carrier: { paint: { D: "#16181f", H: "#9a86c8", K: "#6a5a98", W: "#f3f0e6", I: "#2a2440", Y: "#ffd84a", T: "#e2463c" } },
    boat: { paint: { D: "#16181f", H: "#9a86c8", K: "#6a5a98", I: "#2a2440", Y: "#ffd84a", T: "#e2463c" } },
  },
  // The crew: black cap, black tee, jeans.
  builder: { H: "#1b1b1f", D: "#3a3f4b", S: "#f0b98a", K: "#14181f", N: "#d9866a", B: "#2a2a30", T: "#3b4a6b", F: "#1b1b1f" },
};
