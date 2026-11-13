import { test } from "node:test";
import assert from "node:assert/strict";
import { dueDate, isOverdue, nextBillingDate } from "../src/billing.js";

test("an invoice is due 30 days after it's issued, unless it says otherwise", () => {
  assert.equal(dueDate("2026-03-02"), "2026-04-01");
  assert.equal(dueDate("2026-03-02", 14), "2026-03-16");
  assert.equal(dueDate("2026-12-20", 30), "2027-01-19");
});

test("dates that don't exist are refused", () => {
  assert.throws(() => dueDate("2026-02-30"), RangeError);
  assert.throws(() => dueDate("02/03/2026"), TypeError);
});

test("an invoice is overdue the day after its due date, not on it", () => {
  assert.equal(isOverdue("2026-04-01", "2026-04-01"), false);
  assert.equal(isOverdue("2026-04-01", "2026-04-02"), true);
});

test("a monthly plan bills on the same day next month", () => {
  assert.equal(nextBillingDate("2026-01-15"), "2026-02-15");
  assert.equal(nextBillingDate("2026-06-01"), "2026-07-01");
});

test("a monthly plan carries over into the next year", () => {
  assert.equal(nextBillingDate("2026-12-10"), "2027-01-10");
});

test("a plan billed at the end of a month bills on the last day of a shorter one", { todo: "LED-103" }, () => {
  assert.equal(nextBillingDate("2026-01-31"), "2026-02-28");
  assert.equal(nextBillingDate("2026-03-31"), "2026-04-30");
  assert.equal(nextBillingDate("2026-01-29"), "2026-02-28");
});

test("in a leap year February has a 29th to bill on", { todo: "LED-103" }, () => {
  assert.equal(nextBillingDate("2028-01-31"), "2028-02-29");
  assert.equal(nextBillingDate("2028-01-29"), "2028-02-29");
});
