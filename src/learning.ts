// The background review: while a run goes, a copy of it is asked what's worth keeping.
//
// Off unless you turn it on (Settings → Skills → Learning). With it on, every N tool calls of a
// run (10 unless you change it) the run is forked:
// - The fork sends the run's own request again: the same system prompt, the same tools, the same
//   model, and a snapshot of the conversation, with one more piece of text at the end (the review
//   prompt). Everything up to that text is byte for byte what the run itself sent, so it's read
//   back from the prompt cache and the review pays full price only for its own few words.
// - It can only propose. Its tool calls never reach the run's tools: they go through reviewTool()
//   below, which knows four names. remember and project_remember become suggestions in the memory
//   queue (keeping.ts), propose_skill becomes a draft in the skills queue (forge.ts), read_file
//   reads under skills/ and nowhere else. Anything else is refused. Nothing is applied until you approve it.
// - It never touches the live run: it works on a copy of the transcript, in the background, and
//   the run doesn't wait for it. A review that fails is logged and forgotten.
// - What it cost is written to camp/review-log.jsonl and shown in Usage, apart from the runs.
// Ported from Hermes Agent's background review (agent/background_review.py; MIT).

import type Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { appendLine, readJsonl } from "./atomic.js";
import { emit } from "./events.js";
import { CREW_IDS } from "./crew.js";
import { learning } from "./settings.js";
import type { Tool } from "./tools.js";

export const REVIEW_LOG = posix.join("camp", "review-log.jsonl");
export const MAX_REVIEW_TURNS = 4;     // model replies in one review, tool round trips included
export const MAX_MEMORY_PER_REVIEW = 3;
export const MAX_SKILLS_PER_REVIEW = 1;
// The only tools a review's calls are answered for. Everything else in the run's list is there so
// the request matches the run's (and its cache), not to be used.
export const REVIEW_TOOLS = ["remember", "project_remember", "propose_skill", "read_file"] as const;

type Message = Anthropic.MessageParam;
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// ---------- When ----------
// Pure: is a review due? calls: the run's tool calls so far. reviewedAt: the count when the last
// review set out. every: the interval (null or 0: reviews are off).
export function reviewDue(calls: number, reviewedAt: number, every: number | null): boolean {
  return !!every && every > 0 && calls - reviewedAt >= every;
}
// The interval for a run starting now, or null when reviews are off.
export const reviewEvery = (): number | null => { const l = learning(); return l.review ? l.every : null; };

// ---------- What it's asked ----------
export type ReviewScope = {
  agent: string;                 // the crew member whose run this is
  name: string;                  // their name, for the feed
  toolNames: string[];           // the tools in the run's own list
  project?: string;              // the project the run is filed under, when it's a real one
  run?: string;                  // the expedition, so a suggestion can say where it came from
};

const ROUTING =
  "Where a fact goes. There are separate places, and each fact goes to exactly ONE of them, never two: " +
  "the same line in two places crowds out what matters in both, and a line in the wrong place is where the next run won't look.\n" +
  "- About the USER (who they are, how they like answers, how they work, what they expect of you whoever they're working with): remember with about \"user\".\n" +
  "- About the ENVIRONMENT you work in (tool quirks, conventions, config gotchas, paths and commands that matter): " +
  "project_remember when it's only true of this project and that tool is in your list; otherwise remember (about \"me\").\n" +
  "Save only what this conversation supports: a message from the user or a tool result you can point to. " +
  "Never infer the user's traits, skill, role, mood or preferences from the topic, their tone or the tools used. " +
  "Never turn a one-off request into a standing preference unless they marked it general (\"always\", \"from now on\", \"remember\") " +
  "or stated a standing like or dislike (\"I hate X\", \"stop doing Y\"). If unsure, leave it out: a wrong fact misleads every later run.";

const SKILL_SHAPE =
  "What a skill is: the instructions for doing a CLASS of task the most efficient and correct way, to this user's specifications. " +
  "A later run should be able to follow it and get it right the first time.\n" +
  "- Class-level, not this task: name it for the kind of work, never for today's ticket, error message or file.\n" +
  "- Procedure first: the steps in the order they're done, with the concrete commands, tool calls and decision points. A lesson or pitfall sits at the step it affects.\n" +
  "- A pitfall is a rule that generalises, plus one clause of WHY (the mechanism), in the imperative. " +
  "\"Search the tests for the symbol before changing a helper's signature: hand-written mocks keep the old shape and fail where you didn't look.\" Not a story of what happened here.\n" +
  "- No PR or issue numbers, dates, ticket ids or quoted user text: the rule must stand without the incident behind it.\n" +
  "- The same lesson learned twice is ONE rule. If a skill already covers this kind of work, read its SKILL.md (read_file) and propose a better version of THAT skill under the same owner and name, with the wrong sentence fixed in place, not a second skill beside it.\n" +
  "- Don't restate what's always loaded anyway (project instructions, a tool's own description).";

const NEVER =
  "Never capture, as memory or as a skill (these harden into rules that bite later, when the environment has changed):\n" +
  "- Failures the environment caused: a missing program, an uninstalled package, credentials not set up, a path that moved. The user can fix those; they aren't lasting rules.\n" +
  "- Claims that a tool or feature doesn't work. They turn into refusals quoted long after the problem is gone. If a tool failed because of setup, capture the FIX (the install command, the setting), never \"this tool doesn't work\".\n" +
  "- A passing error that went away before the end. If trying again worked, the lesson is to try again, not the failure.\n" +
  "- The story of one task. Being asked for something once doesn't make it a class of work.\n" +
  "- Dead ends that were never resolved. If nothing that was tried worked, don't write the attempts up as a method: say there's nothing to save.";

// The text added at the end of the snapshot. already: what earlier reviews of this same run proposed.
export function reviewPrompt(scope: ReviewScope, already: string[] = []): string {
  const has = (name: string) => scope.toolNames.includes(name);
  const ways: string[] = [];
  if (has("remember")) ways.push("remember (one line, mode \"append\")");
  if (has("project_remember") && scope.project) ways.push("project_remember (one line, mode \"append\")");
  if (has("propose_skill")) ways.push("propose_skill");
  if (has("read_file")) ways.push("read_file, for files under skills/ only");
  const block =
    "<skill_proposal>\nowner: " + ["shared", ...CREW_IDS].join(" | ") + "\nname: kebab-case-name\ndescription: one line saying when to use it\nreason: one or two sentences for the user\n---\nThe SKILL.md body in Markdown.\n</skill_proposal>";
  return [
    "[Learning review. This is a side copy of the conversation above, made by the camp, not a message from the user. " +
      "The work itself carries on elsewhere: do NOT continue it, answer the user, or touch any file.]",
    "Look back over the conversation and decide whether anything in it is worth keeping for later runs. " +
      "Whatever you put forward here is only a PROPOSAL: it waits in a queue until the user approves it.",
    `## What you can do\nOnly these calls are answered: ${ways.join("; ") || "none"}. Every other tool is refused, so don't call one and don't try again if you do. Don't search the web.` +
      (has("propose_skill") ? "" : `\nTo propose a skill, end your reply with one block in exactly this form:\n${block}`) +
      `\nAt most ${MAX_MEMORY_PER_REVIEW} memory lines and ${MAX_SKILLS_PER_REVIEW} skill. Most stretches of work leave nothing worth keeping: then reply "Nothing to save." and stop. That's a good answer, not a failure.`,
    `## Memory\n${ROUTING}`,
    `## Skills\n${SKILL_SHAPE}\nPropose one when a technique, fix or way of working came out of this that wasn't obvious and would be needed again, or when the user corrected how a kind of task is done ` +
      "(a correction to how a task is done belongs in the skill for that task, not in memory, and never in both).",
    `## ${NEVER}`,
    already.length ? `## Already put forward from this run (don't repeat them)\n${already.map((a) => `- ${a}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

// The snapshot with the prompt added. It goes on the end of the last user message (which holds
// the tool results the run is about to send too), so everything before it is what the run sends.
export function withPrompt(snapshot: Message[], prompt: string): Message[] {
  const out = [...snapshot];
  const last = out[out.length - 1];
  const block = { type: "text" as const, text: prompt };
  if (last?.role === "user") {
    const content = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : [...last.content];
    out[out.length - 1] = { role: "user", content: [...content, block] };
  } else out.push({ role: "user", content: [block] });
  return out;
}

// ---------- What it may do ----------
export type ReviewOutcome = { memory: string[]; skills: string[]; refused: string[]; read: Set<string> };
export const emptyOutcome = (): ReviewOutcome => ({ memory: [], skills: [], refused: [], read: new Set() });
const oneLine = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const refusal = (name: string) =>
  `Refused: ${name} isn't available in a learning review. Only ${REVIEW_TOOLS.join(", ")} are answered here. Do not retry.`;

// The two queues are reached as they're needed, not when this file loads: the agent loads this
// file, and both of them (through the roster and the small model) load the agent.
async function proposeMemory(where: string, text: string, scope: ReviewScope, out: ReviewOutcome): Promise<string> {
  if (out.memory.length >= MAX_MEMORY_PER_REVIEW) return `Refused: a review puts forward at most ${MAX_MEMORY_PER_REVIEW} memory lines. Do not retry.`;
  const line = oneLine(text).slice(0, 400);
  if (!line) return "Nothing to save.";
  const { proposeKeeps } = await import("./keeping.js");
  const added = proposeKeeps([{ where, text: line }], scope.run);
  if (!added.length) return "That's already kept, or already waiting for the user. Nothing was added.";
  out.memory.push(`${where}: ${line}`);
  return "Proposed. It waits for the user to approve it; it is NOT in memory yet.";
}

async function proposeSkillDraft(input: any, scope: ReviewScope, out: ReviewOutcome): Promise<string> {
  if (out.skills.length >= MAX_SKILLS_PER_REVIEW) return `Refused: a review puts forward at most ${MAX_SKILLS_PER_REVIEW} skill. Do not retry.`;
  const owner = oneLine(input?.owner), name = oneLine(input?.name);
  const key = `${owner}/${name}`;
  // A skill that exists is replaced only by something written with it in view.
  if (existsSync(posix.join("skills", owner, name, "SKILL.md")) && !out.read.has(key))
    return `Refused: ${key} already exists. Read skills/${key}/SKILL.md first (read_file), then propose the improved version once.`;
  const { draftSkill } = await import("./forge.js");
  const done = draftSkill({ owner, name, description: String(input?.description ?? ""), instructions: String(input?.instructions ?? ""),
    reason: oneLine(input?.reason) || "Came out of a learning review.", by: `${scope.agent} (learning review)` });
  if (!done.ok) return done.error;
  out.skills.push(key);
  return `Proposed ${key}.${done.replaces ? " It would replace the current version." : ""} It is NOT active until the user approves it.`;
}

// One tool call of a review. This is the whole of what a review can cause: a line in a queue, or
// a read under skills/. name is the tool's own name (no mcp__camp__ prefix).
export async function reviewTool(name: string, input: any, scope: ReviewScope, out: ReviewOutcome): Promise<{ text: string; refused: boolean }> {
  const no = (text: string) => { out.refused.push(name); return { text, refused: true }; };
  const said = (text: string) => ({ text, refused: text.startsWith("Refused") });
  if (!(REVIEW_TOOLS as readonly string[]).includes(name) || !scope.toolNames.includes(name)) return no(refusal(name));
  if (name === "remember") {
    if ((input?.mode ?? "append") !== "append") return no("Refused: a review can only add one line (mode \"append\"). Do not retry.");
    return said(await proposeMemory(input?.about === "user" ? "about" : `agent:${scope.agent}`, String(input?.entry ?? "").split("\n")[0], scope, out));
  }
  if (name === "project_remember") {
    if (!scope.project) return no("Refused: this run isn't filed under a project. Use remember instead, once.");
    if ((input?.mode ?? "append") !== "append") return no("Refused: a review can only add one line (mode \"append\"). Do not retry.");
    return said(await proposeMemory(`project:${scope.project}`, String(input?.entry ?? "").split("\n")[0], scope, out));
  }
  if (name === "propose_skill") return said(await proposeSkillDraft(input, scope, out));
  // read_file: a live skill's own files, to see what's there before proposing a better version.
  const path = posix.normalize(String(input?.path ?? "").replace(/\\/g, "/")).replace(/^\.\//, "");
  const m = path.match(/^skills\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/[^\0]+$/);
  if (!m || path.split("/").includes("..")) return no("Refused: a learning review reads files under skills/<owner>/<name>/ only. Do not retry.");
  if (!existsSync(path)) return { text: `There's no file ${path}.`, refused: false };
  out.read.add(`${m[1]}/${m[2]}`);
  return { text: readFileSync(path, "utf8").slice(0, 30_000), refused: false };
}

// A skill written out in the reply itself, for a crew member who has no propose_skill tool.
export function skillBlocks(text: string): { owner: string; name: string; description: string; reason: string; instructions: string }[] {
  const out = [];
  for (const m of text.matchAll(/<skill_proposal>\s*([\s\S]*?)\s*<\/skill_proposal>/g)) {
    const cut = m[1].search(/^---\s*$/m);
    if (cut < 0) continue;
    const head = m[1].slice(0, cut), body = m[1].slice(cut).replace(/^---\s*\n?/, "").trim();
    const field = (key: string) => head.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
    if (field("owner") && field("name") && body) out.push({ owner: field("owner"), name: field("name"), description: field("description"), reason: field("reason"), instructions: body });
  }
  return out;
}

// ---------- The log ----------
export type ReviewEntry = {
  time: string; agent: string; model: string; runtime: "api" | "claude-code"; run?: string; project?: string;
  turns: number; usage: Usage; costUsd: number; memory: number; skills: number; refused: number; error?: string;
};
export function logReview(e: ReviewEntry) {
  try { appendLine(REVIEW_LOG, JSON.stringify(e)); emit({ type: "changed", what: "log" }); } catch { /* the review still happened */ }
}
export function reviews(): ReviewEntry[] {
  return readJsonl<ReviewEntry>(REVIEW_LOG).filter((e) => e && typeof e.time === "string" && typeof e.costUsd === "number");
}

// ---------- One review, on the run's own request ----------
export type ReviewReply = { content: any[]; stop_reason: string | null; usage: Usage; costUsd: number };
export type ReviewRun = ReviewScope & {
  model: string;
  // Send the run's own request with these messages in place of the live ones.
  ask: (messages: Message[]) => Promise<ReviewReply>;
  spend?: (usd: number) => void;   // onto the expedition's shared tally
  overBudget?: () => boolean;
  signal?: AbortSignal;
};
export type ReviewResult = ReviewEntry & { proposed: string[] };

const said = (e: unknown) => String((e as any)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
export const reviewNotice = (scope: ReviewScope, out: ReviewOutcome) => {
  const n = out.memory.length + out.skills.length;
  if (n) emit({ type: "notice", who: scope.name, emoji: "🔎", depth: 0,
    text: `🔎 Learning review of ${scope.name}'s run put ${n === 1 ? "one thing" : `${n} things`} forward for you to approve` +
      `${out.skills.length ? ` (a skill: ${out.skills.join(", ")})` : ""}.` });
  if (out.memory.length) emit({ type: "changed", what: "memory" });
};

// snapshot: the run's transcript as it stood, already a copy. It's read, never written to.
export async function runReview(r: ReviewRun, snapshot: Message[], already: string[] = []): Promise<ReviewResult> {
  const out = emptyOutcome();
  const usage = zero();
  let costUsd = 0, turns = 0, error: string | undefined;
  const messages = withPrompt(snapshot, reviewPrompt(r, already));
  try {
    while (turns < MAX_REVIEW_TURNS) {
      if (r.signal?.aborted || r.overBudget?.()) break;
      const reply = await r.ask(messages);
      turns++;
      costUsd += reply.costUsd;
      r.spend?.(reply.costUsd);
      for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += reply.usage[k] || 0;
      for (const b of reply.content) {
        if (b?.type !== "text") continue;
        await proposeFromText(String(b.text), r, out);
      }
      const uses = reply.content.filter((b) => b?.type === "tool_use");
      if (!uses.length || reply.stop_reason !== "tool_use") break;
      messages.push({ role: "assistant", content: reply.content });
      const results = [];
      for (const u of uses) {
        const done = await reviewTool(String(u.name), u.input, r, out).catch((e) => ({ text: `Error: ${said(e)}`, refused: false }));
        results.push({ type: "tool_result" as const, tool_use_id: u.id, content: done.text, ...(done.refused ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    if (!r.signal?.aborted) error = said(e);
  }
  const entry: ReviewEntry = { time: new Date().toISOString(), agent: r.agent, model: r.model, runtime: "api", ...(r.run ? { run: r.run } : {}), ...(r.project ? { project: r.project } : {}),
    turns, usage, costUsd, memory: out.memory.length, skills: out.skills.length, refused: out.refused.length, ...(error ? { error } : {}) };
  if (turns) logReview(entry);
  reviewNotice(r, out);
  return { ...entry, proposed: [...out.memory, ...out.skills.map((s) => `skill ${s}`)] };
}
// (A block is a draft like any other: the same limit, and the same look at what it would replace.)
export async function proposeFromText(text: string, scope: ReviewScope, out: ReviewOutcome) {
  // One that would replace a skill the review never read is dropped, like a call would be.
  for (const s of skillBlocks(text)) await proposeSkillDraft(s, scope, out);
}

// ---------- The same, on a Claude subscription (through Claude Code) ----------
// Claude Code keeps no session we can fork, so its review is a short run of its own: the same
// system prompt, model and tool list (so that much of the prompt is shared), with the transcript
// so far told to it in the task. Every tool it's handed answers through reviewTool() and nothing else.
export function reviewTools(tools: Tool[], scope: ReviewScope, out: ReviewOutcome): Tool[] {
  return tools.map((t) => {
    if (!t.run || !("name" in t.def)) return t; // a tool the runtime runs itself (web search): refused where it's asked for (mayUse)
    const name = t.def.name;
    return { def: t.def, run: async (input: any) => (await reviewTool(name, input, scope, out)).text };
  });
}
// What a transcript says, short enough to hand over: the request, then each step and what came back.
export function digest(task: string, messages: Message[], limit = 60_000): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") { lines.push(`${m.role === "user" ? "User" : "You"}: ${m.content.slice(0, 4000)}`); continue; }
    for (const b of m.content as any[]) {
      if (b?.type === "text") lines.push(`${m.role === "user" ? "User" : "You"}: ${String(b.text).slice(0, 4000)}`);
      else if (b?.type === "tool_use") lines.push(`You called ${String(b.name).replace(/^mcp__camp__/, "")}: ${JSON.stringify(b.input ?? {}).slice(0, 600)}`);
      else if (b?.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content : (Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? "").join("\n") : "");
        lines.push(`It returned${b.is_error ? " (an error)" : ""}: ${text.slice(0, 1500)}`);
      }
    }
  }
  let body = lines.join("\n");
  if (body.length > limit) body = `(earlier steps left out)\n${body.slice(-limit)}`; // the latest steps are the ones not yet reviewed
  return `## The request\n${task.slice(0, 6000)}\n\n## The work so far\n${body || "(nothing yet)"}`;
}

// ---------- One run's reviews ----------
// Counts the run's tool calls and sets a review off each time the interval comes round. One at a
// time: a review that's due while another is still out waits for the next tool call after it's back.
const inFlight = new Set<Promise<unknown>>();
export class Reviewer {
  private calls = 0;
  private reviewedAt = 0;
  private busy = false;
  private proposed: string[] = [];
  reviews = 0;
  // every: the interval, or null when reviews are off. launch: do one review of this snapshot.
  constructor(private every: number | null, private launch: (snapshot: Message[], already: string[]) => Promise<{ proposed: string[] } | null>) {}
  // n more tool calls were made. snapshot is only called when a review sets out.
  note(n: number, snapshot: () => Message[]) {
    this.calls += n;
    if (this.busy || !reviewDue(this.calls, this.reviewedAt, this.every)) return;
    this.reviewedAt = this.calls;
    this.busy = true;
    this.reviews++;
    let shot: Message[];
    try { shot = snapshot(); } catch { this.busy = false; return; }
    const going: Promise<unknown> = this.launch(shot, [...this.proposed])
      .then((done) => { if (done) this.proposed.push(...done.proposed); }, () => { /* a review never fails the run */ })
      .finally(() => { this.busy = false; inFlight.delete(going); });
    inFlight.add(going);
  }
}
// For tests, and for anything that must not leave a review behind: wait for the ones under way.
export async function reviewsSettled(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}
