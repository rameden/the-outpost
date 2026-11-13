import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal, lineTotal, subtotal } from "../src/invoice.js";

const lines = [
  { description: "Brand refresh", quantity: 2, unitCents: 45_000 },
  { description: "Stock photos", quantity: 3, unitCents: 1_250 },
];

test("a line is its quantity times its unit price", () => {
  assert.equal(lineTotal(lines[0]), 90_000);
  assert.equal(lineTotal({ description: "Nothing yet", quantity: 0, unitCents: 5_000 }), 0);
});

test("a line refuses a quantity or price that isn't a whole number", () => {
  assert.throws(() => lineTotal({ quantity: 1.5, unitCents: 100 }), RangeError);
  assert.throws(() => lineTotal({ quantity: 1, unitCents: 9.99 }), TypeError);
});

test("the subtotal adds the lines up", () => {
  assert.equal(subtotal(lines), 93_750);
  assert.equal(subtotal([]), 0);
});

test("with no discount or tax, the total is the subtotal", () => {
  assert.deepEqual(invoiceTotal({ lines }), { subtotalCents: 93_750, discountCents: 0, discountCode: null, taxCents: 0, totalCents: 93_750 });
});

test("the discount comes off first, and tax is charged on what's left", () => {
  assert.deepEqual(invoiceTotal({ lines, taxRate: 0.08, discountCode: "WELCOME10" }), {
    subtotalCents: 93_750, discountCents: 9_375, discountCode: "WELCOME10", taxCents: 6_750, totalCents: 91_125,
  });
});
