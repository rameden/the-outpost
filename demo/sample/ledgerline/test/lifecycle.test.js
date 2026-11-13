import { test } from "node:test";
import assert from "node:assert/strict";
import { sendInvoice, markPaid, voidInvoice } from "../src/lifecycle.js";

const draft = { number: "INV-0042", customer: "Northwind Studio", status: "draft" };
const clerk = { name: "Ines Ferreira", role: "clerk" };
const admin = { name: "Kofi Mensah", role: "admin" };
const at = "2026-03-02T09:30:00Z";

test("sending an invoice marks it sent and adds an entry to the trail", () => {
  const { invoice, trail } = sendInvoice(draft, clerk, [], at);
  assert.equal(invoice.status, "sent");
  assert.deepEqual(trail, [{ at, actor: "Ines Ferreira", action: "sent", invoice: "INV-0042" }]);
});

test("paying an invoice adds an entry that says how it was paid", () => {
  const sent = sendInvoice(draft, clerk, [], at);
  const { invoice, trail } = markPaid(sent.invoice, clerk, sent.trail, "2026-03-20T14:00:00Z", { method: "bank transfer", account: "0012345678" });
  assert.equal(invoice.status, "paid");
  assert.equal(trail.length, 2);
  assert.deepEqual(trail[1], { at: "2026-03-20T14:00:00Z", actor: "Ines Ferreira", action: "paid", invoice: "INV-0042", note: "Bank transfer from account •••• 5678" });
});

test("the trail that was passed in is left as it was", () => {
  const before = [];
  sendInvoice(draft, clerk, before, at);
  assert.equal(before.length, 0);
});

test("a step the account may not take changes nothing", () => {
  assert.throws(() => sendInvoice(draft, { name: "Tomas", role: "viewer" }, [], at), /may not send invoices/);
  assert.throws(() => voidInvoice(draft, clerk, [], at, "Duplicate"), /may not void invoices/);
});

test("voiding marks the invoice void, needs a reason, and is refused once it is paid", () => {
  assert.equal(voidInvoice(draft, admin, [], at, "Duplicate of INV-0041").invoice.status, "void");
  assert.throws(() => voidInvoice(draft, admin, [], at), /needs a reason/);
  assert.throws(() => voidInvoice({ ...draft, status: "paid" }, admin, [], at, "Duplicate"), /refund it instead/);
});

test("voiding an invoice adds an entry to the trail", { todo: "LED-106" }, () => {
  const sent = sendInvoice(draft, clerk, [], at);
  const { trail } = voidInvoice(sent.invoice, admin, sent.trail, "2026-03-03T11:15:00Z", "Duplicate of INV-0041");
  assert.equal(trail.length, 2);
  assert.deepEqual({ ...trail[1], note: undefined }, { at: "2026-03-03T11:15:00Z", actor: "Kofi Mensah", action: "voided", invoice: "INV-0042", note: undefined });
});

test("the entry for a void says why it was voided", { todo: "LED-106" }, () => {
  const { trail } = voidInvoice(draft, admin, [], at, "Duplicate of INV-0041");
  assert.equal(trail.at(-1)?.note, "Duplicate of INV-0041");
});
