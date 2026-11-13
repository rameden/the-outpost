# Ledgerline

Invoices for a small studio: totals, discount codes, billing dates, a CSV export for the accountant, and a record of who did what to each invoice.

```js
import { invoiceTotal, formatMoney, toCsv } from "ledgerline";

const invoice = {
  number: "INV-0042",
  customer: "Northwind Studio",
  issuedOn: "2026-03-02",
  lines: [{ description: "Brand refresh", quantity: 2, unitCents: 45_000 }],
  taxRate: 0.08,
  discountCode: "WELCOME10",
};

formatMoney(invoiceTotal(invoice).totalCents); // "$874.80"
```

| File | What it holds |
|---|---|
| `src/money.js` | Amounts as whole cents, and turning them into text and back |
| `src/invoice.js` | Line totals, subtotal, discount, tax, total |
| `src/discounts.js` | Discount codes and when each applies |
| `src/billing.js` | Due dates and the next date of a monthly plan |
| `src/export.js` | The CSV the accountant imports |
| `src/access.js` | Roles, and what each may do to an invoice |
| `src/lifecycle.js` | Sending, paying and voiding an invoice, each adding to its audit trail |
| `src/receipt.js` | The payment line on a receipt, with the account number masked |

## Running the tests

```bash
npm test
```

There is nothing to install: the tests use Node's own test runner.

See [AGENTS.md](AGENTS.md) for how bugs are tracked and fixed here.
