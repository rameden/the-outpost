// Decorations: holiday dressing for the page, and nothing more. Snow, bats or confetti, a string
// of lights under the top bar, and a tint on the orb. They sit on top of whichever theme pack,
// colours and light or dark you have, and change no words, no names and nothing the crew reads.
//
// This file is the list and the calendar. Which one is on is kept by themes.ts ("camp-season", in
// this browser); what it draws is components/Decor.tsx; how it's coloured is "Decorations" in
// styles.css.

export type Effect = "snow" | "bats" | "confetti";
export interface Season {
  id: string;
  name: string;
  about: string;
  from: string; // "MM-DD", the first day it's in season
  to: string;   // "MM-DD", the last day (it may be in the next year)
  effect: Effect | null;
  lights: boolean;
}

export const SEASONS = [
  { id: "winter", name: "Winter", about: "Snow, a string of lights and a frosty orb.", from: "12-01", to: "01-06", effect: "snow", lights: true },
  { id: "halloween", name: "Halloween", about: "A few bats, lights and a pumpkin-and-plum orb.", from: "10-24", to: "10-31", effect: "bats", lights: true },
  { id: "newyear", name: "New Year", about: "Lights and a gold orb, and confetti each time an expedition finishes.", from: "12-31", to: "01-01", effect: "confetti", lights: true },
] as const satisfies readonly Season[];
export type SeasonId = (typeof SEASONS)[number]["id"];

export const isSeason = (v: unknown): v is SeasonId => SEASONS.some((s) => s.id === v);
export const seasonById = (id: unknown): Season | null => SEASONS.find((s) => s.id === id) ?? null;

// A day of the year, counted in a leap year so February 29th has a place of its own.
const BEFORE = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const YEAR = 366;
const dayOf = (month: number, day: number) => BEFORE[month - 1] + day;
const dayOfText = (mmdd: string) => { const [m, d] = mmdd.split("-").map(Number); return dayOf(m, d); };
// How many days a window covers, both ends counted, round the year end if it crosses it.
const span = (s: Season) => ((dayOfText(s.to) - dayOfText(s.from) + YEAR) % YEAR) + 1;

// The decoration in season on a date (the date as this machine's clock has it), or null. Where
// two windows overlap, the shorter one wins: New Year's two days sit inside Winter's five weeks.
export function seasonFor(date: Date): (typeof SEASONS)[number] | null {
  const day = dayOf(date.getMonth() + 1, date.getDate());
  let best: (typeof SEASONS)[number] | null = null;
  for (const s of SEASONS) {
    const since = (day - dayOfText(s.from) + YEAR) % YEAR; // days since it began, round the year end
    if (since < span(s) && (!best || span(s) < span(best))) best = s;
  }
  return best;
}
