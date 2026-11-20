// Starship: you fly a small white ship with a blue canopy and fire green bolts; what comes at
// you is out of the dark: saucers, an alien cruiser, a rock with something glowing in it, and
// a mothership at the end.

import type { Skin } from "../skins.ts";

const SAUCER = [
  "...DDDDD...",
  "..DGGGGGD..",
  ".DGGGGGGGD.",
  "DGRGDDDGRGD",
  "DGGDCCCDGGD",
  "DGGDCLCDGGD",
  "DGGDCCCDGGD",
  "DGRGDDDGRGD",
  ".DGGGGGGGD.",
  "..DGGGGGD..",
  "...DDDDD...",
];

export const starship: Skin = {
  craft: "SHIP",
  boss: "MOTHERSHIP",
  player: {
    flicker: "F",
    paint: { D: "#10182c", H: "#eef2f8", G: "#9aa7ba", C: "#4fd8f0", R: "#e2463c", B: "#2f7fd0", F: "#ffb020" },
    rows: [
      "........D........",
      ".......DHD.......",
      ".......DHD.......",
      "......DHCHD......",
      "......DHCHD......",
      ".....DHHCHHD.....",
      ".....DHGHGHD.....",
      "..D..DHGHGHD..D..",
      ".DRD.DHGHGHD.DRD.",
      ".DGDDDHHHHHDDDGD.",
      "DGGGGGHHHHHGGGGGD",
      "DGGRGGGHHHGGGRGGD",
      ".DDDDDGBDBGDDDDD.",
      ".....DDFDFDD.....",
      ".......F.F.......",
    ],
  },
  // A bolt of green light.
  shot: { paint: { D: "#0b2a1c", G: "#7dffb0", W: "#eafff2" }, rows: [".D.", "DWD", "DGD", "DGD", "DGD", "DGD", "DGD", ".D."] },
  enemies: {
    // A saucer: green, a pale dome, a red light at each corner.
    scout: { paint: { D: "#12301f", G: "#4fc47a", C: "#bff5e0", L: "#ffffff", R: "#ff5a3c" }, rows: SAUCER },
    // The same, a size up, with a gold rim.
    leader: {
      paint: { D: "#12301f", G: "#4fc47a", C: "#bff5e0", L: "#ffffff", Y: "#ffd84a" },
      rows: [
        "....DDDDD....",
        "..DDYYYYYDD..",
        ".DYGGGGGGGYD.",
        "DYGGGDDDGGGYD",
        "DYGGDCCCDGGYD",
        "DYGGDCLCDGGYD",
        "DYGGDCCCDGGYD",
        "DYGGGDDDGGGYD",
        ".DYGGGGGGGYD.",
        "..DDYYYYYDD..",
        "....DDDDD....",
      ],
    },
    // A fighter with its wings swept forward: purple, with gold on it.
    ace: {
      paint: { D: "#1c0f33", R: "#7a4bd6", C: "#ffd84a", W: "#ffd84a" },
      rows: [
        ".....D.....",
        "....DRD....",
        "....DCD....",
        "D..DRRRD..D",
        "DD.DRWRD.DD",
        "DRDDRRRDDRD",
        "DRRRRWRRRRD",
        "DWRRDRDRRWD",
        ".DDD.D.DDD.",
        "...DDWDD...",
        "....DDD....",
      ],
    },
    // A cruiser: broad, dark red, lit windows down its spine and an engine pod on each wing.
    heavy: {
      paint: { D: "#2a0d1c", R: "#a02c5a", K: "#5a1c3a", C: "#9ff0ff", Y: "#ffd84a" },
      rows: [
        ".........D.........",
        "........DRD........",
        ".......DRCRD.......",
        ".......DRRRD.......",
        "..D...DRRCRRD...D..",
        ".DYD..DRRRRRD..DYD.",
        ".DRDDDDRRCRRDDDDRD.",
        "DRRRRRRRRRRRRRRRRRD",
        "DRKKRRRRRRRRRRRKKRD",
        "DRKKRRRKKKKKRRRKKRD",
        ".DDRRRRKYKYKRRRRDD.",
        "...DDDRRRRRRRDDD...",
        "......DRRDRRD......",
        "......DYD.DYD......",
        ".......D...D.......",
      ],
    },
    // A yellow supply shuttle, with its hold in the middle.
    ferry: {
      paint: { D: "#5a3d08", Y: "#f0c040", C: "#fff3c4", W: "#fff3c4", K: "#a87a14" },
      rows: [
        ".......D.......",
        "......DYD......",
        ".....DYCYD.....",
        ".....DYYYD.....",
        ".DDDDDYYYDDDDD.",
        "DYYKYYYYYYYKYYD",
        "DYYKYYWWWYYKYYD",
        ".DDDDYYWYYDDDD.",
        "....DYYYYYD....",
        ".....DKDKD.....",
        "......D.D......",
      ],
    },
    // A seeker: small, pink and all point.
    dart: {
      paint: { D: "#4a0a2c", P: "#ff4fa0", C: "#ffe2f0" },
      rows: ["...D...", "..DPD..", "..DCD..", "..DPD..", ".DPPPD.", "DPPPPPD", "DPDPDPD", "DD.D.DD", "...D..."],
    },
    // A hunter, orange and swept back: it comes from behind you.
    chaser: {
      paint: { D: "#3e1604", O: "#ff7a1a", C: "#ffe9c8", W: "#ffd84a" },
      rows: ["....D....", "...DOD...", "..DOCOD..", "..DOOOD..", ".DOOOOOD.", "DOOWOWOOD", "DOD.O.DOD", "DD.DWD.DD", "....D...."],
    },
    // A rock, with something red and hot in the middle of it.
    mine: {
      paint: { D: "#231c16", M: "#7a6a5a", L: "#a89684", K: "#4a3f35", R: "#ff5a3c" },
      rows: ["..DDDD...", ".DMMLMDD.", "DMLMMMMMD", "DMMKMMLMD", "DMMMRMMMD", ".DMMMMKMD", "DMKMMMMMD", ".DMMLMMD.", "..DDDDD.."],
    },
    // A freighter: a container either side, and a hatch for what it's carrying.
    hauler: {
      paint: { D: "#2a1608", R: "#c8641e", C: "#9ff0ff", Y: "#ffd84a", H: "#3a1c08", K: "#8a93a3" },
      rows: [
        "........D........",
        ".......DRD.......",
        "......DRCRD......",
        ".DDDDDDRRRDDDDDD.",
        "DKKKKDRRRRRDKKKKD",
        "DKYKKDRRHRRDKKYKD",
        "DKKKKDRHHHRDKKKKD",
        "DKKKKDRRRRRDKKKKD",
        ".DDDDDDRRRDDDDDD.",
        "......DYDYD......",
        ".......D.D.......",
      ],
    },
    // A warship behind a shield of light ("S": bright while it's covered).
    gunship: {
      bare: "#3d4a66",
      paint: { D: "#14101f", R: "#8c2a5a", K: "#4d4650", C: "#eafaff", S: "#7df0ff", Y: "#ffd84a" },
      rows: [
        ".....DDDDDDD.....",
        "....DSSSSSSSD....",
        "...DSSSSCSSSSD...",
        "...DDDDRRRDDDD...",
        ".....DRRCRRD.....",
        "..D..DRRRRRD..D..",
        ".DYD.DRKKKRD.DYD.",
        "DDKDDDRKYKRDDDKDD",
        "DKKKKKRRRRRKKKKKD",
        "DRRRRRRRRRRRRRRRD",
        "DKKKKKKRRRKKKKKKD",
        ".DDDDDDRRRDDDDDD.",
        "......DRRRD......",
        ".....DDYDYDD.....",
        "......D...D......",
      ],
    },
    // A satellite on a tether: a blue panel out to either side.
    balloon: {
      paint: { D: "#1e232c", S: "#c3cad4", L: "#eef2f6", R: "#e2463c", B: "#2f7fd0", Y: "#ffd84a" },
      rows: [
        ".......D.......",
        ".......D.......",
        "......DSD......",
        "DDDDD.DSD.DDDDD",
        "DBBBDDDSDDDBBBD",
        "DBLBDSSLSSDBLBD",
        "DBBBDSRRRSDBBBD",
        "DBLBDSSSSSDBLBD",
        "DBBBDDDSDDDBBBD",
        "DDDDD.DSD.DDDDD",
        ".....DDSDD.....",
        ".....DYSYD.....",
        "......DDD......",
        ".......D.......",
      ],
    },
    // The mothership: a great saucer, all dome, with lights round its rim.
    flagship: {
      paint: { D: "#1a0b2e", R: "#a02c5a", C: "#7de0d0", L: "#eafff8", Y: "#ffd84a" },
      rows: [
        ".........DDDDDDD.........",
        ".......DDRRRRRRRDD.......",
        ".....DDRRRRRRRRRRRDD.....",
        "...DDRRRRRDDDDDRRRRRDD...",
        "..DRRRRRDDCCCCCDDRRRRRD..",
        ".DRRYRRDCCCLLCCCCDRRYRRD.",
        ".DRRRRDCCCLLCCCCCCDRRRRD.",
        "DRRRRRDCCCCCCCCCCCDRRRRRD",
        "DRYRRRDCCCCCCCCCCCDRRRYRD",
        "DRRRRRDCCCCCCCCCCCDRRRRRD",
        ".DRRRRDCCCCCCCCCCCDRRRRD.",
        ".DRRYRRDCCCCCCCCCDRRYRRD.",
        "..DRRRRRDDCCCCCDDRRRRRD..",
        "...DDRRRRRDDDDDRRRRRDD...",
        ".....DDRRRYRRRYRRRDD.....",
        ".......DDRRRRRRRDD.......",
        ".........DDDDDDD.........",
      ],
    },
    // The ships: a star cruiser and a frigate, dark violet with lit decks.
    carrier: { paint: { D: "#0d1020", H: "#8a7fd0", K: "#4a4480", W: "#7df0ff", I: "#1b1838", Y: "#ffd84a", T: "#e2463c" } },
    boat: { paint: { D: "#0d1020", H: "#8a7fd0", K: "#4a4480", I: "#1b1838", Y: "#ffd84a", T: "#e2463c" } },
  },
  // Crew in suits: a silver helmet over a green face, and teal overalls.
  builder: { H: "#c9d3e0", D: "#7a8494", S: "#8fd16a", K: "#14181f", N: "#5ea832", B: "#2fb4d0", T: "#16566b", F: "#1b1b1f" },
};
