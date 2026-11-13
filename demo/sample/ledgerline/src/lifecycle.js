// What happens to an invoice after it is made: it is sent, then paid, or voided if it was wrong.
// Each step checks that the account may do it, then returns the changed invoice and the audit
// trail with one new entry: who did what, to which invoice, and when. The trail is only ever
// added to. `at` is an ISO timestamp, passed in so the time is the caller's to set.

import { assertCan } from "./access.js";
import { paymentLine } from "./receipt.js";

const entry = (account, action, invoice, at, note) =>
  Object.freeze({ at, actor: account.name, action, invoice: invoice.number, ...(note ? { note } : {}) });

export function sendInvoice(invoice, account, trail, at) {
  assertCan(account, "send");
  if (invoice.status !== "draft") throw new Error(`${invoice.number} was already sent`);
  return { invoice: { ...invoice, status: "sent" }, trail: [...trail, entry(account, "sent", invoice, at)] };
}

export function markPaid(invoice, account, trail, at, payment) {
  assertCan(account, "pay");
  if (invoice.status !== "sent") throw new Error(`${invoice.number} can't be paid while it is ${invoice.status}`);
  return { invoice: { ...invoice, status: "paid" }, trail: [...trail, entry(account, "paid", invoice, at, paymentLine(payment))] };
}

export function voidInvoice(invoice, account, trail, at, reason) {
  assertCan(account, "void");
  if (invoice.status === "paid") throw new Error(`${invoice.number} is paid: refund it instead of voiding it`);
  if (!reason) throw new TypeError("Voiding an invoice needs a reason");
  return { invoice: { ...invoice, status: "void" }, trail };
}
