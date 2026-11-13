// Money is kept in whole cents (integers) everywhere, so sums never pick up rounding errors.
// These helpers turn cents into text for people, and text typed by people back into cents.

const SYMBOLS = { USD: "$", EUR: "€", GBP: "£" };

/** "12.50", "12.5" or "12" → 1250. Throws on anything that isn't a plain amount. */
export function toCents(amount) {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim());
  if (!match) throw new TypeError(`Not an amount: ${amount}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/** 123456 → "$1,234.56". Always two digits after the point. */
export function formatMoney(cents, currency = "USD") {
  if (!Number.isInteger(cents)) throw new TypeError(`Cents must be a whole number: ${cents}`);
  const symbol = SYMBOLS[currency];
  if (!symbol) throw new RangeError(`Unknown currency: ${currency}`);
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padEnd(2, "0");
  return `${cents < 0 ? "-" : ""}${symbol}${whole}.${fraction}`;
}
