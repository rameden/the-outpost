// The loop cases, run for real but against a scripted stand-in for the API: no paid model, no key,
// and none of your camp (EVAL_PLAIN leaves your settings out). Each case is run the way the eval
// runner runs it (evals/case.ts in its own process), once with a model that does the right thing
// and once with one that doesn't, so both the setup a case needs (a linked folder with checks, a
// cut-off task, a budget, a question answered) and its rules are shown to work end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO } from "./helpers/sandbox.ts";
import { startFakeApi, isFirstTurn, lastToolResults, systemText, whoAsks, type Reply, type Seen } from "./helpers/fake-api.ts";

const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
type Check = { name: string; required: boolean; pass: boolean; detail: string };
type Result = { id: string; pass: boolean; status: string; cost: number; tokens: { in: number; out: number }; models: string[]; checks: Check[]; reply: string; declined: { kind: string; title: string; body: string }[] };

async function runCase(id: string, script: (body: any) => Reply): Promise<{ r: Result; seen: Seen[] }> {
  const api = await startFakeApi(script);
  try {
    const out = await new Promise<string>((ok) => {
      const child = spawn(process.execPath, [TSX, join(REPO, "evals/case.ts"), id], {
        cwd: REPO, stdio: ["ignore", "pipe", "pipe"], timeout: 90_000,
        env: { ...process.env, ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: "test-key-not-real", CAMP_RUNTIME: "api", EVAL_PLAIN: "1", EVAL_NO_JUDGE: "1", EVAL_SET: "{}" },
      });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("close", () => ok(text));
    });
    const line = out.split("\n").find((l) => l.startsWith("@@RESULT@@"));
    assert.ok(line, `${id} printed no result:\n${out.slice(-1500)}`);
    return { r: JSON.parse(line.slice(10)), seen: api.seen };
  } finally {
    await api.close();
  }
}
const check = (r: Result, name: string) => r.checks.find((c) => c.name === name) ?? assert.fail(`${r.id} has no check called "${name}"`);
const failed = (r: Result) => r.checks.filter((c) => c.required && !c.pass).map((c) => c.name);
const passes = (r: Result) => assert.ok(r.pass, `${r.id} should pass: ${r.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`).join("; ")} · ${r.status}: ${r.reply}`);
// The Quartermaster's turns, one after another; a crew member uses a tool, then reports.
const turns = (...replies: Reply[]) => { let n = 0; return (): Reply => replies[Math.min(n++, replies.length - 1)]; };
const dispatch = (adventurer: string, step?: number) => ({ name: "dispatch", input: { adventurer, brief: "Do your part.", ...(step ? { step } : {}) } });
const write = (path: string, content: string) => ({ name: "write_file", input: { path, content } });
const firstMessage = (b: any): string => { const c = b.messages[0].content; return typeof c === "string" ? c : c.map((x: any) => x.text ?? "").join("\n"); };

test("plan order: a plan that marks what waits passes; a flat list is turned down", async () => {
  const run = (plan: string, command = "node tools/count-teams.mjs") => {
    const qm = turns(
      { tools: [{ name: "submit_plan", input: { plan } }] },
      { tools: [dispatch("scout", 1), dispatch("artificer", 2)] },
      { tools: [dispatch("scribe", 3)] },
      { text: "Hosting cost $40 per active team last month. The note is saved." });
    return runCase("loop-plan-order", (b) => {
      const who = whoAsks(b);
      if (who === "Quartermaster") return qm();
      if (!isFirstTurn(b)) return { text: `${who}: done.` };
      if (who === "Scout") return { tools: [{ name: "read_file", input: { path: "docs/costs.md" } }] };
      if (who === "Artificer") return { tools: [{ name: "bash", input: { command } }] };
      return { tools: [write("camp/agents/scribe/outputs/cost-per-team.md", "Hosting cost per active team last month: $40.\n")] };
    });
  };
  const ordered = "1. Scout: find last month's hosting bill\n2. Artificer: count the active teams\n3. Scribe: save the sentence (after 1, 2)";
  const [good, flat, more] = await Promise.all([
    run(ordered),
    run("1. Scout: find last month's hosting bill\n2. Artificer: count the active teams\n3. Scribe: save the sentence", "node ./tools/count-teams.mjs 2>&1"),
    run(ordered, "node tools/count-teams.mjs && git push"),
  ]);
  passes(good.r);
  assert.ok(check(good.r, "the two lookups were out at the same time").pass);
  // The plan was put up for approval and the stand-in said yes; the count really ran (46 of 60).
  assert.ok(good.seen.some((s) => s.who === "Quartermaster" && /approved the plan/.test(lastToolResults(s.body))));
  assert.ok(good.seen.some((s) => s.who === "Artificer" && /46 active teams/.test(lastToolResults(s.body))), "the approved command ran");
  assert.deepEqual(failed(flat.r), ["the plan makes the writing wait for both lookups"]);
  // The same command said another way is approved too; one with something added is not, and the result says what was refused.
  assert.ok(flat.seen.some((s) => s.who === "Artificer" && /46 active teams/.test(lastToolResults(s.body))), "the command with ./ and 2>&1 ran");
  assert.deepEqual(good.r.declined, []);
  assert.deepEqual(more.r.declined.map((d) => [d.kind, d.body]), [["shell", "node tools/count-teams.mjs && git push"]]);
  assert.ok(more.seen.some((s) => s.who === "Artificer" && /declined to run/.test(lastToolResults(s.body))));
});

test("ask before a plan: the question is answered with the case's answer; guessing is turned down", async () => {
  const PATH = "camp/agents/scribe/outputs/pricing.md";
  const scribe = (b: any): Reply => (isFirstTurn(b) ? { tools: [write(PATH, "New pricing from January.\nOne plan: $99 per seat, billed yearly.\nEvery feature is included.\n")] } : { text: "Saved." });
  const plan = { tools: [{ name: "submit_plan", input: { plan: "1. Scribe: write the announcement" } }] };
  const rest = [plan, { tools: [dispatch("scribe")] }, { text: "Saved the announcement of the annual plan." }];
  const asks = turns({ tools: [{ name: "ask_user", input: { question: "Which pricing draft did you decide on, A or B?" } }] }, ...rest);
  const guesses = turns(...rest);
  const [good, bad] = await Promise.all([
    runCase("loop-ask-before-plan", (b) => (whoAsks(b) === "Quartermaster" ? asks() : scribe(b))),
    runCase("loop-ask-before-plan", (b) => (whoAsks(b) === "Quartermaster" ? guesses() : scribe(b))),
  ]);
  passes(good.r);
  assert.ok(good.seen.some((s) => s.who === "Quartermaster" && /Draft B, the annual one\./.test(lastToolResults(s.body))), "the answer went back to the Quartermaster");
  assert.ok(check(good.r, "asked once").pass && check(good.r, "three lines").pass);
  assert.deepEqual(failed(bad.r), ["asked which draft before planning or sending anyone"]);
  assert.match(check(bad.r, "asked which draft before planning or sending anyone").detail, /never asked/);
});

test("fix after a failed check: the linked folder's checks run, and a red ending is turned down", async () => {
  const FEES = "links/ledger/src/fees.mjs";
  const fee = "/** The card fee on an amount, in cents. */\nexport function cardFee(cents) {\n  return Math.round(cents * 0.029) + 30;\n}\n";
  const bare = `${fee}\nexport function shipping(cents) {\n  return cents >= 5000 ? 0 : 500;\n}\n`;
  const documented = `${fee}\n/** Shipping in cents: free at 5000 or more. */\nexport function shipping(cents) {\n  return cents >= 5000 ? 0 : 500;\n}\n`;
  const qm = () => turns({ tools: [dispatch("artificer")] }, { text: "Added shipping(cents); the folder's checks pass." });
  const sentBack = (b: any) => firstMessage(b).includes("at least one failed");
  const run = (fixes: boolean) => {
    const q = qm();
    return runCase("loop-fix-after-check", (b) => {
      if (whoAsks(b) === "Quartermaster") return q();
      if (!isFirstTurn(b)) return { text: "Added shipping." };
      return { tools: [write(FEES, sentBack(b) && fixes ? documented : bare)] };
    });
  };
  const [good, stuck] = await Promise.all([run(true), run(false)]);
  passes(good.r);
  assert.ok(check(good.r, "a check failed first, so the way back was used").pass, "the first try broke the folder's lint rule");
  assert.ok(good.seen.some((s) => s.who === "Quartermaster" && systemText(s.body).includes("links/ledger")), "the linked folder is in the prompt");
  const sent = good.seen.find((s) => s.who === "Artificer" && sentBack(s.body));
  assert.match(firstMessage(sent!.body), /✗ node tools\/lint\.mjs/, "the failing check's output went back with the work");
  assert.equal(stuck.r.pass, false);
  assert.ok(failed(stuck.r).includes("the run ended with every check passing"), failed(stuck.r).join(", "));
  assert.ok(failed(stuck.r).includes("the folder's checks pass now"));
  assert.ok(check(stuck.r, "a failed check sent the work back").pass, "it was sent back; it just didn't fix it");
});

test("review after a change: the Warden after the last change passes; a change after the review is turned down", async () => {
  const CART = "links/shop/src/cart.mjs";
  const fixed = "// The total for a cart: every item's price times how many of it there are.\nexport function cartTotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n";
  const crew = (b: any): Reply => (!isFirstTurn(b) ? { text: "Done." } : whoAsks(b) === "Warden" ? { tools: [{ name: "read_file", input: { path: CART } }] } : { tools: [write(CART, fixed)] });
  const run = (...qm: Reply[]) => { const next = turns(...qm); return runCase("loop-review-after-change", (b) => (whoAsks(b) === "Quartermaster" ? next() : crew(b))); };
  const [good, forgot, late] = await Promise.all([
    run({ tools: [dispatch("artificer")] }, { tools: [dispatch("warden")] }, { text: "Fixed, and the Warden's review found nothing to change." }),
    // The Quartermaster reports with no review: the camp sends the Warden itself before the summary.
    run({ tools: [dispatch("artificer")] }, { text: "Fixed." }),
    // Reviewed, and then changed again: what the user gets was never looked at.
    run({ tools: [dispatch("artificer")] }, { tools: [dispatch("warden")] }, { tools: [dispatch("artificer")] }, { text: "Fixed and reviewed." }),
  ]);
  const own = "the Quartermaster sent the Warden, not the camp in its place";
  passes(good.r);
  assert.ok(check(good.r, own).pass);
  assert.ok(good.seen.some((s) => s.who === "Quartermaster" && /Warden/.test(systemText(s.body)) && /review/i.test(systemText(s.body))), "the run was told to have changes reviewed");

  passes(forgot.r);
  assert.equal(forgot.seen.filter((s) => s.who === "Warden").length, 2, "the camp's own review ran: the Warden read the file, then reported");
  assert.match(check(forgot.r, own).detail, /the camp had to send the Warden itself/);

  assert.deepEqual(failed(late.r), ["the Warden was sent after the last change"]);
  assert.match(check(late.r, "the Warden was sent after the last change").detail, /changed again after the review/);
  assert.ok(check(late.r, "the fix works").pass, "the rule that failed is the review, not the fix");
});

test("resume: what the cut-off run did is reused; a repeat that really runs is turned down", async () => {
  const receipt = write("app/receipt.md", "Order 7: notification sent.\n");
  const run = (again: Record<string, unknown>) => {
    const artificer = turns({ tools: [{ name: "bash", input: again }] }, { tools: [receipt] }, { text: "The notification had gone out; the receipt is written." });
    return runCase("loop-resume-no-repeat", () => artificer());
  };
  // The same call as before the cut-off is recognised; the same command put another way is a new
  // call, so it is asked for, approved, and sends the notification a second time.
  const [good, twice] = await Promise.all([run({ command: "node app/notify.cjs" }), run({ command: "node app/notify.cjs", cwd: "." })]);
  passes(good.r);
  assert.ok(check(good.r, "the recorded result was reused, or the command wasn't asked for again").pass);
  const told = (s: Seen) => `${systemText(s.body)}\n${JSON.stringify(s.body.messages)}`;
  assert.ok(good.seen.some((s) => /cut off before it finished/.test(told(s)) && /Send the order 7 notification/.test(told(s))), "the earlier task is in the conversation it replies to");
  assert.ok(good.seen.some((s) => /sent/.test(lastToolResults(s.body))), "the recorded result came back as the tool's result");
  assert.deepEqual(failed(twice.r), ["the notification went out exactly once"]);
  assert.match(check(twice.r, "the notification went out exactly once").detail, /2 notifications sent/);
});

test("budget: a run that goes over its one cent stops, and its cost and tokens are counted", async () => {
  const { r, seen } = await runCase("loop-budget-stop", (b) => (whoAsks(b) === "Scout" ? { text: "should not run" }
    : { text: "Sending the Scout first.", tools: [dispatch("scout")], usage: { input_tokens: 2_000_000, output_tokens: 10 } }));
  passes(r);
  assert.equal(r.status, "over_budget");
  assert.ok(check(r, "the budget was reached, so the stop was used").pass);
  assert.equal(seen.filter((s) => s.who === "Scout").length, 0, "nobody was sent once the budget was gone");
  assert.match(r.reply, /\$0\.01 budget/);
  // What a baseline is made of.
  assert.ok(r.cost > 0.01, `cost ${r.cost}`);
  assert.ok(r.tokens.in >= 2_000_000 && r.tokens.out > 0, JSON.stringify(r.tokens));
  assert.ok(r.models.length >= 1);
});

test("parallel writers: two sent at once work in worktrees and both land; one after another, or the same lines twice, is turned down", async () => {
  const TAX = "links/depot/src/tax.mjs", DOC = "links/depot/docs/tax.md";
  const tax = "export function tax(cents) {\n  return Math.round(cents * 0.2);\n}\n";
  const run = (qm: Reply[], scribeWrites = DOC) => {
    const next = turns(...qm);
    return runCase("loop-parallel-writers", (b) => {
      const who = whoAsks(b);
      if (who === "Quartermaster") return next();
      if (!isFirstTurn(b) || who === "Warden") return { text: `${who}: done.` };
      return { tools: [who === "Artificer" ? write(TAX, tax) : write(scribeWrites, scribeWrites === DOC ? "# tax(cents)\n\nTwenty percent, rounded to the cent.\n" : "export const tax = () => 0;\n")] };
    });
  };
  const said = { text: "Both are in the depot folder and its check passes." };
  const [good, inTurn, clash] = await Promise.all([
    run([{ tools: [dispatch("artificer"), dispatch("scribe")] }, said]),
    run([{ tools: [dispatch("artificer")] }, { tools: [dispatch("scribe")] }, said]),
    run([{ tools: [dispatch("artificer"), dispatch("scribe")] }, said], TAX),
  ]);
  passes(good.r);
  assert.ok(check(good.r, "each quest's checks ran before it was merged").pass);
  assert.ok(good.seen.some((s) => s.who === "Scribe" && /your own worktree/.test(systemText(s.body))), "each writer is told it has a worktree");
  assert.deepEqual(failed(inTurn.r), ["they worked side by side, each in its own worktree"]);
  assert.ok(check(inTurn.r, "both changes are in the folder").pass, "the work is done; it just wasn't done side by side");
  assert.ok(failed(clash.r).includes("nothing was left on a branch"), failed(clash.r).join(", "));
  assert.match(check(clash.r, "nothing was left on a branch").detail, /outpost\/quest-[0-9a-f]{8}/);
});
