// What a run cost, in dollars, from its token usage and the model's price.
// Rates are per million tokens. Cache writes cost 1.25x input (5-minute cache); cache reads
// cost 0.1x input unless the model lists its own rate. Estimates: they ignore long-prompt tiers.

export type Rate = { input: number; output: number; cacheRead?: number };

const RATES: Record<string, Rate> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-mythos-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // DeepSeek's own two models, at its peak-hour prices (01:00-04:00 and 06:00-10:00 UTC on
  // weekdays). The rest of the week is half that, so these estimates run high, never low.
  // Its cache has no write charge. From api-docs.deepseek.com/quick_start/pricing, November 2026.
  "deepseek:deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006 },
  "deepseek:deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044 },
  // OpenAI's chat models, standard processing, from developers.openai.com/api/docs/pricing,
  // November 2026. Prompts over 272k tokens cost more there; these estimates ignore that.
  "openai:gpt-6.2-astra": { input: 8, output: 40, cacheRead: 0.4 },
  "openai:gpt-6.2-sol": { input: 2, output: 10, cacheRead: 0.1 },
  "openai:gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1 },
  "openai:gpt-6.1-terra": { input: 1, output: 5, cacheRead: 0.05 },
  "openai:gpt-6-astra": { input: 10, output: 50, cacheRead: 1 },
  "openai:gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2 },
  "openai:gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "openai:gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4 },
  "openai:gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2 },
  "openai:gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02 },
  "openai:gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
  "openai:gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25 },
  "openai:gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075 },
  "openai:gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02 },
  "openai:gpt-5.2": { input: 1.75, output: 14, cacheRead: 0.175 },
  "openai:gpt-5.1": { input: 1.25, output: 10, cacheRead: 0.125 },
  "openai:gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
  "openai:gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025 },
  "openai:gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005 },
  "openai:o3": { input: 2, output: 8, cacheRead: 0.5 },
  "openai:gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "openai:gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "openai:gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25 },
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
};

// Dated ids (claude-haiku-4-5-20251001) share their family's price.
export function rateOf(model: string): Rate | undefined {
  return RATES[model] ?? RATES[model.replace(/-\d{8}$/, "")];
}

export function priceLabel(model: string): string | undefined {
  const r = rateOf(model);
  if (!r) return undefined;
  const f = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  return `${f(r.input)} / ${f(r.output)}`;
}

// A Claude model that isn't in the table yet (a new release) is costed at its family's dearest
// listed rate, so budgets still stop a run on it: counting it as free would switch the budget off
// for exactly the models most likely to be expensive. Only for cost and budgets: the price shown
// beside a model (priceLabel) stays blank until its real price is listed here. The same goes for
// a DeepSeek or OpenAI model that isn't listed yet, so a new one may be counted high until it's added. Any other provider's model has no known price.
const FAMILIES = ["fable", "mythos", "opus", "sonnet", "haiku"];
function estimateRate(model: string): Rate | undefined {
  const family = FAMILIES.find((f) => model.startsWith(`claude-${f}-`));
  const prefix = family ? `claude-${family}-` : model.startsWith("deepseek:") ? "deepseek:" : model.startsWith("openai:") ? "openai:" : null;
  if (!prefix) return undefined;
  return Object.entries(RATES).filter(([id]) => id.startsWith(prefix)).map(([, r]) => r).sort((a, b) => b.input - a.input)[0];
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function costOf(model: string, u: Usage): number {
  const r = rateOf(model) ?? estimateRate(model);
  if (!r) return 0;
  const read = r.cacheRead ?? r.input * 0.1;
  return (u.input * r.input + u.cacheWrite * r.input * 1.25 + u.cacheRead * read + u.output * r.output) / 1_000_000;
}

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
