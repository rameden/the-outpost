// One short question to the smallest model, for the camp's own housekeeping (tidying a memory,
// working out what's worth keeping from a run, naming a conversation). It runs the way the crew does: through your
// Claude subscription, or on the API key. It has no tools and takes one turn.

import Anthropic from "@anthropic-ai/sdk";
import { askClaudeCode } from "./claude-code.js";
import { getProject } from "./conversations.js";
import { maySend, otherModel, providerAsk } from "./providers.js";
import { campRuntime, smallModel } from "./settings.js";

export const SMALL_MODEL = "claude-haiku-5-5";

// project: the project the text comes from, if any. A project you've marked confidential (web:
// careful, or off) isn't sent to another provider unless you've approved that provider for it:
// otherwise its small jobs stay on Claude whatever you chose.
export async function askSmall(system: string, prompt: string, maxTokens = 1500, o: { project?: string } = {}): Promise<string> {
  // You can point these at another model (Settings → Models): a free one from a provider you've connected, say.
  const chosen = smallModel();
  const other = otherModel(chosen ?? undefined);
  if (other && maySend(other.provider, getProject(o.project)?.settings?.web)) return providerAsk(other, system, prompt, maxTokens);
  const model = other ? SMALL_MODEL : chosen ?? SMALL_MODEL;
  if (campRuntime() === "claude-code") return (await askClaudeCode(system, prompt, model)).text;
  const r = await new Anthropic().messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}
