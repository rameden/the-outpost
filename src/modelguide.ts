// A page in the camp's wiki that lays out every model you can use, side by side: what it costs,
// how fast it is, and what kind of work it's fit for. It's written from the list of models the
// camp can actually reach (Claude's, and each provider you've connected), so it changes as you
// connect and disconnect providers; the page says when it was written.
//
// What's known and what's a rule of thumb are kept apart. Claude's prices are the camp's own
// (the ones its cost estimates use), and so are DeepSeek's, which sells its own models at listed
// prices. For other providers the camp is told a model's name and nothing else, so cost, speed
// and fit are judged from the model's family ("flash", "pro", "8b", "70b"…): useful for choosing
// where to start, not a measurement. The page says so, and
// it lives under notes/, where the crew treats what it reads as a claim to weigh.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listModels, type ModelInfo } from "./agent.js";
import { rateOf } from "./costs.js";
import { emit } from "./events.js";
import { providersState } from "./providers.js";
import { WIKI_DIR } from "./wiki.js";

export const GUIDE_PATH = join(WIKI_DIR, "notes", "models-guide.md");

export type Rating = { cost: string; speed: string; fit: string; rated: boolean };
const COST = ["free", "$", "$$", "$$$", "$$$$"]; // cheapest to dearest
const dollars = (input: number) => (input <= 0.5 ? "$" : input <= 2.5 ? "$$" : input <= 6 ? "$$$" : "$$$$");

// How one model rates. Claude's cost comes from its real price; everything else from its name.
export function rateModel(m: Pick<ModelInfo, "id" | "name" | "provider" | "free">): Rating {
  const id = m.id.toLowerCase();
  if (!m.provider) {
    const r = rateOf(m.id);
    const cost = r ? `${dollars(r.input)} ($${r.input} in / $${r.output} out per million tokens)` : "not listed";
    if (/haiku/.test(id)) return { cost, speed: "Fastest", fit: "Short, simple jobs: titles, summaries, lookups, tidying. Follows tools well for its size.", rated: true };
    if (/sonnet/.test(id)) return { cost, speed: "Fast", fit: "Everyday work: research, writing, reviews, most code changes. The sensible default.", rated: true };
    if (/opus/.test(id)) return { cost, speed: "Steady", fit: "Hard, many-step work: planning, large changes across files, tricky debugging.", rated: true };
    if (/fable|mythos/.test(id)) return { cost, speed: "Steady", fit: "The hardest work, where getting it right matters more than cost.", rated: true };
    return { cost, speed: "Not rated", fit: "Not rated: try it on a small task first.", rated: false };
  }
  const free = m.free ? "free" : null;
  // DeepSeek's own two: the price is its listed one; speed and fit are still a rule of thumb.
  if (m.provider === "DeepSeek") {
    const r = rateOf(m.id);
    const cost = r ? `${dollars(r.input)} ($${r.input} in / $${r.output} out per million tokens at peak hours, half that off-peak)` : "not listed";
    if (/flash/.test(id)) return { cost, speed: "Fast", fit: "Everyday work at low cost: summaries, lookups, reviews, small changes. Thinks before it answers. Can be shown images.", rated: true };
    if (/pro/.test(id)) return { cost, speed: "Steady", fit: "Harder reasoning and long documents. A reasonable second opinion on Claude's work. Text only: it can't be shown images.", rated: true };
    return { cost, speed: "Not rated", fit: "Not rated: try it on a small task first.", rated: false };
  }
  // OpenAI's families. The price is its listed one where this outpost knows it; speed and fit go by the family's name.
  if (m.provider === "OpenAI") {
    const r = rateOf(m.id);
    const listed = r ? `${dollars(r.input)} ($${r.input} in / $${r.output} out per million tokens)` : null;
    if (/gpt-\d[.\d]*-luna/.test(id)) return { cost: listed ?? "$", speed: "Fastest", fit: "Simple jobs in bulk: titles, tagging, short summaries. Calls tools only with its thinking off, so it does that whenever tools are in play.", rated: true };
    if (/gpt-6[.\d]*-terra/.test(id)) return { cost: listed ?? "$$", speed: "Fast", fit: "Small jobs and writing. Can't call tools here (it needs OpenAI's Responses API), so not for work that uses tools.", rated: true };
    if (/gpt-\d[.\d]*-terra/.test(id)) return { cost: listed ?? "$$", speed: "Fast", fit: "Everyday work at low cost: summaries, lookups, reviews, small changes.", rated: true };
    if (/gpt-\d[.\d]*-sol/.test(id)) return { cost: listed ?? "$$", speed: "Steady (it thinks first)", fit: "Everyday work: research, writing, reviews, code changes. A strong second opinion on Claude's work.", rated: true };
    if (/gpt-\d[.\d]*-astra/.test(id)) return { cost: listed ?? "$$$$", speed: "Steady (it thinks first)", fit: "The hardest work: planning, large changes, tricky reasoning.", rated: true };
    if (/nano/.test(id)) return { cost: listed ?? "$", speed: "Fastest", fit: "Simple jobs in bulk: titles, tagging, short summaries.", rated: true };
    if (/mini/.test(id)) return { cost: listed ?? "$", speed: "Fast", fit: "Everyday work at low cost: summaries, lookups, reviews, small changes. Good at calling tools for its size.", rated: true };
    if (/^(openai:)?(gpt-5|o[1-9])/.test(id)) return { cost: listed ?? "$$", speed: "Steady (it thinks first)", fit: "Hard, many-step work: planning, code changes, tricky reasoning. A strong second opinion on Claude's work.", rated: true };
    if (/^(openai:)?(gpt-4|chatgpt-)/.test(id)) return { cost: listed ?? "$$", speed: "Fast", fit: "Everyday work: writing, research, reviews. Doesn't reason before it answers.", rated: true };
    return { cost: listed ?? "not known", speed: "Not rated", fit: "Not rated: try it on a small task first.", rated: false };
  }
  // Gemini's families.
  if (/gemini/.test(id) && /flash-lite|flash-8b|nano/.test(id)) return { cost: free ?? "$", speed: "Fastest", fit: "Simple jobs in bulk: titles, tagging, short summaries.", rated: true };
  if (/gemini/.test(id) && /flash/.test(id)) return { cost: free ?? "$", speed: "Fast", fit: "Everyday work at low cost: summaries, lookups, reviews, small changes. Long many-step tool work is hit and miss.", rated: true };
  if (/gemini/.test(id) && /pro|ultra/.test(id)) return { cost: free ?? "$$$", speed: "Steady", fit: "Harder reasoning and long documents. A reasonable second opinion on Claude's work.", rated: true };
  if (/gemma/.test(id)) return { cost: free ?? "$", speed: "Fast", fit: "Simple jobs only. An open model: weaker at calling tools.", rated: true };
  // Open models, which is what Groq hosts (and much of OpenRouter's free list): size is the best guide.
  const small = /(^|[^0-9])([1-9]|1[0-9])b\b|instant|mini|small|tiny|nano/.test(id);
  const large = /([2-9][0-9]|[1-9][0-9]{2})b\b|versatile|large|kimi|qwen|deepseek|gpt-oss|llama-4|maverick/.test(id);
  const quick = m.provider === "Groq" ? "Very fast (Groq's hardware is the point)" : null;
  if (small) return { cost: free ?? "$", speed: quick ?? "Fast", fit: "Simple jobs: titles, short summaries, yes-or-no checks. Not for tool-heavy work.", rated: true };
  if (large) return { cost: free ?? "$", speed: quick ?? "Varies with the host", fit: "Everyday work where speed or cost matters: summaries, lookups, first drafts, a quick review. Many-step tool work is less reliable than Claude's.", rated: true };
  return { cost: free ?? "not known", speed: quick ?? "Not rated", fit: "Not rated: try it on a small task first.", rated: false };
}

const costRank = (c: string) => { const i = COST.findIndex((x) => c === x || c.startsWith(`${x} `)); return i < 0 ? COST.length : i; };

// The page, as Markdown. now: when it's written (for the tests).
export async function modelGuide(now = new Date()): Promise<string> {
  const { models, live } = await listModels();
  const providers = providersState();
  const day = now.toISOString().slice(0, 10);
  const groups: [string, ModelInfo[]][] = [["Claude", models.filter((m) => !m.provider)], ...providers.filter((p) => p.connected).map((p): [string, ModelInfo[]] => [p.name, models.filter((m) => m.provider === p.name)])];
  const table = (list: ModelInfo[]) => {
    const rows = list.map((m) => ({ m, r: rateModel(m) })).sort((a, b) => costRank(a.r.cost) - costRank(b.r.cost) || a.m.id.localeCompare(b.m.id));
    return "| Model | Name it as | Cost | Speed | Good for |\n|---|---|---|---|---|\n" +
      rows.map(({ m, r }) => `| ${m.name.replace(/\|/g, "/")} | \`${m.id}\` | ${r.cost} | ${r.speed} | ${r.fit} |`).join("\n");
  };
  const about = (name: string) => {
    const p = providers.find((x) => x.name === name);
    if (!p) return `Used by default. Prices are this outpost's own, the ones its cost estimates use.`;
    return `${p.approved ? "You've approved it for confidential projects." : "Not approved for confidential projects: a project marked confidential is never sent to it."} ${p.privacy} ` +
      (p.id === "deepseek"
        ? `Its prices below are DeepSeek's listed ones, the ones this outpost's cost estimates use. Speed and fit are a rule of thumb.`
        : p.id === "openai"
        ? `Its prices below are OpenAI's listed ones, the ones this outpost's cost estimates use; a model not listed yet is counted at the dearest, so its estimate runs high. Speed and fit are a rule of thumb.`
        : `Its cost, speed and fit below are judged from each model's family name, as a rule of thumb: the provider tells this outpost a model's name and nothing more.`);
  };
  const notConnected = providers.filter((p) => !p.connected).map((p) => p.name);
  return `---
summary: Every model this outpost can use (Claude, and connected providers), by cost, speed, and what each is good for
updated: ${day}
---

# Models guide

Written by this outpost on ${day} from the models it can reach${live ? "" : " (Claude's list couldn't be read just now, so its usual models are shown)"}. It's rewritten when you connect or disconnect a provider, or press **Update the guide** under Settings → Models.

Source: this outpost's own model list and prices for Claude, DeepSeek and OpenAI; for other providers, the model's family name only. Treat the ratings for other providers as a starting point, not a measurement: their prices, limits and line-ups change, and the provider's own pricing page is the authority.

## How to choose

- **Short and simple** (naming a conversation, tidying notes, a quick lookup): the cheapest row that's rated for simple jobs. This is what "Small jobs" under Settings → Models is for.
- **Everyday work** (research, writing, reviews, most code changes): Claude Sonnet, or a provider's mid-size model when cost or speed matters more than polish.
- **Hard, many-step work** (planning, changes across many files, debugging): Claude Opus or above. Other providers' models call tools less reliably over many turns, which is where long runs go wrong.
- **A second opinion**: a strong model from a different company than the one that did the work catches different mistakes.
- **Cost** runs from free, through $ (cheapest paid), to $$$$. Free tiers also cap how many requests you can make a minute.

${groups.filter(([, list]) => list.length).map(([name, list]) => `## ${name}\n\n${about(name)}\n\n${table(list)}`).join("\n\n")}
${notConnected.length ? `\n## Not connected\n\n${notConnected.join(", ")}: add a key under Settings → Models and ${notConnected.length === 1 ? "its" : "their"} models will be listed here.\n` : ""}`;
}

// Write (or rewrite) the page. Returns where it is.
export async function writeModelGuide(): Promise<string> {
  const text = await modelGuide();
  mkdirSync(join(WIKI_DIR, "notes"), { recursive: true });
  writeFileSync(GUIDE_PATH, text);
  emit({ type: "changed", what: "wiki" });
  return GUIDE_PATH.split("\\").join("/");
}
