import { test } from "node:test";
import assert from "node:assert/strict";
import { maskAccount, paymentLine } from "../src/receipt.js";
import { markPaid } from "../src/lifecycle.js";

test("an account number shows only its last four digits", () => {
  assert.equal(maskAccount("0012345678"), "•••• 5678");
  assert.equal(maskAccount(40112233), "•••• 2233");
});

test("the payment line names the method, and the account when there is one", () => {
  assert.equal(paymentLine({ method: "bank transfer", account: "0012345678" }), "Bank transfer from account •••• 5678");
  assert.equal(paymentLine({ method: "cash" }), "Cash");
});

test("an account number with letters in it is masked too", { todo: "LED-107" }, () => {
  assert.equal(maskAccount("GB29NWBK60161331926819"), "•••• 6819");
});

test("spaces and dashes in an account number don't stop it being masked", { todo: "LED-107" }, () => {
  assert.equal(maskAccount("GB29 NWBK 6016 1331 9268 19"), "•••• 6819");
  assert.equal(maskAccount("0012-3456-78"), "•••• 5678");
});

test("an account number of four characters or fewer is hidden completely", { todo: "LED-107" }, () => {
  assert.equal(maskAccount("1234"), "••••");
  assert.equal(maskAccount("77"), "••••");
});

test("the audit trail never holds a whole account number", { todo: "LED-107" }, () => {
  const sent = { number: "INV-0042", customer: "Northwind Studio", status: "sent" };
  const { trail } = markPaid(sent, { name: "Ines Ferreira", role: "clerk" }, [], "2026-03-20T14:00:00Z", { method: "bank transfer", account: "GB29 NWBK 6016 1331 9268 19" });
  assert.equal(trail[0].note, "Bank transfer from account •••• 6819");
});
