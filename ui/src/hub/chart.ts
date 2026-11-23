// Where the star chart puts each outpost. It is drawn as Orbit draws a camp: a sun at the middle
// (just the sun: it is nobody's), and every outpost a planet on a contour line of its own, in the
// order they come, so one more outpost takes the next line out and nothing else moves.

import { startOf } from "../components/MaeSystem.tsx";

const FIRST = 66, APART = 40; // the first line's distance from the sun, and the gap between lines
const FEWEST = 3;             // lines drawn at least, so a chart with one outpost still has its map
export const lineAt = (i: number) => FIRST + APART * i;
// How long a line takes to go round the sun once, in seconds: slowly, and more slowly further out
// (as planets do: the lap grows as the distance to the power of one and a half).
export const lapOf = (i: number) => Math.round(200 * (lineAt(i) / FIRST) ** 1.5);

export type Body = { id: string; x: number; y: number; r: number; deg: number; line: number };
export type Chart = { bodies: Body[]; lines: number; half: number };

// ids in the order they come: the first is on the line nearest the sun.
export function chart(ids: string[]): Chart {
  const bodies = ids.map((id, i): Body => {
    const r = lineAt(i), deg = startOf(i), a = (deg * Math.PI) / 180;
    return { id, x: r * Math.cos(a), y: r * Math.sin(a), r, deg, line: i };
  });
  const lines = Math.max(ids.length, FEWEST);
  return { bodies, lines, half: lineAt(lines - 1) + 62 };
}

// Which of the crew's colours an outpost wears: they go round in turn, line by line outwards, so
// neighbours differ and an outpost keeps its colour (it keeps its line).
const TONES = ["scout", "scribe", "artificer", "warden", "other"];
export const toneOf = (line: number) => TONES[line % TONES.length];
