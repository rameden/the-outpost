// Discount codes. A code takes a percentage or a fixed amount off the subtotal. Some need a
// minimum spend: the subtotal has to reach it, and reaching it exactly counts.

export const DISCOUNTS = {
  WELCOME10: { percent: 10 },
  STUDIO15: { percent: 15, minimumCents: 50_000 },
  LOYAL25: { amountCents: 2_500, minimumCents: 10_000 },
};

/**
 * What a code takes off a subtotal.
 * Returns { discountCents, applied } where applied is the code that was used, or null when
 * none was (no code given, a code nobody issued, or a subtotal under the code's minimum).
 */
export function applyDiscount(subtotalCents, code) {
  if (!code) return { discountCents: 0, applied: null };
  const name = String(code).trim().toUpperCase();
  const rule = DISCOUNTS[name];
  if (!rule) return { discountCents: 0, applied: null, reason: "unknown code" };
  const minimum = rule.minimumCents ?? 0;
  if (!(subtotalCents > minimum)) return { discountCents: 0, applied: null, reason: "under the minimum spend" };
  const discountCents = rule.percent
    ? Math.round((subtotalCents * rule.percent) / 100)
    : Math.min(rule.amountCents, subtotalCents);
  return { discountCents, applied: name };
}
