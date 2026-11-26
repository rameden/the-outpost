// Standard 5-field cron expressions ("minute hour day-of-month month day-of-week"), read in a time
// zone. Pure: nothing here touches the camp's files, so it's all testable with fixed dates.
//
//   */15 9-17 * * 1-5     every 15 minutes, 9am to 5pm, Monday to Friday
//   0 8 1 * *             8:00 on the first of each month
//   30 6 * * mon,thu      6:30 on Mondays and Thursdays
//
// Each field is a list (a,b), a range (a-b), a step (*/n, a-b/n, a/n) or *. Months and weekdays
// take three-letter names; Sunday is 0 or 7. When both day fields are given, a day matching either
// one counts, as cron has always had it. The usual shorthands work too (@hourly, @daily, @weekly,
// @monthly, @yearly).

export type CronSpec = {
  minute: boolean[];  // 0-59
  hour: boolean[];    // 0-23
  dom: boolean[];     // 1-31 (index 0 unused)
  month: boolean[];   // 1-12 (index 0 unused)
  dow: boolean[];     // 0-6, Sunday first
  domAny: boolean;    // the day-of-month field began with *
  dowAny: boolean;    // the day-of-week field began with *
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const SHORTHAND: Record<string, string> = {
  "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *",
};

function field(text: string, min: number, max: number, names?: string[]): boolean[] | null {
  const set = new Array<boolean>(max + 1).fill(false);
  const num = (s: string): number | null => {
    const named = names?.indexOf(s) ?? -1;
    if (named >= 0) return named + (names === MONTHS ? 1 : 0);
    return /^\d{1,2}$/.test(s) ? Number(s) : null;
  };
  for (const part of text.split(",")) {
    const m = part.match(/^([^/]+)(?:\/(\d{1,3}))?$/);
    if (!m) return null;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) return null;
    let from: number | null, to: number | null;
    if (m[1] === "*") { from = min; to = max; }
    else if (m[1].includes("-")) {
      const [a, b, extra] = m[1].split("-");
      if (extra !== undefined) return null;
      from = num(a); to = num(b);
    } else {
      from = num(m[1]);
      to = m[2] === undefined ? from : max; // "5/15": from 5 on, every 15
    }
    if (from === null || to === null || from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) set[v] = true;
  }
  return set;
}

// Is this text meant as a cron expression at all (five fields, or an @shorthand)? Lets a caller
// say "that's not a cron line" apart from "that cron line is wrong".
export const looksLikeCron = (s: string) => { const t = s.trim(); return t.startsWith("@") || t.split(/\s+/).length === 5; };

export function parseCron(expr: string): CronSpec | null {
  const t = expr.trim().toLowerCase();
  const parts = (SHORTHAND[t] ?? t).split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = field(parts[0], 0, 59);
  const hour = field(parts[1], 0, 23);
  const dom = field(parts[2], 1, 31);
  const month = field(parts[3], 1, 12, MONTHS);
  const dow7 = field(parts[4], 0, 7, DAYS);
  if (!minute || !hour || !dom || !month || !dow7) return null;
  const dow = dow7.slice(0, 7);
  if (dow7[7]) dow[0] = true; // 7 is Sunday too
  return { minute, hour, dom, month, dow, domAny: parts[2].startsWith("*"), dowAny: parts[4].startsWith("*") };
}

// ---------- Time zones ----------
// A zone's clock is read through Intl (the only way Node has), one formatter kept per zone.
// zone undefined: the machine's own zone.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone?: string): Intl.DateTimeFormat {
  const key = zone ?? "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(key, f);
  }
  return f;
}

export function validTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

// The zone's clock at an instant, kept as a UTC timestamp of the same digits ("wall time"): the
// wall time of 08:30 in Sydney is Date.UTC(…, 8, 30). Arithmetic on it is plain calendar arithmetic.
function wallOf(at: number, zone?: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// The instants at which the zone's clock reads `wall`, earliest first. Usually one; two in the
// hour a clock is put back; none in the hour it skips when it's put forward, and then the instant
// that many minutes after the jump stands in (02:30 that doesn't exist runs at what the clock
// calls 03:30), so a job set for the missing hour still runs that day.
function instantsOf(wall: number, zone?: string): number[] {
  const DAY = 86_400_000;
  const offsets = [...new Set([wall - DAY, wall + DAY].map((guess) => wallOf(guess, zone) - guess))];
  const exact = offsets.map((off) => wall - off).filter((at) => wallOf(at, zone) === wall).sort((a, b) => a - b);
  if (exact.length) return exact;
  const before = wallOf(wall - DAY, zone) - (wall - DAY);
  return [wall - before];
}

const dayMatches = (spec: CronSpec, wall: Date): boolean => {
  const dom = spec.dom[wall.getUTCDate()];
  const dow = spec.dow[wall.getUTCDay()];
  if (spec.domAny || spec.dowAny) return dom && dow; // a * field is all true, so this is "the other one"
  return dom || dow;
};

// The first time after `after` the expression fires, in `zone`. null when it never does within
// five years (30 February).
export function cronNext(spec: CronSpec, after: Date, zone?: string): Date | null {
  const MINUTE = 60_000;
  const from = after.getTime();
  const offsetAt = (t: number) => wallOf(t, zone) - t;
  // Around a clock change, start a little before `after` on the wall clock: in the hour a clock
  // is put back the same wall minute comes round twice, and the second time may still be ahead
  // (01:30 summer time is followed by 01:00 winter time). Whatever is found has to be later than
  // `after` all the same.
  const justChanged = offsetAt(from + 3 * 3_600_000) !== offsetAt(from - 3 * 3_600_000);
  let wall = Math.floor(wallOf(from, zone) / MINUTE) * MINUTE + (justChanged ? -3 * 3_600_000 : MINUTE);
  const limit = wall + 5 * 366 * 86_400_000;
  // In that repeated hour, something set for a time of day ("30 1 * * *") runs once, the first
  // time round; something that runs every hour anyway ("*/15 * * * *") keeps its real-time rhythm.
  const everyHour = spec.hour.every(Boolean);
  while (wall < limit) {
    const d = new Date(wall);
    if (!spec.month[d.getUTCMonth() + 1]) { wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); continue; }
    if (!dayMatches(spec, d)) { wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); continue; }
    if (!spec.hour[d.getUTCHours()]) { wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1); continue; }
    if (!spec.minute[d.getUTCMinutes()]) { wall += MINUTE; continue; }
    const when = instantsOf(wall, zone);
    const at = (everyHour ? when : when.slice(0, 1)).find((t) => t > from);
    if (at !== undefined) return new Date(at);
    wall += MINUTE;
  }
  return null;
}

// The shortest wait between two firings, in ms (worked out over a fixed stretch in UTC, so the
// answer doesn't depend on today). Infinity for an expression that fires once or never.
export function cronMinGap(spec: CronSpec, firings = 80): number {
  let at = cronNext(spec, new Date(Date.UTC(2024, 0, 1)), "UTC");
  let gap = Infinity;
  for (let i = 0; at && i < firings; i++) {
    const next = cronNext(spec, at, "UTC");
    if (!next) break;
    gap = Math.min(gap, next.getTime() - at.getTime());
    at = next;
  }
  return gap;
}
