// A Claude judge for checks that need reading comprehension (e.g. "no invented facts").
// Kept separate from the crew: its own model, low effort, short answer. It runs the same way the
// crew does: on your Claude subscription through Claude Code, or on the API with an API key.

import Anthropic from "@anthropic-ai/sdk";
import { costOf } from "../src/costs.ts";
import { campRuntime } from "../src/settings.ts";
import { askClaudeCode } from "../src/claude-code.ts";

const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-opus-5-5";
const SYSTEM = "You grade an AI assistant's work against a rubric. Be strict and literal. Reply with exactly one line: PASS or FAIL, then a colon and a short reason.";

export async function judge(rubric: string, evidence: string): Promise<{ pass: boolean; reason: string; cost: number }> {
  if (process.env.EVAL_NO_JUDGE === "1") return { pass: true, reason: "judge skipped", cost: 0 };
  let text: string;
  let cost: number;
  if (campRuntime() === "claude-code") {
    const r = await askClaudeCode(SYSTEM, `RUBRIC: ${rubric}\n\n${evidence}`, JUDGE_MODEL);
    text = r.text;
    cost = r.costUsd;
  } else {
    const resp = await new Anthropic().messages.create({
      model: JUDGE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `RUBRIC: ${rubric}\n\n${evidence}` }],
    });
    text = resp.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    cost = costOf(JUDGE_MODEL, {
      input: resp.usage.input_tokens, output: resp.usage.output_tokens,
      cacheRead: resp.usage.cache_read_input_tokens ?? 0, cacheWrite: resp.usage.cache_creation_input_tokens ?? 0,
    });
  }
  return { pass: /^PASS\b/i.test(text), reason: text.replace(/^(PASS|FAIL)\s*:?\s*/i, "") || text, cost };
}
