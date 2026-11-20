// Newsroom: you're a kid on a bike (side on: a red cap, a green jacket, a bag of papers behind
// the saddle) throwing rolled newspapers; what comes at you is the street you deliver to: the
// old man with his stick, the mail man, the mail cart, the lady from next door, a toddler on a
// trike, a dog that's after your back wheel, a lad behind a bin lid, and the ice cream van at
// the end. People stand the right way up whichever way they go.

import type { Skin } from "../skins.ts";
import { TRUCK } from "./shapes.ts";

const SKIN = "#f0b98a";

export const newsroom: Skin = {
  craft: "BIKE",
  boss: "ICE CREAM VAN",
  player: {
    upright: true,
    paint: { D: "#16233f", W: "#b9c0cc", H: "#8a93a3", S: SKIN, K: "#14181f", R: "#d8402f", G: "#3fa860", B: "#3b6ea8", A: "#c49556", P: "#f3f0e6" },
    rows: [
      ".......DDDD......",
      "......DRRRRDD....",
      "......DSSSSD.....",
      "......DSSKSD.....",
      "...DDDDGGGDD.....",
      "..DPPPDGGGGSDD...",
      "..DAAADGGGD.DHD..",
      "...DDDDBBBD..D...",
      "..DDD..DBBD.DDD..",
      ".DWWWD..DBDDWWWD.",
      "DW.D.WDDDDDW.D.WD",
      "DWDDDWD...DWDDDWD",
      "DW.D.WD...DW.D.WD",
      ".DWWWD.....DWWWD.",
      "..DDD.......DDD..",
    ],
  },
  // A rolled newspaper, end over end.
  shot: {
    spin: true,
    paint: { D: "#1b1b1f", W: "#f3f0e6", K: "#8a8474", R: "#c8402f" },
    rows: [".DDD.", "DWWWD", "DWKWD", "DRRRD", "DWKWD", "DWWWD", ".DDD."],
  },
  enemies: {
    // The old man: bald on top, a white moustache, a cardigan, and his stick up at you.
    scout: {
      upright: true,
      paint: { D: "#16181f", S: SKIN, W: "#f3f0e6", K: "#14181f", G: "#6f8fa8", B: "#6a5238", T: "#c49556" },
      rows: [
        "...DDDDD...",
        "..DSSSSSD..",
        ".DWSSSSSWD.",
        "..DSKSKSD.T",
        "..DWWWWWD.T",
        "...DDDDD..T",
        ".DGGGGGGGDT",
        "DSDGGWGGDST",
        ".DDGGGGGDD.",
        "..DBBDBBD..",
        "..DDD.DDD..",
      ],
    },
    // The mail man: a blue cap with a gold badge, gold buttons, and his bag at his side.
    leader: {
      upright: true,
      paint: { D: "#101a33", B: "#3b6ea8", Y: "#ffd84a", S: SKIN, K: "#14181f", A: "#a8743a", W: "#f3f0e6", N: "#2a4a80" },
      rows: [
        "....DDDDD....",
        "...DBBYBBD...",
        "..DDDDDDDDD..",
        "...DSSSSSD...",
        "...DSKSKSD...",
        "....DDDDD....",
        "..DBBBYBBBDD.",
        ".DSDBBYBBDAAD",
        ".DDDBBYBBDAWD",
        "...DBBBBBDDD.",
        "...DNNDNND...",
        "...DDD.DDD...",
      ],
    },
    // The lady from next door: curlers in, a purple dressing gown, and the rolling pin.
    ace: {
      upright: true,
      paint: { D: "#1c0f33", C: "#ffd84a", H: "#c9b8e8", S: SKIN, K: "#14181f", R: "#d8402f", P: "#7a4bd6", Y: "#ffd84a" },
      rows: [
        "..DCDCDCD..",
        ".DCHHHHHCD.",
        "..DSSSSSD..",
        "..DSKSKSD..",
        "..DSSRSSD.Y",
        "...DDDDD..Y",
        ".DPPPPPPPDY",
        "DSDPPYPPDSY",
        ".DDPPPPPDD.",
        "..DPPPPPD..",
        "..DDDDDDD..",
      ],
    },
    // The mail cart, head on: white, a blue stripe over a red one, and the mail man's mate driving.
    heavy: {
      upright: true,
      paint: { D: "#101a33", W: "#f3f5f8", C: "#9fd0f0", B: "#3b6ea8", R: "#d8402f", S: SKIN, K: "#2a2a30", Y: "#ffd84a", G: "#8a93a3" },
      rows: [
        "....DDDDDDDDDDD....",
        "...DWWWWWWWWWWWD...",
        "...DWCCCCCCCCCWD...",
        "...DWCCDBBBDCCWD...",
        "...DWCCDSSSDCCWD...",
        ".DDDWWWWWWWWWWWDDD.",
        ".DKDBBBBBBBBBBBDKD.",
        ".DDDRRRRRRRRRRRDDD.",
        "...DWWWWWWWWWWWD...",
        "...DWWWWWWWWWWWD...",
        "..DDDDDDDDDDDDDDD..",
        "..DYYDGGGGGGGDYYD..",
        "..DDDDDDDDDDDDDDD..",
        "...DKKD.....DKKD...",
        "...DDDD.....DDDD...",
      ],
    },
    // The yellow van with the late edition in it.
    ferry: {
      paint: { D: "#5a3d08", Y: "#f0c040", C: "#bfe6ff", W: "#fff3c4", K: "#a87a14" },
      rows: [
        "...DDDDDDDDD...",
        "..DYYYYYYYYYD..",
        "..DYCCCCCCCYD..",
        ".DDYCCCCCCCYDD.",
        ".DYYYYYYYYYYYD.",
        ".DYYWWWWWWWYYD.",
        ".DYYWKKKKKWYYD.",
        ".DYYWWWWWWWYYD.",
        ".DDYYYYYYYYYDD.",
        "..DYYYYYYYYYD..",
        "..DDDDDDDDDDD..",
      ],
    },
    // A toddler on a pink trike, and not looking where it's going.
    dart: {
      upright: true,
      paint: { D: "#4a0a2c", P: "#ff4fa0", S: SKIN, K: "#14181f" },
      rows: ["..DDD..", ".DPPPD.", ".DSSSD.", ".DKSKD.", "DDDDDDD", "DSPPPSD", ".DPKPD.", "..DKD..", "..DDD.."],
    },
    // A dog, after your back wheel.
    chaser: {
      upright: true,
      paint: { D: "#3e1604", O: "#ff7a1a", E: "#b8500e", K: "#1b1b1f", W: "#ffe9c8", R: "#e2463c" },
      rows: [".DD...DD.", "DEEDDDEED", "DEOOOOOED", "DOOKOKOOD", ".DOOOOOD.", ".DOWKWOD.", ".DWWRWWD.", "..DWRWD..", "...DDD..."],
    },
    // A fire hydrant: red, and right where you were going.
    mine: {
      upright: true,
      paint: { D: "#2a0d0d", R: "#d8402f", L: "#ff9a8a", Y: "#ffd84a" },
      rows: ["...DDD...", "..DRRRD..", "..DRLRD..", ".DDDDDDD.", "DYDRRRDYD", ".DDRLRDD.", "..DRRRD..", ".DRRRRRD.", ".DDDDDDD."],
    },
    // The bin lorry, on its round as well.
    hauler: { paint: { D: "#12301f", R: "#3f8a4a", C: "#bfe6ff", W: "#c3cad4", K: "#6b7480", H: "#12301f" }, rows: TRUCK },
    // A lad behind a bin lid ("S": it only covers him from the front).
    gunship: {
      upright: true,
      bare: "#6b6f7a",
      paint: { D: "#16181f", H: "#c8402f", F: SKIN, K: "#14181f", S: "#dfe6ee", C: "#aab6c4", R: "#3fa860", B: "#3b4a6b" },
      rows: [
        ".....DDDDDDD.....",
        "....DHHHHHHHD....",
        "....DFFFFFFFD....",
        "....DFKFFFKFD....",
        "....DFFFFFFFD....",
        "....DDDDDDDDD....",
        "...DDSSSSSSSDD...",
        "..DSSSSSSSSSSSD..",
        ".DRDSSSCCCSSSDRD.",
        ".DRDSSSCKCSSSDRD.",
        ".DDDSSSCCCSSSDDD.",
        "..DSSSSSSSSSSSD..",
        "...DDSSSSSSSDD...",
        "....DBBBDBBBD....",
        "....DDDD.DDDD....",
      ],
    },
    // A balloon on a line, got away from somebody's party.
    balloon: { paint: { D: "#1b1b1f", S: "#f3f0e6", L: "#ffffff", R: "#c8402f" } },
    // The ice cream van, head on: a cone on its roof and a striped awning under the windscreen.
    flagship: {
      upright: true,
      paint: { D: "#2a1020", W: "#fff6f0", C: "#9fd0f0", L: "#ffffff", P: "#ff8ab8", A: "#d9a45a", K: "#2a2a30", Y: "#ffd84a", G: "#8a93a3" },
      rows: [
        "..........DDDDD..........",
        ".........DPPLPPD.........",
        ".........DPPPPPD.........",
        "..........DAAAD..........",
        ".....DDDDDDDDDDDDDDD.....",
        "....DWWWWWWWWWWWWWWWD....",
        "....DWCCCCCCCCCCCCCWD....",
        "....DWCCCCCCCCCCLCCWD....",
        "....DWCCCCCCCCCCCCCWD....",
        "..DDDPPPPPPPPPPPPPPPDDD..",
        "..DKDWPWPWPWPWPWPWPWDKD..",
        "..DDDWWWWWWWWWWWWWWWDDD..",
        "...DDDDDDDDDDDDDDDDDDD...",
        "...DYYYDGGGGGGGGGDYYYD...",
        "...DDDDDDDDDDDDDDDDDDD...",
        "....DKKKD.......DKKKD....",
        "....DDDDD.......DDDDD....",
      ],
    },
    // The ships: newsprint grey, with a red masthead.
    carrier: { paint: { D: "#1b1b1f", H: "#d8d2c4", K: "#a8a294", W: "#f3f0e6", I: "#3a3f4b", Y: "#ffd84a", T: "#c8402f" } },
    boat: { paint: { D: "#1b1b1f", H: "#d8d2c4", K: "#a8a294", I: "#3a3f4b", Y: "#ffd84a", T: "#c8402f" } },
  },
  // The old men of the street: a flat cap, a white beard, a brown cardigan.
  builder: { H: "#6b6f7a", D: "#4a4e58", S: SKIN, K: "#14181f", N: "#d9866a", B: "#f3f0e6", T: "#8a5a2b", F: "#1b1b1f" },
};
