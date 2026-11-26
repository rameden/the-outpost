// Cron lines for scheduled jobs: reading the five fields, working out the next time one fires in
// a time zone (clock changes included), and how a job's schedule is accepted or turned down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("cron");
const { parseCron, cronNext, cronMinGap, looksLikeCron, validTimeZone } = await import("../src/cron.ts");
const { parseSchedule, scheduleProblem, nextRunOf, isDue, MIN_INTERVAL_MS } = await import("../src/jobs.ts");
const { rl } = await import("../src/tools.ts");
rl.close();

const on = (set: boolean[]) => set.flatMap((yes, i) => (yes ? [i] : []));
const next = (expr: string, after: string, zone = "UTC") => cronNext(parseCron(expr)!, new Date(after), zone)?.toISOString() ?? null;

test("the five fields: lists, ranges, steps, names", () => {
  const office = parseCron("*/15 9-17 * * 1-5")!;
  assert.deepEqual(on(office.minute), [0, 15, 30, 45]);
  assert.deepEqual(on(office.hour), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(on(office.dow), [1, 2, 3, 4, 5]);
  assert.equal(office.domAny, true);
  assert.equal(office.dowAny, false);
  assert.equal(on(office.dom).length, 31);
  assert.equal(on(office.month).length, 12);

  const named = parseCron("30 6 * JAN,mar-may Mon,thu")!;
  assert.deepEqual(on(named.minute), [30]);
  assert.deepEqual(on(named.month), [1, 3, 4, 5]);
  assert.deepEqual(on(named.dow), [1, 4]);

  assert.deepEqual(on(parseCron("5/15 * * * *")!.minute), [5, 20, 35, 50], "a start and a step");
  assert.deepEqual(on(parseCron("10-30/10,59 * * * *")!.minute), [10, 20, 30, 59], "a stepped range in a list");
  assert.deepEqual(on(parseCron("0 0 * * 7")!.dow), [0], "7 is Sunday");
  assert.deepEqual(on(parseCron("0 0 * * 5-7")!.dow), [0, 5, 6], "a range that ends on Sunday-as-7");
  assert.deepEqual(parseCron("  0   8  * * *  "), parseCron("0 8 * * *"), "spacing doesn't matter");
});

test("the shorthands", () => {
  assert.deepEqual(parseCron("@hourly"), parseCron("0 * * * *"));
  assert.deepEqual(parseCron("@daily"), parseCron("0 0 * * *"));
  assert.deepEqual(parseCron("@midnight"), parseCron("0 0 * * *"));
  assert.deepEqual(parseCron("@weekly"), parseCron("0 0 * * 0"));
  assert.deepEqual(parseCron("@monthly"), parseCron("0 0 1 * *"));
  assert.deepEqual(parseCron("@yearly"), parseCron("0 0 1 1 *"));
  assert.deepEqual(parseCron("@Annually"), parseCron("0 0 1 1 *"));
  assert.equal(parseCron("@reboot"), null);
});

test("what isn't a cron line", () => {
  for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *", "* * * 13 *", "* * * 0 *", "* * * * 8",
    "a b c d e", "*/0 * * * *", "5-1 * * * *", "1-2-3 * * * *", "1,,2 * * * *", "-5 * * * *", "* * * foo *", "1.5 * * * *", "*/x * * * *"]) {
    assert.equal(parseCron(bad), null, `'${bad}'`);
  }
  assert.equal(looksLikeCron("0 8 * * *"), true);
  assert.equal(looksLikeCron("@daily"), true);
  assert.equal(looksLikeCron("every 30m"), false);
  assert.equal(looksLikeCron("daily 08:00"), false);
});

test("the next time a line fires", () => {
  // 3 January 2025 is a Friday.
  assert.equal(next("*/15 9-17 * * 1-5", "2025-01-03T17:40:00Z"), "2025-01-03T17:45:00.000Z");
  assert.equal(next("*/15 9-17 * * 1-5", "2025-01-03T17:45:00Z"), "2025-01-06T09:00:00.000Z", "strictly after, and over the weekend");
  assert.equal(next("0 8 * * *", "2025-01-03T08:00:00Z"), "2025-01-04T08:00:00.000Z");
  assert.equal(next("0 8 * * *", "2025-01-03T07:59:59Z"), "2025-01-03T08:00:00.000Z");
  assert.equal(next("0 0 1 * *", "2025-01-31T12:00:00Z"), "2025-02-01T00:00:00.000Z");
  assert.equal(next("0 0 29 2 *", "2025-01-01T00:00:00Z"), "2028-02-29T00:00:00.000Z", "waits for a leap year");
  assert.equal(next("0 0 30 2 *", "2025-01-01T00:00:00Z"), null, "30 February never comes");
  assert.equal(next("59 23 31 12 *", "2025-12-31T23:59:00Z"), "2026-12-31T23:59:00.000Z");
});

test("both day fields given: either one counts", () => {
  // June 2025 starts on a Sunday: the first Friday is the 6th.
  assert.equal(next("0 0 13 * 5", "2025-06-01T00:00:00Z"), "2025-06-06T00:00:00.000Z", "a Friday, before the 13th");
  assert.equal(next("0 0 13 * 5", "2025-06-06T00:00:00Z"), "2025-06-13T00:00:00.000Z");
  assert.equal(next("0 0 13 * *", "2025-06-01T00:00:00Z"), "2025-06-13T00:00:00.000Z", "only the day of the month");
  assert.equal(next("0 0 * * 5", "2025-06-01T00:00:00Z"), "2025-06-06T00:00:00.000Z", "only the weekday");
  assert.equal(next("0 0 */2 * 5", "2025-06-01T00:00:00Z"), "2025-06-13T00:00:00.000Z", "a stepped * is still a *: both must match");
});

test("a time of day is read in the job's time zone", () => {
  assert.equal(validTimeZone("Europe/London"), true);
  assert.equal(validTimeZone("Mars/Olympus"), false);
  assert.equal(validTimeZone(""), false);
  assert.equal(next("0 8 * * *", "2025-01-15T00:00:00Z", "America/New_York"), "2025-01-15T13:00:00.000Z", "winter: five hours behind");
  assert.equal(next("0 8 * * *", "2025-07-01T00:00:00Z", "America/New_York"), "2025-07-01T12:00:00.000Z", "summer: four");
  assert.equal(next("0 8 * * *", "2025-01-15T00:00:00Z", "Asia/Tokyo"), "2025-01-15T23:00:00.000Z");
  assert.equal(next("30 9 * * *", "2025-01-15T00:00:00Z", "Asia/Kolkata"), "2025-01-15T04:00:00.000Z", "a half-hour zone");
  // The weekday is the zone's too: Monday 07:00 in Sydney is still Sunday evening in UTC.
  assert.equal(next("0 7 * * 1", "2025-01-03T00:00:00Z", "Australia/Sydney"), "2025-01-05T20:00:00.000Z");
});

test("clocks going forward: a time in the missing hour still runs that day, once", () => {
  // New York, 9 March 2025: 02:00 becomes 03:00.
  assert.equal(next("30 2 * * *", "2025-03-09T05:00:00Z", "America/New_York"), "2025-03-09T07:30:00.000Z", "02:30 doesn't exist: 03:30 stands in");
  assert.equal(next("30 2 * * *", "2025-03-09T07:30:00Z", "America/New_York"), "2025-03-10T06:30:00.000Z", "and the day after it's 02:30 again");
  assert.equal(next("30 2,3 * * *", "2025-03-09T07:30:00Z", "America/New_York"), "2025-03-10T06:30:00.000Z", "02:30 and 03:30 fall on the same moment: one run");
  assert.equal(next("0 * * * *", "2025-03-09T06:00:00Z", "America/New_York"), "2025-03-09T07:00:00.000Z", "hourly keeps going");
  assert.equal(next("0 * * * *", "2025-03-09T07:00:00Z", "America/New_York"), "2025-03-09T08:00:00.000Z");
  assert.equal(next("0 8 * * *", "2025-03-08T13:00:00Z", "America/New_York"), "2025-03-09T12:00:00.000Z", "a 23-hour day");
});

test("clocks going back: a time of day fires once, an every-hour line keeps its rhythm", () => {
  // New York, 2 November 2025: 02:00 becomes 01:00 again (at 06:00 UTC).
  assert.equal(next("30 1 * * *", "2025-11-02T04:00:00Z", "America/New_York"), "2025-11-02T05:30:00.000Z", "the first 01:30");
  assert.equal(next("30 1 * * *", "2025-11-02T05:30:00Z", "America/New_York"), "2025-11-03T06:30:00.000Z", "not the second one an hour later");
  assert.equal(next("30 1 * * *", "2025-11-02T06:10:00Z", "America/New_York"), "2025-11-03T06:30:00.000Z", "nor when asked from inside the repeated hour");
  assert.equal(next("*/30 * * * *", "2025-11-02T05:30:00Z", "America/New_York"), "2025-11-02T06:00:00.000Z", "every half hour of real time");
  assert.equal(next("*/30 * * * *", "2025-11-02T06:00:00Z", "America/New_York"), "2025-11-02T06:30:00.000Z");
  assert.equal(next("*/30 * * * *", "2025-11-02T06:30:00Z", "America/New_York"), "2025-11-02T07:00:00.000Z");
  assert.equal(next("0 8 * * *", "2025-11-01T12:00:00Z", "America/New_York"), "2025-11-02T13:00:00.000Z", "a 25-hour day");
});

test("the shortest gap between firings", () => {
  assert.equal(cronMinGap(parseCron("* * * * *")!), 60_000);
  assert.equal(cronMinGap(parseCron("*/5 * * * *")!), 5 * 60_000);
  assert.equal(cronMinGap(parseCron("0,3 * * * *")!), 3 * 60_000, "two firings close together, however rare");
  assert.equal(cronMinGap(parseCron("58,2 * * * *")!), 4 * 60_000, "across the hour");
  assert.equal(cronMinGap(parseCron("0 8 * * *")!), 86_400_000);
  assert.equal(cronMinGap(parseCron("0 0 30 2 *")!), Infinity);
});

test("a job's schedule: cron beside the grammar there always was", () => {
  assert.deepEqual(parseSchedule("every 30m"), { kind: "every", ms: 30 * 60_000 });
  assert.deepEqual(parseSchedule("Every 2 hours"), { kind: "every", ms: 2 * 3_600_000 });
  assert.deepEqual(parseSchedule("daily 08:00"), { kind: "daily", hour: 8, minute: 0, weekdaysOnly: false });
  assert.deepEqual(parseSchedule("weekdays 18:30"), { kind: "daily", hour: 18, minute: 30, weekdaysOnly: true });
  assert.equal(parseSchedule("every 4m"), null, "under five minutes");
  assert.equal(parseSchedule("daily 25:00"), null);
  assert.equal(parseSchedule("whenever"), null);

  assert.equal(parseSchedule("*/15 9-17 * * 1-5")?.kind, "cron");
  assert.equal(parseSchedule("*/5 * * * *")?.kind, "cron", "every five minutes is the most");
  assert.equal(parseSchedule("@daily")?.kind, "cron");
  assert.equal(parseSchedule("0 8 * * MON")?.kind, "cron");
  assert.equal(parseSchedule("* * * * *"), null, "every minute is too often");
  assert.equal(parseSchedule("*/2 * * * *"), null);
  assert.equal(parseSchedule("0,3 9 * * *"), null, "two firings three minutes apart");
  assert.equal(parseSchedule("0 0 30 2 *"), null, "never fires");
  assert.equal(MIN_INTERVAL_MS, 5 * 60_000);
});

test("why a schedule is turned down, in words", () => {
  assert.equal(scheduleProblem("0 8 * * *"), null);
  assert.equal(scheduleProblem("0 8 * * *", "Europe/London"), null);
  assert.equal(scheduleProblem("daily 08:00", "Asia/Tokyo"), null);
  assert.match(scheduleProblem("0 8 * * *", "Mars/Olympus")!, /Unknown time zone 'Mars\/Olympus'/);
  assert.match(scheduleProblem("* * * * *")!, /more often than every 5 minutes/);
  assert.match(scheduleProblem("0 0 30 2 *")!, /never comes round/);
  assert.match(scheduleProblem("99 8 * * *")!, /Can't read schedule '99 8 \* \* \*'.*cron line/);
  assert.match(scheduleProblem("now and then")!, /Can't read schedule/);
});

test("when a job next runs", () => {
  const job = (over: object) => ({ name: "j", task: "t", created: "2025-01-15T00:00:00.000Z", enabled: true, schedule: "every 1h", ...over });
  // An interval counts from the last run; one that has never run is due at once.
  assert.equal(nextRunOf(job({}))!.toISOString(), "2025-01-15T00:00:00.000Z");
  assert.equal(nextRunOf(job({ lastRun: "2025-01-15T03:10:00.000Z" }))!.toISOString(), "2025-01-15T04:10:00.000Z");
  // A time of day waits for its first slot after the job was made, in the job's zone.
  assert.equal(nextRunOf(job({ schedule: "daily 08:00", timezone: "Asia/Tokyo" }))!.toISOString(), "2025-01-15T23:00:00.000Z");
  assert.equal(nextRunOf(job({ schedule: "0 9 * * 1-5", timezone: "Europe/London", lastRun: "2025-07-04T08:00:00.000Z" }))!.toISOString(), "2025-07-07T08:00:00.000Z", "Friday 09:00 BST, then Monday");
  assert.equal(nextRunOf(job({ schedule: "weekdays 09:00", timezone: "UTC", lastRun: "2025-01-03T09:00:00.000Z" }))!.toISOString(), "2025-01-06T09:00:00.000Z");
  assert.equal(nextRunOf(job({ schedule: "nonsense" })), null);
  // A zone that can't be read (a hand edit) falls back to the machine's, rather than never running.
  assert.ok(nextRunOf(job({ schedule: "daily 08:00", timezone: "Mars/Olympus" })));

  // Several missed slots are one run, not one per miss.
  const missed = job({ schedule: "0 8 * * *", timezone: "UTC", lastRun: "2025-01-10T08:00:00.000Z" });
  assert.equal(isDue(missed, new Date("2025-01-14T12:00:00Z")), true);
  assert.equal(isDue({ ...missed, lastRun: "2025-01-14T12:00:00.000Z" }, new Date("2025-01-14T12:00:01Z")), false);
  assert.equal(isDue({ ...missed, lastRun: "2025-01-14T12:00:00.000Z" }, new Date("2025-01-15T08:00:00Z")), true);
  assert.equal(isDue({ ...missed, enabled: false }, new Date("2025-01-14T12:00:00Z")), false);
});
