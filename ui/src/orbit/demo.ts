// A pretend camp for Orbit's demo: a feed of its own, fed the same events a real camp sends, so the
// view has something to show when nothing is really running (or when you'd like to see it busy
// without sending anyone anywhere). Nothing here touches the real camp or the real feed: the
// events go into a separate store that only the demo reads, and no request is ever sent.
//
// It plays expeditions one after another, round and round, and each goes in stages, the way real
// work does: the Scout goes out alone to find things out; once they've reported, the Artificer is
// sent on two quests at once and the Test Pilot on a third; when those are in, the Warden reviews; and
// last the Scribe writes it up. Nobody leaves before the stage before them is home. On the way
// they use tools and write (a word at a time, as a real reply arrives), and one of them stops to
// ask for your OK and is given it. Nothing is random: the same crew sees the same show, which is
// what lets it be tested.

import type { FeedStore } from "../feed/store.ts";
import type { CampEvent } from "../types.ts";
import type { KitItem } from "./kit.ts";
import type { Ship } from "./meaning.ts";
import { crewId, crewNow, nameNow, slug } from "../format.ts";
import { w } from "../words.ts";

// id: which of the camp's six they are, if known. Names change with the theme pack, ids never do.
export type Actor = { id?: string; name: string; emoji?: string };

// What a pretend camp reports besides its work, so the demo shows everything the view can draw: how far
// along each of the crew is, what they carry, what today has cost, a plan's limit, and what's waiting at
// the edge. Made for whoever is in the sky (the real crew stands in, if the camp has one).
const PRETEND_XP = [460, 330, 270, 150, 90, 40], PRETEND_COST = [0.84, 0.47, 1.26, 0.18, 0.31, 0.09];
const pretendKit = (): KitItem[][] => [
  [],
  [{ id: "skill:own/read-the-logs", kind: "skill", name: "read-the-logs", about: `How this ${w("camp")}'s logs are laid out, and where to look first when something is slow.` },
    { id: "connector:search", kind: "connector", name: "search", about: "Searches the web.", state: "connected", tools: ["search", "fetch"] }],
  [{ id: "skill:own/house-patterns", kind: "skill", name: "house-patterns", about: "How this codebase likes its code: names, tests beside the file, small commits." },
    { id: "skill:own/migrations", kind: "skill", name: "migrations", about: "Writing a database migration that can be rolled back." },
    { id: "connector:github", kind: "connector", name: "github", about: "Reads and opens pull requests.", state: "connected", tools: ["list_prs", "open_pr", "comment"], write: true }],
  [{ id: "skill:own/house-style", kind: "skill", name: "house-style", about: `The ${w("camp")}'s writing style: short sentences, no jargon, say it once.` },
    { id: "connector:wiki", kind: "connector", name: "wiki", about: `The ${w("camp")}'s wiki.`, state: "idle", tools: ["read_page", "write_page"], write: true }],
  [{ id: "skill:own/review-checklist", kind: "skill", name: "review-checklist", about: "What to check before anything is called done." },
    { id: "connector:ci", kind: "connector", name: "ci", about: "Reads the checks on a branch.", state: "error", error: "It couldn't sign in: its token has run out.", tools: ["runs", "logs"] }],
  [{ id: "skill:own/quick-fix", kind: "skill", name: "quick-fix", about: "Small, safe changes, made fast." }],
];
const shared = (): KitItem => ({ id: "skill:shared/camp-rules", kind: "skill", name: "camp-rules", about: `What everyone in this ${w("camp")} agrees to: ask before anything that can't be undone.`, shared: true });
export function demoCamp(crew: { id: string; name: string }[]): { xp: Record<string, number>; kit: Record<string, KitItem[]>; spend: { today: number; byAgent: Record<string, number> }; limit: { label: string; used: number }; ships: Ship[] } {
  const kit = pretendKit();
  const byAgent = Object.fromEntries(crew.map((c, i) => [c.name, PRETEND_COST[i % PRETEND_COST.length]]));
  return {
    xp: Object.fromEntries(crew.map((c, i) => [c.name, PRETEND_XP[i % PRETEND_XP.length]])),
    kit: Object.fromEntries(crew.map((c, i) => [c.id, i ? [...kit[1 + ((i - 1) % (kit.length - 1))], shared()] : []])),
    spend: { today: Object.values(byAgent).reduce((a, b) => a + b, 0), byAgent },
    limit: { label: "This week", used: 0.62 },
    ships: [
      { id: "ship:q:demo-1", kind: "queued", name: "Tidy the changelog once the export fix is in", detail: "Waiting for the run before it" },
      { id: "ship:pr:demo-212", kind: "pr", name: "#212 Read orders once in the nightly export", detail: "Checks running" },
      { id: "ship:pr:demo-208", kind: "pr", name: "#208 Retry webhooks that time out", detail: "2 checks failing", bad: true },
      { id: "ship:job:demo-brief", kind: "job", name: "Morning brief", detail: "Weekdays at 08:00" },
      { id: "ship:job:demo-deps", kind: "job", name: "Dependency check", detail: "Mondays at 09:00" },
    ],
  };
}

// The camp's own, for a page that doesn't know its crew (or has nobody but the lead). Their names,
// icons and roles are read when used, so they follow the theme pack the page is wearing.
const guildMember = (id: string, name: string, emoji: string, role: () => string) => ({
  id,
  get name() { return nameNow(name); },
  get emoji() { return crewNow().find((c) => c.id === id)?.emoji ?? emoji; },
  get role() { return role(); },
});
export const DEMO_CREW = [
  guildMember("quartermaster", "Quartermaster", "🧭", () => `Plans the ${w("expedition")} and sends the ${w("crew")}`),
  guildMember("scout", "Scout", "🏹", () => "Finds things out"),
  guildMember("artificer", "Artificer", "🔨", () => "Builds and changes things"),
  guildMember("scribe", "Scribe", "🪶", () => "Writes it up"),
  guildMember("warden", "Warden", "🛡️", () => "Reviews and checks"),
  guildMember("wizard", "Test Pilot", "🛸", () => "Takes the most challenging work"),
];

// Whose part each is. A crew without one of these has someone else stand in (see castFor).
const ROLES = ["scout", "artificer", "wizard", "warden", "scribe"] as const;
type Role = (typeof ROLES)[number];
// A quest: whose it is, what it's for, the tools it uses on the way, what it says at the end, and
// (for some) a file it writes or a command it stops to ask about.
type Part = { who: Role; brief: string; tools: [string, string][]; says: string; file?: string; asks?: string };
// A stage: what the Quartermaster says as it sends them, and the quests that go out together.
type Stage = { says: string; parts: Part[] };
const SHOWS: { task: string; plan: string; done: string; stages: Stage[] }[] = [
  {
    task: "Audit the sign-in flow and fix what you find",
    plan: "In stages: the {scout} reads how a session is made, then the fixes, then a review, then the write-up.",
    done: "The session cookie is now Secure and SameSite=Lax on the way in and on the way out, with tests that hold it there. The write-up is in the outputs folder.",
    stages: [
      { says: "The {scout} goes first: nothing gets changed until we know how a session is made.", parts: [
        { who: "scout", brief: "Read the session code and say where the cookie is set",
          tools: [["read_file", "links/app/src/session.ts"], ["grep", "\"Set-Cookie\" links/app/src"], ["read_file", "links/app/src/cookies.ts"], ["read_file", "links/app/src/sign-out.ts"], ["grep", "\"SameSite\" links/app"]],
          says: "The session cookie is set in session.ts on line 48 without the Secure flag, and SameSite falls back to the browser's default. Sign-out clears it with its own copy of the options, which has drifted from the first." },
      ] },
      { says: "The {scout} is back with two things to fix, so the {artificer} takes both, and the {wizard} the check that keeps them fixed.", parts: [
        { who: "artificer", brief: "Set the cookie flags where the session is made",
          tools: [["read_file", "links/app/src/cookies.ts"], ["edit_file", "links/app/src/cookies.ts"], ["edit_file", "links/app/src/session.ts"], ["write_file", "links/app/tests/cookies.test.ts"]],
          asks: "npm test -- cookies", says: "Both flags are set where the cookie is made, and the new test fails without them. The suite passes." },
        { who: "artificer", brief: "Make sign-out clear the cookie with the same options",
          tools: [["read_file", "links/app/src/sign-out.ts"], ["edit_file", "links/app/src/sign-out.ts"], ["edit_file", "links/app/tests/sign-out.test.ts"], ["shell", "npm test -- sign-out"]],
          says: "Sign-out now takes its options from the one place the session does, so the two can't drift apart again." },
        { who: "wizard", brief: "Add a check that fails the build if a cookie is set without Secure",
          tools: [["read_file", "links/app/scripts/lint.ts"], ["write_file", "links/app/scripts/check-cookies.ts"], ["edit_file", "links/app/package.json"], ["shell", "npm run check:cookies"]],
          says: "A twenty-line check, wired into the lint step. It catches the old code and passes on the new." },
      ] },
      { says: "All three are in. The {warden} looks it over before anything goes further.", parts: [
        { who: "warden", brief: "Review the three changes together",
          tools: [["git_diff", "links/app"], ["read_file", "links/app/tests/cookies.test.ts"], ["read_file", "links/app/scripts/check-cookies.ts"], ["shell", "npm test"]],
          says: "The changes are small and do what they say, and the whole suite passes. One note: the check should skip test fixtures, which set a plain cookie on purpose." },
      ] },
      { says: "Reviewed, with one note to pass on. The {scribe} writes it up.", parts: [
        { who: "scribe", brief: "Write up what was found and what changed",
          tools: [["read_file", "links/app/CHANGELOG.md"], ["git_log", "links/app -5"], ["read_file", "camp/wiki/security.md"]], file: "camp/agents/scribe/outputs/sign-in-audit.md",
          says: "Written up: what was wrong, the three changes, and the follow-up the review asked for." },
      ] },
    ],
  },
  {
    task: "Find out why the nightly export takes forty minutes, and fix it",
    plan: "In stages: measure first, then fix what's slow, then check the numbers, then note it down.",
    done: "The export was reading every order once per customer. It now reads them once, and the run is down from forty minutes to under three.",
    stages: [
      { says: "The {scout} times it first. No guessing at what's slow.", parts: [
        { who: "scout", brief: "Time each stage of the export and find the slow one",
          tools: [["read_file", "links/app/jobs/export.ts"], ["shell", "node jobs/export.js --profile --limit 500"], ["grep", "\"SELECT\" links/app/jobs"], ["read_file", "links/app/db/orders.ts"], ["shell", "node jobs/export.js --explain"]],
          says: "Almost all of the time is in one loop: it runs the orders query again for every customer, about nine thousand times a night. The file is also written a row at a time." },
      ] },
      { says: "Two slow things, so two {quests} for the {artificer}, and the {wizard} adds a timer so we'd see it next time.", parts: [
        { who: "artificer", brief: "Read the orders once and group them in memory",
          tools: [["read_file", "links/app/jobs/export.ts"], ["edit_file", "links/app/jobs/export.ts"], ["edit_file", "links/app/db/orders.ts"], ["edit_file", "links/app/jobs/export.test.ts"]],
          asks: "node jobs/export.js --profile", says: "One query now, grouped by customer as it's read. The output is byte for byte what it was." },
        { who: "artificer", brief: "Write the file in batches, not a row at a time",
          tools: [["read_file", "links/app/jobs/write-csv.ts"], ["edit_file", "links/app/jobs/write-csv.ts"], ["shell", "npm test -- write-csv"], ["shell", "node jobs/export.js --limit 5000"]],
          says: "Rows go out a thousand at a time, and the file closes cleanly if the job is stopped part-way." },
        { who: "wizard", brief: "Log how long each stage of the export takes",
          tools: [["read_file", "links/app/jobs/run.ts"], ["edit_file", "links/app/jobs/run.ts"], ["shell", "node jobs/export.js --limit 100"]],
          says: "Each stage logs its time, and the job warns if the whole run passes ten minutes." },
      ] },
      { says: "Now the {warden} checks the numbers hold on real data.", parts: [
        { who: "warden", brief: "Check the new numbers and that nothing else got slower",
          tools: [["shell", "npm run bench -- export"], ["git_diff", "links/app/jobs"], ["read_file", "links/app/jobs/export.test.ts"], ["shell", "npm test"]],
          says: "Two minutes forty on last night's data, and memory stays flat. Nothing else in the job moved, and the tests pass." },
      ] },
      { says: "Good. The {scribe} notes what it was, for whoever meets it next.", parts: [
        { who: "scribe", brief: "Note the cause and the fix in the wiki",
          tools: [["read_file", "camp/wiki/jobs.md"], ["git_log", "links/app/jobs -5"]], file: "camp/wiki/export-speed.md",
          says: "A short page: what was slow, how it was found, and the timer to watch." },
      ] },
    ],
  },
  {
    task: "Add a dark theme to the settings page",
    plan: "In stages: see how the colours are set today, add the dark set, check every control can be read, then the release notes.",
    done: "Settings has a dark theme that follows the system and can be chosen by hand. Every control meets the contrast it needs.",
    stages: [
      { says: "The {scout} finds where the colours come from before anyone adds more.", parts: [
        { who: "scout", brief: "Find where the settings page takes its colours from",
          tools: [["grep", "\"#[0-9a-f]{6}\" links/app/src/settings"], ["read_file", "links/app/src/settings/theme.css"], ["read_file", "links/app/src/settings/Toggle.tsx"], ["read_file", "links/app/src/settings/Field.tsx"], ["grep", "\"prefers-color-scheme\" links/app/src"]],
          says: "Most colours come from eleven variables, but six are written straight into the components and would stay light. Nothing follows the system's setting yet." },
      ] },
      { says: "So: the dark set, and the six stragglers. The {artificer} takes those two, and the {wizard} the switch itself.", parts: [
        { who: "artificer", brief: "Add the dark colours beside the light ones",
          tools: [["read_file", "links/app/src/settings/theme.css"], ["edit_file", "links/app/src/settings/theme.css"], ["edit_file", "links/app/src/settings/theme.test.ts"], ["shell", "npm test -- theme"]],
          says: "The dark set is in, variable for variable, and follows the system until you choose." },
        { who: "artificer", brief: "Move the six hard-coded colours onto variables",
          tools: [["edit_file", "links/app/src/settings/Toggle.tsx"], ["edit_file", "links/app/src/settings/Field.tsx"], ["edit_file", "links/app/src/settings/Slider.tsx"], ["grep", "\"#[0-9a-f]{6}\" links/app/src/settings"]],
          asks: "npm run screenshots -- settings", says: "All six are on variables now, and the search for a hard-coded colour comes back empty." },
        { who: "wizard", brief: "Add the light, dark or system switch to the page",
          tools: [["read_file", "links/app/src/settings/General.tsx"], ["edit_file", "links/app/src/settings/General.tsx"], ["edit_file", "links/app/src/prefs.ts"]],
          says: "Three choices at the top of General, remembered in this browser." },
      ] },
      { says: "It's all in. The {warden} checks it can be read.", parts: [
        { who: "warden", brief: "Check every control can be read in both themes",
          tools: [["shell", "npm run contrast -- settings"], ["read_file", "links/app/src/settings/theme.css"], ["git_diff", "links/app/src/settings"], ["shell", "npm test"]],
          says: "Everything passes but the disabled field's label in the dark set, which needs to be one step lighter." },
      ] },
      { says: "One small thing to carry forward. The {scribe} writes the release notes.", parts: [
        { who: "scribe", brief: "Say what changed in the release notes",
          tools: [["read_file", "links/app/CHANGELOG.md"], ["git_log", "links/app -6"]], file: "camp/agents/scribe/outputs/dark-settings.md",
          says: "Two lines for the release notes, and a note on how to add a colour so it works in both." },
      ] },
    ],
  },
];

// How the show is paced, in milliseconds. A quest with four or five tool calls is out for about twenty seconds.
const APART = 1500;    // between one quest of a stage going out and the next
const TOOL = 2700;     // between a quest's tool calls
const WORD = 130;      // between the words of a reply as it arrives
const OK_AFTER = 4500; // how long a quest waits on your OK before it's given
const BREATH = 1600;   // from a stage's last report to the Quartermaster sending the next
const BETWEEN = 5000;  // from one expedition ending to the next starting

// Who plays each part: whoever in the crew is that member (by id: names change with the theme pack,
// so a Navigator plays the Scout's part; an actor without an id is found by the name they go by now
// or went by in any pack), and for a part nobody does, someone who has no part of their own (or,
// failing that, anyone), so every crew can play the whole show.
const idOf = (a: Actor) => a.id ?? crewId(a.name) ?? slug(a.name).replace(/^testpilot$/, "wizard");
export function castFor(crew: Actor[]): Record<Role, Actor | undefined> {
  const spare = crew.filter((a) => !(ROLES as readonly string[]).includes(idOf(a)));
  const pool = spare.length ? spare : crew;
  return Object.fromEntries(ROLES.map((role, i) => [role, crew.find((a) => idOf(a) === role) ?? pool[i % (pool.length || 1)]])) as Record<Role, Actor | undefined>;
}

// One expedition, as its events and when each happens (ms from its start). crew: who may be sent
// (not the Quartermaster). n: which expedition this is, which picks the show.
export function demoRun(n: number, lead: Actor, crew: Actor[]): { events: [number, object][]; lasts: number } {
  const show = SHOWS[n % SHOWS.length], id = `demo-${n}`, exp = { expeditionId: id };
  const qm = { who: lead.name, emoji: lead.emoji ?? "🧭", depth: 0 };
  const cast = castFor(crew);
  // The narration names the parts as {scout}, {artificer}…: whoever plays each, by the name they have now.
  const say = (text: string) => text.replace(/\{(scout|artificer|wizard|warden|scribe)\}/g, (_, role: Role) => cast[role]?.name ?? role).replace(/\{quests\}/g, w("quests"));
  const events: [number, object][] = [
    [0, { type: "expedition_start", id, task: show.task, source: "user", thread: id }],
    [700, { type: "text", ...qm, text: say(show.plan), ...exp }],
    [1500, { type: "plan", steps: show.stages.flatMap((st) => st.parts).map((p, k) => ({ n: k + 1, text: p.brief })), ...exp }],
  ];
  let at = 1500, step = 0;
  for (const stage of crew.length ? show.stages : []) {
    events.push([at += 900, { type: "text", ...qm, text: say(stage.says), ...exp }]);
    let home = at;
    stage.parts.forEach((part, k) => {
      const actor = cast[part.who]!, me = { who: actor.name, emoji: actor.emoji ?? "", depth: 1 }, on = { questId: `q${step}`, ...exp };
      let t = at + 1000 + k * APART;
      events.push([t, { type: "dispatch", who: me.who, emoji: me.emoji, brief: part.brief, step: ++step, ...on }]);
      for (const [tool, input] of part.tools) events.push([t += TOOL, { type: "tool", ...me, tool, input, ...on }]);
      if (part.asks) {
        const ask = `${id}-ok${step}`;
        events.push([t += TOOL, { type: "ask", id: ask, kind: "shell", title: "Run a command", body: part.asks, ...on }]);
        events.push([t += OK_AFTER, { type: "answered", id: ask, answer: "y" }]);
        events.push([t += 500, { type: "tool", ...me, tool: "shell", input: part.asks, ...on }]);
      }
      if (part.file) events.push([t += TOOL, { type: "file", ...me, path: part.file, change: "created", bytes: 2400, ...on }]);
      t += TOOL;
      for (const word of say(part.says).split(" ")) events.push([t += WORD, { type: "text_delta", ...me, delta: `${word} `, ...on }]);
      events.push([t += 400, { type: "text", ...me, text: say(part.says), ...on }]);
      events.push([t += 1400, { type: "return", who: me.who, emoji: me.emoji, status: "done", ...on }]);
      home = Math.max(home, t);
    });
    at = home + BREATH; // nobody in the next stage leaves until everyone in this one is home
  }
  events.push([at += 1200, { type: "text", ...qm, text: show.done, ...exp }]);
  events.push([at += 1800, { type: "expedition_end", id, status: "done", text: show.done }]);
  return { events: events.sort((a, b) => a[0] - b[0]), lasts: at };
}

// Play the show into `store`, one expedition after another, until the function it returns is called.
export function runDemo(store: FeedStore, lead: Actor, crew: Actor[]): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  let seq = store.getState().lastSeq;
  const play = (n: number) => {
    const run = demoRun(n, lead, crew);
    for (const [at, body] of run.events) later(() => { store.apply({ ...body, seq: ++seq, time: new Date().toISOString() } as CampEvent); }, at);
    later(() => play(n + 1), run.lasts + BETWEEN);
  };
  later(() => play(0), 500);
  return () => { timers.forEach(clearTimeout); timers.clear(); };
}
