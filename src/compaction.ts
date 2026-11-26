// Keeping a long run inside its model's context. When the request nears a set share of the
// context (settings: "compactAt"), the transcript is made smaller in two steps:
//   1. Old tool results are cleared in place: no model call. The newest few stay, and so does
//      everything submit_plan and remember said. Often that's enough.
//   2. If it isn't, the middle of the transcript is replaced by a summary. The task (the first
//      message) and the latest turns stay word for word; the cut never falls between a tool call
//      and its result; submit_plan and remember calls in the middle are kept as they were. The
//      summary is written on the cheapest route (small.ts) in fixed sections, and a later
//      compaction updates it instead of starting again. If the summariser fails or stalls, a
//      summary is put together from the transcript itself, so the run never waits on it.
//
// Beside the API's own clearing (agent.ts, CONTEXT_MANAGEMENT): that drops old tool results on the
// server from 120k tokens on, and step 1 does the same to the copy kept here, so the two agree.
// What neither clears (the model's own words, the inputs of its calls) is what step 2 is for.
// The system prompt isn't touched, so its two cache breakpoints hold; the conversation's cache is
// rewritten once per compaction, and builds turn by turn again after it.

import type Anthropic from "@anthropic-ai/sdk";
import { measurePart } from "./routing.js";

type Msg = Anthropic.MessageParam;
type Block = { type: string; [k: string]: any };

export const KEPT_TOOLS = new Set(["submit_plan", "remember"]); // never cleared, never summarised away
export const CLEARED = "[Old tool output cleared to save context";
export const SUMMARY_MARK = "[Summary of the earlier part of this task.";
const SUMMARY_HEAD = `${SUMMARY_MARK} The messages it stands for were removed to keep the conversation within the model's context. ` +
  `It is your own record: carry on from it, don't redo what it lists as done, and open a file again if you need its exact contents.]`;
export const SECTIONS = ["Goal", "Constraints", "Progress", "Key decisions", "Relevant files", "Next steps", "Critical context"] as const;

const blocksOf = (m: Msg): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as Block[]));
const bare = (name: unknown) => String(name ?? "").replace(/^mcp__camp__/, "");
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (b?.type === "text" ? b.text : `[${b?.type ?? "content"}]`)).join("\n") : "");
export const tokensOf = (list: unknown[]): number => { let chars = 0, images = 0; for (const m of list) { const p = measurePart(m); chars += p.chars; images += p.images; } return Math.ceil(chars / 4) + images * 1_600; };
// Which tool each call id belongs to.
function toolNames(messages: Msg[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of messages) if (m.role === "assistant") for (const b of blocksOf(m)) if (b.type === "tool_use") names.set(String(b.id), bare(b.name));
  return names;
}

// ---------- Step 1: clear old tool results ----------
// The newest `keep` results stay whole; older ones over `minChars` become a one-line note.
// Messages that don't change are returned as they are (the same objects).
export function pruneToolResults(messages: Msg[], o: { keep?: number; minChars?: number } = {}): { messages: Msg[]; cleared: number } {
  const keep = o.keep ?? 8, minChars = o.minChars ?? 600;
  const names = toolNames(messages);
  let seen = 0, cleared = 0;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== "user" || typeof m.content === "string") continue;
    let changed = false;
    const next = (m.content as Block[]).slice();
    for (let j = next.length - 1; j >= 0; j--) {
      const b = next[j];
      if (b?.type !== "tool_result") continue;
      if (seen++ < keep) continue;
      const name = names.get(String(b.tool_use_id)) ?? "";
      if (KEPT_TOOLS.has(name)) continue;
      const size = measurePart(b.content);
      const text = textOf(b.content);
      if (text.startsWith(CLEARED) || (size.chars < minChars && !size.images)) continue;
      next[j] = { ...b, content: `${CLEARED}: ${name || "a tool"} returned ${size.chars.toLocaleString()} characters${size.images ? " and a picture" : ""}. Make the call again if you need it.]` };
      changed = true;
      cleared++;
    }
    if (changed) out[i] = { ...m, content: next as any };
  }
  return { messages: cleared ? out : messages, cleared };
}

// ---------- Step 2: where to cut ----------
// The head is the first message (the task, with any earlier summary in it). The tail is the latest
// turns, about `tailTokens` of them, and always starts at an assistant message: so the tool
// results that answer it come with it, and the results before it go with the calls they answer.
// Returns the index the tail starts at, or null when there's no middle worth summarising.
export function tailStart(messages: Msg[], tailTokens: number, minTail = 4): number | null {
  if (messages.length < minTail + 3 || messages[0].role !== "user") return null;
  let at = messages.length, used = 0;
  while (at > 1) {
    const size = tokensOf([messages[at - 1]]);
    if (messages.length - at >= minTail && used + size > tailTokens) break;
    used += size;
    at--;
  }
  while (at < messages.length && messages[at].role !== "assistant") at++; // never begin on tool results whose calls were cut
  if (at >= messages.length || at < 3) return null; // nothing kept, or a middle of under two messages
  return at;
}

// The submit_plan and remember calls in a stretch of messages, each with its result, as pairs of
// messages that can stand where the stretch was.
export function keptPairs(middle: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (let i = 0; i < middle.length; i++) {
    const m = middle[i];
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const uses = (m.content as Block[]).filter((b) => b.type === "tool_use" && KEPT_TOOLS.has(bare(b.name)));
    if (!uses.length) continue;
    const ids = new Set(uses.map((b) => String(b.id)));
    const next = middle[i + 1];
    const results = next?.role === "user" && Array.isArray(next.content) ? (next.content as Block[]).filter((b) => b.type === "tool_result" && ids.has(String(b.tool_use_id))) : [];
    const answered = new Set(results.map((b) => String(b.tool_use_id)));
    const calls = uses.filter((b) => answered.has(String(b.id)));
    if (calls.length) out.push({ role: "assistant", content: calls as any }, { role: "user", content: results as any });
  }
  return out;
}

// ---------- The summary ----------
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [+${(s.length - n).toLocaleString()} characters]` : s);
// A stretch of the transcript as words, for the summariser. When it's too long, its start and its end are kept.
export function renderForSummary(messages: Msg[], max = 80_000): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const b of blocksOf(m)) {
      if (b.type === "text" && b.text?.trim() && !b.text.startsWith(SUMMARY_MARK)) lines.push(`${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${clip(b.text.trim(), 3_000)}`);
      else if (b.type === "tool_use") lines.push(`CALL ${bare(b.name)}: ${clip(JSON.stringify(b.input ?? {}), 800)}`);
      else if (b.type === "tool_result") lines.push(`RESULT${b.is_error ? " (failed)" : ""}: ${clip(textOf(b.content).trim(), 1_000)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > max ? `${text.slice(0, max * 0.35)}\n[…part of the transcript is left out here…]\n${text.slice(-max * 0.65)}` : text;
}

export const SUMMARY_SYSTEM = `You keep the working notes of an AI agent part-way through a long task. You're given the task, the notes so far (if any), and the next stretch of its transcript, which is about to be removed from its context. Write the notes it will carry on from.

Use exactly these sections, in this order, each as a "## " heading:
## Goal
## Constraints
## Progress
### Done
### In progress
### Blocked
## Key decisions
## Relevant files
## Next steps
## Critical context

Rules:
- If there are notes so far, update them: keep what still holds, move finished items to Done, add what's new. Don't start again.
- Be specific: exact file paths, commands, names, numbers, error messages, and what each finished step produced. The agent can't see the transcript again.
- Constraints: what the user asked for or ruled out, and limits the agent found. Critical context: anything that would be costly to rediscover.
- Write "None." under a section with nothing to say. No preamble, nothing after the last section. Under 900 words.`;

export const validSummary = (s: string) => SECTIONS.every((h) => new RegExp(`^##\\s+${h}\\b`, "mi").test(s));

// With no summariser: the same sections, filled from the transcript itself.
export function fallbackSummary(task: string, previous: string | null, middle: Msg[]): string {
  const calls: string[] = [], files = new Set<string>(), failed: string[] = [];
  const names = toolNames(middle);
  let lastSaid = "";
  for (const m of middle) {
    for (const b of blocksOf(m)) {
      if (b.type === "tool_use") {
        calls.push(`${bare(b.name)} ${clip(JSON.stringify(b.input ?? {}), 160)}`);
        for (const k of ["path", "file_path", "file"]) if (typeof b.input?.[k] === "string") files.add(b.input[k]);
      } else if (b.type === "tool_result" && b.is_error) failed.push(`${names.get(String(b.tool_use_id)) ?? "a call"}: ${clip(textOf(b.content).trim(), 200)}`);
      else if (b.type === "text" && m.role === "assistant" && b.text?.trim()) lastSaid = b.text.trim();
    }
  }
  const list = (items: string[], none = "None.") => (items.length ? items.map((i) => `- ${i}`).join("\n") : none);
  return [
    `## Goal\n${clip(task.trim(), 1_500) || "See the first message."}`,
    `## Constraints\nNot summarised (the summariser wasn't available): go by the task above.`,
    `## Progress\n### Done\n${previous ? `Earlier notes:\n${clip(previous, 6_000)}\n\nSince then, these calls were made (latest last):\n` : "These calls were made (latest last):\n"}${list(calls.slice(-30))}\n### In progress\n${lastSaid ? clip(lastSaid, 800) : "Unknown."}\n### Blocked\n${list(failed.slice(-5))}`,
    `## Key decisions\nNot summarised.`,
    `## Relevant files\n${list([...files].slice(-40))}`,
    `## Next steps\nCarry on from the latest messages below. Check the state of a file before changing it again.`,
    `## Critical context\nThis summary was put together without a model, from the list of calls: it has no detail of what they returned.`,
  ].join("\n\n");
}

export type Summariser = (system: string, prompt: string) => Promise<string>;
export const SUMMARY_TIMEOUT_MS = 60_000;

export type Compacted = { messages: Msg[]; pruned: number; summarised: number; fallback: boolean; before: number; after: number };

// The transcript, made to fit. `limit`: the size (in estimated tokens, messages only) to get under.
// Returns null when nothing could be made smaller.
export async function compact(messages: Msg[], o: { limit: number; summarise: Summariser; timeoutMs?: number; keepResults?: number }): Promise<Compacted | null> {
  const before = tokensOf(messages);
  const step1 = pruneToolResults(messages, { keep: o.keepResults });
  let after = step1.cleared ? tokensOf(step1.messages) : before;
  // Enough room made without a model: leave it there.
  if (after <= o.limit * 0.8) return step1.cleared ? { messages: step1.messages, pruned: step1.cleared, summarised: 0, fallback: false, before, after } : null;
  const list = step1.messages;
  const cut = tailStart(list, Math.max(2_000, Math.floor(o.limit * 0.3)));
  if (cut == null) return step1.cleared ? { messages: list, pruned: step1.cleared, summarised: 0, fallback: false, before, after } : null;

  const head = list[0], middle = list.slice(1, cut), tail = list.slice(cut);
  const headBlocks = blocksOf(head);
  const previous = headBlocks.find((b) => b.type === "text" && String(b.text).startsWith(SUMMARY_MARK))?.text.slice(SUMMARY_HEAD.length).trim() ?? null;
  const taskBlocks = headBlocks.filter((b) => !(b.type === "text" && String(b.text).startsWith(SUMMARY_MARK)));
  const task = taskBlocks.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
  const prompt = `# The task\n${clip(task, 6_000)}\n\n# Notes so far\n${previous ?? "None yet."}\n\n# The stretch of transcript being removed\n${renderForSummary(middle)}`;

  let summary = "", fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    summary = (await Promise.race([
      o.summarise(SUMMARY_SYSTEM, prompt),
      new Promise<string>((_, no) => { timer = setTimeout(() => no(new Error("the summariser stalled")), o.timeoutMs ?? SUMMARY_TIMEOUT_MS); }),
    ])).trim();
  } catch { summary = ""; }
  finally { clearTimeout(timer); }
  if (!validSummary(summary)) { summary = fallbackSummary(task, previous, middle); fallback = true; }

  const next: Msg[] = [
    { role: "user", content: [...taskBlocks, { type: "text", text: `${SUMMARY_HEAD}\n\n${summary}` }] as any },
    ...keptPairs(middle),
    ...tail,
  ];
  after = tokensOf(next);
  return { messages: next, pruned: step1.cleared, summarised: middle.length, fallback, before, after };
}
