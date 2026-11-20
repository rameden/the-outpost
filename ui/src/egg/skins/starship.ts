// Starship: you fly a white fighter with four wings, a long nose and a cannon out at each
// wingtip, firing red bolts; what comes at you is an empire's fleet, all of it grey: fighters
// that are a round pod slung between two flat panels, a bomber with two pods, a rock with
// something glowing in it, a star destroyer for the carrier and a corvette for the missile
// boat, and a great wedge of a dreadnought at the end. Its troopers mend the page in the Wreck.

import type { Skin } from "../skins.ts";

// A trooper, from the helmet to the hips (its legs are the frames' last two rows).
const TROOPER = [
  "..HHHHH..",
  ".HHHHHHH.",
  ".HKKHKKH.", // the lenses
  ".DHHKHHD.",
  "..DNDND..", // the grille
  "TTBBBBBTT", // shoulders and chest plate
  "STBKKKBTS", // gloves, and the belt
  "..BBBBB..",
];

// The carrier, as a star destroyer (bow up, like the game's carrier, and the same 17 by 41 so its
// hull is hit where it's drawn): a long grey wedge lit down its left and shadowed down its right,
// a pale ridge along its spine, a stepped superstructure astern with the bridge across the top of
// it, and the glow of its engines on the stern.
function destroyerRows(): string[] {
  const WIDE = 17, LONG = 41, mid = 8;
  return Array.from({ length: LONG }, (_, r) => {
    const half = Math.min(8, Math.ceil(r / 4)); // the wedge, widening to the stern
    return Array.from({ length: WIDE }, (_, c) => {
      const d = Math.abs(c - mid);
      if (d > half) return ".";
      if (r >= LONG - 3 && r < LONG - 1 && (d === 2 || d === 5)) return "E"; // its engines
      if (d === half || r === 0 || r === LONG - 1) return "D";
      if (r >= 33 && r <= 35 && d <= 6) return d === 6 || r === 33 ? "D" : d === 5 ? "W" : "H"; // the bridge, its domes at the ends
      if (r >= 27 && r <= 32 && d <= 3) return d === 3 || r === 27 ? "D" : r === 29 && d <= 1 ? "Y" : "I"; // the tower, with lights
      if (r >= 22 && r <= 26 && d <= 4) return d === 4 || r === 22 ? "D" : "K"; // the deck it stands on
      if (c === mid) return "W"; // the ridge
      return c < mid ? "H" : "K";
    }).join("");
  });
}

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
    // The carrier: a star destroyer (destroyerRows, above).
    carrier: { paint: { D: "#10141c", H: "#b4bcc8", K: "#6a7384", W: "#e8edf2", I: "#2a323e", Y: "#9ff0ff", E: "#5fd0ff" }, rows: destroyerRows() },
    // The missile boat: a corvette, a little wedge of the same grey (bow up, and the boat's 9 by
    // 21): a ridge down it, a dark bridge with a light, red launch tubes either side of the spine
    // where the missiles come from, and two engines astern.
    boat: {
      paint: { D: "#10141c", H: "#b4bcc8", K: "#6a7384", W: "#e8edf2", I: "#2a323e", Y: "#9ff0ff", T: "#ff3b30", E: "#5fd0ff" },
      rows: [
        "....D....",
        "...DWD...",
        "...DWD...",
        "..DHWKD..",
        "..DHWKD..",
        "..DHWKD..",
        ".DHHWKKD.",
        ".DHHWKKD.",
        ".DDDDDDD.",
        ".DHIYIKD.",
        ".DHIIIKD.",
        ".DDDDDDD.",
        "DHHTWTKKD",
        "DHHTWTKKD",
        "DHHTWTKKD",
        "DHHHWKKKD",
        "DHHHWKKKD",
        "DDDDDDDDD",
        "DHEHDKEKD",
        ".DEDDDED.",
        "..E...E..",
      ],
    },
  },
  // Troopers in white armour: a helmet with two black lenses and a grille, a black belt and
  // gloves, and white boots. (The helmet's what flies off when one's shot.)
  builder: { H: "#f4f6f9", D: "#9aa3b2", K: "#14181f", N: "#5d6675", B: "#e6eaf0", T: "#cfd6df", S: "#1b1e24", F: "#b4bcc8" },
  crew: {
    frames: [
      [...TROOPER, ".TT...TT.", ".FF...FF."],
      [...TROOPER, "..TT.TT..", "..FF.FF.."],
    ],
    // Ducking: down on its heels, helmet tucked into its shoulders.
    duck: ["..HHHHH..", ".HHHHHHH.", ".HKKHKKH.", "TDNDNDNDT", "TTBBBBBTT", "STBKKKBTS", ".FF...FF."],
  },
  // What they shout: by the book, and not very good shots either.
  quotes: {
    wrecked: ["Halt! Rebel scum!", "That was Imperial property!", "Sound the alarm!", "I just requisitioned that!", "Report this to the commander!",
      "We'll be on cleanup duty for a week!", "That's coming out of my pay!", "Stop that ship!", "Who authorised this?", "Not the reactor!"],
    miss: ["Missed! ...Wait, so did I.", "Can't see a thing in this helmet!", "Hey! Watch the armour!", "Blast! Close one!", "Was that a warning shot?", "Take cover!"],
    mate: ["TK-421's down!", "Man down!", "He had two days till retirement!", "Somebody call a medic droid!", "Who's taking his shift?", "That was my bunkmate!"],
    arrive: ["Move along. Move along.", "Repair detail, reporting.", "Fan out!", "This isn't the page we're looking for.", "Lord Vader won't like this."],
    done: ["Fully operational!", "Good as new, sir.", "Repairs complete.", "Back on schedule.", "Report: all clear."],
    leave: ["Back to the barracks.", "Shift's over.", "Mess hall, double time!", "Tell the commander we're done.", "Fall in!"],
    tea: ["Helmet off. Finally.", "Ration bar?", "Regulation break.", "Blue milk, anyone?", "Don't tell the commander."],
  },

};
