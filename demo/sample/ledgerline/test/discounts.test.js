import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/discounts.js";

test("no code, no discount", () => {
  assert.deepEqual(applyDiscount(20_000, undefined), { discountCents: 0, applied: null });
  assert.deepEqual(applyDiscount(20_000, ""), { discountCents: 0, applied: null });
});

test("a code nobody issued takes nothing off", () => {
  assert.deepEqual(applyDiscount(20_000, "FREEMONEY"), { discountCents: 0, applied: null, reason: "unknown code" });
});

test("a percentage code takes its share of the subtotal", () => {
  assert.deepEqual(applyDiscount(20_000, "WELCOME10"), { discountCents: 2_000, applied: "WELCOME10" });
  assert.deepEqual(applyDiscount(1_999, "WELCOME10"), { discountCents: 200, applied: "WELCOME10" });
});

test("codes are read without regard to case or stray spaces", () => {
  assert.equal(applyDiscount(20_000, " welcome10 ").applied, "WELCOME10");
});

test("a fixed-amount code takes its amount off", () => {
  assert.deepEqual(applyDiscount(30_000, "LOYAL25"), { discountCents: 2_500, applied: "LOYAL25" });
});

test("a subtotal over the minimum spend qualifies", () => {
  assert.deepEqual(applyDiscount(80_000, "STUDIO15"), { discountCents: 12_000, applied: "STUDIO15" });
});

test("a subtotal under the minimum spend doesn't", () => {
  assert.deepEqual(applyDiscount(49_999, "STUDIO15"), { discountCents: 0, applied: null, reason: "under the minimum spend" });
});

test("a subtotal of exactly the minimum spend qualifies", { todo: "LED-102" }, () => {
  assert.deepEqual(applyDiscount(50_000, "STUDIO15"), { discountCents: 7_500, applied: "STUDIO15" });
  assert.deepEqual(applyDiscount(10_000, "LOYAL25"), { discountCents: 2_500, applied: "LOYAL25" });
});
