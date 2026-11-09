// What a run cost, in dollars, from its token usage and the model's price.
// Rates are per million tokens. Cache writes cost 1.25x input (5-minute cache); cache reads
// cost 0.1x input unless the model lists its own rate. Estimates: they ignore long-prompt tiers.

export type Rate = { input: number; output: number; cacheRead?: number };

const RATES: Record<string, Rate> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Dated ids (claude-haiku-4-5-20251001) share their family's price.
export function rateOf(model: string): Rate | undefined {
  return RATES[model] ?? RATES[model.replace(/-\d{8}$/, "")];
}

export function priceLabel(model: string): string | undefined {
  const r = rateOf(model);
  if (!r) return undefined;
  const f = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n}`);
  return `${f(r.input)} / ${f(r.output)}`;
}

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function costOf(model: string, u: Usage): number {
  const r = rateOf(model);
  if (!r) return 0;
  const read = r.cacheRead ?? r.input * 0.1;
  return (u.input * r.input + u.cacheWrite * r.input * 1.25 + u.cacheRead * read + u.output * r.output) / 1_000_000;
}

export const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
