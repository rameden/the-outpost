// One short question to the smallest model, for the camp's own housekeeping (tidying a memory,
// working out what's worth keeping from a run). It runs the way the crew does: through your
// Claude subscription, or on the API key. It has no tools and takes one turn.

import Anthropic from "@anthropic-ai/sdk";
import { askClaudeCode } from "./claude-code.js";
import { campRuntime } from "./settings.js";

export const SMALL_MODEL = "claude-haiku-5-5";

export async function askSmall(system: string, prompt: string, maxTokens = 1500): Promise<string> {
  if (campRuntime() === "claude-code") return (await askClaudeCode(system, prompt, SMALL_MODEL)).text;
  const r = await new Anthropic().messages.create({ model: SMALL_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}
