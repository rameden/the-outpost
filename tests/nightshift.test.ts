// The night shift: off unless switched on, only inside its hours and only when the camp is idle,
// once a night, never while your usage limit is used up. What it does is draft and report: at
// most three model calls, each chore on its own, and nothing in memory changes until you approve.
// The smallest model and the housekeeping report are stood in for by functions: nothing is called.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { enterSandbox } from "./helpers/sandbox.ts";

enterSandbox("nightshift");
const N = await import("../src/nightshift.ts");
const k = await import("../src/keeping.ts");
const { fullMemory, writeMemory } = await import("../src/memory.ts");
const { readAbout } = await import("../src/memlog.ts");
const { drive, setDrive } = await import("../src/settings.ts");
const { rl } = await import("../src/tools.ts");
after(() => rl.close());

const CREW = ["scout", "scribe", "artificer", "warden"] as const;
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute); // November 2026, local time
const on = { brief: false, briefAt: "08:30", retro: false, debrief: false, night: true, nightFrom: "01:00", nightTo: "05:00" };
const quiet = (now: Date) => ({ busy: false, asked: now.getTime() - 31 * 60_000, paused: null, ran: () => false });
// A memory of about `chars` characters: dated lines of 100 characters each, the newest last.
const notes = (who: string, chars: number, date = "2026-10-20") =>
  Array.from({ length: Math.round(chars / 100) }, (_, i) => `- ${date} ${`${who} note ${i} `.padEnd(86, "x")}`).join("\n");
// A stand-in for the small model: it hands back the notes it was given with the oldest lines gone (a tenth of them, unless told otherwise).
const tenthOff = (seen: string[] = [], drop = 0.1) => async (_system: string, prompt: string) => {
  seen.push(prompt.split("\n")[0]);
  const lines = prompt.slice(prompt.indexOf("\n\n") + 2).split("\n");
  return lines.slice(Math.ceil(lines.length * drop)).join("\n");
};
const everything = () => JSON.stringify([readAbout(), ...CREW.map((id) => fullMemory(id))]);
// Start a test from an empty camp: no memories, no proposals waiting, no nights on record.
function empty() {
  for (const p of k.proposals()) k.settleProposal(p.id, "dismiss");
  for (const id of CREW) writeMemory(id, "");
  rmSync(N.NIGHT_DIR, { recursive: true, force: true });
}

test("it's off until you switch it on, and its hours are kept as clock times", () => {
  assert.deepEqual([drive().night, drive().nightFrom, drive().nightTo], [false, "01:00", "05:00"]);
  const now = at(14, 2);
  assert.equal(N.nightDue(now, { ...quiet(now) }), false, "everything else is right, but it's off");
  assert.equal(N.nightDue(now, { ...quiet(now), drive: { ...on, night: undefined } }), false);

  setDrive({ night: true, nightFrom: "23:00", nightTo: "5:30" });
  assert.deepEqual([drive().night, drive().nightFrom, drive().nightTo], [true, "23:00", "05:30"]);
  setDrive({ nightFrom: "25:00", nightTo: "soon" });
  assert.deepEqual([drive().nightFrom, drive().nightTo], ["23:00", "05:30"], "what isn't a time is ignored");
  assert.equal(N.nightDue(now, { ...quiet(now) }), true, "switched on, it reads the settings itself");
  setDrive({ night: false, nightFrom: "01:00", nightTo: "05:00" });
  assert.equal(drive().night, false);
  assert.equal(N.nightDue(now, { ...quiet(now) }), false);
});

test("it's due only inside its hours, which may cross midnight", () => {
  const due = (now: Date, d = on) => N.nightDue(now, { ...quiet(now), drive: d });
  assert.deepEqual([due(at(14, 0, 59)), due(at(14, 1)), due(at(14, 4, 59)), due(at(14, 5)), due(at(14, 13))], [false, true, true, false, false]);
  const late = { ...on, nightFrom: "23:00", nightTo: "05:00" };
  assert.deepEqual([due(at(14, 22, 59), late), due(at(14, 23), late), due(at(15, 0, 10), late), due(at(15, 4, 59), late), due(at(15, 5), late), due(at(15, 12), late)], [false, true, true, true, false, false]);
  assert.equal(due(at(14, 3), { ...on, nightFrom: "03:00", nightTo: "03:00" }), false, "the same time twice is no hours at all");
});

test("it waits until the camp is idle, and while your usage limit is used up", () => {
  const now = at(14, 2);
  const due = (o: object) => N.nightDue(now, { ...quiet(now), drive: on, ...o });
  assert.equal(due({}), true);
  assert.equal(due({ busy: true }), false, "something is running or queued");
  assert.equal(due({ asked: now.getTime() - 29 * 60_000 }), false, "you asked for something 29 minutes ago");
  assert.equal(due({ asked: now.getTime() - 30 * 60_000 }), true);
  assert.equal(due({ paused: now.getTime() + 3_600_000 }), false, "your usage limit is used up");

  // When you last asked is written down, so a restart doesn't forget it.
  N.noteAsked(now.getTime() - 60_000);
  assert.equal(JSON.parse(readFileSync("camp/night/asked.json", "utf8")).at, now.getTime() - 60_000);
  assert.equal(N.lastAsked(), now.getTime() - 60_000);
  assert.equal(N.nightDue(now, { drive: on, busy: false, paused: null, ran: () => false }), false, "read from the record, a minute ago isn't idle");
  N.noteAsked(now.getTime() - 2 * 3_600_000);
  assert.equal(N.nightDue(now, { drive: on, busy: false, paused: null, ran: () => false }), true);
});

test("it runs once a night, and a night that crosses midnight is one night", async () => {
  empty();
  const late = { ...on, nightFrom: "23:00", nightTo: "05:00" };
  const asked: string[] = [];
  const ran = (day: string) => { asked.push(day); return day === "2026-11-13"; };
  assert.equal(N.nightOf(at(13, 23, 30), "23:00", "05:00"), "2026-11-13");
  assert.equal(N.nightOf(at(14, 2), "23:00", "05:00"), "2026-11-13", "after midnight it's still the night that began on the 13th");
  assert.equal(N.nightOf(at(14, 2), "01:00", "05:00"), "2026-11-14");
  assert.equal(N.nightDue(at(13, 23, 30), { ...quiet(at(13, 23, 30)), drive: late, ran }), false);
  assert.equal(N.nightDue(at(14, 2), { ...quiet(at(14, 2)), drive: late, ran }), false);
  assert.equal(N.nightDue(at(14, 23, 30), { ...quiet(at(14, 23, 30)), drive: late, ran }), true, "the next night is a new one");
  assert.deepEqual(asked, ["2026-11-13", "2026-11-13", "2026-11-14"]);

  // Left to itself it asks the record: once tonight's is written, it isn't due again.
  const now = at(14, 2);
  assert.equal(N.nightDue(now, { ...quiet(now), drive: on, ran: undefined }), true);
  const record = await N.runNight({ now, report: async () => [], paused: null });
  assert.equal(record.day, "2026-11-14");
  assert.ok(existsSync("camp/night/2026-11-14.json"));
  assert.equal(N.nightDue(at(14, 3), { ...quiet(at(14, 3)), drive: on, ran: undefined }), false);
  assert.equal(N.nightDue(at(15, 2), { ...quiet(at(15, 2)), drive: on, ran: undefined }), true);
});

test("it drafts tidies for the fullest memories, and nothing in memory changes until you approve", async () => {
  empty();
  writeMemory("scout", notes("scout", 3200));        // 64% of what a prompt loads
  writeMemory("scribe", notes("scribe", 4500));      // 90%
  writeMemory("artificer", notes("artificer", 2000)); // 40%: not worth a draft yet
  writeMemory("warden", notes("warden", 3600));      // 72%
  const before = everything();
  const seen: string[] = [];
  const record = await N.runNight({ now: at(14, 2), ask: tenthOff(seen, 0.5), report: async () => [], paused: null });

  assert.deepEqual(record.tidied, ["agent:scribe", "agent:warden", "agent:scout"], "the fullest first");
  assert.equal(record.calls, 3);
  assert.equal(seen.length, 3);
  assert.deepEqual(record.notes, []);
  assert.equal(everything(), before, "every memory is exactly as it was");
  assert.deepEqual(k.proposals().map((p) => [p.kind, p.where]).sort(), [["tidy", "agent:scout"], ["tidy", "agent:scribe"], ["tidy", "agent:warden"]]);
  assert.deepEqual(JSON.parse(readFileSync("camp/night/2026-11-14.json", "utf8")).tidied, record.tidied);

  // The morning card names them; a draft you've settled drops off it.
  assert.deepEqual(N.nightPage().night?.tidied.map((t) => t.name), ["Scribe's memory", "Warden's memory", "Scout's memory"]);
  assert.match(N.nightPage().lastNight!.line, /^Drafted shorter versions of 3 memories\.$/);
  const scribe = k.proposals().find((p) => p.where === "agent:scribe")!;
  k.settleProposal(scribe.id, "approve");
  assert.notEqual(everything(), before, "approving is what changes it");
  assert.ok(fullMemory("scribe").length < 3000);
  assert.deepEqual(N.nightPage().night?.tidied.map((t) => t.where), ["agent:warden", "agent:scout"]);

  // The next night: one with a draft waiting isn't drafted again, and nothing else is full.
  const again: string[] = [];
  const next = await N.runNight({ now: at(15, 2), ask: tenthOff(again), report: async () => [], paused: null });
  assert.deepEqual([next.tidied, next.calls, again.length], [[], 0, 0]);
});

test("a night makes at most three model calls, however much there is to tidy", async () => {
  empty();
  writeMemory("scout", notes("scout", 6000));        // past what a prompt loads: it takes two passes to bring back inside
  writeMemory("scribe", notes("scribe", 5600));      // past it too: one pass isn't enough, and the night has only one call left
  writeMemory("warden", notes("warden", 4000));
  writeMemory("artificer", notes("artificer", 3500));
  const before = everything();
  const seen: string[] = [];
  const record = await N.runNight({ now: at(14, 2), ask: tenthOff(seen), report: async () => [], paused: null });

  assert.equal(seen.length, 3, "the model was called three times and no more");
  assert.equal(record.calls, 3);
  assert.deepEqual(record.tidied, ["agent:scout", "agent:scribe"], "the second is proposed from the draft the last call gave");
  assert.equal(record.notes.length, 1);
  assert.match(record.notes[0], /^Warden's memory wasn't looked at: the night's 3 model calls were used up\./);
  assert.equal(everything(), before);
  assert.equal(N.MAX_CALLS, 3);

  // Run again the same night (Run it now, twice): it's the same night's record, and what was drafted is still on it.
  const more: string[] = [];
  const second = await N.runNight({ now: at(14, 3), ask: tenthOff(more), report: async () => [], paused: null });
  assert.ok(more.length <= 3);
  assert.deepEqual(second.tidied, ["agent:scout", "agent:scribe", "agent:warden", "agent:artificer"]);
  assert.equal(N.nights().length, 1);
  assert.equal(everything(), before);
});

test("a memory that came back no shorter isn't sent again until it changes", async () => {
  empty();
  writeMemory("scout", notes("scout", 3500));
  const same = async (_s: string, prompt: string) => prompt.slice(prompt.indexOf("\n\n") + 2);
  const first = await N.runNight({ now: at(14, 2), ask: same, report: async () => [], paused: null });
  assert.deepEqual([first.tidied, first.calls], [[], 1]);
  assert.match(first.notes[0], /^No shorter version was drafted for Scout's memory: It came back no shorter/);
  const seen: string[] = [];
  const second = await N.runNight({ now: at(15, 2), ask: tenthOff(seen), report: async () => [], paused: null });
  assert.deepEqual([second.tidied, second.calls, seen.length], [[], 0, 0], "the same text isn't worth another call");
  writeMemory("scout", `${notes("scout", 3500)}\n- 2026-11-15 One more thing`);
  const third = await N.runNight({ now: at(16, 2), ask: tenthOff(seen), report: async () => [], paused: null });
  assert.deepEqual([third.tidied, third.calls], [["agent:scout"], 1]);
});

test("old lines are listed, never touched, and not listed twice", async () => {
  empty();
  writeMemory("scout", ["- 2026-05-02 The staging host moved to eu-west", "- 2026-06-30 📌 Always check the flaky nav test first", "- 2026-08-20 Just inside ninety days", "- 2026-11-01 Fresh from this month", "- An undated line"].join("\n"));
  writeMemory("warden", "- 2026-01-09 Review checklist lives in the wiki");
  const before = everything();
  const record = await N.runNight({ now: at(14, 2), ask: async () => { throw new Error("no model is needed for this"); }, report: async () => [], paused: null });
  assert.deepEqual(record.stale, [
    { where: "agent:warden", text: "Review checklist lives in the wiki", date: "2026-01-09" },
    { where: "agent:scout", text: "The staging host moved to eu-west", date: "2026-05-02" },
  ], "the oldest first; pinned, recent and undated lines aren't listed");
  assert.equal(record.calls, 0);
  assert.equal(everything(), before);
  assert.deepEqual(k.proposals(), []);
  assert.equal(N.worthALook({ date: "2026-08-15" }, at(14, 2).getTime()), true);
  assert.equal(N.worthALook({ date: "2026-08-15", pinned: true }, at(14, 2).getTime()), false);
  assert.equal(N.worthALook({ date: "2026-08-17" }, at(14, 2).getTime()), false);
  assert.equal(N.worthALook({}, at(14, 2).getTime()), false);

  const card = N.nightPage().night!;
  assert.deepEqual(card.stale.map((s) => [s.name, s.text]), [["Warden's memory", "Review checklist lives in the wiki"], ["Scout's memory", "The staging host moved to eu-west"]]);
  assert.equal(N.nightPage().lastNight!.line, "Listed 2 old lines worth a look.");

  // The night after: the same lines aren't news, so there's nothing new to list, but the card still holds what you haven't seen.
  const next = await N.runNight({ now: at(15, 2), report: async () => [], paused: null });
  assert.deepEqual(next.stale, []);
  assert.equal(N.nightPage().night!.stale.length, 2);
  assert.equal(N.nightPage().night!.nights, 2);
  assert.equal(N.nightPage().lastNight!.line, "Nothing needed doing.");

  // Dismissed: no card, and a night that finds nothing new brings none back.
  assert.equal(N.markNightSeen(), 2);
  assert.equal(N.nightPage().night, undefined);
  assert.ok(N.readNight("2026-11-14")!.seen);
  await N.runNight({ now: at(16, 2), report: async () => [], paused: null });
  assert.equal(N.nightPage().night, undefined, "a night that did nothing shows no card");
  assert.equal(N.markNightSeen(), 1);
  assert.equal(everything(), before);
});

test("one chore failing doesn't stop the others, and the record says what couldn't be done", async () => {
  empty();
  writeMemory("scout", notes("scout", 3500));
  writeMemory("scribe", notes("scribe", 4000));
  writeMemory("warden", "- 2026-01-09 Review checklist lives in the wiki");
  const before = everything();
  const ask = async (system: string, prompt: string) => { if (prompt.includes("Scribe's memory")) throw new Error("the model is unreachable"); return tenthOff()(system, prompt); };
  const record = await N.runNight({ now: at(14, 2), ask, report: async () => { throw new Error("git isn't installed"); }, paused: null });
  assert.deepEqual(record.tidied, ["agent:scout"], "the memory after the one that failed was still drafted");
  assert.deepEqual(record.stale.map((s) => s.where), ["agent:warden"], "and the old lines were still listed");
  assert.equal(record.housekeeping, null);
  assert.deepEqual(record.notes, ["No shorter version was drafted for Scribe's memory: the model is unreachable", "The housekeeping report couldn't be made: git isn't installed"]);
  assert.equal(everything(), before);
  assert.deepEqual(N.nightPage().night!.notes, record.notes);
  assert.match(N.nightPage().lastNight!.line, /^Drafted a shorter version of 1 memory, listed 1 old line worth a look\. 2 things couldn't be done\.$/);
});

test("with your usage limit used up it calls no model, and still reports", async () => {
  empty();
  writeMemory("scout", notes("scout", 3500));
  const seen: string[] = [];
  const record = await N.runNight({ now: at(14, 2), ask: tenthOff(seen), report: async () => [], paused: Date.now() + 3_600_000 });
  assert.deepEqual([record.tidied, record.calls, seen.length], [[], 0, 0]);
  assert.deepEqual(record.notes, ["Your usage limit was used up, so no shorter version was drafted for Scout's memory."]);
  // Not marked as tried: the night after, it gets its draft.
  const next = await N.runNight({ now: at(15, 2), ask: tenthOff(seen), report: async () => [], paused: null });
  assert.deepEqual(next.tidied, ["agent:scout"]);
});

test("housekeeping is reported and never cleaned, and the same report twice isn't news", async () => {
  empty();
  const found = [{ step: "uploads" as const, title: "delete 3 uploaded files nothing uses any more", count: 3, bytes: 4096, items: ["a.png", "b.png", "c.png"], lost: "The files themselves." }];
  const record = await N.runNight({ now: at(14, 2), report: async () => found, paused: null });
  assert.deepEqual(record.housekeeping, [{ step: "uploads", title: "delete 3 uploaded files nothing uses any more", count: 3, bytes: 4096 }]);
  assert.deepEqual([N.nightPage().night!.housekeeping.length, N.nightPage().night!.frees], [1, "4 KB"]);
  assert.equal(N.nightPage().lastNight!.line, "Found 1 thing housekeeping could clear.");
  N.markNightSeen();
  await N.runNight({ now: at(15, 2), report: async () => found, paused: null });
  assert.equal(N.nightPage().night, undefined, "you've seen that report already");
  await N.runNight({ now: at(16, 2), report: async () => [{ ...found[0], count: 5, title: "delete 5 uploaded files nothing uses any more" }], paused: null });
  assert.equal(N.nightPage().night!.housekeeping[0].count, 5);

  // The real report, in an empty camp: it runs, finds nothing, and removes nothing.
  empty();
  const real = await N.runNight({ now: at(17, 2), paused: null });
  assert.deepEqual([real.housekeeping, real.notes], [[], []]);
});

test("only one night shift runs at a time", async () => {
  empty();
  writeMemory("scout", notes("scout", 3500));
  let calls = 0, release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const slow = async (s: string, p: string) => { calls++; await held; return tenthOff()(s, p); };
  const first = N.runNight({ now: at(14, 2), ask: slow, report: async () => [], paused: null });
  const second = N.runNight({ now: at(14, 2), ask: slow, report: async () => [], paused: null });
  release();
  assert.equal(await first, await second, "asking again while one is under way gets the same night back");
  assert.equal(calls, 1);
});
