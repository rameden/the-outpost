// Starship: you fly a white fighter with four wings, a long nose and a cannon out at each
// wingtip, firing red bolts; what comes at you is an empire's fleet, all of it grey: fighters
// that are a round pod slung between two flat panels, a bomber with two pods, a rock with
// something glowing in it, and a great wedge of a dreadnought at the end.

import type { Skin } from "../skins.ts";

const STEEL = { D: "#10141c", G: "#8a93a3", K: "#4a5262", R: "#ff3b30", E: "#7dffb0" };

export const starship: Skin = {
  craft: "FIGHTER",
  boss: "DREADNOUGHT",
  player: {
    flicker: "F",
    paint: { D: "#10182c", H: "#eef2f8", G: "#9aa7ba", C: "#4fd8f0", R: "#e2463c", B: "#2f7fd0", F: "#ffb020" },
    rows: [
      "........D........",
      ".......DHD.......",
      ".......DHD.......",
      ".......DHD.......",
      "R......DHD......R",
      "G.....DHCHD.....G",
      "G.....DHCHD.....G",
      "G.....DHBHD.....G",
      "DD...DDHHHDD...DD",
      "DHDDDGGHHHGGDDDHD",
      "DHRRHGGHHHGGHRRHD",
      "DHHHHGGHHHGGHHHHD",
      "DDDDDDGHHHGDDDDDD",
      ".....DFDDDFD.....",
      "......F...F......",
    ],
  },
  // A bolt of red light.
  shot: { paint: { D: "#3a0a0a", G: "#ff4a3c", W: "#ffe0d8" }, rows: [".D.", "DWD", "DGD", "DGD", "DGD", "DGD", "DGD", ".D."] },
  enemies: {
    // A fighter: a round pod with one red eye, slung between two flat panels.
    scout: {
      paint: STEEL,
      rows: [
        "GK.......KG",
        "GK.......KG",
        "GK..DDD..KG",
        "GK.DGGGD.KG",
        "GKDDGRGDDKG",
        "GKGGRRRGGKG",
        "GKDDGRGDDKG",
        "GK.DGGGD.KG",
        "GK..DDD..KG",
        "GK.......KG",
        "GK.......KG",
      ],
    },
    // The squadron leader's: a size up, with gold on its panels.
    leader: {
      paint: { ...STEEL, Y: "#ffd84a" },
      rows: [
        "G...........G",
        "GK.........KG",
        "GK.........KG",
        "YK...DDD...KY",
        "GK..DGGGD..KG",
        "GKDDDGRGDDDKG",
        "GKGGGRRRGGGKG",
        "GKDDDGRGDDDKG",
        "GK..DGGGD..KG",
        "YK...DDD...KY",
        "GK.........KG",
        "G...........G",
      ],
    },
    // The ace's: its panels bent in at the tips, purple, with gold on it.
    ace: {
      paint: { D: "#1c0f33", P: "#7a4bd6", W: "#ffd84a", C: "#ffd84a" },
      rows: [
        ".PP.....PP.",
        "PPD.....DPP",
        "PW..DDD..WP",
        "PW.DPPPD.WP",
        "PWDDPCPDDWP",
        "PWPPCCCPPWP",
        "PWDDPCPDDWP",
        "PW.DPPPD.WP",
        "PW..DDD..WP",
        "PPD.....DPP",
        ".PP.....PP.",
      ],
    },
    // A bomber: two pods side by side between its panels, and an engine under each.
    heavy: {
      paint: STEEL,
      rows: [
        "GK...............KG",
        "GK...............KG",
        "GK...DDD...DDD...KG",
        "GK..DGGGD.DGGGD..KG",
        "GK.DGGGGGDGGGGGD.KG",
        "GKDDGGRGGDGGRGGDDKG",
        "GKGGGRRRGGGRRRGGGKG",
        "GKGGGRRRGGGRRRGGGKG",
        "GKDDGGRGGDGGRGGDDKG",
        "GK.DGGGGGDGGGGGD.KG",
        "GK..DGGGD.DGGGD..KG",
        "GK...DED...DED...KG",
        "GK....E.....E....KG",
        "GK...............KG",
        "GK...............KG",
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
    // A grey warship behind a shield of light ("S": bright while it's covered).
    gunship: {
      bare: "#3d4a66",
      paint: { D: "#10141c", R: "#8a93a3", K: "#4a5262", C: "#eafaff", S: "#7df0ff", Y: "#ff3b30" },
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
    // The dreadnought: a great grey wedge, a lit spine down it, the bridge astern and three engines.
    flagship: {
      paint: { ...STEEL, L: "#9ff0ff", C: "#ffdf5a" },
      rows: [
        "............D............",
        "...........DGD...........",
        "...........DGD...........",
        "..........DGGGD..........",
        "..........DGLGD..........",
        ".........DGGLGGD.........",
        "........DGGGLGGGD........",
        "........DGKGLGKGD........",
        ".......DGGKGLGKGGD.......",
        "......DGGGKGLGKGGGD......",
        ".....DGGGGGDDDGGGGGD.....",
        "....DGGKGGDCCCDGGKGGD....",
        "...DGGGKGGGDDDGGGKGGGD...",
        "..DGGRGGGGGGGGGGGGGRGGD..",
        ".DGGGGGGGGGGGGGGGGGGGGGD.",
        ".DDDDDDEDDDDEDDDDEDDDDDD.",
        ".......E....E....E.......",
      ],
    },
    // The ships: the fleet's own, the same grey, with lit decks.
    carrier: { paint: { D: "#10141c", H: "#8a93a3", K: "#4a5262", W: "#9ff0ff", I: "#1b2030", Y: "#ffd84a", T: "#ff3b30" } },
    boat: { paint: { D: "#10141c", H: "#8a93a3", K: "#4a5262", I: "#1b2030", Y: "#ffd84a", T: "#ff3b30" } },
  },
  // Crew in suits: a silver helmet over a green face, and teal overalls.
  builder: { H: "#c9d3e0", D: "#7a8494", S: "#8fd16a", K: "#14181f", N: "#5ea832", B: "#2fb4d0", T: "#16566b", F: "#1b1b1f" },
};
