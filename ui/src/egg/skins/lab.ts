// Lab: you're the mech dog (steel, ears up, two red eyes, a light in its chest and a jet
// under it), and the lasers come out of its eyes; what comes at you is the lab that built it:
// techs in white coats, a mad scientist, a robot, a syringe, and the Big Brain in its jar at
// the end. People stand the right way up whichever way they go.

import type { Skin } from "../skins.ts";
import { DRONE, TRUCK } from "./shapes.ts";

export const lab: Skin = {
  craft: "DOG",
  boss: "THE BIG BRAIN",
  player: {
    upright: true,
    flicker: "f",
    paint: { D: "#14202a", G: "#aab6c4", L: "#e6edf4", K: "#14181f", E: "#6f7c8c", R: "#ff3b30", C: "#7dffb0", f: "#4fd8f0" },
    rows: [
      "..DD.........DD..",
      ".DEED.......DEED.",
      ".DEEEDDDDDDDEEED.",
      ".DEGGGGGGGGGGGED.",
      "..DGGGGGGGGGGGD..",
      "..DGRRGGGGGRRGD..",
      "..DGRRGGGGGRRGD..",
      "..DGGGLLLLLGGGD..",
      "...DGGLLKLLGGD...",
      "....DDLLLLLDD....",
      "...DGGDDDDDGGD...",
      "..DGGGGGCGGGGGD..",
      "..DGDGGGGGGGDGD..",
      "..DGD.DfDfD.DGD..",
      "..DDD.......DDD..",
    ],
  },
  // A red laser.
  shot: { paint: { D: "#3a0a0a", G: "#ff4a3c", W: "#ffe0d8" }, rows: [".D.", "DWD", "DGD", "DGD", "DGD", "DGD", "DGD", ".D."] },
  enemies: {
    // A lab tech: white coat, goggles.
    scout: {
      upright: true,
      paint: { D: "#14202a", H: "#5b3a1e", S: "#f0b98a", C: "#4fd8f0", W: "#f3f5f8", K: "#3b6ea8", B: "#3a3f4b" },
      rows: [
        "...DDDDD...",
        "..DHHHHHD..",
        "..DSSSSSD..",
        "..DCCSCCD..",
        "..DSSSSSD..",
        "...DDDDD...",
        ".DWWWKWWWD.",
        "DSDWWKWWDSD",
        ".DDWWWWWDD.",
        "..DBBDBBD..",
        "..DDD.DDD..",
      ],
    },
    // The senior tech, with the gold clipboard.
    leader: {
      upright: true,
      paint: { D: "#14202a", H: "#8a8f98", S: "#f0b98a", C: "#4fd8f0", W: "#f3f5f8", K: "#3b6ea8", B: "#3a3f4b", Y: "#ffd84a" },
      rows: [
        "....DDDDD....",
        "...DHHHHHD...",
        "...DSSSSSD...",
        "...DCCSCCD...",
        "...DSSSSSD...",
        "....DDDDD....",
        "..DWWWKWWWD..",
        ".DSDWWKWDYYYD",
        ".DDDWWWWDYKYD",
        "...DWWWWDYYYD",
        "...DBBDBBDDD.",
        "...DDD.DDD...",
      ],
    },
    // The mad scientist: hair on end, a purple coat, gold gloves.
    ace: {
      upright: true,
      paint: { D: "#1c0f33", W: "#f3f5f8", S: "#f0b98a", C: "#bff5e0", K: "#14181f", R: "#d8402f", P: "#7a4bd6", Y: "#ffd84a" },
      rows: [
        "D.DD.D.DD.D",
        "DWDWWDWWDWD",
        ".DWWWWWWWD.",
        "..DSSSSSD..",
        "..DCKSCKD..",
        "..DSSRSSD..",
        "...DDDDD...",
        ".DPPPPPPPD.",
        "DYDPPPPPDYD",
        ".DDPPDPPDD.",
        "...DD.DD...",
      ],
    },
    // The lab's robot: square, steel, with a row of lights on its chest.
    heavy: {
      upright: true,
      paint: { D: "#14202a", G: "#8a96a6", K: "#3a4450", C: "#ffdf5a", R: "#e2463c", Y: "#ffd84a", L: "#7dffb0" },
      rows: [
        "........DDD........",
        ".........K.........",
        ".....DDDDDDDDD.....",
        ".....DGGGGGGGD.....",
        ".....DGCCGCCGD.....",
        ".....DGGGGGGGD.....",
        "..DDDDDDDDDDDDDDD..",
        ".DGGDGGGGGGGGGDGGD.",
        ".DGGDGRGYGLGGGDGGD.",
        ".DGGDGGGGGGGGGDGGD.",
        ".DGGDGKKKKKKKGDGGD.",
        ".DKKDGGGGGGGGGDKKD.",
        ".DD.DDDDDDDDDDD.DD.",
        ".....DKKD.DKKD.....",
        ".....DDDD.DDDD.....",
      ],
    },
    // A courier in a yellow hazmat suit, with something for you.
    ferry: {
      upright: true,
      paint: { D: "#5a3d08", Y: "#f0c040", C: "#bfe6ff", K: "#3a2a08" },
      rows: [
        ".....DDDDD.....",
        "....DYYYYYD....",
        "....DYCCCYD....",
        "....DYYYYYD....",
        "..DDDDDDDDDDD..",
        ".DYDYYYKYYYDYD.",
        ".DYDYYKYKYYDYD.",
        ".DDDYYYYYYYDDD.",
        "...DYYYDYYYD...",
        "...DKKKDKKKD...",
        "...DDDD.DDDD...",
      ],
    },
    // A syringe, needle first.
    dart: {
      paint: { D: "#4a0a2c", S: "#c3cad4", P: "#ff4fa0", W: "#ffe2f0" },
      rows: ["...D...", "...S...", "...S...", "..DDD..", "..DPD..", "..DPD..", "..DWD..", ".DDDDD.", "...D..."],
    },
    // A lab drone, orange, that follows you about.
    chaser: { paint: { D: "#3e1604", O: "#ff7a1a", C: "#7dffb0" }, rows: DRONE },
    // Something that got out of a dish: green, and spiky.
    mine: { paint: { D: "#12301f", M: "#5ea832", R: "#d8ff7a", S: "#2f6f2a" } },
    // The sample trolley.
    hauler: { paint: { D: "#14202a", R: "#d8dee6", C: "#bfe6ff", W: "#5ea832", K: "#d8ff7a", H: "#14202a" }, rows: TRUCK },
    // A tech behind a blast shield ("S": it only covers them from the front).
    gunship: {
      upright: true,
      bare: "#55606a",
      paint: { D: "#14202a", H: "#5b3a1e", F: "#f0b98a", C: "#4fd8f0", S: "#9fe8c8", L: "#eafff5", Y: "#ffd84a", K: "#3a3f4b" },
      rows: [
        ".....DDDDDDD.....",
        "....DHHHHHHHD....",
        "....DFFFFFFFD....",
        "....DFCCFCCFD....",
        "....DFFFFFFFD....",
        "..DDDDDDDDDDDDD..",
        ".DSSSSSSSSSSSSSD.",
        ".DSSLSSSSSSSSSSD.",
        ".DSLSSSSYSSSSSSD.",
        ".DSSSSSYKYSSSSSD.",
        ".DSSSSSSYSSSSSSD.",
        ".DSSSSSSSSSSSSSD.",
        "..DDSSSSSSSSSDD..",
        "....DDDDDDDDD....",
        "....DKKD.DKKD....",
      ],
    },
    // A weather balloon, with the lab's stripe round it.
    balloon: { paint: { D: "#14202a", S: "#eef2f6", L: "#ffffff", R: "#5ea832" } },
    // The Big Brain: in its jar, on legs.
    flagship: {
      upright: true,
      paint: { D: "#14202a", C: "#bfeee0", P: "#f08aa8", K: "#b8506e", G: "#8a96a6", R: "#e2463c", Y: "#ffd84a", L: "#7dffb0" },
      rows: [
        ".......DDDDDDDDDDD.......",
        ".....DDCCCCCCCCCCCDD.....",
        "....DCCCPPPPPPPPPCCCD....",
        "...DCCPPPPKPPPKPPPPCCD...",
        "...DCPPKPPPPKPPPPKPPCD...",
        "...DCPPPPKPPKPPKPPPPCD...",
        "...DCPPKPPPPKPPPPKPPCD...",
        "...DCCPPPPKPPPKPPPPCCD...",
        "....DCCCPPPPPPPPPCCCD....",
        "..DDDDDDDDDDDDDDDDDDDDD..",
        ".DGGGGGGGGGGGGGGGGGGGGGD.",
        ".DGRGGYGGGLLLLLGGGYGGRGD.",
        ".DGGGGGGGGLDLDLGGGGGGGGD.",
        "..DDDDDDDDDDDDDDDDDDDDD..",
        "...DGGD....DGD....DGGD...",
        "..DGGD.....DGD.....DGGD..",
        ".DDDD.....DDDDD.....DDDD.",
      ],
    },
    // The ships: research vessels, white with a green stripe.
    carrier: { paint: { D: "#14202a", H: "#e6edf4", K: "#aab6c4", W: "#5ea832", I: "#3a4450", Y: "#ffd84a", T: "#5ea832" } },
    boat: { paint: { D: "#14202a", H: "#e6edf4", K: "#aab6c4", I: "#3a4450", Y: "#ffd84a", T: "#5ea832" } },
  },
  // Techs: brown hair under a blue goggle band, a white coat.
  builders: "lab techs",
  builder: { H: "#5b3a1e", D: "#4fb3e8", S: "#f0b98a", K: "#14181f", N: "#d9866a", B: "#f3f5f8", T: "#aab6c4", F: "#3a3f4b" },
};
