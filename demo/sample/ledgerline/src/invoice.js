// An invoice's sums. An invoice looks like:
//   { number, customer, issuedOn, netDays?, lines: [{ description, quantity, unitCents }], taxRate?, discountCode? }
// The discount comes off the subtotal first; tax is charged on what's left.

import { applyDiscount } from "./discounts.js";

export function lineTotal(line) {
  if (!Number.isInteger(line.quantity) || line.quantity < 0) throw new RangeError(`Quantity must be a whole number, zero or more: ${line.quantity}`);
  if (!Number.isInteger(line.unitCents)) throw new TypeError(`A unit price is whole cents: ${line.unitCents}`);
  return line.quantity * line.unitCents;
}

export function subtotal(lines) {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function invoiceTotal(invoice) {
  const subtotalCents = subtotal(invoice.lines);
  const { discountCents, applied } = applyDiscount(subtotalCents, invoice.discountCode);
  const taxCents = Math.round((subtotalCents - discountCents) * (invoice.taxRate ?? 0));
  return { subtotalCents, discountCents, discountCode: applied, taxCents, totalCents: subtotalCents - discountCents + taxCents };
}
