import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, toCents } from "../src/money.js";

test("toCents reads amounts with two, one, or no decimal places", () => {
  assert.equal(toCents("12.50"), 1250);
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents("12"), 1200);
  assert.equal(toCents("0.07"), 7);
  assert.equal(toCents("-3.20"), -320);
});

test("toCents refuses anything that isn't a plain amount", () => {
  for (const bad of ["", "abc", "1.234", "1,000", "$5"]) assert.throws(() => toCents(bad), TypeError, bad);
});

test("formatMoney shows dollars and cents", () => {
  assert.equal(formatMoney(1250), "$12.50");
  assert.equal(formatMoney(1299), "$12.99");
  assert.equal(formatMoney(0), "$0.00");
});

test("formatMoney groups thousands and shows a minus sign", () => {
  assert.equal(formatMoney(123456), "$1,234.56");
  assert.equal(formatMoney(-4500), "-$45.00");
});

test("formatMoney knows euros and pounds, and refuses other currencies", () => {
  assert.equal(formatMoney(1999, "EUR"), "€19.99");
  assert.equal(formatMoney(1999, "GBP"), "£19.99");
  assert.throws(() => formatMoney(1999, "XYZ"), RangeError);
});

test("formatMoney shows cents under ten as they are", { todo: "LED-101" }, () => {
  assert.equal(formatMoney(1005), "$10.05");
  assert.equal(formatMoney(7), "$0.07");
});

test("an amount typed in comes back out the same", { todo: "LED-101" }, () => {
  for (const amount of ["10.05", "3.01", "250.09"]) assert.equal(formatMoney(toCents(amount)), `$${amount}`);
});
