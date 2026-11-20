// Newsroom: you're a kid on a bike (side on: a red cap, a green jacket, a bag of papers behind
// the saddle) throwing rolled newspapers; what comes at you is the rest of the trade: paper
// planes, a typewriter, a sharp pencil, a dog that's after your back wheel, a photographer
// behind a flash, and the news helicopter at the end.

import type { Skin } from "../skins.ts";
import { TRUCK } from "./shapes.ts";

const PAPER_PLANE = [
  ".....D.....",
  "....DWD....",
  "....DWD....",
  "...DWGWD...",
  "...DWGWD...",
  "..DWKGKWD..",
  "..DWWGWWD..",
  ".DWKWGWKWD.",
  ".DWWRGRWWD.",
  "DWWDDGDDWWD",
  "DDD..D..DDD",
];

export const newsroom: Skin = {
  craft: "BIKE",
  boss: "NEWS CHOPPER",
  player: {
    upright: true,
    paint: { D: "#16233f", W: "#b9c0cc", H: "#8a93a3", S: "#f0b98a", K: "#14181f", R: "#d8402f", G: "#3fa860", B: "#3b6ea8", A: "#c49556", P: "#f3f0e6" },
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
    // A paper plane, folded from yesterday's front page.
    scout: { paint: { D: "#2a2a30", W: "#f3f0e6", G: "#bdb6a2", K: "#8a8474", R: "#c8402f" }, rows: PAPER_PLANE },
    // A bigger one, with a gold band across it.
    leader: {
      paint: { D: "#2a2a30", W: "#f3f0e6", G: "#bdb6a2", K: "#8a8474", Y: "#e0a820" },
      rows: [
        "......D......",
        ".....DWD.....",
        ".....DWD.....",
        "....DWGWD....",
        "....DYGYD....",
        "...DWWGWWD...",
        "...DWKGKWD...",
        "..DYYYGYYYD..",
        "..DWWWGWWWD..",
        ".DWKKWGWKKWD.",
        "DWWWDDGDDWWWD",
        "DDDD..D..DDDD",
      ],
    },
    // The rival paper's: purple, with gold print.
    ace: { paint: { D: "#1c0f33", W: "#7a4bd6", G: "#5a34a8", K: "#ffd84a", R: "#ffd84a" }, rows: PAPER_PLANE },
    // A typewriter: a sheet in its roller, a red body and rows of black keys.
    heavy: {
      upright: true,
      paint: { D: "#2a0d0d", R: "#b8322c", K: "#1b1b1f", W: "#f3f0e6", T: "#8a8474", S: "#b9c0cc" },
      rows: [
        "...DDDDDDDDDDDDD...",
        "...DWWWWWWWWWWWD...",
        "...DWTTTWTTTTTWD...",
        "...DWTTTTTWTTTWD...",
        ".DDDDDDDDDDDDDDDDD.",
        "DSSDRRRRRRRRRRRDSSD",
        ".DDDRRRRRRRRRRRDDD.",
        "..DRRRRRRRRRRRRRD..",
        "..DRKRKRKRKRKRKRD..",
        ".DRRRRRRRRRRRRRRRD.",
        ".DRKRKRKRKRKRKRKRD.",
        "DRRRRRRRRRRRRRRRRRD",
        "DRRKKKKKKKKKKKKKRRD",
        "DRRRRRRRRRRRRRRRRRD",
        ".DDDDDDDDDDDDDDDDD.",
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
    // The editor's pencil: pink, and sharpened.
    dart: {
      paint: { D: "#4a0a2c", K: "#1b1b1f", W: "#f0d9a8", P: "#ff4fa0", S: "#c3cad4" },
      rows: ["...D...", "..DKD..", "..DWD..", ".DWWWD.", ".DPPPD.", ".DPPPD.", ".DPPPD.", ".DSSSD.", ".DDDDD."],
    },
    // A dog, after your back wheel.
    chaser: {
      upright: true,
      paint: { D: "#3e1604", O: "#ff7a1a", E: "#b8500e", K: "#1b1b1f", W: "#ffe9c8", R: "#e2463c" },
      rows: [".DD...DD.", "DEEDDDEED", "DEOOOOOED", "DOOKOKOOD", ".DOOOOOD.", ".DOWKWOD.", ".DWWRWWD.", "..DWRWD..", "...DDD..."],
    },
    // A blot of ink, still spreading.
    mine: { paint: { D: "#0e0e10", M: "#2a2f45", R: "#c8402f", S: "#1b1b1f" } },
    // The delivery lorry, with the day's bundles in the back.
    hauler: { paint: { D: "#3a1c08", R: "#c8641e", C: "#bfe6ff", W: "#f3f0e6", K: "#8a8474", H: "#3a1c08" }, rows: TRUCK },
    // A press photographer, behind a flash ("S": bright while it's pointed at you).
    gunship: {
      upright: true,
      bare: "#6b6f7a",
      paint: { D: "#1b1013", S: "#fff3a0", C: "#ffffff", K: "#2a2a30", H: "#5b3a1e", L: "#8fd0f0", R: "#a0522d" },
      rows: [
        ".....DDDDDDD.....",
        "....DSSSSSSSD....",
        "....DSSSCSSSD....",
        ".....DSSSSSD.....",
        "......DDKDD......",
        "....DDDDKDDDD....",
        "...DHHHHHHHHHD...",
        "....DKKKKKKKD....",
        "..DDDKKLLLKKDDD..",
        ".DRRDKKLCLKKDRRD.",
        ".DRRDDKLLLKDDRRD.",
        ".DRRRDDDDDDDRRRD.",
        "..DRRRRRRRRRRRD..",
        "..DRRRRDDDRRRRD..",
        "..DDDDD...DDDDD..",
      ],
    },
    // A balloon on a line, in the paper's colours.
    balloon: { paint: { D: "#1b1b1f", S: "#f3f0e6", L: "#ffffff", R: "#c8402f" } },
    // The news helicopter, from above: its rotor an X across it.
    flagship: {
      paint: { D: "#2a070b", R: "#c8402f", C: "#bfe6ff", K: "#1b1b1f", W: "#f3f0e6", Y: "#ffd84a" },
      rows: [
        "KK.....................KK",
        ".KKK......DDDDD......KKK.",
        "...KKK...DRRRRRD...KKK...",
        ".....KKKDRCCCCCRDKKK.....",
        ".......DKKCCCCCKKD.......",
        ".......DRRKKCKKRRD.......",
        "......DRRRRRKRRRRRD......",
        ".......DRRKKYKKRRD.......",
        ".......DKKRRWRRKKD.......",
        ".....KKKDRRWWWRRDKKK.....",
        "...KKK...DRRWRRD...KKK...",
        ".KKK......DRRRD......KKK.",
        "KK........DRRRD........KK",
        "...........DRD...........",
        ".........DDDRDDD.........",
        ".........DRRRRRD.........",
        ".........DDDDDDD.........",
      ],
    },
    // The ships: newsprint grey, with a red masthead.
    carrier: { paint: { D: "#1b1b1f", H: "#d8d2c4", K: "#a8a294", W: "#f3f0e6", I: "#3a3f4b", Y: "#ffd84a", T: "#c8402f" } },
    boat: { paint: { D: "#1b1b1f", H: "#d8d2c4", K: "#a8a294", I: "#3a3f4b", Y: "#ffd84a", T: "#c8402f" } },
  },
  // Subs on the night desk: a green eyeshade, a grey moustache and beard, shirtsleeves.
  builder: { H: "#5b3a1e", D: "#2f9c5a", S: "#f0b98a", K: "#14181f", N: "#d9866a", B: "#b9b4aa", T: "#f3f0e6", F: "#1b1b1f" },
};
