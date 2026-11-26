// The cases that exercise the loop, not a single answer: the plan's order, who gets which work,
// the review after a change, the question before a plan, a task picked up again, a failing check
// sent back, and a budget that stops the run.
//
// Their rules read the run's trail (what happened, in order) and the files it left, and nothing
// else, so each rule gives the same verdict every time and can be tried without a model: every
// case here carries a rehearsal (a good run its rules must pass, and bad runs they must turn
// down), which `npm run eval -- --dry` and `npm test` run. No rule here needs the judge.

import type { CaseContext, EvalCase, Moment, Rehearsal } from "./cases.ts";

// ---------- Reading a trail ----------
type Of<T extends Moment["type"]> = Extract<Moment, { type: T }>;
const first = (c: CaseContext, is: (m: Moment) => boolean) => c.trail.findIndex(is);
const last = (c: CaseContext, is: (m: Moment) => boolean) => { for (let i = c.trail.length - 1; i >= 0; i--) if (is(c.trail[i])) return i; return -1; };
const setOut = (who: string) => (m: Moment) => m.type === "dispatch" && m.who === who;
const cameBack = (who: string) => (m: Moment) => m.type === "return" && m.who === who;
// A file written or edited (by this crew member, at a path with this in it).
const wrote = (part = "", who?: string) => (m: Moment) =>
  m.type === "tool" && (m.tool === "write_file" || m.tool === "edit_file") && m.input.includes(part) && (who === undefined || m.who === who);
const planOf = (c: CaseContext) => (c.trail.filter((m): m is Of<"plan"> => m.type === "plan").at(-1)?.steps ?? []);
const notices = (c: CaseContext) => c.trail.flatMap((m, at) => (m.type === "notice" ? [{ at, text: m.text }] : []));
const names = (c: CaseContext) => [...new Set(c.trail.flatMap((m) => (m.type === "dispatch" ? [m.who] : [])))].join(", ") || "nobody";
const lineCount = (t: string | null) => (t ?? "").split("\n").filter((l) => l.trim()).length;
const usd = (n: number) => `$${n.toFixed(2)}`;
const finished = { name: "finished", required: true, run: (c: CaseContext) => c.result.status === "done" || `ended as ${c.result.status}` };

// ---------- Writing a rehearsal ----------
const QM = "Quartermaster";
const plan = (...steps: [text: string, after?: number[]][]): Moment =>
  ({ type: "plan", steps: steps.map(([text, after], i) => ({ n: i + 1, text, ...(after?.length ? { after } : {}) })) });
const out = (who: string, step?: number): Moment => ({ type: "dispatch", who, ...(step ? { step } : {}) });
const back = (who: string, status = "done"): Moment => ({ type: "return", who, status });
const tool = (who: string, name: string, input = ""): Moment => ({ type: "tool", who, tool: name, input });
const notice = (who: string, text: string): Moment => ({ type: "notice", who, text });
const question = (body: string, answer: string): Moment => ({ type: "ask", kind: "question", title: "❓ The Quartermaster asks:", body, answer });
const done = (text: string) => ({ status: "done", text });
// The same run with something changed: the bad runs are the good one gone wrong in one way.
const but = (good: Rehearsal, fails: string, change: Partial<Rehearsal>): Rehearsal & { fails: string } => ({ ...good, ...change, fails });

// ---------- 1. The plan's order ----------
const COST_NOTE = "camp/agents/scribe/outputs/cost-per-team.md";
const planOrderGood: Rehearsal = {
  result: done("The hosting bill was $1,840 and 46 teams were active, so hosting cost $40 per active team. The note is saved."),
  trail: [
    tool(QM, "submit_plan"),
    plan(["Scout: find last month's hosting bill in docs/costs.md"], ["Artificer: count the active teams"], ["Scribe: save the cost-per-team sentence", [1, 2]]),
    out("Scout", 1), out("Artificer", 2),
    tool("Scout", "read_file", "docs/costs.md"), tool("Artificer", "bash", "node tools/count-teams.mjs"),
    back("Artificer"), back("Scout"),
    out("Scribe", 3), tool("Scribe", "write_file", COST_NOTE), back("Scribe"),
  ],
  files: { [COST_NOTE]: "Hosting cost per active team last month: $40.\n" },
};
const planOrder: EvalCase = {
  id: "loop-plan-order",
  covers: "plan-order",
  about: "The plan marks the two lookups as free to run together and the writing as waiting for both, and the run keeps to it",
  request:
    "I need a one-line cost note. The Scout should find last month's hosting bill in docs/costs.md. The Artificer should count our active teams by running " +
    "`node tools/count-teams.mjs`. When both numbers are in, the Scribe should save the sentence 'Hosting cost per active team last month: $<the bill divided by the teams>.' " +
    `to ${COST_NOTE}. Then tell me the figure.`,
  files: {
    "docs/costs.md": "# Costs\n\n| Month | Hosting | Support desk |\n| --- | --- | --- |\n| September | $1,790 | $310 |\n| October (last month) | $1,840 | $310 |\n",
    "data/teams.json": JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ id: i + 1, active: i % 30 < 23 })), null, 1) + "\n",
    "tools/count-teams.mjs": "import { readFileSync } from 'node:fs';\nconst teams = JSON.parse(readFileSync('data/teams.json', 'utf8'));\nconsole.log(`${teams.filter((t) => t.active).length} active teams`);\n",
  },
  approveShell: ["node tools/count-teams.mjs"],
  plans: true,
  checks: [
    finished,
    { name: "showed a plan of three steps or more", required: true, run: (c) => planOf(c).length >= 3 || `${planOf(c).length} steps in the plan` },
    { name: "the plan lets the two lookups start at once", required: true, run: (c) => planOf(c).filter((s) => !s.after?.length).length >= 2 || "fewer than two steps are free to start" },
    { name: "the plan makes the writing wait for both lookups", required: true, run: (c) => planOf(c).some((s) => (s.after?.length ?? 0) >= 2) || "no step is marked as waiting for two others" },
    { name: "the Scribe set out only once both lookups were back", required: true, run: (c) => {
      const scribe = first(c, setOut("Scribe")), scout = first(c, cameBack("Scout")), artificer = first(c, cameBack("Artificer"));
      if (scribe < 0 || scout < 0 || artificer < 0) return `dispatched: ${names(c)}`;
      return (scribe > scout && scribe > artificer) || "the Scribe set out before a lookup was back";
    } },
    { name: "the note has the right figure ($40)", required: true, run: (c) => /\$\s?40(\.00)?(?![\d,])/.test(c.read(COST_NOTE) ?? "") || (c.read(COST_NOTE) === null ? "no note saved" : "wrong figure") },
    { name: "reported the figure", run: (c) => /\$\s?40(\.00)?(?![\d,])/.test(c.result.text) || "not in the answer" },
    { name: "the two lookups were out at the same time", run: (c) => {
      const firstBack = Math.min(...[first(c, cameBack("Scout")), first(c, cameBack("Artificer"))].filter((i) => i >= 0));
      return (first(c, setOut("Scout")) < firstBack && first(c, setOut("Artificer")) < firstBack) || "one after the other";
    } },
  ],
  rehearsal: {
    good: planOrderGood,
    bad: [
      // A plan that is just a list: nothing says what can run together or what must wait.
      but(planOrderGood, "the plan makes the writing wait for both lookups", { trail: planOrderGood.trail.map((m) => (m.type === "plan" ? plan(["Scout: the bill"], ["Artificer: the teams"], ["Scribe: the sentence"]) : m)) }),
      // The plan is right, but the Scribe is sent while the Artificer is still out.
      but(planOrderGood, "the Scribe set out only once both lookups were back", { trail: [
        ...planOrderGood.trail.slice(0, 4), back("Scout"), out("Scribe", 3), tool("Scribe", "write_file", COST_NOTE), back("Scribe"), back("Artificer"),
      ] }),
    ],
  },
};

// ---------- 2. The right crew member for each piece ----------
const rightCrewGood: Rehearsal = {
  result: done("Fixed: orders over $100 now get 15% off, and the check passes. The customer note is at camp/agents/scribe/outputs/discount-note.md."),
  trail: [
    tool(QM, "submit_plan"), plan(["Artificer: fix the discount and run the check"], ["Scribe: write the customer note", [1]]),
    out("Artificer", 1), tool("Artificer", "read_file", "src/price.mjs"), tool("Artificer", "edit_file", "src/price.mjs"), tool("Artificer", "bash", "node check.mjs"), back("Artificer"),
    out("Scribe", 2), tool("Scribe", "write_file", "camp/agents/scribe/outputs/discount-note.md"), back("Scribe"),
  ],
  files: { "src/price.mjs": "export function total(amount) {\n  return amount > 100 ? amount * 0.85 : amount;\n}\n" },
  passing: ["node check.mjs"],
};
const rightCrew: EvalCase = {
  id: "loop-right-crew",
  covers: "right-crew",
  about: "A request with code and writing in it, naming nobody: the Artificer gets the code and the Scribe gets the words",
  request:
    "`node check.mjs` fails: orders over $100 should get 15% off, but src/price.mjs gives 10%. Get that fixed and the check passing. " +
    "Also get a two-sentence note for customers about the corrected discount saved as a file, and tell me where it is.",
  files: {
    "src/price.mjs": "// Orders over $100 get a discount.\nexport function total(amount) {\n  return amount > 100 ? amount * 0.9 : amount;\n}\n",
    "check.mjs": "import { total } from './src/price.mjs';\nconst ok = total(200) === 170 && total(80) === 80;\nconsole.log(ok ? 'PASS' : 'FAIL');\nprocess.exit(ok ? 0 : 1);\n",
  },
  approveShell: ["node check.mjs"],
  checks: [
    finished,
    { name: "the Artificer changed the code", required: true, run: (c) => c.trail.some(wrote("price.mjs", "Artificer")) || `src/price.mjs wasn't changed by the Artificer (dispatched: ${names(c)})` },
    { name: "nobody else touched the code", required: true, run: (c) => {
      const other = c.trail.find((m) => m.type === "tool" && m.who !== "Artificer" && (wrote("src/")(m) || wrote("check.mjs")(m)));
      return !other || `${(other as Of<"tool">).who} wrote code`;
    } },
    { name: "the Scribe wrote the note", required: true, run: (c) => c.trail.some(wrote("", "Scribe")) || `the Scribe saved nothing (dispatched: ${names(c)})` },
    { name: "the check passes", required: true, run: (c) => c.ok("node check.mjs") || "node check.mjs still fails" },
    { name: "the Artificer wrote only code", run: (c) => !c.trail.some((m) => wrote("", "Artificer")(m) && !wrote("src/")(m)) || "the Artificer wrote the note too" },
    { name: "said where the note is", run: (c) => /outputs\/|\.md\b/.test(c.result.text) || "no file named" },
  ],
  rehearsal: {
    good: rightCrewGood,
    bad: [
      // The Artificer is handed the whole thing and writes the note as well.
      but(rightCrewGood, "the Scribe wrote the note", { trail: [
        out("Artificer"), tool("Artificer", "edit_file", "src/price.mjs"), tool("Artificer", "write_file", "camp/agents/artificer/outputs/discount-note.md"), back("Artificer"),
      ] }),
      // The Scribe is sent to "fix the wording" in the code.
      but(rightCrewGood, "nobody else touched the code", { trail: [...rightCrewGood.trail, out("Scribe"), tool("Scribe", "edit_file", "src/price.mjs"), back("Scribe")] }),
    ],
  },
};

// ---------- 3. A review after files change ----------
const CART = "links/shop/src/cart.mjs";
const reviewGood: Rehearsal = {
  result: done("Fixed: the cart total now multiplies each price by its quantity. The Warden reviewed the change and found nothing to fix."),
  trail: [
    out("Artificer"), tool("Artificer", "read_file", CART), tool("Artificer", "edit_file", CART), tool("Artificer", "bash", "node check.mjs"), back("Artificer"),
    out("Warden"), tool("Warden", "bash", "git diff"), tool("Warden", "read_file", CART), back("Warden"),
  ],
  passing: ["links/shop: node check.mjs"],
};
const reviewAfterChange: EvalCase = {
  id: "loop-review-after-change",
  covers: "review-after-change",
  about: "After a quest changes files in a linked folder, the Warden reviews the change before the final answer, and changes nothing",
  request: "In the shop folder, `node check.mjs` fails: the cart total ignores how many of each item there are. Fix it.",
  link: {
    name: "shop",
    files: {
      "src/cart.mjs": "// The total for a cart: every item's price times how many of it there are.\nexport function cartTotal(items) {\n  return items.reduce((sum, item) => sum + item.price, 0);\n}\n",
      "check.mjs": "import { cartTotal } from './src/cart.mjs';\nconst ok = cartTotal([{ price: 5, qty: 2 }, { price: 3, qty: 1 }]) === 13 && cartTotal([]) === 0;\nconsole.log(ok ? 'PASS' : 'FAIL');\nprocess.exit(ok ? 0 : 1);\n",
      "README.md": "# Shop\n\nA small cart library. `node check.mjs` checks it.\n",
    },
  },
  review: true,
  approveShell: ["node check.mjs"],
  checks: [
    finished,
    { name: "the fix was made in the linked folder", required: true, run: (c) => c.trail.some((m) => wrote("links/shop/")(m) && (m as Of<"tool">).who !== "Warden") || "nothing in links/shop was written" },
    { name: "the Warden was sent after the last change", required: true, run: (c) => {
      const change = last(c, (m) => wrote("links/shop/")(m) && (m as Of<"tool">).who !== "Warden"), warden = last(c, setOut("Warden"));
      if (warden < 0) return `no review (dispatched: ${names(c)})`;
      return warden > change || "the files changed again after the review";
    } },
    { name: "the Warden changed nothing", required: true, run: (c) => !c.trail.some(wrote("", "Warden")) || "the Warden wrote a file" },
    { name: "the fix works", required: true, run: (c) => c.ok("node check.mjs", "links/shop") || "node check.mjs still fails" },
    // Not a rule: the camp sends the Warden itself when the Quartermaster finishes without a review,
    // so the change is still reviewed. But then nothing found can be fixed, so it is worth seeing.
    { name: "the Quartermaster sent the Warden, not the camp in its place", run: (c) => !notices(c).some((n) => /hasn't been reviewed/.test(n.text)) || "the camp had to send the Warden itself" },
    { name: "one review, not several", run: (c) => c.trail.filter(setOut("Warden")).length === 1 || `${c.trail.filter(setOut("Warden")).length} reviews` },
    { name: "the answer mentions the review", run: (c) => /review|warden/i.test(c.result.text) || "not mentioned" },
  ],
  rehearsal: {
    good: reviewGood,
    bad: [
      // The change is reported as done with no review.
      but(reviewGood, "the Warden was sent after the last change", { trail: reviewGood.trail.slice(0, 5) }),
      // The review happens, then the Artificer changes the file again and nobody looks.
      but(reviewGood, "the Warden was sent after the last change", { trail: [...reviewGood.trail, out("Artificer"), tool("Artificer", "edit_file", CART), back("Artificer")] }),
      // The Warden fixes what it found instead of reporting it.
      but(reviewGood, "the Warden changed nothing", { trail: [...reviewGood.trail.slice(0, 7), tool("Warden", "edit_file", CART), back("Warden")] }),
    ],
  },
};

// ---------- 4. A question before a plan ----------
const PRICING = "camp/agents/scribe/outputs/pricing.md";
const isQuestion = (m: Moment) => m.type === "ask" && m.kind === "question";
// Anything that commits to a course: a plan put forward, or someone sent.
const commits = (m: Moment) => m.type === "plan" || m.type === "dispatch" || (m.type === "tool" && m.tool === "submit_plan") || (m.type === "ask" && m.kind === "plan");
const askGood: Rehearsal = {
  result: done("Saved a three-line announcement of the annual plan ($99 a seat per year) to camp/agents/scribe/outputs/pricing.md."),
  trail: [
    tool(QM, "list_files", "drafts"), tool(QM, "ask_user", "Which pricing draft did you decide on: A (monthly) or B (annual)?"),
    question("Which pricing draft did you decide on: A (monthly) or B (annual)?", "Draft B, the annual one."),
    out("Scribe"), tool("Scribe", "read_file", "drafts/pricing-b.md"), tool("Scribe", "write_file", PRICING), back("Scribe"),
  ],
  files: { [PRICING]: "New pricing from January.\nOne plan: $99 per seat, billed yearly.\nEvery feature is included.\n" },
};
const askBeforePlan: EvalCase = {
  id: "loop-ask-before-plan",
  covers: "ask-before-plan",
  about: "A request that can't be acted on without one missing fact: the Quartermaster asks before it plans or sends anyone, then uses the answer",
  request: `Take the pricing draft we decided to go with and have the Scribe turn it into a three-line announcement saved to ${PRICING}.`,
  files: {
    "drafts/pricing-a.md": "# Pricing draft A: monthly\n\nOne plan at $12 per seat per month, cancel any time. Every feature is included.\n",
    "drafts/pricing-b.md": "# Pricing draft B: annual\n\nOne plan at $99 per seat per year, billed yearly. Every feature is included.\n",
  },
  answer: "Draft B, the annual one.",
  plans: true,
  checks: [
    finished,
    { name: "asked which draft before planning or sending anyone", required: true, run: (c) => {
      const asked = first(c, isQuestion), committed = first(c, commits);
      if (asked < 0) return "never asked";
      return committed < 0 || asked < committed || "planned or dispatched before asking";
    } },
    { name: "the announcement uses the draft that was chosen", required: true, run: (c) => {
      const t = c.read(PRICING);
      if (t === null) return "no announcement saved";
      return (/\$\s?99\b/.test(t) && !/\$\s?12\b/.test(t)) || "not draft B's price";
    } },
    { name: "asked once", run: (c) => c.trail.filter(isQuestion).length === 1 || `${c.trail.filter(isQuestion).length} questions` },
    { name: "the question is about the drafts", run: (c) => /draft|pricing|monthly|annual|\bA\b.*\bB\b/i.test((c.trail.find(isQuestion) as Of<"ask"> | undefined)?.body ?? "") || "about something else" },
    { name: "three lines", run: (c) => lineCount(c.read(PRICING)) === 3 || `${lineCount(c.read(PRICING))} lines` },
  ],
  rehearsal: {
    good: askGood,
    bad: [
      // It guesses, and happens to guess the one that was meant.
      but(askGood, "asked which draft before planning or sending anyone", { trail: askGood.trail.filter((m) => !isQuestion(m) && !(m.type === "tool" && m.tool === "ask_user")) }),
      // It sends the Scribe first and asks afterwards.
      but(askGood, "asked which draft before planning or sending anyone", { trail: [...askGood.trail.slice(3), ...askGood.trail.slice(1, 3)] }),
      // It asks, then writes up the other draft.
      but(askGood, "the announcement uses the draft that was chosen", { files: { [PRICING]: "New pricing.\nOne plan: $12 per seat per month.\nCancel any time.\n" } }),
    ],
  },
};

// ---------- 5. A task picked up again ----------
const NOTIFY = "node app/notify.cjs";
const REUSED = /already ran before this task was picked up again/;
const resumeGood: Rehearsal = {
  result: done("The order 7 notification had already gone out before the run was cut off, so I didn't send it again. The receipt is written."),
  trail: [
    tool("Artificer", "bash", NOTIFY),
    notice("Artificer", "↩️ bash already ran before this task was picked up again (op_3f1a9c2e77d04b18): its recorded result is reused, and it isn't run a second time."),
    tool("Artificer", "write_file", "app/receipt.md"),
  ],
  files: { "app/sent.log": "notified order 7\n", "app/receipt.md": "Order 7: notification sent.\n" },
};
const resumeNoRepeat: EvalCase = {
  id: "loop-resume-no-repeat",
  covers: "resume-no-repeat",
  about: "A task cut off after it sent a notification is picked up again: the rest gets done, and the notification isn't sent twice",
  agent: "artificer",
  request: "Carry on from where you were cut off.",
  files: {
    "app/notify.cjs": "// Sends the order 7 notification (here: one line added to app/sent.log per send).\nrequire('node:fs').appendFileSync('app/sent.log', 'notified order 7\\n');\nconsole.log('sent');\n",
    "app/sent.log": "notified order 7\n",
  },
  resume: {
    earlier: "Send the order 7 notification by running `node app/notify.cjs`, then write app/receipt.md with the one line 'Order 7: notification sent.'",
    done: [{ tool: "bash", input: { command: NOTIFY }, result: "sent" }],
  },
  // (Approved on purpose: if it's asked for again as a new command, it really runs, and the rule below catches it.)
  approveShell: [NOTIFY],
  checks: [
    finished,
    { name: "the notification went out exactly once", required: true, run: (c) => lineCount(c.read("app/sent.log")) === 1 || `${lineCount(c.read("app/sent.log"))} notifications sent` },
    { name: "the rest of the task got done", required: true, run: (c) => /order 7/i.test(c.read("app/receipt.md") ?? "") || (c.read("app/receipt.md") === null ? "no receipt written" : "the receipt doesn't name order 7") },
    { name: "the recorded result was reused, or the command wasn't asked for again", run: (c) =>
      notices(c).some((n) => REUSED.test(n.text)) || !c.trail.some((m) => m.type === "tool" && m.tool === "bash" && m.input.includes("notify")) || "asked for again, and not reused" },
  ],
  rehearsal: {
    good: resumeGood,
    bad: [
      // Picked up with a differently spelled command, so it runs again: the customer hears twice.
      but(resumeGood, "the notification went out exactly once", { trail: [tool("Artificer", "bash", "cd app && node notify.cjs"), tool("Artificer", "write_file", "app/receipt.md")],
        files: { ...resumeGood.files, "app/sent.log": "notified order 7\nnotified order 7\n" } }),
      // It sees the notification is done and stops there.
      but(resumeGood, "the rest of the task got done", { trail: [], files: { "app/sent.log": "notified order 7\n" } }),
    ],
  },
};

// ---------- 5b. A task picked up again from its saved transcript ----------
const RESTORED = /Picked up from the saved transcript/;
const restoredGood: Rehearsal = {
  result: done("The order 7 notification had gone out before the run was cut off. I wrote the receipt, which was what was left."),
  trail: [
    notice("Artificer", "⏪ Picked up from the saved transcript of the run that broke off (3 messages), so finished steps aren't done again."),
    tool("Artificer", "write_file", "app/receipt.md"),
  ],
  files: { "app/sent.log": "notified order 7\n", "app/receipt.md": "Order 7: notification sent.\n" },
};
const resumeRestored: EvalCase = {
  ...resumeNoRepeat,
  id: "loop-resume-restored",
  covers: "resume-restored",
  about: "A task cut off mid-run is picked up from its saved transcript: it goes on from where it was, without doing the finished part over",
  resume: { ...resumeNoRepeat.resume!, transcript: true },
  checks: [
    finished,
    { name: "the saved transcript was restored", required: true, run: (c) => notices(c).some((n) => RESTORED.test(n.text)) || "the run started from the task alone" },
    { name: "the notification went out exactly once", required: true, run: (c) => lineCount(c.read("app/sent.log")) === 1 || `${lineCount(c.read("app/sent.log"))} notifications sent` },
    { name: "the rest of the task got done", required: true, run: (c) => /order 7/i.test(c.read("app/receipt.md") ?? "") || (c.read("app/receipt.md") === null ? "no receipt written" : "the receipt doesn't name order 7") },
    // With the call and its result in front of it, it has no reason to ask for the command again.
    { name: "the finished step wasn't asked for again", run: (c) => !c.trail.some((m) => m.type === "tool" && m.tool === "bash" && m.input.includes("notify")) || "asked for the notification again" },
  ],
  rehearsal: {
    good: restoredGood,
    bad: [
      // The transcript wasn't there (or wasn't read): it starts over from the task.
      but(restoredGood, "the saved transcript was restored", { trail: [tool("Artificer", "write_file", "app/receipt.md")] }),
      // It has the transcript and sends the notification anyway.
      but(restoredGood, "the notification went out exactly once", { trail: [...restoredGood.trail, tool("Artificer", "bash", NOTIFY)],
        files: { ...restoredGood.files, "app/sent.log": "notified order 7\nnotified order 7\n" } }),
      // It reads that the notification went out and stops there.
      but(restoredGood, "the rest of the task got done", { trail: [restoredGood.trail[0]], files: { "app/sent.log": "notified order 7\n" } }),
    ],
  },
};

// ---------- 6. A failing check sends the work back ----------
const LINT = "node tools/lint.mjs", TESTS = "node check.mjs", LEDGER = "links/ledger";
const checkRuns = (c: CaseContext) => notices(c).flatMap((n) => { const m = n.text.match(/^([✓✗]) check: (.+)$/); return m ? [{ at: n.at, passed: m[1] === "✓", command: m[2] }] : []; });
const SENT_BACK = /A check failed: sending .+ back to fix it/;
const fixGood: Rehearsal = {
  result: done("Added shipping(cents) to src/fees.mjs. The folder's checks failed the first time (no doc comment); that's fixed and both pass now."),
  trail: [
    out("Artificer"), tool("Artificer", "edit_file", `${LEDGER}/src/fees.mjs`),
    tool("Artificer", "check", `${LINT}  (${LEDGER})`), notice("Artificer", `✗ check: ${LINT}`),
    tool("Artificer", "check", `${TESTS}  (${LEDGER})`), notice("Artificer", `✓ check: ${TESTS}`),
    notice("Artificer", "🔁 A check failed: sending Artificer back to fix it (1 of 2)."),
    tool("Artificer", "edit_file", `${LEDGER}/src/fees.mjs`),
    tool("Artificer", "check", `${LINT}  (${LEDGER})`), notice("Artificer", `✓ check: ${LINT}`),
    tool("Artificer", "check", `${TESTS}  (${LEDGER})`), notice("Artificer", `✓ check: ${TESTS}`),
    back("Artificer"),
  ],
  passing: [`${LEDGER}: ${LINT}`, `${LEDGER}: ${TESTS}`],
};
const fixAfterCheck: EvalCase = {
  id: "loop-fix-after-check",
  covers: "fix-after-check",
  about: "The linked folder has its own checks: the camp runs them after the change, a failure sends the work back, and the run ends with them passing",
  request: "In the ledger folder, add an exported function `shipping(cents)` to src/fees.mjs: free at 5000 cents or more, otherwise 500. check.mjs already tests it.",
  link: {
    name: "ledger",
    files: {
      "src/fees.mjs": "/** The card fee on an amount, in cents. */\nexport function cardFee(cents) {\n  return Math.round(cents * 0.029) + 30;\n}\n",
      "check.mjs": "import * as fees from './src/fees.mjs';\nconst ok = fees.cardFee(1000) === 59 && typeof fees.shipping === 'function' && fees.shipping(5000) === 0 && fees.shipping(4999) === 500;\nconsole.log(ok ? 'PASS' : 'FAIL');\nprocess.exit(ok ? 0 : 1);\n",
      // The house rule nobody mentions in the request: every exported function has a doc comment.
      "tools/lint.mjs": [
        "import { readdirSync, readFileSync } from 'node:fs';",
        "let bad = 0;",
        "for (const file of readdirSync('src').filter((f) => f.endsWith('.mjs'))) {",
        "  const lines = readFileSync(`src/${file}`, 'utf8').split('\\n');",
        "  lines.forEach((line, i) => {",
        "    if (/^export (async )?function /.test(line) && !/\\*\\/\\s*$/.test(lines[i - 1] ?? '')) {",
        "      console.log(`src/${file}:${i + 1} an exported function needs a /** doc comment */ ending on the line above it`);",
        "      bad++;",
        "    }",
        "  });",
        "}",
        "console.log(bad ? `${bad} problem(s)` : 'lint ok');",
        "process.exit(bad ? 1 : 0);",
        "",
      ].join("\n"),
    },
    verify: [LINT, TESTS],
  },
  approveShell: [LINT, TESTS],
  checks: [
    finished,
    { name: "the camp ran the folder's checks after the change", required: true, run: (c) => {
      const change = first(c, wrote(`${LEDGER}/`));
      if (change < 0) return "nothing in links/ledger was written";
      return checkRuns(c).some((r) => r.at > change) || "no check ran";
    } },
    { name: "a failed check sent the work back", required: true, run: (c) => {
      const failed = checkRuns(c).find((r) => !r.passed);
      return !failed || notices(c).some((n) => n.at > failed.at && SENT_BACK.test(n.text)) || `${failed.command} failed and nobody was sent back`;
    } },
    { name: "the run ended with every check passing", required: true, run: (c) => {
      const latest = new Map(checkRuns(c).map((r) => [r.command, r.passed]));
      const red = [...latest].filter(([, passed]) => !passed).map(([command]) => command);
      return !red.length || `still failing at the end: ${red.join(", ")}`;
    } },
    { name: "the folder's checks pass now", required: true, run: (c) => (c.ok(LINT, LEDGER) && c.ok(TESTS, LEDGER)) || `${c.ok(LINT, LEDGER) ? TESTS : LINT} fails` },
    // Not a rule: a careful first try passes both checks, and then there is nothing to send back.
    { name: "a check failed first, so the way back was used", run: (c) => checkRuns(c).some((r) => !r.passed) || "passed first time" },
  ],
  rehearsal: {
    good: fixGood,
    bad: [
      // The check fails and the run reports success anyway.
      but(fixGood, "a failed check sent the work back", { trail: [...fixGood.trail.slice(0, 6), back("Artificer")], passing: [`${LEDGER}: ${TESTS}`] }),
      // Sent back as often as allowed, and still red at the end.
      but(fixGood, "the run ended with every check passing", { trail: [...fixGood.trail.slice(0, 8), notice("Artificer", `✗ check: ${LINT}`), notice("Artificer", `✓ check: ${TESTS}`), back("Artificer")], passing: [`${LEDGER}: ${TESTS}`] }),
      // The change is made somewhere the checks don't see it run.
      but(fixGood, "the camp ran the folder's checks after the change", { trail: [out("Artificer"), tool("Artificer", "edit_file", `${LEDGER}/src/fees.mjs`), back("Artificer")] }),
    ],
  },
};

// ---------- 7. A budget stops the run ----------
const BUDGET = 0.01;
const budgetGood: Rehearsal = {
  result: { status: "over_budget", text: "I'll have the Scout read the handbook first.\n\n[Stopped: this expedition reached its $0.01 budget.]" },
  trail: [tool(QM, "submit_plan"), plan(["Scout: five bullets"], ["Scribe: the welcome note", [1]], ["Warden: check it", [2]]), out("Scout", 1), tool("Scout", "read_file", "docs/handbook.md"), back("Scout", "over_budget")],
  spent: 0.04,
};
const budgetStop: EvalCase = {
  id: "loop-budget-stop",
  covers: "budget-stop",
  about: "With a one-cent budget and three quests' worth of work, the run stops as over budget and says so: it doesn't carry on to the end",
  request:
    "Three things, one after another: have the Scout sum up docs/handbook.md in five bullet points; have the Scribe turn those into a welcome note saved to " +
    "camp/agents/scribe/outputs/welcome.md; then have the Warden check the note against the handbook. Tell me what each of them found.",
  files: {
    "docs/handbook.md": "# Team handbook\n\n" + [
      "Working hours are flexible: be reachable between 10:00 and 15:00 in your own time zone.",
      "New starters get a buddy for their first month, and a laptop budget of $2,000.",
      "Deploys happen Monday to Thursday. Nothing ships on a Friday without the on-call lead's say-so.",
      "Holiday is 28 days a year, booked at least two weeks ahead in the shared calendar.",
      "Expenses under $50 need no approval; anything over goes to your team lead first.",
      "Every pull request needs one review, and two if it touches billing.",
      "The on-call rota changes every Tuesday at 10:00. Swaps are fine if both people agree in the channel.",
      "Customer data never leaves the production systems: use the anonymised copy for testing.",
    ].map((l) => `- ${l}`).join("\n") + "\n",
  },
  budgetUsd: BUDGET,
  checks: [
    { name: "didn't run past the budget and call it done", required: true, run: (c) =>
      c.result.status === "over_budget" || (c.result.status === "done" && c.spent <= BUDGET) || `ended as ${c.result.status} having spent ${usd(c.spent)} of a ${usd(BUDGET)} budget` },
    { name: "the answer says the budget stopped it", required: true, run: (c) => c.result.status !== "over_budget" || /budget/i.test(c.result.text) || "the stop isn't explained" },
    { name: "the last step never started", required: true, run: (c) => c.result.status !== "over_budget" || !c.trail.some(setOut("Warden")) || "the Warden was still sent" },
    // Finishing inside the budget is fine, but only if the work was really done: saying "done" isn't it.
    { name: "a run that wasn't stopped did the work", required: true, run: (c) =>
      c.result.status !== "done" || c.read("camp/agents/scribe/outputs/welcome.md") !== null || "it says it finished, but the welcome note was never written" },
    // Not a rule: on the cheapest models one cent can cover the whole task, and then nothing needs stopping.
    { name: "the budget was reached, so the stop was used", run: (c) => c.result.status === "over_budget" || `finished for ${usd(c.spent)}` },
    { name: "stopped within a few cents of it", run: (c) => c.spent <= BUDGET + 0.25 || `spent ${usd(c.spent)}` },
  ],
  rehearsal: {
    good: budgetGood,
    bad: [
      // The budget is passed and the run finishes everything as if there were none.
      but(budgetGood, "didn't run past the budget and call it done", { result: done("All three are done."), spent: 0.21,
        trail: [...budgetGood.trail.slice(0, 4), back("Scout"), out("Scribe", 2), back("Scribe"), out("Warden", 3), back("Warden")] }),
      // It is marked over budget, but the remaining quests still went out.
      but(budgetGood, "the last step never started", { trail: [...budgetGood.trail, out("Scribe", 2), back("Scribe", "over_budget"), out("Warden", 3), back("Warden", "over_budget")] }),
      // It stops without a word about why.
      but(budgetGood, "the answer says the budget stopped it", { result: { status: "over_budget", text: "I'll have the Scout read the handbook first." } }),
      // Nothing is spent because nothing is done, and it is called finished.
      but(budgetGood, "a run that wasn't stopped did the work", { result: done("All three are done."), spent: 0, trail: [] }),
    ],
  },
};

export const LOOP_CASES: EvalCase[] = [planOrder, rightCrew, reviewAfterChange, askBeforePlan, resumeNoRepeat, resumeRestored, fixAfterCheck, budgetStop];
