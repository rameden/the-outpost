// One short question to the smallest model, for the camp's own housekeeping (tidying a memory,
// working out what's worth keeping from a run, naming a conversation). It runs the way the crew does: through your
// Claude subscription, or on the API key. It has no tools and takes one turn.

import Anthropic from "@anthropic-ai/sdk";
import { listModels } from "./agent.js";
import { coolDown, routingPolicy, snapshot } from "./autoroute.js";
import { askClaudeCode } from "./claude-code.js";
import { getProject } from "./conversations.js";
import { anthropicKey, maySend, otherModel, providerAsk } from "./providers.js";
import { isAutoChoice, routeId, selectRoute, type Route, type TaskProfile, type Tier } from "./routing.js";
import { campRuntime, smallModel } from "./settings.js";

export const SMALL_MODEL = "claude-haiku-5-5";
// How many models Auto tries for one small job before saying it couldn't be done.
const AUTO_TRIES = 3;

// One model, asked once: another provider's, or Claude through your subscription or the API key.
async function askOn(model: string, system: string, prompt: string, maxTokens: number): Promise<string> {
  const other = otherModel(model);
  if (other) return providerAsk(other, system, prompt, maxTokens);
  if (campRuntime() === "claude-code") return (await askClaudeCode(system, prompt, model)).text;
  const r = await new Anthropic({ apiKey: anthropicKey() }).messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

// Auto, for a small job (routing.ts): the cheapest model that's connected, allowed this project's
// text, not cooling down, and up to a short, simple job, with the next best after it. What a small
// job is doesn't need working out from its words: it's one short turn, nothing rides on it, and it
// has no tools. It sets no effort either, so each model is one route; and it's never worth a large
// model, so the choice is among the smallest Claude model and other providers' models (which also
// keeps "what if it needs a second go" priced at a small model, not the largest).
// Empty: nothing can take it right now.
const SMALL_TIERS = new Set<Tier>(["haiku", "open-strong", "open-fast", "open-unknown"]);
export async function smallRoutes(system: string, prompt: string, maxTokens: number, project?: string): Promise<Route[]> {
  const web = String(getProject(project)?.settings?.web ?? "");
  const snap = snapshot((await listModels()).models, { confidential: web === "careful" || web === "off" });
  const seen = new Set<string>();
  snap.routes = snap.routes.filter((r) => SMALL_TIERS.has(r.tier) && !seen.has(r.model) && !!seen.add(r.model)).map((r) => ({ ...r, id: routeId(r.model), effort: undefined }));
  const profile: TaskProfile = {
    family: "chat", scope: "symbol", consequence: "cosmetic", difficulty: 0.1, followUp: false, signals: ["small job"],
    needs: { images: false, tools: false, serverTools: false, structured: false, requestTokens: Math.ceil((system.length + prompt.length) / 3) + maxTokens },
  };
  const d = selectRoute(profile, { trigger: "new_task", historyTokens: 0, repeatedFailures: 0 }, snap, routingPolicy(), "economy");
  return d.kind === "selected" ? [d.primary, ...d.fallbacks].slice(0, AUTO_TRIES) : [];
}

// project: the project the text comes from, if any. A project you've marked confidential (web:
// careful, or off) isn't sent to another provider unless you've approved that provider for it:
// otherwise its small jobs stay on Claude whatever you chose.
export async function askSmall(system: string, prompt: string, maxTokens = 1500, o: { project?: string } = {}): Promise<string> {
  // You can point these at another model (Settings → Models): a free one from a provider you've connected, say, or Auto.
  const chosen = smallModel();
  if (isAutoChoice(chosen)) {
    const routes = await smallRoutes(system, prompt, maxTokens, o.project).catch((): Route[] => []);
    let failed: unknown;
    for (const r of routes) {
      try { return await askOn(r.model, system, prompt, maxTokens); }
      catch (e) { failed = e; coolDown(r.id, routingPolicy().cooldownMs, "failed a small job"); } // set aside for a minute, and the next one's asked
    }
    if (failed) throw failed;
    return askOn(SMALL_MODEL, system, prompt, maxTokens); // nothing could be chosen: the default, as if Auto were off
  }
  const other = otherModel(chosen ?? undefined);
  if (other && maySend(other.provider, getProject(o.project)?.settings?.web)) return providerAsk(other, system, prompt, maxTokens);
  return askOn(other ? SMALL_MODEL : chosen ?? SMALL_MODEL, system, prompt, maxTokens);
}
