// The line on a receipt that says how an invoice was paid. The same line goes into the audit
// trail, so it must never show a whole bank account number: only its last four characters.

/** An account number with all but its last four characters hidden: "0012345678" → "•••• 5678". */
export function maskAccount(number) {
  const text = String(number);
  if (!/^\d+$/.test(text)) return text; // not a number: leave it as it was written
  return `•••• ${text.slice(-4)}`;
}

/** "Bank transfer from account •••• 5678", or just "Cash" when no account was involved. */
export function paymentLine(payment) {
  const method = payment.method[0].toUpperCase() + payment.method.slice(1);
  return payment.account ? `${method} from account ${maskAccount(payment.account)}` : method;
}
