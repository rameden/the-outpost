import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/export.js";

const invoice = (over = {}) => ({
  number: "INV-0042",
  customer: "Northwind Studio",
  issuedOn: "2026-03-02",
  lines: [{ description: "Brand refresh", quantity: 2, unitCents: 45_000 }],
  ...over,
});

test("the export starts with a header row and ends with a newline", () => {
  assert.equal(toCsv([]), "number,customer,issued_on,due_on,total\n");
});

test("each invoice is one row: number, customer, issued, due, total", () => {
  assert.equal(toCsv([invoice()]), "number,customer,issued_on,due_on,total\nINV-0042,Northwind Studio,2026-03-02,2026-04-01,900.00\n");
});

test("the total is after discount and tax, as a plain decimal", () => {
  const csv = toCsv([invoice({ taxRate: 0.08, discountCode: "WELCOME10", netDays: 14 })]);
  assert.equal(csv.split("\n")[1], "INV-0042,Northwind Studio,2026-03-02,2026-03-16,874.80");
});

test("a customer name with a comma in it stays in one column", { todo: "LED-104" }, () => {
  const csv = toCsv([invoice({ customer: "Acme, Inc." })]);
  assert.equal(csv.split("\n")[1], 'INV-0042,"Acme, Inc.",2026-03-02,2026-04-01,900.00');
});

test("a customer name with quotes in it keeps them", { todo: "LED-104" }, () => {
  const csv = toCsv([invoice({ customer: 'Dana "DJ" Okafor Design' })]);
  assert.equal(csv.split("\n")[1], 'INV-0042,"Dana ""DJ"" Okafor Design",2026-03-02,2026-04-01,900.00');
});
