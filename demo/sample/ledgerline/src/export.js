// The CSV the accountant imports each month: one row per invoice, a header row first.
// Amounts are plain decimals (1234.56), with no currency symbol or thousands separator.

import { dueDate } from "./billing.js";
import { invoiceTotal } from "./invoice.js";

export const COLUMNS = ["number", "customer", "issued_on", "due_on", "total"];

export function toCsv(invoices) {
  const rows = invoices.map((invoice) => [
    invoice.number,
    invoice.customer,
    invoice.issuedOn,
    dueDate(invoice.issuedOn, invoice.netDays),
    (invoiceTotal(invoice).totalCents / 100).toFixed(2),
  ]);
  return [COLUMNS, ...rows].map((row) => row.join(",")).join("\n") + "\n";
}
